-- =============================================================
-- Brought in from the Frame intranet package, renumbered.
--
-- It arrived as 050_content_workflow.sql. This repository already had a 050 of its
-- own: the leads architecture took 040 to 045, so everything from the
-- package moves up by six and 047 onwards keeps its relative order.
-- The order is `scripts/sql/order.txt`, which is what builds the
-- disposable server every check runs against, so what gets pasted into
-- a SQL editor and what the checks prove are the same sequence.
-- =============================================================

-- =============================================================
-- 050. Content: the workflow.
--
-- 049 is the shape. This is what moves a post through it, and it is a
-- separate migration because a state machine is where the mistakes are.
--
-- ---- Why every transition is a function ----
--
-- `social_posts.status` is a column, and PostgREST exposes it. A
-- browser can send `PATCH /social_posts?id=eq.x {"status":"approved"}`
-- and, under the update policy, be allowed to: the policy answers "may
-- this person edit this post", which is a different question from "may
-- this person approve it".
--
-- Every approval control in the product could be correct and it would
-- still be true that approval was one request away for anybody who
-- could edit. So status is closed: a trigger refuses any change to it
-- that did not come from one of the functions below, and each function
-- asks for the capability its own transition needs.
--
-- That is also where the record gets written. An approval that leaves
-- no trail is not a control, and from the meeting, 4.4 is explicit that
-- records are potentially discoverable. Every transition writes to the
-- activity timeline, which is what the screen reads, and the ones that
-- matter to a reviewer write to the append only audit log as well.
--
-- ---- The queue ----
--
-- Buffer's central idea and the reason people use it rather than a
-- calendar: a channel has slots, content flows into the next free one,
-- and nobody picks a time for every post. `content_next_slot` is that,
-- in the channel's own timezone, because a US morning and a European
-- morning are not the same instant.
--
-- ---- Copy lint ----
--
-- Findings are recorded against the post and against the exact words
-- they were found in, so editing the text invalidates the check rather
-- than leaving a stale green tick on changed copy. Whether a blocking
-- finding stops a submit is a setting, not a rule this file decides:
-- see `content_lint_blocks` below.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Where the lint verdict lives.
--
-- Against a hash of the words checked, not just a timestamp. A post
-- linted clean on Monday and rewritten on Tuesday has no verdict at
-- all, and it has to be possible to say so.
-- -------------------------------------------------------------
ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS lint_severity   TEXT
    CHECK (lint_severity IS NULL OR lint_severity IN ('clean', 'advisory', 'blocking')),
  ADD COLUMN IF NOT EXISTS lint_findings   JSONB,
  ADD COLUMN IF NOT EXISTS lint_hash       TEXT,
  ADD COLUMN IF NOT EXISTS lint_checked_at TIMESTAMPTZ;

-- Whether a blocking finding refuses a submit outright.
--
-- A setting rather than a rule, and off until somebody says otherwise.
-- The lint knows about Regulation FD and the predecessor chain name,
-- which is more than either vendor does, but deciding that a machine
-- may refuse to let a person submit their own words is the user's
-- decision and not this file's.
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS content_lint_blocks BOOLEAN NOT NULL DEFAULT FALSE;

-- The words a verdict is about. One definition, so the function that
-- records a verdict and the function that checks one cannot disagree
-- about what was checked.
CREATE OR REPLACE FUNCTION content_lint_subject(p_post UUID)
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT md5(COALESCE(p.content, '') || E'\n' || COALESCE(p.first_comment, '')
             || E'\n' || COALESCE(p.caption, ''))
    FROM social_posts p WHERE p.id = p_post;
$fn$;

-- -------------------------------------------------------------
-- 2. Status is closed.
--
-- The flag is transaction local and is set by nothing except the
-- functions below, so a direct PATCH cannot produce it. The message
-- names the way out rather than only refusing, because the person who
-- meets it is usually a developer wiring a new control.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION content_status_is_closed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND COALESCE(current_setting('app.content_transition', TRUE), '') <> 'on' THEN
    RAISE EXCEPTION
      'a post''s status changes through content_submit, content_approve, content_reject, content_schedule, content_publish_now or content_mark_*, not by writing the column';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS content_status_closed ON social_posts;
CREATE TRIGGER content_status_closed
  BEFORE UPDATE ON social_posts
  FOR EACH ROW EXECUTE FUNCTION content_status_is_closed();

-- -------------------------------------------------------------
-- 3. One place a transition happens.
--
-- Every function below funnels through this. It opens the gate, writes
-- the row, records the move on the timeline, and shuts the gate again.
-- Nothing else in the product may open it.
-- -------------------------------------------------------------
-- An earlier shape of this took a boolean here. Dropped rather than
-- left alongside: two overloads differing only in the last argument is
-- how PostgREST picks the wrong one.
DROP FUNCTION IF EXISTS content_transition(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION content_transition(
  p_post    UUID,
  p_to      TEXT,
  p_verb    TEXT,
  p_summary TEXT,
  p_note    TEXT DEFAULT NULL,
  /* The audit log's own vocabulary, or null for a transition that does
     not belong in the permanent record. It is a separate word from
     `p_verb` on purpose: the timeline reads in the past tense because a
     person reads it as a sentence, and `audit_log.action` is a closed
     list that a reviewer filters on. Passing one to the other is how
     the first run of this file failed. */
  p_audit_action TEXT DEFAULT NULL
)
RETURNS social_posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  before_ social_posts;
  after_  social_posts;
BEGIN
  /* This one function can move any post to any state, so the thing that
     must be true is that only the functions below can reach it.

     Revoking EXECUTE does not do that. These functions run as the
     caller, deliberately, so that row level security still applies to
     the post they are moving. Inside a SECURITY INVOKER function the
     current user is still the person, so a revoked helper is revoked
     from its own callers too, which is what the first version of this
     file discovered.

     So it is a flag instead, set by the functions below and by nothing
     else. PostgREST passes `request.*` settings and no others, so a
     browser cannot produce it however the request is shaped. */
  IF COALESCE(current_setting('app.content_workflow', TRUE), '') <> 'on' THEN
    RAISE EXCEPTION
      'content_transition is the shared half of content_submit, content_approve and the rest. Call one of those.';
  END IF;

  /* Definer rights mean the UPDATE below is not filtered by row level
     security, so visibility is asked for here rather than assumed from
     the fact that the row came back. Every caller has already checked
     it. This is the belt. */
  IF NOT may_read_content() THEN
    RAISE EXCEPTION 'you cannot reach content';
  END IF;

  SELECT * INTO before_ FROM social_posts WHERE id = p_post AND deleted_at IS NULL;
  IF before_.id IS NULL THEN
    RAISE EXCEPTION 'there is no post with that id, or it is not one you can see';
  END IF;

  PERFORM set_config('app.content_transition', 'on', TRUE);

  UPDATE social_posts SET
    status         = p_to,
    submitted_at   = CASE WHEN p_to = 'pending_review' THEN NOW() ELSE submitted_at END,
    approved_at    = CASE WHEN p_to = 'approved'   THEN NOW()
                          WHEN p_to = 'draft'      THEN NULL
                          ELSE approved_at END,
    approved_by_id = CASE WHEN p_to = 'approved'   THEN current_actor()
                          WHEN p_to = 'draft'      THEN NULL
                          ELSE approved_by_id END,
    rejected_at    = CASE WHEN p_verb = 'rejected' THEN NOW()
                          WHEN p_to = 'approved'   THEN NULL
                          ELSE rejected_at END,
    rejection_note = CASE WHEN p_verb = 'rejected' THEN p_note
                          WHEN p_to = 'approved'   THEN NULL
                          ELSE rejection_note END,
    published_at   = CASE WHEN p_to = 'posted'     THEN COALESCE(published_at, NOW())
                          ELSE published_at END,
    failed_at      = CASE WHEN p_to = 'failed'     THEN NOW()
                          WHEN p_to <> 'failed'    THEN NULL
                          ELSE failed_at END,
    failure_reason = CASE WHEN p_to = 'failed'     THEN p_note
                          WHEN p_to <> 'failed'    THEN NULL
                          ELSE failure_reason END,
    updated_at     = NOW()
  WHERE id = p_post
  RETURNING * INTO after_;

  PERFORM set_config('app.content_transition', '', TRUE);

  IF after_.id IS NULL THEN
    RAISE EXCEPTION 'you cannot change that post';
  END IF;

  PERFORM log_activity(
    p_verb, 'social_post', p_post, p_summary,
    left(after_.content, 80),
    NULL, NULL, NULL,
    jsonb_build_object('from', before_.status, 'to', p_to, 'note', p_note),
    after_.classification::TEXT, after_.is_sensitive, FALSE);

  -- Approvals, rejections and anything that reaches the public go in
  -- the permanent record as well. A reviewer years later needs the one
  -- nobody can edit, not the one the screen draws.
  IF p_audit_action IS NOT NULL THEN
    PERFORM audit(
      p_audit_action, 'social_post', p_post, left(after_.content, 120),
      jsonb_build_object('status', before_.status),
      jsonb_build_object('status', p_to),
      'ui', p_note, NULL, NULL,
      after_.classification::TEXT, after_.is_sensitive);
  END IF;

  RETURN after_;
END;
$fn$;

-- Executable, and useless on its own: without the flag above it
-- refuses, and the flag is set by the functions below and by nothing
-- else. `check:workflow` asserts a direct call is refused.
REVOKE ALL ON FUNCTION content_transition(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_transition(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- Opening and shutting the gate, so eight functions do not each carry
-- their own copy of the two lines that matter most in this file.
CREATE OR REPLACE FUNCTION content_workflow_open() RETURNS VOID
LANGUAGE SQL VOLATILE AS $fn$
  SELECT set_config('app.content_workflow', 'on', TRUE);
  SELECT NULL::VOID;
$fn$;

CREATE OR REPLACE FUNCTION content_workflow_shut() RETURNS VOID
LANGUAGE SQL VOLATILE AS $fn$
  SELECT set_config('app.content_workflow', '', TRUE);
  SELECT NULL::VOID;
$fn$;

REVOKE ALL ON FUNCTION content_workflow_open() FROM PUBLIC;
REVOKE ALL ON FUNCTION content_workflow_shut() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_workflow_open() TO authenticated;
GRANT EXECUTE ON FUNCTION content_workflow_shut() TO authenticated;

-- -------------------------------------------------------------
-- 4. Submit.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION content_submit(p_post UUID, p_note TEXT DEFAULT NULL)
RETURNS social_posts
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  p       social_posts;
  blocks  BOOLEAN;
  n_chan  INTEGER;
BEGIN
  SELECT * INTO p FROM social_posts WHERE id = p_post;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'there is no post with that id, or it is not one you can see';
  END IF;
  IF NOT may_write_content() THEN
    RAISE EXCEPTION 'you cannot write content';
  END IF;
  IF p.status NOT IN ('draft', 'failed') THEN
    RAISE EXCEPTION 'a post is submitted from draft, and this one is %', p.status;
  END IF;
  IF btrim(COALESCE(p.content, '')) = '' THEN
    RAISE EXCEPTION 'a post with nothing in it cannot be submitted';
  END IF;

  -- A post with no channel cannot go anywhere, and finding that out at
  -- publish time means it sat in a queue for a week first.
  SELECT count(*) INTO n_chan FROM social_post_variants WHERE post_id = p_post;
  IF n_chan = 0 THEN
    RAISE EXCEPTION 'this post has no channels, so there is nowhere for it to go';
  END IF;

  SELECT content_lint_blocks INTO blocks FROM tenant_settings WHERE id;
  IF COALESCE(blocks, FALSE) THEN
    IF p.lint_hash IS DISTINCT FROM content_lint_subject(p_post) THEN
      RAISE EXCEPTION 'this has changed since it was last checked for compliance. Check it again.';
    END IF;
    IF p.lint_severity = 'blocking' THEN
      RAISE EXCEPTION 'the compliance check found something that has to be fixed before this can be submitted';
    END IF;
  END IF;

  PERFORM content_workflow_open();
  p := content_transition(p_post, 'pending_review', 'submitted',
    'Submitted for approval.', p_note, NULL);
  PERFORM content_workflow_shut();
  RETURN p;
END;
$fn$;

-- -------------------------------------------------------------
-- 5. Approve and reject.
--
-- `social.approveOwn` is the whole reason approval is two capabilities
-- rather than one. An approval step a person can grant themselves is
-- not an approval step, and the interface cannot be the thing that
-- stops them, because the interface is not what a request goes through.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION content_approve(p_post UUID, p_note TEXT DEFAULT NULL)
RETURNS social_posts
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE p social_posts;
BEGIN
  SELECT * INTO p FROM social_posts WHERE id = p_post;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'there is no post with that id, or it is not one you can see';
  END IF;
  IF NOT may_approve_content() THEN
    RAISE EXCEPTION 'you cannot approve content';
  END IF;
  IF p.status <> 'pending_review' THEN
    RAISE EXCEPTION 'only a post waiting for review can be approved, and this one is %', p.status;
  END IF;
  IF p.author_id = current_actor() AND NOT command_may('social.approveOwn') THEN
    RAISE EXCEPTION 'you wrote this, so somebody else has to approve it';
  END IF;

  PERFORM content_workflow_open();
  p := content_transition(p_post, 'approved', 'approved', 'Approved.', p_note, 'approve');
  PERFORM content_workflow_shut();
  RETURN p;
END;
$fn$;

CREATE OR REPLACE FUNCTION content_reject(p_post UUID, p_note TEXT)
RETURNS social_posts
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE p social_posts;
BEGIN
  SELECT * INTO p FROM social_posts WHERE id = p_post;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'there is no post with that id, or it is not one you can see';
  END IF;
  IF NOT may_approve_content() THEN
    RAISE EXCEPTION 'you cannot approve or reject content';
  END IF;
  IF p.status NOT IN ('pending_review', 'approved') THEN
    RAISE EXCEPTION 'only a post waiting for review or already approved can be rejected, and this one is %', p.status;
  END IF;
  -- A rejection with no reason sends somebody back to a screen that
  -- looks exactly as it did, with no idea what to change.
  IF btrim(COALESCE(p_note, '')) = '' THEN
    RAISE EXCEPTION 'say what needs changing. A rejection with no reason is not feedback.';
  END IF;

  PERFORM content_workflow_open();
  p := content_transition(p_post, 'draft', 'rejected',
    'Sent back: ' || p_note, p_note, 'reject');
  PERFORM content_workflow_shut();
  RETURN p;
END;
$fn$;

-- -------------------------------------------------------------
-- 6. The queue.
--
-- The next free slot on a channel, in that channel's own timezone.
--
-- "Free" means no post is already going out at that instant on that
-- channel. Two posts in one slot is the failure people notice: it looks
-- like the tool double posted.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION content_next_slot(
  p_channel UUID,
  p_after   TIMESTAMPTZ DEFAULT NULL
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  zone  TEXT;
  from_ TIMESTAMPTZ := COALESCE(p_after, NOW());
  day   DATE;
  cand  TIMESTAMPTZ;
  i     INTEGER;
BEGIN
  SELECT timezone INTO zone FROM social_channels WHERE id = p_channel;
  IF zone IS NULL THEN
    RAISE EXCEPTION 'there is no channel with that id';
  END IF;

  -- Fourteen days is two full weeks of slots. A channel with no slot in
  -- fourteen days has no usable queue, and answering null is how the
  -- screen knows to say "this channel has no posting times yet" rather
  -- than silently picking one.
  day := (from_ AT TIME ZONE zone)::DATE;
  FOR i IN 0..14 LOOP
    FOR cand IN
      SELECT ((day + i) + s.at_time) AT TIME ZONE zone
        FROM social_channel_slots s
       WHERE s.channel_id = p_channel
         AND s.is_active
         AND s.day_of_week = EXTRACT(DOW FROM (day + i))
       ORDER BY s.at_time
    LOOP
      CONTINUE WHEN cand <= from_;
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM social_post_variants v
         WHERE v.channel_id = p_channel
           AND v.state IN ('pending', 'scheduled')
           AND v.scheduled_at = cand);
      RETURN cand;
    END LOOP;
  END LOOP;

  RETURN NULL;
END;
$fn$;

-- -------------------------------------------------------------
-- 7. Schedule.
--
-- Two ways in, and the difference is recorded rather than inferred.
-- `p_at` null means "next free slot on each channel", which is the
-- queue. A time means somebody chose it, and a slot moving later must
-- not drag their choice with it.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION content_schedule(
  p_post UUID,
  p_at   TIMESTAMPTZ DEFAULT NULL
)
RETURNS social_posts
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  p       social_posts;
  v       RECORD;
  slot    TIMESTAMPTZ;
  first_  TIMESTAMPTZ;
  queued  BOOLEAN := p_at IS NULL;
BEGIN
  SELECT * INTO p FROM social_posts WHERE id = p_post;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'there is no post with that id, or it is not one you can see';
  END IF;
  IF NOT (command_may('social.schedule') OR command_may('marketing.edit')) THEN
    RAISE EXCEPTION 'you cannot schedule content';
  END IF;
  IF p.status <> 'approved' THEN
    RAISE EXCEPTION 'only an approved post can be scheduled, and this one is %', p.status;
  END IF;
  IF p_at IS NOT NULL AND p_at <= NOW() THEN
    RAISE EXCEPTION 'that time has already passed. To send it now, publish it now.';
  END IF;

  FOR v IN SELECT * FROM social_post_variants
            WHERE post_id = p_post AND state IN ('pending', 'scheduled')
            ORDER BY position LOOP
    IF queued THEN
      slot := content_next_slot(v.channel_id, NOW());
      IF slot IS NULL THEN
        RAISE EXCEPTION
          'one of these channels has no posting times set, so the queue has nowhere to put this. Give it a slot or choose a time.';
      END IF;
    ELSE
      slot := p_at;
    END IF;

    UPDATE social_post_variants
       SET scheduled_at = slot, state = 'scheduled', updated_at = NOW()
     WHERE id = v.id;

    first_ := LEAST(COALESCE(first_, slot), slot);
  END LOOP;

  IF first_ IS NULL THEN
    RAISE EXCEPTION 'this post has no channels left to send to';
  END IF;

  UPDATE social_posts SET scheduled_at = first_, from_queue = queued WHERE id = p_post;

  PERFORM content_workflow_open();
  p := content_transition(p_post, 'scheduled', 'scheduled',
    CASE WHEN queued THEN 'Queued for the next free slot.'
         ELSE 'Scheduled.' END,
    NULL, NULL);
  PERFORM content_workflow_shut();
  RETURN p;
END;
$fn$;

CREATE OR REPLACE FUNCTION content_unschedule(p_post UUID)
RETURNS social_posts
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE p social_posts;
BEGIN
  SELECT * INTO p FROM social_posts WHERE id = p_post;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'there is no post with that id, or it is not one you can see';
  END IF;
  IF NOT (command_may('social.schedule') OR command_may('marketing.edit')) THEN
    RAISE EXCEPTION 'you cannot schedule content';
  END IF;
  IF p.status <> 'scheduled' THEN
    RAISE EXCEPTION 'only a scheduled post can be taken out of the queue, and this one is %', p.status;
  END IF;

  UPDATE social_post_variants
     SET state = 'pending', scheduled_at = NULL, updated_at = NOW()
   WHERE post_id = p_post AND state = 'scheduled';
  UPDATE social_posts SET scheduled_at = NULL, from_queue = FALSE WHERE id = p_post;

  PERFORM content_workflow_open();
  p := content_transition(p_post, 'approved', 'unscheduled',
    'Taken out of the queue. Still approved.', NULL, NULL);
  PERFORM content_workflow_shut();
  RETURN p;
END;
$fn$;

-- -------------------------------------------------------------
-- 8. Publishing.
--
-- Three functions because publishing is three moments, and collapsing
-- them is how a network that takes nine seconds looks like a failure.
--
-- `content_publish_now` is the one a person presses. It puts the post
-- into `publishing` and hands it to whatever driver is configured. The
-- other two are what the driver says back.
--
-- No driver exists yet, and that is deliberate: every network needs an
-- app registration and several need review before they grant a posting
-- scope. Everything up to this point works without one. What must not
-- happen is a Publish button that appears and does nothing, so the
-- screen offers it only where a channel is actually connected.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION content_publish_now(p_post UUID)
RETURNS social_posts
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  p       social_posts;
  n_ready INTEGER;
BEGIN
  SELECT * INTO p FROM social_posts WHERE id = p_post;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'there is no post with that id, or it is not one you can see';
  END IF;
  IF NOT command_may('social.publishNow') THEN
    RAISE EXCEPTION 'you cannot publish immediately';
  END IF;
  IF p.status NOT IN ('approved', 'scheduled') THEN
    RAISE EXCEPTION 'only an approved post can be published, and this one is %', p.status;
  END IF;

  SELECT count(*) INTO n_ready
    FROM social_post_variants v
    JOIN social_channels c ON c.id = v.channel_id
   WHERE v.post_id = p_post
     AND v.state IN ('pending', 'scheduled')
     AND c.state = 'connected';
  IF n_ready = 0 THEN
    RAISE EXCEPTION 'none of this post''s channels is connected, so there is nothing to publish to';
  END IF;

  UPDATE social_post_variants v
     SET state = 'publishing', attempts = v.attempts + 1, updated_at = NOW()
    FROM social_channels c
   WHERE c.id = v.channel_id
     AND v.post_id = p_post
     AND v.state IN ('pending', 'scheduled')
     AND c.state = 'connected';

  PERFORM content_workflow_open();
  p := content_transition(p_post, 'publishing', 'publishing',
    'Sent to the networks.', NULL, 'publish');
  PERFORM content_workflow_shut();
  RETURN p;
END;
$fn$;

-- What a driver says back about one channel. The post follows once
-- every channel has answered, which is why this is per variant and the
-- post's own state is derived rather than set.
CREATE OR REPLACE FUNCTION content_variant_result(
  p_variant   UUID,
  p_ok        BOOLEAN,
  p_external  TEXT DEFAULT NULL,
  p_permalink TEXT DEFAULT NULL,
  p_error     TEXT DEFAULT NULL
)
RETURNS social_post_variants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v         social_post_variants;
  /* Not `post_id`. A local with a column's name resolves to the local
     inside a WHERE clause, which turns `WHERE post_id = post_id` into a
     tautology that matches every row in the table. */
  the_post  UUID;
  waiting   INTEGER;
  worked    INTEGER;
  failed    INTEGER;
BEGIN
  IF auth.role() <> 'service_role' AND NOT command_may('social.publishNow') THEN
    RAISE EXCEPTION 'only the publisher reports what a network said';
  END IF;

  UPDATE social_post_variants SET
    state          = CASE WHEN p_ok THEN 'published' ELSE 'failed' END,
    external_id    = COALESCE(p_external, external_id),
    permalink      = COALESCE(p_permalink, permalink),
    published_at   = CASE WHEN p_ok THEN NOW() ELSE published_at END,
    failure_reason = CASE WHEN p_ok THEN NULL ELSE p_error END,
    updated_at     = NOW()
  WHERE id = p_variant
  RETURNING * INTO v;

  IF v.id IS NULL THEN
    RAISE EXCEPTION 'there is no variant with that id';
  END IF;
  the_post := v.post_id;

  SELECT
    count(*) FILTER (WHERE state IN ('pending', 'scheduled', 'publishing')),
    count(*) FILTER (WHERE state = 'published'),
    count(*) FILTER (WHERE state = 'failed')
    INTO waiting, worked, failed
    FROM social_post_variants WHERE social_post_variants.post_id = the_post;

  IF waiting = 0 THEN
    PERFORM content_workflow_open();
    -- Anything out at all is published. A post that reached three
    -- networks and missed one has not failed, and calling it failed
    -- invites somebody to send it again.
    IF worked > 0 THEN
      PERFORM content_transition(the_post, 'posted', 'published',
        CASE WHEN failed > 0
             THEN 'Published, with ' || failed || ' channel(s) refused.'
             ELSE 'Published.' END,
        NULL, 'publish');
    ELSE
      PERFORM content_transition(the_post, 'failed', 'failed',
        'Every channel refused it.', p_error, 'publish');
    END IF;
    PERFORM content_workflow_shut();
  END IF;

  RETURN v;
END;
$fn$;

-- -------------------------------------------------------------
-- 8b. Recording that something went out by hand.
--
-- The planner has always had a Mark posted button, and it was a plain
-- write to the status column. Closing that column would have taken the
-- control away, and there is nothing to replace it with yet: no network
-- driver exists, because every one of them needs an app registration
-- and several need review first.
--
-- So without this, every post in the product would sit at Scheduled
-- forever and somebody would go and post it on the network by hand,
-- which is exactly what happens today. This is how they say so.
--
-- It is marked as manual rather than pretending, so a report can tell
-- the difference between what this product published and what a person
-- published and then recorded. When drivers land, that distinction is
-- the only way to read the history honestly.
--
-- The capability is the compatibility pair again: anybody who could
-- press Mark posted before can press it now.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION content_mark_posted(p_post UUID, p_note TEXT DEFAULT NULL)
RETURNS social_posts
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE p social_posts;
BEGIN
  SELECT * INTO p FROM social_posts WHERE id = p_post;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'there is no post with that id, or it is not one you can see';
  END IF;
  IF NOT (command_may('social.publishNow') OR command_may('marketing.edit')) THEN
    RAISE EXCEPTION 'you cannot record content as published';
  END IF;
  IF p.status NOT IN ('approved', 'scheduled', 'publishing', 'failed') THEN
    RAISE EXCEPTION 'only an approved post can be recorded as published, and this one is %', p.status;
  END IF;

  UPDATE social_post_variants
     SET state = 'published', published_at = NOW(), updated_at = NOW()
   WHERE post_id = p_post AND state IN ('pending', 'scheduled', 'publishing');

  PERFORM content_workflow_open();
  p := content_transition(p_post, 'posted', 'published',
    'Recorded as published by hand.',
    COALESCE(p_note, 'Posted on the network by a person, not by this product.'),
    'publish');
  PERFORM content_workflow_shut();
  RETURN p;
END;
$fn$;

-- -------------------------------------------------------------
-- 9. Moving a card.
--
-- The board and the status are one thing seen twice. Dragging a card is
-- the transition its column names, which is why this is not an update
-- to `board_column_id`.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION content_move_card(
  p_post     UUID,
  p_column   UUID,
  p_position INTEGER DEFAULT 0
)
RETURNS social_posts
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  p    social_posts;
  col  social_board_columns;
BEGIN
  SELECT * INTO p FROM social_posts WHERE id = p_post;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'there is no post with that id, or it is not one you can see';
  END IF;
  SELECT * INTO col FROM social_board_columns WHERE id = p_column AND is_active;
  IF col.id IS NULL THEN
    RAISE EXCEPTION 'there is no such column on the board';
  END IF;

  -- Same status, different column: Ideas and Writing are both drafts,
  -- and moving between them is organizing rather than approving.
  IF col.maps_to_status = p.status THEN
    IF NOT may_edit_post(p_post) THEN
      RAISE EXCEPTION 'you cannot change that post';
    END IF;
    UPDATE social_posts
       SET board_column_id = p_column, board_position = p_position, updated_at = NOW()
     WHERE id = p_post
    RETURNING * INTO p;
    RETURN p;
  END IF;

  -- A different status is the transition, with the transition's own
  -- permission. Dragging is not a way around approving.
  IF col.maps_to_status = 'pending_review' THEN
    p := content_submit(p_post);
  ELSIF col.maps_to_status = 'approved' AND p.status = 'pending_review' THEN
    p := content_approve(p_post);
  ELSIF col.maps_to_status = 'approved' AND p.status = 'scheduled' THEN
    p := content_unschedule(p_post);
  ELSIF col.maps_to_status = 'draft' THEN
    IF p.status = 'pending_review' THEN
      RAISE EXCEPTION 'to send this back, reject it and say what needs changing';
    END IF;
    RAISE EXCEPTION 'a % post does not go back to draft', p.status;
  ELSIF col.maps_to_status = 'scheduled' THEN
    p := content_schedule(p_post, NULL);
  ELSE
    RAISE EXCEPTION 'a post reaches % by being published, not by being dragged there', col.label;
  END IF;

  UPDATE social_posts
     SET board_column_id = p_column, board_position = p_position, updated_at = NOW()
   WHERE id = p_post
  RETURNING * INTO p;
  RETURN p;
END;
$fn$;

-- -------------------------------------------------------------
-- 10. Recording a compliance verdict.
--
-- The lint is TypeScript: it knows about Regulation FD, the predecessor
-- chain name and US spelling, and none of that belongs in a trigger. So
-- the route runs it and this records what it found.
--
-- Service role only. A verdict a browser could write is a verdict that
-- always says clean.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION content_record_lint(
  p_post     UUID,
  p_severity TEXT,
  p_findings JSONB
)
RETURNS social_posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE p social_posts;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'a compliance verdict is recorded by the server, not by a browser';
  END IF;
  IF p_severity NOT IN ('clean', 'advisory', 'blocking') THEN
    RAISE EXCEPTION 'a verdict is clean, advisory or blocking, not %', p_severity;
  END IF;

  UPDATE social_posts SET
    lint_severity   = p_severity,
    lint_findings   = p_findings,
    lint_hash       = content_lint_subject(p_post),
    lint_checked_at = NOW()
  WHERE id = p_post
  RETURNING * INTO p;

  IF p.id IS NULL THEN
    RAISE EXCEPTION 'there is no post with that id';
  END IF;
  RETURN p;
END;
$fn$;

-- -------------------------------------------------------------
-- 11. Who may call what.
-- -------------------------------------------------------------
DO $grants$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'content_submit(UUID, TEXT)',
    'content_approve(UUID, TEXT)',
    'content_reject(UUID, TEXT)',
    'content_schedule(UUID, TIMESTAMPTZ)',
    'content_unschedule(UUID)',
    'content_publish_now(UUID)',
    'content_mark_posted(UUID, TEXT)',
    'content_variant_result(UUID, BOOLEAN, TEXT, TEXT, TEXT)',
    'content_move_card(UUID, UUID, INTEGER)',
    'content_next_slot(UUID, TIMESTAMPTZ)',
    'content_lint_subject(UUID)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;

  EXECUTE 'REVOKE ALL ON FUNCTION content_record_lint(UUID, TEXT, JSONB) FROM PUBLIC, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION content_record_lint(UUID, TEXT, JSONB) TO service_role';
END
$grants$;
