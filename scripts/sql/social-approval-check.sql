-- =============================================================
-- Sending a post for approval tells whoever approves posts.
--
-- From the business:
--
--   Ensure when I hit send for approval, business development manager
--   gets a notification
--
-- The wiring exists: migration 066 hangs `notify_on_post_status` on
-- `social_posts`, and it calls `notify_capability('social.approve', ...)`
-- when a post reaches `pending_review`. Nothing had ever driven it, and
-- the trigger body ends `EXCEPTION WHEN OTHERS THEN NULL`, so a failure
-- inside it is silent: the post moves, nobody is told, and nothing says
-- why. That is exactly the shape of fault worth a check.
-- =============================================================
DO $check$
DECLARE
  drafter  UUID := '11111111-1111-1111-1111-111111111111';
  bdm      UUID := '22222222-2222-2222-2222-222222222222';
  other    UUID := '33333333-3333-3333-3333-333333333333';
  post     UUID;
  chan     UUID;
  told     INT;
  who      TEXT;
BEGIN
  -- ---- Three people: one who drafts, one who approves, one neither ----
  --
  -- The guard on `profiles` refuses a role change from anybody who is
  -- not an administrator, and this is setting up a world rather than
  -- testing that guard, so it is stood down for the setup and put back.
  ALTER TABLE profiles DISABLE TRIGGER USER;

  INSERT INTO auth.users (id, email) VALUES
    (drafter, 'drafter@stc.example'),
    (bdm,     'bdm@stc.example'),
    (other,   'other@stc.example')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO profiles (id, email, full_name, role, is_active) VALUES
    (drafter, 'drafter@stc.example', 'Dana Drafter', 'marketer', TRUE),
    (bdm,     'bdm@stc.example',     'Bev Dev',      'admin',    TRUE),
    (other,   'other@stc.example',   'Otto Other',   'viewer',   TRUE)
  ON CONFLICT (id) DO UPDATE SET is_active = TRUE, full_name = EXCLUDED.full_name;

  UPDATE profiles SET role_template_id =
    (SELECT id FROM role_templates WHERE slug = 'marketing_exec') WHERE id = drafter;
  UPDATE profiles SET role_template_id =
    (SELECT id FROM role_templates WHERE slug = 'business_development') WHERE id = bdm;
  UPDATE profiles SET role_template_id =
    (SELECT id FROM role_templates WHERE slug = 'finance') WHERE id = other;

  ALTER TABLE profiles ENABLE TRIGGER USER;

  -- The world has to be the one the business describes, or the rest
  -- proves nothing.
  IF NOT actor_holds(drafter, 'social.draft') THEN
    RAISE EXCEPTION 'the drafter cannot draft, so this check is set up wrong';
  END IF;
  IF actor_holds(drafter, 'social.approve') THEN
    RAISE EXCEPTION 'the drafter can approve, so they would be excluded as the actor';
  END IF;
  IF NOT actor_holds(bdm, 'social.approve') THEN
    RAISE EXCEPTION 'Business Development does not hold social.approve, so they can never be told';
  END IF;
  RAISE NOTICE 'Business Development holds social.approve, so they are somebody to tell';

  -- ---- A post with somewhere to go ----
  INSERT INTO social_channels (network_key, handle, display_name, state, is_active)
  VALUES ('linkedin', 'stc-check', 'STC LinkedIn', 'connected', TRUE)
  RETURNING id INTO chan;

  PERFORM set_config('request.jwt.claim.sub', drafter::TEXT, TRUE);

  INSERT INTO social_posts (content, platform, scheduled_date, status, created_by, author_id, image_url)
  VALUES ('A post with a picture on it', '{}', CURRENT_DATE, 'draft', 'Dana Drafter', drafter,
          'https://example.test/truck.png')
  RETURNING id INTO post;

  INSERT INTO social_post_variants (post_id, channel_id) VALUES (post, chan);

  DELETE FROM notifications WHERE kind = 'content.review_requested';

  -- ---- Send for approval ----
  PERFORM content_submit(post);

  SELECT COUNT(*) INTO told FROM notifications
   WHERE kind = 'content.review_requested' AND user_id = bdm;
  IF told = 0 THEN
    RAISE EXCEPTION 'the post was submitted and Business Development was not told';
  END IF;
  RAISE NOTICE 'sending a post for approval tells Business Development';

  -- And nobody who has no business approving posts.
  SELECT COUNT(*) INTO told FROM notifications
   WHERE kind = 'content.review_requested' AND user_id = other;
  IF told > 0 THEN
    RAISE EXCEPTION 'somebody who cannot approve posts was told about one';
  END IF;

  -- And not the person who pressed the button, who knows.
  SELECT COUNT(*) INTO told FROM notifications
   WHERE kind = 'content.review_requested' AND user_id = drafter;
  IF told > 0 THEN
    RAISE EXCEPTION 'the person who submitted the post was told about their own submission';
  END IF;
  RAISE NOTICE 'and nobody else, including the person who pressed the button';

  -- ---- What the notification says ----
  SELECT n.title INTO who FROM notifications n
   WHERE n.kind = 'content.review_requested' AND n.user_id = bdm LIMIT 1;
  IF who NOT LIKE '%Dana Drafter%' THEN
    RAISE EXCEPTION 'the notification does not say who submitted it: %', who;
  END IF;
  RAISE NOTICE 'and it names who submitted it: %', who;

  SELECT n.link_path INTO who FROM notifications n
   WHERE n.kind = 'content.review_requested' AND n.user_id = bdm LIMIT 1;
  IF who IS NULL OR who NOT LIKE '%/dashboard/social?post=%' THEN
    RAISE EXCEPTION 'the notification does not link to the post: %', COALESCE(who, 'no link');
  END IF;
  RAISE NOTICE 'and links straight to the post';

  -- ---- The picture is still on the post afterwards ----
  SELECT image_url INTO who FROM social_posts WHERE id = post;
  IF who IS NULL THEN
    RAISE EXCEPTION 'the image came off the post somewhere between drafting and submitting';
  END IF;
  RAISE NOTICE 'and the picture is still on the post: %', who;

  -- ---- A picture can go in the library ----
  --
  -- `social_library.file_id` references `files`, and nothing had ever
  -- written a row to `files`, so the library refused every picture it
  -- was offered. Migration 116 is the missing half.
  DECLARE
    fid UUID;
    lib UUID;
  BEGIN
    fid := file_register('brand-assets', 'check/truck.png', 'truck.png', 'image/png', 12345, NULL, NULL);
    IF fid IS NULL THEN
      RAISE EXCEPTION 'registering a file returned nothing';
    END IF;

    -- The same object twice is the same file, because the key is
    -- deterministic and the bytes are the same bytes.
    IF file_register('brand-assets', 'check/truck.png', 'truck.png', 'image/png', 12345, NULL, NULL) <> fid THEN
      RAISE EXCEPTION 'registering the same object twice made two files';
    END IF;
    RAISE NOTICE 'a picture can be registered, and registering it twice does not duplicate it';

    INSERT INTO social_library (file_id, name, added_by)
    VALUES (fid, 'A truck', drafter)
    RETURNING id INTO lib;
    IF lib IS NULL THEN
      RAISE EXCEPTION 'the library would not take a registered file';
    END IF;
    RAISE NOTICE 'and it goes in the content library, which it never could before';

    -- And it can be found again, which is what `/api/files/<id>` does.
    SELECT f.object_key INTO who FROM file_location(fid) f;
    IF who <> 'check/truck.png' THEN
      RAISE EXCEPTION 'a registered file cannot be found again: %', COALESCE(who, 'nothing came back');
    END IF;
    RAISE NOTICE 'and it can be found again by its id';
  END;

  RAISE NOTICE 'every rule about sending a post for approval holds';
END
$check$;
