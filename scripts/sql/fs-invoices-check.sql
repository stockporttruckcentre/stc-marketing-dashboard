-- =============================================================
-- Which invoices are the contract. Asked, not guessed.
--
-- From the business:
--
--   you already know what the month FS+ charge will be against an
--   accepted contract, you need a checker that listens to invoices at
--   the same value for the same customer and it can ask me if the
--   invoice is contractual or not. It could come from any of the 3
--   divisions but 75% of the time it'll be STC
--
-- Run with `npm run check:fs-invoices`.
-- =============================================================
\set ON_ERROR_STOP on
BEGIN;

DO $check$
DECLARE
  boss UUID := 'cafe0000-0000-0000-0000-000000000001';
  rep  UUID := 'cafe0000-0000-0000-0000-000000000002';
  cust UUID; other UUID; con UUID;
  fy   DATE := financial_year_of(CURRENT_DATE);
  o    RECORD; r RECORD; n INT;
BEGIN
  ALTER TABLE profiles DISABLE TRIGGER USER;
  INSERT INTO auth.users (id, email) VALUES
    (boss,'fs-boss@stc.example'), (rep,'fs-rep@stc.example') ON CONFLICT DO NOTHING;
  INSERT INTO profiles (id, email, full_name, role, is_active) VALUES
    (boss,'fs-boss@stc.example','Mo Director','admin',TRUE),
    (rep, 'fs-rep@stc.example', 'Dean Rep',   'sales',TRUE)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;
  UPDATE profiles SET role_template_id=(SELECT id FROM role_templates WHERE slug='managing_director') WHERE id=boss;
  UPDATE profiles SET role_template_id=(SELECT id FROM role_templates WHERE slug='sales_rep') WHERE id=rep;
  ALTER TABLE profiles ENABLE TRIGGER USER;
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);

  DELETE FROM fleetsmart_invoice_links; DELETE FROM fleetsmart_contracts;
  DELETE FROM protean_invoices; DELETE FROM protean_accounts; DELETE FROM crm_leads;

  INSERT INTO crm_contacts (company_name) VALUES ('Contract Haulage') RETURNING id INTO cust;
  INSERT INTO crm_contacts (company_name) VALUES ('Someone Else Ltd') RETURNING id INTO other;

  PERFORM set_personal_fy_target(rep, 600000, NULL, 'the number');

  /* Built the way the app builds one: annual_total and monthly_total
     are derived from `priced` by trg_fleetsmart_totals, so writing
     them directly would be testing a row production cannot produce. */
  INSERT INTO fleetsmart_contracts
    (ref, customer_name, account_id, owner_id, status, priced,
     term_months, starts_on, sent_at, decided_at)
  VALUES ('FS-001','Contract Haulage', cust, rep, 'accepted',
          '{"annual": 20000.04, "monthly": 1666.67, "assets": []}'::JSONB,
          36, fy, NOW(), (fy + 2)::TIMESTAMPTZ)
  RETURNING id INTO con;

  /* And the derivation itself, because everything below leans on it. */

  IF (SELECT monthly_total FROM fleetsmart_contracts WHERE id = con) <> 1666.67 THEN
    RAISE EXCEPTION 'the contract''s monthly figure did not come through from priced';
  END IF;

  INSERT INTO protean_accounts (division, alpha, protean_name, contact_id, last_seen) VALUES
    ('stc',    'CH01', 'CONTRACT HAULAGE', cust,  NOW()),
    ('rental', 'CH02', 'CONTRACT HAULAGE', cust,  NOW()),
    ('stc',    'SE01', 'SOMEONE ELSE',     other, NOW());

  INSERT INTO protean_invoices (invoice_no, alpha, tax_point, net, division) VALUES
    ('DD001','CH01', fy + 10, 1666.67,'stc'),      -- the direct debit
    ('DD002','CH01', fy + 40, 1666.67,'stc'),      -- next month
    ('DD003','CH02', fy + 70, 1666.67,'rental'),   -- another division, still a candidate
    ('ADH01','CH01', fy + 12,  845.00,'stc'),      -- ad hoc work, not the value
    ('SE001','SE01', fy + 10, 1666.67,'stc');      -- same value, WRONG customer

  -- ---------------------------------------------------------
  -- 1. The queue finds the three matching, across divisions, and
  --    leaves out the ad hoc one and the other customer's.
  -- ---------------------------------------------------------
  SELECT count(*) INTO n FROM fleetsmart_candidates(rep, 0.01);
  IF n <> 3 THEN RAISE EXCEPTION '% candidates, wanted 3', n; END IF;

  IF EXISTS (SELECT 1 FROM fleetsmart_candidates(rep, 0.01) WHERE invoice_no = 'ADH01') THEN
    RAISE EXCEPTION 'ad hoc work at a different value was offered'; END IF;
  IF EXISTS (SELECT 1 FROM fleetsmart_candidates(rep, 0.01) WHERE invoice_no = 'SE001') THEN
    RAISE EXCEPTION 'another customer''s invoice was offered'; END IF;
  IF NOT EXISTS (SELECT 1 FROM fleetsmart_candidates(rep, 0.01)
                  WHERE division = 'rental' AND invoice_no = 'DD003') THEN
    RAISE EXCEPTION 'the rental division invoice was missed'; END IF;

  -- STC first, because three in four are.
  SELECT * INTO r FROM fleetsmart_candidates(rep, 0.01) LIMIT 1;
  IF r.division <> 'stc' THEN
    RAISE EXCEPTION 'the queue starts with % rather than stc', r.division; END IF;

  -- ---------------------------------------------------------
  -- 2. NOTHING COUNTS UNTIL SOMEBODY SAYS SO.
  -- ---------------------------------------------------------
  SELECT * INTO o FROM personal_overview(rep, CURRENT_DATE);
  IF COALESCE(o.fs_value_invoiced, 0) <> 0 THEN
    RAISE EXCEPTION 'unanswered candidates were counted as %', o.fs_value_invoiced; END IF;
  IF o.fs_waiting <> 3 THEN
    RAISE EXCEPTION 'the screen says % waiting, wanted 3', o.fs_waiting; END IF;
  IF o.fs_value_won <> 60000.12 THEN
    RAISE EXCEPTION 'value won reads % and should be the term 60000.12', o.fs_value_won; END IF;

  -- ---------------------------------------------------------
  -- 3. Say yes to one. Only that one counts, and it leaves the queue.
  -- ---------------------------------------------------------
  PERFORM fleetsmart_answer_invoice(con, 'stc', 'DD001', TRUE);
  SELECT * INTO o FROM personal_overview(rep, CURRENT_DATE);
  IF o.fs_value_invoiced <> 1666.67 THEN
    RAISE EXCEPTION 'value invoiced reads % after one yes', o.fs_value_invoiced; END IF;
  IF o.fs_waiting <> 2 THEN
    RAISE EXCEPTION '% still waiting, wanted 2', o.fs_waiting; END IF;
  IF o.target_revenue <> 1666.67 THEN
    RAISE EXCEPTION 'the target reads % and should read 1666.67', o.target_revenue; END IF;
  IF NOT o.fs_contract_only THEN
    RAISE EXCEPTION 'the figure still claims to include ad hoc work'; END IF;

  -- ---------------------------------------------------------
  -- 4. Say NO to one. It counts nothing and is never asked again.
  -- ---------------------------------------------------------
  PERFORM fleetsmart_answer_invoice(con, 'rental', 'DD003', FALSE);
  SELECT * INTO o FROM personal_overview(rep, CURRENT_DATE);
  IF o.fs_value_invoiced <> 1666.67 THEN
    RAISE EXCEPTION 'a no changed the figure to %', o.fs_value_invoiced; END IF;
  IF o.fs_waiting <> 1 THEN
    RAISE EXCEPTION '% waiting after a no, wanted 1', o.fs_waiting; END IF;
  IF EXISTS (SELECT 1 FROM fleetsmart_candidates(rep, 0.01) WHERE invoice_no = 'DD003') THEN
    RAISE EXCEPTION 'an answered invoice is being asked about again'; END IF;

  -- ---------------------------------------------------------
  -- 5. Answer the rest in one go.
  -- ---------------------------------------------------------
  SELECT fleetsmart_answer_all(con, TRUE, 0.01) INTO n;
  IF n <> 1 THEN RAISE EXCEPTION '% answered in bulk, wanted 1', n; END IF;
  SELECT * INTO o FROM personal_overview(rep, CURRENT_DATE);
  IF o.fs_value_invoiced <> 3333.34 THEN
    RAISE EXCEPTION 'value invoiced reads % and should read 3333.34', o.fs_value_invoiced; END IF;
  IF o.fs_waiting <> 0 THEN
    RAISE EXCEPTION '% still waiting after answering all', o.fs_waiting; END IF;

  -- ---------------------------------------------------------
  -- 6. An answer can be changed, and the figure follows.
  -- ---------------------------------------------------------
  PERFORM fleetsmart_answer_invoice(con, 'stc', 'DD002', FALSE);
  SELECT * INTO o FROM personal_overview(rep, CURRENT_DATE);
  IF o.fs_value_invoiced <> 1666.67 THEN
    RAISE EXCEPTION 'changing an answer left the figure at %', o.fs_value_invoiced; END IF;

  -- ---------------------------------------------------------
  -- 7. A read only viewer cannot answer.
  -- ---------------------------------------------------------
  /* Demoted BY THE ADMINISTRATOR, then signed in as them. Doing it the
     other way round is refused by guard_profile_privileges, which is
     correct and is not what this case is testing. */
  UPDATE profiles SET role_template_id = (SELECT id FROM role_templates WHERE slug = 'viewer')
   WHERE id = rep;
  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);
  BEGIN
    PERFORM fleetsmart_answer_invoice(con, 'stc', 'DD002', TRUE);
    RAISE EXCEPTION 'a viewer answered the queue';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'a viewer answered the queue' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'fs invoices: asked across three divisions, stc first, and nothing counts unanswered';
END $check$;

ROLLBACK;
