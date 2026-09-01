-- =============================================================
-- 069. An account nobody put on a list was invisible in the CRM.
--
-- From the business:
--
--   The CRM tab is empty by the way. It's impossible the CRM is empty
--   when you have leads as the customer has to physically appear in the
--   CRM before it can physically have a lead assigned to it.
--
-- That reading is right, and the CRM was contradicting it.
--
-- ---- What was actually wrong ----
--
-- Migration 040 moved list membership out of `crm_contacts.list_id` and
-- into the `crm_list_contacts` join table, so one company could sit on
-- the shared pipeline and on three people's lists at once instead of
-- existing four times.
--
-- Two things then disagreed about what a company with no membership at
-- all means.
--
-- The row level policy, `crm_contact_on_a_list_you_can_see`, says such a
-- company is visible to everybody, and its comment is explicit that this
-- is deliberate: "a contact with no membership rows is visible to
-- everybody, exactly as a contact with no list always has been".
--
-- `app/dashboard/crm/page.tsx` reads the other way round. It asks
-- `crm_list_contacts` which companies are on the open list and then
-- fetches those ids, so a company on no list is fetched by nothing and
-- never appears, whatever the policy says.
--
-- The only thing filling the join table was the trigger from 040, which
-- fires on `crm_contacts.list_id`. So a company created by any route
-- that does not set that column, which is the import, the FleetSmart+
-- builder and the tracker's new lead flow, went into the database, took
-- leads, showed on trackers, counted in every total, and could not be
-- opened in the CRM.
--
-- ---- What this does ----
--
-- Makes the database keep the promise the policy already makes. A
-- company that ends a statement on no list at all joins the shared
-- pipeline, because a company nobody has filed anywhere is a company
-- everybody should be able to find.
--
-- It does not touch a company that was deliberately put on a private
-- list and nowhere else. That is a filed company, and filing it is what
-- the private list is for.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The shared pipeline, whatever it is called.
--
-- Read rather than assumed, because the name is a person's to change
-- and `is_global` is the thing that means it.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm_global_list()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT id FROM crm_lists WHERE is_global ORDER BY created_at LIMIT 1;
$fn$;

-- -------------------------------------------------------------
-- 2. A new account joins it.
--
-- AFTER INSERT, so the trigger from migration 040 has already run and
-- recorded the membership for anything that did set `list_id`. Only a
-- company that came out of the statement filed nowhere is touched.
--
-- SECURITY DEFINER because the person creating the account may not hold
-- the right to add rows to the shared pipeline, and this is not them
-- choosing to: it is the CRM keeping its own list of who is in it.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm_account_joins_the_pipeline()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE shared UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM crm_list_contacts WHERE contact_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  shared := crm_global_list();
  IF shared IS NULL THEN
    /* No shared pipeline in this database. Nothing to do, and nothing
       worth failing an insert over: the company still exists and the
       policy still lets everybody see it. */
    RETURN NEW;
  END IF;

  INSERT INTO crm_list_contacts (list_id, contact_id, added_by)
  VALUES (shared, NEW.id, current_actor())
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS crm_account_joins_the_pipeline ON crm_contacts;
CREATE TRIGGER crm_account_joins_the_pipeline
  AFTER INSERT ON crm_contacts
  FOR EACH ROW EXECUTE FUNCTION crm_account_joins_the_pipeline();

-- -------------------------------------------------------------
-- 3. The ones already in there.
--
-- Every company currently on no list at all. Runs once: the second run
-- finds none, because they are all on the shared pipeline by then.
-- -------------------------------------------------------------
DO $$
DECLARE shared UUID; found INT;
BEGIN
  shared := crm_global_list();
  IF shared IS NULL THEN
    RAISE NOTICE 'no shared pipeline in this database, so nothing was filed';
    RETURN;
  END IF;

  INSERT INTO crm_list_contacts (list_id, contact_id)
  SELECT shared, c.id
    FROM crm_contacts c
   WHERE NOT EXISTS (SELECT 1 FROM crm_list_contacts lc WHERE lc.contact_id = c.id)
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS found = ROW_COUNT;
  IF found > 0 THEN
    RAISE NOTICE 'ok  % account(s) that were on no list are now on the shared pipeline', found;
  ELSE
    RAISE NOTICE 'ok  every account was already on a list';
  END IF;
END $$;

-- -------------------------------------------------------------
-- 4. And it stayed true.
-- -------------------------------------------------------------
DO $$
DECLARE orphans INT;
BEGIN
  IF crm_global_list() IS NULL THEN RETURN; END IF;

  SELECT count(*) INTO orphans
    FROM crm_contacts c
   WHERE NOT EXISTS (SELECT 1 FROM crm_list_contacts lc WHERE lc.contact_id = c.id);

  IF orphans > 0 THEN
    RAISE EXCEPTION '% account(s) are still on no list', orphans;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION crm_global_list() TO authenticated;

COMMENT ON FUNCTION crm_account_joins_the_pipeline() IS
  'A company filed nowhere joins the shared pipeline, so the CRM can '
  'never hold an account that no screen will show.';
