-- =============================================================
-- 137. The "needs a record" panel reads the invoice, not just the account.
--
-- From the business, having run everything:
--
--   pasted those, nothing changed on analytics tab
--
-- They were right. `division_reconciliation` is what that panel reads
-- and it was last touched in 124, before an invoice could carry its
-- own customer. It still decides "unattributed" purely from
-- `protean_accounts.contact_id`, so:
--
--   every cash sale invoice can be sitting on the right customer and
--   the panel still counts the whole Cash Sale account as unplaced,
--   because the ACCOUNT has no customer and never will have one
--
-- Which is the exact number the business was looking at.
--
-- So this function now asks the same question every other figure asks:
-- who does this INVOICE belong to. And an invoicing type is not a gap,
-- it is a route: once its invoices are allocated there is nothing left
-- to place, and what is left is reported as its own thing.
-- =============================================================
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
  WITH owned AS (
    SELECT i.division, i.net, i.alpha,
           /* THE SAME RULE AS EVERY OTHER FIGURE. The invoice's own
              customer first, then its account's, and an account that
              is set aside or is a billing route gives none. */
           invoice_customer(
             i.contact_id,
             CASE WHEN COALESCE(a.ignored, FALSE) OR COALESCE(a.is_invoicing_type, FALSE)
                  THEN NULL ELSE a.contact_id END) AS contact,
           COALESCE(a.ignored, FALSE) AS aside,
           COALESCE(a.is_invoicing_type, FALSE) AS route
      FROM protean_invoices i
      LEFT JOIN protean_accounts a
        ON a.division = i.division AND a.alpha = i.alpha
     WHERE i.tax_point >= fy AND i.tax_point <= upto
  )
  SELECT d.slug, d.name, d.sort_order,
         COALESCE(SUM(o.net), 0)::NUMERIC,
         /* Only a LIVE customer record counts as placed. One that was
            merged away shows nowhere, so it is a gap, not a placement. */
         COALESCE(SUM(o.net) FILTER (
           WHERE o.contact IS NOT NULL AND NOT o.aside
             AND EXISTS (SELECT 1 FROM crm_contacts c
                          WHERE c.id = o.contact AND c.deleted_at IS NULL)), 0)::NUMERIC,
         COALESCE(SUM(o.net) FILTER (
           WHERE NOT o.aside
             AND (o.contact IS NULL
                  OR NOT EXISTS (SELECT 1 FROM crm_contacts c
                                  WHERE c.id = o.contact AND c.deleted_at IS NULL))), 0)::NUMERIC,
         count(DISTINCT o.alpha) FILTER (
           WHERE NOT o.aside
             AND (o.contact IS NULL
                  OR NOT EXISTS (SELECT 1 FROM crm_contacts c
                                  WHERE c.id = o.contact AND c.deleted_at IS NULL)))::INTEGER,
         COALESCE(SUM(o.net) FILTER (WHERE o.aside), 0)::NUMERIC,
         count(DISTINCT o.alpha) FILTER (WHERE o.aside)::INTEGER
    FROM divisions d
    LEFT JOIN owned o ON o.division = d.slug
   GROUP BY d.slug, d.name, d.sort_order
   ORDER BY 3;
END;
$fn$;

GRANT EXECUTE ON FUNCTION division_reconciliation(DATE) TO authenticated;

DO $$ BEGIN
  RAISE NOTICE 'the gap panel counts an invoice as placed when the INVOICE has a customer';
END $$;
