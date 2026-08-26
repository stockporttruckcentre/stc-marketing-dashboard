-- =============================================================
-- Content, and the thing that must not have happened to it.
--
-- Migration 054 adds channels, variants, campaigns, templates, tags, a
-- board and a library, and it rewrites the row level security on
-- `social_posts`, a table that already worked.
--
-- CLAUDE.md LAW 3 is about deletion by omission: a screen that comes
-- back smaller than it was, with nothing showing in `git status`. The
-- database version of that failure is quieter still. Nobody drops a
-- table. A policy is rewritten in better words, and a person who could
-- write posts on Tuesday cannot on Wednesday, and the screen looks
-- exactly the same until somebody presses the button.
--
-- So the first half of this file is not about the new model at all. It
-- asserts that everybody who could do something before can still do it,
-- against the roles this installation actually has, none of which holds
-- a role template.
--
-- Run with `npm run check:content`.
-- =============================================================
\set ON_ERROR_STOP on

BEGIN;

-- -------------------------------------------------------------
-- The people.
--
-- Deliberately on the legacy path, no role template, because that is
-- every account in the live database. If the new capabilities were
-- required outright, every one of these would lose Content.
-- -------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('dd000000-0000-0000-0000-000000000001', 'content.admin@example.test'),
  ('dd000000-0000-0000-0000-000000000002', 'content.marketer@example.test'),
  ('dd000000-0000-0000-0000-000000000003', 'content.sales@example.test'),
  ('dd000000-0000-0000-0000-000000000004', 'content.viewer@example.test'),
  ('dd000000-0000-0000-0000-000000000005', 'content.other.marketer@example.test'),
  ('dd000000-0000-0000-0000-000000000006', 'content.editany@example.test')
ON CONFLICT DO NOTHING;

UPDATE profiles SET role = 'admin',    role_template_id = NULL WHERE id = 'dd000000-0000-0000-0000-000000000001';
UPDATE profiles SET role = 'marketer', role_template_id = NULL WHERE id = 'dd000000-0000-0000-0000-000000000002';
UPDATE profiles SET role = 'sales',    role_template_id = NULL WHERE id = 'dd000000-0000-0000-0000-000000000003';
UPDATE profiles SET role = 'viewer',   role_template_id = NULL WHERE id = 'dd000000-0000-0000-0000-000000000004';
UPDATE profiles SET role = 'marketer', role_template_id = NULL WHERE id = 'dd000000-0000-0000-0000-000000000005';

-- One person on the new model, to prove the fine grained half works as
-- well as the compatibility half.
UPDATE profiles SET role = 'viewer',
       role_template_id = (SELECT id FROM role_templates WHERE slug = 'member')
  WHERE id = 'dd000000-0000-0000-0000-000000000006';
INSERT INTO user_capability_overrides (user_id, capability, granted, scope, reason) VALUES
  ('dd000000-0000-0000-0000-000000000006', 'social.editAny', TRUE, 'company',
   'Edits the whole team''s drafts. Role unchanged.')
ON CONFLICT (user_id, capability) DO UPDATE SET granted = EXCLUDED.granted;

DO $$
BEGIN
  IF (SELECT count(*) FROM profiles WHERE id::TEXT LIKE 'dd000000-%') <> 6 THEN
    RAISE EXCEPTION 'fixture: expected six people, found %',
      (SELECT count(*) FROM profiles WHERE id::TEXT LIKE 'dd000000-%');
  END IF;
  IF (SELECT count(*) FROM social_networks WHERE is_active) < 10 THEN
    RAISE EXCEPTION 'fixture: the networks were not seeded';
  END IF;
  IF (SELECT count(*) FROM social_board_columns WHERE is_active) < 6 THEN
    RAISE EXCEPTION 'fixture: the board columns were not seeded';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_who UUID) RETURNS VOID
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_who::TEXT, TRUE);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
END;
$fn$;

-- -------------------------------------------------------------
-- Everything from here runs as `authenticated`.
--
-- Not decoration. `postgres` owns these tables and owners bypass row
-- level security, so a file that stays superuser asserts that the
-- policies parse and nothing more: every refusal below would pass by
-- writing the row it claims to have blocked. This file's first run did
-- exactly that, and reported a read only viewer writing a post.
-- -------------------------------------------------------------
SET LOCAL ROLE authenticated;

-- =============================================================
-- PART ONE: nothing was taken away.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The three helpers answer for the roles that exist today.
--
-- Before 049 the policy was `current_role_safe() IN ('admin','marketer')`.
-- `may_write_content()` has to answer true for exactly those, or the
-- rewrite is a removal wearing better words.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.expect_write(p_who UUID, p_label TEXT, p_want BOOLEAN)
RETURNS VOID LANGUAGE plpgsql AS $fn$
DECLARE got BOOLEAN; was BOOLEAN;
BEGIN
  PERFORM pg_temp.act_as(p_who);
  SELECT may_write_content() INTO got;
  -- The rule the policy used before 049, evaluated as it was written.
  SELECT current_role_safe() IN ('admin', 'marketer') INTO was;
  IF got IS DISTINCT FROM p_want THEN
    RAISE EXCEPTION 'may_write_content() for % returned %, wanted %', p_label, got, p_want;
  END IF;
  IF was AND NOT got THEN
    RAISE EXCEPTION
      '% could write content before 049 and cannot now. That is a removal, not a rewrite.', p_label;
  END IF;
END;
$fn$;

DO $$
BEGIN
  PERFORM pg_temp.expect_write('dd000000-0000-0000-0000-000000000001', 'admin',    TRUE);
  PERFORM pg_temp.expect_write('dd000000-0000-0000-0000-000000000002', 'marketer', TRUE);
  PERFORM pg_temp.expect_write('dd000000-0000-0000-0000-000000000003', 'sales',    FALSE);
  PERFORM pg_temp.expect_write('dd000000-0000-0000-0000-000000000004', 'viewer',   FALSE);
  -- And the new path reaches the same place from the other direction.
  PERFORM pg_temp.expect_write('dd000000-0000-0000-0000-000000000006', 'member with editAny', TRUE);
END $$;

-- -------------------------------------------------------------
-- 1b. The compatibility branch on its own.
--
-- The assertion above passes for two different reasons now, and only
-- one of them is the one being tested. `lib/crm/permissions.ts` maps
-- the legacy roles onto the new capabilities, so `command_may('social.draft')`
-- already answers true for a marketer and the
-- `OR command_may('marketing.edit')` branch never has to carry
-- anything.
--
-- That was found by breaking `may_write_content()` deliberately and
-- watching this file pass anyway. A check that cannot fail proves
-- nothing, so the mapping is taken away here, inside the transaction
-- that rolls back, and the compatibility branch is asked to hold on its
-- own. It is what would carry Content if the seed were ever regenerated
-- from a permissions file that had lost the social capabilities.
-- -------------------------------------------------------------
RESET ROLE;
CREATE TEMP TABLE legacy_social_grants ON COMMIT DROP AS
  SELECT * FROM command_capability_roles WHERE capability LIKE 'social.%';
DELETE FROM command_capability_roles WHERE capability LIKE 'social.%';
GRANT SELECT ON legacy_social_grants TO authenticated;
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  IF (SELECT count(*) FROM legacy_social_grants) = 0 THEN
    RAISE EXCEPTION
      'fixture: the legacy seed carries no social capabilities, so this assertion is testing nothing';
  END IF;

  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000002');
  IF command_may('social.draft') THEN
    RAISE EXCEPTION 'fixture: social.draft is still reachable, so the branch under test is not isolated';
  END IF;
  IF NOT may_write_content() THEN
    RAISE EXCEPTION
      'with the new capabilities gone, marketing.edit no longer lets a marketer write. That is the removal LAW 3 is about.';
  END IF;

  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000001');
  IF NOT may_approve_content() THEN
    RAISE EXCEPTION 'with the new capabilities gone, an administrator can no longer approve';
  END IF;
  IF NOT may_read_content() THEN
    RAISE EXCEPTION 'with the new capabilities gone, nobody can read the planner';
  END IF;
END $$;

RESET ROLE;
INSERT INTO command_capability_roles SELECT * FROM legacy_social_grants;
SET LOCAL ROLE authenticated;

-- Reading. Everybody who works here could read the planner before,
-- because the old policy was `auth.role() = 'authenticated'`.
DO $$
DECLARE who UUID; label TEXT;
BEGIN
  FOR who, label IN SELECT id, email FROM profiles WHERE id::TEXT LIKE 'dd000000-%' LOOP
    PERFORM pg_temp.act_as(who);
    IF NOT may_read_content() THEN
      RAISE EXCEPTION '% could read the planner before 049 and cannot now', label;
    END IF;
  END LOOP;
END $$;

-- -------------------------------------------------------------
-- 2. The old write path still works, end to end.
--
-- `command_create_post` is what the command bar calls and what
-- `lib/social/posts.ts` calls from the composer. It writes columns that
-- now have a trigger on them and a rewritten policy over them.
-- -------------------------------------------------------------
DO $$
DECLARE made JSONB; post_id UUID; row_ social_posts;
BEGIN
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000002');

  made := command_create_post(
    'STC is hiring fitters.',
    ARRAY['LinkedIn', 'X'],
    CURRENT_DATE + 3,
    'Careers page in the first comment.',
    ARRAY['hiring', 'engineering'],
    NULL);

  post_id := (made ->> 'id')::UUID;
  SELECT * INTO row_ FROM social_posts WHERE id = post_id;

  IF row_.id IS NULL THEN
    RAISE EXCEPTION 'command_create_post no longer produces a readable row';
  END IF;
  IF row_.status <> 'pending_review' THEN
    RAISE EXCEPTION 'a marketer''s post used to go to pending_review, it now goes to %', row_.status;
  END IF;
  IF row_.platform <> ARRAY['LinkedIn', 'X'] THEN
    RAISE EXCEPTION 'the platform array the composer wrote came back as %', row_.platform;
  END IF;
  IF row_.scheduled_date <> CURRENT_DATE + 3 THEN
    RAISE EXCEPTION 'the scheduled date the composer wrote came back as %', row_.scheduled_date;
  END IF;
  IF row_.hashtags <> ARRAY['hiring', 'engineering'] THEN
    RAISE EXCEPTION 'the hashtags came back as %', row_.hashtags;
  END IF;

  -- And the planner's own updates still land.
  --
  -- Content, not status. Migration 055 closes the status column: it was
  -- writable by anybody who could edit a post, which meant approval was
  -- one PATCH away for every marketer whatever the screen showed.
  -- Approving still happens, through `content_approve`, and
  -- `check:workflow` asserts that the same people can still do it.
  UPDATE social_posts SET content = 'STC is hiring fitters. Apply by Friday.'
   WHERE id = post_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'a marketer can no longer update a post';
  END IF;
END $$;

-- An administrator could delete. That is `social_delete`, rewritten.
DO $$
DECLARE victim UUID;
BEGIN
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000001');
  INSERT INTO social_posts (content, platform, scheduled_date, created_by)
  VALUES ('Delete me.', '{}', CURRENT_DATE, 'content.admin@example.test')
  RETURNING id INTO victim;

  DELETE FROM social_posts WHERE id = victim;
  IF EXISTS (SELECT 1 FROM social_posts WHERE id = victim) THEN
    RAISE EXCEPTION 'an administrator could delete a post before 049 and cannot now';
  END IF;
END $$;

-- And somebody who could not, still cannot.
DO $$
DECLARE n INTEGER;
BEGIN
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000004');
  INSERT INTO social_posts (content, platform, scheduled_date, created_by)
  VALUES ('A viewer should not be able to write this.', '{}', CURRENT_DATE, 'viewer');
  RAISE EXCEPTION 'a read only viewer wrote a post';
EXCEPTION
  WHEN insufficient_privilege THEN NULL;
  WHEN raise_exception THEN
    IF SQLERRM = 'a read only viewer wrote a post' THEN RAISE; END IF;
END $$;

-- =============================================================
-- PART TWO: the new model.
-- =============================================================

-- -------------------------------------------------------------
-- 3. Channels, variants, and the old columns staying true.
-- -------------------------------------------------------------
DO $$
DECLARE
  li UUID; xx UUID; post_id UUID; row_ social_posts;
BEGIN
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000001');

  INSERT INTO social_channels (network_key, handle, display_name, state, connected_by)
  VALUES ('linkedin', 'stc', 'Stockport Truck Centre', 'connected', current_actor())
  RETURNING id INTO li;
  INSERT INTO social_channels (network_key, handle, display_name, state, connected_by)
  VALUES ('x', 'stc', 'Stockport Truck Centre', 'connected', current_actor())
  RETURNING id INTO xx;

  INSERT INTO social_posts (content, platform, scheduled_date, created_by, author_id)
  VALUES ('One idea.', '{}', CURRENT_DATE, 'content.admin@example.test', current_actor())
  RETURNING id INTO post_id;

  INSERT INTO social_post_variants (post_id, channel_id) VALUES (post_id, li);
  INSERT INTO social_post_variants (post_id, channel_id, content)
  VALUES (post_id, xx, 'One idea, in 280.');

  -- The trigger runs on the post, so the post has to be touched. The
  -- variant trigger does that; this asserts it actually did.
  SELECT * INTO row_ FROM social_posts WHERE id = post_id;
  UPDATE social_posts SET updated_at = NOW() WHERE id = post_id;
  SELECT * INTO row_ FROM social_posts WHERE id = post_id;

  IF NOT (row_.platform @> ARRAY['LinkedIn'] AND row_.platform @> ARRAY['X']) THEN
    RAISE EXCEPTION
      'the planner reads social_posts.platform and it says %, but the post has a LinkedIn and an X variant',
      row_.platform;
  END IF;

  -- A time, and the date the old readers use, derived rather than typed.
  UPDATE social_posts SET scheduled_at = (CURRENT_DATE + 5)::TIMESTAMPTZ + INTERVAL '14 hours'
   WHERE id = post_id;
  SELECT * INTO row_ FROM social_posts WHERE id = post_id;
  IF row_.scheduled_date <> (CURRENT_DATE + 5) THEN
    RAISE EXCEPTION 'scheduled_at was set to day % and scheduled_date says %',
      CURRENT_DATE + 5, row_.scheduled_date;
  END IF;

  -- One variant per channel per post. Two is how a post goes out twice.
  BEGIN
    INSERT INTO social_post_variants (post_id, channel_id) VALUES (post_id, li);
    RAISE EXCEPTION 'a post took two variants for the same channel';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
END $$;

-- -------------------------------------------------------------
-- 4. Whose draft is whose.
--
-- The user's requirement in the small: a member edits their own work.
-- Somebody elevated for one function edits everybody's, without their
-- role moving.
-- -------------------------------------------------------------
DO $$
DECLARE mine UUID; theirs UUID; n INTEGER;
BEGIN
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000002');
  INSERT INTO social_posts (content, platform, scheduled_date, created_by, author_id)
  VALUES ('Written by marketer one.', '{}', CURRENT_DATE, 'marketer one', current_actor())
  RETURNING id INTO mine;

  -- Their own: yes.
  UPDATE social_posts SET content = 'Edited by its author.' WHERE id = mine;
  IF NOT FOUND THEN RAISE EXCEPTION 'an author cannot edit their own draft'; END IF;

  -- Somebody else's, as a plain member of the same role: the old
  -- `marketing.edit` still allows it, and that is deliberate. Taking it
  -- away would be a removal. What is asserted here is that the fine
  -- grained path reaches the same answer for the right reason.
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000006');
  UPDATE social_posts SET content = 'Edited by the elevated editor.' WHERE id = mine;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'social.editAny did not let somebody edit another person''s draft';
  END IF;

  -- And a person with neither cannot.
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000003');
  UPDATE social_posts SET content = 'Sales should not reach this.' WHERE id = mine;
  IF FOUND THEN
    RAISE EXCEPTION 'somebody with no content capability edited a draft';
  END IF;
END $$;

-- A variant follows its post's answer rather than carrying a second one.
DO $$
DECLARE p_id UUID; ch UUID; n INTEGER;
BEGIN
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000002');
  SELECT id INTO ch FROM social_channels WHERE network_key = 'linkedin' LIMIT 1;
  INSERT INTO social_posts (content, platform, scheduled_date, created_by, author_id)
  VALUES ('Variant permission.', '{}', CURRENT_DATE, 'marketer one', current_actor())
  RETURNING id INTO p_id;
  INSERT INTO social_post_variants (post_id, channel_id) VALUES (p_id, ch);

  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000003');
  UPDATE social_post_variants SET content = 'Sales should not reach this either.'
   WHERE social_post_variants.post_id = p_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE EXCEPTION 'somebody who cannot edit a post edited its variant';
  END IF;
END $$;

-- -------------------------------------------------------------
-- 5. Connecting a channel is not writing a post.
--
-- The whole point of the fine grained set: a Marketer writes and does
-- not hold the keys to the company's accounts.
-- -------------------------------------------------------------
DO $$
DECLARE n INTEGER;
BEGIN
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000006');
  IF command_may('social.channels') THEN
    RAISE EXCEPTION 'a member holds social.channels, which the role template must not grant';
  END IF;

  BEGIN
    INSERT INTO social_channels (network_key, handle, display_name, state)
    VALUES ('bluesky', 'not-ours', 'Not ours', 'connected');
    RAISE EXCEPTION 'a member connected a channel';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM = 'a member connected a channel' THEN RAISE; END IF;
  END;
END $$;

-- -------------------------------------------------------------
-- 6. The board cannot disagree with the post.
--
-- Every column maps to a status the post table will actually accept. A
-- column pointing at a status the CHECK refuses is a card nobody can
-- drop.
-- -------------------------------------------------------------
DO $$
DECLARE bad TEXT; probe UUID;
BEGIN
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000001');
  INSERT INTO social_posts (content, platform, scheduled_date, created_by)
  VALUES ('Board probe.', '{}', CURRENT_DATE, 'admin') RETURNING id INTO probe;

  FOR bad IN SELECT DISTINCT maps_to_status FROM social_board_columns WHERE is_active LOOP
    BEGIN
      /* Through the gate migration 055 puts on the column, because that
         is the only way the status moves now. What is under test is the
         CHECK constraint, not the gate. */
      PERFORM set_config('app.content_transition', 'on', TRUE);
      UPDATE social_posts SET status = bad WHERE id = probe;
      PERFORM set_config('app.content_transition', '', TRUE);
    EXCEPTION WHEN check_violation THEN
      RAISE EXCEPTION 'a board column maps to status "%", which social_posts refuses', bad;
    END;
  END LOOP;

  -- And every existing post landed on a column, or the board draws an
  -- empty planner over a full table.
  IF EXISTS (SELECT 1 FROM social_posts WHERE board_column_id IS NULL AND status <> 'draft') THEN
    RAISE EXCEPTION 'posts exist that no board column would show';
  END IF;
END $$;

-- -------------------------------------------------------------
-- 7. The networks describe themselves consistently.
--
-- The composer enforces these, so a wrong one is a post refused by a
-- network after everybody thought it went out.
-- -------------------------------------------------------------
DO $$
DECLARE bad TEXT;
BEGIN
  SELECT string_agg(key, ', ') INTO bad FROM social_networks WHERE char_limit <= 0;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'networks with no character limit: %', bad; END IF;

  SELECT string_agg(key, ', ') INTO bad
    FROM social_networks WHERE requires_media AND media_max = 0 AND video_max_seconds = 0;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'these require media and accept none, so nothing can ever be posted to them: %', bad;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM social_networks WHERE key = 'instagram' AND requires_media) THEN
    RAISE EXCEPTION 'Instagram no longer requires media, which the composer relies on';
  END IF;
END $$;

-- -------------------------------------------------------------
-- 8. Soft delete reaches the new tables.
-- -------------------------------------------------------------
DO $$
DECLARE camp UUID; n INTEGER;
BEGIN
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000001');
  INSERT INTO social_campaigns (name, slug, created_by)
  VALUES ('Mainnet launch', 'mainnet_launch', current_actor()) RETURNING id INTO camp;

  PERFORM soft_delete('social_campaigns', camp, 'Postponed.');

  -- Gone for everybody else.
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000002');
  SELECT count(*) INTO n FROM social_campaigns WHERE id = camp;
  IF n <> 0 THEN RAISE EXCEPTION 'a deleted campaign is still visible to everybody'; END IF;

  -- Still findable by whoever deleted it.
  PERFORM pg_temp.act_as('dd000000-0000-0000-0000-000000000001');
  SELECT count(*) INTO n FROM social_campaigns WHERE id = camp;
  IF n <> 1 THEN RAISE EXCEPTION 'the person who deleted a campaign cannot find it again'; END IF;
END $$;

-- -------------------------------------------------------------
-- 9. A column nobody can type into cannot be edited by typing.
--
-- CLAUDE.md section 11: `command_writable_columns` is the only thing
-- `/api/command/edit` will write. A new column that should be reachable
-- and is not is a feature the bar cannot see.
-- -------------------------------------------------------------
DO $$
DECLARE missing TEXT;
BEGIN
  SELECT string_agg(c, ', ') INTO missing FROM unnest(ARRAY[
    'first_comment', 'internal_note', 'link_url', 'scheduled_at'
  ]) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM command_writable_columns w
     WHERE w.table_name = 'social_posts' AND w.column_name = c);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'these social_posts columns cannot be reached by the command bar: %', missing;
  END IF;
END $$;

-- -------------------------------------------------------------
-- 10. The posts that were already here.
--
-- The claim migration 060 makes, carried out against a row shaped
-- exactly like the ones in the live database: a `platform` array, a
-- `scheduled_date` with no time, a name in `created_by`, and none of
-- the columns 054 added.
--
-- What must be true afterwards is not "the row survived". A row that
-- survives and cannot be scheduled, previewed or submitted is a row
-- that looks present and is inert, which is the worse failure and the
-- one this asserts against.
-- -------------------------------------------------------------
DO $$
DECLARE p UUID; n INT; before_ch INT; after_ch INT; at TIMESTAMPTZ; col UUID;
BEGIN
  SELECT count(*) INTO before_ch FROM social_channels;

  INSERT INTO social_posts (content, platform, scheduled_date, status, created_by)
  VALUES ('New arrival on the yard: 2019 Schmitz curtainsider.',
          ARRAY['LinkedIn','Facebook'], CURRENT_DATE + 3, 'draft', 'Somebody')
  RETURNING id INTO p;

  -- 054's own trigger, which every insert goes through.
  SELECT board_column_id INTO col FROM social_posts WHERE id = p;
  IF col IS NULL THEN
    RAISE EXCEPTION 'a post written the old way lands on no board column';
  END IF;

  -- And 060, which is what gives it somewhere to go.
  PERFORM content_adopt_legacy_posts();

  SELECT count(*) INTO n FROM social_post_variants WHERE post_id = p;
  IF n <> 2 THEN
    RAISE EXCEPTION 'the existing post got % channels rather than the 2 it named', n;
  END IF;

  -- Every network it named now exists as an account, whether or not
  -- one was already here: this fixture has a LinkedIn channel of its
  -- own further up, so the assertion is about the set and not a count
  -- of new rows.
  SELECT count(*) INTO after_ch FROM social_channels;
  IF after_ch < before_ch THEN
    RAISE EXCEPTION 'adopting the old posts removed a channel';
  END IF;

  -- Run again, because somebody pasting a bundle a second time is the
  -- ordinary case. Nothing may move.
  PERFORM content_adopt_legacy_posts();
  IF (SELECT count(*) FROM social_channels) <> after_ch THEN
    RAISE EXCEPTION 'running it a second time made more channels';
  END IF;
  IF (SELECT count(*) FROM social_post_variants WHERE post_id = p) <> 2 THEN
    RAISE EXCEPTION 'running it a second time made more variants';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM social_post_variants v
      JOIN social_channels c ON c.id = v.channel_id
     WHERE v.post_id = p AND c.network_key = 'linkedin')
  THEN RAISE EXCEPTION 'the word LinkedIn did not resolve to a LinkedIn channel'; END IF;

  -- The words stay in one place. Copying them into each variant would
  -- make two things to edit where the post has one.
  IF EXISTS (SELECT 1 FROM social_post_variants WHERE post_id = p AND content IS NOT NULL) THEN
    RAISE EXCEPTION 'a variant copied the post rather than deferring to it';
  END IF;

  -- And nothing claims this product published anything.
  IF EXISTS (SELECT 1 FROM social_post_variants WHERE post_id = p AND state <> 'pending') THEN
    RAISE EXCEPTION 'a backfilled variant claims a state this product never reached';
  END IF;

  SELECT scheduled_at INTO at FROM social_posts WHERE id = p;
  IF at IS NULL THEN
    RAISE EXCEPTION 'a post with a date and no time still has no time, so it sorts as midnight';
  END IF;
END $$;

ROLLBACK;
