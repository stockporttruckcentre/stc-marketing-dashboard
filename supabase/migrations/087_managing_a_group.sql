-- =============================================================
-- 087. Managing a group once it exists.
--
-- From the business:
--
--   on Customers it says john hudston trailers has 2 accounts, groups
--   had already asked me if it was a group and I confirmed it was, now
--   i've added john dickinson and it's thinking that should be part of
--   the group ... I can't edit the group or remove a group.
--
-- Two faults, and the second is the one that matters.
--
-- ---- One: the suggestion is wrong ----
--
-- `John Hudson Trailers` and `John Dickinson` share a first word, and
-- the first word is what the suggestion clusters on. `John` is a
-- forename, so it says nothing about who the company is. The same shape
-- as `H&B Logistics` against `H&C Cardiem`, which was fixed by refusing
-- an initial as a brand. Handled in the application, where the
-- suggestions are worked out.
--
-- ---- Two: a group could be made and never touched again ----
--
-- `name_a_group`, `put_in_group` and `forget_group` have existed since
-- 076 and only the first two were ever reachable. So a group made by
-- accident, or named badly, or with one member too many, was permanent
-- from the screen's point of view. That is worse than the wrong
-- suggestion: a person who cannot undo a thing stops using it.
--
-- ---- Three: a suggestion nobody wants keeps coming back ----
--
-- Declining is not remembered, so `John` reappears on every visit and
-- on every import. A queue that shows the same wrong row forever is a
-- queue people stop reading, and the Montgomery suggestion is in the
-- same list.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Renaming one.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION rename_group(p_group UUID, p_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE clean TEXT := NULLIF(btrim(COALESCE(p_name, '')), '');
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Renaming a customer group needs permission to edit the CRM.';
  END IF;
  IF clean IS NULL THEN
    RAISE EXCEPTION 'A group needs a name.';
  END IF;
  IF EXISTS (SELECT 1 FROM customer_groups
              WHERE lower(name) = lower(clean) AND id <> p_group) THEN
    RAISE EXCEPTION 'There is already a group called %.', clean;
  END IF;

  UPDATE customer_groups SET name = clean WHERE id = p_group;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That group does not exist.';
  END IF;
END;
$fn$;

GRANT EXECUTE ON FUNCTION rename_group(UUID, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 2. Who is in one.
--
-- Needed to take somebody out, and the screen had no way to ask.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION group_members(p_group UUID)
RETURNS TABLE (contact_id UUID, company_name TEXT, accounts INTEGER, net NUMERIC)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('crm.view') THEN
    RAISE EXCEPTION 'Seeing who is in a group needs access to the CRM.';
  END IF;

  RETURN QUERY
  SELECT c.id, c.company_name,
         (SELECT count(*)::INTEGER FROM protean_accounts a
           WHERE a.contact_id = c.id AND NOT a.ignored),
         (SELECT COALESCE(SUM(i.net), 0)::NUMERIC
            FROM protean_invoices i
            JOIN protean_accounts a ON a.division = i.division AND a.alpha = i.alpha
           WHERE a.contact_id = c.id AND NOT a.ignored)
    FROM crm_contacts c
   WHERE c.group_id = p_group
   ORDER BY 4 DESC, c.company_name;
END;
$fn$;

GRANT EXECUTE ON FUNCTION group_members(UUID) TO authenticated;

-- -------------------------------------------------------------
-- 3. Suggestions somebody has said no to.
--
-- Kept by NAME rather than by member, because the suggestion is
-- regenerated from whoever happens to be in the CRM. Declining `John`
-- means "John is not a group", and it should stay declined when a
-- fourth John arrives.
--
-- A group made later under that name clears it: saying yes is a
-- stronger statement than having once said no.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS declined_group_suggestions (
  name        TEXT PRIMARY KEY,
  declined_by UUID REFERENCES auth.users ON DELETE SET NULL,
  declined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE declined_group_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS declined_group_suggestions_read ON declined_group_suggestions;
CREATE POLICY declined_group_suggestions_read ON declined_group_suggestions
  FOR SELECT USING (command_may('crm.view'));

REVOKE INSERT, UPDATE, DELETE ON declined_group_suggestions FROM anon, authenticated;
REVOKE SELECT ON declined_group_suggestions FROM anon;

CREATE OR REPLACE FUNCTION decline_group_suggestion(p_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE clean TEXT := lower(NULLIF(btrim(COALESCE(p_name, '')), ''));
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Declining a group needs permission to edit the CRM.';
  END IF;
  IF clean IS NULL THEN RAISE EXCEPTION 'That suggestion has no name.'; END IF;

  INSERT INTO declined_group_suggestions (name, declined_by)
  VALUES (clean, auth.uid())
  ON CONFLICT (name) DO UPDATE SET declined_by = auth.uid(), declined_at = NOW();
END;
$fn$;

GRANT EXECUTE ON FUNCTION decline_group_suggestion(TEXT) TO authenticated;

/** Offer it again. Somebody declines by accident like anything else. */
CREATE OR REPLACE FUNCTION undecline_group_suggestion(p_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Bringing a group suggestion back needs permission to edit the CRM.';
  END IF;
  DELETE FROM declined_group_suggestions
   WHERE name = lower(btrim(COALESCE(p_name, '')));
END;
$fn$;

GRANT EXECUTE ON FUNCTION undecline_group_suggestion(TEXT) TO authenticated;

/* Saying yes overrides having once said no. */
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

  DELETE FROM declined_group_suggestions WHERE name = lower(clean);

  SELECT g.id INTO found FROM customer_groups g WHERE lower(g.name) = lower(clean);
  IF found IS NOT NULL THEN
    RETURN found;
  END IF;

  INSERT INTO customer_groups (name, created_by) VALUES (clean, auth.uid())
  RETURNING id INTO found;
  RETURN found;
END;
$fn$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rename_group') THEN
    RAISE EXCEPTION 'a group still cannot be renamed';
  END IF;
  RAISE NOTICE 'ok  a group can be renamed, read, emptied and forgotten, and a suggestion can be declined for good';
END $$;
