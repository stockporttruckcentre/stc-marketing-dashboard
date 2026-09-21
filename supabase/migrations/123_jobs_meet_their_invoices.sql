-- =============================================================
-- 123. A job, the invoice that settled it, and the wait in between.
--
-- From the business:
--
--   does it know to take it that the list I've attached is a verified
--   list of open jobs, and any jobs it has down as open currently are
--   no longer open and therefore must resolve to an invoice? The list
--   of invoices I import holds the job number the invoice relates to on
--   the same list so it should be wired to dynamically elevate the
--   status of an open job. If I upload a list of open jobs and an open
--   job already on the system isn't found, it would assume an invoice
--   matches it, but if an invoice isn't uploaded yet then it should
--   hold the record and await an invoice being uploaded. Again when I
--   upload my updated invoices for this week it should be looking for
--   those now-assumed-to-be-invoiced jobs to match it up.
--
-- Half of that was already here. The open jobs export is treated as a
-- snapshot, `protean_would_close` reports what leaving the list would
-- close, and a person confirms before `protean_finish_open_jobs` closes
-- it. What was missing is everything after that: a job that fell off
-- the list was simply closed, and no invoice was ever matched to it.
--
-- ---- Which column is the job number ----
--
-- Not a guess. The Protean sales invoice export carries BOTH an
-- `Invoice No` and a `Document No`, and on the real export of
-- 21 September 2026:
--
--   Invoice No   runs 296xxx to 297xxx      0 of 382 fall in the job band
--   Document No  runs 224xxx to 251xxx    359 of 369 fall in the job band
--   Job No       runs 224688 to 251973
--
-- `Document No` is the job. `Invoice No` is a separate sequence that
-- never overlaps it. And none of the 382 document numbers is a job that
-- is still open today, which is the model confirming itself: a job
-- drops off the open list precisely because it has been invoiced.
--
-- Thirteen of the 382 invoices carry no document number at all. Those
-- are invoices raised against no job, and they match nothing, which is
-- correct rather than a failure.
--
-- The Sage rental export also has a `Document No`, and there it IS the
-- invoice number. So the job number is read only from the Protean
-- shape, and `readSage` leaves it null.
--
-- ---- The three states a job can be in ----
--
--   still_open = TRUE                     on the list, being worked
--   still_open = FALSE, settled_by NULL   off the list, awaiting an invoice
--   still_open = FALSE, settled_by set    invoiced, and by which invoice
--
-- `still_open` keeps its meaning, so every query that reads it, and
-- there are a dozen, carries on answering what it always answered. The
-- new state is the absence of a settlement rather than a new value in
-- an old column.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The job number on an invoice, and the invoice on a job.
-- -------------------------------------------------------------
ALTER TABLE protean_invoices
  ADD COLUMN IF NOT EXISTS job_no TEXT;

COMMENT ON COLUMN protean_invoices.job_no IS
  'The Protean job this invoice settles, read from Document No. Null on a '
  'Sage rental invoice, on a trailer sale, and on any invoice raised against no job.';

ALTER TABLE protean_open_jobs
  ADD COLUMN IF NOT EXISTS settled_by  TEXT,
  ADD COLUMN IF NOT EXISTS settled_on  DATE,
  /* Every invoice carrying this job number, added up, because a job can
     be invoiced in parts and "what did we actually bill for it" is the
     question somebody asks next. */
  ADD COLUMN IF NOT EXISTS settled_net NUMERIC(12,2);

COMMENT ON COLUMN protean_open_jobs.settled_by IS
  'The earliest invoice carrying this job number. Null means the job is off '
  'the open list and no invoice has arrived for it yet.';

/* Finding an invoice by its job number is the whole operation, so it is
   indexed. Partial, because most invoices in the table are rental and
   trailer rows that carry no job number at all. */
CREATE INDEX IF NOT EXISTS idx_protean_invoices_job
  ON protean_invoices (division, job_no) WHERE job_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_protean_jobs_awaiting
  ON protean_open_jobs (division, last_seen DESC)
  WHERE NOT still_open AND settled_by IS NULL;

-- -------------------------------------------------------------
-- 1b. The job number on every invoice already here.
--
-- `document_no` has been stored since migration 077. On the Protean
-- maintenance export that column IS the job, so every invoice already
-- on the system can say which job it settled without re-importing
-- anything, and the whole history lines up rather than only this week
-- forward.
--
-- Only where it looks like a job number, which leaves `Multiple` out.
-- Only on divisions whose invoices come from Protean maintenance: on
-- the Sage rental export `Document No` is the invoice number, and a
-- trailer sale has no job at all.
--
-- This fills a column that is null. It changes no existing value, and
-- setting `job_no` back to null undoes all of it. MATCHING is a
-- separate step and is not run here: filling the column is reversible
-- arithmetic, and settling a job is a statement about the workshop
-- that somebody should look at first.
-- -------------------------------------------------------------
UPDATE protean_invoices
   SET job_no = document_no
 WHERE job_no IS NULL
   AND division = 'stc'
   AND document_no IS NOT NULL
   AND document_no ~ '^[0-9]+$';

DO $$
DECLARE n INTEGER; m INTEGER;
BEGIN
  SELECT count(*) INTO n FROM protean_invoices WHERE division = 'stc' AND job_no IS NOT NULL;
  SELECT count(*) INTO m FROM protean_invoices
   WHERE division = 'stc' AND job_no IS NULL AND document_no = 'Multiple';
  RAISE NOTICE 'ok  % maintenance invoices now name the job they settled', n;
  IF m > 0 THEN
    RAISE NOTICE '    % of them cover several jobs and name none of them', m;
  END IF;
END $$;

-- -------------------------------------------------------------
-- 2. Matching, in both directions, from whichever side arrives.
--
-- Run after an invoice import, to settle jobs that were waiting. Run
-- after an open jobs import, to settle jobs that have just left the
-- list and whose invoice is already here. One function either way: the
-- rule is the same and two copies of it would drift.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS protean_match_jobs_to_invoices(TEXT);

CREATE OR REPLACE FUNCTION protean_match_jobs_to_invoices(p_division TEXT DEFAULT NULL)
RETURNS TABLE (matched INTEGER, still_waiting INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE hit INTEGER := 0;
BEGIN
  IF NOT command_may('revenue.import') THEN
    RAISE EXCEPTION 'Matching invoices to jobs needs permission to import revenue.';
  END IF;

  /* The earliest invoice carrying the job number settles it, and every
     invoice carrying it is added up. Part invoicing is normal: the job
     is settled once, and the money is all of it. */
  WITH billed AS (
    SELECT i.division, i.job_no,
           MIN(i.tax_point)                              AS first_on,
           SUM(i.net)                                    AS total_net,
           (ARRAY_AGG(i.invoice_no ORDER BY i.tax_point, i.invoice_no))[1] AS first_invoice
      FROM protean_invoices i
     WHERE i.job_no IS NOT NULL
       AND (p_division IS NULL OR i.division = p_division)
     GROUP BY i.division, i.job_no
  ),
  done AS (
    UPDATE protean_open_jobs j
       SET settled_by  = b.first_invoice,
           settled_on  = b.first_on,
           settled_net = b.total_net,
           /* An invoice is the end of a job. A job still showing open
              when its invoice arrives is closed by the invoice, which
              is the "dynamically elevate the status" the business asked
              for: the invoice is the authority, not the snapshot. */
           still_open  = FALSE
      FROM billed b
     WHERE b.division = j.division
       AND b.job_no = j.job_no
       AND (j.settled_by IS DISTINCT FROM b.first_invoice
            OR j.settled_net IS DISTINCT FROM b.total_net
            OR j.still_open)
    RETURNING 1
  )
  SELECT count(*)::INTEGER INTO hit FROM done;

  RETURN QUERY
  SELECT hit,
         (SELECT count(*)::INTEGER FROM protean_open_jobs w
           WHERE NOT w.still_open AND w.settled_by IS NULL
             AND (p_division IS NULL OR w.division = p_division));
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_match_jobs_to_invoices(TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 3. The jobs that are waiting, so somebody can look at them.
--
-- A list, not a number. "Seventeen jobs are waiting" is a fact nobody
-- can act on; the seventeen job numbers, their customer and what the
-- job was worth is a list somebody takes to Protean and asks about.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS protean_awaiting_invoice(TEXT);

CREATE OR REPLACE FUNCTION protean_awaiting_invoice(p_division TEXT DEFAULT NULL)
RETURNS TABLE (
  division      TEXT,
  job_no        TEXT,
  protean_name  TEXT,
  depot         TEXT,
  job_type      TEXT,
  job_total     NUMERIC,
  logged_on     DATE,
  /* When it was last seen on an open jobs export, which is how long it
     has been waiting. */
  left_list_on  DATE,
  days_waiting  INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('revenue.view') THEN
    RAISE EXCEPTION 'Reading what is waiting on an invoice needs access to revenue.';
  END IF;

  RETURN QUERY
  SELECT j.division, j.job_no, j.protean_name, j.depot, j.job_type,
         j.job_total, j.logged_on,
         j.last_seen::DATE,
         (CURRENT_DATE - j.last_seen::DATE)::INTEGER
    FROM protean_open_jobs j
   WHERE NOT j.still_open
     AND j.settled_by IS NULL
     AND (p_division IS NULL OR j.division = p_division)
   ORDER BY j.last_seen, j.job_total DESC NULLS LAST;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_awaiting_invoice(TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 4. What closing would do, now that closing has two outcomes.
--
-- The question on the screen used to be "close 41 jobs?". It is now
-- "close 41 jobs, of which 33 already have an invoice and 8 will wait
-- for one", which is the difference between confirming a number and
-- reading one.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS protean_would_close(UUID);

CREATE OR REPLACE FUNCTION protean_would_close(p_import UUID)
RETURNS TABLE (would_close INTEGER, open_now INTEGER, in_this_file INTEGER,
               biggest_job TEXT, biggest_value NUMERIC,
               /* Of the ones going, how many an invoice is already here
                  for, and how many will be held waiting for one. */
               already_invoiced INTEGER, will_wait INTEGER)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE div TEXT;
BEGIN
  IF NOT command_may('crm.import') THEN
    RAISE EXCEPTION 'Reading what an import would close needs permission to import into the CRM.';
  END IF;
  SELECT protean_imports.division INTO div
    FROM protean_imports WHERE id = p_import AND kind = 'open_jobs';
  IF div IS NULL THEN RAISE EXCEPTION 'That is not an open jobs import.'; END IF;

  RETURN QUERY
  WITH going AS (
    SELECT j.job_no, j.job_total,
           EXISTS (SELECT 1 FROM protean_invoices i
                    WHERE i.division = j.division AND i.job_no = j.job_no) AS billed
      FROM protean_open_jobs j
     WHERE j.division = div AND j.still_open AND (j.last_batch IS DISTINCT FROM p_import)
  )
  SELECT (SELECT count(*)::INTEGER FROM going),
         (SELECT count(*)::INTEGER FROM protean_open_jobs o
           WHERE o.division = div AND o.still_open),
         (SELECT count(*)::INTEGER FROM protean_open_jobs o WHERE o.last_batch = p_import),
         (SELECT g.job_no FROM going g ORDER BY g.job_total DESC NULLS LAST, g.job_no LIMIT 1),
         (SELECT COALESCE(SUM(g.job_total), 0)::NUMERIC FROM going g),
         (SELECT count(*)::INTEGER FROM going g WHERE g.billed),
         (SELECT count(*)::INTEGER FROM going g WHERE NOT g.billed);
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_would_close(UUID) TO authenticated;

-- -------------------------------------------------------------
-- 5. Closing runs the match straight afterwards.
--
-- Otherwise every job that leaves the list sits as "awaiting an
-- invoice" until the next invoice import, including the ones whose
-- invoice landed an hour ago.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION protean_finish_open_jobs(p_import UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE closed INTEGER; div TEXT;
BEGIN
  IF NOT command_may('crm.import') THEN
    RAISE EXCEPTION 'Importing open jobs needs permission to import into the CRM.';
  END IF;
  SELECT protean_imports.division INTO div
    FROM protean_imports WHERE id = p_import AND kind = 'open_jobs';
  IF div IS NULL THEN RAISE EXCEPTION 'That is not an open jobs import.'; END IF;

  IF NOT EXISTS (SELECT 1 FROM protean_open_jobs WHERE last_batch = p_import) THEN
    RAISE EXCEPTION 'That import has no jobs in it, so there is nothing to compare against.';
  END IF;

  UPDATE protean_open_jobs
     SET still_open = FALSE
   WHERE division = div AND still_open AND (last_batch IS DISTINCT FROM p_import);
  GET DIAGNOSTICS closed = ROW_COUNT;

  PERFORM protean_match_jobs_to_invoices(div);

  UPDATE protean_imports SET rows_closed = closed WHERE id = p_import;
  RETURN closed;
END;
$fn$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'protean_invoices' AND column_name = 'job_no') THEN
    RAISE EXCEPTION 'an invoice still cannot say which job it settled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'protean_open_jobs' AND column_name = 'settled_by') THEN
    RAISE EXCEPTION 'a job still cannot say which invoice settled it';
  END IF;
  RAISE NOTICE 'ok  a job can be open, waiting on an invoice, or settled by one';
END $$;

-- -------------------------------------------------------------
-- 6. The invoice import carries the job number in.
--
-- Everything else about this function is exactly what migration 084
-- left. Re-stated in full rather than patched, because that is how a
-- plpgsql function changes and a half quoted one is worse than a long
-- one. The three new places are `job_no`: read off the row, written on
-- insert, and kept in step on conflict.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS protean_take_invoices(UUID, JSONB);

CREATE OR REPLACE FUNCTION protean_take_invoices(p_import UUID, p_rows JSONB)
RETURNS TABLE (rows_read INTEGER, rows_new INTEGER, rows_updated INTEGER,
               rows_skipped INTEGER, accounts_new INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  read_n INTEGER := 0; new_n INTEGER := 0; updated_n INTEGER := 0;
  skipped_n INTEGER := 0; acc_n INTEGER := 0;
  div TEXT;
BEGIN
  IF NOT command_may('crm.import') THEN
    RAISE EXCEPTION 'Importing what was billed needs permission to import into the CRM.';
  END IF;
  SELECT division INTO div FROM protean_imports WHERE id = p_import AND kind = 'invoices';
  IF div IS NULL THEN
    RAISE EXCEPTION 'That is not an invoice import.';
  END IF;

  CREATE TEMP TABLE incoming ON COMMIT DROP AS
  SELECT NULLIF(btrim(r ->> 'invoice_no'), '')   AS invoice_no,
         NULLIF(btrim(r ->> 'document_no'), '')  AS document_no,
         NULLIF(btrim(r ->> 'job_no'), '')       AS job_no,
         upper(NULLIF(btrim(r ->> 'alpha'), '')) AS alpha,
         NULLIF(btrim(r ->> 'customer_ref'), '') AS customer_ref,
         NULLIF(btrim(r ->> 'protean_name'), '') AS protean_name,
         NULLIF(btrim(r ->> 'site_name'), '')    AS site_name,
         (r ->> 'created_on')::DATE              AS created_on,
         (r ->> 'tax_point')::DATE               AS tax_point,
         (r ->> 'due_on')::DATE                  AS due_on,
         NULLIF(btrim(r ->> 'created_by'), '')   AS created_by,
         (r ->> 'net')::NUMERIC                  AS net,
         (r ->> 'tax')::NUMERIC                  AS tax,
         (r ->> 'gross')::NUMERIC                AS gross
    FROM jsonb_array_elements(p_rows) AS r;

  SELECT count(*)::INTEGER INTO read_n FROM incoming;

  DELETE FROM incoming
   WHERE invoice_no IS NULL OR alpha IS NULL OR tax_point IS NULL OR net IS NULL;
  GET DIAGNOSTICS skipped_n = ROW_COUNT;

  DELETE FROM incoming a USING incoming b
   WHERE a.invoice_no = b.invoice_no AND a.ctid > b.ctid;

  WITH seen AS (
    SELECT DISTINCT ON (alpha) alpha, protean_name
      FROM incoming WHERE alpha IS NOT NULL
     ORDER BY alpha, protean_name
  ),
  put AS (
    INSERT INTO protean_accounts (division, alpha, protean_name, last_seen)
    SELECT div, alpha, COALESCE(protean_name, alpha), NOW() FROM seen
    ON CONFLICT (division, alpha) DO UPDATE SET last_seen = NOW()
    RETURNING (xmax = 0) AS fresh
  )
  SELECT count(*) FILTER (WHERE fresh)::INTEGER INTO acc_n FROM put;

  WITH put AS (
    INSERT INTO protean_invoices (
      division, invoice_no, document_no, job_no, alpha, customer_ref, protean_name, site_name,
      created_on, tax_point, due_on, created_by, net, tax, gross)
    SELECT div, invoice_no, document_no, job_no, alpha, customer_ref, protean_name, site_name,
           created_on, tax_point, due_on, created_by, net, tax, gross
      FROM incoming
    ON CONFLICT (division, invoice_no) DO UPDATE SET
      document_no = EXCLUDED.document_no, job_no = EXCLUDED.job_no,
      alpha = EXCLUDED.alpha,
      customer_ref = EXCLUDED.customer_ref, protean_name = EXCLUDED.protean_name,
      site_name = EXCLUDED.site_name, created_on = EXCLUDED.created_on,
      tax_point = EXCLUDED.tax_point, due_on = EXCLUDED.due_on,
      created_by = EXCLUDED.created_by, net = EXCLUDED.net, tax = EXCLUDED.tax,
      gross = EXCLUDED.gross, imported_at = NOW()
    RETURNING (xmax = 0) AS fresh
  )
  SELECT count(*) FILTER (WHERE fresh)::INTEGER,
         count(*) FILTER (WHERE NOT fresh)::INTEGER
    INTO new_n, updated_n FROM put;

  DROP TABLE incoming;

  UPDATE protean_imports
     SET rows_read = protean_imports.rows_read + read_n,
         rows_new = protean_imports.rows_new + new_n,
         rows_updated = protean_imports.rows_updated + updated_n,
         rows_skipped = protean_imports.rows_skipped + skipped_n,
         accounts_new = protean_imports.accounts_new + acc_n
   WHERE id = p_import;

  RETURN QUERY SELECT read_n, new_n, updated_n, skipped_n, acc_n;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_take_invoices(UUID, JSONB) TO authenticated;
