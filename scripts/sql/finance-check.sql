-- =============================================================
-- What finance takes into the meeting.
--
-- From the business:
--
--   There's not enough information on that analytics hub for our
--   finance team to go in a meeting with the MD and be able to outline
--   everything happening in the company.
--
-- Seven functions were added for that. Each one is a sentence somebody
-- will say out loud in a board meeting, and the cost of any of them
-- being wrong is a number nobody can defend in front of the person who
-- runs the company.
--
-- ---- What this is actually hunting for ----
--
-- Not "does it return rows". The failures that matter here are the ones
-- that return a plausible number:
--
--   1. A figure counted twice, because a trailer sale has a lead
--      against it and both got added.
--   2. Money on an unplaced account dropping silently out of a total,
--      so the reconciliation does not reconcile.
--   3. A percentage printed where there was nothing to grow from, so
--      "new customer" reads as an infinite rise.
--   4. A year boundary crossed by one day.
--   5. An empty band missing from a funnel, so a stage nobody is at
--      looks like a stage that does not exist.
--   6. One division's money in another division's row.
--
-- Every total below is asserted against a figure worked out from the
-- fixtures a different way, not against a number typed in by hand. That
-- rule exists because the last three times I typed the expected figure
-- myself, the function was right and my arithmetic was wrong.
--
-- Run with `npm run check:finance`.
-- =============================================================
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'fin.admin@example.test'),
  ('b0000000-0000-0000-0000-000000000002', 'dave@example.test')
ON CONFLICT DO NOTHING;
UPDATE profiles SET role = 'admin', role_template_id = NULL, full_name = 'Finance Admin'
 WHERE id = 'b0000000-0000-0000-0000-000000000001';
UPDATE profiles SET role = 'sales', role_template_id = NULL, full_name = 'Dave Sellers'
 WHERE id = 'b0000000-0000-0000-0000-000000000002';

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_who UUID) RETURNS VOID
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_who::TEXT, ''), TRUE);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
END;
$fn$;

/* Read at 1 August 2026 throughout, so the year running began 1 April
   2026 and the comparison is the same point in the year from April
   2025. Every date below was chosen against that. */

-- Three customers with records, one account nobody has placed, and one
-- account deliberately set aside. The last two are the reconciliation.
INSERT INTO crm_contacts (id, company_name, source, status) VALUES
  ('b1000000-0000-0000-0000-000000000001', 'Bigfoot Logistics Ltd', 'protean', 'customer'),
  ('b1000000-0000-0000-0000-000000000002', 'Middleton Transport Ltd', 'protean', 'customer'),
  ('b1000000-0000-0000-0000-000000000003', 'Newstart Haulage Ltd', 'protean', 'customer')
ON CONFLICT (id) DO NOTHING;

INSERT INTO protean_accounts (division, alpha, protean_name, contact_id, bound_at, ignored) VALUES
  ('stc',    'BIGFOOT',  'Bigfoot Logistics Ltd',   'b1000000-0000-0000-0000-000000000001', NOW(), FALSE),
  ('rental', 'BIGFOOT',  'Bigfoot Logistics Ltd',   'b1000000-0000-0000-0000-000000000001', NOW(), FALSE),
  ('stc',    'MIDDLE',   'Middleton Transport Ltd', 'b1000000-0000-0000-0000-000000000002', NOW(), FALSE),
  ('stc',    'NEWSTART', 'Newstart Haulage Ltd',    'b1000000-0000-0000-0000-000000000003', NOW(), FALSE),
  /* Nobody has said who this is. Its money is in the company total and
     on no customer's record, which is exactly the gap finance has to be
     able to name. */
  ('stc',    'NOBODY',   'Who Is This Ltd',         NULL, NULL, FALSE),
  /* Real revenue, deliberately not a customer. */
  ('stc',    'CASHSALE', 'Cash Sale',               NULL, NULL, TRUE)
ON CONFLICT (division, alpha) DO NOTHING;

INSERT INTO protean_invoices (division, invoice_no, alpha, tax_point, net) VALUES
  -- Bigfoot: grew on maintenance, shrank on rental.
  ('stc',    'FB1', 'BIGFOOT',  '2026-05-01',  80000),
  ('stc',    'FB2', 'BIGFOOT',  '2026-06-01',  20000),
  ('stc',    'FB3', 'BIGFOOT',  '2025-05-01',  40000),
  ('rental', 'FB4', 'BIGFOOT',  '2026-05-01',  10000),
  ('rental', 'FB5', 'BIGFOOT',  '2025-05-01',  30000),
  -- Middleton: fell away hard. The call list.
  ('stc',    'FM1', 'MIDDLE',   '2026-05-01',   5000),
  ('stc',    'FM2', 'MIDDLE',   '2025-05-01',  55000),
  -- Newstart: billed nothing last year. There is no percentage here.
  ('stc',    'FN1', 'MIDDLE'||'', '2025-03-31', 0),
  ('stc',    'FN2', 'NEWSTART', '2026-06-01',  12000),
  -- Unplaced and set aside.
  ('stc',    'FU1', 'NOBODY',   '2026-05-01',   7000),
  ('stc',    'FX1', 'CASHSALE', '2026-05-01',   3000),
  -- THE YEAR BOUNDARY, both sides of it, one day apart.
  ('stc',    'FE1', 'BIGFOOT',  '2026-03-31',  99999),
  ('stc',    'FE2', 'BIGFOOT',  '2026-04-01',      1)
ON CONFLICT (division, invoice_no) DO NOTHING;

INSERT INTO protean_open_jobs (division, job_no, protean_name, alpha, logged_on, job_total, still_open) VALUES
  ('stc',    'FJ1', 'Bigfoot Logistics Ltd',  'BIGFOOT',  '2026-07-20',  1000, TRUE),
  ('stc',    'FJ2', 'Bigfoot Logistics Ltd',  'BIGFOOT',  '2026-06-15',  2000, TRUE),
  ('stc',    'FJ3', 'Middleton Transport Ltd','MIDDLE',   '2026-05-20',  4000, TRUE),
  ('stc',    'FJ4', 'Middleton Transport Ltd','MIDDLE',   '2026-01-10',  8000, TRUE),
  ('stc',    'FJ5', 'Who Is This Ltd',        NULL,        NULL,          500, TRUE),
  ('rental', 'FJ6', 'Bigfoot Logistics Ltd',  'BIGFOOT',  '2026-07-25',   300, TRUE),
  /* Closed, so it is not open work whatever its age. */
  ('stc',    'FJ7', 'Bigfoot Logistics Ltd',  'BIGFOOT',  '2026-02-01', 90000, FALSE)
ON CONFLICT (division, job_no) DO NOTHING;

INSERT INTO stock_trailers (id, status, stc_no, make, model, year, customer, sales_rep,
                            sales_price, profit, nbv, total_nbv, order_date, dispatch_date,
                            new_or_used) VALUES
  ('b2000000-0000-0000-0000-000000000001', 'sold', 'STC900', 'Schmitz', 'Curtainsider', 2021,
   'Bigfoot Logistics Ltd', 'Dave Sellers', 50000, 10000, 36000, 40000,
   '2026-04-10', '2026-04-20', 'Used'),
  ('b2000000-0000-0000-0000-000000000002', 'sold', 'STC901', 'Krone', 'Box', 2022,
   'Middleton Transport Ltd', 'dave sellers', 30000, 6000, 22000, 24000,
   '2026-05-01', '2026-05-05', 'Used'),
  /* A different person, and one whose name matches nobody who can sign
     in. That is not an error, and the screen has to show it. */
  ('b2000000-0000-0000-0000-000000000003', 'sold', 'STC902', 'Tiger', 'Skeletal', 2020,
   'Newstart Haulage Ltd', 'R Gone', 15000, 2000, 12000, 13000,
   '2026-06-01', '2026-06-02', 'Used'),
  /* Last year, so it belongs to the comparison and not to this year. */
  ('b2000000-0000-0000-0000-000000000004', 'sold', 'STC903', 'Krone', 'Box', 2018,
   'Bigfoot Logistics Ltd', 'Dave Sellers', 25000, 4000, 20000, 21000,
   '2025-05-01', '2025-05-10', 'Used'),
  /* No rep typed on it at all. It is a sale and it belongs in the
     division total; it just belongs to nobody's row. */
  ('b2000000-0000-0000-0000-000000000005', 'sold', 'STC904', 'Dennison', 'Flat', 2019,
   'Newstart Haulage Ltd', NULL, 9000, 1000, 7500, 8000,
   '2026-06-10', '2026-06-11', 'Used')
ON CONFLICT (id) DO NOTHING;

INSERT INTO crm_leads (id, contact_id, owner_id, type, status, estimated_value,
                       date_of_enquiry, company_name) VALUES
  ('b3000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000002', 'trailer_sales', 'quoted',  40000,
   '2026-06-01', 'Bigfoot Logistics Ltd'),
  ('b3000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000002', 'maintenance',   'contacted', 15000,
   '2026-06-05', 'Middleton Transport Ltd'),
  ('b3000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000003',
   'b0000000-0000-0000-0000-000000000002', 'rental',        'lead',       8000,
   '2026-06-10', 'Newstart Haulage Ltd'),
  /* Closed, so it is not pipeline. */
  ('b3000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000002', 'trailer_sales', 'lost',      60000,
   '2026-04-01', 'Bigfoot Logistics Ltd')
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  PERFORM pg_temp.act_as('b0000000-0000-0000-0000-000000000001');
  PERFORM link_trailer_sales();
END $$;

-- -------------------------------------------------------------
-- 1. WHICH DEALS. The individual trailer sales, and only this year's.
-- -------------------------------------------------------------
DO $$
DECLARE n INTEGER; total NUMERIC; expect NUMERIC; r RECORD;
BEGIN
  PERFORM pg_temp.act_as('b0000000-0000-0000-0000-000000000001');

  SELECT count(*), COALESCE(SUM(sales_price), 0) INTO n, total
    FROM trailer_deals('2026-08-01', 500);

  /* Worked out independently: every sold trailer whose money moved
     inside the year being read. Not a number typed here. */
  SELECT COALESCE(SUM(t.sales_price), 0) INTO expect
    FROM stock_trailers t
   WHERE t.status = 'sold'
     AND COALESCE(t.dispatch_date, t.order_date) BETWEEN '2026-04-01' AND '2026-08-01';

  IF total <> expect THEN
    RAISE EXCEPTION 'the deal list totals %, the year totals %', total, expect;
  END IF;

  /* And it agrees with the column above it on Analytics, which is the
     figure somebody will be reading off the same screen. */
  SELECT this_year INTO expect FROM division_revenue('2026-08-01') WHERE division = 'trailer';
  IF total <> expect THEN
    RAISE EXCEPTION 'the deals add to % but the Trailer Sales column says %', total, expect;
  END IF;

  /* Margin recomputed, not read off the spreadsheet column. */
  SELECT * INTO r FROM trailer_deals('2026-08-01', 500) WHERE stc_no = 'STC900';
  IF round(r.profit_pct, 1) <> 20.0 THEN
    RAISE EXCEPTION '10000 on 50000 reads as %%%, not 20', r.profit_pct;
  END IF;
  IF r.contact_id IS NULL THEN
    RAISE EXCEPTION 'a linked trailer came back with no customer to click through to';
  END IF;

  RAISE NOTICE 'ok  % deals listed, adding to the Trailer Sales column exactly', n;
END $$;

-- -------------------------------------------------------------
-- 2. WHO IS SELLING, and the two sources kept apart.
--
-- A trailer sale that also has a lead against it must not be counted
-- once as a trailer and again as a won lead.
-- -------------------------------------------------------------
DO $$
DECLARE dave RECORD; gone RECORD; n INTEGER; expect NUMERIC;
BEGIN
  PERFORM pg_temp.act_as('b0000000-0000-0000-0000-000000000001');

  SELECT * INTO dave FROM sales_by_person('2026-08-01')
   WHERE lower(person) = 'dave sellers';
  IF dave IS NULL THEN RAISE EXCEPTION 'Dave Sellers is not on the list at all'; END IF;

  /* Two trailers, and the second was typed in lower case. Same person,
     one row. */
  IF dave.trailers <> 2 THEN
    RAISE EXCEPTION 'Dave has % trailers, not 2. "Dave Sellers" and "dave sellers" '
                    'are one person', dave.trailers;
  END IF;
  SELECT COALESCE(SUM(t.sales_price), 0) INTO expect FROM stock_trailers t
   WHERE t.status = 'sold' AND lower(btrim(t.sales_rep)) = 'dave sellers'
     AND COALESCE(t.dispatch_date, t.order_date) BETWEEN '2026-04-01' AND '2026-08-01';
  IF dave.trailer_value <> expect THEN
    RAISE EXCEPTION 'Dave sold %, the trailers say %', dave.trailer_value, expect;
  END IF;

  /* His pipeline is the three open leads and NOT the lost one. */
  IF dave.leads_open <> 3 THEN
    RAISE EXCEPTION 'Dave has % open leads, not 3. A lost lead is not pipeline', dave.leads_open;
  END IF;
  IF dave.pipeline_value <> 63000 THEN
    RAISE EXCEPTION 'Dave''s pipeline reads %, not 63000 (40000 + 15000 + 8000). '
                    'The 60000 lost lead has leaked in', dave.pipeline_value;
  END IF;
  IF NOT dave.has_login THEN
    RAISE EXCEPTION 'Dave has a login and the list says he does not';
  END IF;

  /* Somebody who left. Shown, and shown as having no login. */
  SELECT * INTO gone FROM sales_by_person('2026-08-01') WHERE person = 'R Gone';
  IF gone IS NULL THEN
    RAISE EXCEPTION 'a rep with no login vanished from the list rather than being shown';
  END IF;
  IF gone.has_login THEN
    RAISE EXCEPTION 'R Gone matches nobody who can sign in, and the list says otherwise';
  END IF;

  /* The trailer with no rep on it is nobody's, and must not become a
     row called empty string. */
  SELECT count(*) INTO n FROM sales_by_person('2026-08-01')
   WHERE person IS NULL OR btrim(person) = '';
  IF n <> 0 THEN RAISE EXCEPTION 'a nameless row appeared on the leaderboard'; END IF;

  RAISE NOTICE 'ok  one row per person, spelled two ways is one, and a lost lead is not pipeline';
END $$;

-- -------------------------------------------------------------
-- 3. WHAT IS COMING. Every stage, including the empty ones.
-- -------------------------------------------------------------
DO $$
DECLARE n INTEGER; v NUMERIC;
BEGIN
  PERFORM pg_temp.act_as('b0000000-0000-0000-0000-000000000001');

  /* Three divisions times six stages, every one present. */
  SELECT count(*) INTO n FROM pipeline_by_stage();
  IF n <> 18 THEN
    RAISE EXCEPTION 'the funnel has % rows, not 18. A stage nobody is at still has a rung', n;
  END IF;

  /* An empty stage reads nought, not nothing. */
  SELECT leads INTO n FROM pipeline_by_stage()
   WHERE division = 'stc' AND stage = 'quoted';
  IF n IS NULL THEN RAISE EXCEPTION 'an empty stage came back null rather than nought'; END IF;
  IF n <> 0 THEN RAISE EXCEPTION 'stc quoted reads %, not 0', n; END IF;

  /* And the lead lands under its own division, not somebody else's. */
  SELECT leads, value INTO n, v FROM pipeline_by_stage()
   WHERE division = 'trailer' AND stage = 'quoted';
  IF n <> 1 OR v <> 40000 THEN
    RAISE EXCEPTION 'the quoted trailer lead reads % at %, not 1 at 40000', n, v;
  END IF;

  RAISE NOTICE 'ok  18 rungs, empty ones drawn at nought, each lead under its own division';
END $$;

-- -------------------------------------------------------------
-- 4. WHO IS GROWING AND WHO IS GOING.
--
-- Both ends of the list, the two Protean divisions netted together,
-- and no percentage invented where there was nothing to grow from.
-- -------------------------------------------------------------
DO $$
DECLARE big RECORD; mid RECORD; new_ RECORD; expect NUMERIC;
BEGIN
  PERFORM pg_temp.act_as('b0000000-0000-0000-0000-000000000001');

  SELECT * INTO big FROM customer_movement('2026-08-01', 50)
   WHERE company_name = 'Bigfoot Logistics Ltd';

  /* Netted across maintenance and rental, worked out separately. */
  SELECT COALESCE(SUM(i.net), 0) INTO expect
    FROM protean_invoices i JOIN protean_accounts a
      ON a.division = i.division AND a.alpha = i.alpha
   WHERE a.contact_id = 'b1000000-0000-0000-0000-000000000001'
     AND i.tax_point BETWEEN '2026-04-01' AND '2026-08-01';
  IF big.this_year <> expect THEN
    RAISE EXCEPTION 'Bigfoot reads % this year, the invoices say %', big.this_year, expect;
  END IF;
  IF big.change <> big.this_year - big.last_year THEN
    RAISE EXCEPTION 'the change does not equal this year less last year';
  END IF;
  /* Trades in both, and the row says which. */
  IF big.divisions NOT LIKE '%,%' THEN
    RAISE EXCEPTION 'Bigfoot bills on two divisions and the row names %', big.divisions;
  END IF;

  /* The faller is on the list, and it is a faller. */
  SELECT * INTO mid FROM customer_movement('2026-08-01', 50)
   WHERE company_name = 'Middleton Transport Ltd';
  IF mid IS NULL THEN RAISE EXCEPTION 'the biggest faller is not on the movement list'; END IF;
  IF mid.change >= 0 THEN
    RAISE EXCEPTION 'Middleton went from 55000 to 5000 and the change reads %', mid.change;
  END IF;

  /* NOTHING TO GROW FROM. Newstart billed nought last year. A
     percentage here would be an infinity dressed as a fact. */
  SELECT * INTO new_ FROM customer_movement('2026-08-01', 50)
   WHERE company_name = 'Newstart Haulage Ltd';
  IF new_ IS NULL THEN RAISE EXCEPTION 'a brand new customer is not counted as a mover'; END IF;
  IF new_.last_year <> 0 THEN
    RAISE EXCEPTION 'Newstart billed % last year, expected 0', new_.last_year;
  END IF;
  IF new_.change_pct IS NOT NULL THEN
    RAISE EXCEPTION 'a rise from nought printed as %%%. It has to be null', new_.change_pct;
  END IF;

  RAISE NOTICE 'ok  risers and fallers on one list, and a rise from nought prints no percentage';
END $$;

-- -------------------------------------------------------------
-- 5. HOW EXPOSED ARE WE.
-- -------------------------------------------------------------
DO $$
DECLARE c RECORD; expect NUMERIC;
BEGIN
  PERFORM pg_temp.act_as('b0000000-0000-0000-0000-000000000001');

  SELECT * INTO c FROM revenue_concentration('2026-08-01', NULL);

  /* The bands nest, always. */
  IF NOT (c.top_1 <= c.top_5 AND c.top_5 <= c.top_10 AND c.top_10 <= c.billed) THEN
    RAISE EXCEPTION 'the concentration bands do not nest: 1=% 5=% 10=% all=%',
      c.top_1, c.top_5, c.top_10, c.billed;
  END IF;

  /* `billed` is what sits on customers, so it must NOT include the
     unplaced account or the set aside one. That is the whole reason
     reconciliation exists as a separate function. */
  SELECT COALESCE(SUM(i.net), 0) INTO expect
    FROM protean_invoices i JOIN protean_accounts a
      ON a.division = i.division AND a.alpha = i.alpha
   WHERE a.contact_id IS NOT NULL AND NOT a.ignored
     AND i.tax_point BETWEEN '2026-04-01' AND '2026-08-01';
  IF c.billed <> expect THEN
    RAISE EXCEPTION 'concentration is measured over %, the customers billed %', c.billed, expect;
  END IF;

  IF c.biggest IS NULL THEN RAISE EXCEPTION 'nobody is the biggest customer'; END IF;
  IF c.customers < 3 THEN
    RAISE EXCEPTION 'only % customers counted, there are at least 3', c.customers;
  END IF;
  /* Average and median are different numbers here, which is the point
     of showing both. */
  IF c.average = c.median THEN
    RAISE EXCEPTION 'average and median came out identical on a deliberately lopsided set';
  END IF;

  RAISE NOTICE 'ok  bands nest, and concentration is measured over customers rather than the total';
END $$;

-- -------------------------------------------------------------
-- 6. HOW OLD IS THE OPEN WORK.
-- -------------------------------------------------------------
DO $$
DECLARE n INTEGER; total NUMERIC; expect NUMERIC; r RECORD;
BEGIN
  PERFORM pg_temp.act_as('b0000000-0000-0000-0000-000000000001');

  /* Two Protean divisions times five bands. */
  SELECT count(*) INTO n FROM open_work_ageing(NULL, '2026-08-01');
  IF n <> 10 THEN RAISE EXCEPTION 'the ageing has % rows, not 10', n; END IF;

  /* Every band together is every open job, and nothing else. */
  SELECT COALESCE(SUM(value), 0), COALESCE(SUM(jobs), 0)
    INTO total, n FROM open_work_ageing(NULL, '2026-08-01');
  SELECT COALESCE(SUM(j.job_total), 0) INTO expect
    FROM protean_open_jobs j WHERE j.still_open;
  IF total <> expect THEN
    RAISE EXCEPTION 'the bands hold % and the open jobs are worth %. '
                    'A closed job has leaked in, or an open one is missing', total, expect;
  END IF;

  /* And it agrees with the division columns on the same screen. */
  SELECT COALESCE(SUM(outstanding), 0) INTO expect FROM division_revenue('2026-08-01')
   WHERE division IN ('stc', 'rental');
  IF total <> expect THEN
    RAISE EXCEPTION 'ageing totals % and the division columns say %', total, expect;
  END IF;

  /* A job logged in January is over ninety days old on 1 August. */
  SELECT * INTO r FROM open_work_ageing('stc', '2026-08-01') WHERE band_at = 4;
  IF r.jobs < 1 THEN RAISE EXCEPTION 'the January job is not in the over 90 days band'; END IF;

  /* A job with no date is its own band rather than being dropped or
     called new. */
  SELECT * INTO r FROM open_work_ageing('stc', '2026-08-01') WHERE band_at = 5;
  IF r.jobs <> 1 OR r.value <> 500 THEN
    RAISE EXCEPTION 'the undated job reads % jobs at %, not 1 at 500', r.jobs, r.value;
  END IF;

  RAISE NOTICE 'ok  the bands add to the open work exactly, and an undated job is its own band';
END $$;

-- -------------------------------------------------------------
-- 7. WHY THE CUSTOMERS DO NOT ADD UP TO THE TOTAL.
--
-- The one that makes every other figure defensible.
-- -------------------------------------------------------------
DO $$
DECLARE r RECORD; expect NUMERIC;
BEGIN
  PERFORM pg_temp.act_as('b0000000-0000-0000-0000-000000000001');

  SELECT * INTO r FROM division_reconciliation('2026-08-01') WHERE division = 'stc';

  /* THE THREE PARTS ADD TO THE WHOLE. If this ever drifts, a finance
     team is reconciling a dashboard against a report by hand. */
  IF r.on_customers + r.unattributed + r.set_aside <> r.billed THEN
    RAISE EXCEPTION 'customers % + unplaced % + set aside % = %, but the division billed %',
      r.on_customers, r.unattributed, r.set_aside,
      r.on_customers + r.unattributed + r.set_aside, r.billed;
  END IF;

  /* And the whole is the same figure the division column shows, so the
     two halves of the screen cannot disagree. */
  SELECT this_year INTO expect FROM division_revenue('2026-08-01') WHERE division = 'stc';
  IF r.billed <> expect THEN
    RAISE EXCEPTION 'reconciliation says % billed and the STC column says %', r.billed, expect;
  END IF;

  IF r.unattributed <> 7000 OR r.unattributed_n <> 1 THEN
    RAISE EXCEPTION 'unplaced reads % across % accounts, not 7000 across 1',
      r.unattributed, r.unattributed_n;
  END IF;
  IF r.set_aside <> 3000 OR r.set_aside_n <> 1 THEN
    RAISE EXCEPTION 'set aside reads % across % accounts, not 3000 across 1',
      r.set_aside, r.set_aside_n;
  END IF;

  RAISE NOTICE 'ok  customers plus unplaced plus set aside equals the division, to the penny';
END $$;

-- -------------------------------------------------------------
-- 7b. AND TRAILER SALES IS ON IT.
--
-- From the business: "Unsure why trailer sales isn't on reconciliation
-- tab - you've put that it doesn't get included but why."
--
-- No good reason. `stock_trailers.customer` is free text, so a trailer
-- sale sits in exactly the same state an unplaced Protean account does:
-- real revenue, on no customer's page. Leaving it off meant the screen
-- whose whole job is naming that gap was silent about a third of the
-- company.
-- -------------------------------------------------------------
DO $$
DECLARE r RECORD; expect NUMERIC; n INTEGER;
BEGIN
  PERFORM pg_temp.act_as('b0000000-0000-0000-0000-000000000001');

  SELECT * INTO r FROM division_reconciliation('2026-08-01') WHERE division = 'trailer';
  IF r IS NULL THEN
    RAISE EXCEPTION 'trailer sales is not on the reconciliation at all';
  END IF;

  /* The same rule as the other two: the parts add to the whole. */
  IF r.on_customers + r.unattributed + r.set_aside <> r.billed THEN
    RAISE EXCEPTION 'trailer: customers % + unplaced % + aside % <> billed %',
      r.on_customers, r.unattributed, r.set_aside, r.billed;
  END IF;

  /* And the whole is what the Trailer Sales column says. */
  SELECT this_year INTO expect FROM division_revenue('2026-08-01') WHERE division = 'trailer';
  IF r.billed <> expect THEN
    RAISE EXCEPTION 'trailer reconciliation says % and the column says %', r.billed, expect;
  END IF;

  /* Nothing is set aside on the stock list. Nought, not null: there is
     no Cash Sale equivalent and saying so is different from not
     knowing. */
  IF r.set_aside <> 0 OR r.set_aside_n <> 0 THEN
    RAISE EXCEPTION 'the stock list has no set aside accounts and reports % at %',
      r.set_aside_n, r.set_aside;
  END IF;

  /* THE GAP IS COUNTED IN CUSTOMERS, NOT TRAILERS.

     STC904 and the unnamed one below both belong to Newstart, who is
     linked. The one that is NOT linked is 'Nowhere Transport', which
     bought two trailers. Counting trailers would say two jobs to do
     where there is one record to make. */
  INSERT INTO stock_trailers (id, status, stc_no, make, customer, sales_price, profit,
                              nbv, total_nbv, order_date, dispatch_date)
  VALUES ('b2000000-0000-0000-0000-00000000000a', 'sold', 'STC910', 'Krone',
          'Nowhere Transport Ltd', 11000, 1000, 9000, 10000, '2026-06-01', '2026-06-02'),
         ('b2000000-0000-0000-0000-00000000000b', 'sold', 'STC911', 'Krone',
          'Nowhere Transport Ltd',  9000,  900, 7000,  8000, '2026-06-05', '2026-06-06')
  ON CONFLICT (id) DO NOTHING;

  SELECT * INTO r FROM division_reconciliation('2026-08-01') WHERE division = 'trailer';
  IF r.unattributed_n <> 1 THEN
    RAISE EXCEPTION 'two trailers to one unlinked haulier count as % records to make, not 1',
      r.unattributed_n;
  END IF;
  IF r.unattributed <> 20000 THEN
    RAISE EXCEPTION 'the unlinked trailer money reads %, not 20000', r.unattributed;
  END IF;

  RAISE NOTICE 'ok  trailer sales reconciles too, and the gap is counted in customers';
END $$;

-- -------------------------------------------------------------
-- 7c. AND SOMETHING CAN BE DONE ABOUT IT.
--
-- From the business: "customers should exist if they don't already
-- have a CRM record".
-- -------------------------------------------------------------
DO $$
DECLARE w RECORD; made UUID; n INTEGER; r RECORD;
BEGIN
  PERFORM pg_temp.act_as('b0000000-0000-0000-0000-000000000001');

  SELECT * INTO w FROM trailer_customers_waiting('2026-08-01')
   WHERE customer = 'Nowhere Transport Ltd';
  IF w IS NULL THEN
    RAISE EXCEPTION 'the unlinked haulier is not in the queue';
  END IF;
  IF w.trailers <> 2 OR w.value <> 20000 THEN
    RAISE EXCEPTION 'the queue says % trailers at %, not 2 at 20000', w.trailers, w.value;
  END IF;
  /* Nobody in the CRM is spelled like that, so nothing is suggested. */
  IF w.looks_like IS NOT NULL THEN
    RAISE EXCEPTION 'a customer nobody resembles was matched to %', w.looks_like_name;
  END IF;

  made := make_customer_for_trailer('Nowhere Transport Ltd');
  IF made IS NULL THEN RAISE EXCEPTION 'making the customer returned nothing'; END IF;

  /* Both trailers moved onto it, not just one. */
  SELECT count(*) INTO n FROM stock_trailers
   WHERE contact_id = made AND status = 'sold';
  IF n <> 2 THEN
    RAISE EXCEPTION 'the new record picked up % trailers, not 2', n;
  END IF;

  /* And the gap it was counted in has closed by exactly that much. */
  SELECT * INTO r FROM division_reconciliation('2026-08-01') WHERE division = 'trailer';
  IF r.unattributed <> 0 OR r.unattributed_n <> 0 THEN
    RAISE EXCEPTION 'after making the record, % is still unattributed across %',
      r.unattributed, r.unattributed_n;
  END IF;
  IF r.on_customers <> r.billed THEN
    RAISE EXCEPTION 'every trailer is now on a customer and the two figures differ: % vs %',
      r.on_customers, r.billed;
  END IF;

  /* PRESSING IT TWICE MAKES ONE COMPANY, NOT TWO. */
  IF make_customer_for_trailer('Nowhere Transport Ltd') <> made THEN
    RAISE EXCEPTION 'doing it again made a second record for the same haulier';
  END IF;
  SELECT count(*) INTO n FROM crm_contacts
   WHERE lower(btrim(company_name)) = 'nowhere transport ltd';
  IF n <> 1 THEN
    RAISE EXCEPTION 'there are now % records for that haulier', n;
  END IF;

  /* A blank name is refused rather than making a company called
     nothing. */
  BEGIN
    PERFORM make_customer_for_trailer('   ');
    RAISE EXCEPTION 'a customer with no name was created';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'a customer with no name was created' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ok  a trailer customer can be made, picks up every trailer, and cannot be doubled';
END $$;

-- -------------------------------------------------------------
-- 8. THE YEAR BOUNDARY, one day either side.
--
-- 99999 on 31 March and 1 on 1 April. If a single figure here moves,
-- every year on year number on the screen is a year out.
-- -------------------------------------------------------------
DO $$
DECLARE r RECORD; inside NUMERIC; with_march NUMERIC; without_april NUMERIC;
BEGIN
  PERFORM pg_temp.act_as('b0000000-0000-0000-0000-000000000001');

  SELECT * INTO r FROM division_reconciliation('2026-08-01') WHERE division = 'stc';

  /* Three sums over the same invoices, differing only in where the
     boundary is put. Only one of them can be the division's total, and
     which one it is IS the assertion. Stating it as "the total is under
     99999" would have passed on a division that simply billed less. */
  SELECT COALESCE(SUM(net), 0) INTO inside FROM protean_invoices
   WHERE division = 'stc' AND tax_point BETWEEN '2026-04-01' AND '2026-08-01';
  SELECT COALESCE(SUM(net), 0) INTO with_march FROM protean_invoices
   WHERE division = 'stc' AND tax_point BETWEEN '2026-03-31' AND '2026-08-01';
  SELECT COALESCE(SUM(net), 0) INTO without_april FROM protean_invoices
   WHERE division = 'stc' AND tax_point BETWEEN '2026-04-02' AND '2026-08-01';

  IF with_march = inside OR without_april = inside THEN
    RAISE EXCEPTION 'the fixtures either side of the boundary are missing, '
                    'so this check cannot tell a year out from a year right';
  END IF;

  IF r.billed = with_march THEN
    RAISE EXCEPTION 'the 31 March invoice is in the year that began 1 April';
  END IF;
  IF r.billed = without_april THEN
    RAISE EXCEPTION 'the 1 April invoice is being left out of the year it starts';
  END IF;
  IF r.billed <> inside THEN
    RAISE EXCEPTION 'the division billed %, and April to August is %', r.billed, inside;
  END IF;

  RAISE NOTICE 'ok  31 March is last year and 1 April is this one, to the day';
END $$;

-- -------------------------------------------------------------
-- 9. NONE OF IT IS READABLE WITHOUT PERMISSION.
--
-- Seven new ways into the company's revenue. Every one of them refuses
-- somebody who cannot open the CRM, and the refusal is the default
-- rather than something each function remembered.
-- -------------------------------------------------------------
DO $$
DECLARE fn TEXT; leaked TEXT := ''; ok_ BOOLEAN;
BEGIN
  PERFORM pg_temp.act_as(NULL);

  FOREACH fn IN ARRAY ARRAY[
    'SELECT * FROM trailer_deals()',
    'SELECT * FROM sales_by_person()',
    'SELECT * FROM pipeline_by_stage()',
    'SELECT * FROM customer_movement()',
    'SELECT * FROM revenue_concentration()',
    'SELECT * FROM open_work_ageing()',
    'SELECT * FROM division_reconciliation()'
  ] LOOP
    ok_ := FALSE;
    BEGIN
      EXECUTE fn;
    EXCEPTION WHEN OTHERS THEN ok_ := TRUE;
    END;
    IF NOT ok_ THEN leaked := leaked || fn || '; '; END IF;
  END LOOP;

  IF leaked <> '' THEN
    RAISE EXCEPTION 'answered somebody with no access to the CRM: %', leaked;
  END IF;
  RAISE NOTICE 'ok  all seven refuse somebody who cannot open the CRM';
END $$;

ROLLBACK;
