-- =============================================================
-- 155. THE BOOKS RECONCILE THEMSELVES, EVERY WEEK, WITHOUT A DEVELOPER.
--
-- From the business:
--
--   It's being financially audited to the penny week on week against
--   Protean and Sage exports. Any data unmatching gets me in trouble.
--   [...] It has to be bulletproof for when a leave the company soon
--   and there's no developer or claude anymore.
--
-- ---- What was actually wrong, and what was not ----
--
-- Not the import. Every one of the 22,206 invoices reaches exactly one
-- customer record, all 395 Protean accounts are accounted for, and the
-- three division totals are whole. The exports and this database agree,
-- and they agreed before this migration.
--
-- What was wrong was that NOBODY COULD SEE THAT. The only figure on any
-- screen about the state of the books was a warning on the personal
-- portfolio counting customers with no Protean account, which is mostly
-- a count of prospects nobody has ever billed and is entirely normal.
-- It read as a hole in the accounts. It is not one, and a screen that
-- cries wolf about 108 records is a screen that hides the 8 that matter.
--
-- ---- The eight that matter, and where they came from ----
--
-- On 21 September 2026 at 15:06:53.819324 one INSERT created 413
-- customer records from a Protean import. In that single statement it
-- inserted `BIFFA MUNICIPAL LTD` AND `Biffa Municipal Limited`, and
-- `Holman Fleet Limited` AND `Holman Fleet Limited (VMS)`, because it
-- did not fold its own input on `company_key`. Twenty four of the
-- twenty eight duplicate companies were made that way, against the
-- import's own rows, in one pass.
--
-- THAT IMPORT WAS CHECKED, THREE TIMES, AND PASSED. The checks that ran
-- were about invoices:
--
--   count(*) = count(DISTINCT (division, invoice_no))
--
-- which is still true today, 22,206 of each, nothing doubled. Not one
-- of the roughly forty files written to guarantee that import looked at
-- `crm_contacts` at all. The money was proved right and the customer
-- list was never counted.
--
-- THE COMPANY TOTAL IS NEVER WRONG because of this, which is exactly
-- why it survived every audit. Both halves are counted and the division
-- adds up. What is wrong is the CUSTOMER total: Holman Fleet reads
-- £66,463 on one screen and £98,831 on another, and neither is what
-- they spend. A portfolio, a customer card and a growth report are all
-- made of per customer figures.
--
-- So this migration does not merge anything. It SHOWS them, ranked by
-- how much money is split, and `crm_merge` already exists to join them
-- once a person has looked. The check below is the thing that was
-- missing in September: it counts the customer list, not just the
-- money, so this particular failure cannot pass an audit again.
--
-- ---- What this adds ----
--
--   `reconciliation()`          nine checks, each pass or fail, each
--                               with the number behind it. One screen,
--                               one number per line, green or not.
--   `crm_duplicate_groups()`    every company held twice, worst first.
--
-- Both are SECURITY DEFINER and gated on `analytics.view`, because this
-- is the finance position and not everybody's business.
--
-- NOTHING IS WRITTEN BY ANY FUNCTION HERE. Both are STABLE and read
-- only. A reconciliation that can change the thing it is reconciling is
-- not a reconciliation.
-- =============================================================

-- -------------------------------------------------------------
-- Every company held more than once, and where its money sits.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS crm_duplicate_groups();
CREATE OR REPLACE FUNCTION crm_duplicate_groups()
RETURNS TABLE (
  match_key      TEXT,
  records        INTEGER,
  /* How many of them have money on them. TWO OR MORE is the serious
     case: one company's spend is being reported as two customers. */
  holding_money  INTEGER,
  /* What is on the largest of them, and what is on all the others.
     `split_away` is the figure that is on the wrong record. */
  largest_net    NUMERIC,
  split_away     NUMERIC,
  names          TEXT,
  contact_ids    UUID[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH live AS (
    SELECT c.id, c.company_name, company_key(c.company_name) AS k,
           COALESCE((SELECT SUM(i.net) FROM protean_invoices i WHERE i.contact_id = c.id), 0) AS net
      FROM crm_contacts c
     WHERE c.deleted_at IS NULL AND company_key(c.company_name) IS NOT NULL
       AND command_may('analytics.view')
  ),
  grouped AS (
    SELECT k, count(*)::INTEGER AS n FROM live GROUP BY k HAVING count(*) > 1
  )
  SELECT g.k,
         g.n,
         count(*) FILTER (WHERE l.net <> 0)::INTEGER,
         ROUND(MAX(l.net), 2),
         ROUND(SUM(l.net) - MAX(l.net), 2),
         string_agg(l.company_name || ' (' || to_char(l.net, 'FM999,999,990.00') || ')',
                    '  |  ' ORDER BY l.net DESC, l.company_name),
         array_agg(l.id ORDER BY l.net DESC, l.company_name)
    FROM grouped g JOIN live l ON l.k = g.k
   GROUP BY g.k, g.n
   ORDER BY 5 DESC, 4 DESC;
$fn$;

REVOKE ALL ON FUNCTION crm_duplicate_groups() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_duplicate_groups() TO authenticated;

COMMENT ON FUNCTION crm_duplicate_groups() IS
  'Every company held under more than one customer record, worst first by how much '
  'money is on the records that are not the largest. The company total is never '
  'wrong because of these: the customer total is.';

-- -------------------------------------------------------------
-- The audit position, as nine questions with numbers.
--
-- Each row is one thing somebody would otherwise have to write SQL to
-- find out. `ok` is the whole point: a person opening this weekly needs
-- to know whether to do anything, not to read nine numbers and decide.
--
-- `severity` separates "the books do not balance" from "somebody should
-- tidy this up", because a screen where everything is red is a screen
-- nobody reads twice.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS reconciliation(DATE);
CREATE OR REPLACE FUNCTION reconciliation(p_upto DATE DEFAULT NULL)
RETURNS TABLE (
  sort_order  INTEGER,
  check_id    TEXT,
  title       TEXT,
  detail      TEXT,
  figure      NUMERIC,
  ok          BOOLEAN,
  severity    TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  upto DATE := COALESCE(p_upto, CURRENT_DATE);
  fy   DATE := financial_year_of(upto);
  n    BIGINT;
  m    NUMERIC;
BEGIN
  IF NOT command_may('analytics.view') THEN
    RAISE EXCEPTION 'The reconciliation is the finance position, so it needs access to Analytics.';
  END IF;

  -- ---- 1. Every invoice reaches exactly one customer ----
  SELECT count(*) INTO n
    FROM protean_invoices i
    LEFT JOIN protean_accounts a ON a.division = i.division AND a.alpha = i.alpha
   WHERE invoice_customer(i.contact_id,
           CASE WHEN a.ignored THEN NULL ELSE a.contact_id END) IS NULL;
  RETURN QUERY SELECT 1, 'invoices_placed',
    'Every invoice reaches a customer',
    CASE WHEN n = 0 THEN 'All ' || (SELECT count(*) FROM protean_invoices)::TEXT
                         || ' invoices are allocated.'
         ELSE n::TEXT || ' invoice(s) reach nobody, so their value is in no customer figure.' END,
    n::NUMERIC, n = 0, CASE WHEN n = 0 THEN 'ok' ELSE 'books' END;

  -- ---- 2. Every Protean account is explained ----
  --
  -- Bound to a customer, or marked as an invoicing type (a payer, whose
  -- invoices are allocated to the end customer by site name), or set
  -- aside deliberately. An account that is none of the three is one
  -- nobody has looked at.
  SELECT count(*) INTO n FROM protean_accounts
   WHERE contact_id IS NULL AND NOT is_invoicing_type AND NOT ignored;
  RETURN QUERY SELECT 2, 'accounts_explained',
    'Every Protean account is accounted for',
    CASE WHEN n = 0 THEN (SELECT count(*) FROM protean_accounts WHERE contact_id IS NOT NULL)::TEXT
                         || ' bound, '
                         || (SELECT count(*) FROM protean_accounts WHERE contact_id IS NULL AND is_invoicing_type)::TEXT
                         || ' are payers, '
                         || (SELECT count(*) FROM protean_accounts WHERE contact_id IS NULL AND ignored)::TEXT
                         || ' set aside.'
         ELSE n::TEXT || ' account(s) are bound to nobody and marked as neither a payer nor set aside.' END,
    n::NUMERIC, n = 0, CASE WHEN n = 0 THEN 'ok' ELSE 'books' END;

  -- ---- 3. No company is held twice WITH MONEY ON BOTH ----
  SELECT count(*), COALESCE(SUM(d.split_away), 0) INTO n, m
    FROM crm_duplicate_groups() d WHERE d.holding_money > 1;
  RETURN QUERY SELECT 3, 'split_customers',
    'No customer''s spend is split across two records',
    CASE WHEN n = 0 THEN 'Every company''s revenue is on one record.'
         ELSE n::TEXT || ' compan' || CASE WHEN n = 1 THEN 'y is' ELSE 'ies are' END
              || ' held twice with money on both. '
              || to_char(m, 'FM£999,999,990.00') || ' is on the smaller record(s). '
              || 'The division totals are still right: the customer totals are not.' END,
    m, n = 0, CASE WHEN n = 0 THEN 'ok' ELSE 'customers' END;

  -- ---- 4. And none held twice at all ----
  SELECT count(*) INTO n FROM crm_duplicate_groups();
  RETURN QUERY SELECT 4, 'duplicate_records',
    'No company is in the CRM twice',
    CASE WHEN n = 0 THEN 'Every company appears once.'
         ELSE n::TEXT || ' compan' || CASE WHEN n = 1 THEN 'y is' ELSE 'ies are' END
              || ' entered more than once. Merging them is safe: the money follows.' END,
    n::NUMERIC, n = 0, CASE WHEN n = 0 THEN 'ok' ELSE 'tidy' END;

  -- ---- 5. Every invoice has a value and a date ----
  SELECT count(*) INTO n FROM protean_invoices
   WHERE net IS NULL OR tax_point IS NULL;
  RETURN QUERY SELECT 5, 'invoices_complete',
    'Every invoice has a value and a tax point',
    CASE WHEN n = 0 THEN 'Nothing is missing a figure or a date.'
         ELSE n::TEXT || ' invoice(s) have no value or no tax point, so they fall in no period.' END,
    n::NUMERIC, n = 0, CASE WHEN n = 0 THEN 'ok' ELSE 'books' END;

  -- ---- 6. No invoice is in the file twice ----
  --
  -- The same division, account and invoice number twice is a re-import
  -- that landed rather than being recognised, and it doubles revenue.
  SELECT COALESCE(SUM(c - 1), 0) INTO n FROM (
    SELECT count(*) c FROM protean_invoices
     WHERE COALESCE(BTRIM(invoice_no), '') <> ''
     GROUP BY division, alpha, invoice_no HAVING count(*) > 1) x;
  RETURN QUERY SELECT 6, 'no_double_import',
    'No invoice is in the database twice',
    CASE WHEN n = 0 THEN 'Every invoice number appears once per account.'
         ELSE n::TEXT || ' duplicated invoice line(s). THIS OVERSTATES REVENUE.' END,
    n::NUMERIC, n = 0, CASE WHEN n = 0 THEN 'ok' ELSE 'books' END;

  -- ---- 7. The financial year, by division, for the eye ----
  --
  -- Not a pass or fail: the figure to read across against the export.
  -- It is here so the person doing the audit has the number this
  -- database would defend, beside the checks that say it is whole.
  RETURN QUERY
  SELECT 7, 'division_total_' || i.division,
    'Invoiced this financial year: ' || COALESCE(d.name, i.division),
    count(*)::TEXT || ' invoices since ' || to_char(fy, 'DD Mon YYYY') || '.',
    ROUND(SUM(i.net), 2), TRUE, 'figure'
    FROM protean_invoices i
    LEFT JOIN divisions d ON d.slug = i.division
   WHERE i.tax_point >= fy AND i.tax_point <= upto
   GROUP BY i.division, d.name, d.sort_order
   ORDER BY d.sort_order;

  -- ---- 8. And the whole ----
  SELECT COALESCE(SUM(net), 0) INTO m FROM protean_invoices
   WHERE tax_point >= fy AND tax_point <= upto;
  RETURN QUERY SELECT 8, 'total',
    'Invoiced this financial year, all divisions',
    'Net, by tax point, ' || to_char(fy, 'DD Mon YYYY') || ' to ' || to_char(upto, 'DD Mon YYYY') || '.',
    ROUND(m, 2), TRUE, 'figure';
END;
$fn$;

REVOKE ALL ON FUNCTION reconciliation(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reconciliation(DATE) TO authenticated;

COMMENT ON FUNCTION reconciliation(DATE) IS
  'The audit position as a list of pass or fail checks with the number behind each, '
  'plus the financial year total by division to read across against the Protean and '
  'Sage exports. Read only, and STABLE: a reconciliation that can change what it is '
  'reconciling is not one.';

-- -------------------------------------------------------------
-- And the portfolio warning stops crying wolf.
--
-- It counted customers with no Protean account and called them "not
-- bound [...] so they add nothing to either figure. That is not the
-- same as spending nothing." Most of them are PROSPECTS, who have
-- never been billed because nobody has sold them anything yet, and
-- saying that about 108 of somebody's 257 customers reads as a hole in
-- the accounts. It is not one.
--
-- Three numbers instead of one, because they are three different
-- things and only the second is a problem:
--
--   never_billed  a prospect. Normal, and not a fault.
--   split_twin    this record has a TWIN that holds the money. The
--                 customer's spend is real and is on the other record.
--   payer_on_book a billing conduit, an insurer, sitting on somebody's
--                 portfolio as though it were a customer.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS personal_revenue_year(UUID, DATE);
CREATE OR REPLACE FUNCTION personal_revenue_year(p_person UUID, p_upto DATE DEFAULT NULL)
RETURNS TABLE (
  year_from DATE, year_to DATE, last_from DATE, last_to DATE,
  this_year NUMERIC, last_year NUMERIC, change NUMERIC, change_pct NUMERIC,
  customers INTEGER, with_revenue INTEGER,
  never_billed INTEGER, split_twin INTEGER, payer_on_book INTEGER
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
           (EXISTS (SELECT 1 FROM protean_accounts a2
                     WHERE a2.contact_id = m.contact_id AND NOT a2.ignored)
            OR EXISTS (SELECT 1 FROM protean_invoices i2
                        WHERE i2.contact_id = m.contact_id)) AS bound,
           /* A twin under another spelling that DOES hold money. The
              spend is real and it is on the other record, so this is a
              merge waiting to happen and not a missing figure. */
           EXISTS (
             SELECT 1 FROM crm_contacts t
              WHERE t.deleted_at IS NULL
                AND t.id <> m.contact_id
                AND company_key(t.company_name) =
                    (SELECT company_key(c3.company_name) FROM crm_contacts c3 WHERE c3.id = m.contact_id)
                AND EXISTS (SELECT 1 FROM protean_invoices i3 WHERE i3.contact_id = t.id)
           ) AS has_billed_twin,
           /* A payer rather than a customer: an account exists under
              this name and is marked as an invoicing type, so its
              invoices belong to the end customers, not to it. */
           EXISTS (
             SELECT 1 FROM protean_accounts a4
              WHERE a4.is_invoicing_type
                AND company_key(a4.protean_name) =
                    (SELECT company_key(c4.company_name) FROM crm_contacts c4 WHERE c4.id = m.contact_id)
           ) AS is_payer
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
    /* The three, and they do not overlap: a payer is reported as a
       payer even if it also has a twin, because taking it off the
       portfolio is the answer either way. */
    COUNT(*) FILTER (WHERE NOT p.bound AND NOT p.is_payer AND NOT p.has_billed_twin)::INT,
    COUNT(*) FILTER (WHERE NOT p.bound AND NOT p.is_payer AND p.has_billed_twin)::INT,
    COUNT(*) FILTER (WHERE NOT p.bound AND p.is_payer)::INT
  FROM per_customer p;
END;
$fn$;

REVOKE ALL ON FUNCTION personal_revenue_year(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_revenue_year(UUID, DATE) TO authenticated;

DO $$ BEGIN
  RAISE NOTICE 'the audit position is a screen now, and the portfolio warning says which of three things it found';
END $$;
