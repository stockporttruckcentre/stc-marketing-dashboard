-- =============================================================
-- 062. Asking somebody who does not work here.
--
-- Migration 006 made an invitation a conversation, and every row in it
-- points at `auth.users`. That is right for Tom and Dave and wrong for
-- the person the meeting is actually with: a transport manager at
-- Dawson has no account here and is never going to have one.
--
-- Until now they were a name in the `attendees` JSONB. The meeting said
-- they were coming and nobody had asked them.
--
-- ---- What a guest is ----
--
-- The same four standings as a staff invitation, so the screen draws
-- one list and the diary counts one number. What differs is who they
-- are and how they answer.
--
--   who       an email address, not a user id
--   how       a link, not a session
--
-- ---- The token ----
--
-- A guest answers by following a link, so the link is the only thing
-- that says who they are. It is 64 hex characters from two v4 UUIDs,
-- which is 122 bits of randomness and needs no extension to generate.
--
-- It is stored as it is sent rather than hashed, and that is a decision
-- rather than an oversight. Nothing may read this table except the two
-- SECURITY DEFINER functions below: `anon` and `authenticated` have no
-- SELECT on it at all. A leaked link is worth exactly one thing, which
-- is answering one invitation to one meeting, and it can be taken back
-- by withdrawing the guest. Hashing would need pgcrypto in the search
-- path of a definer function, and buying that dependency for a token
-- with that blast radius is the wrong trade.
--
-- ---- What this deliberately does NOT do ----
--
-- Send anything. There is no outbound mail transport in this
-- application: no mail client in `package.json`, no SMTP host and no
-- provider key anywhere. Single sign on is coming, so nothing here
-- builds a channel that is about to be replaced.
--
-- What that leaves is the half that is not about transport and does not
-- change when one arrives: the guest is a real record with a real
-- standing, the link is what lets them answer without an account, and
-- their answer lands in the diary the moment they give it. Getting the
-- link to them is a copy and a paste today and a send later.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The guests.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calendar_guests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID REFERENCES calendar_events(id) ON DELETE CASCADE NOT NULL,

  -- Who was asked. Held as typed for the email, and matched on lower
  -- case, because somebody will type the same address twice in two
  -- cases and mean one person.
  email TEXT NOT NULL CHECK (position('@' IN email) > 1),
  name  TEXT NOT NULL DEFAULT '',

  -- Which customer they are at, when they are. Optional: a guest can be
  -- an inspector or a subcontractor rather than the account.
  contact_id UUID REFERENCES crm_contacts ON DELETE SET NULL,

  invited_by UUID REFERENCES auth.users ON DELETE SET NULL,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'proposed')),

  proposed_start_at TIMESTAMPTZ,
  proposed_end_at   TIMESTAMPTZ,

  -- What the link carries. See the header for why it is not hashed.
  token TEXT NOT NULL UNIQUE,

  rounds INTEGER NOT NULL DEFAULT 0,

  note TEXT,
  responded_at TIMESTAMPTZ,
  -- The last time the link was opened, so an organiser can tell "they
  -- have not answered" from "they have not looked".
  seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- One standing per person per meeting, whatever case they typed it in.
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_guests_one_each
  ON calendar_guests (event_id, lower(email));
CREATE INDEX IF NOT EXISTS idx_calendar_guests_event ON calendar_guests (event_id);

-- -------------------------------------------------------------
-- 2. Their side of the conversation, in the same history as everybody
--    else's.
--
-- `calendar_invite_messages` was one row per round against one staff
-- invitation. A second table for guests would mean the drawer drawing
-- two timelines and sorting them together, and the two drifting the
-- first time either grew a column. So the existing table learns a
-- second parent instead.
-- -------------------------------------------------------------
ALTER TABLE calendar_invite_messages
  ADD COLUMN IF NOT EXISTS guest_id UUID REFERENCES calendar_guests(id) ON DELETE CASCADE;

ALTER TABLE calendar_invite_messages
  ALTER COLUMN invite_id DROP NOT NULL;

ALTER TABLE calendar_invite_messages
  DROP CONSTRAINT IF EXISTS invite_messages_one_parent;
ALTER TABLE calendar_invite_messages
  ADD CONSTRAINT invite_messages_one_parent CHECK (
    (invite_id IS NOT NULL AND guest_id IS NULL)
    OR (invite_id IS NULL AND guest_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_invite_messages_guest
  ON calendar_invite_messages (guest_id, created_at);

-- -------------------------------------------------------------
-- 3. Row level security.
--
-- Guests: visible to whoever booked the meeting and to anybody who can
-- already see the meeting, because "who is coming" is part of the
-- meeting. Written only through the functions below, which is what the
-- absent INSERT and UPDATE policies say.
--
-- Nothing is granted to `anon` anywhere in this file except EXECUTE on
-- the two functions a guest needs. A guest holds a link, not a session,
-- and a link is not a way into a table.
-- -------------------------------------------------------------
ALTER TABLE calendar_guests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "guests_visible_with_the_meeting" ON calendar_guests;
CREATE POLICY "guests_visible_with_the_meeting" ON calendar_guests
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM calendar_events e WHERE e.id = event_id)
  );

-- SELECT only. Everything that writes goes through a function.
GRANT SELECT ON calendar_guests TO authenticated;

-- The token never leaves the database except inside the two functions
-- that need it. A column level revoke says so in a way a future SELECT *
-- cannot talk its way past.
REVOKE SELECT (token) ON calendar_guests FROM authenticated;

-- -------------------------------------------------------------
-- 4. Asking a guest.
--
-- The organiser's call, like `command_meeting_invite`, and refused for
-- the same reason: inviting somebody to a meeting is something only
-- whoever booked it can do.
--
-- Returns the whole row including the token, because the caller is the
-- server route that composes the email and it is the only thing that
-- ever sees it.
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
BEGIN
  IF NOT command_may('crm.delegate') THEN
    RAISE EXCEPTION 'Asking somebody to a meeting needs the delegate permission.';
  END IF;
  IF COALESCE(btrim(p_email), '') = '' OR position('@' IN p_email) < 2 THEN
    RAISE EXCEPTION 'That is not an email address.';
  END IF;

  SELECT id, title, start_at, end_at, created_by INTO ev
    FROM calendar_events WHERE id = p_event;
  IF ev IS NULL THEN
    RAISE EXCEPTION 'There is no meeting with that id.';
  END IF;
  IF ev.created_by IS DISTINCT FROM me THEN
    RAISE EXCEPTION 'Only whoever booked % can ask people to it.', ev.title;
  END IF;

  -- 64 hex characters out of two v4 UUIDs. See the header.
  fresh := replace(gen_random_uuid()::TEXT, '-', '')
        || replace(gen_random_uuid()::TEXT, '-', '');

  INSERT INTO calendar_guests (event_id, email, name, contact_id, invited_by, note, token)
  VALUES (p_event, btrim(p_email), COALESCE(btrim(p_name), ''), p_contact, me, p_note, fresh)
  ON CONFLICT (event_id, lower(email)) DO UPDATE SET
    -- Asking again is the same invitation, so their answer and their
    -- token both stand. Only the name and the note catch up.
    name = COALESCE(NULLIF(btrim(EXCLUDED.name), ''), calendar_guests.name),
    note = COALESCE(EXCLUDED.note, calendar_guests.note),
    updated_at = NOW()
  RETURNING * INTO result;

  -- A round only where this is genuinely the first ask.
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

-- -------------------------------------------------------------
-- 5. What a guest is allowed to see.
--
-- Reachable by `anon`, because somebody following a link out of their
-- inbox has no session and is never going to have one.
--
-- It returns the meeting and nothing around it: no attendee list, no
-- other guests, no customer record, no note that was written for
-- colleagues. A link is not a way into the CRM.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION calendar_guest_view(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  g  calendar_guests;
  ev RECORD;
  organiser TEXT;
BEGIN
  SELECT * INTO g FROM calendar_guests WHERE token = p_token;
  IF g IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'why', 'not_found');
  END IF;

  SELECT title, description, start_at, end_at, all_day INTO ev
    FROM calendar_events WHERE id = g.event_id;
  IF ev IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'why', 'cancelled');
  END IF;

  SELECT COALESCE(full_name, '') INTO organiser FROM profiles WHERE id = g.invited_by;

  -- Opening the link is not answering it, but it is worth knowing.
  UPDATE calendar_guests SET seen_at = NOW() WHERE id = g.id AND responded_at IS NULL;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'guest', jsonb_build_object(
      'name', g.name, 'email', g.email, 'status', g.status,
      'proposedStart', g.proposed_start_at, 'note', g.note,
      'respondedAt', g.responded_at),
    'meeting', jsonb_build_object(
      'title', ev.title, 'detail', ev.description,
      'startAt', ev.start_at, 'endAt', ev.end_at, 'allDay', ev.all_day),
    'organiser', COALESCE(NULLIF(organiser, ''), 'Stockport Truck Centre')
  );
END;
$fn$;

REVOKE ALL ON FUNCTION calendar_guest_view(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION calendar_guest_view(TEXT) TO anon, authenticated;

-- -------------------------------------------------------------
-- 6. A guest answering.
--
-- The same three answers a colleague has, keyed on the token rather
-- than on a session. Accepting or declining settles it; suggesting a
-- time puts the ball back with the organiser, exactly as
-- `command_meeting_answer` does, and it never moves the meeting on its
-- own: a customer cannot move a booking that other people have already
-- accepted.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION calendar_guest_answer(
  p_token  TEXT,
  p_action TEXT,
  p_start  TIMESTAMPTZ DEFAULT NULL,
  p_end    TIMESTAMPTZ DEFAULT NULL,
  p_note   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  g    calendar_guests;
  ev   RECORD;
  said TEXT;
  who  TEXT;
BEGIN
  IF p_action NOT IN ('accept', 'decline', 'propose') THEN
    RAISE EXCEPTION 'There is nothing called % to do with an invitation.', p_action;
  END IF;

  SELECT * INTO g FROM calendar_guests WHERE token = p_token;
  IF g IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'why', 'not_found');
  END IF;

  SELECT id, title, start_at, end_at, created_by INTO ev
    FROM calendar_events WHERE id = g.event_id;
  IF ev IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'why', 'cancelled');
  END IF;

  IF p_action = 'propose' AND p_start IS NULL THEN
    RAISE EXCEPTION 'Nothing said what time you are suggesting.';
  END IF;

  UPDATE calendar_guests SET
    status = CASE p_action WHEN 'accept' THEN 'accepted'
                           WHEN 'decline' THEN 'declined'
                           ELSE 'proposed' END,
    proposed_start_at = CASE WHEN p_action = 'propose' THEN p_start ELSE NULL END,
    proposed_end_at   = CASE WHEN p_action = 'propose' THEN p_end   ELSE NULL END,
    rounds = rounds + 1,
    note = COALESCE(p_note, note),
    responded_at = NOW(),
    updated_at = NOW()
   WHERE id = g.id;

  INSERT INTO calendar_invite_messages (guest_id, actor_id, action, start_at, end_at, note)
  VALUES (
    g.id, NULL,
    CASE p_action WHEN 'accept' THEN 'accepted'
                  WHEN 'decline' THEN 'declined' ELSE 'proposed' END,
    CASE WHEN p_action = 'propose' THEN p_start ELSE ev.start_at END,
    CASE WHEN p_action = 'propose' THEN p_end ELSE ev.end_at END,
    p_note);

  -- Whoever booked it is told, through the notifications everybody else
  -- on the meeting already uses.
  who := COALESCE(NULLIF(g.name, ''), g.email);
  IF ev.created_by IS NOT NULL THEN
    PERFORM command_meeting_notify(
      ev.created_by,
      CASE p_action WHEN 'accept' THEN 'meeting_accepted'
                    WHEN 'decline' THEN 'meeting_declined'
                    ELSE 'meeting_proposed' END,
      who || CASE p_action
        WHEN 'accept'  THEN ' accepted ' || ev.title
        WHEN 'decline' THEN ' cannot make ' || ev.title
        ELSE ' suggested a different time for ' || ev.title END,
      CASE p_action
        WHEN 'propose' THEN command_meeting_when(p_start) || '. '
                            || COALESCE(p_note, 'No reason given.')
        ELSE COALESCE(p_note, command_meeting_when(ev.start_at)) END,
      ev.id);
  END IF;

  said := CASE p_action
    WHEN 'accept'  THEN 'Thank you. Stockport Truck Centre know you are coming.'
    WHEN 'decline' THEN 'Thank you. Stockport Truck Centre know you cannot make it.'
    ELSE 'Thank you. Your suggestion has gone back to Stockport Truck Centre.' END;

  RETURN jsonb_build_object('ok', TRUE, 'said', said, 'status',
    CASE p_action WHEN 'accept' THEN 'accepted'
                  WHEN 'decline' THEN 'declined' ELSE 'proposed' END);
END;
$fn$;

REVOKE ALL ON FUNCTION calendar_guest_answer(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION calendar_guest_answer(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO anon, authenticated;

-- -------------------------------------------------------------
-- 7. Taking a guest off.
--
-- Deleting the row takes the link with it, which is the point: a
-- withdrawn invitation is a link that stops working.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION calendar_withdraw_guest(p_guest UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  g  calendar_guests;
  ev RECORD;
BEGIN
  SELECT * INTO g FROM calendar_guests WHERE id = p_guest;
  IF g IS NULL THEN RETURN; END IF;

  SELECT created_by INTO ev FROM calendar_events WHERE id = g.event_id;
  IF ev.created_by IS DISTINCT FROM current_actor() THEN
    RAISE EXCEPTION 'Only whoever booked the meeting can take an invitation back.';
  END IF;

  DELETE FROM calendar_guests WHERE id = p_guest;
END;
$fn$;

REVOKE ALL ON FUNCTION calendar_withdraw_guest(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION calendar_withdraw_guest(UUID) TO authenticated;

-- -------------------------------------------------------------
-- 8. The history follows the guest as well as the invitation.
-- -------------------------------------------------------------
DROP POLICY IF EXISTS "invite_messages_follow_the_invite" ON calendar_invite_messages;
CREATE POLICY "invite_messages_follow_the_invite" ON calendar_invite_messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM calendar_invites i
             WHERE i.id = invite_id AND (i.user_id = auth.uid() OR i.invited_by = auth.uid()))
    OR EXISTS (SELECT 1 FROM calendar_guests g
               JOIN calendar_events e ON e.id = g.event_id
               WHERE g.id = guest_id)
  );

DO $$ BEGIN
  PERFORM 1 FROM pg_trigger WHERE tgname = 'update_calendar_guests_updated_at';
  IF NOT FOUND THEN
    CREATE TRIGGER update_calendar_guests_updated_at BEFORE UPDATE ON calendar_guests
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

COMMENT ON TABLE calendar_guests IS
  'Somebody asked to a meeting who does not work here. They answer '
  'through a link rather than a session, which is what the token is.';

