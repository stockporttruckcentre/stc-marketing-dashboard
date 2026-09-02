-- =============================================================
-- 081. Open jobs finding their account, whatever order the files land.
--
-- The open jobs export carries no account code, only the customer name,
-- so a job is joined to an account by matching that name. The accounts
-- themselves are created by the INVOICE file, which is the only one of
-- the two that carries `Alpha`.
--
-- So the two files are not independent, and 077 resolved the name once,
-- at the moment each job row was written. Drop the open jobs file first
-- and there are no accounts to match against yet, so every job is
-- stored with no account, on a screen that then says "No account" on
-- all thousand of them. Nothing is lost and nothing says what happened.
--
-- ---- Why this is not just "sort the files" ----
--
-- The screen now sends invoices first, which fixes the case that
-- happened. It does not fix the shape of the problem: the link is made
-- once, at write time, from whatever happened to exist at that instant.
-- A job for a customer whose first invoice arrives next month stays
-- orphaned forever even though the account now exists.
--
-- So linking becomes a pass that can be run again rather than a
-- decision taken once. It is idempotent, it only ever fills a blank,
-- and it never moves a job that already has an account.
--
-- ---- And it repairs what is already there ----
--
-- The bottom of this file runs it once. An installation that has
-- already imported in the wrong order is fixed by applying the
-- migration, rather than by being told to import everything again.
-- =============================================================

/**
 * Give every unlinked job its account, by name.
 *
 * Only fills a null. A job that already points at an account is left
 * alone: Protean can spell a customer differently on the two exports,
 * and a link a person has effectively confirmed by placing the account
 * must not be second guessed by a string comparison.
 *
 * Returns how many were linked, so an import can say so out loud.
 */
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
     AND lower(btrim(a.protean_name)) = lower(btrim(j.protean_name));
  GET DIAGNOSTICS linked = ROW_COUNT;

  RETURN linked;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_relink_jobs() TO authenticated;

/**
 * The jobs that still have nobody, and how many each.
 *
 * A name here is a real answer rather than a failure: a company we have
 * done work for and not invoiced since January has no account, because
 * accounts come from the invoice file. Somebody should see the list and
 * decide, so it is a question the screen can ask rather than a silent
 * null on a thousand rows.
 */
CREATE OR REPLACE FUNCTION protean_jobs_without_account()
RETURNS TABLE (protean_name TEXT, jobs INTEGER, value NUMERIC)
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
  SELECT j.protean_name,
         count(*)::INTEGER,
         COALESCE(SUM(j.job_total), 0)::NUMERIC
    FROM protean_open_jobs j
   WHERE j.alpha IS NULL AND j.still_open
   GROUP BY j.protean_name
   ORDER BY 3 DESC, 1;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_jobs_without_account() TO authenticated;

-- -------------------------------------------------------------
-- Repair what is already in, once.
--
-- Runs as the owner rather than through the capability check above,
-- because a migration has no signed in user to check. It only fills
-- blanks, so re-running the file changes nothing the second time.
-- -------------------------------------------------------------
DO $$
DECLARE linked INTEGER; orphaned INTEGER;
BEGIN
  UPDATE protean_open_jobs j
     SET alpha = a.alpha
    FROM protean_accounts a
   WHERE j.alpha IS NULL
     AND lower(btrim(a.protean_name)) = lower(btrim(j.protean_name));
  GET DIAGNOSTICS linked = ROW_COUNT;

  SELECT count(*) INTO orphaned FROM protean_open_jobs WHERE alpha IS NULL AND still_open;

  IF linked > 0 THEN
    RAISE NOTICE 'ok  % open jobs found their account', linked;
  ELSE
    RAISE NOTICE 'ok  every open job already had its account';
  END IF;
  IF orphaned > 0 THEN
    RAISE NOTICE 'note  % open jobs are still on a company with no invoice since the export began, which is a real answer rather than a fault', orphaned;
  END IF;
END $$;
