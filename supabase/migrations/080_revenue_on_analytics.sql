-- =============================================================
-- 080. The company's revenue, for analytics.
--
-- From the business:
--
--   ensure analytics is picking up these figures too
--
-- Analytics today reads `stock_trailers` and `crm_leads`. That is
-- trailer sales and pipeline, and it is a fraction of the business:
-- Protean carries £11.7m of invoicing that the analytics screen has
-- never seen. Somebody reading it would conclude the company turns over
-- what the trailer division turns over.
--
-- ---- Attributed, unattributed and set aside ----
--
-- The per customer function from 075 answers "what did each customer
-- spend" and deliberately leaves out two things: accounts nobody has
-- placed yet, and accounts set aside as not customers.
--
-- Both of those are still revenue. `Cash Sale` at £536k and the group's
-- own `STC Sales and Leasing Limited` at £1.8m are real money that is
-- nobody's portfolio, and a company total that quietly dropped them
-- would be £2.3m light with nothing on the screen saying so.
--
-- So the company figure counts everything, and says how much of it is
-- not on anybody's record. A number and its own caveat, rather than a
-- number somebody has to know the caveat for.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The company, this year against the same point last year.
-- -------------------------------------------------------------
/* Dropped first because a later migration changes this function's
   return type, and the catch-up bundle is meant to be safe to run
   twice. On a second run the LATER shape is what is live, and
   `CREATE OR REPLACE` cannot change a return type: it raises
   "cannot change return type of existing function" and takes the
   whole transaction with it. Dropping this exact signature first is
   a no-op on a fresh database and the fix on a replay. */
DROP FUNCTION IF EXISTS protean_company(DATE);

CREATE OR REPLACE FUNCTION protean_company(p_upto DATE DEFAULT NULL)
RETURNS TABLE (
  this_year      NUMERIC,
  last_year      NUMERIC,
  change         NUMERIC,
  financial_year NUMERIC,
  fy_started     DATE,
  invoices       INTEGER,
  customers      INTEGER,
  /* Billed, but on an account nobody has said who it is. Counted in
     the total above and named here so the total can be trusted. */
  unattributed   NUMERIC,
  /* Billed, on an account somebody has deliberately set aside. */
  set_aside      NUMERIC,
  open_jobs      INTEGER,
  open_value     NUMERIC,
  last_billed    DATE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  upto DATE    := COALESCE(p_upto, CURRENT_DATE);
  y    INTEGER := EXTRACT(YEAR FROM upto)::INTEGER;
  cut  DATE    := (upto - INTERVAL '1 year')::DATE;
  fy   DATE    := financial_year_of(upto);
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Company revenue needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(SUM(i.net) FILTER (
      WHERE EXTRACT(YEAR FROM i.tax_point) = y AND i.tax_point <= upto), 0)::NUMERIC,
    COALESCE(SUM(i.net) FILTER (
      WHERE EXTRACT(YEAR FROM i.tax_point) = y - 1 AND i.tax_point <= cut), 0)::NUMERIC,
    (COALESCE(SUM(i.net) FILTER (
       WHERE EXTRACT(YEAR FROM i.tax_point) = y AND i.tax_point <= upto), 0)
     - COALESCE(SUM(i.net) FILTER (
       WHERE EXTRACT(YEAR FROM i.tax_point) = y - 1 AND i.tax_point <= cut), 0))::NUMERIC,
    COALESCE(SUM(i.net) FILTER (
      WHERE i.tax_point >= fy AND i.tax_point <= upto), 0)::NUMERIC,
    fy,
    count(*) FILTER (
      WHERE EXTRACT(YEAR FROM i.tax_point) = y AND i.tax_point <= upto)::INTEGER,
    (SELECT count(DISTINCT a.contact_id)::INTEGER FROM protean_accounts a
      WHERE a.contact_id IS NOT NULL AND NOT a.ignored),
    COALESCE(SUM(i.net) FILTER (
      WHERE EXTRACT(YEAR FROM i.tax_point) = y AND i.tax_point <= upto
        AND a.contact_id IS NULL AND NOT a.ignored), 0)::NUMERIC,
    COALESCE(SUM(i.net) FILTER (
      WHERE EXTRACT(YEAR FROM i.tax_point) = y AND i.tax_point <= upto
        AND a.ignored), 0)::NUMERIC,
    (SELECT count(*)::INTEGER FROM protean_open_jobs j WHERE j.still_open),
    (SELECT COALESCE(SUM(j.job_total), 0)::NUMERIC FROM protean_open_jobs j WHERE j.still_open),
    max(i.tax_point)
  FROM protean_invoices i
  JOIN protean_accounts a ON a.alpha = i.alpha;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_company(DATE) TO authenticated;

-- -------------------------------------------------------------
-- 2. Month by month, for the trend.
--
-- Every month in the window comes back, including the ones with nothing
-- in them. A chart that skips an empty month draws a straight line
-- across it and reads as steady trading through a month where nothing
-- was invoiced at all.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION protean_by_month(p_months INTEGER DEFAULT 24, p_upto DATE DEFAULT NULL)
RETURNS TABLE (
  month     DATE,
  net       NUMERIC,
  invoices  INTEGER
)
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
  SELECT m::DATE,
         COALESCE(SUM(i.net), 0)::NUMERIC,
         count(i.invoice_no)::INTEGER
    FROM generate_series(since, upto, INTERVAL '1 month') AS m
    LEFT JOIN protean_invoices i
      ON date_trunc('month', i.tax_point) = m
   GROUP BY m
   ORDER BY m;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_by_month(INTEGER, DATE) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'protean_company') THEN
    RAISE EXCEPTION 'analytics still cannot see what the workshop billed';
  END IF;
  RAISE NOTICE 'ok  the company total, its month by month trend, and how much of it is on nobody''s record';
END $$;
