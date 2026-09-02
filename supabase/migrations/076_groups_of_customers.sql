-- =============================================================
-- 076. Groups of customers.
--
-- From the business, on why the matcher must not merge subsidiaries:
--
--   an alpha makes an account unique. If dawson truck and dawson vans
--   were the same, we'd bind their alpha on protean, but they aren't.
--   99% of the time when a company is a subsidiary it has it's own
--   accounts and requires a unique protean account on our end and
--   therefore is part of a group. You can however add a grouping
--   system, so we can see the total of both holman accounts, how much
--   both dawson accounts earn, how much all 3 montgomery accounts earn
--   without having to manually go into each, but also allow us to view
--   the revenue of each.
--
-- ---- What this changes, and what it deliberately does not ----
--
-- It does not change the binding. Protean's `Alpha` stays the unit of
-- account: one code, one customer, and Montgomery Transport is still a
-- different customer from Montgomery Tank Services. Migration 075 and
-- the matcher stay exactly as they are.
--
-- The group is a SECOND, LOOSER layer laid over the top. It totals
-- across records without merging them, so both readings are available
-- at once and neither is lost:
--
--   group     Montgomery                    £412,905
--     customer  Montgomery Transport        £221,440
--       alpha     MONTTRAN                  £221,440
--     customer  Montgomery Distribution     £108,110
--     customer  Montgomery Tank Services     £83,355
--
-- Three levels, because the business named all three. The group is the
-- question "how much is Montgomery worth to us". The customer is who
-- the salesperson calls. The alpha is what Protean actually billed, and
-- it is the only one of the three that is a fact rather than a
-- judgement, which is why every figure here is a sum over alphas.
--
-- ---- Why the group hangs off the customer, not off the alpha ----
--
-- An alpha reaches its group through its customer. That is one hop
-- further than strictly needed and it is the right one: a group is a
-- commercial relationship, and a salesperson who moves a customer into
-- a group means all of that customer's billing, including alphas that
-- have not arrived yet. Hanging it on the alpha would mean regrouping
-- by hand every time Protean opened another account.
--
-- ---- Nothing is grouped automatically ----
--
-- A shared brand is a good enough reason to SUGGEST a group and never
-- good enough to make one. `Fleet Assist` and `Fleet Operations` share
-- a first word and are unrelated companies, so an automatic grouping
-- would have invented a Fleet group out of two strangers. The import
-- screen offers the suggestion; a person accepts it.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The group.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  note       TEXT,
  created_by UUID REFERENCES auth.users ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/* One group per name. Two "Montgomery" groups would split the total in
   half and both halves would look plausible. */
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_groups_name
  ON customer_groups (lower(name));

ALTER TABLE crm_contacts
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES customer_groups ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_crm_contacts_group ON crm_contacts (group_id)
  WHERE group_id IS NOT NULL;

-- -------------------------------------------------------------
-- 2. Who may see and change one.
--
-- Reading a group is reading the CRM. Changing one moves revenue
-- between totals, so it needs `crm.edit` and goes through functions.
-- -------------------------------------------------------------
ALTER TABLE customer_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_groups_read ON customer_groups;
CREATE POLICY customer_groups_read ON customer_groups
  FOR SELECT USING (command_may('crm.view'));

REVOKE INSERT, UPDATE, DELETE ON customer_groups FROM anon, authenticated;
REVOKE SELECT ON customer_groups FROM anon;

-- -------------------------------------------------------------
-- 3. Naming a group.
--
-- Idempotent on the name, so importing the same suggestion twice makes
-- one group rather than failing on the unique index.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION name_a_group(p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  clean TEXT := NULLIF(btrim(COALESCE(p_name, '')), '');
  found UUID;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Making a customer group needs permission to edit the CRM.';
  END IF;
  IF clean IS NULL THEN
    RAISE EXCEPTION 'A group needs a name.';
  END IF;

  SELECT g.id INTO found FROM customer_groups g WHERE lower(g.name) = lower(clean);
  IF found IS NOT NULL THEN
    RETURN found;
  END IF;

  INSERT INTO customer_groups (name, created_by) VALUES (clean, auth.uid())
  RETURNING id INTO found;
  RETURN found;
END;
$fn$;

GRANT EXECUTE ON FUNCTION name_a_group(TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 4. Putting a customer in one, and taking them back out.
--
-- A null group removes them. Nothing about their billing changes: the
-- invoices stay on their alpha and their own total is unaffected. Only
-- what they are counted inside moves.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION put_in_group(p_contact UUID, p_group UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Grouping a customer needs permission to edit the CRM.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM crm_contacts WHERE id = p_contact) THEN
    RAISE EXCEPTION 'That customer is not in the CRM.';
  END IF;
  IF p_group IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM customer_groups WHERE id = p_group) THEN
    RAISE EXCEPTION 'That group does not exist.';
  END IF;

  UPDATE crm_contacts SET group_id = p_group, updated_at = NOW() WHERE id = p_contact;
END;
$fn$;

GRANT EXECUTE ON FUNCTION put_in_group(UUID, UUID) TO authenticated;

-- -------------------------------------------------------------
-- 5. Forgetting a group.
--
-- The members survive. A group is a way of looking at customers, so
-- deleting one is deleting a view and must never be capable of taking
-- a customer or an invoice with it.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION forget_group(p_group UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE freed INTEGER;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Removing a customer group needs permission to edit the CRM.';
  END IF;

  UPDATE crm_contacts SET group_id = NULL WHERE group_id = p_group;
  GET DIAGNOSTICS freed = ROW_COUNT;
  DELETE FROM customer_groups WHERE id = p_group;
  RETURN freed;
END;
$fn$;

GRANT EXECUTE ON FUNCTION forget_group(UUID) TO authenticated;

-- -------------------------------------------------------------
-- 6. What a group is worth.
--
-- Cut like for like against last year, on the same day of the year, for
-- the reason spelled out in 075: measured against a whole previous year
-- every customer in the book looks like a collapse.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION group_revenue(p_upto DATE DEFAULT NULL)
RETURNS TABLE (
  group_id   UUID,
  group_name TEXT,
  customers  INTEGER,
  accounts   INTEGER,
  this_year  NUMERIC,
  last_year  NUMERIC,
  change     NUMERIC,
  open_jobs  INTEGER,
  open_value NUMERIC,
  last_billed DATE
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
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Group revenue needs access to the CRM.';
  END IF;

  RETURN QUERY
  WITH billed AS (
    SELECT c.group_id AS g,
           c.id       AS contact,
           a.alpha,
           COALESCE(SUM(i.net) FILTER (
             WHERE EXTRACT(YEAR FROM i.tax_point) = y AND i.tax_point <= upto), 0) AS ty,
           COALESCE(SUM(i.net) FILTER (
             WHERE EXTRACT(YEAR FROM i.tax_point) = y - 1 AND i.tax_point <= cut), 0) AS ly,
           max(i.tax_point) AS latest
      FROM crm_contacts c
      JOIN protean_accounts a ON a.contact_id = c.id AND NOT a.ignored
      LEFT JOIN protean_invoices i ON i.alpha = a.alpha
     WHERE c.group_id IS NOT NULL
     GROUP BY c.group_id, c.id, a.alpha
  ),
  work AS (
    SELECT c.group_id AS g,
           count(*)::INTEGER AS jobs,
           COALESCE(SUM(j.job_total), 0)::NUMERIC AS value
      FROM protean_open_jobs j
      JOIN protean_accounts a ON a.alpha = j.alpha AND NOT a.ignored
      JOIN crm_contacts c ON c.id = a.contact_id
     WHERE j.still_open AND c.group_id IS NOT NULL
     GROUP BY c.group_id
  )
  SELECT gr.id,
         gr.name,
         count(DISTINCT b.contact)::INTEGER,
         count(DISTINCT b.alpha)::INTEGER,
         COALESCE(SUM(b.ty), 0)::NUMERIC,
         COALESCE(SUM(b.ly), 0)::NUMERIC,
         (COALESCE(SUM(b.ty), 0) - COALESCE(SUM(b.ly), 0))::NUMERIC,
         COALESCE(max(w.jobs), 0),
         COALESCE(max(w.value), 0)::NUMERIC,
         max(b.latest)
    FROM customer_groups gr
    LEFT JOIN billed b ON b.g = gr.id
    LEFT JOIN work   w ON w.g = gr.id
   GROUP BY gr.id, gr.name
   ORDER BY 5 DESC, gr.name;
END;
$fn$;

GRANT EXECUTE ON FUNCTION group_revenue(DATE) TO authenticated;

-- -------------------------------------------------------------
-- 7. And the revenue of each, inside it.
--
-- One row per Protean account, because that is the level the money is
-- real at. Two Holman accounts against one Holman customer come back as
-- two rows carrying the same company name, which is the answer to "how
-- much of Holman is VMS".
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION group_breakdown(p_group UUID, p_upto DATE DEFAULT NULL)
RETURNS TABLE (
  alpha        TEXT,
  protean_name TEXT,
  contact_id   UUID,
  company_name TEXT,
  this_year    NUMERIC,
  last_year    NUMERIC,
  change       NUMERIC,
  open_jobs    INTEGER,
  open_value   NUMERIC,
  last_billed  DATE
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
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Group revenue needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT a.alpha,
         a.protean_name,
         c.id,
         c.company_name,
         COALESCE(SUM(i.net) FILTER (
           WHERE EXTRACT(YEAR FROM i.tax_point) = y AND i.tax_point <= upto), 0)::NUMERIC,
         COALESCE(SUM(i.net) FILTER (
           WHERE EXTRACT(YEAR FROM i.tax_point) = y - 1 AND i.tax_point <= cut), 0)::NUMERIC,
         (COALESCE(SUM(i.net) FILTER (
            WHERE EXTRACT(YEAR FROM i.tax_point) = y AND i.tax_point <= upto), 0)
          - COALESCE(SUM(i.net) FILTER (
            WHERE EXTRACT(YEAR FROM i.tax_point) = y - 1 AND i.tax_point <= cut), 0))::NUMERIC,
         (SELECT count(*)::INTEGER FROM protean_open_jobs j
           WHERE j.alpha = a.alpha AND j.still_open),
         (SELECT COALESCE(SUM(j.job_total), 0)::NUMERIC FROM protean_open_jobs j
           WHERE j.alpha = a.alpha AND j.still_open),
         max(i.tax_point)
    FROM protean_accounts a
    JOIN crm_contacts c ON c.id = a.contact_id
    LEFT JOIN protean_invoices i ON i.alpha = a.alpha
   WHERE c.group_id = p_group AND NOT a.ignored
   GROUP BY a.alpha, a.protean_name, c.id, c.company_name
   ORDER BY 5 DESC, a.protean_name;
END;
$fn$;

GRANT EXECUTE ON FUNCTION group_breakdown(UUID, DATE) TO authenticated;

-- -------------------------------------------------------------
-- 8. And the same split on one customer.
--
-- The CRM record shows a single spend figure. Where a customer has more
-- than one Protean account this says which account it came from, so the
-- figure on the record can always be taken apart.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION protean_accounts_of(p_contact UUID)
RETURNS TABLE (
  alpha        TEXT,
  protean_name TEXT,
  ignored      BOOLEAN,
  invoices     INTEGER,
  net          NUMERIC,
  first_billed DATE,
  last_billed  DATE,
  open_jobs    INTEGER,
  open_value   NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Seeing what a customer has spent needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT a.alpha,
         a.protean_name,
         a.ignored,
         count(i.invoice_no)::INTEGER,
         COALESCE(SUM(i.net), 0)::NUMERIC,
         min(i.tax_point),
         max(i.tax_point),
         (SELECT count(*)::INTEGER FROM protean_open_jobs j
           WHERE j.alpha = a.alpha AND j.still_open),
         (SELECT COALESCE(SUM(j.job_total), 0)::NUMERIC FROM protean_open_jobs j
           WHERE j.alpha = a.alpha AND j.still_open)
    FROM protean_accounts a
    LEFT JOIN protean_invoices i ON i.alpha = a.alpha
   WHERE a.contact_id = p_contact
   GROUP BY a.alpha, a.protean_name, a.ignored
   ORDER BY 5 DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION protean_accounts_of(UUID) TO authenticated;

-- -------------------------------------------------------------
-- 9. Did it land.
-- -------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'crm_contacts' AND column_name = 'group_id') THEN
    RAISE EXCEPTION 'customers cannot be grouped';
  END IF;
  RAISE NOTICE 'ok  a customer can belong to a group, the group totals without merging, and every alpha is still readable on its own';
END $$;
