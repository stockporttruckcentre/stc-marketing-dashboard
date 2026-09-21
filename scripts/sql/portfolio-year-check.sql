-- =============================================================
-- A portfolio against last year, and against its target.
--
-- From the business:
--
--   It needs to show what it's up compared to last year and go against
--   his yearly target.
--
-- Two bases, both on the screen, both asserted here, because they are
-- different numbers and a check that only proved one would let the
-- other be wrong.
--
-- Run with `npm run check:portfolio-year`.
-- =============================================================
\set ON_ERROR_STOP on
BEGIN;

DO $check$
DECLARE
  rep   UUID := 'eeeeeeee-0000-0000-0000-000000000001';
  other UUID := 'eeeeeeee-0000-0000-0000-000000000002';
  boss  UUID := 'eeeeeeee-0000-0000-0000-000000000003';
  acme  UUID := 'eeeeeeee-1111-0000-0000-000000000001';
  beta  UUID := 'eeeeeeee-1111-0000-0000-000000000002';
  fy    DATE := financial_year_of(CURRENT_DATE);
  fy0   DATE := (fy - INTERVAL '1 year')::DATE;
  cut   DATE := (CURRENT_DATE - INTERVAL '1 year')::DATE;
  o     RECORD;
  y     RECORD;
BEGIN
  ALTER TABLE profiles DISABLE TRIGGER USER;
  INSERT INTO auth.users (id, email) VALUES
    (rep, 'py-rep@stc.example'), (other, 'py-other@stc.example'), (boss, 'py-boss@stc.example')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO profiles (id, email, full_name, role, is_active) VALUES
    (rep,   'py-rep@stc.example',   'Dean Portfolio', 'sales', TRUE),
    (other, 'py-other@stc.example', 'Someone Else',   'sales', TRUE),
    (boss,  'py-boss@stc.example',  'Mo Director',    'admin', TRUE)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;
  UPDATE profiles SET role_template_id = (SELECT id FROM role_templates WHERE slug = 'sales_rep')
   WHERE id IN (rep, other);
  UPDATE profiles SET role_template_id = (SELECT id FROM role_templates WHERE slug = 'managing_director')
   WHERE id = boss;
  ALTER TABLE profiles ENABLE TRIGGER USER;
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);

  DELETE FROM crm_leads;
  DELETE FROM protean_invoices;
  DELETE FROM protean_accounts;

  INSERT INTO crm_contacts (id, company_name) VALUES
    (acme, 'Acme Haulage'), (beta, 'Beta Transport')
  ON CONFLICT (id) DO UPDATE SET company_name = EXCLUDED.company_name, deleted_at = NULL;

  PERFORM set_personal_fy_target(rep, 600000, NULL, 'the number from the scope');

  -- ---------------------------------------------------------
  -- Won work. One deal last year to the same point, one this year,
  -- and one dated LATER in this year than today.
  -- ---------------------------------------------------------
  INSERT INTO crm_leads (id, company_name, contact_id, owner_id, type, status,
                         sale_price, order_date) VALUES
    (gen_random_uuid(), 'Acme Haulage', acme, rep, 'maintenance', 'won',
     40000.00, cut - 5),
    (gen_random_uuid(), 'Acme Haulage', acme, rep, 'maintenance', 'won',
     50000.00, fy + 1),
    (gen_random_uuid(), 'Beta Transport', beta, rep, 'trailer_sales', 'won',
     90000.00, fy + 2),
    (gen_random_uuid(), 'Beta Transport', beta, rep, 'maintenance', 'won',
     11000.00, CURRENT_DATE + 20);

  SELECT * INTO o FROM personal_overview(rep, CURRENT_DATE);

  -- The comparison is capped at today, so the future dated deal is out.
  IF o.won_to_date <> 50000.00 THEN
    RAISE EXCEPTION 'won_to_date is % and should be 50000, the future dated deal leaked in', o.won_to_date;
  END IF;
  IF o.last_year_won <> 40000.00 THEN
    RAISE EXCEPTION 'last_year_won is % and should be 40000', o.last_year_won;
  END IF;
  IF o.won_change <> 10000.00 THEN
    RAISE EXCEPTION 'won_change is % and should be 10000', o.won_change;
  END IF;
  IF o.won_change_pct <> 25.0 THEN
    RAISE EXCEPTION 'won_change_pct is % and should be 25.0', o.won_change_pct;
  END IF;

  -- Trailer sales is in neither of them, exactly as it is kept out of
  -- the target figure.
  IF o.trailer_revenue <> 90000.00 THEN
    RAISE EXCEPTION 'trailer_revenue is % and should be 90000', o.trailer_revenue;
  END IF;

  -- The target figure itself did NOT move: it is the whole year, so it
  -- carries the future dated deal that the comparison leaves out.
  IF o.target_revenue <> 61000.00 THEN
    RAISE EXCEPTION 'target_revenue is % and should still be 61000', o.target_revenue;
  END IF;
  IF o.fy_target <> 600000 THEN
    RAISE EXCEPTION 'the target is % and should be 600000', o.fy_target;
  END IF;

  -- ---------------------------------------------------------
  -- Nothing last year is not a percentage.
  -- ---------------------------------------------------------
  /* Migration 128. The business read "Up on last year +8k" off a
     portfolio whose last year was Not known, and said it looked like
     last year was being picked up as this year. It was not: the null
     was being coalesced to nought and subtracted, so the rise was the
     whole of this year. No figure for last year means NO change
     figure. */
  DELETE FROM crm_leads WHERE owner_id = rep AND order_date < fy;
  SELECT * INTO o FROM personal_overview(rep, CURRENT_DATE);
  IF o.last_year_won IS NOT NULL THEN
    RAISE EXCEPTION 'last year should be unknown here and is %', o.last_year_won;
  END IF;
  IF o.won_change IS NOT NULL THEN
    RAISE EXCEPTION 'a rise of % was invented out of an unknown last year', o.won_change;
  END IF;
  IF o.won_change_pct IS NOT NULL THEN
    RAISE EXCEPTION 'a percentage was worked out from nothing: %', o.won_change_pct;
  END IF;
  IF o.won_to_date <> 50000.00 THEN
    RAISE EXCEPTION 'won_to_date is % and should still be 50000', o.won_to_date;
  END IF;

  /* But a REAL nought last year is a real fall, and is reported. */
  INSERT INTO crm_leads (id, company_name, contact_id, owner_id, type, status,
                         sale_price, order_date)
  VALUES (gen_random_uuid(), 'Acme Haulage', acme, rep, 'maintenance', 'won', 0.00, cut - 5);
  SELECT * INTO o FROM personal_overview(rep, CURRENT_DATE);
  IF o.last_year_won <> 0 THEN
    RAISE EXCEPTION 'last year should be a known nought and is %', o.last_year_won;
  END IF;
  IF o.won_change <> 50000.00 THEN
    RAISE EXCEPTION 'won_change is % and should be 50000 against a known nought', o.won_change;
  END IF;
  DELETE FROM crm_leads WHERE owner_id = rep AND order_date < fy;

  -- ---------------------------------------------------------
  -- Invoiced revenue. A different basis, and it must not borrow from
  -- the tracker figures above.
  -- ---------------------------------------------------------
  INSERT INTO protean_accounts (division, alpha, protean_name, contact_id, last_seen)
  VALUES ('stc', 'ACME01', 'ACME HAULAGE', acme, NOW());

  INSERT INTO protean_invoices (invoice_no, alpha, tax_point, net, division) VALUES
    ('PY0001', 'ACME01', fy  + 3, 7000.00, 'stc'),
    ('PY0002', 'ACME01', fy0 + 3, 5000.00, 'stc'),
    -- last year but AFTER the same point, so out of the comparison
    ('PY0003', 'ACME01', cut + 3, 3000.00, 'stc');

  SELECT * INTO y FROM personal_revenue_year(rep, CURRENT_DATE);
  IF y.this_year <> 7000.00 THEN
    RAISE EXCEPTION 'invoiced this year is % and should be 7000', y.this_year; END IF;
  IF y.last_year <> 5000.00 THEN
    RAISE EXCEPTION 'invoiced last year is % and should be 5000, the later one leaked in', y.last_year; END IF;
  IF y.change <> 2000.00 THEN
    RAISE EXCEPTION 'invoiced change is % and should be 2000', y.change; END IF;
  IF y.change_pct <> 40.0 THEN
    RAISE EXCEPTION 'invoiced change_pct is % and should be 40.0', y.change_pct; END IF;

  -- Beta is in the portfolio and bound to nothing, and that is said
  -- rather than quietly counted as nought.
  IF y.customers <> 2 THEN
    RAISE EXCEPTION 'the portfolio is % customers and should be 2', y.customers; END IF;
  IF y.not_bound <> 1 THEN
    RAISE EXCEPTION '% customers are unbound and 1 should be', y.not_bound; END IF;

  -- ---------------------------------------------------------
  -- And somebody else's portfolio answers nothing, not nought.
  -- ---------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', other::TEXT, TRUE);
  IF EXISTS (SELECT 1 FROM personal_overview(rep, CURRENT_DATE)) THEN
    RAISE EXCEPTION 'a rep read somebody else''s overview';
  END IF;
  IF EXISTS (SELECT 1 FROM personal_revenue_year(rep, CURRENT_DATE)) THEN
    RAISE EXCEPTION 'a rep read somebody else''s invoiced revenue';
  END IF;
  IF EXISTS (SELECT 1 FROM personal_won_between(rep, fy, CURRENT_DATE) w
              WHERE w.target_revenue IS NOT NULL) THEN
    RAISE EXCEPTION 'a rep read somebody else''s won work';
  END IF;

  -- ---------------------------------------------------------
  -- Migration 133. An accepted FleetSmart+ contract is that person's
  -- sale and reaches their target, once and only once.
  -- ---------------------------------------------------------
  INSERT INTO crm_leads (id, company_name, contact_id, owner_id, type, status,
                         sale_price, order_date)
  VALUES (gen_random_uuid(), 'Acme Haulage', acme, rep, 'maintenance', 'won', 50000.00, fy + 1);

  INSERT INTO fleetsmart_contracts (customer_name, account_id, owner_id, status,
                                    annual_total, monthly_total, term_months,
                                    sent_at, decided_at)
  VALUES ('Acme Haulage', acme, rep, 'accepted', 20000.00, 1666.67, 36,
          NOW(), (fy + 5)::TIMESTAMPTZ);

  SELECT * INTO o FROM personal_overview(rep, CURRENT_DATE);
  /* Migration 134. Value won is the whole TERM: 20000 a year over 36
     months is 60000. It is reported and is NOT in the target. */
  IF o.fs_value_won <> 60000.00 THEN
    RAISE EXCEPTION 'value won reads % and should read the term, 60000', o.fs_value_won; END IF;
  IF o.fs_contracts <> 1 THEN
    RAISE EXCEPTION '% contracts counted, wanted 1', o.fs_contracts; END IF;
  IF o.tracker_revenue <> 50000.00 THEN
    RAISE EXCEPTION 'the tracker half reads % and should read 50000', o.tracker_revenue; END IF;

  /* Nothing invoiced against it yet, so the target has not moved. */
  IF COALESCE(o.fs_value_invoiced, 0) <> 0 THEN
    RAISE EXCEPTION 'value invoiced reads % with no invoices', o.fs_value_invoiced; END IF;
  IF o.target_revenue <> 50000.00 THEN
    RAISE EXCEPTION 'the target reads % and value won must not be in it', o.target_revenue; END IF;

  /* Bill some of it. THAT moves the target, and only that. */
  INSERT INTO protean_accounts (division, alpha, protean_name, contact_id, last_seen)
  VALUES ('stc','FS0001','ACME HAULAGE FS', acme, NOW())
  ON CONFLICT (division, alpha) DO NOTHING;
  INSERT INTO protean_invoices (invoice_no, alpha, tax_point, net, division)
  VALUES ('FSINV1','FS0001', fy + 8, 1666.67, 'stc');

  SELECT * INTO o FROM personal_overview(rep, CURRENT_DATE);
  IF o.fs_value_invoiced <> 1666.67 THEN
    RAISE EXCEPTION 'value invoiced reads % and should read 1666.67', o.fs_value_invoiced; END IF;
  IF o.target_revenue <> 51666.67 THEN
    RAISE EXCEPTION 'the target reads % and should read 51666.67', o.target_revenue; END IF;
  IF o.fs_value_won <> 60000.00 THEN
    RAISE EXCEPTION 'value won moved to %', o.fs_value_won; END IF;

  DELETE FROM protean_invoices WHERE invoice_no = 'FSINV1';

  -- A contract that already made a WON tracker lead is NOT added twice.
  UPDATE fleetsmart_contracts f SET lead_id = (
    SELECT l.id FROM crm_leads l
     WHERE l.owner_id = rep AND l.status = 'won' AND l.order_date IS NOT NULL LIMIT 1)
   WHERE f.owner_id = rep;
  SELECT * INTO o FROM personal_overview(rep, CURRENT_DATE);
  IF o.target_revenue <> 50000.00 THEN
    RAISE EXCEPTION 'a contract was double counted, target reads %', o.target_revenue; END IF;

  -- A draft or declined one reaches nothing.
  UPDATE fleetsmart_contracts SET lead_id = NULL, status = 'declined' WHERE owner_id = rep;
  SELECT * INTO o FROM personal_overview(rep, CURRENT_DATE);
  IF COALESCE(o.fs_value_won, 0) <> 0 OR COALESCE(o.fs_value_invoiced, 0) <> 0 THEN
    RAISE EXCEPTION 'a declined contract counted % won and % invoiced',
      o.fs_value_won, o.fs_value_invoiced; END IF;

  DELETE FROM fleetsmart_contracts WHERE owner_id = rep;
  DELETE FROM crm_leads WHERE owner_id = rep AND order_date = fy + 1;

  RAISE NOTICE 'portfolio year: both bases right, capped at the date, and nobody else can read them';
END $check$;

ROLLBACK;
