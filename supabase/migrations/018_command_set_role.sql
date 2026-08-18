-- =============================================================
-- Changing what somebody is allowed to do.
--
-- The highest risk write this application has. Every capability in
-- `lib/crm/permissions.ts` hangs off `profiles.role`, so one word here
-- decides who can see a colleague's accounts, spend Lusha credits,
-- delete records and change other people's roles in turn.
--
-- WHY IT IS REACHABLE FROM THE COMMAND BAR AT ALL.
--
-- It was left out on the grounds that the admin screen's confirmation
-- is the point. That does not hold. The command bar's confirmation IS a
-- confirmation: the sentence is planned on the server, the person is
-- resolved exactly, the preview names them and states the old role and
-- the new one, and the whole thing is planned and resolved again from
-- the raw text before anything is written. Requiring somebody to click
-- through to another screen because that screen also confirms is not a
-- security property, it is an extra step.
--
-- What matters is that the gate is real, and the gate is here rather
-- than in the caller. `command_may('admin.users')` reads the same
-- permission table the application reads, and migration 005's trigger
-- refuses a role change from anybody who is not an admin whatever route
-- it arrives by.
--
-- THE LAST ADMIN STAYS AN ADMIN, AND NOT BECAUSE OF THIS FUNCTION.
--
-- An administrator demoting themselves when they are the only one
-- leaves a database nobody can administer, and no screen in this
-- application can put that back. The check below is a friendly early
-- refusal so the command bar can say something useful before it tries.
-- It is NOT the guarantee: migration 019 puts the rule on the table
-- itself, under an advisory lock, so it holds for every path into
-- `profiles.role` and for two administrators demoting themselves at the
-- same moment.
--
-- SECURITY INVOKER. The trigger and the row policies still apply.
-- =============================================================

CREATE OR REPLACE FUNCTION command_set_role(
  p_user UUID,
  p_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  was      TEXT;
  who      TEXT;
  admins   INTEGER;
BEGIN
  IF NOT command_may('admin.users') THEN
    RAISE EXCEPTION 'you do not have admin.users';
  END IF;

  IF p_user IS NULL THEN
    RAISE EXCEPTION 'nothing said whose role to change';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('admin', 'sales', 'marketer', 'viewer') THEN
    RAISE EXCEPTION 'there is no role called %', COALESCE(p_role, 'nothing');
  END IF;

  SELECT role, COALESCE(full_name, email) INTO was, who
  FROM profiles WHERE id = p_user;

  IF was IS NULL THEN
    RAISE EXCEPTION 'nobody here has that id';
  END IF;
  IF was = p_role THEN
    RAISE EXCEPTION '% is already %', who, p_role;
  END IF;

  -- The last administrator cannot stop being one. Said here so the
  -- refusal is a sentence rather than a trigger error; enforced by the
  -- trigger, which is where it is true.
  IF was = 'admin' AND p_role <> 'admin' THEN
    SELECT COUNT(*) INTO admins FROM profiles WHERE role = 'admin';
    IF admins <= 1 THEN
      RAISE EXCEPTION
        '% is the only administrator, and nothing in this application could put that back',
        who;
    END IF;
  END IF;

  UPDATE profiles SET role = p_role WHERE id = p_user;

  RETURN jsonb_build_object(
    'userId', p_user, 'name', who, 'was', was, 'now', p_role
  );
END;
$$;

REVOKE ALL ON FUNCTION command_set_role(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_set_role(UUID, TEXT) TO authenticated;
