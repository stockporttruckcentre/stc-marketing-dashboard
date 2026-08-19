-- =============================================================
-- 030. Writing down what the news feeds are carrying.
--
-- The refresh was a route that fetched fourteen feeds and then issued
-- four separate PostgREST calls: two renames, a purge and an upsert.
-- Four transactions, so a failure between them could leave the site with
-- the stale stories deleted and the new ones missing, which is the one
-- state a news screen must never be in.
--
-- The fetch cannot be in a transaction and is not here. What arrives is
-- rows that have already been read, and this writes them in one commit:
-- the legacy source names, the sweep, and the insert.
--
-- SECURITY INVOKER, gated on marketing.edit, which is what the refresh
-- button gates on. This deletes.
-- =============================================================

CREATE OR REPLACE FUNCTION command_refresh_news(
  p_items   JSONB,
  p_max_age INTEGER DEFAULT 14
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  cutoff  DATE;
  purged  INTEGER := 0;
  added   INTEGER := 0;
  before  INTEGER;
BEGIN
  IF NOT command_may('marketing.edit') THEN
    RAISE EXCEPTION 'you do not have marketing.edit';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'nothing said what the feeds were carrying';
  END IF;

  -- Source names from earlier feed configurations, renamed every time so
  -- the chips stay clean without anybody remembering to.
  UPDATE news_items SET source = 'IRTE' WHERE source = 'Transport Engineer';
  UPDATE news_items SET source = 'RHA'  WHERE source = 'UK HGV / haulage';
  DELETE FROM news_items WHERE source = 'Road Transport';

  -- Stale stories go first. A story past the cutoff cannot live on the
  -- site whatever the feeds said.
  cutoff := CURRENT_DATE - GREATEST(COALESCE(p_max_age, 14), 1);
  DELETE FROM news_items WHERE published_date < cutoff;
  GET DIAGNOSTICS purged = ROW_COUNT;

  SELECT COUNT(*) INTO before FROM news_items;

  INSERT INTO news_items (title, source, url, summary, published_date)
  SELECT
    item ->> 'title',
    item ->> 'source',
    item ->> 'url',
    NULLIF(item ->> 'summary', ''),
    (item ->> 'published_date')::DATE
  FROM jsonb_array_elements(p_items) AS item
  WHERE COALESCE(btrim(item ->> 'title'), '') <> ''
    AND COALESCE(btrim(item ->> 'url'), '') <> ''
    AND (item ->> 'published_date')::DATE >= cutoff
  ON CONFLICT (url) DO NOTHING;

  SELECT COUNT(*) - before INTO added FROM news_items;

  RETURN jsonb_build_object('added', added, 'purged', purged);
END;
$$;

REVOKE ALL ON FUNCTION command_refresh_news(JSONB, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_refresh_news(JSONB, INTEGER) TO authenticated;

-- -------------------------------------------------------------
-- The dispatch learns the customer details and the news
-- -------------------------------------------------------------
--
-- Re-created because that is how a plpgsql function changes. Everything
-- except the six new branches is exactly what migration 026 left, and
-- this is the only copy that runs.
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
    outcome := command_import_contacts(
      args -> 'rows', args ->> 'list', (args ->> 'listId')::UUID);
    changed := COALESCE((outcome ->> 'inserted')::INTEGER, 0);

  ELSIF cap = 'user.setRole' THEN
    outcome := command_set_role(p_subjects[1], args ->> 'role');
    changed := 1;

  ELSIF cap = 'contact.addAddress' THEN
    outcome := command_add_address(
      p_subjects[1], args ->> 'address', args ->> 'label',
      COALESCE((args ->> 'primary')::BOOLEAN, FALSE));
    changed := 1;

  ELSIF cap = 'contact.primaryAddress' THEN
    outcome := command_primary_address(p_subjects[1], args ->> 'address');
    changed := 1;

  ELSIF cap = 'contact.addLink' THEN
    outcome := command_add_link(p_subjects[1], args ->> 'url', args ->> 'label', NULL);
    changed := 1;

  ELSIF cap = 'contact.removeLink' THEN
    outcome := command_remove_link(p_subjects[1], args ->> 'which');
    changed := 1;

  ELSIF cap = 'contact.link' THEN
    outcome := command_link_accounts(p_subjects[1], (args ->> 'parent')::UUID);
    changed := 1;

  ELSIF cap = 'news.refresh' THEN
    outcome := command_refresh_news(args -> 'items', (args ->> 'maxAge')::INTEGER);
    changed := COALESCE((outcome ->> 'added')::INTEGER, 0);

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
    RAISE EXCEPTION 'nothing in this database performs %', cap;
  END IF;

  RETURN jsonb_build_object('changed', changed, 'outcome', COALESCE(outcome, '{}'::JSONB));
END;
$$;

REVOKE ALL ON FUNCTION command_invoke_one(TEXT, UUID[], JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_invoke_one(TEXT, UUID[], JSONB) TO authenticated;
