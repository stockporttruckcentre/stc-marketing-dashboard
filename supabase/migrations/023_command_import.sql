-- =============================================================
-- 023. Importing a spreadsheet of customers.
--
-- The file itself never reaches the database. It is read where it
-- arrives, against the same column dictionary the import screen uses,
-- and what gets here is rows that have already been checked: a company
-- name on every one of them, and nothing but columns the dictionary can
-- produce.
--
-- WHAT THIS ADDS THAT A ROUTE COULD NOT.
--
-- One transaction. `app/api/crm/import` inserts in chunks of five
-- hundred and reports how many were saved before it failed, which is the
-- honest thing for a route that cannot do better. Here, five thousand
-- rows either all arrive or none do, and the same is true when the
-- import is one step of a longer sentence.
--
-- It also resolves the list BY NAME, inside the transaction, so a list
-- renamed between the preview and the confirmation cannot end up with
-- somebody's customers on it.
--
-- SECURITY INVOKER, gated on crm.import, which is what the route gates
-- on. Bulk inserting five thousand contacts is exactly the thing a read
-- only account should not be able to do.
-- =============================================================

CREATE OR REPLACE FUNCTION command_import_contacts(
  p_rows JSONB,
  p_list TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  list     UUID;
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

  -- The list, by the name the sentence used, or the global one.
  IF p_list IS NULL OR btrim(p_list) = '' THEN
    SELECT id INTO list FROM crm_lists WHERE is_global = TRUE LIMIT 1;
  ELSE
    SELECT id INTO list FROM crm_lists
     WHERE name ILIKE btrim(p_list) ORDER BY is_global DESC LIMIT 1;
    IF list IS NULL THEN
      RAISE EXCEPTION 'there is no list called %', p_list;
    END IF;
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

  -- Every row or none, like every other operation here.
  IF made <> wanted THEN
    RAISE EXCEPTION
      'expected to import % customers but imported %; nothing has been changed', wanted, made;
  END IF;

  RETURN jsonb_build_object('inserted', made, 'listId', list);
END;
$$;

REVOKE ALL ON FUNCTION command_import_contacts(JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_import_contacts(JSONB, TEXT) TO authenticated;

-- -------------------------------------------------------------
-- The dispatch learns one more capability
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
    outcome := command_import_contacts(args -> 'rows', args ->> 'list');
    changed := COALESCE((outcome ->> 'inserted')::INTEGER, 0);

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
