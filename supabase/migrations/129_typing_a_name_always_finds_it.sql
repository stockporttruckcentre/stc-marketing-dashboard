-- =============================================================
-- 129. Typing a customer's name always finds it, or says why not.
--
-- From the business, thirty five times in one message:
--
--   Where is hats group
--
-- And the requirement behind it:
--
--   dean will type "hats" and say where is my customer. Same for all
--   the rest. Where are they.
--
-- ---- Why a name could come back with nothing ----
--
-- The Customers list on the Revenue tab is `protean_year_on_year`,
-- which has no limit, so it is not a ranking problem. It is these:
--
--   1. IT IS FILTERED BY DIVISION. On the Trailer Sales tab, an STC
--      customer is not there. Correct for the tab and useless to
--      somebody typing a name.
--   2. `WHERE NOT a.ignored`. An account set aside is dropped from the
--      list entirely, so the customer disappears with no explanation.
--   3. `WHERE ever <> 0 OR jobs > 0`. A customer who has never been
--      billed and has no open work is not in the list at all.
--   4. A customer with no Protean or Sage account against it has
--      nothing to join to, so it was never a candidate.
--
-- Every one of those is a reason for a figure to be absent. NONE of
-- them is a reason for the NAME to be absent. A search that answers
-- nothing teaches people their customer has been lost, and this
-- afternoon it did exactly that in front of a managing director.
--
-- ---- So ----
--
-- This searches every live customer by name, across all divisions at
-- once, whether or not it has been billed, whether or not its account
-- is set aside, whether or not it has an account at all. Where there
-- is no figure it returns the REASON there is no figure.
--
-- It never returns nought where the truth is unknown, and it never
-- returns nothing where the customer exists.
-- =============================================================
DROP FUNCTION IF EXISTS revenue_find_customer(TEXT, DATE);
CREATE OR REPLACE FUNCTION revenue_find_customer(
  p_needle TEXT,
  p_upto   DATE DEFAULT NULL
)
RETURNS TABLE (
  contact_id   UUID,
  company_name TEXT,
  divisions    TEXT,
  alphas       TEXT[],
  this_year    NUMERIC,
  last_year    NUMERIC,
  change       NUMERIC,
  ever         NUMERIC,
  last_billed  DATE,
  open_jobs    INT,
  set_aside    INT,
  why          TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  upto   DATE := COALESCE(p_upto, CURRENT_DATE);
  fy     DATE := financial_year_of(upto);
  fy0    DATE := (fy - INTERVAL '1 year')::DATE;
  cut    DATE := (upto - INTERVAL '1 year')::DATE;
  needle TEXT := '%' || BTRIM(COALESCE(p_needle, '')) || '%';
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Finding a customer''s revenue needs access to the CRM.';
  END IF;

  IF BTRIM(COALESCE(p_needle, '')) = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH hit AS (
    SELECT c.id, c.company_name
      FROM crm_contacts c
     WHERE c.deleted_at IS NULL
       AND c.company_name ILIKE needle
  ),
  acc AS (
    SELECT h.id AS contact,
           string_agg(DISTINCT d.name, ', ' ORDER BY d.name) AS divs,
           array_agg(DISTINCT a.division || '/' || a.alpha) AS codes,
           count(*) FILTER (WHERE a.ignored)::INT AS aside
      FROM hit h
      JOIN protean_accounts a ON a.contact_id = h.id
      JOIN divisions d ON d.slug = a.division
     GROUP BY h.id
  ),
  money AS (
    SELECT h.id AS contact,
           COALESCE(SUM(i.net) FILTER (
             WHERE i.tax_point >= fy AND i.tax_point <= upto), 0)::NUMERIC AS ty,
           COALESCE(SUM(i.net) FILTER (
             WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0)::NUMERIC AS ly,
           COALESCE(SUM(i.net), 0)::NUMERIC AS ev,
           MAX(i.tax_point) AS latest
      FROM hit h
      JOIN protean_accounts a ON a.contact_id = h.id
      JOIN protean_invoices i ON i.division = a.division AND i.alpha = a.alpha
     GROUP BY h.id
  ),
  work AS (
    SELECT h.id AS contact, count(*)::INT AS jobs
      FROM hit h
      JOIN protean_open_jobs j ON j.contact_id = h.id AND j.still_open
     GROUP BY h.id
  )
  SELECT h.id, h.company_name,
         COALESCE(a.divs, ''),
         COALESCE(a.codes, ARRAY[]::TEXT[]),
         COALESCE(m.ty, 0), COALESCE(m.ly, 0),
         COALESCE(m.ty, 0) - COALESCE(m.ly, 0),
         COALESCE(m.ev, 0), m.latest,
         COALESCE(w.jobs, 0), COALESCE(a.aside, 0),
         /* The reason there is no figure, in the order that matters.
            Never a bare nought standing in for an unknown. */
         CASE
           WHEN a.contact IS NULL THEN
             'No Protean or Sage account is linked to this customer, so nothing can be billed against it here.'
           WHEN COALESCE(m.ev, 0) = 0 THEN
             'Linked to ' || array_length(a.codes, 1)
             || ' account(s), and no invoice has ever come through on them.'
           WHEN COALESCE(m.ty, 0) = 0 THEN
             'Nothing invoiced this financial year. Last invoice ' || m.latest || '.'
           WHEN COALESCE(a.aside, 0) > 0 THEN
             a.aside || ' of its account(s) are set aside, so the Customers list leaves it out.'
           ELSE NULL
         END
    FROM hit h
    LEFT JOIN acc   a ON a.contact = h.id
    LEFT JOIN money m ON m.contact = h.id
    LEFT JOIN work  w ON w.contact = h.id
   ORDER BY COALESCE(m.ty, 0) DESC, h.company_name;
END;
$fn$;

REVOKE ALL ON FUNCTION revenue_find_customer(TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION revenue_find_customer(TEXT, DATE) TO authenticated;

COMMENT ON FUNCTION revenue_find_customer(TEXT, DATE) IS
  'Every live customer matching a name, across all divisions, billed or not, set '
  'aside or not. Returns the reason where there is no figure, never a bare nought.';

DO $$ BEGIN
  RAISE NOTICE 'typing a customer name now always answers, with the reason when there is no figure';
END $$;
