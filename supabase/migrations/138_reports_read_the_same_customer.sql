-- =============================================================
-- 138. Reports read the same customer as every other screen.
--
-- From an audit of the product:
--
--   Top/bottom customer and growth reports group invoices by raw
--   protean_name. They ignore the newer invoice-to-CRM ownership
--   logic, including individual cash-sale allocations. One customer
--   can be split across names, or invoices pooled under a billing
--   name.
--
--   This financial year so far is compared with the whole previous
--   financial year, despite the report claiming comparison with the
--   same point last year. This can manufacture apparent declines.
--
-- Both are real and both were verified against the code before this
-- was written.
--
-- ---- The first one ----
--
-- Grouping by `protean_name` is the rule this product moved away from
-- in 131. A customer with two accounts is split in two. Every cash
-- sale in the business pools under the words "Cash Sale", which would
-- have ranked as a top customer in a report handed to a finance
-- director the day after those invoices were allocated to their real
-- owners. The reports were simply never told.
--
-- ---- The second one ----
--
-- `thisYear` is the financial year so far. `lastYear` was everything
-- before it, which is the WHOLE previous year. Five months against
-- twelve, printed under a note that says "against the same point last
-- financial year". Every seasonal customer reads as collapsing.
--
-- So this is one function, carrying the same rule as `division_
-- customers` and `protean_year_on_year`, and it cuts last year at the
-- same point.
-- =============================================================
DROP FUNCTION IF EXISTS report_customer_spend(TEXT[], DATE);
CREATE OR REPLACE FUNCTION report_customer_spend(
  p_divisions TEXT[] DEFAULT NULL,
  p_upto      DATE   DEFAULT NULL
)
RETURNS TABLE (
  contact_id     UUID,
  company_name   TEXT,
  this_year      NUMERIC,
  last_year      NUMERIC,
  invoices_this  INT,
  invoices_last  INT,
  placed         BOOLEAN
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
    RAISE EXCEPTION 'Customer figures need access to the CRM.';
  END IF;

  RETURN QUERY
  WITH owned AS (
    SELECT invoice_customer(
             i.contact_id,
             CASE WHEN COALESCE(a.ignored, FALSE) OR COALESCE(a.is_invoicing_type, FALSE)
                  THEN NULL ELSE a.contact_id END) AS contact,
           CASE WHEN COALESCE(a.is_invoicing_type, FALSE)
                THEN 'Not attributed to a customer'
                ELSE COALESCE(a.protean_name, i.protean_name) END AS fallback,
           i.tax_point, i.net
      FROM protean_invoices i
      LEFT JOIN protean_accounts a
        ON a.division = i.division AND a.alpha = i.alpha
     WHERE (p_divisions IS NULL OR i.division = ANY (p_divisions))
       AND i.tax_point >= fy0
       AND i.tax_point <= upto
  )
  SELECT o.contact,
         COALESCE((SELECT c.company_name FROM crm_contacts c
                    WHERE c.id = o.contact AND c.deleted_at IS NULL),
                  MIN(o.fallback)),
         COALESCE(SUM(o.net) FILTER (
           WHERE o.tax_point >= fy AND o.tax_point <= upto), 0)::NUMERIC,
         /* THE SAME POINT LAST YEAR, not the whole of it. */
         COALESCE(SUM(o.net) FILTER (
           WHERE o.tax_point >= fy0 AND o.tax_point <= cut), 0)::NUMERIC,
         count(*) FILTER (WHERE o.tax_point >= fy AND o.tax_point <= upto)::INT,
         count(*) FILTER (WHERE o.tax_point >= fy0 AND o.tax_point <= cut)::INT,
         (o.contact IS NOT NULL)
    FROM owned o
   GROUP BY o.contact
  HAVING COALESCE(SUM(o.net) FILTER (WHERE o.tax_point >= fy  AND o.tax_point <= upto), 0) <> 0
      OR COALESCE(SUM(o.net) FILTER (WHERE o.tax_point >= fy0 AND o.tax_point <= cut), 0) <> 0
   ORDER BY 3 DESC;
END;
$fn$;

REVOKE ALL ON FUNCTION report_customer_spend(TEXT[], DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION report_customer_spend(TEXT[], DATE) TO authenticated;

COMMENT ON FUNCTION report_customer_spend(TEXT[], DATE) IS
  'Customer spend for the reports: the same ownership rule as every screen, and '
  'last year cut at the same point so a growth figure compares like with like.';

DO $$ BEGIN
  RAISE NOTICE 'reports rank the customer, not the billing name, and compare like with like';
END $$;
