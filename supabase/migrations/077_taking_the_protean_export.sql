-- =============================================================
-- 077. Taking the Protean export.
--
-- 075 built the tables and took direct writes away from `authenticated`,
-- on the grounds that an import landing wrong moves every figure on the
-- analytics screen. It then shipped only the readers, so there was no
-- way in at all. This is the way in.
--
-- ---- Everything arrives as JSON, in batches ----
--
-- The first invoice file is 20,817 rows. That is one statement per
-- batch rather than one per row, and the browser sends it in slices, so
-- a dropped connection halfway leaves the batches that landed and loses
-- only the rest. Re-sending the whole file then fixes it, because every
-- write here is an upsert on Protean's own key.
--
-- ---- The two files are not the same kind of thing ----
--
-- An invoice is a fact that happened. It arrives, it is keyed on
-- `Invoice No`, and it never changes again.
--
-- An open job is a SNAPSHOT of this minute. A job that was in last
-- week's file and is not in this week's has been finished, invoiced or
-- cancelled, and the only way to know that is that it stopped
-- appearing. So the open jobs import is stamped with the batch that saw
-- it, and closing what the batch did not see is a separate, explicit
-- last step: `protean_finish_open_jobs`.
--
-- That separation is deliberate. If closing happened inside each batch,
-- the first slice of a file would close every job the later slices were
-- about to confirm, and a half sent file would read as "almost nothing
-- is open".
--
-- ---- Nothing here binds an account to a customer ----
--
-- An alpha nobody has seen before arrives unbound and stays unbound
-- until a person says who it is. Its invoices are stored either way, so
-- the company total is right from the first import and only the split
-- by customer waits for the moderation. That is the right way round:
-- revenue that is not attributed is visibly missing from somebody's
-- record, whereas revenue attributed to the wrong company is invisible.
-- =============================================================

/* Which batch last saw an open job. See the note above on why closing
   is a separate step from importing. */
ALTER TABLE protean_open_jobs
  ADD COLUMN IF NOT EXISTS last_batch UUID REFERENCES protean_imports ON DELETE SET NULL;

/* Rows the file contained and the import would not take. A file with a
   blank tax point is a real thing and it must be countable rather than
   silently short. */
ALTER TABLE protean_imports
  ADD COLUMN IF NOT EXISTS rows_skipped INTEGER NOT NULL DEFAULT 0;

-- -------------------------------------------------------------
-- 1. Opening an import.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION protean_start_import(p_kind TEXT, p_file TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE made UUID;
BEGIN
  IF NOT command_may('crm.import') THEN
    RAISE EXCEPTION 'Importing what Protean billed needs permission to import into the CRM.';
  END IF;
  IF p_kind NOT IN ('invoices', 'open_jobs') THEN
    RAISE EXCEPTION 'An import is either invoices or open jobs.';
  END IF;

  INSERT INTO protean_imports (kind, by_user, file_name)
  VALUES (p_kind, auth.uid(), p_file)
  RETURNING id INTO made;
  RETURN made;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_start_import(TEXT, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 2. A batch of invoices.
--
-- A row without an invoice number, a tax point or a net figure is not
-- an invoice and is counted as skipped rather than guessed at.
--
-- `ON CONFLICT DO UPDATE` because Protean can reissue a document, and
-- because a person re-sending a file after a failure must not be
-- punished for it. `xmax = 0` is how a row that was inserted is told
-- apart from one that was updated.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION protean_take_invoices(p_import UUID, p_rows JSONB)
RETURNS TABLE (rows_read INTEGER, rows_new INTEGER, rows_updated INTEGER,
               rows_skipped INTEGER, accounts_new INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  read_n    INTEGER := 0;
  new_n     INTEGER := 0;
  updated_n INTEGER := 0;
  skipped_n INTEGER := 0;
  acc_n     INTEGER := 0;
BEGIN
  IF NOT command_may('crm.import') THEN
    RAISE EXCEPTION 'Importing what Protean billed needs permission to import into the CRM.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM protean_imports WHERE id = p_import AND kind = 'invoices') THEN
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

  /* The same invoice number twice inside one file. Keep one, so the
     upsert cannot fail on "cannot affect row a second time". */
  DELETE FROM incoming a
   USING incoming b
   WHERE a.invoice_no = b.invoice_no AND a.ctid > b.ctid;

  /* Accounts first: an invoice references one, and an alpha nobody has
     seen is a new customer to moderate, not a reason to drop revenue. */
  WITH seen AS (
    SELECT DISTINCT ON (alpha) alpha, protean_name
      FROM incoming WHERE alpha IS NOT NULL
     ORDER BY alpha, protean_name
  ),
  put AS (
    INSERT INTO protean_accounts (alpha, protean_name, last_seen)
    SELECT alpha, COALESCE(protean_name, alpha), NOW() FROM seen
    ON CONFLICT (alpha) DO UPDATE SET last_seen = NOW()
    RETURNING (xmax = 0) AS fresh
  )
  SELECT count(*) FILTER (WHERE fresh)::INTEGER INTO acc_n FROM put;

  WITH put AS (
    INSERT INTO protean_invoices (
      invoice_no, document_no, alpha, customer_ref, protean_name, site_name,
      created_on, tax_point, due_on, created_by, net, tax, gross)
    SELECT invoice_no, document_no, alpha, customer_ref, protean_name, site_name,
           created_on, tax_point, due_on, created_by, net, tax, gross
      FROM incoming
    ON CONFLICT (invoice_no) DO UPDATE SET
      document_no = EXCLUDED.document_no,
      alpha       = EXCLUDED.alpha,
      customer_ref = EXCLUDED.customer_ref,
      protean_name = EXCLUDED.protean_name,
      site_name   = EXCLUDED.site_name,
      created_on  = EXCLUDED.created_on,
      tax_point   = EXCLUDED.tax_point,
      due_on      = EXCLUDED.due_on,
      created_by  = EXCLUDED.created_by,
      net         = EXCLUDED.net,
      tax         = EXCLUDED.tax,
      gross       = EXCLUDED.gross,
      imported_at = NOW()
    RETURNING (xmax = 0) AS fresh
  )
  SELECT count(*) FILTER (WHERE fresh)::INTEGER,
         count(*) FILTER (WHERE NOT fresh)::INTEGER
    INTO new_n, updated_n
    FROM put;

  DROP TABLE incoming;

  UPDATE protean_imports
     SET rows_read    = protean_imports.rows_read + read_n,
         rows_new     = protean_imports.rows_new + new_n,
         rows_updated = protean_imports.rows_updated + updated_n,
         rows_skipped = protean_imports.rows_skipped + skipped_n,
         accounts_new = protean_imports.accounts_new + acc_n
   WHERE id = p_import;

  RETURN QUERY SELECT read_n, new_n, updated_n, skipped_n, acc_n;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_take_invoices(UUID, JSONB) TO authenticated;

-- -------------------------------------------------------------
-- 3. A batch of open jobs.
--
-- The alpha is resolved by name, because this export does not carry
-- one. A name that matches nothing leaves the job with a null alpha:
-- still stored, still visible as open work, just not yet anybody's.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION protean_take_open_jobs(p_import UUID, p_rows JSONB)
RETURNS TABLE (rows_read INTEGER, rows_new INTEGER, rows_updated INTEGER,
               rows_skipped INTEGER, rows_unmatched INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  read_n      INTEGER := 0;
  new_n       INTEGER := 0;
  updated_n   INTEGER := 0;
  skipped_n   INTEGER := 0;
  unmatched_n INTEGER := 0;
BEGIN
  IF NOT command_may('crm.import') THEN
    RAISE EXCEPTION 'Importing open jobs needs permission to import into the CRM.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM protean_imports WHERE id = p_import AND kind = 'open_jobs') THEN
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

  DELETE FROM incoming_jobs a
   USING incoming_jobs b
   WHERE a.job_no = b.job_no AND a.ctid > b.ctid;

  SELECT count(*)::INTEGER INTO unmatched_n
    FROM incoming_jobs j
   WHERE NOT EXISTS (SELECT 1 FROM protean_accounts a
                      WHERE lower(a.protean_name) = lower(j.protean_name));

  WITH put AS (
    INSERT INTO protean_open_jobs (
      job_no, equip_no, job_type, status, protean_name, alpha, site, depot,
      logged_on, last_visit_on, entered_by, job_total, order_no, sales_rep,
      mileage, still_open, last_batch, last_seen)
    SELECT j.job_no, j.equip_no, j.job_type, j.status, j.protean_name,
           (SELECT a.alpha FROM protean_accounts a
             WHERE lower(a.protean_name) = lower(j.protean_name) LIMIT 1),
           j.site, j.depot, j.logged_on, j.last_visit_on, j.entered_by,
           j.job_total, j.order_no, j.sales_rep, j.mileage, TRUE, p_import, NOW()
      FROM incoming_jobs j
    ON CONFLICT (job_no) DO UPDATE SET
      equip_no      = EXCLUDED.equip_no,
      job_type      = EXCLUDED.job_type,
      status        = EXCLUDED.status,
      protean_name  = EXCLUDED.protean_name,
      alpha         = COALESCE(EXCLUDED.alpha, protean_open_jobs.alpha),
      site          = EXCLUDED.site,
      depot         = EXCLUDED.depot,
      logged_on     = EXCLUDED.logged_on,
      last_visit_on = EXCLUDED.last_visit_on,
      entered_by    = EXCLUDED.entered_by,
      job_total     = EXCLUDED.job_total,
      order_no      = EXCLUDED.order_no,
      sales_rep     = EXCLUDED.sales_rep,
      mileage       = EXCLUDED.mileage,
      still_open    = TRUE,
      last_batch    = EXCLUDED.last_batch,
      last_seen     = NOW()
    RETURNING (xmax = 0) AS fresh
  )
  SELECT count(*) FILTER (WHERE fresh)::INTEGER,
         count(*) FILTER (WHERE NOT fresh)::INTEGER
    INTO new_n, updated_n
    FROM put;

  DROP TABLE incoming_jobs;

  UPDATE protean_imports
     SET rows_read    = protean_imports.rows_read + read_n,
         rows_new     = protean_imports.rows_new + new_n,
         rows_updated = protean_imports.rows_updated + updated_n,
         rows_skipped = protean_imports.rows_skipped + skipped_n
   WHERE id = p_import;

  RETURN QUERY SELECT read_n, new_n, updated_n, skipped_n, unmatched_n;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_take_open_jobs(UUID, JSONB) TO authenticated;

-- -------------------------------------------------------------
-- 4. Closing what the file did not mention.
--
-- The explicit last step. Called once, after every batch of the file
-- has landed, and never in the middle: see the header.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION protean_finish_open_jobs(p_import UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE closed INTEGER;
BEGIN
  IF NOT command_may('crm.import') THEN
    RAISE EXCEPTION 'Importing open jobs needs permission to import into the CRM.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM protean_imports WHERE id = p_import AND kind = 'open_jobs') THEN
    RAISE EXCEPTION 'That is not an open jobs import.';
  END IF;

  /* A file that landed nothing closes nothing. Otherwise an empty or
     mis-parsed export would report the whole workshop as finished. */
  IF NOT EXISTS (SELECT 1 FROM protean_open_jobs WHERE last_batch = p_import) THEN
    RAISE EXCEPTION 'That import has no jobs in it, so there is nothing to compare against.';
  END IF;

  UPDATE protean_open_jobs
     SET still_open = FALSE
   WHERE still_open AND (last_batch IS DISTINCT FROM p_import);
  GET DIAGNOSTICS closed = ROW_COUNT;

  UPDATE protean_imports SET rows_closed = closed WHERE id = p_import;
  RETURN closed;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_finish_open_jobs(UUID) TO authenticated;

-- -------------------------------------------------------------
-- 5. Saying who an account is.
--
-- The moderation the business asked for: "it'll need tight moderation
-- and should tell us when it's found similar matches or couldn't find a
-- match at all and if we want it to create a crm record."
--
-- Three answers, and all three are a person's:
--
--   bind    this account is that customer
--   make    this account is a customer we do not have yet
--   ignore  this is not a customer at all
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION protean_bind(p_alpha TEXT, p_contact UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Saying which customer a Protean account is needs permission to edit the CRM.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM protean_accounts WHERE alpha = p_alpha) THEN
    RAISE EXCEPTION 'There is no Protean account with that code.';
  END IF;
  IF p_contact IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM crm_contacts WHERE id = p_contact) THEN
    RAISE EXCEPTION 'That customer is not in the CRM.';
  END IF;

  UPDATE protean_accounts
     SET contact_id = p_contact,
         bound_by   = CASE WHEN p_contact IS NULL THEN NULL ELSE auth.uid() END,
         bound_at   = CASE WHEN p_contact IS NULL THEN NULL ELSE NOW() END,
         ignored    = FALSE,
         ignored_why = NULL
   WHERE alpha = p_alpha;

  /* 004 reserved exactly this write: "an account going active there is
     what promotes a prospect, and that is the only automatic write this
     column should ever get." Everything in these exports is billing. */
  IF p_contact IS NOT NULL THEN
    UPDATE crm_contacts SET relationship = 'existing', updated_at = NOW()
     WHERE id = p_contact AND relationship <> 'existing';
  END IF;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_bind(TEXT, UUID) TO authenticated;

-- -------------------------------------------------------------
-- 6. A customer we do not have yet.
--
-- Named as Protean names them, because that is the name the next
-- import will carry and a tidier one here would make every future file
-- fail to match. `crm.create` and not `crm.edit`: this makes a record.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION protean_make_customer(p_alpha TEXT, p_name TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  acc   RECORD;
  made  UUID;
  clean TEXT;
BEGIN
  IF NOT command_may('crm.create') THEN
    RAISE EXCEPTION 'Adding a customer needs permission to create CRM records.';
  END IF;

  SELECT * INTO acc FROM protean_accounts WHERE alpha = p_alpha;
  IF acc.alpha IS NULL THEN
    RAISE EXCEPTION 'There is no Protean account with that code.';
  END IF;
  IF acc.contact_id IS NOT NULL THEN
    RAISE EXCEPTION 'That Protean account is already a customer in the CRM.';
  END IF;

  clean := COALESCE(NULLIF(btrim(COALESCE(p_name, '')), ''), acc.protean_name);

  INSERT INTO crm_contacts (company_name, source, status, relationship)
  VALUES (clean, 'protean', 'customer', 'existing')
  RETURNING id INTO made;

  PERFORM protean_bind(p_alpha, made);
  RETURN made;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_make_customer(TEXT, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 7. Not a customer.
--
-- `Cash Sale` at £536k and the group's own `STC Sales and Leasing
-- Limited` at £1.8m are real revenue and nobody's portfolio. Ignoring
-- keeps them out of a salesperson's figures without hiding them from
-- the company total, and the reason is stored so the next person does
-- not have to guess why.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION protean_ignore(p_alpha TEXT, p_why TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Setting a Protean account aside needs permission to edit the CRM.';
  END IF;
  UPDATE protean_accounts
     SET ignored = TRUE, ignored_why = NULLIF(btrim(COALESCE(p_why, '')), ''),
         contact_id = NULL, bound_by = NULL, bound_at = NULL
   WHERE alpha = p_alpha;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no Protean account with that code.';
  END IF;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_ignore(TEXT, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 8. What is still waiting on a person.
--
-- Ordered by what the account has billed, because the moderation queue
-- is only worth working through in the order the money is in. The
-- candidates are worked out in the application, against the same rules
-- the checks assert, so this returns the accounts and their weight and
-- says nothing about who they might be.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION protean_to_moderate()
RETURNS TABLE (
  alpha        TEXT,
  protean_name TEXT,
  invoices     INTEGER,
  net          NUMERIC,
  first_billed DATE,
  last_billed  DATE,
  open_jobs    INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'The Protean accounts waiting on a decision need access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT a.alpha,
         a.protean_name,
         count(i.invoice_no)::INTEGER,
         COALESCE(SUM(i.net), 0)::NUMERIC,
         min(i.tax_point),
         max(i.tax_point),
         (SELECT count(*)::INTEGER FROM protean_open_jobs j
           WHERE j.alpha = a.alpha AND j.still_open)
    FROM protean_accounts a
    LEFT JOIN protean_invoices i ON i.alpha = a.alpha
   WHERE a.contact_id IS NULL AND NOT a.ignored
   GROUP BY a.alpha, a.protean_name
   ORDER BY 4 DESC, a.protean_name;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_to_moderate() TO authenticated;

-- -------------------------------------------------------------
-- 9. Did it land.
-- -------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'protean_take_invoices') THEN
    RAISE EXCEPTION 'there is still no way to put an export in';
  END IF;
  RAISE NOTICE 'ok  an export can be taken in batches, a snapshot closes only what it has seen, and an account waits for a person';
END $$;
