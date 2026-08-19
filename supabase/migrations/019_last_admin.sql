-- =============================================================
-- The last administrator stays an administrator.
--
-- `command_set_role` checked this and that was not enough, twice over.
--
-- IT ONLY COVERED ONE PATH. An administrator reaching `profiles.role`
-- through any other legitimate route, the admin screen, a script, a
-- PostgREST update, went nowhere near that function and the rule did
-- not exist for them.
--
-- AND IT WAS RACEABLE. Two administrators demoting themselves at the
-- same moment both counted two administrators, both saw one left over,
-- and both committed. Nobody could administer the database afterwards
-- and nothing in this application could put it back.
--
-- So the rule lives on the table. A trigger sees every UPDATE of
-- `profiles.role` whatever issued it, and the count is taken under a
-- transaction scoped advisory lock so the second demotion waits for the
-- first to commit and then counts what is actually left.
--
-- WHY THIS CANNOT DEADLOCK.
--
-- One lock, one key, taken at one point. Deadlock needs two lockers
-- taking two locks in opposite orders, and there is only ever this one
-- to take. A transaction that already holds it takes it again for free,
-- because advisory locks are re-entrant for the holder. It is released
-- when the transaction ends, committed or rolled back, without anybody
-- remembering to.
--
-- The key is a fixed arbitrary number for "the set of administrators".
-- It is not a row id and does not collide with one: advisory locks live
-- in their own space.
-- =============================================================

CREATE OR REPLACE FUNCTION guard_last_admin()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  admins INTEGER;
BEGIN
  -- Only a change that takes somebody OUT of the administrators.
  IF OLD.role IS NOT DISTINCT FROM NEW.role THEN RETURN NEW; END IF;
  IF OLD.role <> 'admin' THEN RETURN NEW; END IF;

  -- Everything that could remove an administrator queues here, so the
  -- count below is of what is really left rather than of what was there
  -- when this transaction started.
  PERFORM pg_advisory_xact_lock(778401);

  SELECT COUNT(*) INTO admins FROM public.profiles WHERE role = 'admin';

  IF admins <= 1 THEN
    RAISE EXCEPTION
      '% is the only administrator, and nothing in this application could put that back',
      COALESCE(NEW.full_name, NEW.email, NEW.id::TEXT);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_last_admin ON profiles;
CREATE TRIGGER guard_last_admin
  BEFORE UPDATE OF role ON profiles
  FOR EACH ROW EXECUTE FUNCTION guard_last_admin();

-- Deleting the last administrator's profile is the same loss by another
-- route.
CREATE OR REPLACE FUNCTION guard_last_admin_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  admins INTEGER;
BEGIN
  IF OLD.role <> 'admin' THEN RETURN OLD; END IF;

  PERFORM pg_advisory_xact_lock(778401);
  SELECT COUNT(*) INTO admins FROM public.profiles WHERE role = 'admin';

  IF admins <= 1 THEN
    RAISE EXCEPTION
      '% is the only administrator, and nothing in this application could put that back',
      COALESCE(OLD.full_name, OLD.email, OLD.id::TEXT);
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS guard_last_admin_delete ON profiles;
CREATE TRIGGER guard_last_admin_delete
  BEFORE DELETE ON profiles
  FOR EACH ROW EXECUTE FUNCTION guard_last_admin_delete();
