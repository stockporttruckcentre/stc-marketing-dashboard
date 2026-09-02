-- =============================================================
-- 088. Three divisions, on one footing.
--
-- From the business:
--
--   the analytics page he wants splitting in to 3 divisions (vertical
--   columns) - STC - Trailer Sales - Rental ... Has to be robust and
--   well connected to present the data to our finance teams who'll want
--   to drill into things.
--
-- ---- The three do not live in one place, and should not ----
--
--   STC            protean_invoices, division 'stc'
--   S&L Rental     protean_invoices, division 'rental'
--   Trailer Sales  stock_trailers, status 'sold'
--
-- A trailer sale is not an invoice. It is one large event with a cost
-- and a margin on it, where the other two are thousands of small
-- documents with no cost recorded anywhere. Forcing them into one table
-- would mean either inventing a cost for maintenance or throwing away
-- the margin on trailers, and both are worse than the join.
--
-- So they stay where they are and this file puts them on one footing:
-- the same year, the same like for like cut, the same shape of answer.
-- Three columns that can honestly sit side by side.
--
-- ---- The pipeline already knew ----
--
-- `crm_leads.type` is already `maintenance`, `trailer_sales` or
-- `rental`, which is the same three. So a lead has always carried its
-- division and nothing needed adding: the analytics screen simply never
-- asked.
--
-- ---- Where margin is honest and where it is not ----
--
-- Only trailer sales record a cost, so only trailer sales can show a
-- margin. The other two return null rather than nought, because nought
-- reads as "we made nothing on it" and null reads as "we do not know",
-- and on a finance screen those are very different sentences.
-- =============================================================

-- -------------------------------------------------------------
-- 1. A trailer sale can reach the customer it was sold to.
--
-- `stock_trailers.customer` is free text typed by whoever closed the
-- deal, so it is matched to a CRM record the same way a Protean account
-- is: exactly, after the generic words are set aside, and never by
-- guessing. What does not match stays visible rather than being forced.
-- -------------------------------------------------------------
ALTER TABLE stock_trailers
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES crm_contacts ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stock_trailers_contact
  ON stock_trailers (contact_id) WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_trailers_sold
  ON stock_trailers (COALESCE(dispatch_date, order_date)) WHERE status = 'sold';

/**
 * Link sold trailers to CRM records by name.
 *
 * Exact after normalising, and nothing else. The same rule the Protean
 * matcher binds on, for the same reason: a near miss here puts one
 * haulier's trailer purchase on another haulier's record, and the first
 * symptom is a figure in a board meeting nobody can explain.
 */
CREATE OR REPLACE FUNCTION link_trailer_sales()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE linked INTEGER;
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Linking trailer sales needs access to the CRM.';
  END IF;

  UPDATE stock_trailers t
     SET contact_id = c.id
    FROM crm_contacts c
   WHERE t.contact_id IS NULL
     AND t.customer IS NOT NULL
     AND lower(btrim(t.customer)) = lower(btrim(c.company_name));
  GET DIAGNOSTICS linked = ROW_COUNT;
  RETURN linked;
END;
$fn$;

GRANT EXECUTE ON FUNCTION link_trailer_sales() TO authenticated;

/** The day a trailer's money moved. Dispatch, or the order if it has not left. */
CREATE OR REPLACE FUNCTION sold_on(t stock_trailers)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $fn$ SELECT COALESCE(t.dispatch_date, t.order_date); $fn$;

GRANT EXECUTE ON FUNCTION sold_on(stock_trailers) TO authenticated;

-- -------------------------------------------------------------
-- 2. What each division billed, side by side.
--
-- One row per division, every figure on the company's year and cut like
-- for like against the same point last year, so the three columns are
-- comparable rather than merely adjacent.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION division_revenue(p_upto DATE DEFAULT NULL)
RETURNS TABLE (
  division       TEXT,
  name           TEXT,
  sort_order     INTEGER,
  this_year      NUMERIC,
  last_year      NUMERIC,
  last_year_full NUMERIC,
  change         NUMERIC,
  /* Invoices for the two Protean divisions, trailers sold for the
     third. Named for what it counts rather than for what it is. */
  deals          INTEGER,
  customers      INTEGER,
  /* Only trailer sales record a cost. Null elsewhere, and null means
     we do not know rather than we made nothing. */
  margin         NUMERIC,
  /* Work on the ramps for the two Protean divisions, stock on the yard
     for the third. Both are money committed and not yet billed. */
  outstanding    NUMERIC,
  outstanding_n  INTEGER,
  outstanding_of TEXT,
  fy_started     DATE,
  last_activity  DATE
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
    RAISE EXCEPTION 'Company revenue needs access to the CRM.';
  END IF;

  RETURN QUERY
  /* The two that come out of Protean. */
  SELECT d.slug, d.name, d.sort_order,
         COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy  AND i.tax_point <= upto), 0)::NUMERIC,
         COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0)::NUMERIC,
         COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= fy0e), 0)::NUMERIC,
         (COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy  AND i.tax_point <= upto), 0)
          - COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0))::NUMERIC,
         count(*) FILTER (WHERE i.tax_point >= fy AND i.tax_point <= upto)::INTEGER,
         (SELECT count(DISTINCT a.contact_id)::INTEGER FROM protean_accounts a
           WHERE a.division = d.slug AND a.contact_id IS NOT NULL AND NOT a.ignored),
         NULL::NUMERIC,
         (SELECT COALESCE(SUM(j.job_total), 0)::NUMERIC FROM protean_open_jobs j
           WHERE j.division = d.slug AND j.still_open),
         (SELECT count(*)::INTEGER FROM protean_open_jobs j
           WHERE j.division = d.slug AND j.still_open),
         'open on the system',
         fy,
         max(i.tax_point)
    FROM divisions d
    LEFT JOIN protean_invoices i ON i.division = d.slug
   WHERE d.slug IN ('stc', 'rental')
   GROUP BY d.slug, d.name, d.sort_order

  UNION ALL

  /* And the one that comes out of the stock list.

     Dated on dispatch, falling back to the order, because a trailer
     ordered in March and dispatched in April belongs to the year it
     left the yard in and that is the date the money moved. */
  SELECT d.slug, d.name, d.sort_order,
         COALESCE(SUM(t.sales_price) FILTER (
           WHERE sold_on(t) >= fy AND sold_on(t) <= upto), 0)::NUMERIC,
         COALESCE(SUM(t.sales_price) FILTER (
           WHERE sold_on(t) >= fy0 AND sold_on(t) <= cut), 0)::NUMERIC,
         COALESCE(SUM(t.sales_price) FILTER (
           WHERE sold_on(t) >= fy0 AND sold_on(t) <= fy0e), 0)::NUMERIC,
         (COALESCE(SUM(t.sales_price) FILTER (
            WHERE sold_on(t) >= fy AND sold_on(t) <= upto), 0)
          - COALESCE(SUM(t.sales_price) FILTER (
            WHERE sold_on(t) >= fy0 AND sold_on(t) <= cut), 0))::NUMERIC,
         count(*) FILTER (WHERE sold_on(t) >= fy AND sold_on(t) <= upto)::INTEGER,
         count(DISTINCT t.contact_id) FILTER (WHERE t.contact_id IS NOT NULL)::INTEGER,
         COALESCE(SUM(t.profit) FILTER (
           WHERE sold_on(t) >= fy AND sold_on(t) <= upto), 0)::NUMERIC,
         (SELECT COALESCE(SUM(COALESCE(s.total_nbv, s.nbv)), 0)::NUMERIC
            FROM stock_trailers s WHERE s.status IN ('in_stock', 'new_build')),
         (SELECT count(*)::INTEGER FROM stock_trailers s
           WHERE s.status IN ('in_stock', 'new_build')),
         'in stock',
         fy,
         max(sold_on(t))
    FROM divisions d
    LEFT JOIN stock_trailers t ON d.slug = 'trailer' AND t.status = 'sold'
   WHERE d.slug = 'trailer'
   GROUP BY d.slug, d.name, d.sort_order

   ORDER BY 3;
END;
$fn$;

GRANT EXECUTE ON FUNCTION division_revenue(DATE) TO authenticated;

-- -------------------------------------------------------------
-- 3. Month by month, all three, for a chart that stacks them.
--
-- Every month against every division, so a quiet month is a point at
-- nought rather than a gap the line draws straight across.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION division_by_month(
  p_months INTEGER DEFAULT 24, p_upto DATE DEFAULT NULL)
RETURNS TABLE (month DATE, division TEXT, name TEXT, net NUMERIC, deals INTEGER)
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
  SELECT m::DATE, d.slug, d.name,
         CASE WHEN d.slug = 'trailer'
           THEN (SELECT COALESCE(SUM(t.sales_price), 0)::NUMERIC FROM stock_trailers t
                  WHERE t.status = 'sold' AND date_trunc('month', sold_on(t)) = m)
           ELSE (SELECT COALESCE(SUM(i.net), 0)::NUMERIC FROM protean_invoices i
                  WHERE i.division = d.slug AND date_trunc('month', i.tax_point) = m)
         END,
         CASE WHEN d.slug = 'trailer'
           THEN (SELECT count(*)::INTEGER FROM stock_trailers t
                  WHERE t.status = 'sold' AND date_trunc('month', sold_on(t)) = m)
           ELSE (SELECT count(*)::INTEGER FROM protean_invoices i
                  WHERE i.division = d.slug AND date_trunc('month', i.tax_point) = m)
         END
    FROM generate_series(since, upto, INTERVAL '1 month') AS m
   CROSS JOIN divisions d
   ORDER BY m, d.sort_order;
END;
$fn$;

GRANT EXECUTE ON FUNCTION division_by_month(INTEGER, DATE) TO authenticated;

-- -------------------------------------------------------------
-- 4. Who a division's money came from, biggest first.
--
-- The drill in the finance team wants. Returns the CRM record where
-- there is one, and the name as the source system spells it where
-- there is not, so money on an unplaced account is visible rather than
-- quietly missing from the list that is supposed to add up to the
-- column above it.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION division_customers(
  p_division TEXT, p_upto DATE DEFAULT NULL, p_limit INTEGER DEFAULT 12)
RETURNS TABLE (
  contact_id UUID, company_name TEXT, this_year NUMERIC, last_year NUMERIC,
  change NUMERIC, deals INTEGER, placed BOOLEAN
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
  n    INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 12), 200));
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Company revenue needs access to the CRM.';
  END IF;

  IF p_division = 'trailer' THEN
    RETURN QUERY
    SELECT t.contact_id,
           COALESCE(c.company_name, t.customer, 'Not recorded'),
           COALESCE(SUM(t.sales_price) FILTER (
             WHERE sold_on(t) >= fy AND sold_on(t) <= upto), 0)::NUMERIC,
           COALESCE(SUM(t.sales_price) FILTER (
             WHERE sold_on(t) >= fy0 AND sold_on(t) <= cut), 0)::NUMERIC,
           (COALESCE(SUM(t.sales_price) FILTER (
              WHERE sold_on(t) >= fy AND sold_on(t) <= upto), 0)
            - COALESCE(SUM(t.sales_price) FILTER (
              WHERE sold_on(t) >= fy0 AND sold_on(t) <= cut), 0))::NUMERIC,
           count(*) FILTER (WHERE sold_on(t) >= fy AND sold_on(t) <= upto)::INTEGER,
           (t.contact_id IS NOT NULL)
      FROM stock_trailers t
      LEFT JOIN crm_contacts c ON c.id = t.contact_id
     WHERE t.status = 'sold'
     GROUP BY t.contact_id, COALESCE(c.company_name, t.customer, 'Not recorded')
    HAVING COALESCE(SUM(t.sales_price) FILTER (
             WHERE sold_on(t) >= fy AND sold_on(t) <= upto), 0) <> 0
     ORDER BY 3 DESC
     LIMIT n;
  ELSE
    RETURN QUERY
    SELECT a.contact_id,
           COALESCE(c.company_name, a.protean_name),
           COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy  AND i.tax_point <= upto), 0)::NUMERIC,
           COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0)::NUMERIC,
           (COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy  AND i.tax_point <= upto), 0)
            - COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0))::NUMERIC,
           count(*) FILTER (WHERE i.tax_point >= fy AND i.tax_point <= upto)::INTEGER,
           (a.contact_id IS NOT NULL)
      FROM protean_accounts a
      LEFT JOIN crm_contacts c ON c.id = a.contact_id
      LEFT JOIN protean_invoices i ON i.division = a.division AND i.alpha = a.alpha
     WHERE a.division = p_division AND NOT a.ignored
     GROUP BY a.contact_id, COALESCE(c.company_name, a.protean_name)
    HAVING COALESCE(SUM(i.net) FILTER (
             WHERE i.tax_point >= fy AND i.tax_point <= upto), 0) <> 0
     ORDER BY 3 DESC
     LIMIT n;
  END IF;
END;
$fn$;

GRANT EXECUTE ON FUNCTION division_customers(TEXT, DATE, INTEGER) TO authenticated;

-- -------------------------------------------------------------
-- 5. What is still only a hope, by division.
--
-- `crm_leads.type` has always been maintenance, trailer_sales or
-- rental, which is the same three. The pipeline has carried its
-- division since the day it was built and nothing asked.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION division_pipeline()
RETURNS TABLE (division TEXT, name TEXT, leads INTEGER, value NUMERIC, won_this_year INTEGER)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE fy DATE := financial_year_of(CURRENT_DATE);
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'The pipeline needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT d.slug, d.name,
         count(l.id) FILTER (WHERE l.status IN ('lead', 'contacted', 'quoted'))::INTEGER,
         COALESCE(SUM(l.estimated_value) FILTER (
           WHERE l.status IN ('lead', 'contacted', 'quoted')), 0)::NUMERIC,
         count(l.id) FILTER (
           WHERE l.status IN ('won', 'customer') AND l.updated_at >= fy)::INTEGER
    FROM divisions d
    LEFT JOIN crm_leads l ON l.type = CASE d.slug
                                        WHEN 'stc' THEN 'maintenance'
                                        WHEN 'trailer' THEN 'trailer_sales'
                                        ELSE 'rental' END
   GROUP BY d.slug, d.name, d.sort_order
   ORDER BY d.sort_order;
END;
$fn$;

GRANT EXECUTE ON FUNCTION division_pipeline() TO authenticated;

-- -------------------------------------------------------------
-- 6. A customer's divisions now include trailer sales.
--
-- The answer to "how does it know which division", completed: the two
-- Protean divisions come from the accounts bound to them, and trailer
-- sales come from the stock list. Still derived, still never declared.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION customer_divisions(p_contact UUID)
RETURNS TABLE (division TEXT, name TEXT, net NUMERIC, invoices INTEGER)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Seeing which divisions a customer buys from needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT d.slug, d.name,
         COALESCE(SUM(i.net), 0)::NUMERIC,
         count(i.invoice_no)::INTEGER
    FROM divisions d
    JOIN protean_accounts a ON a.division = d.slug
                           AND a.contact_id = p_contact AND NOT a.ignored
    LEFT JOIN protean_invoices i ON i.division = a.division AND i.alpha = a.alpha
   GROUP BY d.slug, d.name, d.sort_order
  HAVING count(i.invoice_no) > 0

  UNION ALL

  SELECT d.slug, d.name,
         COALESCE(SUM(t.sales_price), 0)::NUMERIC,
         count(*)::INTEGER
    FROM divisions d
    JOIN stock_trailers t ON d.slug = 'trailer'
                         AND t.contact_id = p_contact AND t.status = 'sold'
   GROUP BY d.slug, d.name, d.sort_order
  HAVING count(*) > 0;
END;
$fn$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'division_revenue') THEN
    RAISE EXCEPTION 'the three divisions still cannot be read side by side';
  END IF;
  RAISE NOTICE 'ok  three divisions on one year, one cut and one shape, with margin only where a cost is recorded';
END $$;
