-- =============================================================
-- A cash sale belongs to the customer who bought it.
--
-- From the business, in front of a managing director:
--
--   the fucking customer HAS NO REVENUE ON THIS APP. Just hidden in
--   the background.
--
-- Protean bills cash work on ONE account, with the real customer in
-- site_name. Migrations 130 to 132 give the invoice its own customer
-- and make every figure read it.
--
-- Run with `npm run check:cash-sales`.
-- =============================================================
\set ON_ERROR_STOP on
BEGIN;

DO $check$
DECLARE
  boss  UUID := 'bbbbbbbb-9999-0000-0000-000000000001';
  rep   UUID := 'bbbbbbbb-9999-0000-0000-000000000002';
  hats  UUID; andrew UUID; normal UUID;
  fy    DATE := financial_year_of(CURRENT_DATE);
  r     RECORD; n INT; v NUMERIC; before_total NUMERIC; after_total NUMERIC;
BEGIN
  ALTER TABLE profiles DISABLE TRIGGER USER;
  INSERT INTO auth.users (id, email) VALUES
    (boss, 'cash-boss@stc.example'), (rep, 'cash-rep@stc.example') ON CONFLICT DO NOTHING;
  INSERT INTO profiles (id, email, full_name, role, is_active) VALUES
    (boss, 'cash-boss@stc.example', 'Mo Director', 'admin', TRUE),
    (rep,  'cash-rep@stc.example',  'Dean Rep',    'sales', TRUE)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;
  UPDATE profiles SET role_template_id=(SELECT id FROM role_templates WHERE slug='managing_director') WHERE id=boss;
  UPDATE profiles SET role_template_id=(SELECT id FROM role_templates WHERE slug='sales_rep') WHERE id=rep;
  ALTER TABLE profiles ENABLE TRIGGER USER;
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);

  DELETE FROM protean_cash_sites; DELETE FROM protean_invoices; DELETE FROM protean_accounts;
  DELETE FROM crm_leads;

  INSERT INTO crm_contacts (company_name) VALUES ('Hats Group')        RETURNING id INTO hats;
  INSERT INTO crm_contacts (company_name) VALUES ('Andrew Chatterton') RETURNING id INTO andrew;
  INSERT INTO crm_contacts (company_name) VALUES ('Normal Haulage')    RETURNING id INTO normal;

  INSERT INTO protean_accounts (division, alpha, protean_name, contact_id, last_seen) VALUES
    ('stc', 'CASHSALE', 'Cash Sale', NULL, NOW()),
    ('stc', 'NORM01',   'NORMAL HAULAGE', normal, NOW());

  INSERT INTO protean_invoices (invoice_no, alpha, tax_point, net, division, protean_name, site_name) VALUES
    ('287991','CASHSALE', fy + 10,  472.50,'stc','Cash Sale','Hats Group'),
    ('287990','CASHSALE', fy + 11, 1257.81,'stc','Cash Sale','Hats Group'),
    ('291211','CASHSALE', fy + 12,  131.00,'stc','Cash Sale','Andrew Chatterton'),
    ('300001','NORM01',   fy + 13, 5000.00,'stc','NORMAL HAULAGE','Normal Haulage');

  SELECT this_year INTO before_total FROM division_revenue(CURRENT_DATE) WHERE division='stc';

  -- ---------------------------------------------------------
  -- 1. THE FAULT. Hats Group's card reads nothing.
  -- ---------------------------------------------------------
  SELECT COALESCE(SUM(d.net),0) INTO v FROM customer_divisions(hats) d;
  IF v <> 0 THEN RAISE EXCEPTION 'this check is not reproducing the fault, card reads %', v; END IF;

  -- ---------------------------------------------------------
  -- 2. The shared account's site names are found, with their money.
  --    The normal account is NOT in here: one customer, nothing to split.
  -- ---------------------------------------------------------
  SELECT count(*) INTO n FROM protean_shared_sites('stc');
  IF n <> 2 THEN RAISE EXCEPTION '% site name(s) found, wanted 2', n; END IF;

  SELECT * INTO r FROM protean_shared_sites('stc') WHERE site_name = 'Hats Group';
  IF r.all_time <> 1730.31 THEN
    RAISE EXCEPTION 'Hats Group is shown as % and should be 1730.31', r.all_time; END IF;
  IF r.contact_id IS NOT NULL THEN
    RAISE EXCEPTION 'it claims to be placed already'; END IF;

  IF EXISTS (SELECT 1 FROM protean_shared_sites('stc') WHERE alpha = 'NORM01') THEN
    RAISE EXCEPTION 'a single customer account was offered for splitting';
  END IF;

  -- ---------------------------------------------------------
  -- 3. Placing it. Both invoices move, and the card reads.
  -- ---------------------------------------------------------
  SELECT protean_bind_site('stc','CASHSALE','Hats Group', hats) INTO n;
  IF n <> 2 THEN RAISE EXCEPTION '% invoice(s) placed, wanted 2', n; END IF;

  SELECT COALESCE(SUM(d.net),0) INTO v FROM customer_divisions(hats) d;
  IF v <> 1730.31 THEN RAISE EXCEPTION 'the card now reads % and should read 1730.31', v; END IF;

  -- ---------------------------------------------------------
  -- 4. AND THE DIVISION TOTAL HAS NOT MOVED BY A PENNY.
  -- ---------------------------------------------------------
  SELECT this_year INTO after_total FROM division_revenue(CURRENT_DATE) WHERE division='stc';
  IF after_total <> before_total THEN
    RAISE EXCEPTION 'the division total moved from % to %', before_total, after_total; END IF;

  -- Nor is it counted twice anywhere.
  SELECT COALESCE(SUM(c.this_year),0) INTO v FROM division_customers('stc', CURRENT_DATE, 200) c;
  IF v <> before_total THEN
    RAISE EXCEPTION 'the customers add to % and the division says %', v, before_total; END IF;

  -- ---------------------------------------------------------
  -- 5. It reaches a salesperson's portfolio too.
  -- ---------------------------------------------------------
  INSERT INTO crm_leads (company_name, contact_id, owner_id, type, status)
  VALUES ('Hats Group', hats, rep, 'maintenance', 'lead');
  SELECT this_year INTO v FROM personal_revenue_year(rep, CURRENT_DATE);
  IF v <> 1730.31 THEN
    RAISE EXCEPTION 'the portfolio reads % and should read 1730.31', v; END IF;

  -- ---------------------------------------------------------
  -- 6. Typing the name answers with the figure now.
  -- ---------------------------------------------------------
  SELECT * INTO r FROM revenue_find_customer('hats', CURRENT_DATE);
  IF r.this_year <> 1730.31 THEN
    RAISE EXCEPTION 'the search reads % and should read 1730.31', r.this_year; END IF;

  -- ---------------------------------------------------------
  -- 7. Next week's import places itself, with no decision to repeat.
  -- ---------------------------------------------------------
  INSERT INTO protean_invoices (invoice_no, alpha, tax_point, net, division, protean_name, site_name)
  VALUES ('287992','CASHSALE', fy + 20, 99.99,'stc','Cash Sale','Hats Group');
  SELECT protean_apply_cash_sites() INTO n;
  IF n <> 1 THEN RAISE EXCEPTION '% placed on the next import, wanted 1', n; END IF;
  SELECT COALESCE(SUM(d.net),0) INTO v FROM customer_divisions(hats) d;
  IF v <> 1830.30 THEN RAISE EXCEPTION 'the card reads % and should read 1830.30', v; END IF;

  -- ---------------------------------------------------------
  -- 8. A deleted customer is refused, as everywhere else.
  -- ---------------------------------------------------------
  PERFORM soft_delete('crm_contacts', andrew, 'merged away');
  BEGIN
    PERFORM protean_bind_site('stc','CASHSALE','Andrew Chatterton', andrew);
    RAISE EXCEPTION 'a cash sale was placed on a deleted customer';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'a cash sale was placed on a deleted customer' THEN RAISE; END IF;
  END;

  -- ---------------------------------------------------------
  -- 9. THE JANUARY PROBLEM. A customer billed only later in last
  --    financial year than today's date falls outside BOTH comparison
  --    windows and renders as nought twice. The whole of last year has
  --    to carry it, or money that exists is displayed as nothing.
  --
  --    This is what Hats Group did on the Revenue tab: two invoices in
  --    January, a year starting in April, and a screen reading 0 and 0
  --    with a last billed date of 2026-01-13 beside it.
  -- ---------------------------------------------------------
  INSERT INTO crm_contacts (company_name) VALUES ('January Only Ltd') RETURNING id INTO andrew;
  INSERT INTO protean_accounts (division, alpha, protean_name, contact_id, last_seen)
  VALUES ('stc','JAN01','JANUARY ONLY', andrew, NOW());
  /* Ten months into the previous financial year, so after the same
     point last year but inside it. */
  INSERT INTO protean_invoices (invoice_no, alpha, tax_point, net, division)
  VALUES ('JAN001','JAN01', (fy - INTERVAL '1 year' + INTERVAL '9 months')::DATE, 1730.31, 'stc');

  SELECT * INTO r FROM protean_year_on_year(CURRENT_DATE, 'stc') WHERE contact_id = andrew;
  IF r.contact_id IS NULL THEN
    RAISE EXCEPTION 'a customer billed only in January is missing from the list entirely';
  END IF;
  IF r.this_year <> 0 OR r.last_year <> 0 THEN
    RAISE EXCEPTION 'the windowed columns read % and %, this check is not reproducing it',
      r.this_year, r.last_year;
  END IF;
  IF r.last_year_full <> 1730.31 THEN
    RAISE EXCEPTION 'the whole of last year reads % and must read 1730.31, or the screen shows nothing',
      r.last_year_full;
  END IF;
  IF r.last_billed IS NULL THEN
    RAISE EXCEPTION 'no last billed date, so nothing on the row says the money is there';
  END IF;

  -- ---------------------------------------------------------
  -- 10. MIGRATION 136. Cash Sale is a route, not a customer.
  --
  --   cash sale means nothing in this app [...] If they don't have an
  --   account, it makes them an account. Cash sale isn't a customer,
  --   it's an invoicing type.
  -- ---------------------------------------------------------
  DELETE FROM protean_cash_sites; DELETE FROM protean_invoices; DELETE FROM protean_accounts;
  DELETE FROM crm_contacts WHERE company_name IN ('Brand New Haulage', 'Hats Group');
  INSERT INTO crm_contacts (company_name) VALUES ('Hats Group') RETURNING id INTO hats;

  INSERT INTO protean_accounts (division, alpha, protean_name, contact_id, last_seen) VALUES
    ('stc', 'CASHSALE', 'Cash Sale', NULL, NOW());
  INSERT INTO protean_invoices (invoice_no, alpha, tax_point, net, division, protean_name, site_name) VALUES
    ('C1','CASHSALE', fy + 10, 472.50,'stc','Cash Sale','Hats Group'),
    ('C2','CASHSALE', fy + 11, 100.00,'stc','Cash Sale','Brand New Haulage'),
    ('C3','CASHSALE', fy + 12,  50.00,'stc','Cash Sale', NULL);

  /* The account is recognised as a route by its own name. */
  IF NOT (SELECT is_invoicing_type FROM protean_accounts
           WHERE division='stc' AND alpha='CASHSALE') THEN
    /* Fresh rows inserted after the migration ran, so mark as the
       importer will once 136 is in: by name. */
    UPDATE protean_accounts SET is_invoicing_type = TRUE
     WHERE division='stc' AND alpha='CASHSALE';
  END IF;

  /* It is NOT offered as something to give a customer to. */
  IF EXISTS (SELECT 1 FROM protean_to_moderate('stc') WHERE alpha = 'CASHSALE') THEN
    RAISE EXCEPTION 'a route is still being offered in the accounts queue';
  END IF;
  BEGIN
    PERFORM protean_bind('stc', 'CASHSALE', hats);
    RAISE EXCEPTION 'a customer was bound to a route';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'a customer was bound to a route' THEN RAISE; END IF;
  END;

  /* Allocating: one existing customer, one created, one with no name
     left alone rather than guessed at. */
  SELECT * INTO r FROM protean_allocate_invoicing_types();
  IF r.placed <> 2 THEN RAISE EXCEPTION '% invoices placed, wanted 2', r.placed; END IF;
  IF r.customers_made <> 1 THEN
    RAISE EXCEPTION '% customers made, wanted 1 for Brand New Haulage', r.customers_made; END IF;
  IF r.no_name <> 1 THEN RAISE EXCEPTION '% with no name, wanted 1', r.no_name; END IF;

  IF NOT EXISTS (SELECT 1 FROM crm_contacts
                  WHERE company_name = 'Brand New Haulage' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'the new customer was not created';
  END IF;

  SELECT COALESCE(SUM(d.net),0) INTO v FROM customer_divisions(hats) d;
  IF v <> 472.50 THEN RAISE EXCEPTION 'Hats reads % after allocating, wanted 472.50', v; END IF;

  /* "Cash Sale" is never printed as a company name. */
  IF EXISTS (SELECT 1 FROM division_customers('stc', CURRENT_DATE, 200)
              WHERE company_name ILIKE '%cash sale%') THEN
    RAISE EXCEPTION 'Cash Sale is still being shown as a customer';
  END IF;

  /* And it is reportable in its own right, which is all it ever was. */
  SELECT COALESCE(SUM(x.this_year), 0) INTO v FROM cash_sale_report(CURRENT_DATE, 'stc') x;
  IF v <> 622.50 THEN
    RAISE EXCEPTION 'the cash sale report totals % and should total 622.50', v; END IF;
  IF NOT EXISTS (SELECT 1 FROM cash_sale_report(CURRENT_DATE, 'stc')
                  WHERE company_name = 'No name on the invoice') THEN
    RAISE EXCEPTION 'the nameless one is not visible in the report';
  END IF;

  -- ---------------------------------------------------------
  -- 11. A REAL COMPANY WITH TWO DEPOTS IS NOT A BILLING ROUTE.
  --
  -- 136 first recognised a route by counting distinct site names. Run
  -- against the real export that converted 37 real companies worth
  -- 4,511,247.12, Booker and Dawson Group among them, because they
  -- invoice two depots. Their revenue would have been stripped off
  -- their records and re-filed under depot names.
  -- ---------------------------------------------------------
  INSERT INTO crm_contacts (company_name) VALUES ('Two Depot Haulage') RETURNING id INTO normal;
  INSERT INTO protean_accounts (division, alpha, protean_name, contact_id, last_seen)
  VALUES ('stc','TWODEPOT','TWO DEPOT HAULAGE', normal, NOW());
  INSERT INTO protean_invoices (invoice_no, alpha, tax_point, net, division, protean_name, site_name) VALUES
    ('TD1','TWODEPOT', fy + 5, 4000.00,'stc','TWO DEPOT HAULAGE','Hyde'),
    ('TD2','TWODEPOT', fy + 6, 6000.00,'stc','TWO DEPOT HAULAGE','Haydock');

  IF (SELECT is_invoicing_type FROM protean_accounts
       WHERE division='stc' AND alpha='TWODEPOT') THEN
    RAISE EXCEPTION 'a real company with two depots was turned into a billing route';
  END IF;

  PERFORM protean_allocate_invoicing_types();

  SELECT COALESCE(SUM(d.net),0) INTO v FROM customer_divisions(normal) d;
  IF v <> 10000.00 THEN
    RAISE EXCEPTION 'the two depot customer reads % and should read 10000, its money was re-filed', v;
  END IF;
  IF (SELECT contact_id FROM protean_accounts WHERE division='stc' AND alpha='TWODEPOT')
     IS DISTINCT FROM normal THEN
    RAISE EXCEPTION 'the two depot customer was unbound from its own account';
  END IF;

  RAISE NOTICE 'cash sales: a route not a customer, allocated, created, reported, no total moved';
END $check$;

ROLLBACK;
