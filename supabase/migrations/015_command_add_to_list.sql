-- =============================================================
-- Putting records on a list that already exists.
--
-- `command_create_list` makes a new one. Moving records onto a list
-- somebody already has is the other half of the same job and is what
-- the CRM screen's "move to list" does, and it was reachable by ticking
-- rows and using a menu and by no sentence at all.
--
-- THE LIST IS NAMED, NOT NUMBERED.
--
-- Nobody types a uuid. The name is resolved here, in the same
-- transaction that does the move, so a list renamed between the preview
-- and the confirmation cannot end up with somebody's customers on it.
-- Exactly one match, or it raises and says which ones it found: two
-- lists called "Prospects" is a question, and picking either is how
-- forty customers end up somewhere nobody looks.
--
-- EVERY RECORD, OR NONE. Same as creating one. A move that quietly
-- carries thirty eight of forty is worse than no move, because nobody
-- can tell by looking.
--
-- SECURITY INVOKER. Which contacts the caller can move and which lists
-- they can see are decided by the same policies as everything else.
-- =============================================================

CREATE OR REPLACE FUNCTION command_add_to_list(
  p_list_name TEXT,
  p_ids       UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  target  UUID;
  matched INTEGER;
  names   TEXT;
  moved   INTEGER;
  wanted  INTEGER;
BEGIN
  IF p_list_name IS NULL OR btrim(p_list_name) = '' THEN
    RAISE EXCEPTION 'nothing said which list';
  END IF;

  wanted := COALESCE(array_length(p_ids, 1), 0);
  IF wanted = 0 THEN
    RAISE EXCEPTION 'nothing said which records to move';
  END IF;

  -- Exact name first, then a contains match, so "Fleet Prospects" beats
  -- "Fleet Prospects 2024" when both are there.
  SELECT id INTO target FROM crm_lists
  WHERE lower(btrim(name)) = lower(btrim(p_list_name)) LIMIT 1;

  IF target IS NULL THEN
    SELECT COUNT(*), string_agg(name, ', ' ORDER BY name)
      INTO matched, names
    FROM crm_lists WHERE name ILIKE '%' || btrim(p_list_name) || '%';

    IF matched = 0 THEN
      RAISE EXCEPTION 'no list here is called %', p_list_name;
    END IF;
    IF matched > 1 THEN
      RAISE EXCEPTION 'more than one list matches "%": %', p_list_name, names;
    END IF;

    SELECT id INTO target FROM crm_lists
    WHERE name ILIKE '%' || btrim(p_list_name) || '%' LIMIT 1;
  END IF;

  UPDATE crm_contacts SET list_id = target WHERE id = ANY(p_ids);
  GET DIAGNOSTICS moved = ROW_COUNT;

  IF moved <> wanted THEN
    RAISE EXCEPTION
      'expected to move % records onto the list but moved %; nothing has been changed',
      wanted, moved;
  END IF;

  RETURN jsonb_build_object('listId', target, 'name', p_list_name, 'moved', moved);
END;
$$;

REVOKE ALL ON FUNCTION command_add_to_list(TEXT, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_add_to_list(TEXT, UUID[]) TO authenticated;
