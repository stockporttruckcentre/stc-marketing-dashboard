-- =============================================================
-- The diary, and the invitation conversation nothing had ever run.
--
-- Migration 006 added the invitation tables and migration 021 added the
-- operations over them, and until now no screen had called either. A
-- feature that has never been exercised is a feature nobody can say
-- works, so this exercises it end to end: booked, asked, countered,
-- agreed, moved.
--
-- Everything below the ROLE line runs as `authenticated`. That is not
-- decoration: `postgres` owns these tables and owners bypass row level
-- security, so a file that stays superuser would write every row it
-- claims to have blocked and report a stranger reading somebody's
-- private diary.
--
-- Run with `npm run check:diary`.
-- =============================================================
\set ON_ERROR_STOP on

BEGIN;

-- -------------------------------------------------------------
-- Four people. Legacy roles and no role template, because that is
-- every account in the live database.
-- -------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('ee000000-0000-0000-0000-000000000001', 'cal.alex@example.test'),
  ('ee000000-0000-0000-0000-000000000002', 'cal.tom@example.test'),
  ('ee000000-0000-0000-0000-000000000003', 'cal.dave@example.test'),
  ('ee000000-0000-0000-0000-000000000004', 'cal.viewer@example.test')
ON CONFLICT DO NOTHING;

UPDATE profiles SET role = 'admin',  role_template_id = NULL, full_name = 'Alex'
  WHERE id = 'ee000000-0000-0000-0000-000000000001';
UPDATE profiles SET role = 'sales',  role_template_id = NULL, full_name = 'Tom'
  WHERE id = 'ee000000-0000-0000-0000-000000000002';
UPDATE profiles SET role = 'sales',  role_template_id = NULL, full_name = 'Dave'
  WHERE id = 'ee000000-0000-0000-0000-000000000003';
UPDATE profiles SET role = 'viewer', role_template_id = NULL, full_name = 'Rama'
  WHERE id = 'ee000000-0000-0000-0000-000000000004';

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_who UUID) RETURNS VOID
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_who::TEXT, TRUE);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
END;
$fn$;

DO $$
BEGIN
  IF (SELECT count(*) FROM profiles WHERE id::TEXT LIKE 'ee000000-%') <> 4 THEN
    RAISE EXCEPTION 'fixture: expected four people, found %',
      (SELECT count(*) FROM profiles WHERE id::TEXT LIKE 'ee000000-%');
  END IF;
END $$;

SET LOCAL ROLE authenticated;

-- =============================================================
-- 1. Booking one.
--
-- The organiser is put on it inside the function rather than sent in,
-- which is what stops a client booking a meeting in somebody else's
-- diary.
-- =============================================================
DO $$
DECLARE made JSONB; ev UUID; owner UUID;
BEGIN
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000001');
  made := command_create_meeting('Site visit, Carrington',
    NOW() + INTERVAL '3 days', 60, NULL, 'private');
  ev := (made ->> 'id')::UUID;

  SELECT created_by INTO owner FROM calendar_events WHERE id = ev;
  IF owner <> 'ee000000-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'the meeting was booked in somebody else''s name';
  END IF;
  IF (made ->> 'minutes')::INT <> 60 THEN
    RAISE EXCEPTION 'the length did not stick: %', made ->> 'minutes';
  END IF;

  CREATE TEMP TABLE fixture_meeting ON COMMIT DROP AS SELECT ev AS id;
  GRANT SELECT ON fixture_meeting TO authenticated;
  RAISE NOTICE 'ok  a meeting is booked in the name of whoever booked it';
END $$;

-- A read only viewer cannot book anything.
DO $$
BEGIN
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000004');
  BEGIN
    PERFORM command_create_meeting('Should not exist', NOW() + INTERVAL '1 day', 30, NULL, 'private');
    RAISE EXCEPTION 'a read only viewer booked a meeting';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%crm.delegate%' THEN
      RAISE NOTICE 'ok  a viewer cannot book a meeting';
    ELSE
      RAISE;
    END IF;
  END;
END $$;

-- =============================================================
-- 2. Asking somebody.
-- =============================================================
DO $$
DECLARE ev UUID; sent JSONB; n INT;
BEGIN
  SELECT id INTO ev FROM fixture_meeting;

  /* Not the organiser, so not their meeting to invite anybody to.

     Refused twice over, and both are worth having. The meeting is
     private, so Dave cannot see it at all and the function finds
     nothing to invite anybody to. The named refusal is asserted
     separately below against a meeting he can see, because that is the
     branch that carries the rule rather than the row policy carrying
     it by accident. */
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000003');
  BEGIN
    PERFORM command_meeting_invite(ARRAY[ev], ARRAY['ee000000-0000-0000-0000-000000000002'::UUID], NULL);
    RAISE EXCEPTION 'somebody invited people to a meeting they cannot even see';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%nothing has been changed%' OR SQLERRM LIKE '%only whoever booked%' THEN
      RAISE NOTICE 'ok  a meeting somebody cannot see is not one they can invite to';
    ELSE
      RAISE;
    END IF;
  END;

  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000001');
  sent := command_meeting_invite(
    ARRAY[ev],
    ARRAY['ee000000-0000-0000-0000-000000000002'::UUID,
          'ee000000-0000-0000-0000-000000000003'::UUID],
    'Bring the trailer spec.');

  IF (sent ->> 'sent')::INT <> 2 THEN
    RAISE EXCEPTION 'expected two invitations, sent %', sent ->> 'sent';
  END IF;

  SELECT count(*) INTO n FROM calendar_invites
   WHERE event_id = ev AND status = 'pending' AND awaiting = user_id;
  IF n <> 2 THEN
    RAISE EXCEPTION 'expected two invitations waiting on the people asked, found %', n;
  END IF;

  SELECT count(*) INTO n FROM calendar_invite_messages m
    JOIN calendar_invites i ON i.id = m.invite_id
   WHERE i.event_id = ev AND m.action = 'invited';
  IF n <> 2 THEN
    RAISE EXCEPTION 'the asking was not written into the history: % rounds', n;
  END IF;

  RAISE NOTICE 'ok  two people are asked, and it is on both of them to answer';
END $$;

-- The named refusal, against a meeting the other person can see. This
-- is the rule itself rather than the row policy standing in for it.
DO $$
DECLARE made JSONB; ev UUID;
BEGIN
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000001');
  made := command_create_meeting('Handover, STC145505', NOW() + INTERVAL '7 days', 30, NULL, 'team');
  ev := (made ->> 'id')::UUID;

  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000003');
  BEGIN
    PERFORM command_meeting_invite(ARRAY[ev], ARRAY['ee000000-0000-0000-0000-000000000002'::UUID], NULL);
    RAISE EXCEPTION 'somebody invited people to a meeting they did not book';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%only whoever booked%' THEN
      RAISE NOTICE 'ok  only whoever booked a meeting can invite people to it';
    ELSE
      RAISE;
    END IF;
  END;
END $$;

-- =============================================================
-- 3. Being invited is a way into a private meeting.
--
-- Without this somebody gets a notification about a meeting they cannot
-- open, which is the fourth branch of the select policy in migration
-- 006 and the reason it exists.
-- =============================================================
DO $$
DECLARE ev UUID; n INT;
BEGIN
  SELECT id INTO ev FROM fixture_meeting;

  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');
  SELECT count(*) INTO n FROM calendar_events WHERE id = ev;
  IF n <> 1 THEN
    RAISE EXCEPTION 'somebody invited to a private meeting cannot see it';
  END IF;
  RAISE NOTICE 'ok  being invited lets you see the meeting';

  -- And somebody neither on it nor invited sees nothing.
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000004');
  SELECT count(*) INTO n FROM calendar_events WHERE id = ev;
  IF n <> 0 THEN
    RAISE EXCEPTION 'a private meeting is visible to somebody with nothing to do with it';
  END IF;
  SELECT count(*) INTO n FROM calendar_invites WHERE event_id = ev;
  IF n <> 0 THEN
    RAISE EXCEPTION 'somebody outside the meeting can read its invitations';
  END IF;
  RAISE NOTICE 'ok  and a private meeting stays private from everybody else';
END $$;

-- =============================================================
-- 4. Answering somebody else's invitation.
-- =============================================================
DO $$
DECLARE ev UUID; mine UUID;
BEGIN
  SELECT id INTO ev FROM fixture_meeting;
  SELECT id INTO mine FROM calendar_invites
   WHERE event_id = ev AND user_id = 'ee000000-0000-0000-0000-000000000002';

  /* Refused twice over again, and the outer one is the row policy:
     an invitation is visible only to the person asked and the person
     who asked, so Dave cannot even read Tom's to answer it. The
     function's own `not yours to answer` sits behind that as defence in
     depth rather than as the thing doing the work, so either message
     is the right answer here. */
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000003');
  BEGIN
    PERFORM command_meeting_answer(mine, 'accept', NULL, NULL, NULL);
    RAISE EXCEPTION 'somebody accepted an invitation that was not theirs';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%not yours to answer%' OR SQLERRM LIKE '%invitation is not there%' THEN
      RAISE NOTICE 'ok  an invitation is not answerable, or even readable, by a bystander';
    ELSE
      RAISE;
    END IF;
  END;
END $$;

-- Tom accepts his.
DO $$
DECLARE ev UUID; mine UUID; st TEXT; wait UUID;
BEGIN
  /* Act first, then read. Every one of these SELECTs runs under the row
     policy of whoever is currently set, and a block that reads before
     it acts is reading as the person the block before it left behind.
     That is how this file first reported Tom unable to find his own
     invitation. */
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');
  SELECT id INTO ev FROM fixture_meeting;
  SELECT id INTO mine FROM calendar_invites
   WHERE event_id = ev AND user_id = 'ee000000-0000-0000-0000-000000000002';

  PERFORM command_meeting_answer(mine, 'accept', NULL, NULL, NULL);

  SELECT status, awaiting INTO st, wait FROM calendar_invites WHERE id = mine;
  IF st <> 'accepted' OR wait IS NOT NULL THEN
    RAISE EXCEPTION 'accepting left it at % waiting on %', st, wait;
  END IF;
  RAISE NOTICE 'ok  accepting settles it and stops waiting on anybody';
END $$;

-- =============================================================
-- 5. Suggesting another time, and what it does NOT do.
--
-- The meeting stays where it is until somebody accepts. A proposal that
-- moved the meeting on its own would move it in the diary of everybody
-- who had already said yes, without asking any of them.
-- =============================================================
DO $$
DECLARE ev UUID; his UUID; was TIMESTAMPTZ; now_at TIMESTAMPTZ; st TEXT; wait UUID; r INT;
BEGIN
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000003');
  SELECT id INTO ev FROM fixture_meeting;
  SELECT start_at INTO was FROM calendar_events WHERE id = ev;
  SELECT id INTO his FROM calendar_invites
   WHERE event_id = ev AND user_id = 'ee000000-0000-0000-0000-000000000003';

  PERFORM command_meeting_answer(his, 'propose', was + INTERVAL '2 days',
    was + INTERVAL '2 days 1 hour', 'Thursday would be better.');

  SELECT status, awaiting, rounds INTO st, wait, r FROM calendar_invites WHERE id = his;
  IF st <> 'proposed' THEN
    RAISE EXCEPTION 'suggesting a time left the invitation at %', st;
  END IF;
  IF wait <> 'ee000000-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'the ball did not go back to the organiser, it is with %', wait;
  END IF;
  IF r < 1 THEN
    RAISE EXCEPTION 'the round was not counted';
  END IF;

  SELECT start_at INTO now_at FROM calendar_events WHERE id = ev;
  IF now_at <> was THEN
    RAISE EXCEPTION 'a suggestion moved the meeting on its own, from % to %', was, now_at;
  END IF;
  RAISE NOTICE 'ok  a suggestion goes back to the organiser and moves nothing';
END $$;

-- The organiser counters the counter, which is the same code again and
-- the thing that makes it a conversation rather than one question.
DO $$
DECLARE ev UUID; his UUID; wait UUID; r INT;
BEGIN
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000001');
  SELECT id INTO ev FROM fixture_meeting;
  SELECT id INTO his FROM calendar_invites
   WHERE event_id = ev AND user_id = 'ee000000-0000-0000-0000-000000000003';

  PERFORM command_meeting_answer(his, 'propose',
    (SELECT proposed_start_at FROM calendar_invites WHERE id = his) + INTERVAL '1 day',
    NULL, 'Friday, not Thursday.');

  SELECT awaiting, rounds INTO wait, r FROM calendar_invites WHERE id = his;
  IF wait <> 'ee000000-0000-0000-0000-000000000003' THEN
    RAISE EXCEPTION 'the ball did not come back, it is with %', wait;
  END IF;
  IF r < 2 THEN
    RAISE EXCEPTION 'the second round was not counted: %', r;
  END IF;
  RAISE NOTICE 'ok  it goes back and forth, and every round is counted';
END $$;

-- =============================================================
-- 6. Agreeing, which is the only thing that moves the meeting.
-- =============================================================
DO $$
DECLARE ev UUID; his UUID; agreed TIMESTAMPTZ; was TIMESTAMPTZ; now_at TIMESTAMPTZ; st TEXT; n INT;
BEGIN
  /* Dave accepts what the organiser last suggested. Accepting is
     accepting whatever time is on the table, which is why there is no
     separate verb for it. */
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000003');
  SELECT id INTO ev FROM fixture_meeting;
  SELECT start_at INTO was FROM calendar_events WHERE id = ev;
  SELECT id, proposed_start_at INTO his, agreed FROM calendar_invites
   WHERE event_id = ev AND user_id = 'ee000000-0000-0000-0000-000000000003';

  PERFORM command_meeting_answer(his, 'accept', NULL, NULL, NULL);

  SELECT status INTO st FROM calendar_invites WHERE id = his;
  IF st <> 'accepted' THEN
    RAISE EXCEPTION 'accepting left it at %', st;
  END IF;

  /* The invitee accepting does NOT move the meeting: the time on the
     table was the organiser's own, so there is nothing to move to. */
  SELECT start_at INTO now_at FROM calendar_events WHERE id = ev;
  IF now_at <> was THEN
    RAISE EXCEPTION 'the invitee accepting moved the meeting, from % to %', was, now_at;
  END IF;
  RAISE NOTICE 'ok  everybody has answered and the meeting is where it was';

  /* Counted as the organiser, who is on both sides of both
     invitations. Counted as Dave it comes to four, because the policy
     on the history follows the invitation and Tom's exchange is none of
     Dave's business. That is the policy working, not a gap: what the
     drawer shows somebody is their own thread plus, for the organiser,
     everybody's. */
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000001');
  SELECT count(*) INTO n FROM calendar_invite_messages m
    JOIN calendar_invites i ON i.id = m.invite_id
   WHERE i.event_id = ev;
  IF n < 6 THEN
    RAISE EXCEPTION 'the whole exchange is not on the record: % rounds', n;
  END IF;
  RAISE NOTICE 'ok  and how the time was arrived at is all there, % rounds', n;

  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000003');
  SELECT count(*) INTO n FROM calendar_invite_messages m
    JOIN calendar_invites i ON i.id = m.invite_id
   WHERE i.event_id = ev;
  IF n >= 6 THEN
    RAISE EXCEPTION 'one invitee can read the whole meeting''s exchange, including somebody else''s';
  END IF;
  RAISE NOTICE 'ok  and an invitee reads their own thread rather than everybody''s';
END $$;

-- The other direction: the organiser accepting a standing proposal is
-- what moves it, and that is the branch worth proving because it is the
-- one that changes other people's diaries.
DO $$
DECLARE made JSONB; ev UUID; inv UUID; want TIMESTAMPTZ; got TIMESTAMPTZ;
BEGIN
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000001');
  made := command_create_meeting('Call Wilsons', NOW() + INTERVAL '5 days', 30, NULL, 'team');
  ev := (made ->> 'id')::UUID;
  PERFORM command_meeting_invite(ARRAY[ev], ARRAY['ee000000-0000-0000-0000-000000000002'::UUID], NULL);

  SELECT id INTO inv FROM calendar_invites WHERE event_id = ev;
  want := (NOW() + INTERVAL '6 days')::TIMESTAMPTZ;

  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');
  PERFORM command_meeting_answer(inv, 'propose', want, want + INTERVAL '30 minutes', NULL);

  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000001');
  PERFORM command_meeting_answer(inv, 'accept', NULL, NULL, NULL);

  SELECT start_at INTO got FROM calendar_events WHERE id = ev;
  IF got <> want THEN
    RAISE EXCEPTION 'the organiser agreed and the meeting did not move: % rather than %', got, want;
  END IF;
  IF (SELECT proposed_start_at FROM calendar_invites WHERE id = inv) IS NOT NULL THEN
    RAISE EXCEPTION 'the agreed time is on the meeting and still on the invitation, so two copies disagree';
  END IF;
  RAISE NOTICE 'ok  the organiser agreeing is what moves the meeting, and it moves once';
END $$;

-- =============================================================
-- 7. Saying you cannot make it, and being taken off.
-- =============================================================
DO $$
DECLARE made JSONB; ev UUID; inv UUID; st TEXT; n INT;
BEGIN
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000001');
  made := command_create_meeting('Quarterly review', NOW() + INTERVAL '9 days', 60, NULL, 'team');
  ev := (made ->> 'id')::UUID;
  PERFORM command_meeting_invite(
    ARRAY[ev],
    ARRAY['ee000000-0000-0000-0000-000000000002'::UUID,
          'ee000000-0000-0000-0000-000000000003'::UUID], NULL);

  SELECT id INTO inv FROM calendar_invites
   WHERE event_id = ev AND user_id = 'ee000000-0000-0000-0000-000000000002';

  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');
  PERFORM command_meeting_answer(inv, 'decline', NULL, NULL, 'On leave that week.');

  SELECT status INTO st FROM calendar_invites WHERE id = inv;
  IF st <> 'declined' THEN
    RAISE EXCEPTION 'declining left it at %', st;
  END IF;
  IF (SELECT note FROM calendar_invites WHERE id = inv) IS NULL THEN
    RAISE EXCEPTION 'the reason was not kept';
  END IF;
  RAISE NOTICE 'ok  declining keeps the reason where the organiser can see it';

  -- Only the organiser can take an invitation back.
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000003');
  SELECT id INTO inv FROM calendar_invites
   WHERE event_id = ev AND user_id = 'ee000000-0000-0000-0000-000000000003';
  BEGIN
    PERFORM command_meeting_answer(inv, 'withdraw', NULL, NULL, NULL);
    RAISE EXCEPTION 'somebody withdrew their own invitation';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%only the organiser%' THEN
      RAISE NOTICE 'ok  only the organiser can take an invitation back';
    ELSE
      RAISE;
    END IF;
  END;

  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000001');
  PERFORM command_meeting_answer(inv, 'withdraw', NULL, NULL, 'Not needed after all.');
  SELECT count(*) INTO n FROM calendar_invites WHERE id = inv;
  IF n <> 0 THEN
    RAISE EXCEPTION 'the invitation is still there after being withdrawn';
  END IF;
  RAISE NOTICE 'ok  and withdrawing takes it off';
END $$;

-- =============================================================
-- 8. Moving one, which keeps its length.
--
-- Writing the start alone leaves a meeting that finishes before it
-- begins, which is what dragging a block across a calendar must never
-- produce.
-- =============================================================
DO $$
DECLARE made JSONB; ev UUID; was INTERVAL; now_len INTERVAL; want TIMESTAMPTZ;
BEGIN
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000001');
  made := command_create_meeting('PMI inspection, C123456', NOW() + INTERVAL '2 days', 90, NULL, 'team');
  ev := (made ->> 'id')::UUID;

  SELECT end_at - start_at INTO was FROM calendar_events WHERE id = ev;
  want := (NOW() + INTERVAL '4 days')::TIMESTAMPTZ;
  PERFORM command_reschedule_meeting(ARRAY[ev], want);

  SELECT end_at - start_at INTO now_len FROM calendar_events WHERE id = ev;
  IF now_len <> was THEN
    RAISE EXCEPTION 'moving it changed its length, from % to %', was, now_len;
  END IF;
  IF (SELECT start_at FROM calendar_events WHERE id = ev) <> want THEN
    RAISE EXCEPTION 'moving it did not move it';
  END IF;
  RAISE NOTICE 'ok  moving a meeting keeps its length';
END $$;

-- =============================================================
-- 9. Guests: somebody who does not work here.
--
-- Migration 062. The half that matters most is not that a guest can
-- answer, it is that a guest's link is worth exactly one thing. A
-- customer following a link out of their inbox must not be able to read
-- the diary, the CRM, or anybody else's invitation.
-- =============================================================
DO $$
DECLARE made JSONB; ev UUID; g calendar_guests; again calendar_guests;
BEGIN
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000001');
  made := command_create_meeting('Site visit with Dawson', NOW() + INTERVAL '11 days', 60, NULL, 'team');
  ev := (made ->> 'id')::UUID;

  g := calendar_invite_guest(ev, 'ops@dawsongroup.test', 'Julie Barnes', NULL, 'Bring the spec.');
  IF g.status <> 'pending' THEN
    RAISE EXCEPTION 'a guest starts at %', g.status;
  END IF;
  IF g.token IS NULL OR length(g.token) <> 64 THEN
    RAISE EXCEPTION 'the link token is % characters', COALESCE(length(g.token), 0);
  END IF;

  CREATE TEMP TABLE fixture_guest ON COMMIT DROP AS SELECT g.id AS id, g.token AS token, ev AS event_id;
  /* And to `anon`, because half the assertions below are run as the
     guest holding the link and they need to know which link it is.
     A scaffold inside a transaction that rolls back, not a grant on
     anything the product has. */
  GRANT SELECT ON fixture_guest TO authenticated, anon;
  RAISE NOTICE 'ok  a guest is asked, and the link is 64 characters of randomness';

  /* Asking the same address again is the same invitation, not a second.

     The token is compared off what the function returns rather than off
     the table, because the table no longer lets a signed in session
     read that column and this file runs as one. A composite a function
     returns is not subject to column privileges, which is exactly why
     the token comes back that way and nowhere else. */
  again := calendar_invite_guest(ev, 'OPS@DawsonGroup.test', 'Julie', NULL, NULL);
  IF (SELECT count(*) FROM calendar_guests WHERE event_id = ev) <> 1 THEN
    RAISE EXCEPTION 'the same address in a different case made a second guest';
  END IF;
  IF again.token <> g.token THEN
    RAISE EXCEPTION 'asking again changed the link, so the first email stopped working';
  END IF;
  IF again.id <> g.id THEN
    RAISE EXCEPTION 'asking again made a second guest row';
  END IF;
  RAISE NOTICE 'ok  the same address twice is one guest, and the link does not change';
END $$;

-- Only whoever booked it can ask a guest.
DO $$
DECLARE ev UUID;
BEGIN
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000003');
  SELECT event_id INTO ev FROM fixture_guest;
  BEGIN
    PERFORM calendar_invite_guest(ev, 'somebody@else.test', '', NULL, NULL);
    RAISE EXCEPTION 'somebody asked a guest to a meeting they did not book';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%Only whoever booked%' THEN
      RAISE NOTICE 'ok  only whoever booked a meeting can ask a guest to it';
    ELSE
      RAISE;
    END IF;
  END;
END $$;

-- A read only viewer cannot ask anybody.
DO $$
DECLARE ev UUID;
BEGIN
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000004');
  SELECT event_id INTO ev FROM fixture_guest;
  BEGIN
    PERFORM calendar_invite_guest(ev, 'nope@example.test', '', NULL, NULL);
    RAISE EXCEPTION 'a read only viewer asked a guest to a meeting';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%delegate permission%' OR SQLERRM LIKE '%Only whoever booked%' THEN
      RAISE NOTICE 'ok  a viewer cannot ask a guest';
    ELSE
      RAISE;
    END IF;
  END;
END $$;

/* The token is not readable by a signed in browser.

   Asserted because the first version of this migration granted SELECT
   on the table and then revoked the column, which does nothing at all:
   a table level grant covers every column, and Postgres accepts the
   revoke and changes nothing. It looked right in the file and was
   wrong in the database. */
DO $$
BEGIN
  IF has_column_privilege('authenticated', 'calendar_guests', 'token', 'SELECT') THEN
    RAISE EXCEPTION
      'a signed in browser can read the guest tokens, so it can answer anybody''s invitation';
  END IF;
  IF NOT has_column_privilege('authenticated', 'calendar_guests', 'status', 'SELECT') THEN
    RAISE EXCEPTION 'the guest list is not readable at all, so nobody can see who is coming';
  END IF;
  RAISE NOTICE 'ok  the link token cannot be read off the table, and the rest of it can';
END $$;

-- Everybody on the meeting sees the guest, not just whoever asked.
DO $$
DECLARE ev UUID; n INT;
BEGIN
  SELECT event_id INTO ev FROM fixture_guest;
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000003');
  SELECT count(*) INTO n FROM calendar_guests WHERE event_id = ev;
  IF n <> 1 THEN
    RAISE EXCEPTION 'a colleague on the meeting sees % of its guests', n;
  END IF;
  RAISE NOTICE 'ok  a guest is visible to everybody who can see the meeting';
END $$;

/* A name is enough, which is the commonest case by far and the one the
   whole thing is actually for: writing somebody down so the sales team
   can see who is in the meeting.

   No address, so no way to reach them and nothing to answer, and that
   is fine. What matters is that everybody looking at the meeting can
   see them. */
DO $$
DECLARE ev UUID; g calendar_guests; second calendar_guests; n INT;
BEGIN
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000001');
  SELECT event_id INTO ev FROM fixture_guest;

  g := calendar_invite_guest(ev, NULL, 'James from the IT company', NULL, NULL);
  IF g.email IS NOT NULL THEN
    RAISE EXCEPTION 'a name only guest was given an address';
  END IF;
  IF g.name <> 'James from the IT company' THEN
    RAISE EXCEPTION 'the name did not stick: %', g.name;
  END IF;
  IF g.status <> 'pending' THEN
    RAISE EXCEPTION 'a name only guest starts at %', g.status;
  END IF;
  RAISE NOTICE 'ok  somebody with no email address can be put on a meeting';

  -- And they need no customer. This is the case the ask named: a
  -- meeting with the IT company, who are not a CRM customer and should
  -- not have to become one.
  IF g.contact_id IS NOT NULL THEN
    RAISE EXCEPTION 'a guest was forced onto a customer record';
  END IF;
  RAISE NOTICE 'ok  and needs no customer record to hang off';

  /* Two people with no address are two people. Nothing here can tell
     whether two Waynes are the same Wayne, and quietly keeping one is a
     worse answer than keeping both where somebody can see it. */
  second := calendar_invite_guest(ev, NULL, 'James from the IT company', NULL, NULL);
  IF second.id = g.id THEN
    RAISE EXCEPTION 'the second one silently replaced the first';
  END IF;
  RAISE NOTICE 'ok  and two people with no address are two people';

  -- Everybody on the meeting sees them.
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000003');
  SELECT count(*) INTO n FROM calendar_guests
   WHERE event_id = ev AND email IS NULL;
  IF n <> 2 THEN
    RAISE EXCEPTION 'a colleague sees % of the two people with no address', n;
  END IF;
  RAISE NOTICE 'ok  and a colleague on the meeting sees them';

  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000001');
  PERFORM calendar_withdraw_guest(second.id);
END $$;

-- Neither a name nor an address is not a person.
DO $$
DECLARE ev UUID;
BEGIN
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000001');
  SELECT event_id INTO ev FROM fixture_guest;
  BEGIN
    PERFORM calendar_invite_guest(ev, '   ', '  ', NULL, NULL);
    RAISE EXCEPTION 'somebody with no name and no address went onto a meeting';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%name, or an email%' THEN
      RAISE NOTICE 'ok  and a blank one is refused';
    ELSE
      RAISE;
    END IF;
  END;
END $$;

-- =============================================================
-- 10. What the link is worth, which is one invitation and nothing else.
--
-- Run as `anon`, because that is who is holding it: somebody with no
-- account who followed a link out of their inbox.
-- =============================================================
RESET ROLE;
SET LOCAL ROLE anon;

DO $$
DECLARE t TEXT; seen JSONB;
BEGIN
  SELECT token INTO t FROM fixture_guest;

  seen := calendar_guest_view(t);
  IF NOT (seen ->> 'ok')::BOOLEAN THEN
    RAISE EXCEPTION 'the guest cannot open their own invitation: %', seen ->> 'why';
  END IF;
  IF seen -> 'meeting' ->> 'title' <> 'Site visit with Dawson' THEN
    RAISE EXCEPTION 'the invitation shows the wrong meeting';
  END IF;
  RAISE NOTICE 'ok  a guest can open their own invitation with no account';

  /* And nothing else. Not the diary, not the CRM, not the invitations.

     Refused outright rather than returning nothing, and that is worth
     saying: the select policy on `calendar_events` reads
     `calendar_invites`, which `anon` has no grant on at all, so the
     query does not get as far as being filtered. Either answer is the
     right one, so both count. */
  BEGIN
    IF (SELECT count(*) FROM calendar_events) <> 0 THEN
      RAISE EXCEPTION 'a guest can read the diary';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RAISE NOTICE 'ok  and cannot read the diary';
END $$;

DO $$
BEGIN
  BEGIN
    PERFORM count(*) FROM calendar_guests;
    IF (SELECT count(*) FROM calendar_guests) > 0 THEN
      RAISE EXCEPTION 'a guest can read the guest table, tokens and all';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;  -- refused outright, which is the stronger answer
  END;
  RAISE NOTICE 'ok  and cannot read the guests, which is where the tokens are';
END $$;

DO $$
BEGIN
  BEGIN
    PERFORM count(*) FROM crm_contacts;
    IF (SELECT count(*) FROM crm_contacts) > 0 THEN
      RAISE EXCEPTION 'a guest link reads the CRM';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RAISE NOTICE 'ok  and cannot read the CRM';
END $$;

-- A token that is not a token answers nothing.
DO $$
DECLARE said JSONB;
BEGIN
  said := calendar_guest_view(repeat('a', 64));
  IF (said ->> 'ok')::BOOLEAN THEN
    RAISE EXCEPTION 'a made up token opened an invitation';
  END IF;
  said := calendar_guest_answer(repeat('a', 64), 'accept', NULL, NULL, NULL);
  IF (said ->> 'ok')::BOOLEAN THEN
    RAISE EXCEPTION 'a made up token answered an invitation';
  END IF;
  RAISE NOTICE 'ok  a token nobody was given is worth nothing';
END $$;

-- =============================================================
-- 11. A guest answering, and what it does not move.
-- =============================================================
DO $$
DECLARE t TEXT; ev UUID; was TIMESTAMPTZ; said JSONB;
BEGIN
  SELECT token, event_id INTO t, ev FROM fixture_guest;

  said := calendar_guest_answer(t, 'accept', NULL, NULL, NULL);
  IF NOT (said ->> 'ok')::BOOLEAN OR said ->> 'status' <> 'accepted' THEN
    RAISE EXCEPTION 'accepting did not take: %', said;
  END IF;
  RAISE NOTICE 'ok  a guest accepts through the link';

  -- Suggesting a time never moves the meeting. A customer cannot move a
  -- booking other people have already accepted.
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000001');
  SELECT start_at INTO was FROM calendar_events WHERE id = ev;

  RESET ROLE;
  SET LOCAL ROLE anon;
  said := calendar_guest_answer(t, 'propose', was + INTERVAL '1 day', NULL, 'Thursday suits us.');
  IF said ->> 'status' <> 'proposed' THEN
    RAISE EXCEPTION 'suggesting a time left it at %', said ->> 'status';
  END IF;

  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000001');
  IF (SELECT start_at FROM calendar_events WHERE id = ev) <> was THEN
    RAISE EXCEPTION 'a guest moved the meeting on their own';
  END IF;
  RAISE NOTICE 'ok  a guest suggesting a time moves nothing on its own';

  -- And every round of it is on the record, in the same history as
  -- everybody else's.
  IF (SELECT count(*) FROM calendar_invite_messages m
       JOIN calendar_guests g ON g.id = m.guest_id
      WHERE g.event_id = ev) < 3 THEN
    RAISE EXCEPTION 'the guest exchange is not on the record';
  END IF;
  RAISE NOTICE 'ok  and every round of it is in the same history as everybody else''s';
END $$;

-- Whoever booked it was told.
DO $$
DECLARE n INT;
BEGIN
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000001');
  SELECT count(*) INTO n FROM notifications
   WHERE user_id = 'ee000000-0000-0000-0000-000000000001'
     AND kind IN ('meeting_accepted', 'meeting_proposed');
  IF n < 2 THEN
    RAISE EXCEPTION 'the organiser was not told what the guest said: % notifications', n;
  END IF;
  RAISE NOTICE 'ok  and the organiser is told, through the same notifications as everybody else';
END $$;

-- =============================================================
-- 12. Taking a guest off stops their link.
-- =============================================================
DO $$
DECLARE t TEXT; gid UUID; said JSONB;
BEGIN
  SELECT token, id INTO t, gid FROM fixture_guest;

  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000003');
  BEGIN
    PERFORM calendar_withdraw_guest(gid);
    RAISE EXCEPTION 'somebody took a guest off a meeting they did not book';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%Only whoever booked%' THEN
      RAISE NOTICE 'ok  only whoever booked it can take a guest off';
    ELSE
      RAISE;
    END IF;
  END;

  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000001');
  PERFORM calendar_withdraw_guest(gid);

  RESET ROLE;
  SET LOCAL ROLE anon;
  said := calendar_guest_view(t);
  IF (said ->> 'ok')::BOOLEAN THEN
    RAISE EXCEPTION 'a withdrawn invitation still opens';
  END IF;
  RAISE NOTICE 'ok  and a withdrawn invitation is a link that stops working';
END $$;

RESET ROLE;
SET LOCAL ROLE authenticated;

ROLLBACK;
