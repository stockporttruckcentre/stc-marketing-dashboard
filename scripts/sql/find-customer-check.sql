-- =============================================================
-- Typing a customer's name always answers.
--
-- From the business, in front of a managing director:
--
--   dean will type "hats" and say where is my customer. Same for all
--   the rest. Where are they.
--
-- Four reasons a customer can be missing from the Customers list, all
-- of them correct for that list, none of them a reason for the NAME to
-- answer with nothing. Each is a case below.
--
-- Run with `npm run check:find-customer`.
-- =============================================================
\set ON_ERROR_STOP on
BEGIN;

DO $check$
DECLARE
  boss  UUID := 'aaaaaaaa-9999-0000-0000-000000000001';
  billed UUID; other UUID; aside UUID; never UUID; noacc UUID;
  fy    DATE := financial_year_of(CURRENT_DATE);
  r     RECORD;
  n     INT;
BEGIN
  ALTER TABLE profiles DISABLE TRIGGER USER;
  INSERT INTO auth.users (id, email) VALUES (boss, 'find@stc.example') ON CONFLICT DO NOTHING;
  INSERT INTO profiles (id, email, full_name, role, is_active)
  VALUES (boss, 'find@stc.example', 'Mo Director', 'admin', TRUE)
  ON CONFLICT (id) DO UPDATE SET role = 'admin';
  UPDATE profiles SET role_template_id = (SELECT id FROM role_templates WHERE slug='managing_director')
   WHERE id = boss;
  ALTER TABLE profiles ENABLE TRIGGER USER;
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);

  DELETE FROM protean_invoices; DELETE FROM protean_accounts;

  INSERT INTO crm_contacts (company_name) VALUES ('HATS Billed Ltd')     RETURNING id INTO billed;
  INSERT INTO crm_contacts (company_name) VALUES ('HATS Other Division') RETURNING id INTO other;
  INSERT INTO crm_contacts (company_name) VALUES ('HATS Set Aside Ltd')  RETURNING id INTO aside;
  INSERT INTO crm_contacts (company_name) VALUES ('HATS Never Billed')   RETURNING id INTO never;
  INSERT INTO crm_contacts (company_name) VALUES ('HATS No Account')     RETURNING id INTO noacc;

  INSERT INTO protean_accounts (division, alpha, protean_name, contact_id, ignored, last_seen) VALUES
    ('stc',     'HB01', 'HATS BILLED',    billed, FALSE, NOW()),
    ('rental',  'HO01', 'HATS OTHER',     other,  FALSE, NOW()),
    ('stc',     'HA01', 'HATS ASIDE',     aside,  TRUE,  NOW()),
    ('stc',     'HN01', 'HATS NEVER',     never,  FALSE, NOW());

  INSERT INTO protean_invoices (invoice_no, alpha, tax_point, net, division) VALUES
    ('F0001', 'HB01', fy + 3, 1000.00, 'stc'),
    ('F0002', 'HO01', fy + 3, 2000.00, 'rental'),
    ('F0003', 'HA01', fy + 3,  300.00, 'stc');

  -- ---------------------------------------------------------
  -- 1. ALL FIVE come back for "hats". Not one of them is hidden.
  -- ---------------------------------------------------------
  SELECT count(*) INTO n FROM revenue_find_customer('hats', CURRENT_DATE);
  IF n <> 5 THEN
    RAISE EXCEPTION 'typing hats found % customers and should find 5', n;
  END IF;

  -- ---------------------------------------------------------
  -- 2. The billed one carries its figure and NO reason line.
  -- ---------------------------------------------------------
  SELECT * INTO r FROM revenue_find_customer('hats', CURRENT_DATE)
   WHERE company_name = 'HATS Billed Ltd';
  IF r.this_year <> 1000.00 THEN
    RAISE EXCEPTION 'the billed one reads % and should read 1000', r.this_year; END IF;
  IF r.why IS NOT NULL THEN
    RAISE EXCEPTION 'a reason was given for a customer that has a figure: %', r.why; END IF;

  -- ---------------------------------------------------------
  -- 3. The one on another division is found, with its own figure.
  --    This is the case that made somebody think a customer was lost.
  -- ---------------------------------------------------------
  SELECT * INTO r FROM revenue_find_customer('hats', CURRENT_DATE)
   WHERE company_name = 'HATS Other Division';
  IF r.this_year <> 2000.00 THEN
    RAISE EXCEPTION 'the rental one reads % and should read 2000', r.this_year; END IF;
  IF r.divisions <> 'Rentals' THEN
    RAISE EXCEPTION 'it says its division is % rather than Rentals', r.divisions; END IF;

  -- ---------------------------------------------------------
  -- 4. The set aside one is found, WITH its money and a reason.
  -- ---------------------------------------------------------
  SELECT * INTO r FROM revenue_find_customer('hats', CURRENT_DATE)
   WHERE company_name = 'HATS Set Aside Ltd';
  IF r.this_year <> 300.00 THEN
    RAISE EXCEPTION 'the set aside one reads % and should read 300', r.this_year; END IF;
  IF r.set_aside <> 1 THEN
    RAISE EXCEPTION 'it does not report its account as set aside'; END IF;
  IF r.why NOT LIKE '%set aside%' THEN
    RAISE EXCEPTION 'it does not say why it is missing from the list: %', r.why; END IF;

  -- ---------------------------------------------------------
  -- 5. Never billed, and no account at all, both answer with a
  --    SENTENCE rather than a bare nought.
  -- ---------------------------------------------------------
  SELECT * INTO r FROM revenue_find_customer('hats', CURRENT_DATE)
   WHERE company_name = 'HATS Never Billed';
  IF r.why NOT LIKE '%no invoice has ever come through%' THEN
    RAISE EXCEPTION 'never billed says: %', r.why; END IF;

  SELECT * INTO r FROM revenue_find_customer('hats', CURRENT_DATE)
   WHERE company_name = 'HATS No Account';
  IF r.why NOT LIKE '%No Protean or Sage account%' THEN
    RAISE EXCEPTION 'no account says: %', r.why; END IF;

  -- ---------------------------------------------------------
  -- 6. A deleted customer is NOT offered, so the HATS fault cannot be
  --    made again from this screen.
  -- ---------------------------------------------------------
  PERFORM soft_delete('crm_contacts', never, 'merged away');
  SELECT count(*) INTO n FROM revenue_find_customer('hats', CURRENT_DATE);
  IF n <> 4 THEN
    RAISE EXCEPTION 'a deleted customer is still being offered, % rows', n; END IF;

  -- ---------------------------------------------------------
  -- 7. And a name nobody has answers with nothing, honestly.
  -- ---------------------------------------------------------
  SELECT count(*) INTO n FROM revenue_find_customer('zzzznotacompany', CURRENT_DATE);
  IF n <> 0 THEN RAISE EXCEPTION 'a name nobody has returned % rows', n; END IF;

  RAISE NOTICE 'find customer: five ways to be missing, five answers, none of them silence';
END $check$;

ROLLBACK;
