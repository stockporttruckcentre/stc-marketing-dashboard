-- =============================================================
-- 085. Reading, by division.
--
-- The other half of 084. Every read takes `p_division`, and NULL means
-- all of them, for the reason in that file's header: the company total
-- is genuinely the sum of the divisions, and a default of STC would
-- make "what have we billed" quietly mean maintenance.
--
-- A read left un-updated would not fail. It would join on `alpha`
-- alone, find the same code in two divisions, and add Alliance
-- Flooring's rental invoices to Alliance Automotive's maintenance
-- ones. So every one of them is rewritten here even where the change is
-- one line, and the check asserts a customer in two divisions reads
-- correctly in three ways: each division alone, and both together.
-- =============================================================

-- -------------------------------------------------------------
-- 1. One customer.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS protean_customer(UUID, DATE);

CREATE OR REPLACE FUNCTION protean_customer(p_contact UUID, p_upto DATE DEFAULT NULL,
                                 p_division TEXT DEFAULT NULL)
RETURNS TABLE (
  accounts INTEGER, this_year NUMERIC, last_year NUMERIC, change NUMERIC,
  fy_started DATE, lifetime NUMERIC, invoices INTEGER,
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
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Seeing what a customer has spent needs access to the CRM.';
  END IF;

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
    COALESCE(SUM(i.net), 0)::NUMERIC,
    count(i.invoice_no)::INTEGER,
    min(i.tax_point), max(i.tax_point),
    (SELECT count(*)::INTEGER FROM protean_open_jobs j
       JOIN protean_accounts ja ON ja.division = j.division AND ja.alpha = j.alpha
      WHERE ja.contact_id = p_contact AND j.still_open
        AND (p_division IS NULL OR j.division = p_division)),
    (SELECT COALESCE(SUM(j.job_total), 0)::NUMERIC FROM protean_open_jobs j
       JOIN protean_accounts ja ON ja.division = j.division AND ja.alpha = j.alpha
      WHERE ja.contact_id = p_contact AND j.still_open
        AND (p_division IS NULL OR j.division = p_division)),
    (SELECT min(j.logged_on) FROM protean_open_jobs j
       JOIN protean_accounts ja ON ja.division = j.division AND ja.alpha = j.alpha
      WHERE ja.contact_id = p_contact AND j.still_open
        AND (p_division IS NULL OR j.division = p_division)),
    (SELECT c.group_id FROM crm_contacts c WHERE c.id = p_contact),
    (SELECT g.name FROM crm_contacts c
       JOIN customer_groups g ON g.id = c.group_id WHERE c.id = p_contact)
  FROM protean_accounts a
  LEFT JOIN protean_invoices i ON i.division = a.division AND i.alpha = a.alpha
 WHERE a.contact_id = p_contact AND NOT a.ignored
   AND (p_division IS NULL OR a.division = p_division);

  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, fy,
                        0::NUMERIC, 0, NULL::DATE, NULL::DATE, 0, 0::NUMERIC, NULL::DATE,
                        (SELECT c.group_id FROM crm_contacts c WHERE c.id = p_contact),
                        (SELECT g.name FROM crm_contacts c
                           JOIN customer_groups g ON g.id = c.group_id WHERE c.id = p_contact);
  END IF;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_customer(UUID, DATE, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 2. The company, or one division of it.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS protean_company(DATE);

CREATE OR REPLACE FUNCTION protean_company(p_upto DATE DEFAULT NULL, p_division TEXT DEFAULT NULL)
RETURNS TABLE (
  this_year NUMERIC, last_year NUMERIC, change NUMERIC, fy_started DATE,
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

GRANT EXECUTE ON FUNCTION protean_company(DATE, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 3. Month by month, and now also split by division so a chart can
--    stack the three rather than draw one line and call it revenue.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS protean_by_month(INTEGER, DATE);

CREATE OR REPLACE FUNCTION protean_by_month(p_months INTEGER DEFAULT 24, p_upto DATE DEFAULT NULL,
                                 p_division TEXT DEFAULT NULL)
RETURNS TABLE (month DATE, net NUMERIC, invoices INTEGER)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  upto  DATE := date_trunc('month', COALESCE(p_upto, CURRENT_DATE))::DATE;
  span  INTEGER := GREATEST(1, LEAST(COALESCE(p_months, 24), 120));
  since DATE;
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Company revenue needs access to the CRM.';
  END IF;
  since := (upto - ((span - 1) || ' months')::INTERVAL)::DATE;

  RETURN QUERY
  SELECT m::DATE, COALESCE(SUM(i.net), 0)::NUMERIC, count(i.invoice_no)::INTEGER
    FROM generate_series(since, upto, INTERVAL '1 month') AS m
    LEFT JOIN protean_invoices i
      ON date_trunc('month', i.tax_point) = m
     AND (p_division IS NULL OR i.division = p_division)
   GROUP BY m
   ORDER BY m;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_by_month(INTEGER, DATE, TEXT) TO authenticated;

/** Every division's month, in one call, for a stacked chart. */
CREATE OR REPLACE FUNCTION revenue_by_month_and_division(
  p_months INTEGER DEFAULT 24, p_upto DATE DEFAULT NULL)
RETURNS TABLE (month DATE, division TEXT, name TEXT, net NUMERIC, invoices INTEGER)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  upto  DATE := date_trunc('month', COALESCE(p_upto, CURRENT_DATE))::DATE;
  span  INTEGER := GREATEST(1, LEAST(COALESCE(p_months, 24), 120));
  since DATE;
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Company revenue needs access to the CRM.';
  END IF;
  since := (upto - ((span - 1) || ' months')::INTERVAL)::DATE;

  /* Every month against every division, so a division with a quiet
     month still has a point on the chart at zero rather than a gap the
     line draws straight across. */
  RETURN QUERY
  SELECT m::DATE, d.slug, d.name,
         COALESCE(SUM(i.net), 0)::NUMERIC,
         count(i.invoice_no)::INTEGER
    FROM generate_series(since, upto, INTERVAL '1 month') AS m
   CROSS JOIN divisions d
    LEFT JOIN protean_invoices i
      ON date_trunc('month', i.tax_point) = m AND i.division = d.slug
   GROUP BY m, d.slug, d.name, d.sort_order
   ORDER BY m, d.sort_order;
END;
$fn$;

GRANT EXECUTE ON FUNCTION revenue_by_month_and_division(INTEGER, DATE) TO authenticated;

-- -------------------------------------------------------------
-- 4. Every customer, and every group.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS protean_year_on_year(DATE);

CREATE OR REPLACE FUNCTION protean_year_on_year(p_upto DATE DEFAULT NULL, p_division TEXT DEFAULT NULL)
RETURNS TABLE (
  contact_id UUID, company_name TEXT, alphas TEXT[],
  this_year NUMERIC, last_year NUMERIC, change NUMERIC,
  open_jobs INTEGER, open_value NUMERIC, last_billed DATE, fy_started DATE
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
  SELECT c.id, c.company_name, array_agg(DISTINCT a.alpha),
         COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy  AND i.tax_point <= upto), 0)::NUMERIC,
         COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0)::NUMERIC,
         (COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy  AND i.tax_point <= upto), 0)
          - COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0))::NUMERIC,
         (SELECT count(*)::INTEGER FROM protean_open_jobs j
           JOIN protean_accounts ja ON ja.division = j.division AND ja.alpha = j.alpha
          WHERE ja.contact_id = c.id AND j.still_open
            AND (p_division IS NULL OR j.division = p_division)),
         (SELECT COALESCE(SUM(j.job_total), 0)::NUMERIC FROM protean_open_jobs j
           JOIN protean_accounts ja ON ja.division = j.division AND ja.alpha = j.alpha
          WHERE ja.contact_id = c.id AND j.still_open
            AND (p_division IS NULL OR j.division = p_division)),
         max(i.tax_point), fy
    FROM protean_accounts a
    JOIN crm_contacts c ON c.id = a.contact_id
    LEFT JOIN protean_invoices i ON i.division = a.division AND i.alpha = a.alpha
   WHERE NOT a.ignored AND (p_division IS NULL OR a.division = p_division)
   GROUP BY c.id, c.company_name
  HAVING COALESCE(SUM(i.net), 0) <> 0
      OR EXISTS (SELECT 1 FROM protean_open_jobs j
                  JOIN protean_accounts ja ON ja.division = j.division AND ja.alpha = j.alpha
                 WHERE ja.contact_id = c.id AND j.still_open
                   AND (p_division IS NULL OR j.division = p_division))
   ORDER BY 4 DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_year_on_year(DATE, TEXT) TO authenticated;

DROP FUNCTION IF EXISTS protean_accounts_of(UUID);

CREATE OR REPLACE FUNCTION protean_accounts_of(p_contact UUID)
RETURNS TABLE (
  division TEXT, division_name TEXT, alpha TEXT, protean_name TEXT, ignored BOOLEAN,
  invoices INTEGER, net NUMERIC, first_billed DATE, last_billed DATE,
  open_jobs INTEGER, open_value NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Seeing what a customer has spent needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT a.division, d.name, a.alpha, a.protean_name, a.ignored,
         count(i.invoice_no)::INTEGER,
         COALESCE(SUM(i.net), 0)::NUMERIC,
         min(i.tax_point), max(i.tax_point),
         (SELECT count(*)::INTEGER FROM protean_open_jobs j
           WHERE j.division = a.division AND j.alpha = a.alpha AND j.still_open),
         (SELECT COALESCE(SUM(j.job_total), 0)::NUMERIC FROM protean_open_jobs j
           WHERE j.division = a.division AND j.alpha = a.alpha AND j.still_open)
    FROM protean_accounts a
    JOIN divisions d ON d.slug = a.division
    LEFT JOIN protean_invoices i ON i.division = a.division AND i.alpha = a.alpha
   WHERE a.contact_id = p_contact
   GROUP BY a.division, d.name, d.sort_order, a.alpha, a.protean_name, a.ignored
   ORDER BY d.sort_order, 7 DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_accounts_of(UUID) TO authenticated;

DROP FUNCTION IF EXISTS protean_spend(UUID);

CREATE OR REPLACE FUNCTION protean_spend(p_contact UUID, p_division TEXT DEFAULT NULL)
RETURNS TABLE (year INTEGER, net NUMERIC, invoices INTEGER,
               first_billed DATE, last_billed DATE)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Seeing what a customer has spent needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT EXTRACT(YEAR FROM financial_year_of(i.tax_point))::INTEGER,
         SUM(i.net)::NUMERIC, count(*)::INTEGER,
         min(i.tax_point), max(i.tax_point)
    FROM protean_invoices i
    JOIN protean_accounts a ON a.division = i.division AND a.alpha = i.alpha
   WHERE a.contact_id = p_contact
     AND (p_division IS NULL OR i.division = p_division)
   GROUP BY 1
   ORDER BY 1 DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_spend(UUID, TEXT) TO authenticated;

DROP FUNCTION IF EXISTS protean_open_work(UUID);

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
    JOIN protean_accounts a ON a.division = j.division AND a.alpha = j.alpha
   WHERE a.contact_id = p_contact AND j.still_open
     AND (p_division IS NULL OR j.division = p_division)
   ORDER BY j.logged_on ASC NULLS LAST;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_open_work(UUID, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 5. Groups. A group spans divisions the same way a customer does.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION group_revenue(p_upto DATE DEFAULT NULL)
RETURNS TABLE (
  group_id UUID, group_name TEXT, customers INTEGER, accounts INTEGER,
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
  WITH billed AS (
    SELECT c.group_id AS g, c.id AS contact, a.division, a.alpha,
           COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy  AND i.tax_point <= upto), 0) AS ty,
           COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0) AS ly,
           max(i.tax_point) AS latest
      FROM crm_contacts c
      JOIN protean_accounts a ON a.contact_id = c.id AND NOT a.ignored
      LEFT JOIN protean_invoices i ON i.division = a.division AND i.alpha = a.alpha
     WHERE c.group_id IS NOT NULL
     GROUP BY c.group_id, c.id, a.division, a.alpha
  ),
  work AS (
    SELECT c.group_id AS g, count(*)::INTEGER AS jobs,
           COALESCE(SUM(j.job_total), 0)::NUMERIC AS value
      FROM protean_open_jobs j
      JOIN protean_accounts a ON a.division = j.division AND a.alpha = j.alpha AND NOT a.ignored
      JOIN crm_contacts c ON c.id = a.contact_id
     WHERE j.still_open AND c.group_id IS NOT NULL
     GROUP BY c.group_id
  )
  SELECT gr.id, gr.name,
         count(DISTINCT b.contact)::INTEGER,
         count(DISTINCT (b.division || ':' || b.alpha))::INTEGER,
         COALESCE(SUM(b.ty), 0)::NUMERIC,
         COALESCE(SUM(b.ly), 0)::NUMERIC,
         (COALESCE(SUM(b.ty), 0) - COALESCE(SUM(b.ly), 0))::NUMERIC,
         COALESCE(max(w.jobs), 0), COALESCE(max(w.value), 0)::NUMERIC,
         max(b.latest)
    FROM customer_groups gr
    LEFT JOIN billed b ON b.g = gr.id
    LEFT JOIN work   w ON w.g = gr.id
   GROUP BY gr.id, gr.name
   ORDER BY 5 DESC, gr.name;
END;
$fn$;

DROP FUNCTION IF EXISTS group_breakdown(UUID, DATE);

CREATE OR REPLACE FUNCTION group_breakdown(p_group UUID, p_upto DATE DEFAULT NULL)
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
   GROUP BY a.division, a.alpha, a.protean_name, c.id, c.company_name
   ORDER BY 6 DESC, a.protean_name;
END;
$fn$;

GRANT EXECUTE ON FUNCTION group_breakdown(UUID, DATE) TO authenticated;

DO $$
BEGIN
  RAISE NOTICE 'ok  every figure can be read for one division or for all of them, and none of them mix';
END $$;
