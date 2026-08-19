-- =============================================================
-- 024. Booking a meeting, and answering an invitation by naming it.
--
-- `app/api/command/execute` booked calls by inserting a calendar row
-- directly, with the title composed in the route and the attendee list
-- built there too. It was the second command runtime, and it is going
-- away. The operation itself is real and stays, here, where both the
-- calendar screen and a sentence can reach it.
--
-- WHAT THE SENTENCE CANNOT SAY.
--
-- Who is booking it, and that they are on it. Both come from the caller
-- inside the function, exactly as the composer's insert did, because a
-- client that chose its own `created_by` could book a meeting in
-- somebody else's diary.
--
-- ANSWERING BY NAMING THE MEETING.
--
-- Nobody refers to an invitation by anything but the meeting it is on.
-- `command_meeting_answer_for` takes the meeting and finds the caller's
-- own invitation on it, so "accept the invitation to Friday's site
-- visit" resolves the way a person means it. One invitation per person
-- per meeting is a UNIQUE constraint, so there is nothing to choose
-- between.
--
-- SECURITY INVOKER, gated on the capability the calendar screen gates
-- on. Answering an invitation somebody sent you is not a privilege and
-- asks for none: the function refuses an invitation that is not yours.
-- =============================================================

CREATE OR REPLACE FUNCTION command_create_meeting(
  p_title      TEXT,
  p_start      TIMESTAMPTZ,
  p_minutes    INTEGER DEFAULT NULL,
  p_contact    UUID    DEFAULT NULL,
  p_visibility TEXT    DEFAULT 'private'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  me      UUID := auth.uid();
  my_name TEXT;
  made    UUID;
  minutes INTEGER;
BEGIN
  IF NOT command_may('crm.delegate') THEN
    RAISE EXCEPTION 'you do not have crm.delegate';
  END IF;

  IF COALESCE(btrim(p_title), '') = '' THEN
    RAISE EXCEPTION 'a meeting with no title is not a meeting';
  END IF;
  IF p_start IS NULL THEN
    RAISE EXCEPTION 'nothing said when the meeting is';
  END IF;
  IF p_visibility NOT IN ('private', 'team', 'specific') THEN
    RAISE EXCEPTION 'there is no visibility called %', p_visibility;
  END IF;

  SELECT COALESCE(full_name, email) INTO my_name FROM profiles WHERE id = me;

  -- Half an hour, which is what the calendar has always booked when
  -- nobody says. A meeting with no end is a meeting nothing can lay out.
  minutes := GREATEST(COALESCE(p_minutes, 30), 1);

  INSERT INTO calendar_events (
    title, start_at, end_at, all_day, color, created_by,
    contact_id, attendees, visibility, visible_to
  ) VALUES (
    btrim(p_title), p_start, p_start + make_interval(mins => minutes), FALSE,
    '#cf2417', me, p_contact,
    jsonb_build_array(jsonb_build_object('user_id', me, 'name', COALESCE(my_name, 'Me'))),
    p_visibility, '{}'::UUID[]
  )
  RETURNING id INTO made;

  RETURN jsonb_build_object(
    'id', made, 'title', btrim(p_title), 'start', p_start, 'minutes', minutes);
END;
$$;

REVOKE ALL ON FUNCTION command_create_meeting(TEXT, TIMESTAMPTZ, INTEGER, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_create_meeting(TEXT, TIMESTAMPTZ, INTEGER, UUID, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- Answering the invitation on a meeting
-- -------------------------------------------------------------
--
-- The caller's own invitation, found from the meeting. Withdrawing is
-- the organiser's, and there may be several people to withdraw from, so
-- that one names whose invitation it is or takes the only one there is.
CREATE OR REPLACE FUNCTION command_meeting_answer_for(
  p_events UUID[],
  p_action TEXT,
  p_start  TIMESTAMPTZ DEFAULT NULL,
  p_end    TIMESTAMPTZ DEFAULT NULL,
  p_note   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  me      UUID := auth.uid();
  ev      UUID;
  invite  UUID;
  found   INTEGER;
  out     JSONB;
BEGIN
  IF COALESCE(array_length(p_events, 1), 0) <> 1 THEN
    RAISE EXCEPTION 'an invitation is answered on one meeting at a time';
  END IF;
  ev := p_events[1];

  IF p_action = 'withdraw' THEN
    SELECT COUNT(*) INTO found FROM calendar_invites
     WHERE event_id = ev AND invited_by = me;
    IF found = 0 THEN
      RAISE EXCEPTION 'there is no invitation of yours on that meeting';
    END IF;
    IF found > 1 THEN
      RAISE EXCEPTION
        'there are % invitations on that meeting, so it is not clear whose to take back', found;
    END IF;
    SELECT id INTO invite FROM calendar_invites
     WHERE event_id = ev AND invited_by = me;
  ELSE
    SELECT COUNT(*) INTO found FROM calendar_invites
     WHERE event_id = ev AND (user_id = me OR invited_by = me);
    IF found = 0 THEN
      RAISE EXCEPTION 'you have no invitation to that meeting';
    END IF;
    -- One standing position per person per meeting is a UNIQUE
    -- constraint, so being on it twice cannot happen. Being both the
    -- organiser and an invitee can, and the invitee side is the one
    -- being answered.
    SELECT id INTO invite FROM calendar_invites
     WHERE event_id = ev AND user_id = me;
    IF invite IS NULL THEN
      SELECT id INTO invite FROM calendar_invites
       WHERE event_id = ev AND invited_by = me;
      IF (SELECT COUNT(*) FROM calendar_invites WHERE event_id = ev AND invited_by = me) > 1 THEN
        RAISE EXCEPTION
          'there is more than one invitation on that meeting, so it is not clear which to answer';
      END IF;
    END IF;
  END IF;

  out := command_meeting_answer(invite, p_action, p_start, p_end, p_note);
  RETURN out;
END;
$$;

REVOKE ALL ON FUNCTION command_meeting_answer_for(UUID[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_meeting_answer_for(UUID[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- The dispatch learns booking and answering
-- -------------------------------------------------------------
--
-- The whole function is re-created because that is how a plpgsql
-- function changes. Everything except the two new branches is exactly
-- what migration 023 left, and this is the only copy that runs.
CREATE OR REPLACE FUNCTION command_invoke_one(
  p_capability TEXT,
  p_subjects   UUID[],
  p_args       JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  cap     TEXT := p_capability;
  args    JSONB := COALESCE(p_args, '{}'::JSONB);
  outcome JSONB;
  changed INTEGER := 0;
BEGIN
  IF cap = 'list.create' THEN
    outcome := command_create_list(args ->> 'name', p_subjects, NULL);
    changed := COALESCE((outcome ->> 'moved')::INTEGER, 0);

  ELSIF cap = 'list.add' THEN
    outcome := command_add_to_list(args ->> 'list', p_subjects);
    changed := COALESCE((outcome ->> 'moved')::INTEGER, 0);

  ELSIF cap = 'rows.share' THEN
    outcome := command_share_list(
      (args ->> 'list')::UUID,
      p_subjects,
      ARRAY(SELECT (jsonb_array_elements_text(COALESCE(args -> 'users', '[]'::JSONB)))::UUID),
      COALESCE((args ->> 'canEdit')::BOOLEAN, TRUE));
    changed := COALESCE((outcome ->> 'granted')::INTEGER, 0);

  ELSIF cap = 'record.attach' THEN
    outcome := command_attach_file(
      args ->> 'table',
      p_subjects[1],
      args ->> 'filename',
      args ->> 'mime',
      args ->> 'base64',
      args ->> 'describedAs');
    changed := 1;

  ELSIF cap = 'stock.sendToTracker' THEN
    outcome := command_send_from_stock(p_subjects, NULL);
    changed := COALESCE((outcome ->> 'made')::INTEGER, 0);

  ELSIF cap = 'crm.raiseProposal' THEN
    outcome := command_raise_proposal(p_subjects, args ->> 'kind', NULL);
    changed := COALESCE((outcome ->> 'made')::INTEGER, 0);

  ELSIF cap = 'rows.import' THEN
    outcome := command_import_contacts(args -> 'rows', args ->> 'list');
    changed := COALESCE((outcome ->> 'inserted')::INTEGER, 0);

  ELSIF cap = 'user.setRole' THEN
    outcome := command_set_role(p_subjects[1], args ->> 'role');
    changed := 1;

  ELSIF cap = 'meeting.create' THEN
    outcome := command_create_meeting(
      args ->> 'title',
      (args ->> 'start')::TIMESTAMPTZ,
      (args ->> 'minutes')::INTEGER,
      (args ->> 'contact')::UUID,
      COALESCE(args ->> 'visibility', 'private'));
    changed := 1;

  ELSIF cap = 'meeting.answer' THEN
    outcome := command_meeting_answer_for(
      p_subjects,
      args ->> 'action',
      (args ->> 'start')::TIMESTAMPTZ,
      (args ->> 'end')::TIMESTAMPTZ,
      args ->> 'note');
    changed := 1;

  ELSIF cap = 'meeting.reschedule' THEN
    outcome := command_reschedule_meeting(
      p_subjects, (args ->> 'start')::TIMESTAMPTZ, args ->> 'time');
    changed := COALESCE(array_length(p_subjects, 1), 0);

  ELSIF cap = 'meeting.invite' THEN
    outcome := command_meeting_invite(
      p_subjects,
      ARRAY(SELECT (jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(args -> 'who') = 'array' THEN args -> 'who'
             ELSE jsonb_build_array(args -> 'who') END))::UUID),
      args ->> 'note');
    changed := COALESCE((outcome ->> 'sent')::INTEGER, 0);

  ELSIF cap = 'post.create' THEN
    outcome := command_create_post(
      args ->> 'content',
      CASE WHEN args ->> 'platform' IS NULL THEN NULL
           ELSE string_to_array(args ->> 'platform', ',') END,
      (args ->> 'scheduledDate')::DATE,
      args ->> 'caption',
      NULL,
      NULL);
    changed := 1;

  ELSIF cap = 'deal.markSold' THEN
    outcome := command_mark_sold_many(
      p_subjects,
      COALESCE(args ->> 'repInitials', 'Unknown'),
      (args ->> 'salePrice')::NUMERIC,
      (args ->> 'dispatchDate')::DATE,
      (args ->> 'today')::DATE);
    changed := COALESCE(array_length(p_subjects, 1), 0);

  ELSE
    -- A capability the database does not perform stops whatever asked
    -- for it, before anything else in it has committed.
    RAISE EXCEPTION 'nothing in this database performs %', cap;
  END IF;

  RETURN jsonb_build_object('changed', changed, 'outcome', COALESCE(outcome, '{}'::JSONB));
END;
$$;

REVOKE ALL ON FUNCTION command_invoke_one(TEXT, UUID[], JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_invoke_one(TEXT, UUID[], JSONB) TO authenticated;
