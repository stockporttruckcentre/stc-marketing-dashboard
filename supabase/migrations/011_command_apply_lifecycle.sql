-- =============================================================
-- Creating and deleting through the same door as changing.
--
-- `command_apply` has taken a list of updates since it was written, and
-- everything about it applies to the other two ways a row's life
-- changes: the allowlist that stops a payload naming a column the
-- command bar was never meant to write, the exact-row invariant that
-- turns a silent no-op into a raised exception, and the one transaction
-- that means a command changes everything or nothing.
--
-- Writing a second function for inserts would have meant a second copy
-- of all three, and the copy that drifts is always the one nobody looks
-- at. So a change now carries an `op`, and a change without one is an
-- update, which is what every existing caller sends.
--
--   {"op":"update","table":"stock_trailers","id":"...","set":{...}}
--   {"op":"insert","table":"crm_contacts","set":{...}}
--   {"op":"delete","table":"calendar_events","id":"..."}
--
-- WHAT AN INSERT IS ALLOWED TO SET.
--
-- The same allowlist, for the same reason. A column the registry does
-- not call writable is a column no command may fill in, and creating a
-- row is not a way round that: `command_writable_columns` is a
-- writable-shape boundary and it holds whichever direction a row is
-- moving.
--
-- WHAT A DELETE IS NOT.
--
-- It is not a way to clear a field. `crm_delete` is admin only in this
-- schema and the other policies differ per table, so row level security
-- decides who may delete what, exactly as it decides who may update
-- what. This widens nothing: it makes a set of deletions atomic.
-- =============================================================

CREATE OR REPLACE FUNCTION command_apply(p_changes JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  change      JSONB;
  operation   TEXT;
  target      TEXT;
  row_id      TEXT;
  assignments JSONB;
  col         TEXT;
  columns     TEXT[];
  touched     INTEGER := 0;
  affected    INTEGER;
BEGIN
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array' THEN
    RAISE EXCEPTION 'command_apply expects an array of changes';
  END IF;

  FOR change IN SELECT * FROM jsonb_array_elements(p_changes)
  LOOP
    -- Absent means update, so every caller written before this keeps
    -- working without knowing anything changed.
    operation   := COALESCE(change ->> 'op', 'update');
    target      := change ->> 'table';
    row_id      := change ->> 'id';
    assignments := change -> 'set';

    IF target IS NULL THEN
      RAISE EXCEPTION 'a change must name a table';
    END IF;
    IF operation NOT IN ('update', 'insert', 'delete') THEN
      RAISE EXCEPTION 'a change cannot %', operation;
    END IF;

    -- ---- what it may name ------------------------------------------
    IF operation IN ('update', 'insert') THEN
      IF assignments IS NULL OR jsonb_typeof(assignments) <> 'object' THEN
        RAISE EXCEPTION 'a % of % must say what to set', operation, target;
      END IF;

      columns := ARRAY(SELECT jsonb_object_keys(assignments));
      IF array_length(columns, 1) IS NULL THEN
        RAISE EXCEPTION 'a change to % must set something', target;
      END IF;

      FOREACH col IN ARRAY columns
      LOOP
        IF NOT EXISTS (
          SELECT 1 FROM command_writable_columns w
          WHERE w.table_name = target AND w.column_name = col
        ) THEN
          RAISE EXCEPTION 'the command bar may not write %.%', target, col;
        END IF;
      END LOOP;
    END IF;

    IF operation IN ('update', 'delete') AND row_id IS NULL THEN
      RAISE EXCEPTION 'a % of % must name a row', operation, target;
    END IF;

    -- ---- what it takes to do it ------------------------------------
    --
    -- A PAYLOAD IS NOT A PERMISSION.
    --
    -- The allowlist above says which COLUMNS may be written, which is
    -- the right question for an update and no question at all for a
    -- delete: a delete writes nothing. Without this, anything that
    -- could reach this function could remove any row it could see, and
    -- the runtime's classification of the operation would be the only
    -- thing standing in the way. Row level security is not the answer
    -- either: it decides which rows, not which people may destroy one.
    --
    -- `command_entity_permissions` is generated from the same registry
    -- the command bar reads, so the answer here and the answer there
    -- are one answer. A table with no row in it cannot be created or
    -- deleted through this function at all.
    IF operation IN ('insert', 'delete') THEN
      IF NOT command_may_lifecycle(
        target, CASE operation WHEN 'insert' THEN 'create' ELSE 'delete' END
      ) THEN
        RAISE EXCEPTION
          'you may not % rows of %; nothing has been changed',
          CASE operation WHEN 'insert' THEN 'create' ELSE 'delete' END, target;
      END IF;
    END IF;

    -- ---- doing it --------------------------------------------------
    IF operation = 'update' THEN
      EXECUTE format(
        'UPDATE %1$I AS t SET (%2$s) = (SELECT %2$s FROM jsonb_populate_record(NULL::%1$I, $1)) WHERE t.id = $2::UUID',
        target,
        (SELECT string_agg(format('%I', c), ', ' ORDER BY c) FROM unnest(columns) AS c)
      )
      USING assignments, row_id;

    ELSIF operation = 'insert' THEN
      -- The same typed population an update uses, so a value is cast by
      -- the column that will hold it and nothing from the payload is
      -- ever concatenated into SQL.
      EXECUTE format(
        'INSERT INTO %1$I (%2$s) SELECT %2$s FROM jsonb_populate_record(NULL::%1$I, $1)',
        target,
        (SELECT string_agg(format('%I', c), ', ' ORDER BY c) FROM unnest(columns) AS c)
      )
      USING assignments;

    ELSE
      EXECUTE format('DELETE FROM %1$I AS t WHERE t.id = $1::UUID', target)
      USING row_id;
    END IF;

    -- EXACTLY ONE ROW, OR NOTHING HAPPENS AT ALL.
    --
    -- A delete that matches nothing and an update that matches nothing
    -- are the same silence, and both mean the row is not there or row
    -- level security is withholding it. Raising here is the only point
    -- at which the whole thing can still be undone.
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
      RAISE EXCEPTION
        'expected to change exactly one row of % but changed %; nothing has been changed',
        target, affected;
    END IF;
    touched := touched + affected;
  END LOOP;

  RETURN touched;
END;
$$;

REVOKE ALL ON FUNCTION command_apply(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_apply(JSONB) TO authenticated;
