-- =============================================================
-- One confirmed programme, one transaction.
--
-- The command layer had a transaction per KIND of thing: field writes
-- went to `command_apply`, an operation went to its own function, and
-- anything that happened after those ran on its own afterwards. A
-- programme that makes a list and then shares it was therefore two
-- transactions, and a failure in the second returned success plus a
-- sentence saying the rest did not happen. Somebody who confirmed one
-- thing got half of it and a note.
--
-- This is the single entry point. Every database effect of one
-- programme, in order, inside one plpgsql function and therefore one
-- transaction: it commits entirely or it leaves nothing behind.
--
-- WHAT A STEP LOOKS LIKE.
--
--   [{"op":"changes","changes":[ ... command_apply's payload ... ]},
--    {"op":"invoke","capability":"list.create",
--     "subjects":["uuid", ...],
--     "args":{"name":"Fleet Prospects"}}]
--
-- THE DATAFLOW BETWEEN STEPS.
--
-- Sharing the list a previous step created needs that list's id, which
-- does not exist until the step runs. A value in `subjects` or `args`
-- may therefore be written as
--
--   {"$from": {"step": 0, "key": "listId"}}
--
-- and is replaced by that key of that step's return value before the
-- call is made. Deliberately tiny: a step index and a key. It is the
-- same idea as the plan's `ResultRef` and it exists here because the
-- ordering it expresses cannot be expressed anywhere the transaction is
-- not.
--
-- IT DOES NOT REIMPLEMENT ANY OPERATION.
--
-- It dispatches to the functions that already perform them. Two
-- implementations of a sale, a list or a grant is how one of them stops
-- doing the part nobody remembered.
--
-- SECURITY INVOKER, like everything else here. Row level security still
-- decides which rows the caller can touch, and each function does its
-- own capability check.
-- =============================================================

CREATE OR REPLACE FUNCTION command_resolve_ref(p_value JSONB, p_results JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  ref   JSONB;
  idx   INTEGER;
  key   TEXT;
  outp  JSONB;
  item  JSONB;
BEGIN
  IF p_value IS NULL THEN RETURN NULL; END IF;

  -- An array: resolve each member, so "subjects" can hold a reference.
  IF jsonb_typeof(p_value) = 'array' THEN
    outp := '[]'::JSONB;
    FOR item IN SELECT * FROM jsonb_array_elements(p_value)
    LOOP
      outp := outp || jsonb_build_array(command_resolve_ref(item, p_results));
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
  IF (p_results -> idx) ->> key IS NULL THEN
    RAISE EXCEPTION 'step % produced nothing called %', idx, key;
  END IF;
  RETURN to_jsonb((p_results -> idx) ->> key);
END;
$$;

REVOKE ALL ON FUNCTION command_resolve_ref(JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_resolve_ref(JSONB, JSONB) TO authenticated;


CREATE OR REPLACE FUNCTION command_perform(p_steps JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  step      JSONB;
  kind      TEXT;
  cap       TEXT;
  subjects  UUID[];
  args      JSONB;
  results   JSONB := '[]'::JSONB;
  outcome   JSONB;
  changed   INTEGER := 0;
  affected  INTEGER;
  i         INTEGER := 0;
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
      affected := command_apply(step -> 'changes');
      changed  := changed + affected;
      outcome  := jsonb_build_object('changed', affected);

    ELSIF kind = 'invoke' THEN
      cap      := step ->> 'capability';
      args     := COALESCE(command_resolve_ref(step -> 'args', results), '{}'::JSONB);
      subjects := ARRAY(
        SELECT (jsonb_array_elements_text(
          COALESCE(command_resolve_ref(step -> 'subjects', results), '[]'::JSONB)))::UUID
      );

      IF cap = 'list.create' THEN
        outcome := command_create_list(args ->> 'name', subjects, NULL);
        changed := changed + COALESCE((outcome ->> 'moved')::INTEGER, 0);

      ELSIF cap = 'list.add' THEN
        outcome := command_add_to_list(args ->> 'list', subjects);
        changed := changed + COALESCE((outcome ->> 'moved')::INTEGER, 0);

      ELSIF cap = 'rows.share' THEN
        outcome := command_share_list(
          (args ->> 'list')::UUID,
          subjects,
          ARRAY(SELECT (jsonb_array_elements_text(COALESCE(args -> 'users', '[]'::JSONB)))::UUID),
          COALESCE((args ->> 'canEdit')::BOOLEAN, TRUE));
        changed := changed + COALESCE((outcome ->> 'granted')::INTEGER, 0);

      ELSIF cap = 'record.attach' THEN
        outcome := command_attach_file(
          args ->> 'table',
          subjects[1],
          args ->> 'filename',
          args ->> 'mime',
          args ->> 'base64',
          args ->> 'describedAs');
        changed := changed + 1;

      ELSIF cap = 'user.setRole' THEN
        outcome := command_set_role(subjects[1], args ->> 'role');
        changed := changed + 1;

      ELSIF cap = 'deal.markSold' THEN
        outcome := command_mark_sold_many(
          subjects,
          COALESCE(args ->> 'repInitials', 'Unknown'),
          (args ->> 'salePrice')::NUMERIC,
          (args ->> 'dispatchDate')::DATE,
          (args ->> 'today')::DATE);
        changed := changed + COALESCE(array_length(subjects, 1), 0);

      ELSE
        -- A capability the database does not perform stops the whole
        -- programme here, before anything else in it has committed.
        RAISE EXCEPTION 'nothing in this database performs %', cap;
      END IF;

    ELSE
      RAISE EXCEPTION 'a step must be a change set or an operation, not %', COALESCE(kind, 'nothing');
    END IF;

    results := results || jsonb_build_array(COALESCE(outcome, '{}'::JSONB));
    i := i + 1;
  END LOOP;

  RETURN jsonb_build_object('changed', changed, 'results', results);
END;
$$;

REVOKE ALL ON FUNCTION command_perform(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_perform(JSONB) TO authenticated;
