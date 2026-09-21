-- =============================================================
-- 131. Every customer figure honours the invoice's own customer.
--
-- 130 gave an invoice its own customer, for the cash sale account that
-- genuinely carries several. This is the other half: the figures have
-- to read it, or HATS Group still shows a zero.
--
-- THE RULE, once:
--
--   an invoice belongs to its own contact_id where it has one,
--   otherwise to its account's
--
-- and, importantly, AN INVOICE PLACED BY HAND COUNTS EVEN IF ITS
-- ACCOUNT IS SET ASIDE. Cash Sale is exactly the kind of account
-- somebody sets aside, and the whole point of placing a cash sale is
-- to take it out of that pool.
--
-- NO DIVISION TOTAL MOVES. Those read the invoices directly and never
-- looked at a customer. The same money becomes findable under a name.
-- =============================================================

-- -------------------------------------------------------------
-- What one customer buys, per division. The customer's own card.
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
    LEFT JOIN protean_invoices i ON i.division = d.slug
    LEFT JOIN protean_accounts a
      ON a.division = i.division AND a.alpha = i.alpha
   WHERE i.invoice_no IS NULL
      OR (invoice_customer(i.contact_id, CASE WHEN a.ignored THEN NULL ELSE a.contact_id END)
          = p_contact)
   GROUP BY d.slug, d.name, d.sort_order
  HAVING COALESCE(SUM(i.net), 0) <> 0
   ORDER BY d.sort_order;
END;
$fn$;

GRANT EXECUTE ON FUNCTION customer_divisions(UUID) TO authenticated;

-- -------------------------------------------------------------
-- The Customers list on the Revenue tab.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS protean_year_on_year(DATE, TEXT);
CREATE OR REPLACE FUNCTION protean_year_on_year(p_upto DATE DEFAULT NULL, p_division TEXT DEFAULT NULL)
RETURNS TABLE (
  contact_id UUID, company_name TEXT, alphas TEXT[],
  this_year NUMERIC, last_year NUMERIC, change NUMERIC,
  open_jobs INTEGER, open_value NUMERIC, last_billed DATE, fy_started DATE,
  last_year_full NUMERIC
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
  fy0_end DATE := (fy - INTERVAL '1 day')::DATE;
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Company revenue needs access to the CRM.';
  END IF;

  RETURN QUERY
  WITH work AS (
    SELECT job_belongs_to(j.division, j.alpha, j.contact_id) AS contact,
           count(*)::INTEGER AS jobs,
           COALESCE(SUM(j.job_total), 0)::NUMERIC AS value
      FROM protean_open_jobs j
     WHERE j.still_open AND (p_division IS NULL OR j.division = p_division)
       AND job_belongs_to(j.division, j.alpha, j.contact_id) IS NOT NULL
     GROUP BY 1
  ),
  /* Every invoice, resolved to whoever it belongs to. An invoice
     placed by hand outranks a set aside account. */
  owned AS (
    SELECT invoice_customer(i.contact_id,
             CASE WHEN a.ignored THEN NULL ELSE a.contact_id END) AS contact,
           i.division, i.alpha, i.tax_point, i.net
      FROM protean_invoices i
      LEFT JOIN protean_accounts a
        ON a.division = i.division AND a.alpha = i.alpha
     WHERE (p_division IS NULL OR i.division = p_division)
  ),
  billed AS (
    SELECT o.contact,
           array_agg(DISTINCT o.alpha) AS alphas,
           COALESCE(SUM(o.net) FILTER (WHERE o.tax_point >= fy  AND o.tax_point <= upto), 0)::NUMERIC AS ty,
           COALESCE(SUM(o.net) FILTER (WHERE o.tax_point >= fy0 AND o.tax_point <= cut), 0)::NUMERIC AS ly,
           COALESCE(SUM(o.net) FILTER (WHERE o.tax_point >= fy0 AND o.tax_point <= fy0_end), 0)::NUMERIC AS lyf,
           max(o.tax_point) AS latest,
           COALESCE(SUM(o.net), 0)::NUMERIC AS ever
      FROM owned o
     WHERE o.contact IS NOT NULL
     GROUP BY o.contact
  )
  SELECT COALESCE(b.contact, w.contact),
         (SELECT c.company_name FROM crm_contacts c
           WHERE c.id = COALESCE(b.contact, w.contact)),
         COALESCE(b.alphas, ARRAY[]::TEXT[]),
         COALESCE(b.ty, 0), COALESCE(b.ly, 0), COALESCE(b.ty, 0) - COALESCE(b.ly, 0),
         COALESCE(w.jobs, 0), COALESCE(w.value, 0), b.latest, fy, COALESCE(b.lyf, 0)
    FROM billed b
    FULL OUTER JOIN work w ON w.contact = b.contact
   WHERE COALESCE(b.ever, 0) <> 0 OR COALESCE(w.jobs, 0) > 0
   ORDER BY 4 DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_year_on_year(DATE, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- Top customers per division.
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
  WITH owned AS (
    SELECT invoice_customer(i.contact_id,
             CASE WHEN a.ignored THEN NULL ELSE a.contact_id END) AS contact,
           COALESCE(a.protean_name, i.protean_name) AS fallback_name,
           i.tax_point, i.net
      FROM protean_invoices i
      LEFT JOIN protean_accounts a
        ON a.division = i.division AND a.alpha = i.alpha
     WHERE i.division = p_division
  )
  SELECT o.contact,
         COALESCE((SELECT c.company_name FROM crm_contacts c WHERE c.id = o.contact),
                  MIN(o.fallback_name)),
         COALESCE(SUM(o.net) FILTER (WHERE o.tax_point >= fy  AND o.tax_point <= upto), 0)::NUMERIC,
         COALESCE(SUM(o.net) FILTER (WHERE o.tax_point >= fy0 AND o.tax_point <= cut), 0)::NUMERIC,
         (COALESCE(SUM(o.net) FILTER (WHERE o.tax_point >= fy  AND o.tax_point <= upto), 0)
          - COALESCE(SUM(o.net) FILTER (WHERE o.tax_point >= fy0 AND o.tax_point <= cut), 0))::NUMERIC,
         count(*) FILTER (WHERE o.tax_point >= fy AND o.tax_point <= upto)::INTEGER,
         (o.contact IS NOT NULL)
    FROM owned o
   GROUP BY o.contact
  HAVING COALESCE(SUM(o.net) FILTER (
           WHERE o.tax_point >= fy AND o.tax_point <= upto), 0) <> 0
   ORDER BY 3 DESC
   LIMIT n;
END;
$fn$;

GRANT EXECUTE ON FUNCTION division_customers(TEXT, DATE, INTEGER) TO authenticated;

DO $$ BEGIN
  RAISE NOTICE 'a placed cash sale now shows on its customer, and on no division total twice';
END $$;
