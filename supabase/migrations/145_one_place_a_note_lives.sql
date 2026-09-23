-- =============================================================
-- 145. `crm_contacts.notes` is a MIRROR of the newest note, both ways.
--
-- 144 made `contact_notes` the one place a customer note lives and gave
-- it add, edit and remove. This finishes the job for everything that
-- still reads or writes the old column, which is more things than the
-- two screens:
--
--   * the CRM grid's "Latest note" column
--   * the CSV export in `lib/crm/load-export.ts`
--   * the command bar, which lists `notes` on contacts in
--     `lib/command/fields.ts` and writes it through `command_apply`
--
-- The column already had half a mirror: `sync_latest_note` copied the
-- text across on INSERT and did nothing on edit or removal. So a note
-- corrected in the drawer left the grid showing the old wording, and a
-- note removed left the grid showing a note that no longer existed.
--
-- ---- What this does ----
--
--   1. The mirror is recomputed rather than copied, and it fires on
--      insert, update and delete. It is always the newest note that is
--      still there, or nothing at all when there are none.
--   2. Writing the column directly WRITES A NOTE. Typing in the grid
--      cell, or telling the command bar to add a note to Dawson, now
--      reaches `contact_notes` with an author and a date on it rather
--      than overwriting a text column nobody can attribute.
--   3. Anything already in the column that never became a note is
--      turned into one by `contact_notes_from_column()`, called by
--      hand. NOTHING IS DELETED and nothing is overwritten: a column
--      whose text is already the newest note is left alone.
-- =============================================================

-- -------------------------------------------------------------
-- 0. Two notes written in one go are still in an order.
--
-- `created_at` defaulted to NOW(), which is the time the TRANSACTION
-- started rather than the time the row was written. Two notes added in
-- one transaction, which is exactly what a backfill does, therefore
-- carried the same timestamp and "the newest note" was whichever one
-- the planner happened to hand back first.
--
-- `clock_timestamp()` is the actual moment. Rows already written keep
-- the timestamps they have, and every ordering below carries `id` as a
-- second key so a tie that predates this still decides the same way
-- twice.
-- -------------------------------------------------------------
ALTER TABLE contact_notes ALTER COLUMN created_at SET DEFAULT clock_timestamp();

-- -------------------------------------------------------------
-- 1. The mirror, recomputed.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_latest_note()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE who UUID; newest TEXT;
BEGIN
  who := COALESCE(NEW.contact_id, OLD.contact_id);
  IF who IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  /* The column is already being set by the trigger below, in a BEFORE
     UPDATE on the very row this would touch. Updating a row from inside
     its own BEFORE trigger is how you lose the write, so the outer one
     has already put the right value on NEW and there is nothing to do
     here. */
  IF COALESCE(current_setting('stc.note_mirror', TRUE), 'off') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT n.text INTO newest
    FROM contact_notes n
   WHERE n.contact_id = who AND n.deleted_at IS NULL
   ORDER BY n.created_at DESC, n.id DESC
   LIMIT 1;

  /* Says "this is the mirror writing" so the trigger below does not
     read it back as somebody adding a note, which would append a copy
     of every note for ever. */
  PERFORM set_config('stc.note_mirror', 'on', TRUE);
  UPDATE crm_contacts SET notes = newest
   WHERE id = who AND notes IS DISTINCT FROM newest;
  PERFORM set_config('stc.note_mirror', 'off', TRUE);

  RETURN COALESCE(NEW, OLD);
END;
$func$;

DROP TRIGGER IF EXISTS contact_notes_sync_latest ON contact_notes;
CREATE TRIGGER contact_notes_sync_latest
  AFTER INSERT OR UPDATE OR DELETE ON contact_notes
  FOR EACH ROW EXECUTE FUNCTION sync_latest_note();

-- -------------------------------------------------------------
-- 2. Writing the column writes a note.
--
-- AFTER UPDATE, not BEFORE. `contact_notes` already carries
-- `touch_last_activity_from_note`, which stamps `last_activity_at` on
-- the same customer row. Writing a note from a BEFORE trigger therefore
-- asked Postgres to update a row from inside its own update, which it
-- refuses outright: "tuple to be updated was already modified by an
-- operation triggered by the current command".
--
-- Clearing the column is NOT a removal. Notes are removed one at a
-- time, by name, through `crm_note_remove`, and a blanked cell that
-- silently destroyed a customer's history would be the worst kind of
-- accident. The clear is put straight back.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION note_column_writes_a_note()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE who UUID; name TEXT;
BEGIN
  IF NEW.notes IS NOT DISTINCT FROM OLD.notes THEN RETURN NULL; END IF;
  /* The mirror, or this trigger putting a cleared cell back. Either way
     the column is being set from the notes rather than the other way
     round, and reading it back would append a copy of every note. */
  IF COALESCE(current_setting('stc.note_mirror', TRUE), 'off') = 'on' THEN RETURN NULL; END IF;

  IF COALESCE(BTRIM(NEW.notes), '') = '' THEN
    PERFORM set_config('stc.note_mirror', 'on', TRUE);
    UPDATE crm_contacts SET notes = OLD.notes WHERE id = NEW.id;
    PERFORM set_config('stc.note_mirror', 'off', TRUE);
    RETURN NULL;
  END IF;

  who := current_actor();
  SELECT COALESCE(full_name, email) INTO name FROM profiles WHERE id = who;

  /* The note is inserted with the mirror flag on, because the column
     already says exactly what the note says and the mirror writing it
     again would be a second update of a row that is mid update. */
  PERFORM set_config('stc.note_mirror', 'on', TRUE);
  INSERT INTO contact_notes (contact_id, author_id, author_name, text)
  VALUES (NEW.id, who, COALESCE(name, 'Somebody'), BTRIM(NEW.notes));
  PERFORM set_config('stc.note_mirror', 'off', TRUE);

  /* The note was trimmed on its way in, so the column says the same
     thing rather than keeping the spaces somebody typed. */
  IF NEW.notes IS DISTINCT FROM BTRIM(NEW.notes) THEN
    PERFORM set_config('stc.note_mirror', 'on', TRUE);
    UPDATE crm_contacts SET notes = BTRIM(NEW.notes) WHERE id = NEW.id;
    PERFORM set_config('stc.note_mirror', 'off', TRUE);
  END IF;

  RETURN NULL;
END;
$func$;

DROP TRIGGER IF EXISTS crm_contacts_note_column ON crm_contacts;
CREATE TRIGGER crm_contacts_note_column
  AFTER UPDATE OF notes ON crm_contacts
  FOR EACH ROW EXECUTE FUNCTION note_column_writes_a_note();

COMMENT ON COLUMN crm_contacts.notes IS
  'The newest note on this customer, mirrored from contact_notes and kept there. '
  'Writing it adds a note rather than replacing the text, and clearing it is '
  'refused: notes are removed one at a time through crm_note_remove.';

-- -------------------------------------------------------------
-- 3. Anything in the column that never became a note.
--
-- Idempotent, called by hand, and it leaves every column value where it
-- is. A customer whose column already matches their newest note has
-- nothing to move.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS contact_notes_from_column();
CREATE OR REPLACE FUNCTION contact_notes_from_column()
RETURNS TABLE (moved INT, already INT, empty INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE c RECORD; newest TEXT; m INT := 0; a INT := 0; e INT := 0;
BEGIN
  IF NOT command_may('crm.edit') THEN
    RAISE EXCEPTION 'Moving the notes column onto the customers needs permission to edit the CRM.';
  END IF;

  FOR c IN SELECT id, notes FROM crm_contacts WHERE deleted_at IS NULL
  LOOP
    IF COALESCE(BTRIM(c.notes), '') = '' THEN e := e + 1; CONTINUE; END IF;

    SELECT n.text INTO newest FROM contact_notes n
     WHERE n.contact_id = c.id AND n.deleted_at IS NULL
     ORDER BY n.created_at DESC, n.id DESC LIMIT 1;

    IF newest IS NOT NULL AND BTRIM(newest) = BTRIM(c.notes) THEN
      a := a + 1; CONTINUE;
    END IF;

    /* Already there under a different date, so it is somebody's note
       and not a stray column. Nothing to move. */
    IF EXISTS (
      SELECT 1 FROM contact_notes n
       WHERE n.contact_id = c.id AND n.deleted_at IS NULL
         AND BTRIM(n.text) = BTRIM(c.notes)
    ) THEN a := a + 1; CONTINUE; END IF;

    /* Dated BEFORE every note this customer already has, so moving a
       stray column value onto the record cannot promote it over a real
       note somebody wrote last week. Where there are no notes at all it
       becomes the only one and the date does not matter. */
    INSERT INTO contact_notes (contact_id, author_id, author_name, text, created_at)
    VALUES (c.id, NULL, 'From the customer record', BTRIM(c.notes),
            COALESCE((SELECT MIN(n.created_at) - INTERVAL '1 second'
                        FROM contact_notes n
                       WHERE n.contact_id = c.id AND n.deleted_at IS NULL),
                     NOW()));
    m := m + 1;
  END LOOP;

  RETURN QUERY SELECT m, a, e;
END;
$fn$;

REVOKE ALL ON FUNCTION contact_notes_from_column() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION contact_notes_from_column() TO authenticated;

-- -------------------------------------------------------------
-- 4. The same second key on the reader the tracker uses.
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
   ORDER BY n.contact_id, n.created_at DESC, n.id DESC;
$fn$;

REVOKE ALL ON FUNCTION crm_latest_notes(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_latest_notes(UUID[]) TO authenticated;
