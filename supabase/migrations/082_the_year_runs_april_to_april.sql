-- =============================================================
-- 082. The year runs April to April.
--
-- From the business, asked directly and answered directly:
--
--   default april to april always
--
-- 079 made the financial year a setting and defaulted it to January,
-- on the grounds that January was the one value which made the
-- financial figure and the calendar figure agree, so an unconfigured
-- installation could not show a second number nobody had checked.
-- That was the right default while nobody had said. Somebody has said.
--
-- ---- Which means there is now ONE year, not two ----
--
-- 079 returned `this_year` on the calendar and `financial_year`
-- separately, and every screen showed both. With April set, that is two
-- different figures for the same question sitting next to each other:
--
--   Invoiced this year   £4,944,365     1 Jan to 2 Sep
--   Year from Apr 2026   £2,969,047     1 Apr to 2 Sep
--
-- Both are true and only one is the company's year. Two numbers for one
-- question is how a meeting ends up arguing about which figure is the
-- real one, and it is the exact failure 079's own comment set out to
-- avoid before the setting existed.
--
-- So `this_year` now MEANS the financial year to date, everywhere, from
-- the one setting. `last_year` is the same point in the financial year
-- before it, for the reason it has always been: this year is only
-- complete to today.
--
-- On the real export that is £2,969,047 against £2,861,683, up £107,364
-- or 3.8%, where the calendar reading was up £474,727 or 10.6%. Same
-- rows, and the April reading is the one the company is actually
-- having.
--
-- ---- The separate `financial_year` column is gone ----
--
-- It said the same thing as `this_year` and nothing can go wrong by
-- removing it that would not go wrong worse by leaving two names for
-- one figure.
-- =============================================================

-- -------------------------------------------------------------
-- 1. April.
-- -------------------------------------------------------------
ALTER TABLE tenant_settings
  ALTER COLUMN financial_year_start_month SET DEFAULT 4;

/* Only where it is still the old default. Somebody who has deliberately
   set a different month keeps it, and re-running this file does not
   argue with them. */
UPDATE tenant_settings SET financial_year_start_month = 4
 WHERE financial_year_start_month = 1;

COMMENT ON COLUMN tenant_settings.financial_year_start_month IS
  'The month the financial year begins, 1 to 12. April for this company. '
  'Every "this year" figure in the application is measured from it, so '
  'changing it moves every screen at once and nothing reads a hardcoded month.';

-- -------------------------------------------------------------
-- 2. One customer, on the company's year.
--
-- Dropped rather than replaced: the returned columns change, and
-- CREATE OR REPLACE cannot change a function's result type.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS protean_customer(UUID, DATE);

CREATE FUNCTION protean_customer(p_contact UUID, p_upto DATE DEFAULT NULL)
RETURNS TABLE (
  accounts     INTEGER,
  /* The financial year to date. */
  this_year    NUMERIC,
  /* The same point in the financial year before it. */
  last_year    NUMERIC,
  change       NUMERIC,
  /* The day the current year began, so a screen can label the figure
     with its period rather than with the word "financial". */
  fy_started   DATE,
  lifetime     NUMERIC,
  invoices     INTEGER,
  first_billed DATE,
  last_billed  DATE,
  open_jobs    INTEGER,
  open_value   NUMERIC,
  oldest_open  DATE,
  group_id     UUID,
  group_name   TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  upto DATE := COALESCE(p_upto, CURRENT_DATE);
  fy   DATE := financial_year_of(upto);
  /* The year before, and the same day within it. A year that begins on
     1 April means the point matching 2 September is 2 September. */
  fy0  DATE := (fy - INTERVAL '1 year')::DATE;
  cut  DATE := (upto - INTERVAL '1 year')::DATE;
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Seeing what a customer has spent needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT count(*)::INTEGER FROM protean_accounts a
      WHERE a.contact_id = p_contact AND NOT a.ignored),
    COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy  AND i.tax_point <= upto), 0)::NUMERIC,
    COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0)::NUMERIC,
    (COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy  AND i.tax_point <= upto), 0)
     - COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0))::NUMERIC,
    fy,
    COALESCE(SUM(i.net), 0)::NUMERIC,
    count(i.invoice_no)::INTEGER,
    min(i.tax_point),
    max(i.tax_point),
    (SELECT count(*)::INTEGER FROM protean_open_jobs j
       JOIN protean_accounts ja ON ja.alpha = j.alpha
      WHERE ja.contact_id = p_contact AND j.still_open),
    (SELECT COALESCE(SUM(j.job_total), 0)::NUMERIC FROM protean_open_jobs j
       JOIN protean_accounts ja ON ja.alpha = j.alpha
      WHERE ja.contact_id = p_contact AND j.still_open),
    (SELECT min(j.logged_on) FROM protean_open_jobs j
       JOIN protean_accounts ja ON ja.alpha = j.alpha
      WHERE ja.contact_id = p_contact AND j.still_open),
    (SELECT c.group_id FROM crm_contacts c WHERE c.id = p_contact),
    (SELECT g.name FROM crm_contacts c
       JOIN customer_groups g ON g.id = c.group_id
      WHERE c.id = p_contact)
  FROM protean_accounts a
  LEFT JOIN protean_invoices i ON i.alpha = a.alpha
 WHERE a.contact_id = p_contact AND NOT a.ignored;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, fy,
                        0::NUMERIC, 0, NULL::DATE, NULL::DATE, 0, 0::NUMERIC, NULL::DATE,
                        (SELECT c.group_id FROM crm_contacts c WHERE c.id = p_contact),
                        (SELECT g.name FROM crm_contacts c
                           JOIN customer_groups g ON g.id = c.group_id
                          WHERE c.id = p_contact);
  END IF;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_customer(UUID, DATE) TO authenticated;

-- -------------------------------------------------------------
-- 3. The company, on the same year.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS protean_company(DATE);

CREATE FUNCTION protean_company(p_upto DATE DEFAULT NULL)
RETURNS TABLE (
  this_year    NUMERIC,
  last_year    NUMERIC,
  change       NUMERIC,
  fy_started   DATE,
  invoices     INTEGER,
  customers    INTEGER,
  unattributed NUMERIC,
  set_aside    NUMERIC,
  open_jobs    INTEGER,
  open_value   NUMERIC,
  last_billed  DATE
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
    RAISE EXCEPTION 'Company revenue needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy  AND i.tax_point <= upto), 0)::NUMERIC,
    COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0)::NUMERIC,
    (COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy  AND i.tax_point <= upto), 0)
     - COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0))::NUMERIC,
    fy,
    count(*) FILTER (WHERE i.tax_point >= fy AND i.tax_point <= upto)::INTEGER,
    (SELECT count(DISTINCT a2.contact_id)::INTEGER FROM protean_accounts a2
      WHERE a2.contact_id IS NOT NULL AND NOT a2.ignored),
    COALESCE(SUM(i.net) FILTER (
      WHERE i.tax_point >= fy AND i.tax_point <= upto
        AND a.contact_id IS NULL AND NOT a.ignored), 0)::NUMERIC,
    COALESCE(SUM(i.net) FILTER (
      WHERE i.tax_point >= fy AND i.tax_point <= upto AND a.ignored), 0)::NUMERIC,
    (SELECT count(*)::INTEGER FROM protean_open_jobs j WHERE j.still_open),
    (SELECT COALESCE(SUM(j.job_total), 0)::NUMERIC FROM protean_open_jobs j WHERE j.still_open),
    max(i.tax_point)
  FROM protean_invoices i
  JOIN protean_accounts a ON a.alpha = i.alpha;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_company(DATE) TO authenticated;

-- -------------------------------------------------------------
-- 4. Every customer, on the same year.
--
-- The screen Tom described. Same change, same reason: one definition of
-- the year, from the one setting.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS protean_year_on_year(DATE);

CREATE FUNCTION protean_year_on_year(p_upto DATE DEFAULT NULL)
RETURNS TABLE (
  contact_id   UUID,
  company_name TEXT,
  alphas       TEXT[],
  this_year    NUMERIC,
  last_year    NUMERIC,
  change       NUMERIC,
  open_jobs    INTEGER,
  open_value   NUMERIC,
  last_billed  DATE,
  fy_started   DATE
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
    RAISE EXCEPTION 'Company revenue needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT c.id,
         c.company_name,
         array_agg(DISTINCT a.alpha),
         COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy  AND i.tax_point <= upto), 0)::NUMERIC,
         COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0)::NUMERIC,
         (COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy  AND i.tax_point <= upto), 0)
          - COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0))::NUMERIC,
         (SELECT count(*)::INTEGER FROM protean_open_jobs j
           JOIN protean_accounts ja ON ja.alpha = j.alpha
          WHERE ja.contact_id = c.id AND j.still_open),
         (SELECT COALESCE(SUM(j.job_total), 0)::NUMERIC FROM protean_open_jobs j
           JOIN protean_accounts ja ON ja.alpha = j.alpha
          WHERE ja.contact_id = c.id AND j.still_open),
         max(i.tax_point),
         fy
    FROM protean_accounts a
    JOIN crm_contacts c ON c.id = a.contact_id
    LEFT JOIN protean_invoices i ON i.alpha = a.alpha
   WHERE NOT a.ignored
   GROUP BY c.id, c.company_name
  HAVING COALESCE(SUM(i.net), 0) <> 0
      OR EXISTS (SELECT 1 FROM protean_open_jobs j
                  JOIN protean_accounts ja ON ja.alpha = j.alpha
                 WHERE ja.contact_id = c.id AND j.still_open)
   ORDER BY 4 DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_year_on_year(DATE) TO authenticated;

-- -------------------------------------------------------------
-- 5. Groups, on the same year.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS group_revenue(DATE);

CREATE FUNCTION group_revenue(p_upto DATE DEFAULT NULL)
RETURNS TABLE (
  group_id    UUID,
  group_name  TEXT,
  customers   INTEGER,
  accounts    INTEGER,
  this_year   NUMERIC,
  last_year   NUMERIC,
  change      NUMERIC,
  open_jobs   INTEGER,
  open_value  NUMERIC,
  last_billed DATE
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
  WITH billed AS (
    SELECT c.group_id AS g, c.id AS contact, a.alpha,
           COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy  AND i.tax_point <= upto), 0) AS ty,
           COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0) AS ly,
           max(i.tax_point) AS latest
      FROM crm_contacts c
      JOIN protean_accounts a ON a.contact_id = c.id AND NOT a.ignored
      LEFT JOIN protean_invoices i ON i.alpha = a.alpha
     WHERE c.group_id IS NOT NULL
     GROUP BY c.group_id, c.id, a.alpha
  ),
  work AS (
    SELECT c.group_id AS g, count(*)::INTEGER AS jobs,
           COALESCE(SUM(j.job_total), 0)::NUMERIC AS value
      FROM protean_open_jobs j
      JOIN protean_accounts a ON a.alpha = j.alpha AND NOT a.ignored
      JOIN crm_contacts c ON c.id = a.contact_id
     WHERE j.still_open AND c.group_id IS NOT NULL
     GROUP BY c.group_id
  )
  SELECT gr.id, gr.name,
         count(DISTINCT b.contact)::INTEGER,
         count(DISTINCT b.alpha)::INTEGER,
         COALESCE(SUM(b.ty), 0)::NUMERIC,
         COALESCE(SUM(b.ly), 0)::NUMERIC,
         (COALESCE(SUM(b.ty), 0) - COALESCE(SUM(b.ly), 0))::NUMERIC,
         COALESCE(max(w.jobs), 0),
         COALESCE(max(w.value), 0)::NUMERIC,
         max(b.latest)
    FROM customer_groups gr
    LEFT JOIN billed b ON b.g = gr.id
    LEFT JOIN work   w ON w.g = gr.id
   GROUP BY gr.id, gr.name
   ORDER BY 5 DESC, gr.name;
END;
$fn$;

GRANT EXECUTE ON FUNCTION group_revenue(DATE) TO authenticated;

-- -------------------------------------------------------------
-- 6. And the breakdown inside a group.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS group_breakdown(UUID, DATE);

CREATE FUNCTION group_breakdown(p_group UUID, p_upto DATE DEFAULT NULL)
RETURNS TABLE (
  alpha        TEXT,
  protean_name TEXT,
  contact_id   UUID,
  company_name TEXT,
  this_year    NUMERIC,
  last_year    NUMERIC,
  change       NUMERIC,
  open_jobs    INTEGER,
  open_value   NUMERIC,
  last_billed  DATE
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
  SELECT a.alpha, a.protean_name, c.id, c.company_name,
         COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy  AND i.tax_point <= upto), 0)::NUMERIC,
         COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0)::NUMERIC,
         (COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy  AND i.tax_point <= upto), 0)
          - COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0))::NUMERIC,
         (SELECT count(*)::INTEGER FROM protean_open_jobs j
           WHERE j.alpha = a.alpha AND j.still_open),
         (SELECT COALESCE(SUM(j.job_total), 0)::NUMERIC FROM protean_open_jobs j
           WHERE j.alpha = a.alpha AND j.still_open),
         max(i.tax_point)
    FROM protean_accounts a
    JOIN crm_contacts c ON c.id = a.contact_id
    LEFT JOIN protean_invoices i ON i.alpha = a.alpha
   WHERE c.group_id = p_group AND NOT a.ignored
   GROUP BY a.alpha, a.protean_name, c.id, c.company_name
   ORDER BY 5 DESC, a.protean_name;
END;
$fn$;

GRANT EXECUTE ON FUNCTION group_breakdown(UUID, DATE) TO authenticated;

-- -------------------------------------------------------------
-- 7. Did it land.
-- -------------------------------------------------------------
DO $$
DECLARE m SMALLINT;
BEGIN
  SELECT financial_year_start_month INTO m FROM tenant_settings LIMIT 1;
  RAISE NOTICE 'ok  the year begins in month %, and every "this year" figure is measured from it', m;
END $$;
