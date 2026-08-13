-- =============================================================
-- 005_role_escalation.sql
--
-- Stop a user granting themselves admin.
--
-- THE HOLE. `profiles_update_self` is:
--
--   CREATE POLICY "profiles_update_self" ON profiles
--     FOR UPDATE USING (id = auth.uid());
--
-- Row level security is row level. It decides which rows you may touch,
-- not which columns, so a policy that lets somebody edit their own row
-- lets them edit every field in it, including `role`. Any signed in user
-- can open the browser console and run:
--
--   supabase.from('profiles').update({ role: 'admin' }).eq('id', <their id>)
--
-- and it succeeds, because it is their own row. Viewer to admin in one
-- line, from the browser, with no server involved.
--
-- WHY IT MATTERS MORE NOW. Everything in lib/crm/permissions.ts hangs off
-- `profiles.role`. The whole capability model, the portfolio scoping, the
-- Lusha lock, who may see a colleague's accounts. All of it is decided by
-- a column the user themselves can write. Until this is closed, those
-- gates are a tidy interface rather than a permission system, and the
-- exec dashboard is readable by anybody who wants it.
--
-- THE FIX. A trigger, not a policy. Postgres has column level UPDATE
-- grants, but Supabase runs both ordinary users and admins as the same
-- `authenticated` role, so revoking the column would lock admins out too.
-- A trigger can ask who is doing the writing.
--
-- `role` and `dashboard_variant` become admin only. Everything else on
-- the profile stays self editable, which is what the policy was for:
-- name, theme, and whatever settings arrive later.
--
-- Safe to re-run. Run this before go live.
-- =============================================================

CREATE OR REPLACE FUNCTION guard_profile_privileges()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE
  actor_role TEXT;
BEGIN
  -- No signed in user means the service role key, which is server only
  -- and already omnipotent. Blocking it here would break nothing an
  -- attacker can reach and would break the seeder and any admin script.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- The trigger owner's rights are used to read this, so it works even
  -- where the caller cannot see other profiles.
  SELECT role INTO actor_role FROM public.profiles WHERE id = auth.uid();

  IF actor_role = 'admin' THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Only an administrator can change a role';
  END IF;

  -- Which dashboard somebody sees is a permission too, and it is the
  -- other column on this table that decides what a person gets to look
  -- at rather than how it is presented to them.
  --
  -- Read through jsonb rather than as NEW.dashboard_variant, because the
  -- column arrives with migration 001 and this one has to work whether
  -- that has been run or not. Referencing a missing column directly
  -- would fail at runtime on every profile update.
  IF to_jsonb(NEW) ->> 'dashboard_variant' IS DISTINCT FROM to_jsonb(OLD) ->> 'dashboard_variant' THEN
    RAISE EXCEPTION 'Only an administrator can change which dashboard a user sees';
  END IF;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS profiles_guard_privileges ON profiles;
CREATE TRIGGER profiles_guard_privileges
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION guard_profile_privileges();
