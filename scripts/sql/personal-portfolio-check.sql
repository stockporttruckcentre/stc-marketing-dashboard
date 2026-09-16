-- =============================================================
-- One person's portfolio figures, against real PostgreSQL.
--
-- From the agreed development scope, Task 17:
--
--   pipeline is not presented as booked revenue
--   won work is not still counted as open pipeline
--   Trailer Sales is reported separately from target-bearing personal
--   portfolio revenue
--   no duplicate counting between stock sales and CRM deals
--   person switching fully refreshes every personal panel
-- =============================================================
DO $check$
DECLARE
  rep   UUID := 'cccccccc-0000-0000-0000-000000000001';
  rep2  UUID := 'cccccccc-0000-0000-0000-000000000002';
  boss  UUID := 'cccccccc-0000-0000-0000-000000000003';
  acme  UUID := 'cccccccc-1111-0000-0000-000000000001';
  beta  UUID := 'cccccccc-1111-0000-0000-000000000002';
  fy    DATE := financial_year_of(CURRENT_DATE);
  o     RECORD;
  n     INT;
BEGIN
  ALTER TABLE profiles DISABLE TRIGGER USER;
  INSERT INTO auth.users (id, email) VALUES
    (rep, 'p-rep@stc.example'), (rep2, 'p-rep2@stc.example'), (boss, 'p-boss@stc.example')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO profiles (id, email, full_name, role, is_active) VALUES
    (rep,  'p-rep@stc.example',  'Percy Rep',   'sales', TRUE),
    (rep2, 'p-rep2@stc.example', 'Paula Rep',   'sales', TRUE),
    (boss, 'p-boss@stc.example', 'Mo Director', 'admin', TRUE)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;
  UPDATE profiles SET role_template_id = (SELECT id FROM role_templates WHERE slug = 'sales_rep')
   WHERE id IN (rep, rep2);
  UPDATE profiles SET role_template_id = (SELECT id FROM role_templates WHERE slug = 'managing_director')
   WHERE id = boss;
  ALTER TABLE profiles ENABLE TRIGGER USER;

  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);

  INSERT INTO crm_contacts (id, company_name, status) VALUES
    (acme, 'Acme Haulage', 'customer'),
    (beta, 'Beta Transport', 'lead')
  ON CONFLICT (id) DO UPDATE SET company_name = EXCLUDED.company_name;

  DELETE FROM crm_leads WHERE owner_id IN (rep, rep2);

  INSERT INTO crm_leads (contact_id, owner_id, type, status, estimated_value, sale_price, order_date, what)
  VALUES
    -- Percy: maintenance, open
    (acme, rep,  'maintenance',  'quoted',    40000, NULL, NULL,        'A maintenance quote'),
    -- Percy: maintenance, won this year. Target bearing.
    (acme, rep,  'maintenance',  'customer',  50000, NULL, fy + 30,     'A maintenance contract'),
    -- Percy: an EXISTING CUSTOMER with a NEW OPEN deal. Still pipeline.
    (acme, rep,  'rental',       'contacted', 12000, NULL, NULL,        'A hire enquiry'),
    -- Percy: trailer sale, won this year. NOT target bearing.
    (beta, rep,  'trailer_sales','won',       30000, 33000, fy + 10,    'A trailer'),
    -- Percy: lost. Never pipeline, never revenue.
    (beta, rep,  'maintenance',  'lost',      99000, NULL, NULL,        'One that went elsewhere'),
    -- Percy: won with no agreed date. Counted as a gap, not as revenue.
    (beta, rep,  'maintenance',  'won',       7000,  NULL, NULL,        'Won, no order date'),
    -- Percy: no figure at all.
    (beta, rep,  'maintenance',  'quoted',    NULL,  NULL, NULL,        'Nobody priced it'),
    -- Percy: won LAST year, so outside this financial year.
    (acme, rep,  'maintenance',  'customer',  80000, NULL, fy - 40,     'Last year'),
    -- Paula: her own deal, so Percy must never see it.
    (beta, rep2, 'maintenance',  'customer',  25000, NULL, fy + 5,      'Paula''s');

  -- ---- The headline ----
  SELECT * INTO o FROM personal_overview(rep);

  IF o.target_revenue IS DISTINCT FROM 50000 THEN
    RAISE EXCEPTION 'target bearing revenue is %, wanted 50000 (maintenance won this year only)',
      COALESCE(o.target_revenue::TEXT, 'nothing');
  END IF;
  RAISE NOTICE 'target bearing revenue counts this year''s won work and nothing else';

  IF o.trailer_revenue IS DISTINCT FROM 33000 THEN
    RAISE EXCEPTION 'trailer revenue is %, wanted 33000 at its sale price',
      COALESCE(o.trailer_revenue::TEXT, 'nothing');
  END IF;
  RAISE NOTICE 'and Trailer Sales is reported beside it at its sale price, not added into it';

  IF o.open_pipeline IS DISTINCT FROM 52000 THEN
    RAISE EXCEPTION 'open pipeline is %, wanted 52000 (40000 quoted + 12000 contacted)',
      COALESCE(o.open_pipeline::TEXT, 'nothing');
  END IF;
  RAISE NOTICE 'open pipeline is the open deals only, so a customer with a new enquiry still counts';

  IF o.open_deals <> 3 THEN
    RAISE EXCEPTION 'open deals is %, wanted 3 including the unpriced one', o.open_deals;
  END IF;
  IF o.unpriced <> 1 THEN
    RAISE EXCEPTION 'unpriced is %, wanted 1', o.unpriced;
  END IF;
  RAISE NOTICE 'a deal nobody priced is counted and added to nothing';

  IF o.won_undated <> 1 THEN
    RAISE EXCEPTION 'won with no agreed date is %, wanted 1', o.won_undated;
  END IF;
  RAISE NOTICE 'and a won deal with no agreed date is shown as a gap rather than banked';

  -- ---- Lost is neither ----
  IF o.lost_deals <> 1 THEN RAISE EXCEPTION 'lost deals is %, wanted 1', o.lost_deals; END IF;
  IF o.open_pipeline >= 99000 OR COALESCE(o.target_revenue, 0) >= 99000 THEN
    RAISE EXCEPTION 'the lost 99000 reached pipeline or revenue';
  END IF;
  RAISE NOTICE 'lost work is in neither pipeline nor revenue';

  -- ---- Somebody else's deal is nowhere near it ----
  IF COALESCE(o.target_revenue, 0) >= 75000 THEN
    RAISE EXCEPTION 'Paula''s 25000 is in Percy''s figures';
  END IF;
  SELECT COUNT(*) INTO n FROM personal_pipeline(rep) WHERE lead_type = 'maintenance';
  IF n <> 1 THEN RAISE EXCEPTION 'maintenance came back % times', n; END IF;
  RAISE NOTICE 'and one person''s deals never appear in another''s';

  -- ---- No target, no percentage ----
  IF o.fy_target IS NOT NULL OR o.achieved IS NOT NULL OR o.to_go IS NOT NULL THEN
    RAISE EXCEPTION 'a person with no target got a target, a percentage or a remainder';
  END IF;
  RAISE NOTICE 'with no target there is no percentage and no remainder, rather than zero';

  -- ---- With a target, the arithmetic ----
  PERFORM set_personal_fy_target(rep, 200000);
  SELECT * INTO o FROM personal_overview(rep);
  IF o.fy_target IS DISTINCT FROM 200000 THEN RAISE EXCEPTION 'the target did not arrive'; END IF;
  IF o.achieved IS DISTINCT FROM 25.0 THEN
    RAISE EXCEPTION 'achieved is %, wanted 25.0 (50000 of 200000)', o.achieved;
  END IF;
  IF o.to_go IS DISTINCT FROM 150000 THEN
    RAISE EXCEPTION 'to go is %, wanted 150000', o.to_go;
  END IF;
  RAISE NOTICE 'against a target the percentage and the remainder are the target bearing figure';

  -- ---- The ladder, again, on the figures themselves ----
  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);
  SELECT COUNT(*) INTO n FROM personal_overview(rep2);
  IF n <> 0 THEN
    RAISE EXCEPTION 'A REP READ ANOTHER REP''S OVERVIEW. % row(s) came back.', n;
  END IF;
  SELECT COUNT(*) INTO n FROM personal_pipeline(rep2);
  IF n <> 0 THEN
    RAISE EXCEPTION 'A REP READ ANOTHER REP''S PIPELINE. % row(s) came back.', n;
  END IF;
  RAISE NOTICE 'a rep asking for a colleague''s figures gets no rows, not a zero';

  -- ---- Switching person changes every figure ----
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);
  SELECT * INTO o FROM personal_overview(rep2);
  IF o.target_revenue IS DISTINCT FROM 25000 THEN
    RAISE EXCEPTION 'Paula''s revenue is %, wanted 25000', COALESCE(o.target_revenue::TEXT, 'nothing');
  END IF;
  IF o.person_id <> rep2 OR o.full_name <> 'Paula Rep' THEN
    RAISE EXCEPTION 'the overview came back about the wrong person';
  END IF;
  RAISE NOTICE 'switching person switches the figures, and the row says whose they are';

  -- =============================================================
  -- Movers, and the leak the scope names.
  --
  --   no company-wide mover leaks into a personal view incorrectly
  --
  -- Gamma is nobody's portfolio and moves by more than anything in
  -- Percy's. If the ranking happens before the narrowing, Gamma is top
  -- of Percy's list. That is the fault, so it is the fixture.
  -- =============================================================
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);

  INSERT INTO crm_contacts (id, company_name, status)
  VALUES ('cccccccc-1111-0000-0000-000000000003', 'Gamma Freight', 'customer')
  ON CONFLICT (id) DO UPDATE SET company_name = EXCLUDED.company_name;

  INSERT INTO protean_accounts (alpha, protean_name, division, contact_id, ignored)
  VALUES ('ACME01', 'Acme Haulage', 'stc', acme, FALSE),
         ('BETA01', 'Beta Transport', 'stc', beta, FALSE),
         ('GAMM01', 'Gamma Freight', 'stc', 'cccccccc-1111-0000-0000-000000000003', FALSE)
  ON CONFLICT DO NOTHING;

  INSERT INTO protean_invoices (invoice_no, alpha, tax_point, net, division) VALUES
    -- Acme, up 9000 this year
    ('P-A-1', 'ACME01', fy + 20,                          12000, 'stc'),
    ('P-A-0', 'ACME01', (fy - INTERVAL '1 year')::DATE + 20, 3000, 'stc'),
    -- Beta, down 4000
    ('P-B-1', 'BETA01', fy + 20,                           1000, 'stc'),
    ('P-B-0', 'BETA01', (fy - INTERVAL '1 year')::DATE + 20, 5000, 'stc'),
    -- Gamma, up 500000, and in nobody's portfolio
    ('P-G-1', 'GAMM01', fy + 20,                         520000, 'stc'),
    ('P-G-0', 'GAMM01', (fy - INTERVAL '1 year')::DATE + 20, 20000, 'stc')
  ON CONFLICT DO NOTHING;

  SELECT COUNT(*) INTO n FROM personal_movers(rep, NULL, 10)
   WHERE company_name = 'Gamma Freight';
  IF n > 0 THEN
    RAISE EXCEPTION
      'Gamma Freight is in Percy''s movers and he owns no deal against them. '
      'The ranking is happening before the portfolio narrows it.';
  END IF;
  RAISE NOTICE 'a company wide mover outside the portfolio does not leak into it';

  SELECT COUNT(*) INTO n FROM personal_movers(rep, NULL, 10);
  IF n <> 2 THEN
    RAISE EXCEPTION 'Percy has % movers, wanted 2 (Acme up, Beta down)', n;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM personal_movers(rep, NULL, 10)
                  WHERE company_name = 'Acme Haulage' AND change = 9000) THEN
    RAISE EXCEPTION 'Acme is not up by 9000 in Percy''s movers';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM personal_movers(rep, NULL, 10)
                  WHERE company_name = 'Beta Transport' AND change = -4000) THEN
    RAISE EXCEPTION 'Beta is not down by 4000 in Percy''s movers';
  END IF;
  RAISE NOTICE 'and both ends of the portfolio are there, the riser and the faller';

  -- The movers change with the person, and the ladder still holds.
  SELECT COUNT(*) INTO n FROM personal_movers(rep2, NULL, 10);
  IF n <> 1 THEN
    RAISE EXCEPTION 'Paula has % movers, wanted 1 (Beta only)', n;
  END IF;
  RAISE NOTICE 'the movers change when the person changes';

  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);
  SELECT COUNT(*) INTO n FROM personal_movers(rep2, NULL, 10);
  IF n <> 0 THEN
    RAISE EXCEPTION 'a rep read another rep''s movers';
  END IF;
  RAISE NOTICE 'and a rep asking for a colleague''s movers gets none';

  RAISE NOTICE 'the portfolio figures hold';
END
$check$;
