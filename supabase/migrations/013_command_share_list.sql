-- =============================================================
-- Granting colleagues access to a working list, in one go.
--
-- "Share the Fleet Prospects list with Dave and Tom" is one instruction
-- about two people, and two inserts from application code are two
-- transactions. Somebody who agreed to share with two colleagues and
-- got one is left not knowing which, on a list they think both can see.
--
-- SHARING IN THIS APPLICATION IS LIST MEMBERSHIP.
--
-- Not a link, not a copy, not an email. `crm_list_members` is what the
-- CRM has always used to decide who can see a list, and every read
-- policy on contacts, notes and addresses already consults it. So the
-- command bar grants the same thing the CRM screen grants, through the
-- same table, and there is no second idea of what "shared" means.
--
-- The global list is refused. Everybody can already see it, so granting
-- access to it is a write that changes nothing and reports success,
-- which reads as "Dave can see them now" when Dave always could.
--
-- SHARING THE LIST IS NOT SHARING A HANDFUL OF ROWS ON IT.
--
-- The unit of sharing here is the whole list, and that is a real limit
-- rather than an implementation detail. "Share the customers in Hyde
-- with Dave" over a list of a hundred, two of which are in Hyde, means
-- Dave gets two records, and granting him the list gives him ninety
-- eight he was never offered. There is no record level grant in this
-- schema to do the narrow thing with.
--
-- So `p_ids` is the exact set the sentence selected, and this refuses
-- unless that set IS the list: same count, every one of them on it.
-- Anything narrower stops and says so. Checked here rather than only in
-- the caller, because a caller that validates its own payload validates
-- nothing.
--
-- IDEMPOTENT. Sharing with somebody who already has access leaves them
-- with the access they had. That is what the registry declares and this
-- is what makes the declaration true.
--
-- SECURITY INVOKER, and gated on `crm.manageLists` through
-- `command_may`, which is the same capability the application checks. A
-- function granted to `authenticated` is reachable through PostgREST
-- with no command runtime in front of it, so the capability has to be
-- asked for here too.
-- =============================================================

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

  -- The selected set has to BE the list. See the header: the unit of
  -- sharing is the whole list, and a narrower selection would hand over
  -- everything else on it.
  asked := COALESCE(array_length(p_ids, 1), 0);
  IF asked = 0 THEN
    RAISE EXCEPTION 'nothing said which records were being shared';
  END IF;

  SELECT COUNT(*) INTO on_list FROM crm_contacts WHERE list_id = p_list;
  SELECT COUNT(*) INTO covered FROM crm_contacts
   WHERE list_id = p_list AND id = ANY(p_ids);

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

-- The old three argument shape, so nothing can reach the version that
-- did not know which records were being shared.
DROP FUNCTION IF EXISTS command_share_list(UUID, UUID[], BOOLEAN);

REVOKE ALL ON FUNCTION command_share_list(UUID, UUID[], UUID[], BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_share_list(UUID, UUID[], UUID[], BOOLEAN) TO authenticated;
