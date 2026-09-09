-- =============================================================
-- 102. "Who moved" answers per division.
--
-- From the business:
--
--   is this page wired? "who moved" doesn't change when i go between
--   divisions?
--
-- It did not, and it could not. Every other panel on Analytics narrows
-- when a division is picked: the ring, the month chart, the biggest
-- customers, the ageing bands, the funnel, the reconciliation gap. Who
-- moved sat there showing the same company wide list, with a hint
-- reading "Against the same point last year" and nothing saying it was
-- ignoring the division.
--
-- ---- Why it could not be fixed in the browser ----
--
-- `customer_movement` ranks in the database and cuts with LIMIT:
--
--   ORDER BY abs(now_ - then_) DESC LIMIT p_limit
--
-- So the rows that arrive are the COMPANY's biggest movers. Filtering
-- those in the browser by the division a customer happens to trade in
-- gives "of the company's thirty biggest movers, the ones that touch
-- STC", which is a different question from "STC's thirty biggest
-- movers" and quietly drops every customer who moved a lot in one
-- division and is small overall. The filter has to happen before the
-- ranking, which means it has to happen here.
--
-- ---- The comment this replaces ----
--
-- The function carried a deliberate note saying the whole company on
-- one list was the point:
--
--   The whole company on one list rather than three, because a haulier
--   who has moved their maintenance elsewhere and started renting from
--   us is not a riser and not a faller.
--
-- That reasoning is still right, and it is still what the page shows by
-- default: `p_division` is null unless somebody has drilled into a
-- division, and null behaves exactly as before. What was wrong was
-- having no way to ask the narrower question on a screen where every
-- other panel answers it.
--
-- Trailer sales are still absent from the comparison, because they are
-- not in `protean_invoices` at all. The screen says so rather than
-- drawing an empty panel.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- The old two argument form goes.
--
-- Adding a third parameter with a default would leave both signatures
-- resolvable and `customer_movement(date, integer)` ambiguous, which
-- PostgREST reports as "could not choose the best candidate function"
-- rather than picking one. Dropped and recreated, which is also what
-- makes this file safe to run twice.
--
-- One caller, `components/analytics/legacy/AnalyticsHub.tsx`, through
-- `customerMovement` in `lib/protean/finance.ts`. Both move in the same
-- change as this migration.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS customer_movement(DATE, INTEGER);
DROP FUNCTION IF EXISTS customer_movement(DATE, INTEGER, TEXT);

CREATE FUNCTION customer_movement(
  p_upto     DATE DEFAULT NULL,
  p_limit    INTEGER DEFAULT 12,
  /* Null is the whole company, which is what the page shows until
     somebody drills into a division. A slug narrows it. */
  p_division TEXT DEFAULT NULL)
RETURNS TABLE (
  contact_id   UUID,
  company_name TEXT,
  this_year    NUMERIC,
  last_year    NUMERIC,
  change       NUMERIC,
  change_pct   NUMERIC,
  /* Which of the Protean divisions this customer trades in, so a faller
     can be chased by whoever it belongs to. Narrowed to the one asked
     for where a division was given. */
  divisions    TEXT
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
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Customer movement needs access to the CRM.';
  END IF;

  /* A division that does not exist is a mistake worth hearing about.
     Left unchecked, a typo returns an empty panel that reads as "nobody
     moved", which is a statement about the business rather than about
     the query. */
  IF p_division IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM divisions WHERE slug = p_division) THEN
    RAISE EXCEPTION 'There is no division called %.', p_division;
  END IF;

  RETURN QUERY
  WITH per_customer AS (
    SELECT a.contact_id,
           COALESCE(SUM(i.net) FILTER (
             WHERE i.tax_point >= fy AND i.tax_point <= upto), 0)::NUMERIC AS now_,
           COALESCE(SUM(i.net) FILTER (
             WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0)::NUMERIC AS then_,
           string_agg(DISTINCT d.name, ', ' ORDER BY d.name) AS divs
      FROM protean_accounts a
      JOIN protean_invoices i
        ON i.division = a.division AND i.alpha = a.alpha
      JOIN divisions d ON d.slug = a.division
     WHERE a.contact_id IS NOT NULL
       AND NOT a.ignored
       /* BEFORE the grouping and therefore before the ranking, which is
          the whole point of this migration. Narrowing after the LIMIT
          gives the company's movers that happen to touch a division,
          not the division's movers. */
       AND (p_division IS NULL OR a.division = p_division)
     GROUP BY a.contact_id
  )
  SELECT p.contact_id, c.company_name, p.now_, p.then_,
         (p.now_ - p.then_)::NUMERIC,
         /* Null rather than infinity where there was nothing to grow
            from. A customer who billed nothing last year and £40k this
            year has not grown by any percentage, they are new, and the
            screen says that instead of printing a number nobody can
            use. */
         CASE WHEN p.then_ > 0
              THEN round(((p.now_ - p.then_) / p.then_) * 100, 1)
              ELSE NULL END,
         p.divs
    FROM per_customer p
    JOIN crm_contacts c ON c.id = p.contact_id
   /* Both ends of the list, not the top of it. A mover is a mover in
      either direction and finance wants both halves. */
   WHERE p.now_ <> p.then_
   ORDER BY abs(p.now_ - p.then_) DESC
   LIMIT GREATEST(1, p_limit);
END;
$fn$;

GRANT EXECUTE ON FUNCTION customer_movement(DATE, INTEGER, TEXT) TO authenticated;

COMMENT ON FUNCTION customer_movement(DATE, INTEGER, TEXT) IS
  'Who is growing and who is going, against the same point last year. '
  'Null p_division is the whole company netted across Protean; a slug '
  'narrows it before the ranking. Trailer sales are never included: a '
  'customer who bought a trailer last year and not this one has a '
  'trailer, not a problem.';

-- -------------------------------------------------------------
-- Said out loud, so a migration that matched nothing is not mistaken
-- for one that worked.
-- -------------------------------------------------------------
DO $$
DECLARE args TEXT;
BEGIN
  /* The TYPES, not the identity arguments.

     `pg_get_function_identity_arguments` includes the parameter names,
     so it reads "p_upto date, p_limit integer, p_division text" and a
     check written against "date, integer, text" fails on a function
     that is perfectly correct. It did, on the first run of this file,
     and took the whole transaction down with it. */
  SELECT pg_catalog.oidvectortypes(p.proargtypes) INTO args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'customer_movement';

  IF args IS NULL THEN
    RAISE EXCEPTION '102 did not land: customer_movement is gone';
  END IF;
  IF args <> 'date, integer, text' THEN
    RAISE EXCEPTION '102 did not land: customer_movement takes (%)', args;
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'customer_movement') <> 1 THEN
    RAISE EXCEPTION '102 did not land: more than one customer_movement, so a call is ambiguous';
  END IF;
  RAISE NOTICE 'who moved: customer_movement now takes a division';
END $$;

COMMIT;

-- PostgREST caches the schema. Without this the function has the
-- parameter and the API still says it does not.
NOTIFY pgrst, 'reload schema';
