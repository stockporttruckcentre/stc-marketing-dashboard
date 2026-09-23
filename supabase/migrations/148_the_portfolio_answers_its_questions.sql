-- =============================================================
-- 148. The personal portfolio answers the questions asked of it.
--
-- From the business, in one message:
--
--   personal portfolio should have a list like the revenue tab of
--   customers and their revenue. limit to 20 rows with scrolling. can
--   click into a customer and see their broken down revenue, set
--   reminder button against each, compare against another customer.
--
--   biggest gainers should only show maintenance, rental, or both,
--   buttons to switch
--
-- and, separately:
--
--   on personal portfolio, in 'across the three' make it so you can
--   click 'open' or 'won' or 'lost' pills and see a list of those
--   records
--
-- Four functions, one per question. All four ask
-- `personal_analytics_may_view` before shaping a single figure, the
-- same gate every other function on this screen asks, so a request
-- carrying somebody else's id gets no rows rather than a nought.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The records behind a pill.
--
-- "make it so you can click 'open' or 'won' or 'lost' pills and see a
-- list of those records". Same three states the pills count, counted
-- the same way `personal_pipeline` counts them, so the list and the
-- number on the pill cannot disagree.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS personal_deals(UUID, TEXT, TEXT, DATE);
CREATE OR REPLACE FUNCTION personal_deals(
  p_person UUID, p_type TEXT, p_state TEXT, p_when DATE DEFAULT NULL
)
RETURNS TABLE (
  id              UUID,
  contact_id      UUID,
  company_name    TEXT,
  what            TEXT,
  status          TEXT,
  worth           NUMERIC,
  order_date      DATE,
  date_of_enquiry DATE,
  last_activity_at TIMESTAMPTZ,
  stock_no        TEXT,
  contract_ref    TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE fy_start DATE := financial_year_of(COALESCE(p_when, CURRENT_DATE));
BEGIN
  IF NOT personal_analytics_may_view(p_person) THEN
    RETURN;
  END IF;
  IF p_state NOT IN ('open', 'won', 'lost') THEN
    RAISE EXCEPTION 'A deal is open, won or lost. There is no %.', p_state;
  END IF;

  RETURN QUERY
  SELECT l.id, l.contact_id, l.company_name, l.what, l.status,
         lead_worth(l.status, l.sale_price, l.estimated_value),
         l.order_date, l.date_of_enquiry, l.last_activity_at,
         s.stc_no, f.ref
    FROM crm_leads l
    LEFT JOIN stock_trailers s       ON s.id = l.stock_trailer_id
    LEFT JOIN fleetsmart_contracts f ON f.lead_id = l.id
   WHERE l.owner_id = p_person
     AND (p_type IS NULL OR l.type = p_type)
     AND CASE p_state
           WHEN 'open' THEN l.status IN ('lead', 'contacted', 'quoted')
           /* Won counts the same financial year the pill counts, and
              an undated win is NOT in it. The pill says how many of
              those there are; a list that quietly included them would
              not add up to the number beside it. */
           WHEN 'won'  THEN l.status = 'won'
                            AND l.order_date >= fy_start
                            AND l.order_date < fy_start + INTERVAL '1 year'
           ELSE l.status = 'lost'
         END
   ORDER BY COALESCE(l.order_date, l.date_of_enquiry) DESC NULLS LAST,
            l.last_activity_at DESC NULLS LAST;
END;
$fn$;

REVOKE ALL ON FUNCTION personal_deals(UUID, TEXT, TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_deals(UUID, TEXT, TEXT, DATE) TO authenticated;

-- -------------------------------------------------------------
-- 2. The customers on this portfolio, and what each one spends.
--
-- "a list like the revenue tab of customers and their revenue. limit
-- to 20 rows with scrolling."
--
-- Twenty rows is the SCREEN's business, not this function's: it takes a
-- limit and an offset so the list can be scrolled rather than truncated,
-- and returns the total so the screen can say how many there are.
--
-- Every figure comes through `invoice_customer`, migration 130, which
-- is what strips a cash sale back to the customer who actually paid.
-- Same route as the revenue tab, so the two cannot disagree.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS personal_customers(UUID, DATE, INT, INT, TEXT);
CREATE OR REPLACE FUNCTION personal_customers(
  p_person UUID,
  p_upto   DATE DEFAULT NULL,
  p_limit  INT  DEFAULT 20,
  p_offset INT  DEFAULT 0,
  p_sort   TEXT DEFAULT 'this_year'
)
RETURNS TABLE (
  contact_id  UUID,
  company_name TEXT,
  this_year   NUMERIC,
  last_year   NUMERIC,
  change      NUMERIC,
  change_pct  NUMERIC,
  invoices    INT,
  last_billed DATE,
  divisions   TEXT,
  open_deals  INT,
  open_value  NUMERIC,
  total_rows  INT
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
           i.division, i.tax_point, i.net
      FROM protean_invoices i
      LEFT JOIN protean_accounts a
        ON a.division = i.division AND a.alpha = i.alpha
  ),
  spend AS (
    SELECT m.contact_id,
           COALESCE(SUM(o.net) FILTER (
             WHERE o.tax_point >= fy AND o.tax_point <= upto), 0)::NUMERIC AS now_,
           COALESCE(SUM(o.net) FILTER (
             WHERE o.tax_point >= fy0 AND o.tax_point <= cut), 0)::NUMERIC AS then_,
           COUNT(o.net) FILTER (
             WHERE o.tax_point >= fy AND o.tax_point <= upto)::INT AS bills,
           MAX(o.tax_point) FILTER (WHERE o.tax_point <= upto) AS last_bill,
           string_agg(DISTINCT d.name, ', ' ORDER BY d.name) AS divs
      FROM mine m
      LEFT JOIN owned o    ON o.contact = m.contact_id
      LEFT JOIN divisions d ON d.slug = o.division
     GROUP BY m.contact_id
  ),
  pipeline AS (
    SELECT l.contact_id,
           COUNT(*)::INT AS deals,
           SUM(lead_worth(l.status, l.sale_price, l.estimated_value)) AS worth
      FROM crm_leads l
     WHERE l.owner_id = p_person
       AND l.status IN ('lead', 'contacted', 'quoted')
     GROUP BY l.contact_id
  ),
  shaped AS (
    SELECT s.contact_id, c.company_name,
           ROUND(s.now_, 2)  AS this_year,
           ROUND(s.then_, 2) AS last_year,
           ROUND(s.now_ - s.then_, 2) AS change,
           CASE WHEN s.then_ > 0
                THEN ROUND(((s.now_ - s.then_) / s.then_) * 100, 1)
                ELSE NULL END AS change_pct,
           s.bills, s.last_bill, s.divs,
           COALESCE(p.deals, 0) AS open_deals,
           p.worth              AS open_value
      FROM spend s
      JOIN crm_contacts c ON c.id = s.contact_id AND c.deleted_at IS NULL
      LEFT JOIN pipeline p ON p.contact_id = s.contact_id
  )
  SELECT sh.contact_id, sh.company_name, sh.this_year, sh.last_year,
         sh.change, sh.change_pct, sh.bills, sh.last_bill, sh.divs,
         sh.open_deals, sh.open_value,
         COUNT(*) OVER ()::INT
    FROM shaped sh
   ORDER BY
     CASE WHEN p_sort = 'name'      THEN NULL ELSE
       CASE p_sort
         WHEN 'last_year' THEN sh.last_year
         WHEN 'change'    THEN sh.change
         WHEN 'open'      THEN COALESCE(sh.open_value, 0)
         ELSE sh.this_year
       END END DESC NULLS LAST,
     CASE WHEN p_sort = 'name' THEN LOWER(sh.company_name) END ASC,
     LOWER(sh.company_name) ASC
   LIMIT GREATEST(1, COALESCE(p_limit, 20))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
END;
$fn$;

REVOKE ALL ON FUNCTION personal_customers(UUID, DATE, INT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_customers(UUID, DATE, INT, INT, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 3. One customer, broken down.
--
-- "can click into a customer and see their broken down revenue".
--
-- Broken down by DIVISION and by MONTH, because those are the two
-- questions somebody asks next: which part of the business they spend
-- with, and whether it is going up. Both come out of the same invoice
-- rows the list above totalled, so the parts add to the whole.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS personal_customer_breakdown(UUID, UUID, DATE);
CREATE OR REPLACE FUNCTION personal_customer_breakdown(
  p_person UUID, p_contact UUID, p_upto DATE DEFAULT NULL
)
RETURNS TABLE (
  grain     TEXT,
  label     TEXT,
  sort_key  TEXT,
  this_year NUMERIC,
  last_year NUMERIC,
  invoices  INT
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

  /* And the customer has to be one of theirs. Without this, anybody who
     may see one portfolio could read any customer's spend by passing an
     id, which is a different permission entirely. */
  IF NOT EXISTS (
    SELECT 1 FROM crm_leads l
     WHERE l.owner_id = p_person AND l.contact_id = p_contact
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH owned AS (
    SELECT i.division, i.tax_point, i.net
      FROM protean_invoices i
      LEFT JOIN protean_accounts a
        ON a.division = i.division AND a.alpha = i.alpha
     WHERE invoice_customer(i.contact_id,
             CASE WHEN a.ignored THEN NULL ELSE a.contact_id END) = p_contact
  )
  SELECT 'division'::TEXT, d.name, d.sort_order::TEXT,
         ROUND(COALESCE(SUM(o.net) FILTER (
           WHERE o.tax_point >= fy AND o.tax_point <= upto), 0), 2),
         ROUND(COALESCE(SUM(o.net) FILTER (
           WHERE o.tax_point >= fy0 AND o.tax_point <= cut), 0), 2),
         COUNT(*) FILTER (WHERE o.tax_point >= fy AND o.tax_point <= upto)::INT
    FROM owned o
    JOIN divisions d ON d.slug = o.division
   GROUP BY d.name, d.sort_order

  UNION ALL

  SELECT 'month'::TEXT,
         to_char(date_trunc('month', o.tax_point), 'Mon YYYY'),
         to_char(date_trunc('month', o.tax_point), 'YYYY-MM'),
         ROUND(SUM(o.net), 2),
         NULL::NUMERIC,
         COUNT(*)::INT
    FROM owned o
   WHERE o.tax_point >= fy AND o.tax_point <= upto
   GROUP BY date_trunc('month', o.tax_point)

  ORDER BY 1, 3;
END;
$fn$;

REVOKE ALL ON FUNCTION personal_customer_breakdown(UUID, UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_customer_breakdown(UUID, UUID, DATE) TO authenticated;

-- -------------------------------------------------------------
-- 4. Gainers and fallers, per division.
--
-- "biggest gainers should only show maintenance, rental, or both,
-- buttons to switch"
--
-- The divisions asked for by name are the two Protean ones a customer
-- is billed under. `p_division` takes a slug, or NULL for both, which
-- is what the Both button sends.
--
-- The THREE argument version is dropped rather than left beside this
-- one. Two overloads that differ only by a defaulted argument are not
-- two functions, they are an ambiguity: `personal_movers(id, NULL, 10)`
-- matches both and Postgres refuses to choose. Anything calling it with
-- three arguments still works, because the fourth defaults.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS personal_movers(UUID, DATE, INT);
DROP FUNCTION IF EXISTS personal_movers(UUID, DATE, INT, TEXT);
CREATE OR REPLACE FUNCTION personal_movers(
  p_person UUID, p_upto DATE DEFAULT NULL, p_limit INT DEFAULT 20,
  p_division TEXT DEFAULT NULL
)
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
  IF p_division IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM divisions d WHERE d.slug = p_division) THEN
    RAISE EXCEPTION 'There is no division called %.', p_division;
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
     WHERE p_division IS NULL OR i.division = p_division
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

REVOKE ALL ON FUNCTION personal_movers(UUID, DATE, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_movers(UUID, DATE, INT, TEXT) TO authenticated;
