-- =============================================================
-- 094. A group says which question it is answering.
--
-- From the business:
--
--   We have a group it's made from 2 customers, the dropdown only shows
--   one, the manage screen shows 2. then the inpost one does show 2,
--   but one of them has never had any revenue so it technically doesn't
--   belong in a revenue group yet.
--
-- ---- Both numbers are right ----
--
-- Close Brothers has two members. Manage lists both, with £78,040 and
-- £48,319 against them. The STC row says one customer and £55,640.
--
-- Every one of those figures is correct, and they are four answers to
-- three different questions:
--
--   group_members     every member, every division, all time
--   group_revenue     members with an account IN THIS DIVISION,
--                     this financial year
--   group_breakdown   accounts IN THIS DIVISION, this financial year
--
-- Close Brothers Vehicle Hire bills on S&L and not on STC, so on the
-- STC screen it is correctly absent from the row and correctly present
-- in Manage. Nothing anywhere said so, which is the whole fault: a
-- screen that shows 1 next to a dialog that shows 2 has told somebody
-- their data is broken.
--
-- ---- What this changes ----
--
-- Not the arithmetic. Every figure is what it was. What is added is the
-- CONTEXT that makes two different numbers legible as two different
-- questions:
--
--   group_revenue    also returns how many members the group has in
--                    total, so the row can say "1 of 2 bill here"
--   group_members    also returns which divisions each member bills in
--                    and what they have billed in the year being read,
--                    so Manage can show why a member is missing from a
--                    division's row
--   group_breakdown  also returns whether the account has EVER billed,
--                    so a member with nothing yet reads as "nothing
--                    billed" rather than as £0 and "level", which looks
--                    like a broken figure
--
-- ---- On the member with no revenue ----
--
--   one of them has never had any revenue so it technically doesn't
--   belong in a revenue group yet
--
-- It is left in, and said so. A member with an account in this division
-- and no billing is a true thing about the group, and hiding it would
-- reintroduce the fault above from the other end: the count would say
-- two and the list would show one.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The row knows how big the whole group is.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS group_revenue(DATE, TEXT);

CREATE OR REPLACE FUNCTION group_revenue(p_upto DATE DEFAULT NULL, p_division TEXT DEFAULT NULL)
RETURNS TABLE (
  group_id UUID, group_name TEXT, customers INTEGER, accounts INTEGER,
  this_year NUMERIC, last_year NUMERIC, last_year_full NUMERIC, change NUMERIC,
  open_jobs INTEGER, open_value NUMERIC, last_billed DATE,
  /* Every member of the group, whatever division they bill in and
     whether they bill at all. `customers` above counts the ones with an
     account HERE. Where the two differ, the screen says so. */
  members INTEGER
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
  ),
  /* Division blind, deliberately, and counted apart from `billed` so a
     member with no account at all is still a member. */
  everyone AS (
    SELECT c.group_id AS g, count(*)::INTEGER AS n
      FROM crm_contacts c WHERE c.group_id IS NOT NULL GROUP BY c.group_id
  )
  SELECT gr.id, gr.name,
         count(DISTINCT b.contact)::INTEGER,
         count(DISTINCT (b.division || ':' || b.alpha))::INTEGER,
         COALESCE(SUM(b.ty), 0)::NUMERIC,
         COALESCE(SUM(b.ly), 0)::NUMERIC,
         COALESCE(SUM(b.lyf), 0)::NUMERIC,
         (COALESCE(SUM(b.ty), 0) - COALESCE(SUM(b.ly), 0))::NUMERIC,
         COALESCE(max(w.jobs), 0), COALESCE(max(w.value), 0)::NUMERIC,
         max(b.latest),
         COALESCE(max(e.n), 0)
    FROM customer_groups gr
    LEFT JOIN billed   b ON b.g = gr.id
    LEFT JOIN work     w ON w.g = gr.id
    LEFT JOIN everyone e ON e.g = gr.id
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
-- 2. An account that has never billed says so.
--
-- `this_year` of nought and `last_year` of nought renders as "£0, £0,
-- level", which reads as a figure that failed to load. "Nothing billed
-- yet" is the same fact and a different sentence.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS group_breakdown(UUID, DATE, TEXT);

CREATE OR REPLACE FUNCTION group_breakdown(
  p_group UUID, p_upto DATE DEFAULT NULL, p_division TEXT DEFAULT NULL)
RETURNS TABLE (
  division TEXT, alpha TEXT, protean_name TEXT, contact_id UUID, company_name TEXT,
  this_year NUMERIC, last_year NUMERIC, change NUMERIC,
  open_jobs INTEGER, open_value NUMERIC, last_billed DATE,
  /* Everything this account has ever been invoiced, in this division.
     Nought here and nought above are two different states. */
  billed_ever NUMERIC
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
         max(i.tax_point),
         COALESCE(SUM(i.net), 0)::NUMERIC
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

-- -------------------------------------------------------------
-- 3. Manage says where each member's money actually is.
--
-- This is the half that makes the two counts legible. Manage lists
-- every member of the group; naming the division each one bills in is
-- what turns "why is this one not on the STC row" into a sentence
-- somebody can read off the screen.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS group_members(UUID);

CREATE OR REPLACE FUNCTION group_members(p_group UUID, p_upto DATE DEFAULT NULL)
RETURNS TABLE (
  contact_id UUID, company_name TEXT, accounts INTEGER, net NUMERIC,
  /* The divisions this member has an account in, named. Null where
     they have none, which is a member somebody added before any
     revenue arrived. */
  divisions TEXT,
  /* And what they have billed in the year being read, across all of
     them. The row on a division screen shows one division's share of
     this. */
  this_year NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  upto DATE := COALESCE(p_upto, CURRENT_DATE);
  fy   DATE := financial_year_of(upto);
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Seeing who is in a group needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT c.id, c.company_name,
         (SELECT count(*)::INTEGER FROM protean_accounts a
           WHERE a.contact_id = c.id AND NOT a.ignored),
         (SELECT COALESCE(SUM(i.net), 0)::NUMERIC
            FROM protean_invoices i
            JOIN protean_accounts a ON a.division = i.division AND a.alpha = i.alpha
           WHERE a.contact_id = c.id AND NOT a.ignored),
         (SELECT string_agg(DISTINCT d.name, ', ' ORDER BY d.name)
            FROM protean_accounts a
            JOIN divisions d ON d.slug = a.division
           WHERE a.contact_id = c.id AND NOT a.ignored),
         (SELECT COALESCE(SUM(i.net), 0)::NUMERIC
            FROM protean_invoices i
            JOIN protean_accounts a ON a.division = i.division AND a.alpha = i.alpha
           WHERE a.contact_id = c.id AND NOT a.ignored
             AND i.tax_point >= fy AND i.tax_point <= upto)
    FROM crm_contacts c
   WHERE c.group_id = p_group
   ORDER BY 4 DESC, c.company_name;
END;
$fn$;

GRANT EXECUTE ON FUNCTION group_members(UUID, DATE) TO authenticated;

-- -------------------------------------------------------------
-- 4. Did it land.
-- -------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'group_members'
       AND pg_get_function_result(p.oid) ILIKE '%divisions%'
  ) THEN
    RAISE EXCEPTION '094 did not land: group_members does not name the divisions';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'group_revenue'
       AND pg_get_function_result(p.oid) ILIKE '%members%'
  ) THEN
    RAISE EXCEPTION '094 did not land: group_revenue does not carry the member count';
  END IF;
END $$;
