-- =============================================================
-- 089. A group belongs to the divisions its money is in.
--
-- From the business:
--
--   Ensure only groups relating to STC show on STC's groups tab and
--   vice versa, currently I see maintenance customers on the S&L rental
--   group tab.
--
-- `group_revenue` never took a division. Every other figure on the
-- Revenue screen learned about divisions in 085 and this one did not,
-- so both screens showed every group and the rental page listed
-- maintenance customers with rental totals of nought beside them.
--
-- ---- What "relating to" has to mean ----
--
-- Not "made on this screen": a group is a commercial relationship and
-- has nothing to do with which page somebody was on when they made it.
-- Montgomery is one group whether you arrive at it from maintenance or
-- from rental.
--
-- It means the group has money in that division. So the same group can
-- honestly appear on both screens, showing that division's half each
-- time, and a group with nothing in rental does not clutter rental.
--
-- That is the same rule as everywhere else: a division is derived from
-- where the money is, never declared.
-- =============================================================

DROP FUNCTION IF EXISTS group_revenue(DATE);

/* Dropped first because a later migration changes this function's
   return type, and the catch-up bundle is meant to be safe to run
   twice. On a second run the LATER shape is live and
   `CREATE OR REPLACE` cannot change a return type. No-op on a fresh
   database, the fix on a replay. */
DROP FUNCTION IF EXISTS group_revenue(DATE, TEXT);

CREATE OR REPLACE FUNCTION group_revenue(p_upto DATE DEFAULT NULL, p_division TEXT DEFAULT NULL)
RETURNS TABLE (
  group_id UUID, group_name TEXT, customers INTEGER, accounts INTEGER,
  this_year NUMERIC, last_year NUMERIC, last_year_full NUMERIC, change NUMERIC,
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
  fy0e DATE := (fy - INTERVAL '1 day')::DATE;
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Group revenue needs access to the CRM.';
  END IF;

  RETURN QUERY
  WITH billed AS (
    SELECT c.group_id AS g, c.id AS contact, a.division, a.alpha,
           COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy  AND i.tax_point <= upto), 0) AS ty,
           COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0) AS ly,
           COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= fy0e), 0) AS lyf,
           COALESCE(SUM(i.net), 0) AS ever,
           max(i.tax_point) AS latest
      FROM crm_contacts c
      JOIN protean_accounts a ON a.contact_id = c.id AND NOT a.ignored
      LEFT JOIN protean_invoices i ON i.division = a.division AND i.alpha = a.alpha
     WHERE c.group_id IS NOT NULL
       AND (p_division IS NULL OR a.division = p_division)
     GROUP BY c.group_id, c.id, a.division, a.alpha
  ),
  work AS (
    SELECT c.group_id AS g, count(*)::INTEGER AS jobs,
           COALESCE(SUM(j.job_total), 0)::NUMERIC AS value
      FROM protean_open_jobs j
      JOIN protean_accounts a ON a.division = j.division AND a.alpha = j.alpha AND NOT a.ignored
      JOIN crm_contacts c ON c.id = a.contact_id
     WHERE j.still_open AND c.group_id IS NOT NULL
       AND (p_division IS NULL OR j.division = p_division)
     GROUP BY c.group_id
  )
  SELECT gr.id, gr.name,
         count(DISTINCT b.contact)::INTEGER,
         count(DISTINCT (b.division || ':' || b.alpha))::INTEGER,
         COALESCE(SUM(b.ty), 0)::NUMERIC,
         COALESCE(SUM(b.ly), 0)::NUMERIC,
         COALESCE(SUM(b.lyf), 0)::NUMERIC,
         (COALESCE(SUM(b.ty), 0) - COALESCE(SUM(b.ly), 0))::NUMERIC,
         COALESCE(max(w.jobs), 0), COALESCE(max(w.value), 0)::NUMERIC,
         max(b.latest)
    FROM customer_groups gr
    LEFT JOIN billed b ON b.g = gr.id
    LEFT JOIN work   w ON w.g = gr.id
   GROUP BY gr.id, gr.name
  /* A group with nothing in this division is not this division's
     group. Asked for every division at once, a group with no money
     anywhere still shows, because it is one somebody has just made and
     is about to fill. */
  HAVING p_division IS NULL
      OR COALESCE(SUM(b.ever), 0) <> 0
      OR COALESCE(max(w.jobs), 0) > 0
   ORDER BY 5 DESC, gr.name;
END;
$fn$;

GRANT EXECUTE ON FUNCTION group_revenue(DATE, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- And the breakdown inside one, for the same division.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS group_breakdown(UUID, DATE);

/* Dropped first because a later migration changes this function's
   return type, and the catch-up bundle is meant to be safe to run
   twice. On a second run the LATER shape is live and
   `CREATE OR REPLACE` cannot change a return type. No-op on a fresh
   database, the fix on a replay. */
DROP FUNCTION IF EXISTS group_breakdown(UUID, DATE, TEXT);

CREATE OR REPLACE FUNCTION group_breakdown(
  p_group UUID, p_upto DATE DEFAULT NULL, p_division TEXT DEFAULT NULL)
RETURNS TABLE (
  division TEXT, alpha TEXT, protean_name TEXT, contact_id UUID, company_name TEXT,
  this_year NUMERIC, last_year NUMERIC, change NUMERIC,
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
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Group revenue needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT a.division, a.alpha, a.protean_name, c.id, c.company_name,
         COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy  AND i.tax_point <= upto), 0)::NUMERIC,
         COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0)::NUMERIC,
         (COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy  AND i.tax_point <= upto), 0)
          - COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0))::NUMERIC,
         (SELECT count(*)::INTEGER FROM protean_open_jobs j
           WHERE j.division = a.division AND j.alpha = a.alpha AND j.still_open),
         (SELECT COALESCE(SUM(j.job_total), 0)::NUMERIC FROM protean_open_jobs j
           WHERE j.division = a.division AND j.alpha = a.alpha AND j.still_open),
         max(i.tax_point)
    FROM protean_accounts a
    JOIN crm_contacts c ON c.id = a.contact_id
    LEFT JOIN protean_invoices i ON i.division = a.division AND i.alpha = a.alpha
   WHERE c.group_id = p_group AND NOT a.ignored
     AND (p_division IS NULL OR a.division = p_division)
   GROUP BY a.division, a.alpha, a.protean_name, c.id, c.company_name
   ORDER BY 6 DESC, a.protean_name;
END;
$fn$;

GRANT EXECUTE ON FUNCTION group_breakdown(UUID, DATE, TEXT) TO authenticated;

DO $$
BEGIN
  RAISE NOTICE 'ok  a group shows on the screen for a division its money is actually in';
END $$;
