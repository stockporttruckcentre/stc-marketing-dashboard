-- =============================================================
-- 130. A cash sale belongs to the customer who bought it.
--
-- From the business, after an hour of "where is HATS Group":
--
--   the fucking customer HAS NO REVENUE ON THIS APP. Just hidden in
--   the background. That's enough to get me fired, nobody can track
--   their actual sales
--
-- ---- What was found ----
--
--   division | alpha    | protean_name | site_name         | net
--   stc      | CASHSALE | Cash Sale    | Hats Group        | 472.50
--   stc      | CASHSALE | Cash Sale    | Hats Group        | 1257.81
--   stc      | CASHSALE | Cash Sale    | Andrew Chatterton | 131.00
--
-- Protean puts every cash sale on ONE account. The customer who
-- actually bought the work is in `site_name` and nowhere else. This
-- application attributes an invoice through its account, so all of it
-- pooled onto a single record called Cash Sale and no customer card
-- could ever show its own.
--
-- The totals were never wrong. The money is in `protean_invoices` and
-- every division figure counted it. What was wrong is that it belonged
-- to nobody, and a salesperson opening HATS Group saw a zero next to a
-- customer they had invoiced twice.
--
-- ---- The shape of the fix ----
--
-- An invoice gains its OWN customer, used in preference to its
-- account's. That is the only honest shape: the account genuinely
-- carries several customers' work, so no amount of re-pointing the
-- account can split it.
--
--   protean_invoices.contact_id   NULL means "whoever the account is"
--   protean_cash_sites            remembers a site name's customer, so
--                                 next week's import places it without
--                                 anybody deciding again
--
-- Nothing is deleted, no figure moves, and no division total changes
-- by a penny. The same money simply becomes findable under the name of
-- the person who spent it.
-- =============================================================

-- -------------------------------------------------------------
-- 1. An invoice can name its own customer.
-- -------------------------------------------------------------
ALTER TABLE protean_invoices
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_protean_invoices_contact
  ON protean_invoices (contact_id) WHERE contact_id IS NOT NULL;

COMMENT ON COLUMN protean_invoices.contact_id IS
  'The customer this one invoice belongs to, where its account carries more than '
  'one customer. NULL means the account decides. Set for cash sales, whose real '
  'customer is only in site_name.';

-- -------------------------------------------------------------
-- 2. A site name, and whose it is. Remembered, so it is decided once.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS protean_cash_sites (
  division   TEXT NOT NULL REFERENCES divisions(slug),
  alpha      TEXT NOT NULL,
  site_name  TEXT NOT NULL,
  contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  bound_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  bound_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (division, alpha, site_name)
);

COMMENT ON TABLE protean_cash_sites IS
  'Which customer a site name on a shared account belongs to. Written once and '
  'applied to every future import of that name.';

ALTER TABLE protean_cash_sites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cash_sites_read" ON protean_cash_sites;
CREATE POLICY "cash_sites_read" ON protean_cash_sites
  FOR SELECT USING (command_may('crm.view'));
GRANT SELECT ON protean_cash_sites TO authenticated;

-- -------------------------------------------------------------
-- 3. Who an invoice belongs to. One definition, used everywhere.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION invoice_customer(p_contact UUID, p_account UUID)
RETURNS UUID
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT COALESCE(p_contact, p_account);
$fn$;

COMMENT ON FUNCTION invoice_customer(UUID, UUID) IS
  'The customer an invoice belongs to: its own, or its account''s. The single '
  'rule behind every customer revenue figure.';

-- -------------------------------------------------------------
-- 4. Every site name on a shared account that nobody has placed.
--
-- A SHARED account is one whose invoices carry more than one distinct
-- site name. That is how a cash sale account is recognised, rather
-- than by hard coding the word CASHSALE, because the next division to
-- do this will call it something else.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS protean_shared_sites(TEXT);
CREATE OR REPLACE FUNCTION protean_shared_sites(p_division TEXT DEFAULT NULL)
RETURNS TABLE (
  division     TEXT,
  alpha        TEXT,
  account_name TEXT,
  site_name    TEXT,
  contact_id   UUID,
  placed_as    TEXT,
  invoices     INT,
  all_time     NUMERIC,
  this_year    NUMERIC,
  first_seen   DATE,
  last_seen    DATE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE fy DATE := financial_year_of(CURRENT_DATE);
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Reading the cash sale customers needs access to the CRM.';
  END IF;

  RETURN QUERY
  WITH shared AS (
    SELECT i.division, i.alpha
      FROM protean_invoices i
     WHERE i.site_name IS NOT NULL AND BTRIM(i.site_name) <> ''
       AND (p_division IS NULL OR i.division = p_division)
     GROUP BY i.division, i.alpha
    HAVING count(DISTINCT i.site_name) > 1
  )
  SELECT i.division, i.alpha,
         MIN(i.protean_name),
         i.site_name,
         s.contact_id,
         c.company_name,
         count(*)::INT,
         SUM(i.net)::NUMERIC,
         COALESCE(SUM(i.net) FILTER (
           WHERE i.tax_point >= fy AND i.tax_point <= CURRENT_DATE), 0)::NUMERIC,
         MIN(i.tax_point), MAX(i.tax_point)
    FROM protean_invoices i
    JOIN shared h ON h.division = i.division AND h.alpha = i.alpha
    LEFT JOIN protean_cash_sites s
      ON s.division = i.division AND s.alpha = i.alpha AND s.site_name = i.site_name
    LEFT JOIN crm_contacts c ON c.id = s.contact_id AND c.deleted_at IS NULL
   WHERE i.site_name IS NOT NULL AND BTRIM(i.site_name) <> ''
   GROUP BY i.division, i.alpha, i.site_name, s.contact_id, c.company_name
   ORDER BY 9 DESC, 8 DESC;
END;
$fn$;

REVOKE ALL ON FUNCTION protean_shared_sites(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION protean_shared_sites(TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 5. Placing one. Remembers the decision and applies it backwards.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS protean_bind_site(TEXT, TEXT, TEXT, UUID);
CREATE OR REPLACE FUNCTION protean_bind_site(
  p_division TEXT, p_alpha TEXT, p_site TEXT, p_contact UUID
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  gone TIMESTAMPTZ;
  n    INT;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Saying whose a cash sale is needs permission to edit the CRM.';
  END IF;

  IF p_contact IS NOT NULL THEN
    SELECT c.deleted_at INTO gone FROM crm_contacts c WHERE c.id = p_contact;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That customer is not in the CRM.';
    END IF;
    /* The same refusal migration 127 added for accounts. Revenue on a
       deleted record shows nowhere. */
    IF gone IS NOT NULL THEN
      RAISE EXCEPTION
        'That customer record was deleted on %. Put the cash sales on the record that replaced it.',
        gone::DATE;
    END IF;
  END IF;

  INSERT INTO protean_cash_sites (division, alpha, site_name, contact_id, bound_by, bound_at)
  VALUES (p_division, p_alpha, p_site, p_contact, auth.uid(), NOW())
  ON CONFLICT (division, alpha, site_name) DO UPDATE
    SET contact_id = EXCLUDED.contact_id, bound_by = EXCLUDED.bound_by, bound_at = NOW();

  /* Backwards over everything already imported under that name. */
  UPDATE protean_invoices i
     SET contact_id = p_contact
   WHERE i.division = p_division AND i.alpha = p_alpha AND i.site_name = p_site;
  GET DIAGNOSTICS n = ROW_COUNT;

  IF p_contact IS NOT NULL THEN
    UPDATE crm_contacts SET relationship = 'existing', updated_at = NOW()
     WHERE id = p_contact AND relationship <> 'existing';
  END IF;

  RETURN n;
END;
$fn$;

REVOKE ALL ON FUNCTION protean_bind_site(TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION protean_bind_site(TEXT, TEXT, TEXT, UUID) TO authenticated;

-- -------------------------------------------------------------
-- 6. Applying every remembered decision, for after an import.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS protean_apply_cash_sites();
CREATE OR REPLACE FUNCTION protean_apply_cash_sites()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE n INT;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Placing cash sales needs permission to edit the CRM.';
  END IF;

  UPDATE protean_invoices i
     SET contact_id = s.contact_id
    FROM protean_cash_sites s
   WHERE s.division = i.division AND s.alpha = i.alpha AND s.site_name = i.site_name
     AND s.contact_id IS NOT NULL
     AND i.contact_id IS DISTINCT FROM s.contact_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;

REVOKE ALL ON FUNCTION protean_apply_cash_sites() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION protean_apply_cash_sites() TO authenticated;

DO $$ BEGIN
  RAISE NOTICE 'a cash sale can now belong to the customer named on it';
END $$;
