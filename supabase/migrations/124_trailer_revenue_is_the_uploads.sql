-- =============================================================
-- 124. Trailer Sales revenue comes from the uploads, like everything
--      else does.
--
-- From the business:
--
--   revenue populates it all, you've been instructed on that countless
--   times. Analytics is only populated outside of these uploads if a
--   lead has been won.
--
-- ---- What was wrong ----
--
-- Two trailer figures existed in the product and they came from
-- different places:
--
--   Revenue tab, Trailer Sales       protean_invoices, division 'trailer'
--   Analytics, dashboard, target     stock_trailers, status 'sold'
--
-- One uploaded trailer invoice of £50,000 and one sold trailer on the
-- stock list at £12,000 gave £50,000 on the Revenue tab and £12,000 on
-- Analytics, from the same database at the same moment.
--
-- Migration 088 chose the stock list deliberately and wrote down why:
-- a trailer sale carries a cost and a margin and an invoice does not,
-- so putting them in one table means inventing a cost or throwing the
-- margin away. That reasoning was about MARGIN. It was applied to
-- REVENUE as well, which was never what was asked for, and it left the
-- company's own analytics reading a source the business does not feed.
--
-- ---- What it is now ----
--
-- All three divisions read `protean_invoices`. One rule, one table, one
-- answer, and the Revenue tab and Analytics can no longer disagree
-- because there is nothing left for them to disagree about.
--
-- Margin stays on the stock list, because that is still the only place
-- a cost is recorded. It is a figure ABOUT trailer sales rather than
-- the trailer sales figure, and it is null for the other two, which is
-- what 088 was right about.
--
-- `outstanding` stays as stock on the yard for trailers, because money
-- committed and not yet billed is stock for that division in the same
-- way it is open work for the other two. That is what the column means
-- and `outstanding_of` has always said which.
-- =============================================================

DROP FUNCTION IF EXISTS division_revenue(DATE);

CREATE OR REPLACE FUNCTION division_revenue(p_upto DATE DEFAULT NULL)
RETURNS TABLE (
  division       TEXT,
  name           TEXT,
  sort_order     INTEGER,
  this_year      NUMERIC,
  last_year      NUMERIC,
  last_year_full NUMERIC,
  change         NUMERIC,
  deals          INTEGER,
  customers      INTEGER,
  margin         NUMERIC,
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
  /* All three, out of the invoices the business uploads. */
  SELECT d.slug, d.name, d.sort_order,
         COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy  AND i.tax_point <= upto), 0)::NUMERIC,
         COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0)::NUMERIC,
         COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= fy0e), 0)::NUMERIC,
         (COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy  AND i.tax_point <= upto), 0)
          - COALESCE(SUM(i.net) FILTER (WHERE i.tax_point >= fy0 AND i.tax_point <= cut), 0))::NUMERIC,
         count(*) FILTER (WHERE i.tax_point >= fy AND i.tax_point <= upto)::INTEGER,
         (SELECT count(DISTINCT a.contact_id)::INTEGER FROM protean_accounts a
           WHERE a.division = d.slug AND a.contact_id IS NOT NULL AND NOT a.ignored),

         /* Margin, where a cost is recorded. Only the stock list carries
            one, so only trailer sales can show it, and null elsewhere
            reads as "we do not know" rather than "we made nothing". */
         CASE WHEN d.slug = 'trailer' THEN
           (SELECT COALESCE(SUM(s.profit), 0)::NUMERIC FROM stock_trailers s
             WHERE s.status = 'sold' AND sold_on(s) >= fy AND sold_on(s) <= upto)
         END,

         /* Money committed and not yet billed: work on the ramps for the
            two workshops, stock on the yard for trailers. */
         CASE WHEN d.slug = 'trailer' THEN
           (SELECT COALESCE(SUM(COALESCE(s.total_nbv, s.nbv)), 0)::NUMERIC
              FROM stock_trailers s WHERE s.status IN ('in_stock', 'new_build'))
         ELSE
           (SELECT COALESCE(SUM(j.job_total), 0)::NUMERIC FROM protean_open_jobs j
             WHERE j.division = d.slug AND j.still_open)
         END,
         CASE WHEN d.slug = 'trailer' THEN
           (SELECT count(*)::INTEGER FROM stock_trailers s
             WHERE s.status IN ('in_stock', 'new_build'))
         ELSE
           (SELECT count(*)::INTEGER FROM protean_open_jobs j
             WHERE j.division = d.slug AND j.still_open)
         END,
         CASE WHEN d.slug = 'trailer' THEN 'in stock' ELSE 'open on the system' END,
         fy,
         max(i.tax_point)
    FROM divisions d
    LEFT JOIN protean_invoices i ON i.division = d.slug
   GROUP BY d.slug, d.name, d.sort_order
   ORDER BY 3;
END;
$fn$;

GRANT EXECUTE ON FUNCTION division_revenue(DATE) TO authenticated;

-- -------------------------------------------------------------
-- And the row in `divisions` stops saying the wrong thing.
--
-- `source` is printed on screen under the division's name. It has said
-- "The stock list" since migration 083, which was true and is not any
-- more.
-- -------------------------------------------------------------
UPDATE divisions SET source = 'Trailer sale invoicing' WHERE slug = 'trailer';

DO $$
DECLARE src TEXT;
BEGIN
  SELECT source INTO src FROM divisions WHERE slug = 'trailer';
  IF src <> 'Trailer sale invoicing' THEN
    RAISE EXCEPTION 'the trailer division still says its money comes from %', src;
  END IF;
  RAISE NOTICE 'ok  all three divisions read the invoices the business uploads';
END $$;

-- -------------------------------------------------------------
-- Reconciliation follows the revenue.
--
-- "Whose money is on a CRM record" has to be asked of the same money
-- the revenue column shows, or the two disagree by construction: the
-- reconciliation totalled the stock list while the column totalled the
-- invoices, and `billed` no longer equalled `this_year`.
--
-- So all three divisions reconcile off the invoices and their Protean
-- accounts, which is one rule instead of two.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS division_reconciliation(DATE);

CREATE OR REPLACE FUNCTION division_reconciliation(p_upto DATE DEFAULT NULL)
RETURNS TABLE (
  division       TEXT,
  name           TEXT,
  sort_order     INTEGER,
  billed         NUMERIC,
  on_customers   NUMERIC,
  unattributed   NUMERIC,
  unattributed_n INTEGER,
  set_aside      NUMERIC,
  set_aside_n    INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  upto DATE := COALESCE(p_upto, CURRENT_DATE);
  fy   DATE := financial_year_of(upto);
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Reconciling revenue needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT d.slug, d.name, d.sort_order,
         COALESCE(SUM(i.net), 0)::NUMERIC,
         COALESCE(SUM(i.net) FILTER (
           WHERE a.contact_id IS NOT NULL AND NOT a.ignored), 0)::NUMERIC,
         /* An invoice whose account this application has never seen is
            unattributed too. Before, a null account fell through every
            filter and the parts stopped adding to the whole. */
         COALESCE(SUM(i.net) FILTER (
           WHERE a.contact_id IS NULL AND COALESCE(a.ignored, FALSE) = FALSE), 0)::NUMERIC,
         count(DISTINCT COALESCE(a.alpha, i.alpha)) FILTER (
           WHERE a.contact_id IS NULL AND COALESCE(a.ignored, FALSE) = FALSE)::INTEGER,
         COALESCE(SUM(i.net) FILTER (WHERE a.ignored), 0)::NUMERIC,
         count(DISTINCT a.alpha) FILTER (WHERE a.ignored)::INTEGER
    FROM divisions d
    LEFT JOIN protean_invoices i
      ON i.division = d.slug AND i.tax_point >= fy AND i.tax_point <= upto
    LEFT JOIN protean_accounts a
      ON a.division = i.division AND a.alpha = i.alpha
   GROUP BY d.slug, d.name, d.sort_order
   ORDER BY 3;
END;
$fn$;

GRANT EXECUTE ON FUNCTION division_reconciliation(DATE) TO authenticated;

-- -------------------------------------------------------------
-- Making a trailer customer binds the account as well as the trailers.
--
-- The button existed to close the reconciliation gap, and the gap is
-- now counted off invoices and their Protean accounts rather than off
-- the stock list. So it has to bind both, or pressing it moves the
-- trailers onto a record and leaves the money still reading as
-- unattributed.
-- -------------------------------------------------------------
/* The parameter names are 092's, unchanged. Renaming one made the
   catch-up bundle fail on its second run: 092 runs again, tries to
   rename it back, and PostgreSQL refuses with 42P13. */
CREATE OR REPLACE FUNCTION make_customer_for_trailer(
  p_name TEXT, p_contact UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  name  TEXT := NULLIF(btrim(COALESCE(p_name, '')), '');
  made  UUID;
  moved INTEGER := 0;
  bound INTEGER := 0;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Making a customer needs permission to edit the CRM.';
  END IF;
  IF name IS NULL THEN
    RAISE EXCEPTION 'A customer needs a name.';
  END IF;

  SELECT id INTO made FROM crm_contacts
   WHERE lower(btrim(company_name)) = lower(name) AND deleted_at IS NULL
   LIMIT 1;

  IF made IS NULL THEN
    /* `source` and no owner column: exactly what migration 092 wrote.
       Only the account binding below is new. */
    INSERT INTO crm_contacts (company_name, source, status)
    VALUES (name, 'trailer_sales', 'customer')
    RETURNING id INTO made;
  END IF;

  UPDATE stock_trailers SET contact_id = made
   WHERE contact_id IS NULL AND lower(btrim(customer)) = lower(name);
  GET DIAGNOSTICS moved = ROW_COUNT;

  /* The half that was missing. The money is on the invoice, and the
     invoice reaches a CRM record through its Protean account. */
  UPDATE protean_accounts SET contact_id = made
   WHERE contact_id IS NULL
     AND division = 'trailer'
     AND lower(btrim(protean_name)) = lower(name);
  GET DIAGNOSTICS bound = ROW_COUNT;

  PERFORM audit('update', 'crm_contacts', made, name,
                jsonb_build_object('from', 'trailer sales',
                                   'trailers_linked', moved,
                                   'accounts_linked', bound));

  RETURN made;
END;
$fn$;

GRANT EXECUTE ON FUNCTION make_customer_for_trailer(TEXT, UUID) TO authenticated;
