-- =============================================================
-- 127. An invoice cannot be put on a customer that is not there.
--
-- From the business, with a room waiting:
--
--   got an issue, i imported an invoice earlier for HATS Group, it
--   asked me to look up the correct account for it and select one. It's
--   not showing on any revenue tabs. It's been a problematic customer
--   in this CRM too.
--
-- ---- What was wrong ----
--
-- The picker on the accounts queue listed EVERY row of `crm_contacts`,
-- including the ones a merge had soft deleted and renamed to
-- "HATS Group (merged into HATS Group Ltd)". `protean_bind` then
-- accepted one, because it only asked whether the customer existed and
-- never whether it was still there.
--
-- Every customer facing figure joins `crm_contacts ... AND deleted_at
-- IS NULL`, so the moment an account is bound to a merged away record
-- its money stops appearing anywhere a customer is named. The invoice
-- is in `protean_invoices` and the division total still counts it, so
-- the headline is right and the customer is missing, which is the
-- hardest shape of wrong to find.
--
-- That happens to be the one customer most likely to hit it: a company
-- with duplicates in the CRM is a company that has been merged, and a
-- merge is what creates the dead record the picker was offering.
--
-- ---- What this does ----
--
--   1. `protean_bind` refuses a deleted customer, and names the live
--      record to use instead rather than just saying no.
--   2. `crm_merged_into` follows the merge trail from a dead record to
--      the live one, through `crm_merges`, not by reading names.
--   3. `protean_misbound` lists every account already sitting on a dead
--      record, and where each one should go.
--   4. `protean_fix_misbound` moves them. Nothing is deleted and no
--      invoice is touched: only `protean_accounts.contact_id` changes.
--
-- The picker itself is filtered in the same change, so the bad choice
-- is not offered and is refused if it is somehow made anyway.
-- =============================================================

-- -------------------------------------------------------------
-- Where a merged away customer went.
--
-- Read from `crm_merges`, which is written by `crm_merge_customers`
-- and holds canonical_id and merged_id. Names are never parsed: the
-- duplicate is renamed "X (merged into Y)" for people to read, and
-- reading it back would break the first time a company had a bracket
-- in its name.
--
-- The loop follows a chain, because A can be merged into B and B later
-- into C, and it stops rather than spinning if the data ever says
-- something circular.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS crm_merged_into(UUID);
CREATE OR REPLACE FUNCTION crm_merged_into(p_contact UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  here UUID := p_contact;
  next UUID;
  hops INT := 0;
BEGIN
  IF p_contact IS NULL THEN RETURN NULL; END IF;

  LOOP
    /* Already a live record, so this is the answer. */
    IF EXISTS (SELECT 1 FROM crm_contacts c
                WHERE c.id = here AND c.deleted_at IS NULL) THEN
      RETURN here;
    END IF;

    SELECT m.canonical_id INTO next
      FROM crm_merges m
     WHERE m.merged_id = here
     ORDER BY m.merged_at DESC
     LIMIT 1;

    /* Deleted, and no merge explains it. Nothing to offer. */
    IF next IS NULL OR next = here THEN RETURN NULL; END IF;

    here := next;
    hops := hops + 1;
    IF hops > 20 THEN RETURN NULL; END IF;
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION crm_merged_into(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_merged_into(UUID) TO authenticated;

COMMENT ON FUNCTION crm_merged_into(UUID) IS
  'The live customer record a merged away one ended up as, followed through '
  'crm_merges. Null where the record is gone and no merge explains it.';

-- -------------------------------------------------------------
-- Binding, with the one question it was not asking.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION protean_bind(p_division TEXT, p_alpha TEXT, p_contact UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  gone  TIMESTAMPTZ;
  moved UUID;
  named TEXT;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Saying which customer an account is needs permission to edit the CRM.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM protean_accounts
                  WHERE division = p_division AND alpha = p_alpha) THEN
    RAISE EXCEPTION 'There is no % account with that code.', p_division;
  END IF;

  IF p_contact IS NOT NULL THEN
    SELECT c.deleted_at INTO gone FROM crm_contacts c WHERE c.id = p_contact;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That customer is not in the CRM.';
    END IF;

    /* The fault this migration exists for. Revenue put here would be
       counted in the division total and invisible against any customer,
       so it is refused rather than accepted quietly. */
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
-- Everything already sitting on a dead record, and what it is worth.
--
-- Read only. The money figure is there because "three accounts are
-- misbound" and "£412,000 of invoiced revenue is invisible" are the
-- same fact and only one of them gets acted on.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS protean_misbound();
CREATE OR REPLACE FUNCTION protean_misbound()
RETURNS TABLE (
  division      TEXT,
  alpha         TEXT,
  protean_name  TEXT,
  contact_id    UUID,
  was_called    TEXT,
  deleted_on    DATE,
  goes_to       UUID,
  goes_to_named TEXT,
  invoices      INT,
  net_hidden    NUMERIC,
  this_year     NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE fy DATE := financial_year_of(CURRENT_DATE);
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Reading which accounts are misplaced needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT a.division, a.alpha, a.protean_name, a.contact_id,
         c.company_name, c.deleted_at::DATE,
         crm_merged_into(a.contact_id),
         (SELECT k.company_name FROM crm_contacts k
           WHERE k.id = crm_merged_into(a.contact_id)),
         COUNT(i.*)::INT,
         COALESCE(SUM(i.net), 0)::NUMERIC,
         COALESCE(SUM(i.net) FILTER (
           WHERE i.tax_point >= fy AND i.tax_point <= CURRENT_DATE), 0)::NUMERIC
    FROM protean_accounts a
    JOIN crm_contacts c ON c.id = a.contact_id AND c.deleted_at IS NOT NULL
    LEFT JOIN protean_invoices i ON i.division = a.division AND i.alpha = a.alpha
   GROUP BY a.division, a.alpha, a.protean_name, a.contact_id,
            c.company_name, c.deleted_at
   ORDER BY 11 DESC, 10 DESC, a.division, a.alpha;
END;
$fn$;

REVOKE ALL ON FUNCTION protean_misbound() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION protean_misbound() TO authenticated;

-- -------------------------------------------------------------
-- Move them onto the live record.
--
-- Only `protean_accounts.contact_id` changes. No invoice is edited, no
-- customer is created and nothing is deleted. An account whose dead
-- record has no successor is LEFT ALONE and reported, because putting
-- it on a guess would be worse than leaving it findable.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS protean_fix_misbound();
CREATE OR REPLACE FUNCTION protean_fix_misbound()
RETURNS TABLE (
  moved        INT,
  left_alone   INT,
  net_restored NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  n_moved INT := 0;
  n_left  INT := 0;
  money   NUMERIC := 0;
  r       RECORD;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Putting accounts back on the right customer needs permission to edit the CRM.';
  END IF;

  FOR r IN SELECT * FROM protean_misbound() LOOP
    IF r.goes_to IS NULL THEN
      n_left := n_left + 1;
      CONTINUE;
    END IF;

    UPDATE protean_accounts
       SET contact_id = r.goes_to, bound_by = auth.uid(), bound_at = NOW()
     WHERE division = r.division AND alpha = r.alpha;

    UPDATE crm_contacts SET relationship = 'existing', updated_at = NOW()
     WHERE id = r.goes_to AND relationship <> 'existing';

    n_moved := n_moved + 1;
    money := money + COALESCE(r.this_year, 0);
  END LOOP;

  RETURN QUERY SELECT n_moved, n_left, ROUND(money, 2);
END;
$fn$;

REVOKE ALL ON FUNCTION protean_fix_misbound() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION protean_fix_misbound() TO authenticated;

DO $$ BEGIN
  RAISE NOTICE 'an account can no longer be bound to a customer that was merged away';
END $$;
