-- =============================================================
-- 136. Cash Sale is an invoicing type, not a customer.
--
-- From the business:
--
--   cash sale means nothing in this app, that's just for protean
--   purposes. This should be stripping away the cash sale and
--   allocating the money to that customer's actual account. If they
--   don't have an account, it makes them an account. Cash sale isn't a
--   customer, it's an invoicing type. We should be able to see how
--   much went through as a cash sale and get granular with it, but
--   cash sale is not a customer name.
--
-- 130 treated it as an account with several customers inside it and
-- asked which was which. That was still the wrong shape: it left
-- "Cash Sale" standing as a thing a customer list could show, and it
-- left a customer unplaced if the CRM had never heard of them.
--
-- ---- What changes ----
--
--   1. An account can be marked AN INVOICING TYPE. It is a route money
--      arrives by, never a customer. It is not offered for binding, it
--      never appears in a customer list, and no figure is ever
--      attributed to it.
--   2. Every invoice through one is allocated to the customer named on
--      it. WHERE THAT CUSTOMER DOES NOT EXIST, IT IS CREATED, because
--      the business said so in as many words.
--   3. Cash sale becomes reportable in its own right: how much came
--      that way, per division, per customer, per year.
-- =============================================================

-- -------------------------------------------------------------
-- 1. An account that is a route, not a company.
-- -------------------------------------------------------------
ALTER TABLE protean_accounts
  ADD COLUMN IF NOT EXISTS is_invoicing_type BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN protean_accounts.is_invoicing_type IS
  'This account is how money arrived, not who paid it. Cash Sale. Never a customer, '
  'never bindable, never in a customer list. Its invoices belong to their site name.';

/* Anything already carrying more than one customer's work is one, and
   so is anything Protean calls a cash sale. Both, because the first
   catches the ones nobody has named and the second catches a brand new
   cash sale account with a single invoice on it so far. */
UPDATE protean_accounts a
   SET is_invoicing_type = TRUE
 WHERE NOT a.is_invoicing_type
   AND (
     a.alpha ILIKE '%CASHSALE%' OR a.protean_name ILIKE 'cash sale%'
     OR EXISTS (
       SELECT 1 FROM protean_invoices i
        WHERE i.division = a.division AND i.alpha = a.alpha
          AND i.site_name IS NOT NULL AND BTRIM(i.site_name) <> ''
        GROUP BY i.division, i.alpha
       HAVING count(DISTINCT i.site_name) > 1)
   );

/* A route is nobody's customer, so it holds no contact. The record it
   pointed at, if any, keeps every other account it had. */
UPDATE protean_accounts SET contact_id = NULL, bound_by = NULL, bound_at = NULL
 WHERE is_invoicing_type AND contact_id IS NOT NULL;

-- -------------------------------------------------------------
-- 2. Allocate everything, creating the customer where there is none.
--
-- Matching is on the name, trimmed and case insensitive, against live
-- records only. A name that matches nothing BECOMES a record, named
-- exactly as the export writes it so the next import matches it.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS protean_allocate_invoicing_types();
CREATE OR REPLACE FUNCTION protean_allocate_invoicing_types()
RETURNS TABLE (placed INT, customers_made INT, no_name INT, value NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r      RECORD;
  who    UUID;
  n      INT;
  n_put  INT := 0;
  n_new  INT := 0;
  n_none INT := 0;
  total  NUMERIC := 0;
BEGIN
  IF NOT command_may('crm.create') THEN
    RAISE EXCEPTION 'Allocating cash sales makes customer records, so it needs permission to create them.';
  END IF;

  FOR r IN
    SELECT i.division, i.alpha, BTRIM(i.site_name) AS site,
           count(*) AS n, SUM(i.net) AS net
      FROM protean_invoices i
      JOIN protean_accounts a
        ON a.division = i.division AND a.alpha = i.alpha AND a.is_invoicing_type
     WHERE i.contact_id IS NULL
     GROUP BY i.division, i.alpha, BTRIM(i.site_name)
  LOOP
    /* No name on the invoice at all. Nothing to allocate it to, and a
       guess would put somebody else's money on a customer. Counted and
       left, not invented. */
    IF r.site IS NULL OR r.site = '' THEN
      n_none := n_none + r.n;
      CONTINUE;
    END IF;

    SELECT c.id INTO who FROM crm_contacts c
     WHERE c.deleted_at IS NULL
       AND lower(BTRIM(c.company_name)) = lower(r.site)
     ORDER BY c.created_at
     LIMIT 1;

    IF who IS NULL THEN
      INSERT INTO crm_contacts (company_name, source, status, relationship)
      VALUES (r.site, 'protean', 'customer', 'existing')
      RETURNING id INTO who;
      n_new := n_new + 1;
    END IF;

    INSERT INTO protean_cash_sites (division, alpha, site_name, contact_id, bound_by, bound_at)
    VALUES (r.division, r.alpha, r.site, who, auth.uid(), NOW())
    ON CONFLICT (division, alpha, site_name) DO UPDATE
      SET contact_id = EXCLUDED.contact_id, bound_at = NOW();

    UPDATE protean_invoices i SET contact_id = who
     WHERE i.division = r.division AND i.alpha = r.alpha
       AND BTRIM(i.site_name) = r.site AND i.contact_id IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;

    n_put := n_put + n;
    total := total + COALESCE(r.net, 0);
  END LOOP;

  RETURN QUERY SELECT n_put, n_new, n_none, ROUND(total, 2);
END;
$fn$;

REVOKE ALL ON FUNCTION protean_allocate_invoicing_types() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION protean_allocate_invoicing_types() TO authenticated;

-- -------------------------------------------------------------
-- 3. Cash sale as a REPORT, which is all it ever was.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS cash_sale_report(DATE, TEXT);
CREATE OR REPLACE FUNCTION cash_sale_report(p_upto DATE DEFAULT NULL, p_division TEXT DEFAULT NULL)
RETURNS TABLE (
  division      TEXT,
  division_name TEXT,
  route         TEXT,
  contact_id    UUID,
  company_name  TEXT,
  invoices      INT,
  this_year     NUMERIC,
  last_year     NUMERIC,
  all_time      NUMERIC,
  first_billed  DATE,
  last_billed   DATE
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
  fy0e DATE := (fy - INTERVAL '1 day')::DATE;
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Reading the cash sale report needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT i.division, d.name, COALESCE(a.protean_name, i.alpha),
         i.contact_id,
         COALESCE(c.company_name, NULLIF(BTRIM(i.site_name), ''), 'No name on the invoice'),
         count(*)::INT,
         COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy  AND i.tax_point <= upto), 0)::NUMERIC,
         COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= fy0e), 0)::NUMERIC,
         SUM(i.net)::NUMERIC,
         MIN(i.tax_point), MAX(i.tax_point)
    FROM protean_invoices i
    JOIN protean_accounts a
      ON a.division = i.division AND a.alpha = i.alpha AND a.is_invoicing_type
    JOIN divisions d ON d.slug = i.division
    LEFT JOIN crm_contacts c ON c.id = i.contact_id
   WHERE (p_division IS NULL OR i.division = p_division)
   GROUP BY i.division, d.name, d.sort_order, COALESCE(a.protean_name, i.alpha),
            i.contact_id, COALESCE(c.company_name, NULLIF(BTRIM(i.site_name), ''), 'No name on the invoice')
   ORDER BY 7 DESC, 9 DESC;
END;
$fn$;

REVOKE ALL ON FUNCTION cash_sale_report(DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cash_sale_report(DATE, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 4. A route is never offered as something to bind to a customer.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION protean_bind(p_division TEXT, p_alpha TEXT, p_contact UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE gone TIMESTAMPTZ; moved UUID; named TEXT; route BOOLEAN;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Saying which customer an account is needs permission to edit the CRM.';
  END IF;

  SELECT a.is_invoicing_type INTO route FROM protean_accounts a
   WHERE a.division = p_division AND a.alpha = p_alpha;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no % account with that code.', p_division;
  END IF;

  /* The whole point of 136. Cash Sale is how money arrived, not who
     paid it, and putting a customer on it would pool everybody's work
     back onto one record. */
  IF route AND p_contact IS NOT NULL THEN
    RAISE EXCEPTION
      '% is an invoicing type, not a customer. Its invoices belong to the customer named on each one.',
      p_alpha;
  END IF;

  IF p_contact IS NOT NULL THEN
    SELECT c.deleted_at INTO gone FROM crm_contacts c WHERE c.id = p_contact;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That customer is not in the CRM.';
    END IF;
    IF gone IS NOT NULL THEN
      moved := crm_merged_into(p_contact);
      IF moved IS NOT NULL THEN
        SELECT c.company_name INTO named FROM crm_contacts c WHERE c.id = moved;
        RAISE EXCEPTION
          'That customer record was merged away on %. Its work is on "%" now, so put the account on that one instead.',
          gone::DATE, named;
      END IF;
      RAISE EXCEPTION
        'That customer record was deleted on % and nothing replaced it. Revenue put on it would show nowhere.',
        gone::DATE;
    END IF;
  END IF;

  UPDATE protean_accounts
     SET contact_id = p_contact,
         bound_by = CASE WHEN p_contact IS NULL THEN NULL ELSE auth.uid() END,
         bound_at = CASE WHEN p_contact IS NULL THEN NULL ELSE NOW() END,
         ignored = FALSE, ignored_why = NULL
   WHERE division = p_division AND alpha = p_alpha;

  IF p_contact IS NOT NULL THEN
    UPDATE crm_contacts SET relationship = 'existing', updated_at = NOW()
     WHERE id = p_contact AND relationship <> 'existing';
  END IF;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_bind(TEXT, TEXT, UUID) TO authenticated;

-- -------------------------------------------------------------
-- 5. And the queue stops asking about them.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS protean_to_moderate(TEXT);
CREATE OR REPLACE FUNCTION protean_to_moderate(p_division TEXT DEFAULT NULL)
RETURNS TABLE (
  division TEXT, alpha TEXT, protean_name TEXT, net NUMERIC,
  invoices INTEGER, last_billed DATE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Reading the accounts queue needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT a.division, a.alpha, a.protean_name,
         COALESCE(SUM(i.net), 0)::NUMERIC,
         count(i.invoice_no)::INTEGER,
         MAX(i.tax_point)
    FROM protean_accounts a
    LEFT JOIN protean_invoices i ON i.division = a.division AND i.alpha = a.alpha
   WHERE a.contact_id IS NULL
     AND NOT a.ignored
     /* Never a route. It has no customer because it cannot have one. */
     AND NOT a.is_invoicing_type
     AND (p_division IS NULL OR a.division = p_division)
   GROUP BY a.division, a.alpha, a.protean_name
   ORDER BY 4 DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_to_moderate(TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 6. And "Cash Sale" is never printed as a company name.
--
-- The top customers list falls back to the account's name when there
-- is no customer on it, which is right for a real account nobody has
-- placed and wrong for a route. Anything still unallocated says what
-- it is instead of borrowing Protean's word for a payment method.
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
             CASE WHEN a.ignored OR a.is_invoicing_type THEN NULL ELSE a.contact_id END) AS contact,
           CASE WHEN a.is_invoicing_type
                THEN 'Not attributed to a customer'
                ELSE COALESCE(a.protean_name, i.protean_name) END AS fallback_name,
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
  RAISE NOTICE 'cash sale is a route money arrived by, and never a customer';
END $$;
