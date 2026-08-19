-- =============================================================
-- 026. Which list an import goes on, and one write path for both callers.
--
-- TWO THINGS WERE WRONG.
--
-- The list was resolved with ILIKE and LIMIT 1. No symbolic reference in
-- this application may mean "whichever row the database returned first",
-- and a name that fits two lists is a question rather than a reason to
-- pick one. Zero refuses by name, one is used, several says which ones
-- it could have meant.
--
-- And the manual route was still inserting in chunks of five hundred and
-- reporting how many were saved before it failed, while the command
-- runtime got one transaction. Sharing the row rules was not enough: two
-- write paths with different atomicity are not the same operation. The
-- route now calls this, with the list it already has by id.
--
-- AN ID OR A NAME, NOT BOTH.
--
-- The screen knows exactly which list is open, so it says so. A sentence
-- knows a name and resolves it here, inside the transaction that does
-- the writing, so a list renamed between the preview and the
-- confirmation cannot end up with somebody's customers on it.
-- =============================================================

DROP FUNCTION IF EXISTS command_import_contacts(JSONB, TEXT);

CREATE OR REPLACE FUNCTION command_import_contacts(
  p_rows    JSONB,
  p_list    TEXT DEFAULT NULL,
  p_list_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  list     UUID;
  matches  INTEGER;
  names    TEXT;
  wanted   INTEGER;
  made     INTEGER := 0;
  row_in   JSONB;
  allowed  TEXT[];
  columns  TEXT[];
  values   TEXT[];
  key      TEXT;
  stmt     TEXT;
BEGIN
  IF NOT command_may('crm.import') THEN
    RAISE EXCEPTION 'you do not have crm.import';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'nothing said what to import';
  END IF;

  wanted := jsonb_array_length(p_rows);
  IF wanted = 0 THEN
    RAISE EXCEPTION 'that file had no rows this could file under a company name';
  END IF;
  IF wanted > 5000 THEN
    RAISE EXCEPTION 'that is % rows, which is more than 5000. Split the file and import it in parts', wanted;
  END IF;

  -- The list. By id when the caller has one, which is what a screen with
  -- a list open has; by name otherwise, and exactly.
  IF p_list_id IS NOT NULL THEN
    SELECT id INTO list FROM crm_lists WHERE id = p_list_id;
    IF list IS NULL THEN
      RAISE EXCEPTION 'that list is not there';
    END IF;
  ELSIF COALESCE(btrim(p_list), '') <> '' THEN
    SELECT COUNT(*) INTO matches FROM crm_lists WHERE name ILIKE btrim(p_list);
    IF matches = 0 THEN
      RAISE EXCEPTION 'there is no list called %', p_list;
    END IF;
    IF matches > 1 THEN
      SELECT string_agg(name, ', ') INTO names FROM crm_lists WHERE name ILIKE btrim(p_list);
      RAISE EXCEPTION
        '% lists match %, so it is not clear which one: %', matches, p_list, names;
    END IF;
    SELECT id INTO list FROM crm_lists WHERE name ILIKE btrim(p_list);
  ELSE
    SELECT COUNT(*) INTO matches FROM crm_lists WHERE is_global = TRUE;
    IF matches = 0 THEN
      RAISE EXCEPTION 'there is no global list for imported customers to go on';
    END IF;
    IF matches > 1 THEN
      RAISE EXCEPTION 'there is more than one global list, so it is not clear where these go';
    END IF;
    SELECT id INTO list FROM crm_lists WHERE is_global = TRUE;
  END IF;

  -- The same allowlist every other write goes through, so a column the
  -- import was never meant to touch cannot be written by naming it in a
  -- file. `list_id` is the one this operation sets itself.
  SELECT array_agg(column_name) INTO allowed
    FROM command_writable_columns WHERE table_name = 'crm_contacts';
  allowed := allowed || ARRAY['list_id', 'links'];

  FOR row_in IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    IF COALESCE(btrim(row_in ->> 'company_name'), '') = '' THEN
      RAISE EXCEPTION 'a row with no company name reached the database; nothing has been imported';
    END IF;

    columns := ARRAY['list_id'];
    values  := ARRAY[quote_literal(list)];

    FOR key IN SELECT jsonb_object_keys(row_in)
    LOOP
      IF NOT (key = ANY(allowed)) THEN
        RAISE EXCEPTION 'the import tried to write %, which is not a column it may write', key;
      END IF;
      IF key = 'list_id' THEN CONTINUE; END IF;

      columns := columns || key;
      values := values || CASE
        WHEN jsonb_typeof(row_in -> key) IN ('object', 'array')
          THEN quote_literal(row_in -> key) || '::JSONB'
        WHEN jsonb_typeof(row_in -> key) = 'null' THEN 'NULL'
        ELSE quote_literal(row_in ->> key)
      END;
    END LOOP;

    stmt := format('INSERT INTO crm_contacts (%s) VALUES (%s)',
      array_to_string(ARRAY(SELECT quote_ident(c) FROM unnest(columns) AS c), ', '),
      array_to_string(values, ', '));
    EXECUTE stmt;

    made := made + 1;
  END LOOP;

  -- Every row or none, like every other operation here. A database error
  -- on row 4,501 leaves zero new customers from the screen and from a
  -- sentence alike.
  IF made <> wanted THEN
    RAISE EXCEPTION
      'expected to import % customers but imported %; nothing has been changed', wanted, made;
  END IF;

  RETURN jsonb_build_object('inserted', made, 'listId', list);
END;
$$;

REVOKE ALL ON FUNCTION command_import_contacts(JSONB, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_import_contacts(JSONB, TEXT, UUID) TO authenticated;

-- -------------------------------------------------------------
-- The dispatch passes the list through as an id
-- -------------------------------------------------------------
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
