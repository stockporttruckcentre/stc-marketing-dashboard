-- =============================================================
-- Notifications: what gets said, to whom, and what stays quiet.
--
-- The bell has been a button with no click handler since migration 001.
-- Everything under it is new, which means none of it has ever run, and
-- a feature nobody has exercised is a feature nobody can say works.
--
-- Two halves, and the second is the one that matters more.
--
-- The first is that things get said: an invitation raises one, a
-- contract accepted books four renewal reminders, a meeting moving
-- tells everybody who had accepted it.
--
-- The second is that things stay quiet. Somebody's own doing is not
-- news. A preference turned off means nothing is written at all rather
-- than something written and hidden. A capability somebody does not
-- hold means a notification they can do nothing about never exists.
-- Those are the assertions that keep the bell worth looking at, and
-- they are the ones that rot silently, because nothing visibly breaks
-- when a notification is raised that should not have been. It just gets
-- a bit noisier every month until nobody reads it.
--
-- Everything below the ROLE line runs as `authenticated`. That is not
-- decoration: `postgres` owns these tables and an owner bypasses row
-- level security, so a file that stayed superuser would report a
-- browser happily writing itself a notification saying its role had
-- changed.
--
-- Run with `npm run check:notify`.
-- =============================================================
\set ON_ERROR_STOP on

BEGIN;

-- -------------------------------------------------------------
-- Five people, on legacy roles with no template, because that is
-- every account in the live database.
-- -------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('cc000000-0000-0000-0000-000000000001', 'n.alex@example.test'),
  ('cc000000-0000-0000-0000-000000000002', 'n.tom@example.test'),
  ('cc000000-0000-0000-0000-000000000003', 'n.dean@example.test'),
  ('cc000000-0000-0000-0000-000000000004', 'n.rama@example.test'),
  ('cc000000-0000-0000-0000-000000000005', 'n.gareth@example.test')
ON CONFLICT DO NOTHING;

UPDATE profiles SET role='admin',  role_template_id=NULL, full_name='Alex Ellis'
  WHERE id='cc000000-0000-0000-0000-000000000001';
UPDATE profiles SET role='sales',  role_template_id=NULL, full_name='Tom Moore'
  WHERE id='cc000000-0000-0000-0000-000000000002';
UPDATE profiles SET role='sales',  role_template_id=NULL, full_name='Dean Mann'
  WHERE id='cc000000-0000-0000-0000-000000000003';
UPDATE profiles SET role='marketer', role_template_id=NULL, full_name='Rama Patel'
  WHERE id='cc000000-0000-0000-0000-000000000004';
UPDATE profiles SET role='viewer', role_template_id=NULL, full_name='Gareth Wood'
  WHERE id='cc000000-0000-0000-0000-000000000005';

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_who UUID) RETURNS VOID
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_who::TEXT, TRUE);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
END;
$fn$;

/* What somebody was told, read from outside row level security.
 
   SECURITY DEFINER on purpose, and it is worth being clear why, because
   the rest of this file goes to some trouble to run as `authenticated`.
 
   These two answer the question "was this written", which is about the
   database and not about who can see it. Asked as the sender they would
   return nothing, because a person cannot read somebody else's
   notifications, which is correct and is exactly what makes them the
   wrong tool for the question. The first draft of this file did ask as
   the sender, and every assertion about a notification existing passed
   by reading zero rows.
 
   Whether the recipient can see their own is a different question and
   is asserted separately, through `notification_feed`, as them. */
CREATE OR REPLACE FUNCTION pg_temp.said(p_who UUID, p_kind TEXT DEFAULT NULL)
RETURNS BIGINT LANGUAGE sql SECURITY DEFINER AS $fn$
  SELECT count(*) FROM public.notifications
   WHERE user_id = p_who
     AND (p_kind IS NULL OR kind = p_kind)
     AND dismissed_at IS NULL
$fn$;

/* Every notification somebody has, for the assertions that need more
   than a count. Same reasoning as `said` above. */
CREATE OR REPLACE FUNCTION pg_temp.rows_for(p_who UUID, p_kind TEXT DEFAULT NULL)
RETURNS SETOF public.notifications LANGUAGE sql SECURITY DEFINER AS $fn$
  SELECT * FROM public.notifications
   WHERE user_id = p_who
     AND (p_kind IS NULL OR kind = p_kind)
     AND dismissed_at IS NULL
$fn$;

/* Clearing between sections. A DELETE run as `authenticated` reaches
   only the caller's own rows, so a section that tidied up as the sender
   would leave the next section counting the last one's leftovers. */
CREATE OR REPLACE FUNCTION pg_temp.wipe() RETURNS VOID
LANGUAGE sql SECURITY DEFINER AS $fn$
  DELETE FROM public.notifications WHERE user_id::TEXT LIKE 'cc000000-%'
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.one(p_who UUID, p_kind TEXT DEFAULT NULL)
RETURNS public.notifications LANGUAGE sql SECURITY DEFINER AS $fn$
  SELECT * FROM public.notifications
   WHERE user_id = p_who
     AND (p_kind IS NULL OR kind = p_kind)
     AND dismissed_at IS NULL
   ORDER BY updated_at DESC
   LIMIT 1
$fn$;

DO $$
BEGIN
  IF (SELECT count(*) FROM profiles WHERE id::TEXT LIKE 'cc000000-%') <> 5 THEN
    RAISE EXCEPTION 'fixture: expected five people, found %',
      (SELECT count(*) FROM profiles WHERE id::TEXT LIKE 'cc000000-%');
  END IF;
  IF (SELECT count(*) FROM notification_kinds) < 30 THEN
    RAISE EXCEPTION 'fixture: the catalogue is not seeded, so this tests nothing';
  END IF;
END $$;

-- Nothing from before this file.
DELETE FROM notifications WHERE user_id::TEXT LIKE 'cc000000-%';

SET LOCAL ROLE authenticated;


-- =============================================================
-- 1. Bunching, which is the thing the brief is most specific about.
--
--   select one row and assign it   as much detail about the one as fits
--   select two and assign them     one notification saying two, with
--                                  both of them in it and a way to
--                                  open the pair
-- =============================================================
DO $$
DECLARE got notifications;
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');

  PERFORM notify('cc000000-0000-0000-0000-000000000003', 'crm.account_assigned',
    'Dawson Group is yours', 'Carrington, 12 vehicles', '/dashboard/crm?id=1',
    'cc000000-0000-0000-0000-000000000001', 'account', NULL,
    '{"allLink": "/dashboard/crm?owner=me"}'::JSONB, 'assign:alex');

  got := pg_temp.one('cc000000-0000-0000-0000-000000000003');

  IF got.item_count <> 1 THEN
    RAISE EXCEPTION 'one assignment made a bunch of %', got.item_count;
  END IF;
  IF got.title <> 'Dawson Group is yours' THEN
    RAISE EXCEPTION 'one assignment lost its title: %', got.title;
  END IF;
  IF got.body IS NULL THEN
    RAISE EXCEPTION 'one assignment lost the detail, which is the whole point of a single';
  END IF;
  RAISE NOTICE 'ok  one account assigned says which account, and everything known about it';
END $$;

DO $$
DECLARE got notifications;
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');

  PERFORM notify('cc000000-0000-0000-0000-000000000003', 'crm.account_assigned',
    'Stobart is yours', 'Warrington, 4 vehicles', '/dashboard/crm?id=2',
    'cc000000-0000-0000-0000-000000000001', 'account', NULL,
    '{"allLink": "/dashboard/crm?owner=me"}'::JSONB, 'assign:alex');

  IF pg_temp.said('cc000000-0000-0000-0000-000000000003') <> 1 THEN
    RAISE EXCEPTION 'two assignments in one breath made % notifications',
      pg_temp.said('cc000000-0000-0000-0000-000000000003');
  END IF;

  got := pg_temp.one('cc000000-0000-0000-0000-000000000003');

  IF got.item_count <> 2 THEN
    RAISE EXCEPTION 'the bunch says % rather than 2', got.item_count;
  END IF;
  IF got.title <> '2 accounts were assigned to you' THEN
    RAISE EXCEPTION 'the bunch reads "%"', got.title;
  END IF;
  /* The first one to arrive was written as an ordinary single and is
     not in the list unless the bunch seeds itself from the row. A count
     of two over a list of one is a notification contradicting itself. */
  IF jsonb_array_length(got.payload -> 'items') <> 2 THEN
    RAISE EXCEPTION 'the bunch says 2 and lists %',
      jsonb_array_length(got.payload -> 'items');
  END IF;
  IF got.link_path <> '/dashboard/crm?owner=me' THEN
    RAISE EXCEPTION 'the bunch still points at whichever one was first: %', got.link_path;
  END IF;
  RAISE NOTICE 'ok  two assigned at once is one notification saying two, listing both, opening both';
END $$;

-- A third joins the same one.
DO $$
DECLARE n INT;
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');
  PERFORM notify('cc000000-0000-0000-0000-000000000003', 'crm.account_assigned',
    'Wincanton is yours', NULL, '/dashboard/crm?id=3',
    'cc000000-0000-0000-0000-000000000001', 'account', NULL, '{}'::JSONB, 'assign:alex');

  n := (pg_temp.one('cc000000-0000-0000-0000-000000000003')).item_count;
  IF n <> 3 THEN RAISE EXCEPTION 'the third did not join: %', n; END IF;
  RAISE NOTICE 'ok  and a third joins the same one rather than starting another';
END $$;

/* Two different people handing Dean something in the same ten minutes
   are two notifications, not one. They are two separate conversations
   he is about to have, and squashing them loses which. */
DO $$
DECLARE n INT;
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000002');
  PERFORM notify('cc000000-0000-0000-0000-000000000003', 'crm.account_assigned',
    'Eddie Stobart is yours', NULL, '/dashboard/crm?id=4',
    'cc000000-0000-0000-0000-000000000002', 'account', NULL, '{}'::JSONB, 'assign:tom');

  n := pg_temp.said('cc000000-0000-0000-0000-000000000003');
  IF n <> 2 THEN
    RAISE EXCEPTION 'two different people assigning made % notifications rather than 2', n;
  END IF;
  RAISE NOTICE 'ok  but two different people assigning are two notifications, not one bunch';
END $$;

/* And a bunch never joins something already read. Adding to a
   notification somebody has dealt with means they never see the
   addition. */
DO $$
DECLARE n INT;
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000003');
  PERFORM notification_read_all('personal');

  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');
  PERFORM notify('cc000000-0000-0000-0000-000000000003', 'crm.account_assigned',
    'Culina is yours', NULL, '/dashboard/crm?id=5',
    'cc000000-0000-0000-0000-000000000001', 'account', NULL, '{}'::JSONB, 'assign:alex');

  n := pg_temp.said('cc000000-0000-0000-0000-000000000003');
  IF n <> 3 THEN
    RAISE EXCEPTION 'a new one joined a notification that had already been read';
  END IF;
  RAISE NOTICE 'ok  and nothing joins one that has already been read';
END $$;

SELECT pg_temp.wipe();


-- =============================================================
-- 2. What stays quiet.
-- =============================================================

-- Your own doing is not news.
DO $$
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');
  PERFORM notify('cc000000-0000-0000-0000-000000000001', 'crm.account_assigned',
    'You gave yourself Dawson', NULL, NULL,
    'cc000000-0000-0000-0000-000000000001');

  IF pg_temp.said('cc000000-0000-0000-0000-000000000001') <> 0 THEN
    RAISE EXCEPTION 'somebody was told about something they did themselves';
  END IF;
  RAISE NOTICE 'ok  nobody is told about their own doing';
END $$;

/* Except where the doing and the finishing are minutes apart and
   somewhere else. An import is the case this exists for: you start it,
   the tab is somewhere else by the time it lands, and being told is the
   point. */
DO $$
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');
  PERFORM notify('cc000000-0000-0000-0000-000000000001', 'crm.import_finished',
    'Your import put 1,284 customers in', NULL, NULL,
    'cc000000-0000-0000-0000-000000000001');

  IF pg_temp.said('cc000000-0000-0000-0000-000000000001', 'crm.import_finished') <> 1 THEN
    RAISE EXCEPTION 'an import finishing did not reach the person who started it';
  END IF;
  RAISE NOTICE 'ok  except an import finishing, which reaches whoever started it';
END $$;

-- A preference turned off writes nothing at all.
DO $$
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000002');
  PERFORM notification_choose('crm.account_assigned', FALSE);

  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');
  PERFORM notify('cc000000-0000-0000-0000-000000000002', 'crm.account_assigned',
    'Dawson is yours', NULL, NULL, 'cc000000-0000-0000-0000-000000000001');

  IF pg_temp.said('cc000000-0000-0000-0000-000000000002', 'crm.account_assigned') <> 0 THEN
    RAISE EXCEPTION 'a notification somebody turned off was written anyway';
  END IF;
  RAISE NOTICE 'ok  a preference turned off writes nothing, rather than writing it and hiding it';
END $$;

-- A capability somebody does not hold means it never exists.
DO $$
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');

  /* Gareth is a read only viewer and holds no social.approve, so a
     post waiting for approval is not his problem and never appears. */
  PERFORM notify_capability('social.approve', 'content.review_requested',
    'Rama has put a post up for approval', NULL, NULL,
    'cc000000-0000-0000-0000-000000000004');

  IF pg_temp.said('cc000000-0000-0000-0000-000000000005', 'content.review_requested') <> 0 THEN
    RAISE EXCEPTION 'a viewer was asked to approve a post';
  END IF;
  IF pg_temp.said('cc000000-0000-0000-0000-000000000001', 'content.review_requested') <> 1 THEN
    RAISE EXCEPTION 'nobody who can approve posts was told about one';
  END IF;
  RAISE NOTICE 'ok  a post waiting for approval reaches whoever can approve it, and nobody else';
END $$;

-- The two that cannot be silenced.
DO $$
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000002');
  BEGIN
    PERFORM notification_choose('admin.role_changed', FALSE);
    RAISE EXCEPTION 'a role change was allowed to be turned off';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%was allowed to be turned off%' THEN RAISE; END IF;
  END;

  -- And a blanket mute does not reach it either.
  PERFORM notification_settings_set(NULL, NULL, NULL, NOW() + INTERVAL '1 day', FALSE);

  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');
  PERFORM notify('cc000000-0000-0000-0000-000000000002', 'admin.role_changed',
    'You are now an administrator', NULL, NULL, 'cc000000-0000-0000-0000-000000000001');
  PERFORM notify('cc000000-0000-0000-0000-000000000002', 'crm.lead_assigned',
    'A prospect is on your tracker', NULL, NULL, 'cc000000-0000-0000-0000-000000000001');

  IF pg_temp.said('cc000000-0000-0000-0000-000000000002', 'admin.role_changed') <> 1 THEN
    RAISE EXCEPTION 'a mute silenced a role change, which nobody may silence';
  END IF;
  IF pg_temp.said('cc000000-0000-0000-0000-000000000002', 'crm.lead_assigned') <> 0 THEN
    RAISE EXCEPTION 'a mute did not silence an ordinary notification';
  END IF;
  RAISE NOTICE 'ok  a mute stops everything except the ones nobody may turn off';
END $$;

-- Put the mute back before anything below reads Tom's bell.
DO $$
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000002');
  PERFORM notification_settings_set(NULL, NULL, NULL, NULL, TRUE);
  PERFORM notification_choose('crm.account_assigned', TRUE);
END $$;

SELECT pg_temp.wipe();


-- =============================================================
-- 3. Quiet hours.
--
-- Something that is not urgent, arriving at half past ten at night,
-- waits until morning. It is written, so nothing is lost: it simply
-- has a time it becomes visible, and the feed does not return it
-- before then.
-- =============================================================
DO $$
DECLARE due TIMESTAMPTZ; live BIGINT;
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000003');
  /* Quiet all day, so this holds whatever hour the check happens to
     run at. Deliberate: a check that only passes at night is a check
     that fails on a Tuesday afternoon for no reason anybody can see. */
  PERFORM notification_settings_set(0::SMALLINT, 23::SMALLINT, NULL, NULL, FALSE);

  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');
  PERFORM notify('cc000000-0000-0000-0000-000000000003', 'crm.lead_assigned',
    'A prospect is on your tracker', NULL, NULL, 'cc000000-0000-0000-0000-000000000001');

  due := (pg_temp.one('cc000000-0000-0000-0000-000000000003', 'crm.lead_assigned')).due_at;

  IF due IS NULL THEN
    RAISE EXCEPTION 'quiet hours did not hold back a notification that is not urgent';
  END IF;
  IF due <= NOW() THEN
    RAISE EXCEPTION 'quiet hours landed it in the past: %', due;
  END IF;

  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000003');
  SELECT count(*) INTO live FROM notification_feed('personal', FALSE, 50);
  IF live <> 0 THEN
    RAISE EXCEPTION 'a notification held for quiet hours is in the feed anyway';
  END IF;
  RAISE NOTICE 'ok  quiet hours hold something back rather than throwing it away';
END $$;

-- Urgent goes through them.
DO $$
DECLARE due TIMESTAMPTZ;
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');
  PERFORM notify('cc000000-0000-0000-0000-000000000003', 'admin.role_changed',
    'You are now an administrator', NULL, NULL, 'cc000000-0000-0000-0000-000000000001');

  due := (pg_temp.one('cc000000-0000-0000-0000-000000000003', 'admin.role_changed')).due_at;
  IF due IS NOT NULL THEN
    RAISE EXCEPTION 'quiet hours held back something urgent';
  END IF;
  RAISE NOTICE 'ok  and something urgent goes straight through them';
END $$;

DO $$
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000003');
  PERFORM notification_settings_set(0::SMALLINT, 0::SMALLINT, NULL, NULL, FALSE);
END $$;

SELECT pg_temp.wipe();


-- =============================================================
-- 4. A browser may not write itself one.
--
-- Migration 001 wrote a single FOR ALL policy, which let anybody
-- holding the public key insert rows for themselves. Harmless while
-- nothing read them. Not harmless now: a notification is a claim about
-- what happened, and one saying "your role is now admin" costs somebody
-- an afternoon before they find out it is not.
-- =============================================================
DO $$
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000005');
  BEGIN
    INSERT INTO notifications (user_id, kind, title)
    VALUES ('cc000000-0000-0000-0000-000000000005', 'admin.role_changed', 'You are now an administrator');
    RAISE EXCEPTION 'a browser wrote itself a notification';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%wrote itself%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'ok  a browser cannot write itself a notification, only answer one';
END $$;

-- And a kind nobody has described is refused rather than written blank.
DO $$
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');
  BEGIN
    PERFORM notify('cc000000-0000-0000-0000-000000000003', 'something.invented',
      'A thing happened', NULL, NULL, NULL);
    RAISE EXCEPTION 'an undescribed kind was written';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%was written%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'ok  a kind missing from the catalogue is refused, not written with no label';
END $$;


-- =============================================================
-- 5. The diary, end to end.
-- =============================================================
DO $$
DECLARE ev UUID; inv UUID;
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');

  INSERT INTO calendar_events (title, start_at, end_at, created_by, visibility)
  VALUES ('Site visit, Carrington', NOW() + INTERVAL '3 days',
          NOW() + INTERVAL '3 days 1 hour',
          'cc000000-0000-0000-0000-000000000001', 'private')
  RETURNING id INTO ev;

  INSERT INTO calendar_invites (event_id, user_id, invited_by, awaiting)
  VALUES (ev, 'cc000000-0000-0000-0000-000000000002',
          'cc000000-0000-0000-0000-000000000001',
          'cc000000-0000-0000-0000-000000000002')
  RETURNING id INTO inv;

  IF pg_temp.said('cc000000-0000-0000-0000-000000000002', 'meeting.invited') <> 1 THEN
    RAISE EXCEPTION 'being asked to a meeting told nobody';
  END IF;

  /* The invitation reference has to travel on the notification, or the
     buttons on the card cannot answer it and somebody has to go and
     find the meeting. Which is the whole thing this was built for. */
  IF NOT EXISTS (
    SELECT 1 FROM pg_temp.rows_for('cc000000-0000-0000-0000-000000000002', 'meeting.invited')
     WHERE (payload ->> 'inviteId')::UUID = inv
  ) THEN
    RAISE EXCEPTION 'the invitation notification cannot be answered from the notification';
  END IF;
  RAISE NOTICE 'ok  being asked to a meeting says so, and carries what it takes to answer it';

  -- Answering goes back to whoever is waiting.
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000002');
  UPDATE calendar_invites
     SET status = 'accepted', awaiting = NULL, responded_at = NOW()
   WHERE id = inv;

  IF pg_temp.said('cc000000-0000-0000-0000-000000000001', 'meeting.answered') <> 1 THEN
    RAISE EXCEPTION 'answering an invitation told the organiser nothing';
  END IF;
  IF pg_temp.said('cc000000-0000-0000-0000-000000000002', 'meeting.answered') <> 0 THEN
    RAISE EXCEPTION 'somebody was told about their own answer';
  END IF;
  RAISE NOTICE 'ok  answering one goes back to the organiser, and not to whoever answered';

  -- The meeting moving under somebody who had already accepted it.
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');
  UPDATE calendar_events SET start_at = start_at + INTERVAL '2 days' WHERE id = ev;

  IF pg_temp.said('cc000000-0000-0000-0000-000000000002', 'meeting.moved') <> 1 THEN
    RAISE EXCEPTION 'a meeting moved and the person coming to it was not told';
  END IF;
  RAISE NOTICE 'ok  a meeting moving tells everybody who had already said yes';

  -- And it being called off.
  DELETE FROM calendar_events WHERE id = ev;
  IF pg_temp.said('cc000000-0000-0000-0000-000000000002', 'meeting.cancelled') <> 1 THEN
    RAISE EXCEPTION 'a meeting was called off and nobody was told';
  END IF;
  RAISE NOTICE 'ok  and it being called off gives the hour back rather than leaving it blocked';
END $$;

SELECT pg_temp.wipe();


-- =============================================================
-- 6. A lost deal books its own comeback.
--
-- Written the moment the deal is lost rather than computed six months
-- later by something that has to keep running. So the promise exists in
-- the database, and somebody reading the row can see it is booked.
-- =============================================================
DO $$
DECLARE lead UUID; due TIMESTAMPTZ; live BIGINT;
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000003');

  INSERT INTO crm_leads (owner_id, status, company_name, estimated_value, created_by)
  VALUES ('cc000000-0000-0000-0000-000000000003', 'quoted', 'Marsden Logistics',
          48000, 'cc000000-0000-0000-0000-000000000003')
  RETURNING id INTO lead;

  UPDATE crm_leads SET status = 'lost' WHERE id = lead;

  due := (pg_temp.one('cc000000-0000-0000-0000-000000000003', 'crm.winback')).due_at;

  IF due IS NULL THEN
    RAISE EXCEPTION 'a lost deal booked no comeback';
  END IF;
  IF due < NOW() + INTERVAL '5 months' OR due > NOW() + INTERVAL '7 months' THEN
    RAISE EXCEPTION 'the comeback is booked for %, which is not six months out', due;
  END IF;

  -- And it is not in the way until then.
  SELECT count(*) INTO live FROM notification_feed('personal', FALSE, 50);
  IF live <> 0 THEN
    RAISE EXCEPTION 'a reminder booked for six months out is in the feed today';
  END IF;

  -- Marked lost twice does not book it twice.
  UPDATE crm_leads SET status = 'contacted' WHERE id = lead;
  UPDATE crm_leads SET status = 'lost' WHERE id = lead;
  IF pg_temp.said('cc000000-0000-0000-0000-000000000003', 'crm.winback') <> 1 THEN
    RAISE EXCEPTION 'marking it lost twice booked two comebacks';
  END IF;

  RAISE NOTICE 'ok  a lost deal books one comeback six months out, and stays out of the way until then';
END $$;

SELECT pg_temp.wipe();


-- =============================================================
-- 7. The renewal ladder.
--
-- A month out, a fortnight, a week, and the day it lapses. All four
-- written when the contract is accepted, and taken back down if it is
-- renewed before they land.
-- =============================================================
DO $$
DECLARE c UUID; rungs INT; stages TEXT;
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000002');

  /* The totals and the asset count are kept by a trigger from `priced`,
     so they are set there rather than on the columns: written straight
     to the columns they are overwritten with zero on the way in, and
     sending refuses a contract with no assets on it. */
  INSERT INTO fleetsmart_contracts
    (customer_name, plan, term_months, starts_on, priced, owner_id, created_by)
  VALUES ('Marsden Logistics', 'Gold', 12, CURRENT_DATE - INTERVAL '11 months',
          jsonb_build_object(
            'annual', 18400, 'monthly', 1533.33,
            'assets', (SELECT jsonb_agg(jsonb_build_object('ref', 'A' || g))
                         FROM generate_series(1, 34) AS g)),
          'cc000000-0000-0000-0000-000000000002', 'cc000000-0000-0000-0000-000000000002')
  RETURNING id INTO c;

  /* Through the operations rather than by UPDATE, because migration 061
     froze a sent contract: its update policy reaches drafts only, so a
     bare UPDATE here would change no rows, fire no trigger, and this
     would report a ladder that was never booked. */
  PERFORM fleetsmart_send(c, 'ops@marsden.test');
  PERFORM fleetsmart_decide(c, 'accepted', NULL);

  SELECT count(*), string_agg(payload ->> 'stage', ',' ORDER BY due_at)
    INTO rungs, stages
    FROM pg_temp.rows_for('cc000000-0000-0000-0000-000000000002', 'fleetsmart.renewal');

  IF rungs <> 4 THEN
    RAISE EXCEPTION 'the renewal ladder has % rungs rather than 4', rungs;
  END IF;
  IF stages <> 'month,fortnight,week,expired' THEN
    RAISE EXCEPTION 'the ladder is in the wrong order: %', stages;
  END IF;
  RAISE NOTICE 'ok  a contract accepted books all four renewal reminders, in order';

  -- Renewed, so the ones that have not landed come back down.
  PERFORM fleetsmart_decide(c, 'expired', 'Replaced by a new contract');

  SELECT count(*) INTO rungs
    FROM pg_temp.rows_for('cc000000-0000-0000-0000-000000000002', 'fleetsmart.renewal')
   WHERE due_at > NOW();
  IF rungs <> 0 THEN
    RAISE EXCEPTION '% renewal reminders survived the contract being closed', rungs;
  END IF;
  RAISE NOTICE 'ok  and closing it takes the ones that have not landed back down';
END $$;

SELECT pg_temp.wipe();


-- =============================================================
-- 8. A unit selling asks the rep to confirm what they earned.
-- =============================================================
DO $$
DECLARE unit UUID; lead UUID; got notifications;
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000003');

  INSERT INTO stock_trailers (stc_no, make, model, category, year, status, sales_rep)
  VALUES ('STC143980', 'Cartwright', 'Curtainsider', 'Curtainsiders', 2021, 'in_stock', 'DM')
  RETURNING id INTO unit;

  INSERT INTO crm_leads (owner_id, status, company_name, stock_trailer_id,
                         sale_price, profit, profit_pct, commission, created_by)
  VALUES ('cc000000-0000-0000-0000-000000000003', 'quoted', 'Marsden Logistics', unit,
          24500, 4100, 16.7, 410, 'cc000000-0000-0000-0000-000000000003')
  RETURNING id INTO lead;

  UPDATE crm_leads SET status = 'won' WHERE id = lead;

  got := pg_temp.one('cc000000-0000-0000-0000-000000000003', 'sales.commission');

  IF got.id IS NULL THEN
    RAISE EXCEPTION 'a unit sold and the rep was never asked to confirm the commission';
  END IF;
  IF got.title NOT LIKE '%STC143980%' THEN
    RAISE EXCEPTION 'the commission notification does not name the unit: %', got.title;
  END IF;
  IF got.body NOT LIKE '%24,500%' OR got.body NOT LIKE '%410%' THEN
    RAISE EXCEPTION 'the commission notification is missing the figures: %', got.body;
  END IF;
  RAISE NOTICE 'ok  a unit sold asks the rep to confirm the commission, with the unit and the figures on it';

  -- And the stock list saying the same thing does not say it twice.
  UPDATE stock_trailers SET status = 'sold' WHERE id = unit;
  IF pg_temp.said('cc000000-0000-0000-0000-000000000003', 'sales.commission') <> 1 THEN
    RAISE EXCEPTION 'one sale produced two commission notifications';
  END IF;
  RAISE NOTICE 'ok  and the stock list marking the same unit sold does not say it twice';
END $$;

SELECT pg_temp.wipe();


-- =============================================================
-- 9. Turning a name somebody typed into a person.
--
-- The same cases `lib/crm/ownership.ts` folds together for reading,
-- asserted here because the trigger cannot call TypeScript and two
-- implementations of one rule is how they drift.
-- =============================================================
DO $$
BEGIN
  IF person_named('Dean Mann') <> 'cc000000-0000-0000-0000-000000000003' THEN
    RAISE EXCEPTION 'a full name did not resolve';
  END IF;
  IF person_named('dean mann') <> 'cc000000-0000-0000-0000-000000000003' THEN
    RAISE EXCEPTION 'case stopped a name resolving';
  END IF;
  IF person_named('D.Mann') IS NOT NULL THEN
    RAISE EXCEPTION 'D.Mann resolved to somebody, and it should not: it is neither a name nor initials';
  END IF;
  IF person_named('n.dean@example.test') <> 'cc000000-0000-0000-0000-000000000003' THEN
    RAISE EXCEPTION 'an email address did not resolve';
  END IF;
  IF person_named('DM') <> 'cc000000-0000-0000-0000-000000000003' THEN
    RAISE EXCEPTION 'initials did not resolve, which is what the stock list holds';
  END IF;
  IF person_named('Dean') <> 'cc000000-0000-0000-0000-000000000003' THEN
    RAISE EXCEPTION 'a first name did not resolve, and half the CRM is first names';
  END IF;
  IF person_named('') IS NOT NULL OR person_named(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'an empty owner resolved to somebody';
  END IF;
  IF person_named('Somebody Else') IS NOT NULL THEN
    RAISE EXCEPTION 'a name nobody has resolved to somebody';
  END IF;
  RAISE NOTICE 'ok  a free text owner resolves the same way the CRM reads it, and to nobody when it is ambiguous';
END $$;

/* Two people whose first name is the same means neither. Guessing puts
   somebody else's accounts in somebody's notifications, and silence is
   the right answer. */
DO $$
BEGIN
  PERFORM set_config('role', 'postgres', TRUE);
  RESET ROLE;
  UPDATE profiles SET full_name = 'Dean Croft'
    WHERE id = 'cc000000-0000-0000-0000-000000000004';
  SET LOCAL ROLE authenticated;

  IF person_named('Dean') IS NOT NULL THEN
    RAISE EXCEPTION 'two people called Dean and it picked one';
  END IF;
  RAISE NOTICE 'ok  and two people with the same first name means nobody, rather than a guess';

  RESET ROLE;
  UPDATE profiles SET full_name = 'Rama Patel'
    WHERE id = 'cc000000-0000-0000-0000-000000000004';
  SET LOCAL ROLE authenticated;
END $$;


-- =============================================================
-- 10. The sweep.
--
-- Everything no trigger can see, and the part that matters is that
-- running it again does not say any of it twice. It runs every time
-- somebody opens the bell.
-- =============================================================
DO $$
DECLARE ev UUID; wrote INT; again INT; n BIGINT;
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');

  INSERT INTO calendar_events (title, start_at, end_at, created_by, visibility)
  VALUES ('Call Dawson about the quote', NOW() + INTERVAL '30 minutes',
          NOW() + INTERVAL '55 minutes',
          'cc000000-0000-0000-0000-000000000001', 'private')
  RETURNING id INTO ev;

  INSERT INTO calendar_invites (event_id, user_id, invited_by, status)
  VALUES (ev, 'cc000000-0000-0000-0000-000000000002',
          'cc000000-0000-0000-0000-000000000001', 'accepted');

  PERFORM pg_temp.wipe();

  wrote := notification_sweep(TRUE);
  n := pg_temp.said('cc000000-0000-0000-0000-000000000002', 'call.soon');
  IF n <> 1 THEN
    RAISE EXCEPTION 'a call in half an hour produced % reminders rather than 1', n;
  END IF;
  RAISE NOTICE 'ok  a call starting within the hour is flagged once, to whoever is on it';

  again := notification_sweep(TRUE);
  n := pg_temp.said('cc000000-0000-0000-0000-000000000002', 'call.soon');
  IF n <> 1 THEN
    RAISE EXCEPTION 'sweeping twice said it % times', n;
  END IF;
  RAISE NOTICE 'ok  and sweeping again does not say any of it twice';

  -- And it stops being worth reading once the thing has started.
  IF NOT EXISTS (
    SELECT 1 FROM pg_temp.rows_for('cc000000-0000-0000-0000-000000000002', 'call.soon')
     WHERE expires_at IS NOT NULL AND expires_at <= NOW() + INTERVAL '31 minutes'
  ) THEN
    RAISE EXCEPTION 'an hour ahead reminder outlives the thing it is about';
  END IF;
  RAISE NOTICE 'ok  and an hour ahead reminder expires when the call starts, rather than sitting there after';
END $$;

/* The guard, so fifty people opening the bell at nine o'clock is one
   sweep and forty nine cheap returns. */
DO $$
DECLARE swept INT;
BEGIN
  swept := notification_sweep(FALSE);
  IF swept <> -1 THEN
    RAISE EXCEPTION 'the sweep ran again straight away rather than standing down: %', swept;
  END IF;
  RAISE NOTICE 'ok  and a second person opening the bell a moment later does not sweep again';
END $$;


-- =============================================================
-- 11. Reading, dismissing and answering are three different things.
--
-- Reading an invitation is not accepting it. A card that loses its
-- buttons on being read loses the thing that was waiting on you.
-- =============================================================
DO $$
DECLARE one UUID; got RECORD; live BIGINT;
BEGIN
  PERFORM pg_temp.wipe();

  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');
  one := notify('cc000000-0000-0000-0000-000000000003', 'crm.lead_assigned',
    'Marsden Logistics is on your tracker', NULL, '/dashboard/leads',
    'cc000000-0000-0000-0000-000000000001');

  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000003');

  PERFORM notification_read(ARRAY[one]);
  SELECT read_at, actioned_at INTO got FROM notifications WHERE id = one;
  IF got.read_at IS NULL THEN RAISE EXCEPTION 'reading one did not mark it read'; END IF;
  IF got.actioned_at IS NOT NULL THEN
    RAISE EXCEPTION 'reading one marked it answered, so its buttons have gone';
  END IF;

  SELECT count(*) INTO live FROM notification_feed('personal', FALSE, 50);
  IF live <> 1 THEN
    RAISE EXCEPTION 'reading one took it out of the list';
  END IF;

  PERFORM notification_acted(one, 'confirmed');
  SELECT actioned_at, action_taken INTO got FROM notifications WHERE id = one;
  IF got.actioned_at IS NULL OR got.action_taken <> 'confirmed' THEN
    RAISE EXCEPTION 'answering one did not record what was done';
  END IF;

  PERFORM notification_dismiss(ARRAY[one]);
  SELECT count(*) INTO live FROM notification_feed('personal', FALSE, 50);
  IF live <> 0 THEN
    RAISE EXCEPTION 'a dismissed notification is still in the list';
  END IF;
  RAISE NOTICE 'ok  read, answered and cleared are three different things, and the list knows which';
END $$;

/* And none of the three reaches anybody else's. */
DO $$
DECLARE mine UUID; n INT;
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');
  mine := notify('cc000000-0000-0000-0000-000000000002', 'crm.lead_assigned',
    'Something for Tom', NULL, NULL, 'cc000000-0000-0000-0000-000000000001');

  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000005');
  n := notification_read(ARRAY[mine]);
  IF n <> 0 THEN RAISE EXCEPTION 'somebody marked another person''s notification read'; END IF;
  n := notification_dismiss(ARRAY[mine]);
  IF n <> 0 THEN RAISE EXCEPTION 'somebody cleared another person''s notification'; END IF;
  IF notification_acted(mine, 'confirmed') THEN
    RAISE EXCEPTION 'somebody answered another person''s notification';
  END IF;
  IF (SELECT count(*) FROM notification_feed('all', FALSE, 50)) <> 0 THEN
    RAISE EXCEPTION 'somebody can read another person''s notifications';
  END IF;
  RAISE NOTICE 'ok  and none of the three reaches anybody else''s';
END $$;


-- =============================================================
-- 12. The settings screen has something to draw.
-- =============================================================
DO $$
DECLARE mine INT; theirs INT;
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');
  SELECT count(*) INTO mine FROM notification_choices();

  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000005');
  SELECT count(*) INTO theirs FROM notification_choices();

  IF mine < 25 THEN
    RAISE EXCEPTION 'an administrator is offered only % toggles', mine;
  END IF;
  IF theirs >= mine THEN
    RAISE EXCEPTION 'a read only viewer is offered as many toggles as an administrator';
  END IF;
  IF EXISTS (
    SELECT 1 FROM notification_choices() WHERE key = 'content.review_requested'
  ) THEN
    RAISE EXCEPTION 'a viewer is offered a toggle for approving posts they cannot approve';
  END IF;
  RAISE NOTICE 'ok  everybody is offered the toggles for the things they can actually do, and no others';
END $$;

RESET ROLE;
ROLLBACK;
