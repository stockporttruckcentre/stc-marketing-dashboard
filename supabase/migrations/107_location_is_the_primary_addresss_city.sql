-- =============================================================
-- 107. Location is the primary address's city, and nothing else.
--
-- From the business:
--
--   "Location" and "Addresses" mean the same thing and should not co
--   exist. That's the whole reason for the primary address function
--   inside the map, to set the one that shows in the crm table.
--
--   "Location" should be 100% dynamic. It's empty until you have
--   created an Address. If you only created 1 address it remains
--   primary. If you add another you have to make it primary or else the
--   first one remains primary. the city strips out and shows as
--   "Location" in the crm table.
--
-- And what set this off:
--
--   I'd have location just showing the city but you've now put tons of
--   full addresses in it ... and some locations say "£7k billed this
--   year"
--
-- ---- Why that junk could never go away ----
--
-- `sync_primary_address_to_contact` has said this since it was written:
--
--   SET location = COALESCE(prim_city, location),
--       address  = COALESCE(prim_addr, address)
--
-- COALESCE means "keep the old value when the new one is null". So the
-- moment anything put a full address or a sentence about billing into
-- `location`, no amount of adding, editing or deleting addresses would
-- ever clear it. A column described as derived was in fact a column that
-- could be written once and never corrected.
--
-- Both are mirrors now. No COALESCE. A customer with no primary address
-- has an empty Location and an empty address, which is what "empty until
-- you have created an Address" means, and a customer with one has the
-- city off the front of it.
--
-- ---- What is NOT changed ----
--
-- Which address is primary. `enforce_single_primary_address` already
-- demotes the others when one is promoted, and the drawer already marks
-- the first address primary and leaves later ones alone. That is the
-- rule as described and it is already right.
--
-- ---- Nothing is thrown away ----
--
-- The backfill clears whatever was sitting in those two columns, and
-- some of it is junk that nobody will miss. It is copied to
-- `crm_location_before_107` first anyway, because "some of it is junk"
-- is a judgement and the rule here is that data is not deleted on my
-- say so. That table can be dropped by hand once the CRM looks right.
--
-- ---- Safe to run twice ----
--
-- The set aside table is only written on the first run. The backfill is
-- idempotent by construction: it sets both columns to what the primary
-- address says, which does not change on a second pass.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1. What those two columns hold right now.
--
-- Written once. A second run of this file must not overwrite the
-- original values with the ones the first run left behind.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_location_before_107 (
  contact_id   UUID PRIMARY KEY REFERENCES crm_contacts ON DELETE CASCADE,
  company_name TEXT,
  old_location TEXT,
  old_address  TEXT,
  saved_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE crm_location_before_107 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_location_before_107_read ON crm_location_before_107;
CREATE POLICY crm_location_before_107_read ON crm_location_before_107
  FOR SELECT USING (command_may('crm.view'));

REVOKE INSERT, UPDATE, DELETE ON crm_location_before_107 FROM authenticated, anon;
GRANT SELECT ON crm_location_before_107 TO authenticated;

INSERT INTO crm_location_before_107 (contact_id, company_name, old_location, old_address)
SELECT c.id, c.company_name, c.location, c.address
  FROM crm_contacts c
 WHERE COALESCE(btrim(c.location), '') <> ''
    OR COALESCE(btrim(c.address), '') <> ''
ON CONFLICT (contact_id) DO NOTHING;

COMMENT ON TABLE crm_location_before_107 IS
  'What crm_contacts.location and .address held before migration 107 '
  'made them mirrors of the primary address. Kept so nothing was '
  'deleted on anybody''s say so. Safe to drop once the CRM looks right.';

-- -------------------------------------------------------------
-- 2. The mirror.
--
-- TAKEN FROM THE EXISTING FUNCTION, with the two COALESCE calls removed
-- and nothing else touched. It is quoted rather than rewritten for the
-- reason migration 091 gives: a function restated from memory loses
-- something, and a trigger that loses something is silent.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_primary_address_to_contact()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
DECLARE
  prim_city TEXT;
  prim_addr TEXT;
BEGIN
  SELECT city, address INTO prim_city, prim_addr
  FROM contact_addresses
  WHERE contact_id = COALESCE(NEW.contact_id, OLD.contact_id)
    AND is_primary = TRUE
    AND deleted_at IS NULL
  ORDER BY created_at DESC LIMIT 1;

  /* No COALESCE. These two columns ARE the primary address, and a
     customer with no primary address has neither. Keeping the old value
     when the new one is null is what let a full address, and a sentence
     about billing, sit in Location forever with no way to clear it. */
  UPDATE crm_contacts
     SET location = NULLIF(btrim(COALESCE(prim_city, '')), ''),
         address  = NULLIF(btrim(COALESCE(prim_addr, '')), '')
   WHERE id = COALESCE(NEW.contact_id, OLD.contact_id);

  RETURN COALESCE(NEW, OLD);
END;
$fn$;

COMMENT ON FUNCTION sync_primary_address_to_contact() IS
  'Keeps crm_contacts.location and .address as mirrors of the primary '
  'contact_addresses row. Both are empty for a customer with no primary '
  'address. Never write either column directly.';

-- -------------------------------------------------------------
-- 3. And bring every customer into line with it.
--
-- The trigger only fires when an address changes, so without this the
-- junk stays until somebody happens to edit an address on that record.
-- -------------------------------------------------------------
UPDATE crm_contacts c
   SET location = p.city,
       address  = p.address
  FROM (
    SELECT c2.id,
           NULLIF(btrim(COALESCE(a.city, '')), '')    AS city,
           NULLIF(btrim(COALESCE(a.address, '')), '') AS address
      FROM crm_contacts c2
      LEFT JOIN LATERAL (
        SELECT x.city, x.address
          FROM contact_addresses x
         WHERE x.contact_id = c2.id AND x.is_primary AND x.deleted_at IS NULL
         ORDER BY x.created_at DESC
         LIMIT 1
      ) a ON TRUE
  ) p
 WHERE c.id = p.id
   AND (c.location IS DISTINCT FROM p.city OR c.address IS DISTINCT FROM p.address);

-- -------------------------------------------------------------
-- 4. Did it land.
-- -------------------------------------------------------------
DO $$
DECLARE
  stragglers INTEGER;
  kept       INTEGER;
BEGIN
  /* Nobody has a Location without a primary address to have got it
     from. That is the whole of "empty until you have created an
     Address", stated as a query. */
  SELECT count(*) INTO stragglers
    FROM crm_contacts c
   WHERE COALESCE(btrim(c.location), '') <> ''
     AND NOT EXISTS (
       SELECT 1 FROM contact_addresses a
        WHERE a.contact_id = c.id AND a.is_primary AND a.deleted_at IS NULL
          AND COALESCE(btrim(a.city), '') <> '');
  IF stragglers > 0 THEN
    RAISE EXCEPTION '107 did not land: % records have a Location with no primary address behind it', stragglers;
  END IF;

  /* And the same for the address shadow. */
  SELECT count(*) INTO stragglers
    FROM crm_contacts c
   WHERE COALESCE(btrim(c.address), '') <> ''
     AND NOT EXISTS (
       SELECT 1 FROM contact_addresses a
        WHERE a.contact_id = c.id AND a.is_primary AND a.deleted_at IS NULL
          AND COALESCE(btrim(a.address), '') <> '');
  IF stragglers > 0 THEN
    RAISE EXCEPTION '107 did not land: % records have an address with no primary address behind it', stragglers;
  END IF;

  SELECT count(*) INTO kept FROM crm_location_before_107;
  RAISE NOTICE 'location is the primary address city now. % record(s) set aside in crm_location_before_107', kept;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
