-- =============================================================
-- 084. Every figure, by division.
--
-- 083 made division part of the key. This makes it part of every
-- question, because a function that still joins on `alpha` alone would
-- now silently return a customer's rental invoices alongside their
-- maintenance ones and call the total either.
--
-- ---- The rule for reading ----
--
-- Every read takes `p_division`, and NULL means all of them.
--
-- That is deliberate and it is the right way round. The company total
-- is genuinely the sum of the divisions, and Tom asking "what have we
-- billed" wants all of it. A screen showing one division asks for one
-- by name. Defaulting to STC would have made the company figure quietly
-- mean maintenance, which is the mistake the analytics page has been
-- making for a year by counting only trailer sales.
--
-- ---- The rule for writing ----
--
-- The division is stated once, when the import is opened, and every
-- batch reads it back off that row. The alternative is passing it into
-- each call, which is one more chance for the fifteenth slice of a file
-- to disagree with the first fourteen.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Opening an import states its division.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS protean_start_import(TEXT, TEXT);

CREATE FUNCTION protean_start_import(p_kind TEXT, p_file TEXT, p_division TEXT DEFAULT 'stc')
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE made UUID;
BEGIN
  IF NOT command_may('crm.import') THEN
    RAISE EXCEPTION 'Importing what was billed needs permission to import into the CRM.';
  END IF;
  IF p_kind NOT IN ('invoices', 'open_jobs') THEN
    RAISE EXCEPTION 'An import is either invoices or open jobs.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM divisions WHERE slug = p_division) THEN
    RAISE EXCEPTION 'There is no division called %.', p_division;
  END IF;

  INSERT INTO protean_imports (kind, by_user, file_name, division)
  VALUES (p_kind, auth.uid(), p_file, p_division)
  RETURNING id INTO made;
  RETURN made;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_start_import(TEXT, TEXT, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 2. Invoices, into the division the import named.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS protean_take_invoices(UUID, JSONB);

CREATE FUNCTION protean_take_invoices(p_import UUID, p_rows JSONB)
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
      division, invoice_no, document_no, alpha, customer_ref, protean_name, site_name,
      created_on, tax_point, due_on, created_by, net, tax, gross)
    SELECT div, invoice_no, document_no, alpha, customer_ref, protean_name, site_name,
           created_on, tax_point, due_on, created_by, net, tax, gross
      FROM incoming
    ON CONFLICT (division, invoice_no) DO UPDATE SET
      document_no = EXCLUDED.document_no, alpha = EXCLUDED.alpha,
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

-- -------------------------------------------------------------
-- 3. Open jobs, into the same division.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS protean_take_open_jobs(UUID, JSONB);

CREATE FUNCTION protean_take_open_jobs(p_import UUID, p_rows JSONB)
RETURNS TABLE (rows_read INTEGER, rows_new INTEGER, rows_updated INTEGER,
               rows_skipped INTEGER, rows_unmatched INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  read_n INTEGER := 0; new_n INTEGER := 0; updated_n INTEGER := 0;
  skipped_n INTEGER := 0; unmatched_n INTEGER := 0;
  div TEXT;
BEGIN
  IF NOT command_may('crm.import') THEN
    RAISE EXCEPTION 'Importing open jobs needs permission to import into the CRM.';
  END IF;
  SELECT division INTO div FROM protean_imports WHERE id = p_import AND kind = 'open_jobs';
  IF div IS NULL THEN
    RAISE EXCEPTION 'That is not an open jobs import.';
  END IF;

  CREATE TEMP TABLE incoming_jobs ON COMMIT DROP AS
  SELECT NULLIF(btrim(r ->> 'job_no'), '')       AS job_no,
         NULLIF(btrim(r ->> 'equip_no'), '')     AS equip_no,
         NULLIF(btrim(r ->> 'job_type'), '')     AS job_type,
         NULLIF(btrim(r ->> 'status'), '')       AS status,
         NULLIF(btrim(r ->> 'protean_name'), '') AS protean_name,
         NULLIF(btrim(r ->> 'site'), '')         AS site,
         NULLIF(btrim(r ->> 'depot'), '')        AS depot,
         (r ->> 'logged_on')::DATE               AS logged_on,
         (r ->> 'last_visit_on')::DATE           AS last_visit_on,
         NULLIF(btrim(r ->> 'entered_by'), '')   AS entered_by,
         (r ->> 'job_total')::NUMERIC            AS job_total,
         NULLIF(btrim(r ->> 'order_no'), '')     AS order_no,
         NULLIF(btrim(r ->> 'sales_rep'), '')    AS sales_rep,
         NULLIF(btrim(r ->> 'mileage'), '')      AS mileage
    FROM jsonb_array_elements(p_rows) AS r;

  SELECT count(*)::INTEGER INTO read_n FROM incoming_jobs;

  DELETE FROM incoming_jobs WHERE job_no IS NULL OR protean_name IS NULL;
  GET DIAGNOSTICS skipped_n = ROW_COUNT;

  DELETE FROM incoming_jobs a USING incoming_jobs b
   WHERE a.job_no = b.job_no AND a.ctid > b.ctid;

  SELECT count(*)::INTEGER INTO unmatched_n
    FROM incoming_jobs j
   WHERE NOT EXISTS (SELECT 1 FROM protean_accounts a
                      WHERE a.division = div
                        AND lower(a.protean_name) = lower(j.protean_name));

  WITH put AS (
    INSERT INTO protean_open_jobs (
      division, job_no, equip_no, job_type, status, protean_name, alpha, site, depot,
      logged_on, last_visit_on, entered_by, job_total, order_no, sales_rep,
      mileage, still_open, last_batch, last_seen)
    SELECT div, j.job_no, j.equip_no, j.job_type, j.status, j.protean_name,
           (SELECT a.alpha FROM protean_accounts a
             WHERE a.division = div
               AND lower(a.protean_name) = lower(j.protean_name) LIMIT 1),
           j.site, j.depot, j.logged_on, j.last_visit_on, j.entered_by,
           j.job_total, j.order_no, j.sales_rep, j.mileage, TRUE, p_import, NOW()
      FROM incoming_jobs j
    ON CONFLICT (division, job_no) DO UPDATE SET
      equip_no = EXCLUDED.equip_no, job_type = EXCLUDED.job_type,
      status = EXCLUDED.status, protean_name = EXCLUDED.protean_name,
      alpha = COALESCE(EXCLUDED.alpha, protean_open_jobs.alpha),
      site = EXCLUDED.site, depot = EXCLUDED.depot, logged_on = EXCLUDED.logged_on,
      last_visit_on = EXCLUDED.last_visit_on, entered_by = EXCLUDED.entered_by,
      job_total = EXCLUDED.job_total, order_no = EXCLUDED.order_no,
      sales_rep = EXCLUDED.sales_rep, mileage = EXCLUDED.mileage,
      still_open = TRUE, last_batch = EXCLUDED.last_batch, last_seen = NOW()
    RETURNING (xmax = 0) AS fresh
  )
  SELECT count(*) FILTER (WHERE fresh)::INTEGER,
         count(*) FILTER (WHERE NOT fresh)::INTEGER
    INTO new_n, updated_n FROM put;

  DROP TABLE incoming_jobs;

  UPDATE protean_imports
     SET rows_read = protean_imports.rows_read + read_n,
         rows_new = protean_imports.rows_new + new_n,
         rows_updated = protean_imports.rows_updated + updated_n,
         rows_skipped = protean_imports.rows_skipped + skipped_n
   WHERE id = p_import;

  RETURN QUERY SELECT read_n, new_n, updated_n, skipped_n, unmatched_n;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_take_open_jobs(UUID, JSONB) TO authenticated;

-- -------------------------------------------------------------
-- 4. Closing, and what closing would do. WITHIN THE DIVISION.
--
-- This is the one where getting it wrong is loudest. A rental snapshot
-- that closed on everything open would mark the whole maintenance
-- workshop finished, because none of it appears in a rental file.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION protean_would_close(p_import UUID)
RETURNS TABLE (would_close INTEGER, open_now INTEGER, in_this_file INTEGER,
               biggest_job TEXT, biggest_value NUMERIC)
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
  SELECT division INTO div FROM protean_imports WHERE id = p_import AND kind = 'open_jobs';
  IF div IS NULL THEN RAISE EXCEPTION 'That is not an open jobs import.'; END IF;

  RETURN QUERY
  WITH going AS (
    SELECT j.job_no, j.job_total FROM protean_open_jobs j
     WHERE j.division = div AND j.still_open AND (j.last_batch IS DISTINCT FROM p_import)
  )
  SELECT (SELECT count(*)::INTEGER FROM going),
         (SELECT count(*)::INTEGER FROM protean_open_jobs WHERE division = div AND still_open),
         (SELECT count(*)::INTEGER FROM protean_open_jobs WHERE last_batch = p_import),
         (SELECT g.job_no FROM going g ORDER BY g.job_total DESC NULLS LAST, g.job_no LIMIT 1),
         (SELECT COALESCE(SUM(g.job_total), 0)::NUMERIC FROM going g);
END;
$fn$;

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
  SELECT division INTO div FROM protean_imports WHERE id = p_import AND kind = 'open_jobs';
  IF div IS NULL THEN RAISE EXCEPTION 'That is not an open jobs import.'; END IF;

  IF NOT EXISTS (SELECT 1 FROM protean_open_jobs WHERE last_batch = p_import) THEN
    RAISE EXCEPTION 'That import has no jobs in it, so there is nothing to compare against.';
  END IF;

  /* `division = div` is the line that stops a rental snapshot closing
     the maintenance workshop. */
  UPDATE protean_open_jobs
     SET still_open = FALSE
   WHERE division = div AND still_open AND (last_batch IS DISTINCT FROM p_import);
  GET DIAGNOSTICS closed = ROW_COUNT;

  UPDATE protean_imports SET rows_closed = closed WHERE id = p_import;
  RETURN closed;
END;
$fn$;

-- -------------------------------------------------------------
-- 5. Linking jobs to accounts, within the division.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION protean_relink_jobs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE linked INTEGER;
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Linking open jobs to their accounts needs access to the CRM.';
  END IF;

  UPDATE protean_open_jobs j
     SET alpha = a.alpha
    FROM protean_accounts a
   WHERE j.alpha IS NULL
     AND a.division = j.division
     AND lower(btrim(a.protean_name)) = lower(btrim(j.protean_name));
  GET DIAGNOSTICS linked = ROW_COUNT;
  RETURN linked;
END;
$fn$;

DROP FUNCTION IF EXISTS protean_jobs_without_account();

CREATE FUNCTION protean_jobs_without_account(p_division TEXT DEFAULT NULL)
RETURNS TABLE (division TEXT, protean_name TEXT, jobs INTEGER, value NUMERIC)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Open work needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT j.division, j.protean_name, count(*)::INTEGER,
         COALESCE(SUM(j.job_total), 0)::NUMERIC
    FROM protean_open_jobs j
   WHERE j.alpha IS NULL AND j.still_open
     AND (p_division IS NULL OR j.division = p_division)
   GROUP BY j.division, j.protean_name
   ORDER BY 4 DESC, 2;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_jobs_without_account(TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 6. Saying who an account is, now that a code names two companies.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS protean_bind(TEXT, UUID);
DROP FUNCTION IF EXISTS protean_make_customer(TEXT, TEXT);
DROP FUNCTION IF EXISTS protean_ignore(TEXT, TEXT);

CREATE FUNCTION protean_bind(p_division TEXT, p_alpha TEXT, p_contact UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Saying which customer an account is needs permission to edit the CRM.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM protean_accounts
                  WHERE division = p_division AND alpha = p_alpha) THEN
    RAISE EXCEPTION 'There is no % account with that code.', p_division;
  END IF;
  IF p_contact IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM crm_contacts WHERE id = p_contact) THEN
    RAISE EXCEPTION 'That customer is not in the CRM.';
  END IF;

  UPDATE protean_accounts
     SET contact_id = p_contact,
         bound_by = CASE WHEN p_contact IS NULL THEN NULL ELSE auth.uid() END,
         bound_at = CASE WHEN p_contact IS NULL THEN NULL ELSE NOW() END,
         ignored = FALSE, ignored_why = NULL
   WHERE division = p_division AND alpha = p_alpha;

  IF p_contact IS NOT NULL THEN
    UPDATE crm_contacts SET relationship = 'existing', updated_at = NOW()
     WHERE id = p_contact AND relationship <> 'existing';
  END IF;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_bind(TEXT, TEXT, UUID) TO authenticated;

CREATE FUNCTION protean_make_customer(p_division TEXT, p_alpha TEXT, p_name TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE acc RECORD; made UUID; clean TEXT;
BEGIN
  IF NOT command_may('crm.create') THEN
    RAISE EXCEPTION 'Adding a customer needs permission to create CRM records.';
  END IF;

  SELECT * INTO acc FROM protean_accounts
   WHERE division = p_division AND alpha = p_alpha;
  IF acc.alpha IS NULL THEN
    RAISE EXCEPTION 'There is no % account with that code.', p_division;
  END IF;
  IF acc.contact_id IS NOT NULL THEN
    RAISE EXCEPTION 'That account is already a customer in the CRM.';
  END IF;

  clean := COALESCE(NULLIF(btrim(COALESCE(p_name, '')), ''), acc.protean_name);

  INSERT INTO crm_contacts (company_name, source, status, relationship)
  VALUES (clean, 'protean', 'customer', 'existing')
  RETURNING id INTO made;

  PERFORM protean_bind(p_division, p_alpha, made);
  RETURN made;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_make_customer(TEXT, TEXT, TEXT) TO authenticated;

CREATE FUNCTION protean_ignore(p_division TEXT, p_alpha TEXT, p_why TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Setting an account aside needs permission to edit the CRM.';
  END IF;
  UPDATE protean_accounts
     SET ignored = TRUE, ignored_why = NULLIF(btrim(COALESCE(p_why, '')), ''),
         contact_id = NULL, bound_by = NULL, bound_at = NULL
   WHERE division = p_division AND alpha = p_alpha;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no % account with that code.', p_division;
  END IF;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_ignore(TEXT, TEXT, TEXT) TO authenticated;

DROP FUNCTION IF EXISTS protean_to_moderate();

CREATE FUNCTION protean_to_moderate(p_division TEXT DEFAULT NULL)
RETURNS TABLE (division TEXT, alpha TEXT, protean_name TEXT, invoices INTEGER,
               net NUMERIC, first_billed DATE, last_billed DATE, open_jobs INTEGER)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'The accounts waiting on a decision need access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT a.division, a.alpha, a.protean_name,
         count(i.invoice_no)::INTEGER,
         COALESCE(SUM(i.net), 0)::NUMERIC,
         min(i.tax_point), max(i.tax_point),
         (SELECT count(*)::INTEGER FROM protean_open_jobs j
           WHERE j.division = a.division AND j.alpha = a.alpha AND j.still_open)
    FROM protean_accounts a
    LEFT JOIN protean_invoices i ON i.division = a.division AND i.alpha = a.alpha
   WHERE a.contact_id IS NULL AND NOT a.ignored
     AND (p_division IS NULL OR a.division = p_division)
   GROUP BY a.division, a.alpha, a.protean_name
   ORDER BY 5 DESC, a.protean_name;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_to_moderate(TEXT) TO authenticated;

DO $$
BEGIN
  RAISE NOTICE 'ok  imports, moderation and closing all know which division they are in';
END $$;
