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
  gamma UUID := 'cccccccc-1111-0000-0000-000000000003';
  fy    DATE := financial_year_of(CURRENT_DATE);
  o     RECORD;
  rv    RECORD;
  n     INT;
  m     INT;
  k     INT;
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
    (acme, 'Acme Haulage', 'won'),
    (beta, 'Beta Transport', 'lead')
  ON CONFLICT (id) DO UPDATE SET company_name = EXCLUDED.company_name;

  DELETE FROM crm_leads WHERE owner_id IN (rep, rep2);

  INSERT INTO crm_leads (contact_id, owner_id, type, status, estimated_value, sale_price, order_date, what)
  VALUES
    -- Percy: maintenance, open
    (acme, rep,  'maintenance',  'quoted',    40000, NULL, NULL,        'A maintenance quote'),
    -- Percy: maintenance, won this year. Target bearing.
    (acme, rep,  'maintenance',  'won',  50000, NULL, fy + 30,     'A maintenance contract'),
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
    (acme, rep,  'maintenance',  'won',  80000, NULL, fy - 40,     'Last year'),
    -- Paula: her own deal, so Percy must never see it.
    (beta, rep2, 'maintenance',  'won',  25000, NULL, fy + 5,      'Paula''s');

  -- ---- The headline ----
  SELECT * INTO o FROM personal_overview(rep);

  /* ---- THE TARGET IS WHAT THE BOOK GREW BY. Migration 160. ----

     From the business:

       You, yourself, should be EXTREMELY concerned that you have one
       card saying he's made 256k and another saying only 52k, that
       should make you want to stop everything and fix this because
       that's literally paying dean's commission.

     Two cards on one screen, about one person, £204,000 apart, and the
     smaller one was what a commission got paid against. The target is
     no longer won work on the tracker: it is what this person's
     customers were billed above the same point last year, which is the
     figure the panel already drew.

     So the assertion is not a number typed here. It is that the two
     cards are THE SAME NUMBER, which is the only thing that can stop
     them drifting apart again. */
  SELECT * INTO rv FROM personal_revenue_year(rep);

  IF o.target_revenue IS DISTINCT FROM rv.change THEN
    RAISE EXCEPTION
      'Towards target says % and the revenue panel says %. They are one number.',
      COALESCE(o.target_revenue::TEXT, 'nothing'), COALESCE(rv.change::TEXT, 'nothing');
  END IF;

  IF o.invoiced_this_year IS DISTINCT FROM rv.this_year
     OR o.invoiced_last_year IS DISTINCT FROM rv.last_year THEN
    RAISE EXCEPTION 'the two halves of the target figure do not match the panel';
  END IF;

  IF o.achieved IS DISTINCT FROM ROUND((rv.change / o.fy_target) * 100, 1) THEN
    RAISE EXCEPTION 'achieved is %, and the change over the target is %',
      COALESCE(o.achieved::TEXT, 'nothing'),
      ROUND((rv.change / o.fy_target) * 100, 1)::TEXT;
  END IF;

  IF o.to_go IS DISTINCT FROM ROUND(o.fy_target - rv.change, 2) THEN
    RAISE EXCEPTION 'what is left to find does not agree with the target and the change';
  END IF;

  /* Won work on the tracker is still reported, and is no longer what
     the target is measured on. 50,000 is the maintenance deal won this
     year in the fixture; the trailer sale, the lost one, the undated
     one and last year's are all correctly out of it. */
  IF o.tracker_revenue IS DISTINCT FROM 50000 THEN
    RAISE EXCEPTION 'work closed on the tracker is %, wanted 50000', 
      COALESCE(o.tracker_revenue::TEXT, 'nothing');
  END IF;

  RAISE NOTICE 'the target is what the book grew by, and the two cards are one number';

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
  IF o.open_pipeline >= 99000 OR COALESCE(o.tracker_revenue, 0) >= 99000 THEN
    RAISE EXCEPTION 'the lost 99000 reached pipeline or closed work';
  END IF;
  RAISE NOTICE 'lost work is in neither pipeline nor revenue';

  -- ---- Somebody else's deal is nowhere near it ----
  IF COALESCE(o.tracker_revenue, 0) >= 75000 THEN
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
  --
  -- On the CHANGE, not on won work. Migration 160: the target is what
  -- the book billed above the same point last year, so the percentage
  -- and the remainder are worked out from that and from nothing else.
  PERFORM set_personal_fy_target(rep, 200000);
  SELECT * INTO o  FROM personal_overview(rep);
  SELECT * INTO rv FROM personal_revenue_year(rep);
  IF o.fy_target IS DISTINCT FROM 200000 THEN RAISE EXCEPTION 'the target did not arrive'; END IF;
  IF o.achieved IS DISTINCT FROM ROUND((rv.change / 200000) * 100, 1) THEN
    RAISE EXCEPTION 'achieved is %, and the change over the target is %',
      COALESCE(o.achieved::TEXT, 'nothing'), ROUND((rv.change / 200000) * 100, 1)::TEXT;
  END IF;
  IF o.to_go IS DISTINCT FROM ROUND(200000 - rv.change, 2) THEN
    RAISE EXCEPTION 'to go is %, and the target less the change is %',
      COALESCE(o.to_go::TEXT, 'nothing'), ROUND(200000 - rv.change, 2)::TEXT;
  END IF;
  RAISE NOTICE 'against a target the percentage and the remainder are worked out from the change';

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
  /* Her CLOSED work, because the target figure is now the change on
     her book and this fixture gives her no invoices. What matters here
     is that switching person changes every figure. */
  IF o.tracker_revenue IS DISTINCT FROM 25000 THEN
    RAISE EXCEPTION 'Paula''s closed work is %, wanted 25000', COALESCE(o.tracker_revenue::TEXT, 'nothing');
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
  VALUES ('cccccccc-1111-0000-0000-000000000003', 'Gamma Freight', 'won')
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

  -- ---------------------------------------------------------
  -- THE FOUR THINGS ASKED FOR NEXT. Migration 148.
  -- ---------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);

  /* "make it so you can click 'open' or 'won' or 'lost' pills and see a
     list of those records"

     The list has to agree with the number on the pill, so both are
     read here and compared rather than counted by hand. */
  SELECT open_count, won_count, lost_count INTO n, m, k
    FROM personal_pipeline(rep) WHERE lead_type = 'maintenance';

  IF (SELECT COUNT(*) FROM personal_deals(rep, 'maintenance', 'open')) <> n THEN
    RAISE EXCEPTION 'the open list and the open pill disagree: % against %',
      (SELECT COUNT(*) FROM personal_deals(rep, 'maintenance', 'open')), n;
  END IF;
  IF (SELECT COUNT(*) FROM personal_deals(rep, 'maintenance', 'won')) <> m THEN
    RAISE EXCEPTION 'the won list and the won pill disagree: % against %',
      (SELECT COUNT(*) FROM personal_deals(rep, 'maintenance', 'won')), m;
  END IF;
  IF (SELECT COUNT(*) FROM personal_deals(rep, 'maintenance', 'lost')) <> k THEN
    RAISE EXCEPTION 'the lost list and the lost pill disagree';
  END IF;

  /* The win with no order date is in neither the pill nor the list.
     It is counted separately, as a gap, which is the whole point. */
  IF EXISTS (SELECT 1 FROM personal_deals(rep, 'maintenance', 'won')
              WHERE what = 'Won, no order date') THEN
    RAISE EXCEPTION 'an undated win is in the won list but not in the won count';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM personal_deals(rep, 'maintenance', 'lost')
                  WHERE what = 'One that went elsewhere') THEN
    RAISE EXCEPTION 'the lost deal is not in the lost list';
  END IF;

  BEGIN
    PERFORM COUNT(*) FROM personal_deals(rep, 'maintenance', 'somewhere else');
    RAISE EXCEPTION 'a state that does not exist was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%does not exist%' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);
  IF EXISTS (SELECT 1 FROM personal_deals(rep2, 'maintenance', 'won')) THEN
    RAISE EXCEPTION 'a rep read a colleague''s deals through the pill list';
  END IF;
  RAISE NOTICE 'the pills open a list that adds up to the pill, and not a colleague''s';

  /* "a list like the revenue tab of customers and their revenue. limit
     to 20 rows with scrolling." */
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);
  SELECT COUNT(*) INTO n FROM personal_customers(rep, NULL, 20, 0);
  IF n <> 2 THEN
    RAISE EXCEPTION 'Percy has % customers on the list, wanted 2', n;
  END IF;

  /* Every row carries how many there are, so the screen can say "20 of
     37" without asking twice. */
  IF (SELECT DISTINCT total_rows FROM personal_customers(rep, NULL, 1, 0)) <> 2 THEN
    RAISE EXCEPTION 'the row count does not survive the limit';
  END IF;

  /* And the second page is the second page, not the first again. */
  IF (SELECT contact_id FROM personal_customers(rep, NULL, 1, 0))
   = (SELECT contact_id FROM personal_customers(rep, NULL, 1, 1)) THEN
    RAISE EXCEPTION 'scrolling past the first row shows the first row again';
  END IF;

  /* The figures are the same figures the movers panel shows. Two
     answers to one question is how a screen stops being believed. */
  IF (SELECT this_year FROM personal_customers(rep, NULL, 20, 0) WHERE contact_id = acme)
   IS DISTINCT FROM (SELECT this_year FROM personal_movers(rep, NULL, 10) WHERE contact_id = acme) THEN
    RAISE EXCEPTION 'the customer list and the movers disagree about Acme';
  END IF;

  /* Their open work is on the row, because "who owes me a decision" is
     asked in the same breath as "what do they spend". */
  IF (SELECT open_deals FROM personal_customers(rep, NULL, 20, 0) WHERE contact_id = acme) <> 2 THEN
    RAISE EXCEPTION 'Acme''s two open deals are not on their row';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);
  IF EXISTS (SELECT 1 FROM personal_customers(rep2, NULL, 20, 0)) THEN
    RAISE EXCEPTION 'a rep read a colleague''s customer list';
  END IF;
  RAISE NOTICE 'the customer list scrolls, counts itself, and agrees with the movers';

  /* "can click into a customer and see their broken down revenue" */
  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);
  IF (SELECT ROUND(SUM(this_year), 2) FROM personal_customer_breakdown(rep, acme)
       WHERE grain = 'division')
   IS DISTINCT FROM (SELECT this_year FROM personal_customers(rep, NULL, 20, 0)
                      WHERE contact_id = acme) THEN
    RAISE EXCEPTION 'the parts do not add up to the whole for Acme';
  END IF;
  IF (SELECT ROUND(SUM(this_year), 2) FROM personal_customer_breakdown(rep, acme)
       WHERE grain = 'month')
   IS DISTINCT FROM (SELECT this_year FROM personal_customers(rep, NULL, 20, 0)
                      WHERE contact_id = acme) THEN
    RAISE EXCEPTION 'the months do not add up to the year for Acme';
  END IF;

  /* A customer who is not theirs has no breakdown to read, whoever asks
     for it. Seeing one portfolio is not permission to read any
     customer's spend by passing an id. */
  IF EXISTS (SELECT 1 FROM personal_customer_breakdown(rep, gamma)) THEN
    RAISE EXCEPTION 'a customer outside the portfolio was broken down anyway';
  END IF;
  RAISE NOTICE 'a customer breaks down by division and by month, and the parts add up';

  /* "biggest gainers should only show maintenance, rental, or both" */
  IF EXISTS (SELECT 1 FROM personal_movers(rep, NULL, 10, 'rental')) THEN
    RAISE EXCEPTION 'a division nobody was billed under still produced movers';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM personal_movers(rep, NULL, 10, 'stc')
                  WHERE company_name = 'Acme Haulage') THEN
    RAISE EXCEPTION 'filtering to maintenance lost the customer billed under it';
  END IF;
  IF (SELECT COUNT(*) FROM personal_movers(rep, NULL, 10, NULL))
   < (SELECT COUNT(*) FROM personal_movers(rep, NULL, 10, 'stc')) THEN
    RAISE EXCEPTION 'both divisions found fewer movers than one of them';
  END IF;
  BEGIN
    PERFORM COUNT(*) FROM personal_movers(rep, NULL, 10, 'not a division');
    RAISE EXCEPTION 'a division that does not exist was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%does not exist%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'the movers filter to one division or to both, and refuse a third';

  RAISE NOTICE 'the portfolio figures hold';
END
$check$;
