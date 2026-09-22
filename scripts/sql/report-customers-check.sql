-- =============================================================
-- Reports rank the customer, not the billing name.
--
-- From an audit of the product, both verified against the code:
--
--   Top/bottom customer and growth reports group invoices by raw
--   protean_name [...] One customer can be split across names, or
--   invoices pooled under a billing name.
--
--   This financial year so far is compared with the whole previous
--   financial year, despite the report claiming comparison with the
--   same point last year. This can manufacture apparent declines.
--
-- Run with `npm run check:report-customers`.
-- =============================================================
\set ON_ERROR_STOP on
BEGIN;

DO $check$
DECLARE
  boss UUID := 'beef0000-0000-0000-0000-000000000001';
  two  UUID; cashcust UUID; seasonal UUID;
  fy   DATE := financial_year_of(CURRENT_DATE);
  fy0  DATE := (fy - INTERVAL '1 year')::DATE;
  cut  DATE := (CURRENT_DATE - INTERVAL '1 year')::DATE;
  r    RECORD; n INT;
BEGIN
  ALTER TABLE profiles DISABLE TRIGGER USER;
  INSERT INTO auth.users (id,email) VALUES (boss,'rep-cust@stc.example') ON CONFLICT DO NOTHING;
  INSERT INTO profiles (id,email,full_name,role,is_active)
  VALUES (boss,'rep-cust@stc.example','Mo Director','admin',TRUE)
  ON CONFLICT (id) DO UPDATE SET role='admin';
  UPDATE profiles SET role_template_id=(SELECT id FROM role_templates WHERE slug='managing_director') WHERE id=boss;
  ALTER TABLE profiles ENABLE TRIGGER USER;
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);

  DELETE FROM protean_invoices; DELETE FROM protean_accounts;

  INSERT INTO crm_contacts (company_name) VALUES ('Two Account Haulage') RETURNING id INTO two;
  INSERT INTO crm_contacts (company_name) VALUES ('Cash Only Ltd')       RETURNING id INTO cashcust;
  INSERT INTO crm_contacts (company_name) VALUES ('Seasonal Transport')  RETURNING id INTO seasonal;

  INSERT INTO protean_accounts (division, alpha, protean_name, contact_id, is_invoicing_type, last_seen) VALUES
    ('stc',    'TWOA', 'TWO ACCOUNT HAULAGE',   two,      FALSE, NOW()),
    ('rental', 'TWOB', 'Two Account Haulage Ltd', two,    FALSE, NOW()),
    ('stc',    'CASHSALE', 'Cash Sale',         NULL,     TRUE,  NOW()),
    ('stc',    'SEAS', 'SEASONAL TRANSPORT',    seasonal, FALSE, NOW());

  INSERT INTO protean_invoices (invoice_no, alpha, tax_point, net, division, site_name, contact_id) VALUES
    -- one customer, two accounts, two names
    ('R1','TWOA', fy + 5, 1000.00,'stc',    NULL, NULL),
    ('R2','TWOB', fy + 6, 2000.00,'rental', NULL, NULL),
    -- a cash sale already allocated to its real customer
    ('R3','CASHSALE', fy + 7, 500.00,'stc', 'Cash Only Ltd', NULL),
    -- a seasonal customer: nothing yet this year, and it all landed
    -- LATER in last year than today's date a year ago
    ('R4','SEAS', (fy0 + INTERVAL '9 months')::DATE, 9000.00,'stc', NULL, NULL);

  UPDATE protean_invoices SET contact_id = cashcust WHERE invoice_no = 'R3';

  -- ---------------------------------------------------------
  -- 1. ONE CUSTOMER, ONE ROW, both accounts added together.
  -- ---------------------------------------------------------
  SELECT count(*) INTO n FROM report_customer_spend(NULL, CURRENT_DATE)
   WHERE company_name = 'Two Account Haulage';
  IF n <> 1 THEN
    RAISE EXCEPTION 'the two account customer appears % times, wanted 1', n; END IF;

  SELECT * INTO r FROM report_customer_spend(NULL, CURRENT_DATE)
   WHERE company_name = 'Two Account Haulage';
  IF r.this_year <> 3000.00 THEN
    RAISE EXCEPTION 'it reads % and should read 3000, its two accounts added', r.this_year; END IF;

  -- ---------------------------------------------------------
  -- 2. THE CASH SALE RANKS UNDER ITS REAL CUSTOMER, and the words
  --    "Cash Sale" never appear as a customer in a report.
  -- ---------------------------------------------------------
  SELECT * INTO r FROM report_customer_spend(NULL, CURRENT_DATE)
   WHERE company_name = 'Cash Only Ltd';
  IF r.this_year <> 500.00 THEN
    RAISE EXCEPTION 'the cash sale customer reads %, wanted 500', r.this_year; END IF;
  IF EXISTS (SELECT 1 FROM report_customer_spend(NULL, CURRENT_DATE)
              WHERE company_name ILIKE '%cash sale%') THEN
    RAISE EXCEPTION 'Cash Sale is being ranked as a customer in a report';
  END IF;

  -- ---------------------------------------------------------
  -- 3. LAST YEAR IS CUT AT THE SAME POINT.
  --
  -- The seasonal customer's 9000 landed nine months into last year,
  -- later than today's date a year ago. Counting the whole of last
  -- year would print it as a 9000 collapse. It is out of both windows,
  -- which is what "the same point last year" means.
  -- ---------------------------------------------------------
  SELECT * INTO r FROM report_customer_spend(NULL, CURRENT_DATE)
   WHERE company_name = 'Seasonal Transport';
  IF r.last_year <> 0 THEN
    RAISE EXCEPTION 'last year reads % for work done after the same point, so a collapse is invented',
      r.last_year;
  END IF;

  -- and work BEFORE the same point last year is counted, or the
  -- comparison would be empty for everybody.
  INSERT INTO protean_invoices (invoice_no, alpha, tax_point, net, division)
  VALUES ('R5','SEAS', fy0 + 3, 4000.00, 'stc');
  SELECT * INTO r FROM report_customer_spend(NULL, CURRENT_DATE)
   WHERE company_name = 'Seasonal Transport';
  IF r.last_year <> 4000.00 THEN
    RAISE EXCEPTION 'last year reads % and should read the 4000 from before the cut', r.last_year; END IF;

  -- ---------------------------------------------------------
  -- 4. The division filter still works, and splits the two accounts.
  -- ---------------------------------------------------------
  SELECT * INTO r FROM report_customer_spend(ARRAY['stc'], CURRENT_DATE)
   WHERE company_name = 'Two Account Haulage';
  IF r.this_year <> 1000.00 THEN
    RAISE EXCEPTION 'filtered to stc it reads %, wanted 1000', r.this_year; END IF;

  RAISE NOTICE 'reports: one customer one row, cash sales under their owner, like compared with like';
END $check$;

ROLLBACK;
