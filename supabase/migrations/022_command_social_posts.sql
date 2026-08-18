-- =============================================================
-- 022. Writing a social post.
--
-- The composer fills in three things nobody types: who wrote it, whether
-- it needs approving, and the date it goes out when nobody picked one.
-- They are properties of WHO IS WRITING rather than of what the post
-- says, which is why they cannot come from a sentence and why a client
-- must not decide them: a browser that chose its own status could put a
-- post straight to approved.
--
-- So the operation lives here and both callers use it: the composer
-- through `lib/social/posts.ts`, and the command bar through its
-- capability registry, so "create a LinkedIn post saying ..." produces
-- exactly the row the form produces.
--
-- WHY THE PLATFORMS ARRIVE AS TEXT.
--
-- A plan's literals are single values, and a post goes out on several
-- platforms. The sentence reader joins them with commas and this splits
-- them, rather than the plan growing an array literal that every other
-- part of the language would then have to understand.
--
-- SECURITY INVOKER, gated on marketing.edit, which is what the social
-- planner gates on.
-- =============================================================

CREATE OR REPLACE FUNCTION command_create_post(
  p_content   TEXT,
  p_platforms TEXT[] DEFAULT NULL,
  p_scheduled DATE   DEFAULT NULL,
  p_caption   TEXT   DEFAULT NULL,
  p_hashtags  TEXT[] DEFAULT NULL,
  p_image     TEXT   DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  me       UUID := auth.uid();
  author   TEXT;
  my_role  TEXT;
  state    TEXT;
  places   TEXT[];
  made     UUID;
BEGIN
  IF NOT command_may('marketing.edit') THEN
    RAISE EXCEPTION 'you do not have marketing.edit';
  END IF;

  IF p_content IS NULL OR btrim(p_content) = '' THEN
    RAISE EXCEPTION 'a post with nothing in it is not a post';
  END IF;

  SELECT COALESCE(full_name, email), role INTO author, my_role
    FROM profiles WHERE id = me;
  IF author IS NULL THEN
    RAISE EXCEPTION 'nothing says who is writing this';
  END IF;

  -- The same rule the composer applies: an administrator's post is
  -- approved as it is written, everybody else's goes into the queue.
  state := CASE WHEN my_role = 'admin' THEN 'approved' ELSE 'pending_review' END;

  -- The composer's own default, so a sentence that names no platform
  -- produces the post the form would have produced.
  places := CASE
    WHEN p_platforms IS NULL OR array_length(p_platforms, 1) IS NULL
      THEN ARRAY['Facebook', 'LinkedIn']
    ELSE p_platforms
  END;

  INSERT INTO social_posts (
    content, platform, scheduled_date, status, created_by,
    caption, hashtags, image_url
  ) VALUES (
    btrim(p_content), places, COALESCE(p_scheduled, CURRENT_DATE), state, author,
    p_caption, COALESCE(p_hashtags, '{}'::TEXT[]), p_image
  )
  RETURNING id INTO made;

  RETURN jsonb_build_object('id', made, 'status', state, 'author', author);
END;
$$;

REVOKE ALL ON FUNCTION command_create_post(TEXT, TEXT[], DATE, TEXT, TEXT[], TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_create_post(TEXT, TEXT[], DATE, TEXT, TEXT[], TEXT) TO authenticated;

-- -------------------------------------------------------------
-- The dispatch learns one more capability
-- -------------------------------------------------------------
--
-- Everything else about `command_perform` is unchanged. This is the
-- whole reason the if chain came out of it in migration 021: an
-- operation is added by replacing the dispatch, not the programme
-- runner.
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
