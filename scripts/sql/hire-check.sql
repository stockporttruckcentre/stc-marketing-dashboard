-- =============================================================
-- One price across a list, and the vendor behind a deal.
--
-- Migration 153 added eight fields to a deal, two to a line, a vendor
-- table and three functions. This drives all of it against a real
-- PostgreSQL with real policies, because the thing that decides whether
-- a button works is what the database did, not what the screen showed.
--
-- Runs AS `authenticated` for the parts that are about permission. The
-- owner of the database bypasses row level security, so a check that
-- runs as the owner proves nothing about a policy.
--
-- Run with `npm run check:hire`.
-- =============================================================
\set ON_ERROR_STOP on
BEGIN;

DO $seed$
DECLARE
  rep    UUID := 'fade0000-0000-0000-0000-0000000000a1';
  other  UUID := 'fade0000-0000-0000-0000-0000000000a2';
  cust   UUID;
  deal   UUID;
  t1     UUID;
  t2     UUID;
  t3     UUID;
BEGIN
  ALTER TABLE profiles DISABLE TRIGGER USER;
  INSERT INTO auth.users (id, email) VALUES
    (rep, 'hire-rep@stc.example'), (other, 'hire-other@stc.example')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO profiles (id, email, full_name, role, is_active) VALUES
    (rep,   'hire-rep@stc.example',   'Hira Rep',   'sales', TRUE),
    (other, 'hire-other@stc.example', 'Otto Other', 'sales', TRUE)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;
  UPDATE profiles SET role_template_id = (SELECT id FROM role_templates WHERE slug='sales_rep')
   WHERE id IN (rep, other);
  ALTER TABLE profiles ENABLE TRIGGER USER;

  DELETE FROM view_as_sessions;
  DELETE FROM crm_leads WHERE company_name = 'Hire Test Ltd';
  DELETE FROM stock_trailers WHERE stc_no IN ('STCH01', 'STCH02', 'STCH03');
  DELETE FROM third_party_vendors WHERE name IN ('Aberdeen Commercials', 'Renamed Commercials');

  INSERT INTO crm_contacts (company_name) VALUES ('Hire Test Ltd') RETURNING id INTO cust;
  INSERT INTO crm_leads (company_name, contact_id, owner_id, created_by, type, status, estimated_value)
  VALUES ('Hire Test Ltd', cust, rep, rep, 'trailer_sales', 'quoted', 50000)
  RETURNING id INTO deal;

  INSERT INTO stock_trailers (stc_no, status, retail_price)
    VALUES ('STCH01', 'in_stock', 21000) RETURNING id INTO t1;
  INSERT INTO stock_trailers (stc_no, status, retail_price)
    VALUES ('STCH02', 'in_stock', 22000) RETURNING id INTO t2;
  INSERT INTO stock_trailers (stc_no, status, retail_price)
    VALUES ('STCH03', 'in_stock', 23000) RETURNING id INTO t3;

  INSERT INTO crm_lead_trailers (lead_id, stock_trailer_id, position)
  VALUES (deal, t1, 0), (deal, t2, 1), (deal, t3, 2);

  PERFORM set_config('stc.deal', deal::TEXT, FALSE);
  PERFORM set_config('stc.t1', t1::TEXT, FALSE);
  PERFORM set_config('stc.t2', t2::TEXT, FALSE);
END $seed$;

GRANT SELECT, INSERT, UPDATE, DELETE ON crm_leads, crm_lead_trailers, third_party_vendors TO authenticated;

SET ROLE authenticated;
DO $check$
DECLARE
  rep  UUID := 'fade0000-0000-0000-0000-0000000000a1';
  deal UUID := current_setting('stc.deal')::UUID;
  t1   UUID := current_setting('stc.t1')::UUID;
  t2   UUID := current_setting('stc.t2')::UUID;
  vend UUID;
  n    INT;
  v    NUMERIC;
  s    TEXT;
  r    RECORD;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);

  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'a sales rep does not hold crm.edit, so nothing below means anything';
  END IF;

  -- -----------------------------------------------------------
  -- 1. A dry run writes NOTHING, and says what it would do.
  -- -----------------------------------------------------------
  SELECT count(*) INTO n FROM lead_price_across(deal, 18000, NULL, NULL, TRUE);
  IF n <> 3 THEN RAISE EXCEPTION 'a dry run over three units returned % rows', n; END IF;

  SELECT count(*) INTO n FROM lead_price_across(deal, 18000, NULL, NULL, TRUE) WHERE changed;
  IF n <> 3 THEN RAISE EXCEPTION 'three unpriced units, and the dry run says % would change', n; END IF;

  SELECT count(*) INTO n FROM crm_lead_trailers WHERE lead_id = deal AND rate IS NOT NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'A DRY RUN WROTE TO % ROWS. The preview is the whole point.', n;
  END IF;

  -- The value BEFORE comes back on a dry run, which is what the screen
  -- shows beside the new one.
  SELECT rate_before, rate_after INTO r
    FROM lead_price_across(deal, 18000, NULL, NULL, TRUE) LIMIT 1;
  IF r.rate_before IS NOT NULL THEN RAISE EXCEPTION 'an unpriced unit reported a price before'; END IF;
  IF r.rate_after <> 18000 THEN RAISE EXCEPTION 'the dry run reported % as the price after', r.rate_after; END IF;

  -- -----------------------------------------------------------
  -- 2. Applying it writes every one of them.
  -- -----------------------------------------------------------
  PERFORM lead_price_across(deal, 18000, NULL, NULL, FALSE);
  SELECT count(*) INTO n FROM crm_lead_trailers WHERE lead_id = deal AND rate = 18000;
  IF n <> 3 THEN RAISE EXCEPTION 'pricing all three priced % of them', n; END IF;

  -- And it left the quantities alone, because no quantity was given.
  SELECT count(*) INTO n FROM crm_lead_trailers WHERE lead_id = deal AND quantity = 1;
  IF n <> 3 THEN RAISE EXCEPTION 'pricing changed a quantity nobody gave it'; END IF;

  -- -----------------------------------------------------------
  -- 3. A second run changes nothing, and says so.
  -- -----------------------------------------------------------
  SELECT count(*) INTO n FROM lead_price_across(deal, 18000, NULL, NULL, TRUE) WHERE changed;
  IF n <> 0 THEN RAISE EXCEPTION 'running the same price again says % would change', n; END IF;

  -- -----------------------------------------------------------
  -- 4. "or choose specific ones to apply it to"
  -- -----------------------------------------------------------
  PERFORM lead_price_across(deal, 25000, 4, ARRAY[t1, t2], FALSE);

  SELECT count(*) INTO n FROM crm_lead_trailers
   WHERE lead_id = deal AND rate = 25000 AND quantity = 4;
  IF n <> 2 THEN RAISE EXCEPTION 'pricing the two named units reached % of them', n; END IF;

  SELECT count(*) INTO n FROM crm_lead_trailers
   WHERE lead_id = deal AND rate = 18000 AND quantity = 1;
  IF n <> 1 THEN RAISE EXCEPTION 'the third unit was changed and it was not named'; END IF;

  -- -----------------------------------------------------------
  -- 5. A unit that is not on this deal takes the whole call with it.
  --
  -- A button that reports three of four updated is a button nobody
  -- reads, so it is refused rather than partly done.
  -- -----------------------------------------------------------
  BEGIN
    PERFORM lead_price_across(deal, 999, NULL,
      ARRAY[t1, 'fade0000-0000-0000-0000-0000000000ff'::UUID], FALSE);
    RAISE EXCEPTION 'pricing a unit that is not on the deal was allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'pricing a unit%' THEN RAISE; END IF;
  END;

  SELECT count(*) INTO n FROM crm_lead_trailers WHERE lead_id = deal AND rate = 999;
  IF n <> 0 THEN RAISE EXCEPTION 'the refused call wrote to % rows anyway', n; END IF;

  -- -----------------------------------------------------------
  -- 6. A price is not negative, and a quantity is a real count.
  -- -----------------------------------------------------------
  BEGIN
    PERFORM lead_price_across(deal, -1, NULL, NULL, FALSE);
    RAISE EXCEPTION 'a negative price was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'a negative price%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM lead_price_across(deal, 100, 0, NULL, FALSE);
    RAISE EXCEPTION 'a quantity of nought was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'a quantity of nought%' THEN RAISE; END IF;
  END;

  -- -----------------------------------------------------------
  -- 7. The vendor, and the two rates.
  -- -----------------------------------------------------------
  SELECT id INTO vend FROM vendor_save(
    NULL, 'Aberdeen Commercials', 'Fiona Reid', '01224 000000', 'fiona@example.com',
    'Unit 2, Bridge of Don', NULL, 'Aberdeen', 'AB23 8EE',
    62.50, 'Aberdeen and the north east', NULL);
  IF vend IS NULL THEN RAISE EXCEPTION 'a vendor could not be added'; END IF;

  -- The same name again is the one that exists, not a second copy for
  -- the next person to choose between, AND IT COMES BACK UNCHANGED.
  -- Adding it a second time with the boxes empty used to blank the
  -- phone number, the address and the rate somebody had agreed.
  SELECT id, maintenance_rate, phone INTO r FROM vendor_save(
    NULL, 'aberdeen commercials', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
  IF r.id <> vend THEN RAISE EXCEPTION 'the same vendor name made a second record'; END IF;
  IF r.maintenance_rate IS DISTINCT FROM 62.50 THEN
    RAISE EXCEPTION 'ADDING THE SAME VENDOR AGAIN WIPED THEIR RATE: it is now %', r.maintenance_rate;
  END IF;
  IF r.phone IS DISTINCT FROM '01224 000000' THEN
    RAISE EXCEPTION 'adding the same vendor again wiped their phone number';
  END IF;

  -- Editing, which passes the id, DOES write what it is given.
  PERFORM vendor_save(vend, 'Renamed Commercials', 'Fiona Reid', '01224 000000',
    'fiona@example.com', 'Unit 2, Bridge of Don', NULL, 'Aberdeen', 'AB23 8EE',
    62.50, 'Aberdeen and the north east', 'Renamed by the check.');
  SELECT count(*) INTO n FROM third_party_vendors
   WHERE id = vend AND name = 'Renamed Commercials';
  IF n <> 1 THEN RAISE EXCEPTION 'editing a vendor by id did not write'; END IF;
  PERFORM vendor_save(vend, 'Aberdeen Commercials', 'Fiona Reid', '01224 000000',
    'fiona@example.com', 'Unit 2, Bridge of Don', NULL, 'Aberdeen', 'AB23 8EE',
    62.50, 'Aberdeen and the north east', NULL);

  UPDATE crm_leads SET vendor_id = vend WHERE id = deal;

  -- With no rate on the deal, the vendor's own applies and it says so.
  SELECT rate, source INTO v, s FROM lead_vendor_rate(deal);
  IF v <> 62.50 THEN RAISE EXCEPTION 'the vendor rate came back as %', v; END IF;
  IF s <> 'vendor' THEN RAISE EXCEPTION 'the rate said it came from %', s; END IF;

  -- With one on the deal, the deal's wins, because that is the figure
  -- agreed for this job and it is what prints on the order form.
  UPDATE crm_leads SET vendor_rate = 55 WHERE id = deal;
  SELECT rate, source INTO v, s FROM lead_vendor_rate(deal);
  IF v <> 55 THEN RAISE EXCEPTION 'the deal rate did not win: got %', v; END IF;
  IF s <> 'deal' THEN RAISE EXCEPTION 'the rate said it came from %', s; END IF;

  -- -----------------------------------------------------------
  -- 8. A vendor on a deal cannot be removed out from under it.
  -- -----------------------------------------------------------
  BEGIN
    PERFORM vendor_remove(vend);
    RAISE EXCEPTION 'a vendor still on a deal was removed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'a vendor still on%' THEN RAISE; END IF;
  END;

  SELECT count(*) INTO n FROM third_party_vendors WHERE id = vend AND deleted_at IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'the refused removal soft deleted the vendor anyway'; END IF;

  -- -----------------------------------------------------------
  -- 9. The two constraints on the deal itself.
  -- -----------------------------------------------------------
  BEGIN
    UPDATE crm_leads SET on_hire_date = '2026-06-01', off_hire_estimate = '2026-05-01'
     WHERE id = deal;
    RAISE EXCEPTION 'an off hire estimate before the on hire date was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE crm_leads SET maintenance_cover = 'whatever' WHERE id = deal;
    RAISE EXCEPTION 'a cover level that is not one of the three was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  UPDATE crm_leads SET on_hire_date = '2026-06-01', off_hire_estimate = '2027-06-01',
                       term_months = 12, maintenance_cover = 'full_rm_tyres'
   WHERE id = deal;
  SELECT count(*) INTO n FROM crm_leads
   WHERE id = deal AND maintenance_cover = 'full_rm_tyres' AND term_months = 12;
  IF n <> 1 THEN RAISE EXCEPTION 'the hire fields did not stick'; END IF;
END $check$;

RESET ROLE;

-- -------------------------------------------------------------
-- 10. Somebody else's deal is not theirs to price.
--
-- Run as the OTHER rep, who owns nothing here.
-- -------------------------------------------------------------
SET ROLE authenticated;
DO $theirs$
DECLARE
  other UUID := 'fade0000-0000-0000-0000-0000000000a2';
  deal  UUID := current_setting('stc.deal')::UUID;
  n     INT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', other::TEXT, TRUE);
  BEGIN
    PERFORM lead_price_across(deal, 1, NULL, NULL, FALSE);
    RAISE EXCEPTION 'a rep priced a deal that is not theirs';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'a rep priced%' THEN RAISE; END IF;
  END;

  SELECT count(*) INTO n FROM crm_lead_trailers WHERE lead_id = deal AND rate = 1;
  IF n <> 0 THEN RAISE EXCEPTION 'the refused call wrote anyway'; END IF;
END $theirs$;
RESET ROLE;

ROLLBACK;
