-- =============================================================
-- 150. The notes column is rescued before anything can overwrite it.
--
-- ---- The fault, found by running the handover files for real ----
--
-- Migration 145 made `crm_contacts.notes` a mirror of the customer's
-- newest note, recomputed by a trigger whenever a note is written.
-- Migration 144 moves the notes off the deals and onto the customers.
--
-- Run in that order, the mirror fires on the first moved note, sets the
-- column to that note's text, and THE VALUE THAT WAS IN THE COLUMN IS
-- GONE. It was only ever in one place. `contact_notes_from_column()`,
-- which exists to rescue exactly that value, then finds the column
-- already agreeing with a note and reports "already there".
--
-- Nothing warned. The counts read 1 moved, 1 already, and a line
-- somebody typed about a customer had been destroyed.
--
-- ---- Why this is a migration and not a note in the handover file ----
--
-- The obvious fix is "run the column one first". A rule of that shape
-- is kept by whoever remembers it, which is nobody in a month. So the
-- order stops mattering instead:
--
--   `contact_note_from_column(contact)` rescues ONE customer's column
--   value, and is what both callers go through.
--
--   `tracker_notes_to_customers()` calls it for a customer before
--   writing that customer's first note, so the column is already a
--   dated note by the time the mirror recomputes it.
--
-- Run them in either order now, or one of them twice, and the same two
-- notes come out.
--
-- NOTHING IS DELETED. Both functions only ever insert.
-- =============================================================

-- -------------------------------------------------------------
-- One customer's column value, turned into a note.
--
-- Dated BEFORE every note they already have, so rescuing a stray
-- cannot promote it over something somebody wrote last week. Returns
-- TRUE only when it wrote one.
--
-- The date is ALWAYS a second earlier than something, never NOW(). The
-- first version fell back to NOW() where the customer had no notes
-- yet, which is the commonest case, and NOW() inside a transaction is
-- the same instant for every row in it. So the rescued value and the
-- note written a line later carried the same timestamp, and which one
-- the grid called newest came down to which id sorted higher. It
-- passed, then failed on the next run with nothing changed.
--
-- A rescued column value has no date of its own and is older than the
-- record by construction, so it is dated from the oldest thing there
-- is, minus a second.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS contact_note_from_column(UUID);
CREATE OR REPLACE FUNCTION contact_note_from_column(p_contact UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE said TEXT;
BEGIN
  SELECT BTRIM(c.notes) INTO said
    FROM crm_contacts c
   WHERE c.id = p_contact AND c.deleted_at IS NULL;

  IF COALESCE(said, '') = '' THEN RETURN FALSE; END IF;

  /* Already on the record, under any date, so it is somebody's note
     rather than a stray column. */
  IF EXISTS (
    SELECT 1 FROM contact_notes n
     WHERE n.contact_id = p_contact AND n.deleted_at IS NULL
       AND BTRIM(n.text) = said
  ) THEN RETURN FALSE; END IF;

  INSERT INTO contact_notes (contact_id, author_id, author_name, text, created_at)
  VALUES (p_contact, NULL, 'From the customer record', said,
          COALESCE(
            (SELECT MIN(n.created_at) FROM contact_notes n
              WHERE n.contact_id = p_contact AND n.deleted_at IS NULL),
            (SELECT c.created_at FROM crm_contacts c WHERE c.id = p_contact),
            NOW()
          ) - INTERVAL '1 second');
  RETURN TRUE;
END;
$fn$;

REVOKE ALL ON FUNCTION contact_note_from_column(UUID) FROM PUBLIC;

-- -------------------------------------------------------------
-- The sweep, now one line of work per customer.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS contact_notes_from_column();
CREATE OR REPLACE FUNCTION contact_notes_from_column()
RETURNS TABLE (moved INT, already INT, empty INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE c RECORD; m INT := 0; a INT := 0; e INT := 0;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Moving the notes column onto the customers needs permission to edit the CRM.';
  END IF;

  FOR c IN SELECT id, notes FROM crm_contacts WHERE deleted_at IS NULL
  LOOP
    IF COALESCE(BTRIM(c.notes), '') = '' THEN e := e + 1; CONTINUE; END IF;
    IF contact_note_from_column(c.id) THEN m := m + 1; ELSE a := a + 1; END IF;
  END LOOP;

  RETURN QUERY SELECT m, a, e;
END;
$fn$;

REVOKE ALL ON FUNCTION contact_notes_from_column() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION contact_notes_from_column() TO authenticated;

-- -------------------------------------------------------------
-- And the deal sweep rescues the column on its way past.
--
-- The only change from 144 is the one line marked below. Everything
-- else is the same body, so nothing about what it moves or what it
-- leaves alone has changed.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS tracker_notes_to_customers();
CREATE OR REPLACE FUNCTION tracker_notes_to_customers()
RETURNS TABLE (moved INT, already INT, no_customer INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r RECORD; n_moved INT := 0; n_already INT := 0; n_none INT := 0; name TEXT;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Moving tracker notes onto customers needs permission to edit the CRM.';
  END IF;

  FOR r IN
    SELECT l.id, l.contact_id, l.owner_id, BTRIM(l.notes) AS note,
           COALESCE(l.last_activity_at, l.created_at) AS whenish
      FROM crm_leads l
     WHERE COALESCE(BTRIM(l.notes), '') <> ''
  LOOP
    IF r.contact_id IS NULL THEN n_none := n_none + 1; CONTINUE; END IF;

    /* THE ONE LINE. Rescue whatever is in that customer's notes column
       BEFORE writing a note against them, because writing one makes the
       mirror recompute the column and the old value is only in the
       column. Does nothing when there is nothing to rescue, and nothing
       on the second customer from the same company. */
    PERFORM contact_note_from_column(r.contact_id);

    /* The same text already against that customer from that deal is
       this function having run before, not a second note. */
    IF EXISTS (
      SELECT 1 FROM contact_notes n
       WHERE n.contact_id = r.contact_id AND n.from_lead_id = r.id
         AND n.text = r.note AND n.deleted_at IS NULL
    ) THEN n_already := n_already + 1; CONTINUE; END IF;

    SELECT COALESCE(full_name, email) INTO name FROM profiles WHERE id = r.owner_id;

    INSERT INTO contact_notes
      (contact_id, author_id, author_name, text, created_at, from_lead_id)
    VALUES (r.contact_id, r.owner_id, COALESCE(name, 'From the tracker'),
            r.note, r.whenish, r.id);
    n_moved := n_moved + 1;
  END LOOP;

  RETURN QUERY SELECT n_moved, n_already, n_none;
END;
$fn$;

REVOKE ALL ON FUNCTION tracker_notes_to_customers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tracker_notes_to_customers() TO authenticated;
