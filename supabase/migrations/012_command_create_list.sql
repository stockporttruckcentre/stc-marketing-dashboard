-- =============================================================
-- Making a list out of a set of records, in order, in one go.
--
-- Two writes where the second needs the first: the list has to exist
-- before anything can be put in it. That is the shape the command
-- orchestrator refuses, and rightly: it computes every change from the
-- rows as they stand and applies them together, so a change that needs
-- another change's result would read the world before it happened.
--
-- The answer is not to relax that. It is to put the ordered pair
-- somewhere that can genuinely order it, which is a function: plpgsql
-- runs its statements in sequence inside one transaction, so the list
-- exists by the time the memberships are written and neither survives
-- without the other.
--
-- EVERY RECORD, OR NONE.
--
-- A list made from forty customers that quietly contains thirty eight
-- is worse than no list, because nobody can tell by looking. If a row
-- cannot be moved, whether because it is not there or because row level
-- security withholds it, the whole thing raises and the list is not
-- created either.
--
-- SECURITY INVOKER. Which contacts the caller can move is decided by
-- the same policies that decide everything else.
-- =============================================================

CREATE OR REPLACE FUNCTION command_create_list(
  p_name  TEXT,
  p_ids   UUID[],
  p_owner UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  new_list UUID;
  moved    INTEGER;
  wanted   INTEGER;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'a list needs a name';
  END IF;

  wanted := COALESCE(array_length(p_ids, 1), 0);
  IF wanted = 0 THEN
    RAISE EXCEPTION 'a list needs something in it';
  END IF;

  INSERT INTO crm_lists (name, owner_id, is_global)
  VALUES (btrim(p_name), COALESCE(p_owner, auth.uid()), FALSE)
  RETURNING id INTO new_list;

  UPDATE crm_contacts SET list_id = new_list
  WHERE id = ANY(p_ids);

  GET DIAGNOSTICS moved = ROW_COUNT;
  IF moved <> wanted THEN
    RAISE EXCEPTION
      'expected to put % records in the list but moved %; nothing has been changed',
      wanted, moved;
  END IF;

  RETURN jsonb_build_object('listId', new_list, 'name', btrim(p_name), 'moved', moved);
END;
$$;

REVOKE ALL ON FUNCTION command_create_list(TEXT, UUID[], UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_create_list(TEXT, UUID[], UUID) TO authenticated;
