-- =============================================================
-- 044. The list operations write memberships.
--
-- Migration 040 moved list membership off `crm_contacts.list_id` and
-- into `crm_list_contacts`, and left the column behind with a trigger
-- keeping it in step so nothing broke on the way through. This is the
-- other half: the three functions that put companies on lists now say
-- what they mean instead of writing a column that can only hold one
-- answer.
--
-- WHAT CHANGES IN BEHAVIOUR, AND WHY IT IS NOT A CHANGE OF INTENT.
--
-- `command_create_list` and `command_add_to_list` both MOVED a company:
-- writing `list_id` took it off wherever it was. That was not a
-- decision anybody made, it is what one column does. "Make a list of
-- the Hyde customers" never meant "take them off the pipeline", and
-- the pipeline losing rows every time somebody made a list is part of
-- why the same firm kept being entered again.
--
-- They add now. A company on the pipeline that somebody puts on their
-- own list is on both, which is one record in two places rather than
-- two records.
--
-- `command_share_list` counts the list through the join table. Its rule
-- is unchanged and is the important one: the selection has to BE the
-- list, because sharing grants the whole list and a narrower selection
-- would hand over everything else on it.
--
-- SECURITY INVOKER throughout, as before. Which companies the caller
-- can put on a list and which lists they can see are decided by the
-- same policies that decide everything else.
-- =============================================================

-- -------------------------------------------------------------
-- Making a list out of a set of records
--
-- Ported from migration 012. The order matters and is the reason this
-- is a function at all: the list has to exist before anything can be
-- put on it, and plpgsql runs its statements in sequence inside one
-- transaction, so neither survives without the other.
-- -------------------------------------------------------------
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

  /* Only the companies the caller can actually see.

     `INSERT ... SELECT FROM crm_contacts` reads through the same row
     level policies as everything else, so a company withheld from them
     contributes no row and the count below refuses the whole call.
     Inserting straight from `unnest(p_ids)` would put an id they cannot
     read onto their list and report success. */
  INSERT INTO crm_list_contacts (list_id, contact_id, added_by)
  SELECT new_list, c.id, auth.uid()
    FROM crm_contacts c
   WHERE c.id = ANY(p_ids)
  ON CONFLICT (list_id, contact_id) DO NOTHING;

  GET DIAGNOSTICS moved = ROW_COUNT;

  -- Every record, or none. A list made from forty customers that
  -- quietly contains thirty eight is worse than no list, because
  -- nobody can tell by looking.
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

-- -------------------------------------------------------------
-- Putting records on a list that already exists
--
-- Ported from migration 015 with the name resolution unchanged: exact
-- first, then contains, so "Fleet Prospects" beats "Fleet Prospects
-- 2024" when both are there, and two matches is a question rather than
-- a guess.
-- -------------------------------------------------------------
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
  already INTEGER;
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

  /* Records already on the list are not a failure and are not a move.

     `ON CONFLICT DO NOTHING` reports nothing inserted for them, so the
     count below would refuse a perfectly good call where somebody
     selected forty rows and two were already there. Counting them
     first is what keeps "every record or none" meaning what it says. */
  SELECT COUNT(*) INTO already
    FROM crm_list_contacts
   WHERE list_id = target AND contact_id = ANY(p_ids);

  INSERT INTO crm_list_contacts (list_id, contact_id, added_by)
  SELECT target, c.id, auth.uid()
    FROM crm_contacts c
   WHERE c.id = ANY(p_ids)
  ON CONFLICT (list_id, contact_id) DO NOTHING;

  GET DIAGNOSTICS moved = ROW_COUNT;

  IF moved + already <> wanted THEN
    RAISE EXCEPTION
      'expected to move % records onto the list but moved %; nothing has been changed',
      wanted, moved + already;
  END IF;

  RETURN jsonb_build_object(
    'listId', target, 'name', p_list_name, 'moved', moved + already);
END;
$$;

REVOKE ALL ON FUNCTION command_add_to_list(TEXT, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_add_to_list(TEXT, UUID[]) TO authenticated;

-- -------------------------------------------------------------
-- Granting colleagues access to a list
--
-- Ported from migration 013. Every check, every message and the order
-- they run in are unchanged: the order decides which refusal somebody
-- gets, and the numbers in the message are what the preview shows them.
-- The only difference is that "the records on the list" is counted in
-- `crm_list_contacts` rather than off a column on the company.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION command_share_list(
  p_list     UUID,
  p_ids      UUID[],
  p_users    UUID[],
  p_can_edit BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  wanted  INTEGER;
  is_glob BOOLEAN;
  present INTEGER;
  granted INTEGER;
  on_list INTEGER;
  asked   INTEGER;
  covered INTEGER;
BEGIN
  IF NOT command_may('crm.manageLists') THEN
    RAISE EXCEPTION 'you do not have crm.manageLists';
  END IF;

  IF p_list IS NULL THEN
    RAISE EXCEPTION 'nothing said which list to share';
  END IF;

  wanted := COALESCE(array_length(p_users, 1), 0);
  IF wanted = 0 THEN
    RAISE EXCEPTION 'nothing said who to share it with';
  END IF;

  SELECT is_global INTO is_glob FROM crm_lists WHERE id = p_list;
  IF is_glob IS NULL THEN
    RAISE EXCEPTION 'that list is not there';
  END IF;
  IF is_glob THEN
    RAISE EXCEPTION
      'that is the global list, which the whole team can already see; sharing it would change nothing';
  END IF;

  -- The selected set has to BE the list. The unit of sharing is the
  -- whole list, and a narrower selection would hand over everything
  -- else on it.
  asked := COALESCE(array_length(p_ids, 1), 0);
  IF asked = 0 THEN
    RAISE EXCEPTION 'nothing said which records were being shared';
  END IF;

  SELECT COUNT(*) INTO on_list FROM crm_list_contacts WHERE list_id = p_list;
  SELECT COUNT(*) INTO covered FROM crm_list_contacts
   WHERE list_id = p_list AND contact_id = ANY(p_ids);

  IF on_list <> asked OR covered <> asked THEN
    RAISE EXCEPTION
      'that is % of the % records on the list, and sharing here grants the whole list; '
      'nothing has been changed',
      covered, on_list;
  END IF;

  -- Every named person has to exist. Granting access to three of four
  -- and saying it worked is the failure this whole layer exists to stop.
  SELECT COUNT(*) INTO present FROM profiles WHERE id = ANY(p_users);
  IF present <> wanted THEN
    RAISE EXCEPTION
      'expected to share with % people but only % of them are here; nothing has been changed',
      wanted, present;
  END IF;

  INSERT INTO crm_list_members (list_id, user_id, can_edit)
  SELECT p_list, u, COALESCE(p_can_edit, TRUE)
  FROM unnest(p_users) AS u
  ON CONFLICT (list_id, user_id) DO NOTHING;

  GET DIAGNOSTICS granted = ROW_COUNT;

  RETURN jsonb_build_object(
    'listId', p_list,
    'asked', wanted,
    -- What changed, as opposed to what was asked for. Sharing with
    -- somebody who already had access is not a failure and is not a
    -- grant either, and saying so is the difference between the two.
    'granted', granted,
    'alreadyHad', wanted - granted
  );
END;
$$;

REVOKE ALL ON FUNCTION command_share_list(UUID, UUID[], UUID[], BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_share_list(UUID, UUID[], UUID[], BOOLEAN) TO authenticated;

-- -------------------------------------------------------------
-- Deleting a list takes the list, not the customers on it
--
-- `crm_list_contacts` cascades on the list, so the memberships go and
-- the companies stay. This says so out loud because the CRM screen used
-- to delete every company carrying the list's id, which was the only
-- reading available while a company sat on exactly one list.
-- -------------------------------------------------------------
COMMENT ON TABLE crm_list_contacts IS
  'Which companies appear on which list. Many to many: one company, '
  'many lists. Deleting a list deletes its memberships and no company.';
