-- =============================================================
-- 063. A guest can just be a name.
--
-- Migration 062 built the whole invitation: an address, a link, a
-- standing, an answer coming back. That is more than the job asked for.
--
-- The job is putting "Wayne" on a meeting so the sales team can see
-- Wayne is in it. No address, no link, nothing to answer. He is on it,
-- and the point of writing him down is that everybody else looking at
-- the meeting knows.
--
-- So the address stops being required. What is left is one control that
-- covers both:
--
--   a name only        somebody who is on it. Nothing to answer, and
--                      the screen does not ask them to
--   a name and an email  the same, plus a link they can answer through
--                      if they can reach the application
--
-- The second is what 062 built and it stays, because it is written and
-- it costs nothing to keep. It is worth being straight about what it is
-- worth today: this application is only reachable through the VPN, so a
-- customer cannot open that link at all. Until that changes, or single
-- sign on brings a way to send a proper invitation, the email is a
-- record of who they are rather than a way of reaching them.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The address is optional. A name is enough.
-- -------------------------------------------------------------
ALTER TABLE calendar_guests ALTER COLUMN email DROP NOT NULL;

ALTER TABLE calendar_guests DROP CONSTRAINT IF EXISTS calendar_guests_email_check;

-- One or the other, but not neither: a guest with no name and no
-- address is a row that says nothing to anybody reading the meeting.
ALTER TABLE calendar_guests DROP CONSTRAINT IF EXISTS calendar_guests_has_somebody;
ALTER TABLE calendar_guests ADD CONSTRAINT calendar_guests_has_somebody CHECK (
  COALESCE(btrim(name), '') <> '' OR COALESCE(btrim(email), '') <> ''
);

-- An address, where there is one, still has to look like one.
ALTER TABLE calendar_guests DROP CONSTRAINT IF EXISTS calendar_guests_email_shape;
ALTER TABLE calendar_guests ADD CONSTRAINT calendar_guests_email_shape CHECK (
  email IS NULL OR position('@' IN email) > 1
);

/* The unique index is on the address, and a null is not equal to
   another null, so two people with no address on the same meeting are
   two people. That is right: "Wayne" and "the DVSA examiner" are not
   the same person and nothing here can tell whether two Waynes are.

   Somebody putting the same name down twice gets it twice, and can see
   that they have, which is a better answer than the second one
   silently doing nothing. */

-- -------------------------------------------------------------
-- 2. Asking somebody, where the asking may be nothing more than
--    writing them down.
--
-- Replaces the body from 062. The address is optional now, and the
-- token is still made either way: it costs nothing, it keeps the column
-- simple, and it means adding an address to somebody later makes their
-- link work without anything else having to happen.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION calendar_invite_guest(
  p_event   UUID,
  p_email   TEXT,
  p_name    TEXT DEFAULT '',
  p_contact UUID DEFAULT NULL,
  p_note    TEXT DEFAULT NULL
)
RETURNS calendar_guests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  me     UUID := current_actor();
  ev     RECORD;
  result calendar_guests;
  fresh  TEXT;
  addr   TEXT := NULLIF(btrim(COALESCE(p_email, '')), '');
  who    TEXT := NULLIF(btrim(COALESCE(p_name, '')), '');
BEGIN
  IF NOT command_may('crm.delegate') THEN
    RAISE EXCEPTION 'Adding somebody to a meeting needs the delegate permission.';
  END IF;
  IF addr IS NULL AND who IS NULL THEN
    RAISE EXCEPTION 'Give them a name, or an email address, or both.';
  END IF;
  IF addr IS NOT NULL AND position('@' IN addr) < 2 THEN
    RAISE EXCEPTION 'That is not an email address.';
  END IF;

  SELECT id, title, start_at, end_at, created_by INTO ev
    FROM calendar_events WHERE id = p_event;
  IF ev IS NULL THEN
    RAISE EXCEPTION 'There is no meeting with that id.';
  END IF;
  IF ev.created_by IS DISTINCT FROM me THEN
    RAISE EXCEPTION 'Only whoever booked % can add people to it.', ev.title;
  END IF;

  fresh := replace(gen_random_uuid()::TEXT, '-', '')
        || replace(gen_random_uuid()::TEXT, '-', '');

  /* The conflict clause only bites where there is an address to
     conflict on. Two people with no address are two people, per the
     note above the index. */
  IF addr IS NULL THEN
    INSERT INTO calendar_guests (event_id, email, name, contact_id, invited_by, note, token)
    VALUES (p_event, NULL, COALESCE(who, ''), p_contact, me, p_note, fresh)
    RETURNING * INTO result;
  ELSE
    INSERT INTO calendar_guests (event_id, email, name, contact_id, invited_by, note, token)
    VALUES (p_event, addr, COALESCE(who, ''), p_contact, me, p_note, fresh)
    ON CONFLICT (event_id, lower(email)) DO UPDATE SET
      name = COALESCE(NULLIF(btrim(EXCLUDED.name), ''), calendar_guests.name),
      note = COALESCE(EXCLUDED.note, calendar_guests.note),
      updated_at = NOW()
    RETURNING * INTO result;
  END IF;

  IF result.rounds = 0 AND NOT EXISTS (
    SELECT 1 FROM calendar_invite_messages WHERE guest_id = result.id
  ) THEN
    INSERT INTO calendar_invite_messages (guest_id, actor_id, action, start_at, end_at, note)
    VALUES (result.id, me, 'invited', ev.start_at, ev.end_at, p_note);
  END IF;

  RETURN result;
END;
$fn$;

REVOKE ALL ON FUNCTION calendar_invite_guest(UUID, TEXT, TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION calendar_invite_guest(UUID, TEXT, TEXT, UUID, TEXT) TO authenticated;

COMMENT ON TABLE calendar_guests IS
  'Somebody on a meeting who is not one of this application''s users. '
  'A name is enough. An address as well gives them a link they can '
  'answer through, which needs the application to be reachable from '
  'wherever they are.';
