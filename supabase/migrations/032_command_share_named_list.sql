-- =============================================================
-- 032. Sharing a list somebody named, rather than one they selected.
--
-- "Share Fleet Prospects with Dave" names the list. Migration 013 takes
-- a list id and the exact set of records on it, which is right for
-- "share these with Dave" off a screen with rows ticked and is the wrong
-- shape for a sentence: it made a person select every record on a list
-- before they could share the list, and selecting ninety nine of a
-- hundred is a refusal rather than a share.
--
-- Sharing in this application IS list membership, so a named list needs
-- no records at all. What it needs is the list, exactly:
--
--   none      refused by name
--   one       used
--   several   refused, saying which ones it could have meant
--
-- There is deliberately no rule that picks one of several. Everything
-- else about it is migration 013's: the global list is refused because
-- everybody can already see it, every named person has to exist, and
-- granting somebody access they already had is not a second grant.
--
-- SECURITY INVOKER, gated on `crm.manageLists`, which is what the CRM
-- screen's own share dialog gates on.
-- =============================================================

CREATE OR REPLACE FUNCTION command_share_named_list(
  p_list     TEXT,
  p_users    UUID[],
  p_can_edit BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  wanted  INTEGER;
  matches INTEGER;
  names   TEXT;
  found   UUID;
  is_glob BOOLEAN;
  present INTEGER;
  granted INTEGER;
  named   TEXT := btrim(COALESCE(p_list, ''));
BEGIN
  IF NOT command_may('crm.manageLists') THEN
    RAISE EXCEPTION 'you do not have crm.manageLists';
  END IF;

  IF named = '' THEN
    RAISE EXCEPTION 'nothing said which list to share';
  END IF;

  wanted := COALESCE(array_length(p_users, 1), 0);
  IF wanted = 0 THEN
    RAISE EXCEPTION 'nothing said who to share it with';
  END IF;

  -- The list, exactly. Row level security decides which lists are
  -- visible here, so a list somebody cannot see is a list that is not
  -- there as far as they are concerned.
  SELECT COUNT(*) INTO matches FROM crm_lists WHERE name ILIKE named;
  IF matches = 0 THEN
    RAISE EXCEPTION 'there is no list called %', named;
  END IF;
  IF matches > 1 THEN
    SELECT string_agg(name, ', ') INTO names FROM crm_lists WHERE name ILIKE named;
    RAISE EXCEPTION
      '% lists match %, so it is not clear which one: %', matches, named, names;
  END IF;
  SELECT id, is_global INTO found, is_glob FROM crm_lists WHERE name ILIKE named;

  IF is_glob THEN
    RAISE EXCEPTION
      'that is the global list, which the whole team can already see; sharing it would change nothing';
  END IF;

  SELECT COUNT(*) INTO present FROM profiles WHERE id = ANY(p_users);
  IF present <> wanted THEN
    RAISE EXCEPTION
      'expected to share with % people but only % of them are here; nothing has been changed',
      wanted, present;
  END IF;

  INSERT INTO crm_list_members (list_id, user_id, can_edit)
  SELECT found, u, COALESCE(p_can_edit, TRUE)
  FROM unnest(p_users) AS u
  ON CONFLICT (list_id, user_id) DO NOTHING;

  GET DIAGNOSTICS granted = ROW_COUNT;

  RETURN jsonb_build_object(
    'listId', found,
    'list', named,
    'asked', wanted,
    'granted', granted,
    'alreadyHad', wanted - granted
  );
END;
$$;

REVOKE ALL ON FUNCTION command_share_named_list(TEXT, UUID[], BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_share_named_list(TEXT, UUID[], BOOLEAN) TO authenticated;

-- -------------------------------------------------------------
-- The dispatch learns sharing a list by name
-- -------------------------------------------------------------
--
-- Re-created because that is how a plpgsql function changes. Everything
-- except the one new branch is exactly what migration 031 left, and this
-- is the only copy that runs.
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

  ELSIF cap = 'list.share' THEN
    outcome := command_share_named_list(
      args ->> 'list',
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

  ELSIF cap = 'stock.import' THEN
    outcome := command_import_stock(args -> 'rows');
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
