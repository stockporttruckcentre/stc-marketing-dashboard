-- =============================================================
-- 125. Every money figure on Analytics is the uploaded revenue.
--
-- From the business:
--
--   Just have it all fucking pick up the revenue.
--
-- 124 moved the Trailer Sales COLUMN onto the invoices. Three more
-- functions behind the same screen were still adding up the stock list
-- for that division, so the column agreed with the Revenue page while
-- the chart under it, the customer list beside it and the per customer
-- split on a CRM record did not.
--
--   division_by_month    the monthly chart
--   division_customers   who the money came from, biggest first
--   customer_divisions   what one customer buys, per division
--
-- All three now read `protean_invoices` for every division, which is
-- the table the uploads land in. Nothing reads the stock list for money
-- any more.
--
-- The stock list still holds two things it is the only source for, and
-- neither is revenue: MARGIN, because a cost is recorded nowhere else,
-- and STOCK ON THE YARD, which is money committed and not yet billed.
-- Both stay where they are.
-- =============================================================

-- -------------------------------------------------------------
-- The monthly chart.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS division_by_month(INTEGER, DATE);

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
         (SELECT COALESCE(SUM(i.net), 0)::NUMERIC FROM protean_invoices i
           WHERE i.division = d.slug AND date_trunc('month', i.tax_point) = m),
         (SELECT count(*)::INTEGER FROM protean_invoices i
           WHERE i.division = d.slug AND date_trunc('month', i.tax_point) = m)
    FROM generate_series(since, upto, INTERVAL '1 month') AS m
   CROSS JOIN divisions d
   ORDER BY m, d.sort_order;
END;
$fn$;

GRANT EXECUTE ON FUNCTION division_by_month(INTEGER, DATE) TO authenticated;

-- -------------------------------------------------------------
-- Who a division's money came from. One branch now, not two.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS division_customers(TEXT, DATE, INTEGER);

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
END;
$fn$;

GRANT EXECUTE ON FUNCTION division_customers(TEXT, DATE, INTEGER) TO authenticated;

-- -------------------------------------------------------------
-- What one customer buys, per division.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS customer_divisions(UUID);

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
   ORDER BY 3 DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION customer_divisions(UUID) TO authenticated;

DO $$
BEGIN
  RAISE NOTICE 'ok  every money figure on Analytics is the uploaded revenue';
END $$;
