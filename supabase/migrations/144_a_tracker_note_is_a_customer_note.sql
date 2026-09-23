-- =============================================================
-- 144. The note at the bottom of a tracker deal is a CUSTOMER note.
--
-- From the business:
--
--   When clicking into a lead and adding the latest note (at the very
--   bottom) rework this so that it's a global customer note adder that
--   will update the CRM record. Any other fields in the tracker relate
--   to that specific deal but the latest notes one (needs renaming)
--   will show when clicking into the customer in the CRM and also in
--   any other leads for this customer. [...] It can be deleted or
--   updated from the CRM tab after which updates the note globally
--   too. Essentially a shortcut.
--
-- Today `crm_leads.notes` is a free text column on the DEAL. Two
-- salespeople working two deals for Dawson each keep their own half of
-- the story and neither can see the other's, which is the thing the
-- CRM exists to stop.
--
-- `contact_notes` is already the real thing: per customer, attributed,
-- dated, soft deleted. The tracker simply was not writing to it.
--
-- ---- What this migration adds ----
--
--   1. A note can be EDITED. There was no update policy at all, so
--      "updated from the CRM tab" was impossible, not merely missing
--      from a screen.
--   2. Editing is recorded. An administrator may correct somebody's
--      note, because in a month there may be nobody else to, but a
--      note that has been changed says so and names who changed it.
--      Rewriting attributed words silently is not something this
--      should be able to do.
--   3. Deleting asks a capability instead of the old role name, the
--      same fault as migrations 139 to 141.
--   4. Nothing writes while somebody is viewing the app as another
--      person, per 139.
--
-- NOTHING IS DELETED and `crm_leads.notes` is left exactly as it is.
-- The backfill that moves its contents onto the customer is a separate,
-- idempotent function called by hand, not something this migration
-- does to a live database on the way past.
-- =============================================================

ALTER TABLE contact_notes ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE contact_notes ADD COLUMN IF NOT EXISTS edited_by UUID REFERENCES profiles(id) ON DELETE SET NULL;
/* Where a note came from, so a customer note that arrived through a
   deal can say so rather than appearing from nowhere. */
ALTER TABLE contact_notes ADD COLUMN IF NOT EXISTS from_lead_id UUID REFERENCES crm_leads(id) ON DELETE SET NULL;

COMMENT ON COLUMN contact_notes.edited_at IS
  'When the text was last changed after it was written. A note that has been '
  'edited says so, because rewriting attributed words silently is not something '
  'this application should be able to do.';

-- -------------------------------------------------------------
-- Writing one, from wherever.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS crm_note_add(UUID, TEXT, UUID);
CREATE OR REPLACE FUNCTION crm_note_add(
  p_contact UUID, p_text TEXT, p_from_lead UUID DEFAULT NULL
)
RETURNS contact_notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE made contact_notes; who UUID; name TEXT;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Adding a note to a customer needs permission to edit the CRM.';
  END IF;
  IF viewing_as_somebody() THEN
    RAISE EXCEPTION 'You are viewing the app as somebody else. Stop first, then try again.';
  END IF;
  IF COALESCE(BTRIM(p_text), '') = '' THEN
    RAISE EXCEPTION 'A note needs something in it.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM crm_contacts WHERE id = p_contact AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'That customer is not in the CRM.';
  END IF;

  who := current_actor();
  SELECT COALESCE(full_name, email) INTO name FROM profiles WHERE id = who;

  INSERT INTO contact_notes (contact_id, author_id, author_name, text, from_lead_id)
  VALUES (p_contact, who, COALESCE(name, 'Somebody'), BTRIM(p_text), p_from_lead)
  RETURNING * INTO made;

  RETURN made;
END;
$fn$;

-- -------------------------------------------------------------
-- Changing one, and saying so.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS crm_note_edit(UUID, TEXT);
CREATE OR REPLACE FUNCTION crm_note_edit(p_note UUID, p_text TEXT)
RETURNS contact_notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE row contact_notes; mine BOOLEAN;
BEGIN
  IF viewing_as_somebody() THEN
    RAISE EXCEPTION 'You are viewing the app as somebody else. Stop first, then try again.';
  END IF;
  IF COALESCE(BTRIM(p_text), '') = '' THEN
    RAISE EXCEPTION 'A note needs something in it. Delete it instead.';
  END IF;

  SELECT * INTO row FROM contact_notes WHERE id = p_note AND deleted_at IS NULL;
  IF row.id IS NULL THEN RAISE EXCEPTION 'There is no note with that id.'; END IF;

  mine := row.author_id = current_actor();
  /* Your own, or somebody who may edit the CRM. The second exists
     because in a month there may be nobody else to correct a note, and
     it is why the change is stamped rather than silent. */
  IF NOT mine AND NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Changing somebody else''s note needs permission to edit the CRM.';
  END IF;

  UPDATE contact_notes
     SET text = BTRIM(p_text),
         edited_at = NOW(),
         edited_by = current_actor()
   WHERE id = p_note
  RETURNING * INTO row;

  RETURN row;
END;
$fn$;

-- -------------------------------------------------------------
-- Taking one away. Soft, like everything else here.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS crm_note_remove(UUID);
CREATE OR REPLACE FUNCTION crm_note_remove(p_note UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE row contact_notes;
BEGIN
  IF viewing_as_somebody() THEN
    RAISE EXCEPTION 'You are viewing the app as somebody else. Stop first, then try again.';
  END IF;

  SELECT * INTO row FROM contact_notes WHERE id = p_note AND deleted_at IS NULL;
  IF row.id IS NULL THEN RETURN; END IF;

  IF row.author_id <> current_actor() AND NOT command_may('crm.delete') THEN
    RAISE EXCEPTION 'Removing somebody else''s note needs permission to remove CRM records.';
  END IF;

  PERFORM soft_delete('contact_notes', p_note, 'Removed from the customer record.');
END;
$fn$;

-- -------------------------------------------------------------
-- The policies. Update did not exist; delete asked a role name.
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "notes_update" ON contact_notes;
CREATE POLICY "notes_update" ON contact_notes
  FOR UPDATE
  USING (
    NOT viewing_as_somebody()
    AND (author_id = auth.uid() OR command_may('crm.edit'))
  )
  WITH CHECK (
    NOT viewing_as_somebody()
    AND (author_id = auth.uid() OR command_may('crm.edit'))
  );

DROP POLICY IF EXISTS "notes_delete" ON contact_notes;
CREATE POLICY "notes_delete" ON contact_notes
  FOR DELETE
  USING (
    NOT viewing_as_somebody()
    AND (author_id = auth.uid() OR command_may('crm.delete'))
  );

REVOKE ALL ON FUNCTION crm_note_add(UUID, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION crm_note_edit(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION crm_note_remove(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_note_add(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION crm_note_edit(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION crm_note_remove(UUID) TO authenticated;

-- -------------------------------------------------------------
-- The latest note per customer, which is what the tracker column
-- shows now instead of the deal's own text.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS crm_latest_notes(UUID[]);
CREATE OR REPLACE FUNCTION crm_latest_notes(p_contacts UUID[])
RETURNS TABLE (
  contact_id  UUID,
  note_id     UUID,
  text        TEXT,
  author_name TEXT,
  created_at  TIMESTAMPTZ,
  edited_at   TIMESTAMPTZ,
  notes_total INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT DISTINCT ON (n.contact_id)
         n.contact_id, n.id, n.text, n.author_name, n.created_at, n.edited_at,
         (SELECT count(*)::INT FROM contact_notes m
           WHERE m.contact_id = n.contact_id AND m.deleted_at IS NULL)
    FROM contact_notes n
   WHERE n.deleted_at IS NULL
     AND n.contact_id = ANY (p_contacts)
     AND command_may('crm.view')
   ORDER BY n.contact_id, n.created_at DESC;
$fn$;

REVOKE ALL ON FUNCTION crm_latest_notes(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_latest_notes(UUID[]) TO authenticated;

-- -------------------------------------------------------------
-- Moving what is already in `crm_leads.notes` onto the customer.
--
-- Called by hand, idempotent, and it DOES NOT EMPTY THE COLUMN. Every
-- note stays exactly where it is as well as arriving where it belongs,
-- because a backfill that clears its source has no second chance.
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

DO $$ BEGIN
  RAISE NOTICE 'a note typed on a deal now belongs to the customer, and can be changed or removed';
END $$;
