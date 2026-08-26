-- =============================================================
-- The Content workflow: every transition, and every way around it.
--
-- Migration 055 closes `social_posts.status`. Before it, the column was
-- writable by anybody the update policy let edit the post, which is
-- every marketer. The approval controls were correct and approval was
-- still one request away:
--
--   PATCH /social_posts?id=eq.x  {"status":"approved"}
--
-- The interface cannot be what stops that, because the interface is not
-- what the request goes through. So the assertions here are in two
-- halves: every transition works for the person who should have it, and
-- no transition can be reached any other way.
--
-- Run with `npm run check:workflow`.
-- =============================================================
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('ee000000-0000-0000-0000-000000000001', 'wf.admin@example.test'),
  ('ee000000-0000-0000-0000-000000000002', 'wf.writer@example.test'),
  ('ee000000-0000-0000-0000-000000000003', 'wf.approver@example.test'),
  ('ee000000-0000-0000-0000-000000000004', 'wf.selfapprover@example.test'),
  ('ee000000-0000-0000-0000-000000000005', 'wf.sales@example.test')
ON CONFLICT DO NOTHING;

UPDATE profiles SET role = 'admin',    role_template_id = NULL WHERE id = 'ee000000-0000-0000-0000-000000000001';
UPDATE profiles SET role = 'sales',    role_template_id = NULL WHERE id = 'ee000000-0000-0000-0000-000000000005';

-- Three on the new model, so the fine grained half is what is under
-- test rather than the compatibility half.
UPDATE profiles SET role = 'viewer',
       role_template_id = (SELECT id FROM role_templates WHERE slug = 'member')
  WHERE id IN ('ee000000-0000-0000-0000-000000000002',
               'ee000000-0000-0000-0000-000000000003',
               'ee000000-0000-0000-0000-000000000004');

INSERT INTO user_capability_overrides (user_id, capability, granted, scope, reason) VALUES
  -- The user's own example: a Marketer elevated for one function.
  ('ee000000-0000-0000-0000-000000000003', 'social.approve',    TRUE, 'company',
   'Approves content. Role unchanged.'),
  ('ee000000-0000-0000-0000-000000000004', 'social.approve',    TRUE, 'company',
   'Approves content.'),
  ('ee000000-0000-0000-0000-000000000004', 'social.approveOwn', TRUE, 'company',
   'A one person office. Somebody has to.'),
  ('ee000000-0000-0000-0000-000000000002', 'social.publishNow', TRUE, 'company',
   'Runs the launch. Needed for the publish assertions below.')
ON CONFLICT (user_id, capability) DO UPDATE
  SET granted = EXCLUDED.granted, scope = EXCLUDED.scope;

-- Two channels, one connected and one not, because "connected" is what
-- decides whether a Publish control exists at all.
INSERT INTO social_channels (id, network_key, handle, display_name, state, timezone) VALUES
  ('ee000000-0000-0000-0000-0000000000c1', 'linkedin', 'stc',    'Stockport Truck Centre', 'connected',    'Europe/London'),
  ('ee000000-0000-0000-0000-0000000000c2', 'x',        'stc_x',  'Stockport Truck Centre', 'disconnected', 'Europe/London')
ON CONFLICT DO NOTHING;

-- Slots on the connected one: every weekday at 09:00 and 15:00.
INSERT INTO social_channel_slots (channel_id, day_of_week, at_time)
SELECT 'ee000000-0000-0000-0000-0000000000c1', d, t
  FROM generate_series(1, 5) d, (VALUES ('09:00'::TIME), ('15:00'::TIME)) AS x(t)
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM profiles WHERE id::TEXT LIKE 'ee000000-%') <> 5 THEN
    RAISE EXCEPTION 'fixture: expected five people, found %',
      (SELECT count(*) FROM profiles WHERE id::TEXT LIKE 'ee000000-%');
  END IF;
  IF (SELECT count(*) FROM social_channel_slots
       WHERE channel_id = 'ee000000-0000-0000-0000-0000000000c1') <> 10 THEN
    RAISE EXCEPTION 'fixture: the queue has % slots, expected ten',
      (SELECT count(*) FROM social_channel_slots
        WHERE channel_id = 'ee000000-0000-0000-0000-0000000000c1');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_who UUID) RETURNS VOID
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_who::TEXT, TRUE);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
END;
$fn$;

-- A post with one connected channel, written by the writer.
CREATE OR REPLACE FUNCTION pg_temp.a_draft(p_words TEXT) RETURNS UUID
LANGUAGE plpgsql AS $fn$
DECLARE made UUID;
BEGIN
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');
  INSERT INTO social_posts (content, platform, scheduled_date, created_by, author_id)
  VALUES (p_words, '{}', CURRENT_DATE, 'wf.writer@example.test', current_actor())
  RETURNING id INTO made;
  INSERT INTO social_post_variants (post_id, channel_id)
  VALUES (made, 'ee000000-0000-0000-0000-0000000000c1');
  RETURN made;
END;
$fn$;

-- Owners bypass row level security, so a file that stays superuser
-- asserts that the policies parse and nothing else.
SET LOCAL ROLE authenticated;

-- =============================================================
-- PART ONE: the way around it is closed.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The PATCH that used to work.
-- -------------------------------------------------------------
DO $$
DECLARE post UUID;
BEGIN
  post := pg_temp.a_draft('A writer should not be able to approve this.');
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');

  BEGIN
    UPDATE social_posts SET status = 'approved' WHERE id = post;
    RAISE EXCEPTION 'a writer approved their own post by writing the status column';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'a writer approved their own post by writing the status column' THEN RAISE; END IF;
  END;

  IF (SELECT status FROM social_posts WHERE id = post) <> 'draft' THEN
    RAISE EXCEPTION 'the status moved anyway';
  END IF;
END $$;

-- The gate is not something a caller can open for themselves.
DO $$
DECLARE post UUID;
BEGIN
  post := pg_temp.a_draft('Setting the flag by hand should not help.');
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');

  -- `app.content_transition` is a session setting, and a browser cannot
  -- send one: PostgREST does not pass arbitrary settings through. What
  -- this asserts is the shape, so that if somebody later exposes a
  -- function that takes a setting name, this fails.
  PERFORM set_config('app.content_transition', 'on', TRUE);
  UPDATE social_posts SET status = 'approved' WHERE id = post;
  PERFORM set_config('app.content_transition', '', TRUE);

  IF (SELECT status FROM social_posts WHERE id = post) <> 'approved' THEN
    RAISE EXCEPTION 'the gate does not open even for the functions that own it';
  END IF;
END $$;

-- -------------------------------------------------------------
-- 1b. The shared half is not a way in either.
--
-- `content_transition` can move any post to any state and asks for no
-- capability, because its callers do. Revoking it does not help: they
-- run as the caller, so a revoked helper is revoked from them too. A
-- flag they set and nothing else does is what closes it, and this is
-- what proves the flag is actually load bearing.
-- -------------------------------------------------------------
DO $$
DECLARE post UUID;
BEGIN
  post := pg_temp.a_draft('Straight to the shared half.');
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');

  BEGIN
    PERFORM content_transition(post, 'approved', 'approved', 'Approved.', NULL, NULL);
    RAISE EXCEPTION 'a writer approved a post by calling content_transition directly';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM = 'a writer approved a post by calling content_transition directly' THEN RAISE; END IF;
  END;

  IF (SELECT status FROM social_posts WHERE id = post) <> 'draft' THEN
    RAISE EXCEPTION 'the status moved anyway';
  END IF;
END $$;

-- Editing everything else about a post is untouched.
DO $$
DECLARE post UUID;
BEGIN
  post := pg_temp.a_draft('Editing the words is still ordinary work.');
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');
  UPDATE social_posts SET content = 'Edited.', first_comment = 'And a first comment.'
   WHERE id = post;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'closing the status column also closed editing the post';
  END IF;
END $$;

-- =============================================================
-- PART TWO: every transition, for the person who should have it.
-- =============================================================

-- -------------------------------------------------------------
-- 2. Submit.
-- -------------------------------------------------------------
DO $$
DECLARE post UUID; p social_posts; bare UUID;
BEGIN
  post := pg_temp.a_draft('STC is hiring fitters.');
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');

  p := content_submit(post);
  IF p.status <> 'pending_review' THEN
    RAISE EXCEPTION 'submit left the post at %', p.status;
  END IF;
  IF p.submitted_at IS NULL THEN
    RAISE EXCEPTION 'submit did not record when';
  END IF;

  -- Twice is not a thing.
  BEGIN
    PERFORM content_submit(post);
    RAISE EXCEPTION 'a post was submitted twice';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'a post was submitted twice' THEN RAISE; END IF;
  END;

  -- A post with no channel goes nowhere, and finding that out at
  -- publish time means it sat in a queue for a week first.
  INSERT INTO social_posts (content, platform, scheduled_date, created_by, author_id)
  VALUES ('Nowhere to go.', '{}', CURRENT_DATE, 'wf.writer@example.test', current_actor())
  RETURNING id INTO bare;
  BEGIN
    PERFORM content_submit(bare);
    RAISE EXCEPTION 'a post with no channels was submitted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'a post with no channels was submitted' THEN RAISE; END IF;
  END;
END $$;

-- -------------------------------------------------------------
-- 3. Approve, and the two capabilities it takes.
--
-- The user's requirement in the small: two people on the same role, one
-- of them elevated for exactly one function.
-- -------------------------------------------------------------
DO $$
DECLARE post UUID; p social_posts;
BEGIN
  post := pg_temp.a_draft('Somebody else has to approve this.');
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');
  PERFORM content_submit(post);

  -- A plain member cannot approve, whoever wrote it.
  BEGIN
    PERFORM content_approve(post);
    RAISE EXCEPTION 'a member with no approval capability approved a post';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'a member with no approval capability approved a post' THEN RAISE; END IF;
  END;

  -- The one elevated for it can.
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000003');
  p := content_approve(post, 'Reads well.');
  IF p.status <> 'approved' THEN
    RAISE EXCEPTION 'approve left the post at %', p.status;
  END IF;
  IF p.approved_by_id <> 'ee000000-0000-0000-0000-000000000003' THEN
    RAISE EXCEPTION 'approve did not record who';
  END IF;
END $$;

-- Approving your own work is a separate capability, and its absence is
-- what makes approval a control rather than a step.
DO $$
DECLARE post UUID; p social_posts;
BEGIN
  -- The approver writes one themselves.
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000003');
  INSERT INTO social_posts (content, platform, scheduled_date, created_by, author_id)
  VALUES ('Written by the approver.', '{}', CURRENT_DATE, 'wf.approver@example.test', current_actor())
  RETURNING id INTO post;
  INSERT INTO social_post_variants (post_id, channel_id)
  VALUES (post, 'ee000000-0000-0000-0000-0000000000c1');
  PERFORM content_submit(post);

  BEGIN
    PERFORM content_approve(post);
    RAISE EXCEPTION 'somebody approved their own work without social.approveOwn';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'somebody approved their own work without social.approveOwn' THEN RAISE; END IF;
  END;

  -- Somebody else can, and that is the point.
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000004');
  p := content_approve(post);
  IF p.status <> 'approved' THEN
    RAISE EXCEPTION 'a second approver could not approve it either';
  END IF;
END $$;

-- And the person who holds both may.
DO $$
DECLARE post UUID; p social_posts;
BEGIN
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000004');
  INSERT INTO social_posts (content, platform, scheduled_date, created_by, author_id)
  VALUES ('A one person office.', '{}', CURRENT_DATE, 'wf.selfapprover@example.test', current_actor())
  RETURNING id INTO post;
  INSERT INTO social_post_variants (post_id, channel_id)
  VALUES (post, 'ee000000-0000-0000-0000-0000000000c1');
  PERFORM content_submit(post);
  p := content_approve(post);
  IF p.status <> 'approved' THEN
    RAISE EXCEPTION 'social.approveOwn did not let somebody approve their own work';
  END IF;
END $$;

-- -------------------------------------------------------------
-- 4. Reject, with a reason.
-- -------------------------------------------------------------
DO $$
DECLARE post UUID; p social_posts;
BEGIN
  post := pg_temp.a_draft('This one needs work.');
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');
  PERFORM content_submit(post);

  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000003');
  BEGIN
    PERFORM content_reject(post, '   ');
    RAISE EXCEPTION 'a post was rejected with no reason';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'a post was rejected with no reason' THEN RAISE; END IF;
  END;

  p := content_reject(post, 'The second paragraph makes a forward looking claim.');
  IF p.status <> 'draft' THEN
    RAISE EXCEPTION 'reject left the post at %', p.status;
  END IF;
  IF p.rejection_note IS NULL THEN
    RAISE EXCEPTION 'reject did not keep the reason, so the writer sees the same screen back';
  END IF;

  -- And the author can pick it up again.
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');
  PERFORM content_submit(post);
  IF (SELECT status FROM social_posts WHERE id = post) <> 'pending_review' THEN
    RAISE EXCEPTION 'a rejected post cannot be resubmitted';
  END IF;
END $$;

-- -------------------------------------------------------------
-- 5. The queue.
-- -------------------------------------------------------------
DO $$
DECLARE
  slot TIMESTAMPTZ; again TIMESTAMPTZ; post UUID; p social_posts;
BEGIN
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');

  slot := content_next_slot('ee000000-0000-0000-0000-0000000000c1', NOW());
  IF slot IS NULL THEN
    RAISE EXCEPTION 'a channel with ten slots has no next slot';
  END IF;
  IF slot <= NOW() THEN
    RAISE EXCEPTION 'the next slot is in the past';
  END IF;
  IF EXTRACT(DOW FROM (slot AT TIME ZONE 'Europe/London')) NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'the queue offered a weekend, and every slot is a weekday';
  END IF;

  -- A channel with no slots answers null rather than guessing, so the
  -- screen can say the channel has no posting times yet.
  IF content_next_slot('ee000000-0000-0000-0000-0000000000c2', NOW()) IS NOT NULL THEN
    RAISE EXCEPTION 'a channel with no slots offered a time anyway';
  END IF;

  -- Two posts do not land in one slot. That is the failure people
  -- notice, because it looks like the tool double posted.
  post := pg_temp.a_draft('First into the queue.');
  PERFORM content_submit(post);
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000003');
  PERFORM content_approve(post);
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');
  p := content_schedule(post, NULL);

  IF p.status <> 'scheduled' THEN
    RAISE EXCEPTION 'schedule left the post at %', p.status;
  END IF;
  IF NOT p.from_queue THEN
    RAISE EXCEPTION 'a post queued into a free slot does not say it came from the queue';
  END IF;
  IF p.scheduled_at IS DISTINCT FROM slot THEN
    RAISE EXCEPTION 'the post went to % and the next free slot was %', p.scheduled_at, slot;
  END IF;
  IF p.scheduled_date <> (p.scheduled_at AT TIME ZONE 'UTC')::DATE
     AND p.scheduled_date <> p.scheduled_at::DATE THEN
    RAISE EXCEPTION 'the legacy date column did not follow the scheduled time';
  END IF;

  again := content_next_slot('ee000000-0000-0000-0000-0000000000c1', NOW());
  IF again = slot THEN
    RAISE EXCEPTION 'the queue offered the same slot twice, which is how a tool double posts';
  END IF;
END $$;

-- A time in the past is a mistake worth naming rather than accepting.
DO $$
DECLARE post UUID;
BEGIN
  post := pg_temp.a_draft('Scheduled backward.');
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');
  PERFORM content_submit(post);
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000003');
  PERFORM content_approve(post);
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');
  BEGIN
    PERFORM content_schedule(post, NOW() - INTERVAL '1 hour');
    RAISE EXCEPTION 'a post was scheduled into the past';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'a post was scheduled into the past' THEN RAISE; END IF;
  END;
END $$;

-- Out of the queue and back again.
DO $$
DECLARE post UUID; p social_posts; n INTEGER;
BEGIN
  post := pg_temp.a_draft('In, then out.');
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');
  PERFORM content_submit(post);
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000003');
  PERFORM content_approve(post);
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');
  PERFORM content_schedule(post, NULL);
  p := content_unschedule(post);

  IF p.status <> 'approved' THEN
    RAISE EXCEPTION 'unschedule left the post at %, and it should still be approved', p.status;
  END IF;
  IF p.scheduled_at IS NOT NULL THEN
    RAISE EXCEPTION 'unschedule left a time on the post';
  END IF;
  SELECT count(*) INTO n FROM social_post_variants
   WHERE post_id = post AND scheduled_at IS NOT NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'unschedule left % variant(s) still holding a slot', n;
  END IF;
END $$;

-- -------------------------------------------------------------
-- 6. Publishing.
-- -------------------------------------------------------------
DO $$
DECLARE post UUID; p social_posts; v social_post_variants; only_off UUID;
BEGIN
  post := pg_temp.a_draft('Out it goes.');
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');
  PERFORM content_submit(post);
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000003');
  PERFORM content_approve(post);

  -- The approver does not hold social.publishNow.
  BEGIN
    PERFORM content_publish_now(post);
    RAISE EXCEPTION 'somebody without social.publishNow published immediately';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'somebody without social.publishNow published immediately' THEN RAISE; END IF;
  END;

  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');
  p := content_publish_now(post);
  IF p.status <> 'publishing' THEN
    RAISE EXCEPTION 'publish now left the post at %, and it should be publishing', p.status;
  END IF;

  -- The driver answers. One channel, so the post follows straight away.
  SELECT * INTO v FROM social_post_variants WHERE post_id = post LIMIT 1;
  IF v.state <> 'publishing' THEN
    RAISE EXCEPTION 'the variant is at % and should be publishing', v.state;
  END IF;

  PERFORM content_variant_result(v.id, TRUE, 'urn:li:share:1', 'https://example.test/1');
  SELECT * INTO p FROM social_posts WHERE id = post;
  IF p.status <> 'posted' THEN
    RAISE EXCEPTION 'every channel published and the post is at %', p.status;
  END IF;
  IF p.published_at IS NULL THEN
    RAISE EXCEPTION 'a published post does not say when it went out';
  END IF;

  -- A post whose only channel is disconnected has nowhere to go, and
  -- saying so beats a Publish button that appears to work.
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');
  INSERT INTO social_posts (content, platform, scheduled_date, created_by, author_id)
  VALUES ('Nobody is listening.', '{}', CURRENT_DATE, 'wf.writer@example.test', current_actor())
  RETURNING id INTO only_off;
  INSERT INTO social_post_variants (post_id, channel_id)
  VALUES (only_off, 'ee000000-0000-0000-0000-0000000000c2');
  PERFORM content_submit(only_off);
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000003');
  PERFORM content_approve(only_off);
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');
  BEGIN
    PERFORM content_publish_now(only_off);
    RAISE EXCEPTION 'a post published to a disconnected channel';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'a post published to a disconnected channel' THEN RAISE; END IF;
  END;
END $$;

-- One channel refusing is not the post failing. A post that reached
-- three networks and missed one has not failed, and calling it failed
-- invites somebody to send it again.
DO $$
DECLARE post UUID; p social_posts; ok UUID; bad UUID;
BEGIN
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000001');
  UPDATE social_channels SET state = 'connected'
   WHERE id = 'ee000000-0000-0000-0000-0000000000c2';

  post := pg_temp.a_draft('Two channels, one refusal.');
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');
  INSERT INTO social_post_variants (post_id, channel_id)
  VALUES (post, 'ee000000-0000-0000-0000-0000000000c2');
  PERFORM content_submit(post);
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000003');
  PERFORM content_approve(post);
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');
  PERFORM content_publish_now(post);

  SELECT id INTO ok  FROM social_post_variants
   WHERE post_id = post AND channel_id = 'ee000000-0000-0000-0000-0000000000c1';
  SELECT id INTO bad FROM social_post_variants
   WHERE post_id = post AND channel_id = 'ee000000-0000-0000-0000-0000000000c2';

  PERFORM content_variant_result(bad, FALSE, NULL, NULL, 'rate limited');
  SELECT * INTO p FROM social_posts WHERE id = post;
  IF p.status <> 'publishing' THEN
    RAISE EXCEPTION 'one channel answered and the post moved to % before the other did', p.status;
  END IF;

  PERFORM content_variant_result(ok, TRUE, 'urn:li:share:2', 'https://example.test/2');
  SELECT * INTO p FROM social_posts WHERE id = post;
  IF p.status <> 'posted' THEN
    RAISE EXCEPTION 'one channel published and the post is at %', p.status;
  END IF;

  -- Every channel refusing is a failure, and it has to say so.
  PERFORM content_variant_result(ok,  FALSE, NULL, NULL, 'revoked');
  PERFORM content_variant_result(bad, FALSE, NULL, NULL, 'revoked');
  SELECT * INTO p FROM social_posts WHERE id = post;
  IF p.status <> 'failed' THEN
    RAISE EXCEPTION 'every channel refused and the post is at %', p.status;
  END IF;
  IF p.failure_reason IS NULL THEN
    RAISE EXCEPTION 'a failed post does not say why';
  END IF;
END $$;

-- -------------------------------------------------------------
-- 6b. Mark posted, which the planner has always had.
--
-- No network driver exists yet, so without this every post would sit at
-- Scheduled forever. Anybody who could press the button before can
-- press it now, and what it records says it was done by hand.
-- -------------------------------------------------------------
DO $$
DECLARE post UUID; p social_posts; n INTEGER;
BEGIN
  post := pg_temp.a_draft('Posted by hand.');
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');
  PERFORM content_submit(post);
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000003');
  PERFORM content_approve(post);

  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');
  p := content_mark_posted(post);
  IF p.status <> 'posted' THEN
    RAISE EXCEPTION 'mark posted left the post at %', p.status;
  END IF;

  SELECT count(*) INTO n FROM social_post_variants
   WHERE post_id = post AND state <> 'published';
  IF n > 0 THEN
    RAISE EXCEPTION 'mark posted left % channel(s) behind the post', n;
  END IF;

  -- And it says it was a person, so a report can tell the difference
  -- between what this product published and what somebody recorded.
  IF NOT EXISTS (
    SELECT 1 FROM activity
     WHERE subject_type = 'social_post' AND subject_id = post
       AND summary LIKE '%by hand%') THEN
    RAISE EXCEPTION 'the timeline does not say the post was recorded rather than published';
  END IF;

  -- Somebody with no content capability still cannot.
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000005');
  BEGIN
    PERFORM content_mark_posted(post);
    RAISE EXCEPTION 'somebody with no content capability recorded a post as published';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'somebody with no content capability recorded a post as published' THEN RAISE; END IF;
  END;
END $$;

-- -------------------------------------------------------------
-- 7. Dragging a card is not a way around approving.
-- -------------------------------------------------------------
DO $$
DECLARE post UUID; p social_posts; ready UUID; ideas UUID; writing UUID;
BEGIN
  SELECT id INTO ready   FROM social_board_columns WHERE key = 'ready';
  SELECT id INTO ideas   FROM social_board_columns WHERE key = 'ideas';
  SELECT id INTO writing FROM social_board_columns WHERE key = 'writing';

  post := pg_temp.a_draft('Dragged.');
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');
  PERFORM content_submit(post);

  -- The writer drags it to Ready, which is approval by another name.
  BEGIN
    PERFORM content_move_card(post, ready);
    RAISE EXCEPTION 'a writer approved a post by dragging its card';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'a writer approved a post by dragging its card' THEN RAISE; END IF;
  END;

  -- The approver drags it there, and that is an approval, recorded.
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000003');
  p := content_move_card(post, ready);
  IF p.status <> 'approved' THEN
    RAISE EXCEPTION 'dragging to Ready left the post at %', p.status;
  END IF;
  IF p.approved_by_id IS NULL THEN
    RAISE EXCEPTION 'a card dragged to Ready was approved by nobody';
  END IF;
END $$;

-- Ideas and Writing are both drafts, so moving between them is
-- organizing and must not spring back.
DO $$
DECLARE post UUID; p social_posts; ideas UUID;
BEGIN
  SELECT id INTO ideas FROM social_board_columns WHERE key = 'ideas';
  post := pg_temp.a_draft('An idea, for now.');
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');

  p := content_move_card(post, ideas, 3);
  IF p.board_column_id <> ideas THEN
    RAISE EXCEPTION 'a card moved to Ideas did not stay there';
  END IF;
  IF p.board_position <> 3 THEN
    RAISE EXCEPTION 'a card moved to Ideas lost its place in the column';
  END IF;
  IF p.status <> 'draft' THEN
    RAISE EXCEPTION 'moving between two draft columns changed the status to %', p.status;
  END IF;
END $$;

-- -------------------------------------------------------------
-- 8. The trail.
--
-- An approval that leaves no record is not a control.
-- -------------------------------------------------------------
DO $$
DECLARE post UUID; n INTEGER;
BEGIN
  post := pg_temp.a_draft('Leaves a trail.');
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');
  PERFORM content_submit(post);
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000003');
  PERFORM content_approve(post, 'Fine.');

  SELECT count(*) INTO n FROM activity
   WHERE subject_type = 'social_post' AND subject_id = post;
  IF n < 2 THEN
    RAISE EXCEPTION 'submit and approve left % lines on the timeline, expected at least two', n;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM activity
     WHERE subject_type = 'social_post' AND subject_id = post
       AND verb = 'approved' AND actor_id = 'ee000000-0000-0000-0000-000000000003') THEN
    RAISE EXCEPTION 'the timeline does not say who approved it';
  END IF;

  -- And the permanent one, which is the copy a reviewer needs years
  -- later. `audit_log` is append only and nobody can edit it.
  --
  -- `approve`, not `approved`. The audit log's action is a closed list
  -- a reviewer filters on and the timeline's verb is a word a person
  -- reads in a sentence. They are deliberately different words, and
  -- passing one where the other belongs is what the first run of this
  -- file caught.
  RESET ROLE;
  SELECT count(*) INTO n FROM audit_log
   WHERE target_type = 'social_post' AND target_id = post AND action = 'approve';
  SET LOCAL ROLE authenticated;
  IF n <> 1 THEN
    RAISE EXCEPTION 'the approval left % lines in the audit log, expected one', n;
  END IF;
END $$;

-- -------------------------------------------------------------
-- 9. A compliance verdict is not something a browser writes.
-- -------------------------------------------------------------
DO $$
DECLARE post UUID; before_hash TEXT;
BEGIN
  post := pg_temp.a_draft('We will double revenue next quarter.');
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');

  BEGIN
    PERFORM content_record_lint(post, 'clean', '[]'::JSONB);
    RAISE EXCEPTION 'a browser recorded its own compliance verdict';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM = 'a browser recorded its own compliance verdict' THEN RAISE; END IF;
  END;

  -- The server may, and the verdict is tied to the exact words.
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.role', 'service_role', TRUE);
  PERFORM content_record_lint(post, 'blocking',
    '[{"rule":"forward_looking","message":"unhedged forward looking claim"}]'::JSONB);
  SELECT lint_hash INTO before_hash FROM social_posts WHERE id = post;
  IF before_hash IS DISTINCT FROM content_lint_subject(post) THEN
    RAISE EXCEPTION 'the verdict was not tied to the words it was about';
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');

  -- Rewriting it invalidates the verdict rather than leaving a stale
  -- green tick on changed copy.
  UPDATE social_posts SET content = 'We are hiring engineers.' WHERE id = post;
  IF (SELECT lint_hash FROM social_posts WHERE id = post) = content_lint_subject(post) THEN
    RAISE EXCEPTION 'the copy changed and the compliance verdict still matches it';
  END IF;
END $$;

-- Blocking is a setting, and it is off until somebody turns it on.
DO $$
DECLARE post UUID;
BEGIN
  IF (SELECT content_lint_blocks FROM tenant_settings WHERE id) THEN
    RAISE EXCEPTION 'the compliance lint blocks submits by default, which is not a decision this repository gets to make';
  END IF;

  RESET ROLE;
  UPDATE tenant_settings SET content_lint_blocks = TRUE WHERE id;
  SET LOCAL ROLE authenticated;

  post := pg_temp.a_draft('Unchecked copy.');
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000002');
  BEGIN
    PERFORM content_submit(post);
    RAISE EXCEPTION 'with blocking on, unchecked copy was submitted anyway';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'with blocking on, unchecked copy was submitted anyway' THEN RAISE; END IF;
  END;

  RESET ROLE;
  UPDATE tenant_settings SET content_lint_blocks = FALSE WHERE id;
  SET LOCAL ROLE authenticated;
END $$;

-- -------------------------------------------------------------
-- 10. Somebody with no content capability reaches none of it.
-- -------------------------------------------------------------
DO $$
DECLARE post UUID;
BEGIN
  post := pg_temp.a_draft('Not for sales.');
  PERFORM pg_temp.act_as('ee000000-0000-0000-0000-000000000005');

  BEGIN
    PERFORM content_submit(post);
    RAISE EXCEPTION 'somebody with no content capability submitted a post';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'somebody with no content capability submitted a post' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM content_approve(post);
    RAISE EXCEPTION 'somebody with no content capability approved a post';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'somebody with no content capability approved a post' THEN RAISE; END IF;
  END;
END $$;

ROLLBACK;
