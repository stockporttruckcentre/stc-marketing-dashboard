-- =============================================================
-- A job, the invoice that settles it, and the wait in between.
--
-- From the business:
--
--   does it know to take it that the list I've attached is a verified
--   list of open jobs, and any jobs it has down as open currently are
--   no longer open and therefore must resolve to an invoice? [...] if
--   an invoice isn't uploaded yet then it should hold the record and
--   await an invoice being uploaded. Again when I upload my updated
--   invoices for this week it should be looking for those
--   now-assumed-to-be-invoiced jobs to match it up.
--
-- Every sentence of that is an assertion below, driven against real
-- PostgreSQL through the same functions the screen calls.
--
-- The data is made up. The SHAPE is taken from the real exports of
-- 21 September 2026: 922 open jobs, 382 invoices, `Document No` as the
-- job number, and thirteen invoices whose document number is the word
-- `Multiple` because one invoice covered several jobs.
--
-- Run with `npm run check:job-invoice`.
-- =============================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('ca000000-0000-0000-0000-000000000001', 'jobs.importer@example.test')
ON CONFLICT DO NOTHING;
UPDATE profiles SET role = 'admin', role_template_id = NULL
 WHERE id = 'ca000000-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claim.sub', 'ca000000-0000-0000-0000-000000000001', TRUE);

DELETE FROM protean_open_jobs;
DELETE FROM protean_invoices;

-- -------------------------------------------------------------
-- Week one. Three jobs open, no invoices.
-- -------------------------------------------------------------
DO $$
DECLARE imp UUID; n INTEGER;
BEGIN
  imp := protean_start_import('open_jobs', 'week1.xlsx', 'stc');
  PERFORM protean_take_open_jobs(imp, '[
    {"job_no":"250001","protean_name":"A Haulier","job_total":100.00,"depot":"Hyde"},
    {"job_no":"250002","protean_name":"A Haulier","job_total":200.00,"depot":"Hyde"},
    {"job_no":"250003","protean_name":"B Transport","job_total":300.00,"depot":"Haydock"}
  ]'::JSONB);

  SELECT count(*) INTO n FROM protean_open_jobs WHERE still_open;
  IF n <> 3 THEN RAISE EXCEPTION 'three jobs went in and % are open', n; END IF;
END $$;

-- -------------------------------------------------------------
-- Week two. 250001 has finished. Its invoice is not here yet, so it
-- must be HELD rather than forgotten.
-- -------------------------------------------------------------
DO $$
DECLARE imp UUID; w RECORD; closed INTEGER; n INTEGER;
BEGIN
  imp := protean_start_import('open_jobs', 'week2.xlsx', 'stc');
  PERFORM protean_take_open_jobs(imp, '[
    {"job_no":"250002","protean_name":"A Haulier","job_total":200.00,"depot":"Hyde"},
    {"job_no":"250003","protean_name":"B Transport","job_total":300.00,"depot":"Haydock"}
  ]'::JSONB);

  SELECT * INTO w FROM protean_would_close(imp);
  IF w.would_close <> 1 THEN RAISE EXCEPTION 'one job left the list and it would close %', w.would_close; END IF;
  IF w.already_invoiced <> 0 THEN RAISE EXCEPTION 'nothing is invoiced yet and it says % are', w.already_invoiced; END IF;
  IF w.will_wait <> 1 THEN RAISE EXCEPTION 'one job should be waiting and it says %', w.will_wait; END IF;

  closed := protean_finish_open_jobs(imp);
  IF closed <> 1 THEN RAISE EXCEPTION 'closing closed % jobs', closed; END IF;

  SELECT count(*) INTO n FROM protean_open_jobs WHERE NOT still_open AND settled_by IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'the finished job is not being held: % waiting', n; END IF;

  SELECT count(*) INTO n FROM protean_awaiting_invoice('stc');
  IF n <> 1 THEN RAISE EXCEPTION 'the waiting list has % on it', n; END IF;
END $$;

-- -------------------------------------------------------------
-- Week three. The invoice arrives and must find the job that has been
-- waiting for it.
-- -------------------------------------------------------------
DO $$
DECLARE imp UUID; m RECORD; j RECORD;
BEGIN
  imp := protean_start_import('invoices', 'week3.xlsx', 'stc');
  PERFORM protean_take_invoices(imp, '[
    {"invoice_no":"297001","document_no":"250001","job_no":"250001","alpha":"AHAUL",
     "protean_name":"A Haulier","tax_point":"2026-09-28","net":100.00}
  ]'::JSONB);

  SELECT * INTO m FROM protean_match_jobs_to_invoices('stc');
  IF m.matched <> 1 THEN RAISE EXCEPTION 'the invoice matched % jobs', m.matched; END IF;
  IF m.still_waiting <> 0 THEN RAISE EXCEPTION '% jobs are still waiting', m.still_waiting; END IF;

  SELECT * INTO j FROM protean_open_jobs WHERE job_no = '250001';
  IF j.settled_by <> '297001' THEN RAISE EXCEPTION 'settled by % rather than the invoice', j.settled_by; END IF;
  IF j.settled_on <> DATE '2026-09-28' THEN RAISE EXCEPTION 'settled on %', j.settled_on; END IF;
  IF j.settled_net <> 100.00 THEN RAISE EXCEPTION 'settled at % rather than the invoiced net', j.settled_net; END IF;
  IF j.still_open THEN RAISE EXCEPTION 'an invoiced job is still showing open'; END IF;
END $$;

-- -------------------------------------------------------------
-- An invoice for a job that is STILL on the list closes it. The
-- invoice is the authority, not the snapshot: "dynamically elevate
-- the status of an open job".
-- -------------------------------------------------------------
DO $$
DECLARE imp UUID; j RECORD;
BEGIN
  imp := protean_start_import('invoices', 'live.xlsx', 'stc');
  PERFORM protean_take_invoices(imp, '[
    {"invoice_no":"297002","document_no":"250002","job_no":"250002","alpha":"AHAUL",
     "protean_name":"A Haulier","tax_point":"2026-09-29","net":120.00},
    {"invoice_no":"297003","document_no":"250002","job_no":"250002","alpha":"AHAUL",
     "protean_name":"A Haulier","tax_point":"2026-09-30","net":80.00}
  ]'::JSONB);
  PERFORM protean_match_jobs_to_invoices('stc');

  SELECT * INTO j FROM protean_open_jobs WHERE job_no = '250002';
  IF j.still_open THEN RAISE EXCEPTION 'the invoice did not close the job it settled'; END IF;
  -- Part invoicing: the EARLIEST invoice settles it, and the money is all of it.
  IF j.settled_by <> '297002' THEN RAISE EXCEPTION 'settled by % rather than the first invoice', j.settled_by; END IF;
  IF j.settled_net <> 200.00 THEN RAISE EXCEPTION 'two invoices totalling 200 recorded as %', j.settled_net; END IF;
END $$;

-- -------------------------------------------------------------
-- Running the match again moves nothing. It is run after every import
-- of either kind, so it has to be free to repeat.
-- -------------------------------------------------------------
DO $$
DECLARE m RECORD;
BEGIN
  SELECT * INTO m FROM protean_match_jobs_to_invoices('stc');
  IF m.matched <> 0 THEN RAISE EXCEPTION 'matching again moved % jobs', m.matched; END IF;
END $$;

-- -------------------------------------------------------------
-- An invoice whose document number is the word `Multiple` settles no
-- job. Thirteen of the 382 on the real export are like this, and
-- 13.7% of that week's revenue. Matching one to a job would be an
-- invention; the money still counts.
-- -------------------------------------------------------------
DO $$
DECLARE imp UUID; n INTEGER; total NUMERIC;
BEGIN
  imp := protean_start_import('invoices', 'multiple.xlsx', 'stc');
  PERFORM protean_take_invoices(imp, '[
    {"invoice_no":"297010","document_no":"Multiple","job_no":null,"alpha":"BTRANS",
     "protean_name":"B Transport","tax_point":"2026-09-30","net":900.00}
  ]'::JSONB);
  PERFORM protean_match_jobs_to_invoices('stc');

  SELECT count(*) INTO n FROM protean_open_jobs WHERE settled_by = '297010';
  IF n <> 0 THEN RAISE EXCEPTION 'a Multiple invoice settled % jobs', n; END IF;

  SELECT COALESCE(SUM(net), 0) INTO total FROM protean_invoices WHERE division = 'stc';
  IF total <> 1200.00 THEN RAISE EXCEPTION 'revenue is % and every invoice should count', total; END IF;

  -- And it is still readable, so somebody can reconcile it by hand.
  SELECT count(*) INTO n FROM protean_invoices
   WHERE division = 'stc' AND job_no IS NULL AND document_no = 'Multiple';
  IF n <> 1 THEN RAISE EXCEPTION 'the Multiple invoice cannot be found again'; END IF;
END $$;

-- -------------------------------------------------------------
-- An invoice in another division settles no maintenance job, even
-- where the numbers collide.
--
-- The first version of this loaded a rental invoice with no job number
-- on it, which is what a real Sage row looks like, and so it could not
-- have caught a missing division guard: a null job number matches
-- nothing whatever the rule is. Taking the guard out left it passing.
--
-- The case that matters is the maintenance invoice file dropped on the
-- Rentals tab by mistake. Those rows DO carry job numbers, and without
-- the division line they would close maintenance jobs while counting
-- as rental revenue. So that is what is loaded here.
-- -------------------------------------------------------------
DO $$
DECLARE imp UUID; j RECORD;
BEGIN
  imp := protean_start_import('invoices', 'maintenance-on-the-wrong-tab.xlsx', 'rental');
  PERFORM protean_take_invoices(imp, '[
    {"invoice_no":"297500","document_no":"250003","job_no":"250003","alpha":"BTRANS",
     "protean_name":"B Transport","tax_point":"2026-09-30","net":5000.00}
  ]'::JSONB);
  PERFORM protean_match_jobs_to_invoices(NULL);

  SELECT * INTO j FROM protean_open_jobs WHERE job_no = '250003';
  IF NOT j.still_open THEN
    RAISE EXCEPTION 'an invoice filed under rental closed maintenance job 250003';
  END IF;
  IF j.settled_by IS NOT NULL THEN
    RAISE EXCEPTION 'maintenance job 250003 was settled by rental invoice %', j.settled_by;
  END IF;
END $$;

ROLLBACK;
