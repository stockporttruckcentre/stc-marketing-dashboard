-- =============================================================
-- 086. Open work for a customer we have not invoiced.
--
-- From the business:
--
--   some customers say no account but they're not on the accounts tab
--   to be imported to the crm, saf holland being one of them. it can't
--   physically be pulling figures through to the analytics tab
--   currently as there's no CRM account pulling a value from the
--   Revenue import as the crm account doesn't exist
--
-- Right on both counts. On the real export there are four of them:
--
--   G H Sheldon Wholesale Bakers    2 jobs   £18,626.77
--   Chippindale Plant Limited       3 jobs    £3,508.50
--   Hats Group Limited              4 jobs    £2,291.54
--   SAF Holland                     2 jobs      £200.20
--
-- £24,627 of work on the ramps that no customer record can see.
--
-- ---- Why they were unreachable ----
--
-- Accounts come from the INVOICE file, which is the only export
-- carrying `Alpha`. These four have open work and no invoice since the
-- export began, so no account was ever created for them, so they never
-- appeared in a queue that lists accounts. The moderation screen was
-- answering "which accounts need a customer" when the question is
-- "which WORK needs a customer".
--
-- ---- Why not invent an account ----
--
-- Because we do not know their code. SAF Holland certainly has one in
-- Protean; the open jobs export simply does not carry it. Making one up
-- would collide with the real one the day an invoice arrives, and the
-- collision would be silent.
--
-- So a job may point at a customer DIRECTLY when it has no account.
-- When the real invoice eventually turns up, the account is created,
-- `protean_relink_jobs` fills in the alpha, and the job then reaches
-- the same customer down the ordinary path. The direct link is the
-- fallback, never the preference: every reader takes the account's
-- customer first and only falls back to the job's own.
-- =============================================================

ALTER TABLE protean_open_jobs
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES crm_contacts ON DELETE SET NULL;

COMMENT ON COLUMN protean_open_jobs.contact_id IS
  'Who this job is for, when it has no account to reach them through. '
  'Readers prefer the account''s customer and fall back to this, so an '
  'invoice arriving later takes over cleanly.';

CREATE INDEX IF NOT EXISTS idx_protean_jobs_contact
  ON protean_open_jobs (contact_id) WHERE contact_id IS NOT NULL AND alpha IS NULL;

-- -------------------------------------------------------------
-- 1. Which work still has nobody.
--
-- Now excludes work somebody has already placed, so the queue empties
-- as it is worked through rather than repeating itself.
-- -------------------------------------------------------------
/* Dropped first because the returned COLUMNS change, which
   CREATE OR REPLACE cannot do. The signature is unchanged, so the drop
   still finds it on a second run and the pair stays safe to re-run. */
DROP FUNCTION IF EXISTS protean_jobs_without_account(TEXT);
CREATE OR REPLACE FUNCTION protean_jobs_without_account(p_division TEXT DEFAULT NULL)
RETURNS TABLE (division TEXT, protean_name TEXT, jobs INTEGER, value NUMERIC, oldest DATE)
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
         COALESCE(SUM(j.job_total), 0)::NUMERIC,
         min(j.logged_on)
    FROM protean_open_jobs j
   WHERE j.alpha IS NULL AND j.contact_id IS NULL AND j.still_open
     AND (p_division IS NULL OR j.division = p_division)
   GROUP BY j.division, j.protean_name
   ORDER BY 4 DESC, 2;
END;
$fn$;

-- -------------------------------------------------------------
-- 2. Saying who that work is for.
--
-- By NAME rather than by job, because the export gives us a name and
-- somebody deciding "these are SAF Holland" means all of them, now and
-- in next week's file.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION protean_place_open_work(
  p_division TEXT, p_name TEXT, p_contact UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE placed INTEGER;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Saying whose open work this is needs permission to edit the CRM.';
  END IF;
  IF p_contact IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM crm_contacts WHERE id = p_contact) THEN
    RAISE EXCEPTION 'That customer is not in the CRM.';
  END IF;

  UPDATE protean_open_jobs
     SET contact_id = p_contact
   WHERE division = p_division
     AND lower(btrim(protean_name)) = lower(btrim(p_name))
     AND alpha IS NULL;
  GET DIAGNOSTICS placed = ROW_COUNT;

  IF placed = 0 THEN
    RAISE EXCEPTION 'No unplaced % work is under that name.', p_division;
  END IF;

  IF p_contact IS NOT NULL THEN
    UPDATE crm_contacts SET relationship = 'existing', updated_at = NOW()
     WHERE id = p_contact AND relationship <> 'existing';
  END IF;
  RETURN placed;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_place_open_work(TEXT, TEXT, UUID) TO authenticated;

/** A customer we do not have, named as the workshop names them. */
CREATE OR REPLACE FUNCTION protean_make_customer_for_work(p_division TEXT, p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE made UUID; clean TEXT;
BEGIN
  IF NOT command_may('crm.create') THEN
    RAISE EXCEPTION 'Adding a customer needs permission to create CRM records.';
  END IF;
  clean := NULLIF(btrim(COALESCE(p_name, '')), '');
  IF clean IS NULL THEN
    RAISE EXCEPTION 'That work has no customer name on it.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM protean_open_jobs
                  WHERE division = p_division
                    AND lower(btrim(protean_name)) = lower(clean)
                    AND alpha IS NULL AND contact_id IS NULL AND still_open) THEN
    RAISE EXCEPTION 'No unplaced % work is under that name.', p_division;
  END IF;

  INSERT INTO crm_contacts (company_name, source, status, relationship)
  VALUES (clean, 'protean', 'customer', 'existing')
  RETURNING id INTO made;

  PERFORM protean_place_open_work(p_division, clean, made);
  RETURN made;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_make_customer_for_work(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION protean_jobs_without_account(TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 3. Every reader now finds a customer's work down either path.
--
-- The account first, the job's own link second. Written as one function
-- so the twelve places that ask "whose job is this" cannot each answer
-- it slightly differently.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION job_belongs_to(p_division TEXT, p_alpha TEXT, p_contact UUID)
RETURNS UUID
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT COALESCE(
    (SELECT a.contact_id FROM protean_accounts a
      WHERE a.division = p_division AND a.alpha = p_alpha),
    p_contact);
$fn$;

GRANT EXECUTE ON FUNCTION job_belongs_to(TEXT, TEXT, UUID) TO authenticated;

/** One customer's open work, down either path. */
CREATE OR REPLACE FUNCTION protean_open_work(p_contact UUID, p_division TEXT DEFAULT NULL)
RETURNS TABLE (division TEXT, job_no TEXT, job_type TEXT, status TEXT, depot TEXT,
               logged_on DATE, job_total NUMERIC, equip_no TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Seeing a customer''s open work needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT j.division, j.job_no, j.job_type, j.status, j.depot,
         j.logged_on, j.job_total, j.equip_no
    FROM protean_open_jobs j
   WHERE j.still_open
     AND job_belongs_to(j.division, j.alpha, j.contact_id) = p_contact
     AND (p_division IS NULL OR j.division = p_division)
   ORDER BY j.logged_on ASC NULLS LAST;
END;
$fn$;

-- -------------------------------------------------------------
-- 4. And the full previous year, for the card that compares.
--
--   on revenue in the card where you show the same point last year,
--   show the total last financial year in full in the same card smaller
--   underneath this current number
--
-- Two figures with one job between them: the like for like comparison
-- is what you act on, and the full year is what you are aiming at. They
-- belong together and neither replaces the other.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS protean_company(DATE, TEXT);
CREATE OR REPLACE FUNCTION protean_company(p_upto DATE DEFAULT NULL, p_division TEXT DEFAULT NULL)
RETURNS TABLE (
  this_year NUMERIC, last_year NUMERIC, change NUMERIC, fy_started DATE,
  /* The whole of the year before, start to finish. */
  last_year_full NUMERIC,
  invoices INTEGER, customers INTEGER,
  unattributed NUMERIC, set_aside NUMERIC,
  open_jobs INTEGER, open_value NUMERIC, last_billed DATE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  upto DATE := COALESCE(p_upto, CURRENT_DATE);
  fy   DATE := financial_year_of(upto);
  fy0  DATE := (fy - INTERVAL '1 year')::DATE;
  cut  DATE := (upto - INTERVAL '1 year')::DATE;
  /* The last day of the year before, which is the day before this one
     began. Written from `fy` rather than from a month so it follows the
     setting. */
  fy0_end DATE := (fy - INTERVAL '1 day')::DATE;
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Company revenue needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy  AND i.tax_point <= upto), 0)::NUMERIC,
    COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0)::NUMERIC,
    (COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy  AND i.tax_point <= upto), 0)
     - COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0))::NUMERIC,
    fy,
    COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= fy0_end), 0)::NUMERIC,
    count(*) FILTER (WHERE i.tax_point >= fy AND i.tax_point <= upto)::INTEGER,
    (SELECT count(DISTINCT a2.contact_id)::INTEGER FROM protean_accounts a2
      WHERE a2.contact_id IS NOT NULL AND NOT a2.ignored
        AND (p_division IS NULL OR a2.division = p_division)),
    COALESCE(SUM(i.net) FILTER (
      WHERE i.tax_point >= fy AND i.tax_point <= upto
        AND a.contact_id IS NULL AND NOT a.ignored), 0)::NUMERIC,
    COALESCE(SUM(i.net) FILTER (
      WHERE i.tax_point >= fy AND i.tax_point <= upto AND a.ignored), 0)::NUMERIC,
    (SELECT count(*)::INTEGER FROM protean_open_jobs j
      WHERE j.still_open AND (p_division IS NULL OR j.division = p_division)),
    (SELECT COALESCE(SUM(j.job_total), 0)::NUMERIC FROM protean_open_jobs j
      WHERE j.still_open AND (p_division IS NULL OR j.division = p_division)),
    max(i.tax_point)
  FROM protean_invoices i
  JOIN protean_accounts a ON a.division = i.division AND a.alpha = i.alpha
 WHERE (p_division IS NULL OR i.division = p_division);
END;
$fn$;

-- -------------------------------------------------------------
-- 5. The customer record, counting work reached either way.
--
-- Rewritten rather than patched because of a case the old shape could
-- not express: a customer with open work and NO account at all. The
-- function's main query starts from `protean_accounts`, so it found
-- nothing, fell through to the "nothing billed" row, and reported no
-- open work either. SAF Holland would have had a record saying they
-- have nothing on when they have two jobs on the ramps.
--
-- So the open work is counted first, into variables, and both branches
-- use it.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS protean_customer(UUID, DATE, TEXT);
CREATE OR REPLACE FUNCTION protean_customer(p_contact UUID, p_upto DATE DEFAULT NULL,
                                            p_division TEXT DEFAULT NULL)
RETURNS TABLE (
  accounts INTEGER, this_year NUMERIC, last_year NUMERIC, change NUMERIC,
  fy_started DATE, last_year_full NUMERIC, lifetime NUMERIC, invoices INTEGER,
  first_billed DATE, last_billed DATE,
  open_jobs INTEGER, open_value NUMERIC, oldest_open DATE,
  group_id UUID, group_name TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  upto DATE := COALESCE(p_upto, CURRENT_DATE);
  fy   DATE := financial_year_of(upto);
  fy0  DATE := (fy - INTERVAL '1 year')::DATE;
  cut  DATE := (upto - INTERVAL '1 year')::DATE;
  fy0_end DATE := (fy - INTERVAL '1 day')::DATE;
  n_open INTEGER; v_open NUMERIC; d_open DATE;
  g_id UUID; g_name TEXT;
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Seeing what a customer has spent needs access to the CRM.';
  END IF;

  SELECT count(*)::INTEGER, COALESCE(SUM(j.job_total), 0)::NUMERIC, min(j.logged_on)
    INTO n_open, v_open, d_open
    FROM protean_open_jobs j
   WHERE j.still_open
     AND job_belongs_to(j.division, j.alpha, j.contact_id) = p_contact
     AND (p_division IS NULL OR j.division = p_division);

  SELECT c.group_id, g.name INTO g_id, g_name
    FROM crm_contacts c
    LEFT JOIN customer_groups g ON g.id = c.group_id
   WHERE c.id = p_contact;

  RETURN QUERY
  SELECT
    (SELECT count(*)::INTEGER FROM protean_accounts a2
      WHERE a2.contact_id = p_contact AND NOT a2.ignored
        AND (p_division IS NULL OR a2.division = p_division)),
    COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy  AND i.tax_point <= upto), 0)::NUMERIC,
    COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0)::NUMERIC,
    (COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy  AND i.tax_point <= upto), 0)
     - COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0))::NUMERIC,
    fy,
    COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= fy0_end), 0)::NUMERIC,
    COALESCE(SUM(i.net), 0)::NUMERIC,
    count(i.invoice_no)::INTEGER,
    min(i.tax_point), max(i.tax_point),
    n_open, v_open, d_open, g_id, g_name
  FROM protean_accounts a
  LEFT JOIN protean_invoices i ON i.division = a.division AND i.alpha = a.alpha
 WHERE a.contact_id = p_contact AND NOT a.ignored
   AND (p_division IS NULL OR a.division = p_division);

  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, fy, 0::NUMERIC,
                        0::NUMERIC, 0, NULL::DATE, NULL::DATE,
                        n_open, v_open, d_open, g_id, g_name;
  END IF;
END;
$fn$;

/** Every customer, counting work reached either way. */
DROP FUNCTION IF EXISTS protean_year_on_year(DATE, TEXT);
CREATE OR REPLACE FUNCTION protean_year_on_year(p_upto DATE DEFAULT NULL, p_division TEXT DEFAULT NULL)
RETURNS TABLE (
  contact_id UUID, company_name TEXT, alphas TEXT[],
  this_year NUMERIC, last_year NUMERIC, change NUMERIC,
  open_jobs INTEGER, open_value NUMERIC, last_billed DATE, fy_started DATE,
  last_year_full NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  upto DATE := COALESCE(p_upto, CURRENT_DATE);
  fy   DATE := financial_year_of(upto);
  fy0  DATE := (fy - INTERVAL '1 year')::DATE;
  cut  DATE := (upto - INTERVAL '1 year')::DATE;
  fy0_end DATE := (fy - INTERVAL '1 day')::DATE;
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Company revenue needs access to the CRM.';
  END IF;

  RETURN QUERY
  WITH work AS (
    SELECT job_belongs_to(j.division, j.alpha, j.contact_id) AS contact,
           count(*)::INTEGER AS jobs,
           COALESCE(SUM(j.job_total), 0)::NUMERIC AS value
      FROM protean_open_jobs j
     WHERE j.still_open AND (p_division IS NULL OR j.division = p_division)
       AND job_belongs_to(j.division, j.alpha, j.contact_id) IS NOT NULL
     GROUP BY 1
  ),
  billed AS (
    SELECT c.id AS contact, c.company_name,
           array_agg(DISTINCT a.alpha) AS alphas,
           COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy  AND i.tax_point <= upto), 0)::NUMERIC AS ty,
           COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0)::NUMERIC AS ly,
           COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= fy0_end), 0)::NUMERIC AS lyf,
           max(i.tax_point) AS latest,
           COALESCE(SUM(i.net), 0)::NUMERIC AS ever
      FROM protean_accounts a
      JOIN crm_contacts c ON c.id = a.contact_id
      LEFT JOIN protean_invoices i ON i.division = a.division AND i.alpha = a.alpha
     WHERE NOT a.ignored AND (p_division IS NULL OR a.division = p_division)
     GROUP BY c.id, c.company_name
  )
  SELECT COALESCE(b.contact, w.contact),
         COALESCE(b.company_name, (SELECT c.company_name FROM crm_contacts c WHERE c.id = w.contact)),
         COALESCE(b.alphas, ARRAY[]::TEXT[]),
         COALESCE(b.ty, 0), COALESCE(b.ly, 0), COALESCE(b.ty, 0) - COALESCE(b.ly, 0),
         COALESCE(w.jobs, 0), COALESCE(w.value, 0), b.latest, fy, COALESCE(b.lyf, 0)
    FROM billed b
    FULL OUTER JOIN work w ON w.contact = b.contact
   WHERE COALESCE(b.ever, 0) <> 0 OR COALESCE(w.jobs, 0) > 0
   ORDER BY 4 DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_company(DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION protean_customer(UUID, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION protean_year_on_year(DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION protean_open_work(UUID, TEXT) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'protean_open_jobs' AND column_name = 'contact_id') THEN
    RAISE EXCEPTION 'open work for a customer we have not invoiced is still unreachable';
  END IF;
  RAISE NOTICE 'ok  work for a customer with no account can be placed, and the full previous year is available';
END $$;
