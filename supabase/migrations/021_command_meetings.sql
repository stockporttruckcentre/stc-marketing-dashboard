-- =============================================================
-- 021. Meetings: inviting, answering, and moving one.
--
-- `app/api/calendar/invite` was three hundred lines of route body doing
-- five things: invite, accept, decline, propose, withdraw. Every one of
-- them is several writes that have to happen together, and every one of
-- them was reachable by clicking and by no sentence at all.
--
-- So the work moves here, once, and both callers use it: the route
-- through `lib/calendar/invitations.ts`, and the command bar through its
-- capability registry. That is the arrangement `command_send_from_stock`
-- already has, and it is why a lead raised from the tracker and a lead
-- raised by typing land in the same shape.
--
-- WHY IT IS SQL RATHER THAN SHARED TYPESCRIPT.
--
-- Answering an invitation writes the invite, appends a line to the
-- history, sometimes moves the event, and tells the other side. Issued
-- as separate PostgREST calls that is four transactions, and the third
-- failing leaves an invitation that says accepted against a meeting that
-- never moved. It also could not join a command programme's transaction
-- at all, so "move Friday's site visit to 2pm and export my diary"
-- could not be one commit.
--
-- MOVING A MEETING MOVES BOTH ENDS.
--
-- Writing start_at alone leaves a meeting that finishes before it
-- begins. The length is kept, which is what somebody dragging the block
-- across the calendar gets.
--
-- SECURITY INVOKER throughout, gated on the capability the calendar
-- screen gates on. Row level security still applies underneath: the
-- event policies decide who may change a meeting, and these functions
-- widen nothing.
-- =============================================================

-- -------------------------------------------------------------
-- Telling somebody
-- -------------------------------------------------------------
--
-- Best effort, exactly as the route was: a notifications table that is
-- not there, or a row that will not go in, must never stop a meeting
-- from being answered.
CREATE OR REPLACE FUNCTION command_meeting_notify(
  p_user  UUID,
  p_kind  TEXT,
  p_title TEXT,
  p_body  TEXT,
  p_event UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  BEGIN
    INSERT INTO notifications (user_id, kind, title, body, link_path)
    VALUES (p_user, p_kind, p_title, p_body,
            '/dashboard/calendar?event=' || p_event::TEXT);
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;
END;
$$;

REVOKE ALL ON FUNCTION command_meeting_notify(UUID, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_meeting_notify(UUID, TEXT, TEXT, TEXT, UUID) TO authenticated;

-- How a time reads in a notification. One place, so the invitation and
-- the notification never disagree about when the meeting is.
CREATE OR REPLACE FUNCTION command_meeting_when(p_at TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_at IS NULL THEN 'the time on the invitation'
    ELSE to_char(p_at, 'Dy DD Mon, HH24:MI')
  END;
$$;

-- -------------------------------------------------------------
-- Asking somebody to a meeting
-- -------------------------------------------------------------
--
-- Every person or none. Somebody who cannot be invited takes the whole
-- call with it rather than leaving the organiser to work out which two
-- of five were asked.
CREATE OR REPLACE FUNCTION command_meeting_invite(
  p_events UUID[],
  p_users  UUID[],
  p_note   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  ev      RECORD;
  person  UUID;
  invite  UUID;
  me      UUID := auth.uid();
  my_name TEXT;
  made    INTEGER := 0;
  wanted  INTEGER;
  first   UUID;
BEGIN
  IF NOT command_may('crm.delegate') THEN
    RAISE EXCEPTION 'you do not have crm.delegate';
  END IF;

  wanted := COALESCE(array_length(p_events, 1), 0) * COALESCE(array_length(p_users, 1), 0);
  IF wanted = 0 THEN
    RAISE EXCEPTION 'nothing said which meeting, or who to invite';
  END IF;

  SELECT COALESCE(full_name, email) INTO my_name FROM profiles WHERE id = me;

  FOR ev IN
    SELECT id, title, start_at, end_at, created_by
      FROM calendar_events WHERE id = ANY(p_events)
  LOOP
    -- Inviting somebody to a meeting is the organiser's call, which is
    -- the check the route made and the one the invite insert policy
    -- makes underneath.
    IF ev.created_by IS DISTINCT FROM me THEN
      RAISE EXCEPTION 'only whoever booked % can invite people to it', ev.title;
    END IF;

    FOREACH person IN ARRAY p_users LOOP
      INSERT INTO calendar_invites (
        event_id, user_id, invited_by, status, awaiting, note,
        proposed_start_at, proposed_end_at
      ) VALUES (
        ev.id, person, me, 'pending', person, p_note, NULL, NULL
      )
      ON CONFLICT (event_id, user_id) DO UPDATE SET
        status = 'pending', awaiting = EXCLUDED.user_id, note = EXCLUDED.note,
        proposed_start_at = NULL, proposed_end_at = NULL
      RETURNING id INTO invite;

      INSERT INTO calendar_invite_messages (invite_id, actor_id, action, start_at, end_at, note)
      VALUES (invite, me, 'invited', ev.start_at, ev.end_at, p_note);

      PERFORM command_meeting_notify(
        person, 'meeting_invited',
        COALESCE(my_name, 'Somebody') || ' invited you to ' || ev.title,
        command_meeting_when(ev.start_at) || '. Accept, decline, or suggest another time.',
        ev.id);

      made := made + 1;
      first := COALESCE(first, invite);
    END LOOP;
  END LOOP;

  IF made <> wanted THEN
    RAISE EXCEPTION
      'expected to send % invitations but sent %; nothing has been changed', wanted, made;
  END IF;

  RETURN jsonb_build_object('sent', made, 'inviteId', first);
END;
$$;

REVOKE ALL ON FUNCTION command_meeting_invite(UUID[], UUID[], TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_meeting_invite(UUID[], UUID[], TEXT) TO authenticated;

-- -------------------------------------------------------------
-- Answering one
-- -------------------------------------------------------------
--
-- Accept, decline, propose and withdraw are one function because they
-- are one shape: somebody acts, the standing changes, a line goes into
-- the history, and the other side is told. Accepting a proposal is not a
-- separate verb: whoever accepts is accepting whatever time is on the
-- table, and if that is a proposal the meeting moves to it.
CREATE OR REPLACE FUNCTION command_meeting_answer(
  p_invite UUID,
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
  inv        RECORD;
  ev         RECORD;
  me         UUID := auth.uid();
  my_name    TEXT;
  is_invitee BOOLEAN;
  is_host    BOOLEAN;
  other      UUID;
  moving_to  TIMESTAMPTZ;
  told       UUID;
  said       TEXT;
BEGIN
  IF p_action NOT IN ('accept', 'decline', 'propose', 'withdraw') THEN
    RAISE EXCEPTION 'there is nothing called % to do with an invitation', p_action;
  END IF;

  SELECT * INTO inv FROM calendar_invites WHERE id = p_invite;
  IF inv IS NULL THEN
    RAISE EXCEPTION 'that invitation is not there';
  END IF;

  SELECT id, title, start_at, end_at INTO ev
    FROM calendar_events WHERE id = inv.event_id;

  is_invitee := inv.user_id = me;
  is_host    := inv.invited_by = me;
  IF NOT is_invitee AND NOT is_host THEN
    RAISE EXCEPTION 'that invitation is not yours to answer';
  END IF;
  other := CASE WHEN is_invitee THEN inv.invited_by ELSE inv.user_id END;

  SELECT COALESCE(full_name, email) INTO my_name FROM profiles WHERE id = me;

  IF p_action = 'withdraw' THEN
    IF NOT is_host THEN
      RAISE EXCEPTION 'only the organiser can take an invitation back';
    END IF;
    INSERT INTO calendar_invite_messages (invite_id, actor_id, action, note)
    VALUES (inv.id, me, 'withdrawn', p_note);

    PERFORM command_meeting_notify(
      inv.user_id, 'meeting_cancelled',
      COALESCE(my_name, 'Somebody') || ' withdrew the invitation to '
        || COALESCE(ev.title, 'a meeting'),
      COALESCE(p_note, 'No longer needed.'), inv.event_id);

    DELETE FROM calendar_invites WHERE id = inv.id;
    RETURN jsonb_build_object('ok', TRUE, 'said', 'Invitation withdrawn.');
  END IF;

  IF p_action = 'accept' THEN
    moving_to := inv.proposed_start_at;

    -- The organiser accepting a counter proposal is what moves the
    -- meeting, and everybody else on it is told, because their diary
    -- just changed and nobody asked them.
    IF moving_to IS NOT NULL AND is_host THEN
      UPDATE calendar_events
         SET start_at = moving_to, end_at = inv.proposed_end_at
       WHERE id = inv.event_id;

      FOR told IN
        SELECT user_id FROM calendar_invites
         WHERE event_id = inv.event_id AND user_id <> inv.user_id
      LOOP
        PERFORM command_meeting_notify(
          told, 'meeting_moved', COALESCE(ev.title, 'A meeting') || ' moved',
          'Now ' || command_meeting_when(moving_to) || '.', inv.event_id);
      END LOOP;
    END IF;

    UPDATE calendar_invites SET
      status = 'accepted', awaiting = NULL,
      proposed_start_at = NULL, proposed_end_at = NULL,
      responded_at = NOW(), note = p_note
     WHERE id = inv.id;

    INSERT INTO calendar_invite_messages (invite_id, actor_id, action, start_at, note)
    VALUES (inv.id, me, 'accepted', COALESCE(moving_to, ev.start_at), p_note);

    PERFORM command_meeting_notify(
      other, 'meeting_accepted',
      COALESCE(my_name, 'Somebody') || ' accepted ' || COALESCE(ev.title, 'the meeting'),
      CASE WHEN moving_to IS NULL THEN command_meeting_when(ev.start_at)
           ELSE 'Moved to ' || command_meeting_when(moving_to) || '.' END,
      inv.event_id);

    said := CASE WHEN moving_to IS NOT NULL AND is_host
      THEN 'Agreed. The meeting has moved to ' || command_meeting_when(moving_to) || '.'
      ELSE 'Accepted. It is in your diary.' END;
    RETURN jsonb_build_object('ok', TRUE, 'said', said, 'movedTo', moving_to);
  END IF;

  IF p_action = 'decline' THEN
    UPDATE calendar_invites SET
      status = 'declined', awaiting = NULL, responded_at = NOW(), note = p_note
     WHERE id = inv.id;

    INSERT INTO calendar_invite_messages (invite_id, actor_id, action, note)
    VALUES (inv.id, me, 'declined', p_note);

    PERFORM command_meeting_notify(
      other, 'meeting_declined',
      COALESCE(my_name, 'Somebody') || ' cannot make ' || COALESCE(ev.title, 'the meeting'),
      COALESCE(p_note, 'No reason given.'), inv.event_id);

    RETURN jsonb_build_object('ok', TRUE, 'said', 'Declined. They can see it on the meeting.');
  END IF;

  -- propose. The ball changes hands, which is the same code whether the
  -- invitee is countering the invitation or the organiser is countering
  -- the counter. That is what lets it go back and forth.
  IF p_start IS NULL THEN
    RAISE EXCEPTION 'nothing said what time you are suggesting';
  END IF;

  UPDATE calendar_invites SET
    status = 'proposed', proposed_start_at = p_start, proposed_end_at = p_end,
    awaiting = other, rounds = COALESCE(rounds, 0) + 1,
    responded_at = NOW(), note = p_note
   WHERE id = inv.id;

  INSERT INTO calendar_invite_messages (invite_id, actor_id, action, start_at, end_at, note)
  VALUES (inv.id, me, 'proposed', p_start, p_end, p_note);

  PERFORM command_meeting_notify(
    other, 'meeting_proposed',
    COALESCE(my_name, 'Somebody') || ' suggested a different time for '
      || COALESCE(ev.title, 'a meeting'),
    command_meeting_when(p_start) || '. Accept it, decline it, or suggest another.',
    inv.event_id);

  RETURN jsonb_build_object(
    'ok', TRUE,
    'said', 'Suggested ' || command_meeting_when(p_start) || '. It is with them now.');
END;
$$;

REVOKE ALL ON FUNCTION command_meeting_answer(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_meeting_answer(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- Moving one
-- -------------------------------------------------------------
--
-- The length is kept. Everybody on the meeting is told, because their
-- diary has changed and nobody asked them.
CREATE OR REPLACE FUNCTION command_reschedule_meeting(
  p_events UUID[],
  p_start  TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  ev      RECORD;
  told    UUID;
  moved   INTEGER := 0;
  wanted  INTEGER;
  results JSONB := '[]'::JSONB;
  length  INTERVAL;
BEGIN
  IF NOT command_may('crm.delegate') THEN
    RAISE EXCEPTION 'you do not have crm.delegate';
  END IF;

  wanted := COALESCE(array_length(p_events, 1), 0);
  IF wanted = 0 THEN
    RAISE EXCEPTION 'nothing said which meeting to move';
  END IF;
  IF p_start IS NULL THEN
    RAISE EXCEPTION 'nothing said what time to move it to';
  END IF;

  FOR ev IN
    SELECT id, title, start_at, end_at FROM calendar_events WHERE id = ANY(p_events)
  LOOP
    IF ev.start_at = p_start THEN
      RAISE EXCEPTION '% is already at %', ev.title, command_meeting_when(p_start);
    END IF;

    length := CASE WHEN ev.end_at IS NULL THEN NULL ELSE ev.end_at - ev.start_at END;

    UPDATE calendar_events
       SET start_at = p_start,
           end_at = CASE WHEN length IS NULL THEN NULL ELSE p_start + length END
     WHERE id = ev.id;

    FOR told IN SELECT user_id FROM calendar_invites WHERE event_id = ev.id LOOP
      PERFORM command_meeting_notify(
        told, 'meeting_moved', ev.title || ' moved',
        'Now ' || command_meeting_when(p_start) || '.', ev.id);
    END LOOP;

    -- What it was and what it is, in the shape every other operation
    -- reports a before and an after, so the outcome can say so without
    -- knowing what a meeting is.
    results := results || jsonb_build_object(
      'name', ev.title,
      'was', command_meeting_when(ev.start_at),
      'now', command_meeting_when(p_start));

    moved := moved + 1;
  END LOOP;

  IF moved <> wanted THEN
    RAISE EXCEPTION
      'expected to move % meetings but moved %; nothing has been changed', wanted, moved;
  END IF;

  RETURN results;
END;
$$;

REVOKE ALL ON FUNCTION command_reschedule_meeting(UUID[], TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_reschedule_meeting(UUID[], TIMESTAMPTZ) TO authenticated;

-- -------------------------------------------------------------
-- One place that knows which function performs which capability
-- -------------------------------------------------------------
--
-- `command_perform` carried this as an if chain in the middle of its
-- loop, so adding an operation meant re-creating the whole programme
-- runner to change six lines in the middle of it. The dispatch comes out
-- into its own function: the runner now knows about steps and ordering,
-- and this knows about capabilities.
--
-- The `changed` count comes back with the outcome rather than being
-- worked out by the caller, because how many records an operation
-- touched is something the operation knows and the runner does not.
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

  ELSIF cap = 'user.setRole' THEN
    outcome := command_set_role(p_subjects[1], args ->> 'role');
    changed := 1;

  ELSIF cap = 'meeting.reschedule' THEN
    outcome := command_reschedule_meeting(p_subjects, (args ->> 'start')::TIMESTAMPTZ);
    changed := COALESCE(array_length(p_subjects, 1), 0);

  ELSIF cap = 'meeting.invite' THEN
    outcome := command_meeting_invite(
      p_subjects,
      ARRAY(SELECT (jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(args -> 'who') = 'array' THEN args -> 'who'
             ELSE jsonb_build_array(args -> 'who') END))::UUID),
      args ->> 'note');
    changed := COALESCE((outcome ->> 'sent')::INTEGER, 0);

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

-- -------------------------------------------------------------
-- The programme runner, over that dispatch
-- -------------------------------------------------------------
--
-- Unchanged in every respect except that the if chain is gone. One
-- transaction, in order, references between steps resolved as it goes.
CREATE OR REPLACE FUNCTION command_perform(p_steps JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  step      JSONB;
  kind      TEXT;
  subjects  UUID[];
  args      JSONB;
  results   JSONB := '[]'::JSONB;
  outcome   JSONB;
  performed JSONB;
  changed   INTEGER := 0;
  affected  INTEGER;
BEGIN
  IF p_steps IS NULL OR jsonb_typeof(p_steps) <> 'array' THEN
    RAISE EXCEPTION 'command_perform expects an array of steps';
  END IF;
  IF jsonb_array_length(p_steps) = 0 THEN
    RAISE EXCEPTION 'command_perform was given nothing to do';
  END IF;

  FOR step IN SELECT * FROM jsonb_array_elements(p_steps)
  LOOP
    kind := step ->> 'op';

    IF kind = 'changes' THEN
      affected := command_apply(step -> 'changes');
      changed  := changed + affected;
      outcome  := jsonb_build_object('changed', affected);

    ELSIF kind = 'invoke' THEN
      args     := COALESCE(command_resolve_ref(step -> 'args', results), '{}'::JSONB);
      subjects := ARRAY(
        SELECT (jsonb_array_elements_text(
          COALESCE(command_resolve_ref(step -> 'subjects', results), '[]'::JSONB)))::UUID
      );

      performed := command_invoke_one(step ->> 'capability', subjects, args);
      changed   := changed + COALESCE((performed ->> 'changed')::INTEGER, 0);
      outcome   := performed -> 'outcome';

    ELSE
      RAISE EXCEPTION 'a step must be a change set or an operation, not %', COALESCE(kind, 'nothing');
    END IF;

    results := results || jsonb_build_array(COALESCE(outcome, '{}'::JSONB));
  END LOOP;

  RETURN jsonb_build_object('changed', changed, 'results', results);
END;
$$;

REVOKE ALL ON FUNCTION command_perform(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_perform(JSONB) TO authenticated;
