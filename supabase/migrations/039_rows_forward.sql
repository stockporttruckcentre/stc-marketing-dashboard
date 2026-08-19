-- =============================================================
-- 039. Rows an operation made, handed to the next operation.
--
-- "Find 20 waste companies within 20 miles of Hyde and put them on
-- Fleet Prospects" is one instruction in two halves, and the second
-- half is about the companies the first half found. Not companies with
-- similar names, not a second search: those exact rows.
--
-- Migration 036 did this for a change set, which returns the ids it
-- inserted so a later step can name one. This does the same for an
-- operation that makes MANY rows, and fixes the two things that stood
-- in the way:
--
--   an import reported how many rows it made and not which
--   a reference always came back as a single piece of text
--
-- The second one is the subtle half. `command_resolve_ref` returned
-- `to_jsonb(value ->> key)`, so a list of twenty ids arrived as one
-- string that looked like a list, and `subjects` came out as one
-- unusable value rather than twenty.
-- =============================================================

-- -------------------------------------------------------------
-- A reference keeps the shape of what it refers to
-- -------------------------------------------------------------
--
-- Scalars still arrive as text, which is what every existing caller
-- casts. An array arrives as an array, and an array standing inside an
-- array is SPLICED into it rather than nested: "the subjects are what
-- step 0 produced" is one reference standing for however many rows
-- there turn out to be.
CREATE OR REPLACE FUNCTION command_resolve_ref(p_value JSONB, p_results JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  ref    JSONB;
  idx    INTEGER;
  key    TEXT;
  outp   JSONB;
  item   JSONB;
  became JSONB;
  found  JSONB;
BEGIN
  IF p_value IS NULL THEN RETURN NULL; END IF;

  -- An array: resolve each member, so "subjects" can hold a reference.
  IF jsonb_typeof(p_value) = 'array' THEN
    outp := '[]'::JSONB;
    FOR item IN SELECT * FROM jsonb_array_elements(p_value)
    LOOP
      became := command_resolve_ref(item, p_results);
      -- A REFERENCE TO A SET, STANDING IN A LIST, IS THAT SET.
      --
      -- Wrapping it would make `subjects` a list holding one list, and
      -- the caller unwrapping that would be a second place that knows
      -- what a reference means.
      IF jsonb_typeof(became) = 'array' AND jsonb_typeof(item) = 'object' THEN
        outp := outp || became;
      ELSE
        outp := outp || jsonb_build_array(became);
      END IF;
    END LOOP;
    RETURN outp;
  END IF;

  IF jsonb_typeof(p_value) <> 'object' THEN RETURN p_value; END IF;

  ref := p_value -> '$from';
  IF ref IS NULL THEN
    -- An object with no reference in it: resolve its values, so an
    -- argument object can carry one.
    outp := '{}'::JSONB;
    FOR key IN SELECT jsonb_object_keys(p_value)
    LOOP
      outp := outp || jsonb_build_object(key, command_resolve_ref(p_value -> key, p_results));
    END LOOP;
    RETURN outp;
  END IF;

  idx := (ref ->> 'step')::INTEGER;
  key := ref ->> 'key';
  IF idx IS NULL OR key IS NULL THEN
    RAISE EXCEPTION 'a reference must name a step and a key';
  END IF;
  IF p_results -> idx IS NULL THEN
    RAISE EXCEPTION 'step % has not produced anything to refer to', idx;
  END IF;

  found := (p_results -> idx) -> key;
  IF found IS NULL OR jsonb_typeof(found) = 'null' THEN
    RAISE EXCEPTION 'step % produced nothing called %', idx, key;
  END IF;

  -- The shape it actually has. Text for a scalar, because that is what
  -- every existing caller casts; the value itself for anything else.
  IF jsonb_typeof(found) IN ('array', 'object') THEN
    RETURN found;
  END IF;
  RETURN to_jsonb(found #>> '{}');
END;
$$;

REVOKE ALL ON FUNCTION command_resolve_ref(JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_resolve_ref(JSONB, JSONB) TO authenticated;


-- -------------------------------------------------------------
-- An import says which rows it made
-- -------------------------------------------------------------
--
-- Re-created because that is how a plpgsql function changes. This is
-- migration 026's function, which is the one that runs, with RETURNING
-- on the insert and the ids in the result. Every check it makes is the
-- same check in the same order: the ceiling, the list by id or by name,
-- the ambiguous name, the writable column allowlist, every row or none.
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
  fresh    UUID;
  ids      UUID[] := ARRAY[]::UUID[];
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

    -- RETURNING is the whole difference from migration 026. An import
    -- reported how many rows it made and not WHICH, so a clause after
    -- it could not be about them.
    stmt := format('INSERT INTO crm_contacts (%s) VALUES (%s) RETURNING id',
      array_to_string(ARRAY(SELECT quote_ident(c) FROM unnest(columns) AS c), ', '),
      array_to_string(values, ', '));
    EXECUTE stmt INTO fresh;
    ids := ids || fresh;

    made := made + 1;
  END LOOP;

  -- Every row or none, like every other operation here. A database error
  -- on row 4,501 leaves zero new customers from the screen and from a
  -- sentence alike.
  IF made <> wanted THEN
    RAISE EXCEPTION
      'expected to import % customers but imported %; nothing has been changed', wanted, made;
  END IF;

  RETURN jsonb_build_object('inserted', made, 'listId', list, 'ids', to_jsonb(ids));
END;
$$;

REVOKE ALL ON FUNCTION command_import_contacts(JSONB, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_import_contacts(JSONB, TEXT, UUID) TO authenticated;
