-- =============================================================
-- Location is the primary address's city, and nothing else.
--
-- From the business:
--
--   "Location" and "Addresses" mean the same thing and should not co
--   exist ... "Location" should be 100% dynamic. It's empty until you
--   have created an Address. If you only created 1 address it remains
--   primary. If you add another you have to make it primary or else the
--   first one remains primary. the city strips out and shows as
--   "Location" in the crm table.
--
-- Every sentence of that is a case below. The one that let the fault in
-- was the COALESCE: a derived column that keeps its old value when the
-- new one is null is not derived, it is a column anybody can write once
-- and nobody can correct, which is how "£7k billed this year" ended up
-- in Location with no way to clear it.
--
-- Run with `npm run check:location`.
-- =============================================================
\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.must(p_what TEXT, p_ok BOOLEAN) RETURNS VOID
LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_ok THEN RAISE NOTICE 'ok    %', p_what;
  ELSE RAISE EXCEPTION 'FAIL  %', p_what;
  END IF;
END $fn$;

DO $$
DECLARE
  who UUID;
  a1  UUID;
  a2  UUID;
BEGIN
  INSERT INTO crm_contacts (company_name) VALUES ('Location Rules Ltd') RETURNING id INTO who;

  PERFORM pg_temp.must('a customer with no address has no Location',
    (SELECT location IS NULL AND address IS NULL FROM crm_contacts WHERE id = who));

  -- ---- the first address is primary and sets the Location ----
  INSERT INTO contact_addresses (contact_id, label, address, city, is_primary)
  VALUES (who, 'Head office', 'Unit 1, Bredbury, SK6 2SP', 'Stockport', TRUE)
  RETURNING id INTO a1;

  PERFORM pg_temp.must('the first address sets the Location to its city',
    (SELECT location FROM crm_contacts WHERE id = who) = 'Stockport');
  PERFORM pg_temp.must('and the city only, never the whole address',
    (SELECT location FROM crm_contacts WHERE id = who) NOT LIKE '%SK6%');

  -- ---- a second address does not steal it ----
  INSERT INTO contact_addresses (contact_id, label, address, city, is_primary)
  VALUES (who, 'Depot', 'Unit 9, Haydock, WA11 9TL', 'Haydock', FALSE)
  RETURNING id INTO a2;

  PERFORM pg_temp.must('adding a second address does not move the Location',
    (SELECT location FROM crm_contacts WHERE id = who) = 'Stockport');

  -- ---- until it is made primary ----
  UPDATE contact_addresses SET is_primary = TRUE WHERE id = a2;

  PERFORM pg_temp.must('making the second one primary moves the Location',
    (SELECT location FROM crm_contacts WHERE id = who) = 'Haydock');
  PERFORM pg_temp.must('and demotes the first, so there is only ever one primary',
    (SELECT count(*) FROM contact_addresses WHERE contact_id = who AND is_primary) = 1);

  -- ---- and it empties again ----
  DELETE FROM contact_addresses WHERE contact_id = who AND id IN (a1, a2);

  PERFORM pg_temp.must('deleting every address empties the Location again',
    (SELECT location IS NULL AND address IS NULL FROM crm_contacts WHERE id = who));
END $$;

-- =============================================================
-- The one that could not be cleared before.
-- =============================================================
DO $$
DECLARE junk UUID;
BEGIN
  INSERT INTO crm_contacts (company_name, location, address)
  VALUES ('Junk In Location Ltd', '£7k billed this year',
          'Some full address that should not be here')
  RETURNING id INTO junk;

  /* Adding a proper address must clear it. Under the old COALESCE it
     could not: a null city left the junk in place for ever. */
  INSERT INTO contact_addresses (contact_id, label, address, city, is_primary)
  VALUES (junk, 'Head office', 'Unit 3, Carrington, M31 4AH', NULL, TRUE);

  PERFORM pg_temp.must('a sentence sitting in Location is cleared by a real address',
    (SELECT location FROM crm_contacts WHERE id = junk) IS NULL);
  PERFORM pg_temp.must('and the address column becomes the real one',
    (SELECT address FROM crm_contacts WHERE id = junk) = 'Unit 3, Carrington, M31 4AH');
END $$;

-- =============================================================
-- And nobody can write either column any other way.
-- =============================================================
DO $$
DECLARE writers TEXT;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO writers
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname <> 'sync_primary_address_to_contact'
     AND p.prosrc ~* 'UPDATE\s+crm_contacts[^;]*\y(location|address)\y[^;]*=';
  IF writers IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL  these write location or address directly, and only the sync may: %', writers;
  END IF;
  PERFORM pg_temp.must('only the sync trigger writes Location and the address shadow', TRUE);
END $$;

ROLLBACK;
