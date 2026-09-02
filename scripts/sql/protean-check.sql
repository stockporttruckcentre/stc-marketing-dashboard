-- =============================================================
-- Taking the Protean export, against real rows.
--
-- This runs twice a week, by hand, on a file of twenty thousand rows,
-- and every figure Tom looks at comes out of it. The four ways it can
-- go wrong without anybody noticing:
--
--   1. Importing the same file twice doubling the revenue. The person
--      doing it has no way to tell, because a bigger number is what
--      they expect from a newer file.
--   2. The first batch of a file closing every job the later batches
--      were about to confirm, so a big export reads as an empty
--      workshop.
--   3. Rows the import would not take being dropped silently, so the
--      total is quietly short and nothing says so.
--   4. Revenue on an account nobody has identified yet going nowhere,
--      rather than sitting visibly unattributed.
--
-- Run with `npm run check:protean-sql`.
-- =============================================================
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('80000000-0000-0000-0000-000000000001', 'pt.admin@example.test'),
  ('80000000-0000-0000-0000-000000000002', 'pt.viewer@example.test')
ON CONFLICT DO NOTHING;

UPDATE profiles SET role = 'admin', role_template_id = NULL, full_name = 'Protean Admin'
 WHERE id = '80000000-0000-0000-0000-000000000001';
UPDATE profiles SET role = 'viewer', role_template_id = NULL, full_name = 'Protean Viewer'
 WHERE id = '80000000-0000-0000-0000-000000000002';

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_who UUID) RETURNS VOID
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_who::TEXT, ''), TRUE);
  PERFORM set_config('request.jwt.claim.role',
                     CASE WHEN p_who IS NULL THEN 'anon' ELSE 'authenticated' END, TRUE);
END;
$fn$;

-- -------------------------------------------------------------
-- 1. A viewer cannot import.
-- -------------------------------------------------------------
DO $$
DECLARE i UUID;
BEGIN
  PERFORM pg_temp.act_as('80000000-0000-0000-0000-000000000002');
  BEGIN
    i := protean_start_import('invoices', 'nope.csv');
    RAISE EXCEPTION 'a viewer started an import';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM = 'a viewer started an import' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'ok  importing what Protean billed needs permission to import';
END $$;

-- -------------------------------------------------------------
-- 2. The same file twice is the same money once.
-- -------------------------------------------------------------
DO $$
DECLARE
  i UUID; r RECORD; total NUMERIC; accounts INTEGER;
  file JSONB := '[
    {"invoice_no":"1001","alpha":"acme","protean_name":"Acme Haulage Ltd","tax_point":"2026-02-01","net":"1000"},
    {"invoice_no":"1002","alpha":"ACME","protean_name":"Acme Haulage Ltd","tax_point":"2026-02-02","net":"500"},
    {"invoice_no":"1003","alpha":"BEES","protean_name":"Bees Transport","tax_point":"2026-02-03","net":"250"}
  ]'::JSONB;
BEGIN
  PERFORM pg_temp.act_as('80000000-0000-0000-0000-000000000001');

  i := protean_start_import('invoices', 'week one.csv');
  SELECT * INTO r FROM protean_take_invoices(i, file);
  IF r.rows_new <> 3 OR r.rows_updated <> 0 THEN
    RAISE EXCEPTION 'the first import made % new and % updated', r.rows_new, r.rows_updated;
  END IF;
  /* `acme` and `ACME` are one account, not two. */
  IF r.accounts_new <> 2 THEN
    RAISE EXCEPTION 'the first import made % accounts, not 2', r.accounts_new;
  END IF;

  i := protean_start_import('invoices', 'week one again.csv');
  SELECT * INTO r FROM protean_take_invoices(i, file);
  IF r.rows_new <> 0 OR r.rows_updated <> 3 THEN
    RAISE EXCEPTION 'the same file again made % new and % updated', r.rows_new, r.rows_updated;
  END IF;

  SELECT SUM(net), count(DISTINCT alpha) INTO total, accounts FROM protean_invoices;
  IF total <> 1750 THEN
    RAISE EXCEPTION 'the same file twice billed %, not 1750', total;
  END IF;
  IF accounts <> 2 THEN
    RAISE EXCEPTION 'there are % accounts, not 2', accounts;
  END IF;
  RAISE NOTICE 'ok  the same file twice is the same money once, and a code is a code whatever its case';
END $$;

-- -------------------------------------------------------------
-- 3. A row the import will not take is counted, not lost.
-- -------------------------------------------------------------
DO $$
DECLARE i UUID; r RECORD; logged INTEGER;
BEGIN
  PERFORM pg_temp.act_as('80000000-0000-0000-0000-000000000001');
  i := protean_start_import('invoices', 'ragged.csv');
  SELECT * INTO r FROM protean_take_invoices(i, '[
    {"invoice_no":"2001","alpha":"CEE","protean_name":"Cee Ltd","tax_point":"2026-03-01","net":"10"},
    {"invoice_no":"2002","alpha":"CEE","protean_name":"Cee Ltd","tax_point":null,"net":"99"},
    {"invoice_no":"","alpha":"CEE","protean_name":"Cee Ltd","tax_point":"2026-03-02","net":"99"}
  ]'::JSONB);

  IF r.rows_read <> 3 THEN RAISE EXCEPTION 'it read % rows, not 3', r.rows_read; END IF;
  IF r.rows_skipped <> 2 THEN RAISE EXCEPTION 'it skipped % rows, not 2', r.rows_skipped; END IF;
  IF r.rows_new <> 1 THEN RAISE EXCEPTION 'it took % rows, not 1', r.rows_new; END IF;

  SELECT rows_skipped INTO logged FROM protean_imports WHERE id = i;
  IF logged <> 2 THEN RAISE EXCEPTION 'the import log says % were skipped', logged; END IF;
  RAISE NOTICE 'ok  a row without a date or a number is counted as skipped, and the log says so';
END $$;

-- -------------------------------------------------------------
-- 4. Revenue on an account nobody has identified yet is still stored.
-- -------------------------------------------------------------
DO $$
DECLARE waiting INTEGER; weight NUMERIC;
BEGIN
  PERFORM pg_temp.act_as('80000000-0000-0000-0000-000000000001');
  SELECT count(*) INTO waiting FROM protean_to_moderate();
  IF waiting <> 3 THEN RAISE EXCEPTION '% accounts are waiting, not 3', waiting; END IF;

  SELECT net INTO weight FROM protean_to_moderate() WHERE alpha = 'ACME';
  IF weight <> 1500 THEN RAISE EXCEPTION 'the queue values Acme at %, not 1500', weight; END IF;

  /* Heaviest first, because that is the order worth working through. */
  IF (SELECT alpha FROM protean_to_moderate() LIMIT 1) <> 'ACME' THEN
    RAISE EXCEPTION 'the queue is not ordered by what the account has billed';
  END IF;
  RAISE NOTICE 'ok  an unidentified account keeps its revenue and waits, heaviest first';
END $$;

-- -------------------------------------------------------------
-- 5. Saying who an account is, and what that does to the record.
-- -------------------------------------------------------------
DO $$
DECLARE made UUID; rel TEXT; spent NUMERIC; waiting INTEGER;
BEGIN
  PERFORM pg_temp.act_as('80000000-0000-0000-0000-000000000001');

  made := protean_make_customer('ACME');
  SELECT relationship INTO rel FROM crm_contacts WHERE id = made;
  IF rel <> 'existing' THEN
    RAISE EXCEPTION 'a company that is billing us reads as a %', rel;
  END IF;

  SELECT net INTO spent FROM protean_spend(made) WHERE year = 2026;
  IF spent <> 1500 THEN RAISE EXCEPTION 'the new record shows %, not 1500', spent; END IF;

  SELECT count(*) INTO waiting FROM protean_to_moderate();
  IF waiting <> 2 THEN RAISE EXCEPTION 'the queue still has % after a decision', waiting; END IF;

  /* Twice would make a second Acme, and both would look right. */
  BEGIN
    made := protean_make_customer('ACME');
    RAISE EXCEPTION 'the same account made a customer twice';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM = 'the same account made a customer twice' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'ok  a decision makes the record, moves its revenue onto it, and cannot be taken twice';
END $$;

-- -------------------------------------------------------------
-- 6. Setting one aside keeps it out of the queue and out of a
--    salesperson's numbers, without hiding the money.
-- -------------------------------------------------------------
DO $$
DECLARE waiting INTEGER; still NUMERIC;
BEGIN
  PERFORM pg_temp.act_as('80000000-0000-0000-0000-000000000001');
  PERFORM protean_ignore('BEES', 'our own leasing company');
  SELECT count(*) INTO waiting FROM protean_to_moderate();
  IF waiting <> 1 THEN RAISE EXCEPTION '% are waiting after one was set aside', waiting; END IF;

  SELECT SUM(net) INTO still FROM protean_invoices WHERE alpha = 'BEES';
  IF still <> 250 THEN RAISE EXCEPTION 'setting an account aside lost its invoices'; END IF;
  RAISE NOTICE 'ok  an account set aside leaves the queue and keeps its invoices';
END $$;

-- -------------------------------------------------------------
-- 7. THE ONE THAT MATTERS. A file arriving in batches must not close
--    the jobs its own later batches are about to confirm.
-- -------------------------------------------------------------
DO $$
DECLARE i UUID; r RECORD; closed INTEGER; open_now INTEGER;
BEGIN
  PERFORM pg_temp.act_as('80000000-0000-0000-0000-000000000001');

  /* Last week: three jobs open. */
  i := protean_start_import('open_jobs', 'last week.csv');
  SELECT * INTO r FROM protean_take_open_jobs(i, '[
    {"job_no":"J1","protean_name":"Acme Haulage Ltd","job_total":"100","logged_on":"2026-02-01"},
    {"job_no":"J2","protean_name":"Acme Haulage Ltd","job_total":"200","logged_on":"2026-02-02"},
    {"job_no":"J3","protean_name":"Bees Transport","job_total":"300","logged_on":"2026-02-03"}
  ]'::JSONB);
  IF r.rows_new <> 3 THEN RAISE EXCEPTION 'the first snapshot took % jobs', r.rows_new; END IF;
  closed := protean_finish_open_jobs(i);
  IF closed <> 0 THEN RAISE EXCEPTION 'the first snapshot closed % jobs', closed; END IF;

  /* This week, in two slices. J3 has gone; J4 is new. */
  i := protean_start_import('open_jobs', 'this week.csv');
  PERFORM protean_take_open_jobs(i, '[
    {"job_no":"J1","protean_name":"Acme Haulage Ltd","job_total":"150","logged_on":"2026-02-01"}
  ]'::JSONB);

  /* Between the slices, J2 must still be open. If closing happened per
     batch, it would already be shut. */
  SELECT count(*) INTO open_now FROM protean_open_jobs WHERE still_open;
  IF open_now <> 3 THEN
    RAISE EXCEPTION 'a half sent file already closed jobs: % still open, not 3', open_now;
  END IF;

  PERFORM protean_take_open_jobs(i, '[
    {"job_no":"J2","protean_name":"Acme Haulage Ltd","job_total":"200","logged_on":"2026-02-02"},
    {"job_no":"J4","protean_name":"Acme Haulage Ltd","job_total":"400","logged_on":"2026-02-10"}
  ]'::JSONB);

  closed := protean_finish_open_jobs(i);
  IF closed <> 1 THEN RAISE EXCEPTION 'the snapshot closed % jobs, not 1', closed; END IF;
  IF (SELECT still_open FROM protean_open_jobs WHERE job_no = 'J3') THEN
    RAISE EXCEPTION 'a job that has gone from the export is still open';
  END IF;
  IF NOT (SELECT still_open FROM protean_open_jobs WHERE job_no = 'J2') THEN
    RAISE EXCEPTION 'a job in the second half of the file was closed by the first half';
  END IF;
  IF (SELECT job_total FROM protean_open_jobs WHERE job_no = 'J1') <> 150 THEN
    RAISE EXCEPTION 'a job that is still open did not take this week''s figure';
  END IF;
  RAISE NOTICE 'ok  a snapshot closes only what it has really stopped seeing, whatever it arrives in';
END $$;

-- -------------------------------------------------------------
-- 8. An empty file closes nothing at all.
-- -------------------------------------------------------------
DO $$
DECLARE i UUID; open_before INTEGER; open_after INTEGER;
BEGIN
  PERFORM pg_temp.act_as('80000000-0000-0000-0000-000000000001');
  SELECT count(*) INTO open_before FROM protean_open_jobs WHERE still_open;

  i := protean_start_import('open_jobs', 'empty.csv');
  PERFORM protean_take_open_jobs(i, '[]'::JSONB);
  BEGIN
    PERFORM protean_finish_open_jobs(i);
    RAISE EXCEPTION 'an empty file closed the workshop';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM = 'an empty file closed the workshop' THEN RAISE; END IF;
  END;

  SELECT count(*) INTO open_after FROM protean_open_jobs WHERE still_open;
  IF open_after <> open_before THEN
    RAISE EXCEPTION 'an empty file closed % jobs', open_before - open_after;
  END IF;
  RAISE NOTICE 'ok  a file that landed nothing closes nothing';
END $$;

-- -------------------------------------------------------------
-- 9. A job resolves onto the account whose name it carries, and one
--    that matches nothing is still stored and still counted.
-- -------------------------------------------------------------
DO $$
DECLARE bound TEXT; i UUID; r RECORD;
BEGIN
  PERFORM pg_temp.act_as('80000000-0000-0000-0000-000000000001');
  SELECT alpha INTO bound FROM protean_open_jobs WHERE job_no = 'J4';
  IF bound <> 'ACME' THEN
    RAISE EXCEPTION 'a job on Acme Haulage resolved to %', COALESCE(bound, 'nobody');
  END IF;

  i := protean_start_import('open_jobs', 'a stranger.csv');
  SELECT * INTO r FROM protean_take_open_jobs(i, '[
    {"job_no":"J9","protean_name":"Somebody We Have Never Billed","job_total":"50"}
  ]'::JSONB);
  IF r.rows_unmatched <> 1 THEN
    RAISE EXCEPTION 'a job for a company we have never billed was not reported as unmatched';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM protean_open_jobs WHERE job_no = 'J9') THEN
    RAISE EXCEPTION 'a job we could not place was thrown away';
  END IF;
  RAISE NOTICE 'ok  a job finds its account by name, and one that cannot is kept and reported';
END $$;

-- -------------------------------------------------------------
-- 10. A real file, in the number of slices a real file takes.
--
-- 20,817 invoices at 500 a slice is 42 calls in one session. Three
-- calls proves nothing about forty two: a plpgsql function that builds
-- a temp table caches a plan referencing it, and the classic symptom is
-- "relation with OID does not exist" on a later call. It passes in
-- testing and fails on the first real import.
-- -------------------------------------------------------------
DO $$
DECLARE i UUID; n INTEGER; total NUMERIC;
BEGIN
  PERFORM pg_temp.act_as('80000000-0000-0000-0000-000000000001');
  FOR n IN 1..45 LOOP
    i := protean_start_import('invoices', 'a real sized file');
    PERFORM protean_take_invoices(i, jsonb_build_array(jsonb_build_object(
      'invoice_no', 'S' || n, 'alpha', 'SLICE', 'protean_name', 'Slice Ltd',
      'tax_point', '2026-02-01', 'net', '100')));
  END LOOP;

  SELECT count(*), SUM(net) INTO n, total FROM protean_invoices WHERE alpha = 'SLICE';
  IF n <> 45 OR total <> 4500 THEN
    RAISE EXCEPTION 'forty five slices landed % rows worth %, not 45 and 4500', n, total;
  END IF;
  RAISE NOTICE 'ok  a file arriving in forty five slices lands whole';
END $$;

ROLLBACK;
