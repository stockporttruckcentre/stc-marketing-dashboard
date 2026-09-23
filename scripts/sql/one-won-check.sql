-- =============================================================
-- ONE WON, NOT TWO.
--
-- From the business:
--
--   when marking a sales tracker record as Won (just closed) it doesn't
--   seem to do much. Then we have a status for Customer, which means
--   won anyway. We only need 1 status, Won. This then assumes the
--   company is now a customer of ours so anywhere else in the app
--   tracking who our customers are will pick this up.
--
-- Run with `npm run check:one-won`.
-- =============================================================
\set ON_ERROR_STOP on
BEGIN;

DO $check$
DECLARE
  rep  UUID := 'ee331111-0000-0000-0000-000000000001';
  cust UUID; other UUID; deal UUID; second UUID;
  n INT; said TEXT; r RECORD;
BEGIN
  ALTER TABLE profiles DISABLE TRIGGER USER;
  INSERT INTO auth.users (id, email) VALUES (rep,'ow-rep@stc.example')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO profiles (id, email, full_name, role, is_active)
  VALUES (rep, 'ow-rep@stc.example', 'Wendy Won', 'sales', TRUE)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;
  UPDATE profiles SET role_template_id=(SELECT id FROM role_templates WHERE slug='sales_rep') WHERE id=rep;
  ALTER TABLE profiles ENABLE TRIGGER USER;
  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);

  -- ---------------------------------------------------------
  -- 1. THE WORD IS REFUSED. This is the whole guarantee: nothing
  --    can put a row back in the state half the screens ignored.
  -- ---------------------------------------------------------
  INSERT INTO crm_contacts (company_name) VALUES ('Dawson Group') RETURNING id INTO cust;
  BEGIN
    INSERT INTO crm_leads (company_name, contact_id, owner_id, created_by, type, status)
    VALUES ('Dawson Group', cust, rep, rep, 'trailer_sales', 'customer');
    RAISE EXCEPTION 'a lead was written at the old customer status';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE crm_contacts SET status = 'customer' WHERE id = cust;
    RAISE EXCEPTION 'an account was written at the old customer status';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ---------------------------------------------------------
  -- 2. WINNING MAKES THEM A CUSTOMER, WITHOUT BEING ASKED.
  --
  --    "This then assumes the company is now a customer of ours so
  --    anywhere else in the app tracking who our customers are will
  --    pick this up."
  -- ---------------------------------------------------------
  INSERT INTO crm_leads (company_name, contact_id, owner_id, created_by, type, status,
                         estimated_value, sale_price, order_date)
  VALUES ('Dawson Group', cust, rep, rep, 'trailer_sales', 'quoted', 31000, NULL, NULL)
  RETURNING id INTO deal;

  SELECT relationship INTO said FROM crm_contacts WHERE id = cust;
  IF said = 'existing' THEN RAISE EXCEPTION 'a quote alone made them a customer'; END IF;

  UPDATE crm_leads SET status = 'won', sale_price = 29000, order_date = CURRENT_DATE
   WHERE id = deal;

  SELECT status, relationship INTO r FROM crm_contacts WHERE id = cust;
  IF r.status <> 'won' THEN
    RAISE EXCEPTION 'winning the deal left the account at %', r.status;
  END IF;
  IF r.relationship <> 'existing' THEN
    RAISE EXCEPTION 'winning the deal left them a %, so nothing tracking customers picks them up', r.relationship;
  END IF;

  -- And it is never taken back off them by a later loss.
  UPDATE crm_leads SET status = 'lost' WHERE id = deal;
  SELECT relationship INTO said FROM crm_contacts WHERE id = cust;
  IF said <> 'existing' THEN
    RAISE EXCEPTION 'a later loss un-customered a company we have traded with';
  END IF;
  UPDATE crm_leads SET status = 'won' WHERE id = deal;

  -- ---------------------------------------------------------
  -- 3. AN ACCOUNT ALREADY AT THE RIGHT STATUS IS STILL CORRECTED.
  --
  --    The old trigger only wrote when the STATUS changed, so a
  --    company sitting at the right status whose relationship still
  --    said prospect was never fixed.
  -- ---------------------------------------------------------
  UPDATE crm_contacts SET relationship = 'prospect' WHERE id = cust;
  INSERT INTO crm_leads (company_name, contact_id, owner_id, created_by, type, status)
  VALUES ('Dawson Group', cust, rep, rep, 'maintenance', 'won') RETURNING id INTO second;
  SELECT relationship INTO said FROM crm_contacts WHERE id = cust;
  IF said <> 'existing' THEN
    RAISE EXCEPTION 'the relationship was left at % because the status had not moved', said;
  END IF;

  -- ---------------------------------------------------------
  -- 4. A FRESH ENQUIRY AGAINST A CUSTOMER IS A LEAD, NOT A WIN.
  --
  --    Under two statuses a new deal for a customer account started at
  --    'customer', which read as already won. Under one that would put
  --    unearned money on somebody's tracker.
  -- ---------------------------------------------------------
  PERFORM command_tracker_from_crm(ARRAY[cust], 'rental', NULL);
  SELECT status INTO said FROM crm_leads
   WHERE contact_id = cust AND type = 'rental'
   ORDER BY created_at DESC LIMIT 1;
  IF said <> 'lead' THEN
    RAISE EXCEPTION 'a new enquiry against a customer started at %', said;
  END IF;

  -- A duplicate of a won deal does not start won either.
  PERFORM command_duplicate_deal(ARRAY[deal]);
  SELECT count(*) INTO n FROM crm_leads
   WHERE contact_id = cust AND type = 'trailer_sales' AND status = 'won';
  IF n <> 1 THEN RAISE EXCEPTION 'duplicating a won deal produced % won deals', n; END IF;

  -- ---------------------------------------------------------
  -- 5. AND THE FIGURES COUNT IT.
  --
  --    The reported fault: "marking a record as Won doesn't seem to do
  --    much". Every one of these read the OTHER status.
  -- ---------------------------------------------------------
  SELECT COALESCE(SUM(leads_won), 0)::INT INTO n FROM sales_by_person(NULL);
  IF n < 2 THEN
    RAISE EXCEPTION 'sales_by_person counts % won deal(s), not the two that were won', n;
  END IF;

  SELECT lead_worth('won', 29000, 31000)::INT INTO n;
  IF n <> 29000 THEN
    RAISE EXCEPTION 'a won deal is worth % rather than what was agreed', n;
  END IF;

  /* And the ones still being chased are the ones still being chased.
     A won deal in the pipeline figure is money counted twice. */
  SELECT COALESCE(SUM(leads_open), 0)::INT INTO n FROM sales_by_person(NULL);
  /* The rental enquiry and the duplicate, and neither of the two that
     were won. Four leads, two of them finished. */
  IF n <> 2 THEN
    RAISE EXCEPTION 'the open count is %, so a finished deal is still in the pipeline', n;
  END IF;

  -- ---------------------------------------------------------
  -- 6. NOTHING LIVE STILL KNOWS THE OLD WORD.
  -- ---------------------------------------------------------
  SELECT count(*) INTO n
    FROM pg_proc p
    JOIN pg_namespace s ON s.oid = p.pronamespace
    CROSS JOIN LATERAL regexp_split_to_table(p.prosrc, E'\n') l
   WHERE s.nspname = 'public'
     AND l LIKE '%''customer''%'
     AND l NOT LIKE '%charge_to%'
     AND l NOT LIKE '%jsonb_build_object%'
     AND l NOT LIKE '%''customer'',      v_customer,%'
     AND l NOT LIKE '%''customer'', held.customer_name,%'
     AND l NOT LIKE '%--%'
     AND l NOT LIKE '%t.rate, ''customer''%';
  IF n > 0 THEN
    RAISE EXCEPTION '% live function line(s) still name the customer status', n;
  END IF;

  RAISE NOTICE 'one won: the old status is refused, winning makes a customer, and every figure counts it';
END $check$;

ROLLBACK;
