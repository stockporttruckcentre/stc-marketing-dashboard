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
-- 9b. A PARTIAL export, which is the one that would hurt.
--
-- Somebody runs the open jobs report filtered to one depot and drops it
-- in. Every job everywhere else is absent, so the snapshot rule says
-- they are all finished. The empty file guard does not see this: the
-- file has rows in it, they are just not all of them.
--
-- Nothing in the data separates that from a very quiet fortnight, so
-- the fix is not a threshold. It is that the number is readable before
-- anything is closed, and that reading it changes nothing.
-- -------------------------------------------------------------
DO $$
DECLARE i UUID; r RECORD; open_before INTEGER; open_after INTEGER;
BEGIN
  PERFORM pg_temp.act_as('80000000-0000-0000-0000-000000000001');

  /* Four open, at two depots. */
  i := protean_start_import('open_jobs', 'everything.csv');
  PERFORM protean_take_open_jobs(i, '[
    {"job_no":"P1","protean_name":"Acme Haulage Ltd","depot":"Haydock","job_total":"100"},
    {"job_no":"P2","protean_name":"Acme Haulage Ltd","depot":"Haydock","job_total":"200"},
    {"job_no":"P3","protean_name":"Acme Haulage Ltd","depot":"Carrington","job_total":"900"},
    {"job_no":"P4","protean_name":"Acme Haulage Ltd","depot":"Carrington","job_total":"300"}
  ]'::JSONB);
  PERFORM protean_finish_open_jobs(i);

  SELECT count(*) INTO open_before FROM protean_open_jobs WHERE still_open AND job_no LIKE 'P%';
  IF open_before <> 4 THEN RAISE EXCEPTION 'the fixture has % open, not 4', open_before; END IF;

  /* Now only Haydock. */
  i := protean_start_import('open_jobs', 'haydock only.csv');
  PERFORM protean_take_open_jobs(i, '[
    {"job_no":"P1","protean_name":"Acme Haulage Ltd","depot":"Haydock","job_total":"100"},
    {"job_no":"P2","protean_name":"Acme Haulage Ltd","depot":"Haydock","job_total":"200"}
  ]'::JSONB);

  SELECT * INTO r FROM protean_would_close(i);
  IF r.would_close < 2 THEN
    RAISE EXCEPTION 'a partial export says it would close %, so nobody would be warned', r.would_close;
  END IF;
  IF r.in_this_file <> 2 THEN
    RAISE EXCEPTION 'it says the file carried % jobs, not 2', r.in_this_file;
  END IF;
  /* The recognisable detail. Somebody who knows the yard spots a wrong
     answer from a job number faster than from any percentage. */
  IF r.biggest_job IS NULL THEN
    RAISE EXCEPTION 'it cannot name any of the jobs it would close';
  END IF;

  /* And asking must not itself do anything. */
  SELECT count(*) INTO open_after FROM protean_open_jobs WHERE still_open AND job_no LIKE 'P%';
  IF open_after <> 4 THEN
    RAISE EXCEPTION 'reading what would close actually closed % of them', 4 - open_after;
  END IF;

  /* Declining leaves them open, which is the safe answer: the next
     whole export closes them properly. */
  SELECT count(*) INTO open_after FROM protean_open_jobs WHERE still_open AND job_no LIKE 'P%';
  IF open_after <> 4 THEN RAISE EXCEPTION 'declining lost jobs'; END IF;

  RAISE NOTICE 'ok  a partial export says what it would close, and saying it changes nothing';
END $$;

-- -------------------------------------------------------------
-- 9c. And a normal week reads as a normal week.
-- -------------------------------------------------------------
DO $$
DECLARE i UUID; r RECORD; closed INTEGER;
BEGIN
  PERFORM pg_temp.act_as('80000000-0000-0000-0000-000000000001');

  /* Everything again, minus one finished job. */
  i := protean_start_import('open_jobs', 'next week.csv');
  PERFORM protean_take_open_jobs(i, '[
    {"job_no":"P1","protean_name":"Acme Haulage Ltd","depot":"Haydock","job_total":"100"},
    {"job_no":"P2","protean_name":"Acme Haulage Ltd","depot":"Haydock","job_total":"250"},
    {"job_no":"P3","protean_name":"Acme Haulage Ltd","depot":"Carrington","job_total":"900"}
  ]'::JSONB);

  SELECT * INTO r FROM protean_would_close(i);
  IF r.would_close <> 1 THEN
    RAISE EXCEPTION 'a whole export with one job done says it would close %', r.would_close;
  END IF;

  closed := protean_finish_open_jobs(i);
  IF closed <> 1 THEN RAISE EXCEPTION 'it closed % rather than 1', closed; END IF;
  IF (SELECT still_open FROM protean_open_jobs WHERE job_no = 'P4') THEN
    RAISE EXCEPTION 'the finished job is still open';
  END IF;
  IF (SELECT job_total FROM protean_open_jobs WHERE job_no = 'P2') <> 250 THEN
    RAISE EXCEPTION 'a progressed job did not take this week''s figure';
  END IF;
  RAISE NOTICE 'ok  a whole export reads as one job done, and the progressed one updates';
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

-- -------------------------------------------------------------
-- 11. The customer record's own figures, on the company's year.
--
--   ensure this updates CRM records too with an open jobs section,
--   revnue last year vs this year, jobs invoiced total this financial
--   year etc.
--
-- And then, asked directly:  "default april to april always"
--
-- So there is ONE year, from the one setting, and "this year" means it
-- everywhere. The arithmetic that is easy to get one out is which year
-- a date in February belongs to when the year starts in April.
-- -------------------------------------------------------------
DO $$
DECLARE r RECORD;
BEGIN
  PERFORM pg_temp.act_as('80000000-0000-0000-0000-000000000001');

  INSERT INTO crm_contacts (id, company_name, source, status)
  VALUES ('81000000-0000-0000-0000-000000000001', 'Record Test Ltd', 'protean', 'customer')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO protean_accounts (alpha, protean_name, contact_id, bound_at)
  VALUES ('RECTEST', 'Record Test Ltd', '81000000-0000-0000-0000-000000000001', NOW())
  ON CONFLICT (alpha) DO NOTHING;

  INSERT INTO protean_invoices (invoice_no, alpha, tax_point, net) VALUES
    ('R1', 'RECTEST', '2026-05-01', 1000),   -- this April year
    ('R2', 'RECTEST', '2026-02-01',  400),   -- calendar 2026, PREVIOUS April year
    ('R3', 'RECTEST', '2025-05-01',  700),   -- last April year, before the cut
    ('R4', 'RECTEST', '2025-11-01',  900)    -- last April year, AFTER the cut
  ON CONFLICT (invoice_no) DO NOTHING;

  INSERT INTO protean_open_jobs (job_no, protean_name, alpha, job_total, logged_on, still_open)
  VALUES ('RJ1', 'Record Test Ltd', 'RECTEST', 250, '2026-04-02', TRUE),
         ('RJ2', 'Record Test Ltd', 'RECTEST', 150, '2026-06-02', TRUE)
  ON CONFLICT (job_no) DO NOTHING;

  /* Read at 1 June 2026. The year began 1 April 2026. */
  SELECT * INTO r FROM protean_customer('81000000-0000-0000-0000-000000000001', '2026-06-01');

  IF r.fy_started <> '2026-04-01' THEN
    RAISE EXCEPTION 'the year began %, not 1 April 2026', r.fy_started;
  END IF;
  /* R1 only. R2 is February and belongs to the year before, which is
     the whole difference between an April year and a calendar one. */
  IF r.this_year <> 1000 THEN
    RAISE EXCEPTION 'this year reads %, not 1000. February is not in it', r.this_year;
  END IF;
  /* R3 only. R4 is November, after 1 June, so it is not the same point
     last year. */
  IF r.last_year <> 700 THEN
    RAISE EXCEPTION 'the same point last year reads %, not 700', r.last_year;
  END IF;
  IF r.change <> 300 THEN RAISE EXCEPTION 'the change reads %, not 300', r.change; END IF;
  IF r.lifetime <> 3000 THEN RAISE EXCEPTION 'lifetime reads %, not 3000', r.lifetime; END IF;
  IF r.invoices <> 4 THEN RAISE EXCEPTION 'it counts % invoices, not 4', r.invoices; END IF;
  IF r.open_jobs <> 2 OR r.open_value <> 400 THEN
    RAISE EXCEPTION 'open work reads % jobs worth %', r.open_jobs, r.open_value;
  END IF;
  IF r.oldest_open <> '2026-04-02' THEN
    RAISE EXCEPTION 'the oldest open job is %, not 2 April', r.oldest_open;
  END IF;
  RAISE NOTICE 'ok  a record shows the April year, the same point last April year, lifetime and open work';
END $$;

-- -------------------------------------------------------------
-- 11b. The year is a setting, and every screen reads the same one.
--
-- The one that is easy to get one out is February: on an April year, a
-- date in February 2027 belongs to the year that began in April 2026.
-- -------------------------------------------------------------
DO $$
DECLARE m SMALLINT; r RECORD; c RECORD; y RECORD;
BEGIN
  PERFORM pg_temp.act_as('80000000-0000-0000-0000-000000000001');

  SELECT financial_year_start_month INTO m FROM tenant_settings LIMIT 1;
  IF m <> 4 THEN
    RAISE EXCEPTION 'the year starts in month %, and the business said April', m;
  END IF;

  IF financial_year_of('2026-06-01') <> '2026-04-01' THEN
    RAISE EXCEPTION 'June 2026 sits in the year beginning %', financial_year_of('2026-06-01');
  END IF;
  IF financial_year_of('2027-02-01') <> '2026-04-01' THEN
    RAISE EXCEPTION 'February 2027 sits in the year beginning %, not April 2026',
      financial_year_of('2027-02-01');
  END IF;
  IF financial_year_of('2026-03-31') <> '2025-04-01' THEN
    RAISE EXCEPTION '31 March 2026 sits in the year beginning %, not April 2025',
      financial_year_of('2026-03-31');
  END IF;

  /* Every screen, one year. Two figures for one question is how a
     meeting ends up arguing about which is the real one. */
  SELECT * INTO r FROM protean_customer('81000000-0000-0000-0000-000000000001', '2026-06-01');
  SELECT * INTO c FROM protean_company('2026-06-01');
  SELECT * INTO y FROM protean_year_on_year('2026-06-01')
   WHERE contact_id = '81000000-0000-0000-0000-000000000001';

  IF r.fy_started <> c.fy_started OR r.fy_started <> y.fy_started THEN
    RAISE EXCEPTION 'the record, the company and the table disagree about when the year began: %, %, %',
      r.fy_started, c.fy_started, y.fy_started;
  END IF;
  IF y.this_year <> r.this_year OR y.last_year <> r.last_year THEN
    RAISE EXCEPTION 'the customer table says % against the record''s %', y.this_year, r.this_year;
  END IF;

  /* Changing the setting moves them together. */
  UPDATE tenant_settings SET financial_year_start_month = 1;
  SELECT * INTO r FROM protean_customer('81000000-0000-0000-0000-000000000001', '2026-06-01');
  IF r.fy_started <> '2026-01-01' THEN
    RAISE EXCEPTION 'set to January, the year began %', r.fy_started;
  END IF;
  /* Now February IS in it, so the same customer reads 1400. */
  IF r.this_year <> 1400 THEN
    RAISE EXCEPTION 'on a calendar year the same customer reads %, not 1400', r.this_year;
  END IF;
  UPDATE tenant_settings SET financial_year_start_month = 4;

  RAISE NOTICE 'ok  one year, from one setting, and every screen reads the same one';
END $$;

-- -------------------------------------------------------------
-- 11c. A customer nobody has billed still answers.
-- -------------------------------------------------------------
DO $$
DECLARE r RECORD; n INTEGER;
BEGIN
  PERFORM pg_temp.act_as('80000000-0000-0000-0000-000000000001');
  INSERT INTO crm_contacts (id, company_name, source, status)
  VALUES ('81000000-0000-0000-0000-000000000002', 'Never Billed Ltd', 'manual', 'lead')
  ON CONFLICT (id) DO NOTHING;

  SELECT count(*) INTO n FROM protean_customer('81000000-0000-0000-0000-000000000002');
  IF n <> 1 THEN
    RAISE EXCEPTION 'a customer with no Protean account returns % rows, so the record '
                    'cannot tell nothing billed from a failure', n;
  END IF;
  SELECT * INTO r FROM protean_customer('81000000-0000-0000-0000-000000000002');
  IF r.lifetime <> 0 OR r.accounts <> 0 OR r.open_jobs <> 0 THEN
    RAISE EXCEPTION 'a customer nobody billed reads as %, % accounts', r.lifetime, r.accounts;
  END IF;
  RAISE NOTICE 'ok  a customer nobody has billed says so, rather than returning nothing at all';
END $$;

-- -------------------------------------------------------------
-- 12. The company figure analytics reads.
--
-- The trap here is the opposite of the one on a customer record. A
-- customer total leaves out accounts nobody has placed and accounts set
-- aside, which is right: they are not that customer's spend. A COMPANY
-- total that left them out would be short by everything Cash Sale and
-- our own leasing company billed, £2.3m on the real export, with
-- nothing on the screen to say so.
-- -------------------------------------------------------------
DO $$
DECLARE r RECORD; expect_unplaced NUMERIC; expect_aside NUMERIC;
BEGIN
  PERFORM pg_temp.act_as('80000000-0000-0000-0000-000000000001');

  INSERT INTO protean_accounts (alpha, protean_name) VALUES ('NOBODY', 'Nobody Placed Ltd')
  ON CONFLICT (alpha) DO NOTHING;
  INSERT INTO protean_accounts (alpha, protean_name, ignored, ignored_why)
  VALUES ('CASHSALE', 'Cash Sale', TRUE, 'not a customer')
  ON CONFLICT (alpha) DO UPDATE SET ignored = TRUE;

  /* Inside the April year that is running at 1 June 2026. March would
     be the year before, which is the difference this whole migration is
     about. */
  INSERT INTO protean_invoices (invoice_no, alpha, tax_point, net) VALUES
    ('C1', 'NOBODY',   '2026-05-01', 5000),
    ('C2', 'CASHSALE', '2026-05-01', 3000)
  ON CONFLICT (invoice_no) DO NOTHING;

  SELECT * INTO r FROM protean_company('2026-06-01');

  /* Both are in the company total. */
  IF r.this_year < 8000 THEN
    RAISE EXCEPTION 'the company total is %, which cannot include the unplaced and set aside rows',
      r.this_year;
  END IF;
  /* Checked against the same question asked directly, rather than
     against a number counted by hand. Earlier sections of this file
     leave their own unplaced accounts behind, and a hand counted
     figure would break every time somebody adds a fixture above. */
  /* The window comes from the setting, not from a month typed here.
     A check with the year hardcoded would keep passing after somebody
     changed the company's year and stop meaning anything. */
  SELECT COALESCE(SUM(i.net), 0) INTO expect_unplaced
    FROM protean_invoices i JOIN protean_accounts a ON a.alpha = i.alpha
   WHERE a.contact_id IS NULL AND NOT a.ignored
     AND i.tax_point BETWEEN financial_year_of('2026-06-01') AND '2026-06-01';
  SELECT COALESCE(SUM(i.net), 0) INTO expect_aside
    FROM protean_invoices i JOIN protean_accounts a ON a.alpha = i.alpha
   WHERE a.ignored
     AND i.tax_point BETWEEN financial_year_of('2026-06-01') AND '2026-06-01';

  IF r.unattributed <> expect_unplaced THEN
    RAISE EXCEPTION 'it says % is on nobody''s record, and directly it is %',
      r.unattributed, expect_unplaced;
  END IF;
  IF r.set_aside <> expect_aside THEN
    RAISE EXCEPTION 'it says % was set aside, and directly it is %', r.set_aside, expect_aside;
  END IF;
  /* And the two rows this section put there are really in those two
     figures, so the comparison above cannot pass on two zeroes. */
  IF r.unattributed < 5000 THEN
    RAISE EXCEPTION 'the unplaced 5000 is missing from %', r.unattributed;
  END IF;
  IF r.set_aside < 3000 THEN
    RAISE EXCEPTION 'the set aside 3000 is missing from %', r.set_aside;
  END IF;

  /* And the per customer view still leaves them out, which is the
     whole reason the company figure has to say so. */
  IF EXISTS (SELECT 1 FROM protean_year_on_year('2026-06-01') WHERE 'CASHSALE' = ANY(alphas)) THEN
    RAISE EXCEPTION 'an account set aside is being counted as somebody''s customer';
  END IF;

  RAISE NOTICE 'ok  the company total counts everything and says how much of it is on nobody''s record';
END $$;

-- -------------------------------------------------------------
-- 12b. Month by month, including the empty months.
--
-- A chart that skips a month with nothing in it draws a straight line
-- across the gap, and a month where nothing was invoiced then reads as
-- steady trading.
-- -------------------------------------------------------------
DO $$
DECLARE months INTEGER; empties INTEGER; total NUMERIC;
BEGIN
  PERFORM pg_temp.act_as('80000000-0000-0000-0000-000000000001');

  SELECT count(*) INTO months FROM protean_by_month(24, '2026-06-01');
  IF months <> 24 THEN
    RAISE EXCEPTION 'twenty four months asked for, % returned', months;
  END IF;

  SELECT count(*) INTO empties FROM protean_by_month(24, '2026-06-01') WHERE net = 0;
  IF empties = 0 THEN
    RAISE EXCEPTION 'every month has money in it, so empty months are being dropped';
  END IF;

  /* The window ends on the month asked for, not on today. */
  IF (SELECT max(month) FROM protean_by_month(24, '2026-06-01')) <> '2026-06-01' THEN
    RAISE EXCEPTION 'the last month is %, not June 2026',
      (SELECT max(month) FROM protean_by_month(24, '2026-06-01'));
  END IF;
  IF (SELECT min(month) FROM protean_by_month(24, '2026-06-01')) <> '2024-07-01' THEN
    RAISE EXCEPTION 'twenty four months back from June 2026 starts at %, not July 2024',
      (SELECT min(month) FROM protean_by_month(24, '2026-06-01'));
  END IF;

  RAISE NOTICE 'ok  every month in the window comes back, including the ones with nothing in them';
END $$;

-- -------------------------------------------------------------
-- 13. THE ORDER THE FILES ARRIVE IN MUST NOT MATTER.
--
-- The open jobs export carries no account code, only a customer name,
-- and the accounts it matches against are created by the INVOICE file.
-- Sent the other way round there is nothing to match, so every job
-- landed with no account and the screen said "No account" on all
-- thousand of them. Nothing was lost and nothing said what happened.
--
-- The screen now sends invoices first. This asserts the deeper fix:
-- linking is a pass that can be run again, so a job whose customer is
-- first invoiced next month stops being orphaned then rather than
-- staying orphaned forever.
-- -------------------------------------------------------------
DO $$
DECLARE i UUID; linked INTEGER; orphan TEXT; n INTEGER;
BEGIN
  PERFORM pg_temp.act_as('80000000-0000-0000-0000-000000000001');

  /* Jobs FIRST, for a company nobody has ever invoiced. */
  i := protean_start_import('open_jobs', 'jobs before invoices.csv');
  PERFORM protean_take_open_jobs(i, '[
    {"job_no":"O1","protean_name":"Backwards Haulage Ltd","job_total":"500"},
    {"job_no":"O2","protean_name":"Backwards Haulage Ltd","job_total":"250"}
  ]'::JSONB);

  SELECT alpha INTO orphan FROM protean_open_jobs WHERE job_no = 'O1';
  IF orphan IS NOT NULL THEN
    RAISE EXCEPTION 'a job matched an account that did not exist yet';
  END IF;

  /* Now the invoice file arrives and creates the account. */
  i := protean_start_import('invoices', 'invoices after jobs.csv');
  PERFORM protean_take_invoices(i, '[
    {"invoice_no":"B1","alpha":"BACKW","protean_name":"Backwards Haulage Ltd",
     "tax_point":"2026-05-01","net":"1200"}
  ]'::JSONB);

  linked := protean_relink_jobs();
  IF linked < 2 THEN
    RAISE EXCEPTION 'relinking found % jobs, not the 2 that were waiting', linked;
  END IF;

  SELECT alpha INTO orphan FROM protean_open_jobs WHERE job_no = 'O1';
  IF orphan <> 'BACKW' THEN
    RAISE EXCEPTION 'after relinking, O1 points at %, not BACKW', COALESCE(orphan, 'nobody');
  END IF;

  /* Running it again finds nothing, and moves nothing. */
  IF protean_relink_jobs() <> 0 THEN
    RAISE EXCEPTION 'relinking a second time changed something';
  END IF;

  /* And a job for a company we have genuinely never billed stays
     unlinked and is reportable, which is a real answer rather than a
     fault: accounts come from the invoice file. */
  i := protean_start_import('open_jobs', 'a stranger again.csv');
  PERFORM protean_take_open_jobs(i, '[
    {"job_no":"O9","protean_name":"Never Invoiced Anybody Ltd","job_total":"75"}
  ]'::JSONB);
  PERFORM protean_relink_jobs();

  SELECT count(*) INTO n FROM protean_jobs_without_account()
   WHERE protean_name = 'Never Invoiced Anybody Ltd';
  IF n <> 1 THEN
    RAISE EXCEPTION 'a job we cannot place is not reported, it is just null';
  END IF;

  RAISE NOTICE 'ok  jobs find their account whichever file lands first, and one that cannot is named';
END $$;

ROLLBACK;
