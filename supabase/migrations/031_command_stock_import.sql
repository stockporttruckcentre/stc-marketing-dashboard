-- =============================================================
-- 031. The supplier's stock spreadsheet, written down once.
--
-- The stock screen has had an import button since it was built. It read
-- the file, matched the columns against the STOCK_TRAILERS dictionary,
-- showed what it was going to do, and then wrote the records straight
-- from the browser with a PostgREST insert. That put the whole of the
-- import's authority in the client: which columns may be written, what a
-- row with no stock number means, and whether the caller may write
-- stock at all were all decided by code somebody can edit in a console.
--
-- It is the same operation this function now performs for the screen
-- and for a sentence alike, in one transaction, so a failure on row 900
-- leaves no half loaded stock list from either.
--
-- WHAT IT REFUSES.
--
-- A row with no stock number. That is the dictionary's required field
-- and the only thing that identifies a unit: a row without one cannot be
-- found again, cannot be matched next time the supplier sends a file,
-- and is exactly the "Unknown" record the CRM import was fixed for.
--
-- Any column outside `command_writable_columns`, which is generated from
-- the same table the field editor and every other write consults. A
-- hand rolled request naming `profit` gets a refusal rather than a
-- number nobody can explain.
--
-- SECURITY INVOKER, gated on `stock.edit`, which is exactly what the
-- import button on the stock screen gates on.
-- =============================================================

CREATE OR REPLACE FUNCTION command_import_stock(
  p_rows JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  wanted  INTEGER;
  made    INTEGER := 0;
  row_in  JSONB;
  allowed TEXT[];
  columns TEXT[];
  values  TEXT[];
  key     TEXT;
  stmt    TEXT;
BEGIN
  IF NOT command_may('stock.edit') THEN
    RAISE EXCEPTION 'you do not have stock.edit';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'nothing said what stock to import';
  END IF;

  wanted := jsonb_array_length(p_rows);
  IF wanted = 0 THEN
    RAISE EXCEPTION 'that file had no rows this could file under a stock number';
  END IF;
  IF wanted > 5000 THEN
    RAISE EXCEPTION 'that is % rows, which is more than 5000. Split the file and import it in parts', wanted;
  END IF;

  SELECT array_agg(column_name) INTO allowed
    FROM command_writable_columns WHERE table_name = 'stock_trailers';

  FOR row_in IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    IF COALESCE(btrim(row_in ->> 'stc_no'), '') = '' THEN
      RAISE EXCEPTION 'a row with no stock number reached the database; nothing has been imported';
    END IF;

    -- What the screen has always defaulted a new unit to. Said here so
    -- both callers get it rather than only the one that remembered.
    columns := ARRAY['status'];
    values  := ARRAY[quote_literal(COALESCE(NULLIF(btrim(row_in ->> 'status'), ''), 'in_stock'))];

    FOR key IN SELECT jsonb_object_keys(row_in)
    LOOP
      IF NOT (key = ANY(allowed)) THEN
        RAISE EXCEPTION 'the import tried to write %, which is not a column it may write', key;
      END IF;
      IF key = 'status' THEN CONTINUE; END IF;

      columns := columns || key;
      values := values || CASE
        WHEN jsonb_typeof(row_in -> key) IN ('object', 'array')
          THEN quote_literal(row_in -> key) || '::JSONB'
        WHEN jsonb_typeof(row_in -> key) = 'null' THEN 'NULL'
        ELSE quote_literal(row_in ->> key)
      END;
    END LOOP;

    stmt := format('INSERT INTO stock_trailers (%s) VALUES (%s)',
      array_to_string(ARRAY(SELECT quote_ident(c) FROM unnest(columns) AS c), ', '),
      array_to_string(values, ', '));
    EXECUTE stmt;

    made := made + 1;
  END LOOP;

  -- Every unit or none. The old path inserted from the browser and had
  -- no answer at all for a failure halfway down a supplier's file.
  IF made <> wanted THEN
    RAISE EXCEPTION
      'expected to import % trailers but imported %; nothing has been changed', wanted, made;
  END IF;

  RETURN jsonb_build_object('inserted', made);
END;
$$;

REVOKE ALL ON FUNCTION command_import_stock(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_import_stock(JSONB) TO authenticated;

-- -------------------------------------------------------------
-- The dispatch learns the stock import
-- -------------------------------------------------------------
--
-- Re-created because that is how a plpgsql function changes. Everything
-- except the one new branch is exactly what migration 030 left, and this
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
