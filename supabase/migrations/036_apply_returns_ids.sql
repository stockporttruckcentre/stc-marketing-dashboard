-- =============================================================
-- 036. A created row's id, inside the transaction that made it.
--
-- `command_perform` has run changes and operations in one ordered
-- transaction since migration 017, and a later step can already refer to
-- an earlier one's result:
--
--   {"$from": {"step": 0, "key": "listId"}}
--
-- That worked for operations, which return an object, and not for a
-- change set, which returned only how many rows it touched. So a
-- programme could create a customer and could not then do anything to
-- the customer it had just created: the id existed for the length of
-- one statement and was thrown away.
--
-- `command_apply_returning` is migration 011's function with RETURNING
-- on the insert. Every check is the same one, in the same order: the
-- writable-column allowlist, the lifecycle capability, the typed
-- population, exactly one row or nothing. `command_apply` becomes a
-- wrapper over it, so there is one implementation rather than two that
-- drift.
--
-- WHY NOT ASSIGN THE UUID BEFORE INSERTING.
--
-- It was the other candidate and it is worse. A server-assigned id has
-- to be stable between the preview and the confirmation or the
-- programme hash moves under the person confirming it, so it would have
-- to be derived from the sentence. Derived from the sentence means the
-- same sentence twice produces the same id, and "create a lead called
-- Acme Logistics" is a thing somebody may legitimately do twice: the
-- second would fail on the primary key with an error about nothing they
-- did.
--
-- The database issues the id. The transaction hands it forward.
-- =============================================================

CREATE OR REPLACE FUNCTION command_apply_returning(p_changes JSONB)
RETURNS JSONB
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
  made        UUID;
  ids         UUID[] := ARRAY[]::UUID[];
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
      --
      -- RETURNING is the whole difference from migration 011. The id
      -- exists for the length of this statement and was thrown away, so
      -- a programme could create a customer and then do nothing to the
      -- customer it had just created.
      EXECUTE format(
        'INSERT INTO %1$I (%2$s) SELECT %2$s FROM jsonb_populate_record(NULL::%1$I, $1) RETURNING id',
        target,
        (SELECT string_agg(format('%I', c), ', ' ORDER BY c) FROM unnest(columns) AS c)
      )
      USING assignments
      INTO made;
      ids := ids || made;

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
    IF operation <> 'insert' AND row_id IS NOT NULL THEN
      ids := ids || row_id::UUID;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'changed', touched,
    'ids', to_jsonb(ids),
    -- What a create step means: one row, and a reference to it wants
    -- the id rather than a list holding one.
    'id', CASE WHEN array_length(ids, 1) >= 1 THEN to_jsonb(ids[1]) ELSE 'null'::JSONB END);
END;
$$;


REVOKE ALL ON FUNCTION command_apply_returning(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_apply_returning(JSONB) TO authenticated;

-- -------------------------------------------------------------
-- One implementation, and the old shape over it
-- -------------------------------------------------------------
--
-- Everything that wants a count keeps getting one, and there is no
-- second copy of the allowlist or the lifecycle check to fall behind.
CREATE OR REPLACE FUNCTION command_apply(p_changes JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  RETURN (command_apply_returning(p_changes) ->> 'changed')::INTEGER;
END;
$$;

REVOKE ALL ON FUNCTION command_apply(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_apply(JSONB) TO authenticated;

-- -------------------------------------------------------------
-- The ordered runner records what each step produced
-- -------------------------------------------------------------
--
-- Re-created because that is how a plpgsql function changes. The only
-- differences from migration 021 are that a change set now reports the
-- rows it made rather than only how many, and that its own payload goes
-- through `command_resolve_ref` so a change can name what an earlier
-- step produced.
CREATE OR REPLACE FUNCTION command_perform(p_steps JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  step      JSONB;
  kind      TEXT;
  subjects  UUID[];
  args      JSONB;
  results   JSONB := '[]'::JSONB;
  outcome   JSONB;
  performed JSONB;
  applied   JSONB;
  changed   INTEGER := 0;
BEGIN
  IF p_steps IS NULL OR jsonb_typeof(p_steps) <> 'array' THEN
    RAISE EXCEPTION 'command_perform expects an array of steps';
  END IF;
  IF jsonb_array_length(p_steps) = 0 THEN
    RAISE EXCEPTION 'command_perform was given nothing to do';
  END IF;

  FOR step IN SELECT * FROM jsonb_array_elements(p_steps)
  LOOP
    kind := step ->> 'op';

    IF kind = 'changes' THEN
      -- A change set can name what an earlier step produced too.
      -- "Create a lead and set its next action" is a second change set
      -- that has to know the id the first one made.
      applied := command_apply_returning(
        COALESCE(command_resolve_ref(step -> 'changes', results), '[]'::JSONB));
      changed := changed + COALESCE((applied ->> 'changed')::INTEGER, 0);
      outcome := applied;

    ELSIF kind = 'invoke' THEN
      args     := COALESCE(command_resolve_ref(step -> 'args', results), '{}'::JSONB);
      subjects := ARRAY(
        SELECT (jsonb_array_elements_text(
          COALESCE(command_resolve_ref(step -> 'subjects', results), '[]'::JSONB)))::UUID
      );

      performed := command_invoke_one(step ->> 'capability', subjects, args);
      changed   := changed + COALESCE((performed ->> 'changed')::INTEGER, 0);
      -- The operation's own return, with what it changed folded in, so
      -- a later step can name either.
      outcome   := COALESCE(performed -> 'outcome', '{}'::JSONB)
                   || jsonb_build_object('changed', performed -> 'changed');

    ELSE
      RAISE EXCEPTION 'a step must be a change set or an operation, not %', COALESCE(kind, 'nothing');
    END IF;

    results := results || jsonb_build_array(COALESCE(outcome, '{}'::JSONB));
  END LOOP;

  RETURN jsonb_build_object('changed', changed, 'results', results);
END;
$$;

REVOKE ALL ON FUNCTION command_perform(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_perform(JSONB) TO authenticated;
