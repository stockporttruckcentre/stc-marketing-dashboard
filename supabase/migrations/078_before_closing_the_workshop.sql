-- =============================================================
-- 078. Asking before closing the workshop.
--
-- The open jobs export is a snapshot, so a job that stops appearing has
-- been finished, invoiced or cancelled, and closing it is the only way
-- the CRM can ever know. 077 does that as an explicit last step.
--
-- ---- What that gets wrong ----
--
-- It cannot tell the difference between a week's work finishing and a
-- partial export. Somebody runs the report filtered to one depot, drops
-- it in, and every job at every other depot is marked finished. Around
-- a thousand rows, in one press, and the only trace is a number in the
-- results panel after the fact.
--
-- 077 already refuses a file that landed nothing, on the grounds that
-- an empty export must not report the whole workshop as done. A partial
-- file is the same mistake with rows in it, and the empty check does
-- not see it.
--
-- ---- Why this is a question and not a threshold ----
--
-- There is no number that separates the two cases. A quiet fortnight
-- and a half sent file look identical from here, and a rule that
-- guessed would eventually guess wrong in whichever direction is worse.
--
-- So this function decides nothing. It reports what closing WOULD do,
-- the screen shows it, and a person presses the button on a figure they
-- have read. The normal week is one extra glance. The bad week is the
-- one this exists for.
-- =============================================================

CREATE OR REPLACE FUNCTION protean_would_close(p_import UUID)
RETURNS TABLE (
  /* Open now, and not mentioned by this import. */
  would_close    INTEGER,
  /* Open before this import is finished off. */
  open_now       INTEGER,
  /* What this import actually carried. */
  in_this_file   INTEGER,
  /* The oldest and the largest of what would be closed, so the figure
     on the screen has something recognisable next to it. A person who
     knows the yard will spot a wrong answer faster from one job number
     than from any percentage. */
  biggest_job    TEXT,
  biggest_value  NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('crm.import') THEN
    RAISE EXCEPTION 'Reading what an import would close needs permission to import into the CRM.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM protean_imports WHERE id = p_import AND kind = 'open_jobs') THEN
    RAISE EXCEPTION 'That is not an open jobs import.';
  END IF;

  RETURN QUERY
  WITH going AS (
    SELECT j.job_no, j.job_total
      FROM protean_open_jobs j
     WHERE j.still_open AND (j.last_batch IS DISTINCT FROM p_import)
  )
  SELECT (SELECT count(*)::INTEGER FROM going),
         (SELECT count(*)::INTEGER FROM protean_open_jobs WHERE still_open),
         (SELECT count(*)::INTEGER FROM protean_open_jobs WHERE last_batch = p_import),
         (SELECT g.job_no FROM going g ORDER BY g.job_total DESC NULLS LAST, g.job_no LIMIT 1),
         (SELECT COALESCE(SUM(g.job_total), 0)::NUMERIC FROM going g);
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_would_close(UUID) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'protean_would_close') THEN
    RAISE EXCEPTION 'the workshop can still be closed without anybody being asked';
  END IF;
  RAISE NOTICE 'ok  an import can say what it would close before it closes it';
END $$;
