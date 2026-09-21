-- =============================================================
-- 132. Dean's portfolio, and the name search, honour it too.
--
-- 131 did the company screens. These are the three a salesperson
-- actually looks at, so leaving them on the old rule would have been
-- the same bug in a different place.
-- =============================================================

-- -------------------------------------------------------------
-- The portfolio's invoiced revenue, this year against last.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS personal_revenue_year(UUID, DATE);
CREATE OR REPLACE FUNCTION personal_revenue_year(p_person UUID, p_upto DATE DEFAULT NULL)
RETURNS TABLE (
  year_from    DATE,
  year_to      DATE,
  last_from    DATE,
  last_to      DATE,
  this_year    NUMERIC,
  last_year    NUMERIC,
  change       NUMERIC,
  change_pct   NUMERIC,
  customers    INT,
  with_revenue INT,
  not_bound    INT
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
  IF NOT personal_analytics_may_view(p_person) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH mine AS (
    SELECT DISTINCT l.contact_id
      FROM crm_leads l
      JOIN crm_contacts c ON c.id = l.contact_id AND c.deleted_at IS NULL
     WHERE l.owner_id = p_person AND l.contact_id IS NOT NULL
  ),
  owned AS (
    SELECT invoice_customer(i.contact_id,
             CASE WHEN a.ignored THEN NULL ELSE a.contact_id END) AS contact,
           i.tax_point, i.net
      FROM protean_invoices i
      LEFT JOIN protean_accounts a
        ON a.division = i.division AND a.alpha = i.alpha
  ),
  per_customer AS (
    SELECT m.contact_id,
           COALESCE(SUM(o.net) FILTER (
             WHERE o.tax_point >= fy AND o.tax_point <= upto), 0)::NUMERIC AS now_,
           COALESCE(SUM(o.net) FILTER (
             WHERE o.tax_point >= fy0 AND o.tax_point <= cut), 0)::NUMERIC AS last_,
           /* Reachable at all: an account, or an invoice placed by
              hand. Without either there is no figure to have, which is
              different from having one of nought. */
           (EXISTS (SELECT 1 FROM protean_accounts a2
                     WHERE a2.contact_id = m.contact_id AND NOT a2.ignored)
            OR EXISTS (SELECT 1 FROM protean_invoices i2
                        WHERE i2.contact_id = m.contact_id)) AS bound
      FROM mine m
      LEFT JOIN owned o ON o.contact = m.contact_id
     GROUP BY m.contact_id
  )
  SELECT
    fy, upto, fy0, cut,
    ROUND(COALESCE(SUM(p.now_), 0), 2),
    ROUND(COALESCE(SUM(p.last_), 0), 2),
    ROUND(COALESCE(SUM(p.now_), 0) - COALESCE(SUM(p.last_), 0), 2),
    CASE WHEN COALESCE(SUM(p.last_), 0) > 0
         THEN ROUND(((SUM(p.now_) - SUM(p.last_)) / SUM(p.last_)) * 100, 1)
         ELSE NULL END,
    COUNT(*)::INT,
    COUNT(*) FILTER (WHERE p.now_ <> 0 OR p.last_ <> 0)::INT,
    COUNT(*) FILTER (WHERE NOT p.bound)::INT
  FROM per_customer p;
END;
$fn$;

REVOKE ALL ON FUNCTION personal_revenue_year(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_revenue_year(UUID, DATE) TO authenticated;

-- -------------------------------------------------------------
-- Gainers and fallers.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS personal_movers(UUID, DATE, INTEGER);
CREATE OR REPLACE FUNCTION personal_movers(
  p_person UUID, p_upto DATE DEFAULT NULL, p_limit INTEGER DEFAULT 20)
RETURNS TABLE (
  contact_id UUID, company_name TEXT, this_year NUMERIC, last_year NUMERIC,
  change NUMERIC, change_pct NUMERIC, divisions TEXT
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
  IF NOT personal_analytics_may_view(p_person) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH mine AS (
    SELECT DISTINCT l.contact_id
      FROM crm_leads l
     WHERE l.owner_id = p_person AND l.contact_id IS NOT NULL
  ),
  owned AS (
    SELECT invoice_customer(i.contact_id,
             CASE WHEN a.ignored THEN NULL ELSE a.contact_id END) AS contact,
           i.division, i.tax_point, i.net
      FROM protean_invoices i
      LEFT JOIN protean_accounts a
        ON a.division = i.division AND a.alpha = i.alpha
  ),
  per_customer AS (
    SELECT o.contact AS contact_id,
           COALESCE(SUM(o.net) FILTER (
             WHERE o.tax_point >= fy AND o.tax_point <= upto), 0)::NUMERIC AS now_,
           COALESCE(SUM(o.net) FILTER (
             WHERE o.tax_point >= fy0 AND o.tax_point <= cut), 0)::NUMERIC AS then_,
           string_agg(DISTINCT d.name, ', ' ORDER BY d.name) AS divs
      FROM owned o
      JOIN divisions d ON d.slug = o.division
      JOIN mine m ON m.contact_id = o.contact
     GROUP BY o.contact
  )
  SELECT p.contact_id, c.company_name, p.now_, p.then_,
         (p.now_ - p.then_)::NUMERIC,
         CASE WHEN p.then_ > 0
              THEN round(((p.now_ - p.then_) / p.then_) * 100, 1)
              ELSE NULL END,
         p.divs
    FROM per_customer p
    JOIN crm_contacts c ON c.id = p.contact_id AND c.deleted_at IS NULL
   WHERE p.now_ <> p.then_
   ORDER BY abs(p.now_ - p.then_) DESC
   LIMIT GREATEST(1, p_limit);
END;
$fn$;

REVOKE ALL ON FUNCTION personal_movers(UUID, DATE, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_movers(UUID, DATE, INTEGER) TO authenticated;

-- -------------------------------------------------------------
-- And the name search from 129.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS revenue_find_customer(TEXT, DATE);
CREATE OR REPLACE FUNCTION revenue_find_customer(p_needle TEXT, p_upto DATE DEFAULT NULL)
RETURNS TABLE (
  contact_id   UUID, company_name TEXT, divisions TEXT, alphas TEXT[],
  this_year NUMERIC, last_year NUMERIC, change NUMERIC, ever NUMERIC,
  last_billed DATE, open_jobs INT, set_aside INT, why TEXT
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
  IF BTRIM(COALESCE(p_needle, '')) = '' THEN RETURN; END IF;

  RETURN QUERY
  WITH hit AS (
    SELECT c.id, c.company_name FROM crm_contacts c
     WHERE c.deleted_at IS NULL AND c.company_name ILIKE needle
  ),
  owned AS (
    SELECT invoice_customer(i.contact_id,
             CASE WHEN a.ignored THEN NULL ELSE a.contact_id END) AS contact,
           i.division, i.alpha, i.tax_point, i.net
      FROM protean_invoices i
      LEFT JOIN protean_accounts a
        ON a.division = i.division AND a.alpha = i.alpha
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
  /* THE SEARCH COUNTS SET ASIDE MONEY TOO, unlike the figures.
     Its job is to answer "where is my customer's money", and money on
     a set aside account is exactly the thing somebody is hunting for.
     The reason line says it is set aside, so the figure is never
     mistaken for one the screens are counting. */
  searchable AS (
    SELECT COALESCE(i.contact_id, a.contact_id) AS contact,
           i.division, i.alpha, i.tax_point, i.net
      FROM protean_invoices i
      LEFT JOIN protean_accounts a
        ON a.division = i.division AND a.alpha = i.alpha
  ),
  money AS (
    SELECT h.id AS contact,
           COALESCE(SUM(o.net) FILTER (
             WHERE o.tax_point >= fy AND o.tax_point <= upto), 0)::NUMERIC AS ty,
           COALESCE(SUM(o.net) FILTER (
             WHERE o.tax_point >= fy0 AND o.tax_point <= cut), 0)::NUMERIC AS ly,
           COALESCE(SUM(o.net), 0)::NUMERIC AS ev,
           MAX(o.tax_point) AS latest,
           string_agg(DISTINCT o.division || '/' || o.alpha, ', ') AS billed_on
      FROM hit h JOIN searchable o ON o.contact = h.id
     GROUP BY h.id
  ),
  work AS (
    SELECT h.id AS contact, count(*)::INT AS jobs
      FROM hit h JOIN protean_open_jobs j ON j.contact_id = h.id AND j.still_open
     GROUP BY h.id
  )
  SELECT h.id, h.company_name,
         COALESCE(a.divs, ''),
         COALESCE(a.codes, ARRAY[]::TEXT[]),
         COALESCE(m.ty, 0), COALESCE(m.ly, 0),
         COALESCE(m.ty, 0) - COALESCE(m.ly, 0),
         COALESCE(m.ev, 0), m.latest,
         COALESCE(w.jobs, 0), COALESCE(a.aside, 0),
         CASE
           WHEN a.contact IS NULL AND m.contact IS NULL THEN
             'No Protean or Sage account is linked to this customer, and no invoice has been placed on it by hand.'
           WHEN a.contact IS NULL AND m.contact IS NOT NULL THEN
             'Billed through ' || m.billed_on || ', placed on this customer by hand rather than by account.'
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
    LEFT JOIN acc a ON a.contact = h.id
    LEFT JOIN money m ON m.contact = h.id
    LEFT JOIN work w ON w.contact = h.id
   ORDER BY COALESCE(m.ty, 0) DESC, h.company_name;
END;
$fn$;

REVOKE ALL ON FUNCTION revenue_find_customer(TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION revenue_find_customer(TEXT, DATE) TO authenticated;

DO $$ BEGIN
  RAISE NOTICE 'a portfolio and a name search both read the invoice''s own customer';
END $$;
