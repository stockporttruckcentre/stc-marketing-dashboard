-- =============================================================
-- Three divisions, side by side.
--
-- From the business:
--
--   the analytics page he wants splitting in to 3 divisions (vertical
--   columns) - STC - Trailer Sales - Rental ... Has to be robust and
--   well connected to present the data to our finance teams
--
-- Three columns that sit next to each other are read as comparable
-- whether or not they are, so the whole job of this file is proving
-- they really are: the same year, the same like for like cut, and no
-- figure quietly meaning something different in one column.
--
-- The four ways it goes wrong without anybody noticing:
--
--   1. A trailer sale counted in the wrong year, because it has two
--      dates and only one of them is when the money moved.
--   2. Margin shown as nought on a division that records no cost, which
--      reads as "we made nothing" rather than "we do not know".
--   3. Revenue on an unplaced account dropping out of the customer
--      list, so the list does not add up to the column above it.
--   4. A division's total quietly including another's.
--
-- Run with `npm run check:divisions`.
-- =============================================================
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'div.admin@example.test')
ON CONFLICT DO NOTHING;
UPDATE profiles SET role = 'admin', role_template_id = NULL, full_name = 'Division Admin'
 WHERE id = 'a0000000-0000-0000-0000-000000000001';

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_who UUID) RETURNS VOID
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_who::TEXT, ''), TRUE);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
END;
$fn$;

/* One haulier who buys from all three, which is the case the business
   said had to work and the reason the type field is not on the CRM
   record. */
INSERT INTO crm_contacts (id, company_name, source, status) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'Threeways Haulage Ltd', 'protean', 'customer')
ON CONFLICT (id) DO NOTHING;

INSERT INTO protean_accounts (division, alpha, protean_name, contact_id, bound_at) VALUES
  ('stc',    'THREEWAY', 'Threeways Haulage Ltd', 'a1000000-0000-0000-0000-000000000001', NOW()),
  ('rental', 'THREEWAY', 'Threeways Haulage Ltd', 'a1000000-0000-0000-0000-000000000001', NOW())
ON CONFLICT (division, alpha) DO NOTHING;

/* Read at 1 August 2026, so the year running began 1 April 2026 and the
   comparison is the same point in the year from April 2025. */
INSERT INTO protean_invoices (division, invoice_no, alpha, tax_point, net) VALUES
  ('stc',    'DS1', 'THREEWAY', '2026-05-01', 60000),
  ('stc',    'DS2', 'THREEWAY', '2025-05-01', 40000),
  ('rental', 'DS1', 'THREEWAY', '2026-05-01', 25000),
  ('rental', 'DS2', 'THREEWAY', '2025-05-01', 30000)
ON CONFLICT (division, invoice_no) DO NOTHING;

INSERT INTO stock_trailers (id, status, make, model, year, customer, sales_price, profit,
                            order_date, dispatch_date, nbv, total_nbv) VALUES
  /* Ordered in March, dispatched in April. It belongs to the year it
     left the yard in, which is the one that began April 2026. */
  ('a2000000-0000-0000-0000-000000000001', 'sold', 'Schmitz', 'Curtainsider', 2020,
   'Threeways Haulage Ltd', 45000, 9000, '2026-03-20', '2026-04-05', 30000, 33000),
  ('a2000000-0000-0000-0000-000000000002', 'sold', 'Krone', 'Box', 2019,
   'Threeways Haulage Ltd', 20000, 3000, '2025-05-01', '2025-05-10', 15000, 16000),
  /* Not sold, so it is stock rather than revenue. */
  ('a2000000-0000-0000-0000-000000000003', 'in_stock', 'Schmitz', 'Flat', 2021,
   NULL, NULL, NULL, NULL, NULL, 22000, 24000)
ON CONFLICT (id) DO NOTHING;

-- -------------------------------------------------------------
-- 1. A trailer sale finds its customer, exactly and never nearly.
-- -------------------------------------------------------------
DO $$
DECLARE linked INTEGER; n INTEGER;
BEGIN
  PERFORM pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
  linked := link_trailer_sales();
  IF linked < 2 THEN
    RAISE EXCEPTION 'only % trailer sales found their customer, not 2', linked;
  END IF;

  /* Running it again links nothing and moves nothing. */
  IF link_trailer_sales() <> 0 THEN
    RAISE EXCEPTION 'linking a second time changed something';
  END IF;

  /* A near miss is not a match. */
  INSERT INTO stock_trailers (id, status, make, model, year, customer, sales_price,
                              order_date, dispatch_date)
  VALUES ('a2000000-0000-0000-0000-00000000000f', 'sold', 'Krone', 'Box', 2018,
          'Threeways Haulage', 1000, '2026-05-01', '2026-05-02')
  ON CONFLICT (id) DO NOTHING;
  PERFORM link_trailer_sales();
  SELECT count(*) INTO n FROM stock_trailers
   WHERE id = 'a2000000-0000-0000-0000-00000000000f' AND contact_id IS NOT NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'a name one word short was bound to a customer anyway';
  END IF;
  DELETE FROM stock_trailers WHERE id = 'a2000000-0000-0000-0000-00000000000f';

  RAISE NOTICE 'ok  a trailer sale reaches its customer on an exact name and on nothing less';
END $$;

-- -------------------------------------------------------------
-- 2. THE YEAR A TRAILER BELONGS TO.
--
-- It has two dates. Ordered 20 March 2026, dispatched 5 April 2026: on
-- an April year those are DIFFERENT YEARS, and the money moved when it
-- left the yard.
-- -------------------------------------------------------------
DO $$
DECLARE r RECORD;
BEGIN
  PERFORM pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
  SELECT * INTO r FROM division_revenue('2026-08-01') WHERE division = 'trailer';

  IF r.this_year <> 45000 THEN
    RAISE EXCEPTION 'trailer sales read %, not 45000. A March order dispatched in April '
                    'belongs to the year it left the yard in', r.this_year;
  END IF;
  IF r.last_year <> 20000 THEN
    RAISE EXCEPTION 'the same point last year reads %, not 20000', r.last_year;
  END IF;
  IF r.deals <> 1 THEN RAISE EXCEPTION 'it counts % sales, not 1', r.deals; END IF;

  /* Stock is money committed and not yet billed, which is the trailer
     equivalent of work on the ramps. */
  IF r.outstanding <> 24000 OR r.outstanding_n <> 1 THEN
    RAISE EXCEPTION 'stock reads % across % trailers, not 24000 across 1',
      r.outstanding, r.outstanding_n;
  END IF;
  IF r.outstanding_of <> 'in stock' THEN
    RAISE EXCEPTION 'the outstanding figure is labelled %, which would read as open jobs',
      r.outstanding_of;
  END IF;
  RAISE NOTICE 'ok  a trailer counts in the year it left the yard, and unsold stock is not revenue';
END $$;

-- -------------------------------------------------------------
-- 3. MARGIN ONLY WHERE A COST IS RECORDED.
--
-- Nought reads as "we made nothing on it". Null reads as "we do not
-- know". On a finance screen those are very different sentences and
-- only one of them is true of maintenance.
-- -------------------------------------------------------------
DO $$
DECLARE t NUMERIC; s NUMERIC; r NUMERIC;
BEGIN
  PERFORM pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
  SELECT margin INTO t FROM division_revenue('2026-08-01') WHERE division = 'trailer';
  SELECT margin INTO s FROM division_revenue('2026-08-01') WHERE division = 'stc';
  SELECT margin INTO r FROM division_revenue('2026-08-01') WHERE division = 'rental';

  IF t <> 9000 THEN RAISE EXCEPTION 'trailer margin reads %, not 9000', t; END IF;
  IF s IS NOT NULL THEN
    RAISE EXCEPTION 'maintenance reports a margin of %, and no cost is recorded anywhere', s;
  END IF;
  IF r IS NOT NULL THEN
    RAISE EXCEPTION 'rental reports a margin of %, and no cost is recorded anywhere', r;
  END IF;
  RAISE NOTICE 'ok  margin is shown where a cost exists and is null where none does, never nought';
END $$;

-- -------------------------------------------------------------
-- 4. The three columns are three, and none of them borrows another's.
-- -------------------------------------------------------------
DO $$
DECLARE n INTEGER; stc NUMERIC; rent NUMERIC; trail NUMERIC;
BEGIN
  PERFORM pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
  SELECT count(*) INTO n FROM division_revenue('2026-08-01');
  IF n <> 3 THEN RAISE EXCEPTION 'there are % divisions, not 3', n; END IF;

  SELECT this_year INTO stc   FROM division_revenue('2026-08-01') WHERE division = 'stc';
  SELECT this_year INTO rent  FROM division_revenue('2026-08-01') WHERE division = 'rental';
  SELECT this_year INTO trail FROM division_revenue('2026-08-01') WHERE division = 'trailer';

  IF stc <> 60000 THEN RAISE EXCEPTION 'STC reads %, not 60000', stc; END IF;
  IF rent <> 25000 THEN RAISE EXCEPTION 'rental reads %, not 25000', rent; END IF;
  IF trail <> 45000 THEN RAISE EXCEPTION 'trailer sales read %, not 45000', trail; END IF;

  /* And they are ordered the way the screen draws them. */
  IF (SELECT string_agg(division, ',' ORDER BY sort_order) FROM division_revenue('2026-08-01'))
     <> 'stc,trailer,rental' THEN
    RAISE EXCEPTION 'the columns come back in a different order from the one the screen uses';
  END IF;
  RAISE NOTICE 'ok  three columns, in the order the screen draws them, and none borrows another''s money';
END $$;

-- -------------------------------------------------------------
-- 5. ONE CUSTOMER IN ALL THREE, without a field saying so.
--
-- The answer to the question the business asked: a customer's divisions
-- are derived from where their money came from, never declared, so a
-- haulier we MOT, sell trailers to and rent to appears in all three.
-- -------------------------------------------------------------
DO $$
DECLARE n INTEGER; r RECORD;
BEGIN
  PERFORM pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
  SELECT count(*) INTO n FROM customer_divisions('a1000000-0000-0000-0000-000000000001');
  IF n <> 3 THEN
    RAISE EXCEPTION 'a customer buying from all three reads as % divisions', n;
  END IF;

  SELECT * INTO r FROM customer_divisions('a1000000-0000-0000-0000-000000000001')
   WHERE division = 'trailer';
  IF r.net <> 65000 THEN
    RAISE EXCEPTION 'their trailer buying reads %, not 65000 all time', r.net;
  END IF;
  RAISE NOTICE 'ok  one customer appears in all three divisions, derived and never declared';
END $$;

-- -------------------------------------------------------------
-- 6. The customer list adds up to the column above it.
--
-- Money on an account nobody has placed must still appear, named as
-- the source system names it. Dropping it makes a list that visibly
-- fails to reach the total it sits under.
-- -------------------------------------------------------------
DO $$
DECLARE i UUID; listed NUMERIC; column_total NUMERIC; n INTEGER;
BEGIN
  PERFORM pg_temp.act_as('a0000000-0000-0000-0000-000000000001');

  INSERT INTO protean_accounts (division, alpha, protean_name)
  VALUES ('stc', 'UNPLACED', 'Nobody Has Placed Ltd')
  ON CONFLICT (division, alpha) DO NOTHING;
  INSERT INTO protean_invoices (division, invoice_no, alpha, tax_point, net)
  VALUES ('stc', 'UP1', 'UNPLACED', '2026-05-01', 15000)
  ON CONFLICT (division, invoice_no) DO NOTHING;

  SELECT SUM(this_year) INTO listed FROM division_customers('stc', '2026-08-01', 200);
  SELECT this_year INTO column_total FROM division_revenue('2026-08-01') WHERE division = 'stc';
  IF listed <> column_total THEN
    RAISE EXCEPTION 'the customer list adds to % and the column says %', listed, column_total;
  END IF;

  SELECT count(*) INTO n FROM division_customers('stc', '2026-08-01', 200)
   WHERE NOT placed;
  IF n <> 1 THEN
    RAISE EXCEPTION 'the unplaced account is not marked as unplaced';
  END IF;
  RAISE NOTICE 'ok  the customer list adds up to its column, unplaced money included and marked';
END $$;

-- -------------------------------------------------------------
-- 7. Month by month gives every division a point in every month.
-- -------------------------------------------------------------
DO $$
DECLARE n INTEGER; may NUMERIC;
BEGIN
  PERFORM pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
  SELECT count(*) INTO n FROM division_by_month(12, '2026-08-01');
  IF n <> 36 THEN
    RAISE EXCEPTION 'twelve months across three divisions is % rows, not 36', n;
  END IF;

  SELECT net INTO may FROM division_by_month(12, '2026-08-01')
   WHERE month = '2026-05-01' AND division = 'stc';
  IF may <> 75000 THEN
    RAISE EXCEPTION 'May maintenance reads %, not 75000', may;
  END IF;

  /* A quiet month is a nought, not a gap. */
  IF NOT EXISTS (SELECT 1 FROM division_by_month(12, '2026-08-01')
                  WHERE net = 0 AND division = 'trailer') THEN
    RAISE EXCEPTION 'no month has nought in it, so empty months are being dropped';
  END IF;
  RAISE NOTICE 'ok  every division has a point in every month, including the quiet ones';
END $$;

-- -------------------------------------------------------------
-- 8. The pipeline already carried its division.
-- -------------------------------------------------------------
DO $$
DECLARE n INTEGER; r RECORD;
BEGIN
  PERFORM pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
  SELECT count(*) INTO n FROM division_pipeline();
  IF n <> 3 THEN RAISE EXCEPTION 'the pipeline splits into %, not 3', n; END IF;

  /* The mapping is the part worth asserting: the lead calls it
     `maintenance` and the division is called `stc`. */
  SELECT * INTO r FROM division_pipeline() WHERE division = 'stc';
  IF r.name <> 'STC' THEN RAISE EXCEPTION 'the STC column is named %', r.name; END IF;
  RAISE NOTICE 'ok  the pipeline splits three ways from the type a lead has always carried';
END $$;

ROLLBACK;
