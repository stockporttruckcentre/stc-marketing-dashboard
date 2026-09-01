-- =============================================================
-- 073. The write side of the permission model.
--
-- From the business:
--
--   turn Team into a generic team member overview with their details,
--   more a handy page allowing admin to become role/permission
--   management hub ... ensure only admins can see all settings and
--   other roles see settings and admin features relative to their role
--
-- ---- What was already here, and what was not ----
--
-- Everything to READ a permission. Migration 049 gave role templates and
-- scopes, 053 gave the register and `capability_report`, 016 seeded the
-- legacy role grants, and `command_may` resolves all three.
--
-- Nothing to WRITE one. There were tables for overrides and templates
-- and no function that put a row in either, so the only permission
-- anybody could change from the application was the legacy `role`
-- column, through `command_set_role`. An administrator could make
-- somebody a Marketer and could not give that one Marketer the right to
-- approve, which is the exact thing the model was built for.
--
-- This is that half. Four operations, each with the guards the role
-- change already has, because they are all the same kind of dangerous.
--
-- ---- The four ways somebody can be locked out, and the guard for each
--
--   1. Removing the last administrator. Migration 019 guards the legacy
--      role column with a trigger. A template and an override can do the
--      same thing by another route, so both are checked here against the
--      same question: would anybody still hold `admin.users` afterwards.
--   2. Taking a permission off yourself. Allowed for anything except
--      `admin.users`, because somebody experimenting with their own
--      access should not be able to shut the door behind them.
--   3. Deactivating the last administrator, which is the same as 1 with
--      a different column.
--   4. An override that grants a capability whose prerequisite the
--      person does not hold. Refused, because a capability that resolves
--      and then fails at the route is the shape of bug 068 was about.
--
-- ---- Everything is audited ----
--
-- Migration 050 built the log for exactly this. A permission change with
-- no line saying who made it and why is the one change nobody can
-- reconstruct after an incident.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Would anybody still be able to manage users.
--
-- Asked as a question about the resolved answer rather than about a
-- column, because there are three ways to hold `admin.users` and a
-- guard that only checks one of them is a guard with two holes in it.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION someone_else_can_admin(p_excluding UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE p RECORD;
BEGIN
  FOR p IN
    SELECT id FROM profiles
     WHERE id <> p_excluding
       AND COALESCE(is_active, TRUE)
  LOOP
    IF actor_holds(p.id, 'admin.users') THEN RETURN TRUE; END IF;
  END LOOP;
  RETURN FALSE;
END;
$fn$;

GRANT EXECUTE ON FUNCTION someone_else_can_admin(UUID) TO authenticated;

-- -------------------------------------------------------------
-- 2. Granting, refusing or clearing one capability for one person.
--
-- Three states, not two. `TRUE` grants it whatever their role says,
-- `FALSE` refuses it whatever their role says, and NULL removes the
-- override so the role decides again.
--
-- That third state is the one that makes the model usable. Without it
-- the only way back from a mistake is a refusal that stays on the record
-- forever, and an admin screen full of explicit refusals nobody meant is
-- unreadable.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_set_capability(
  p_user       UUID,
  p_capability TEXT,
  p_granted    BOOLEAN,
  p_reason     TEXT DEFAULT NULL,
  p_scope      TEXT DEFAULT NULL,
  p_expires    TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  who        TEXT;
  cap        capability_catalog;
  had        BOOLEAN;
  missing    TEXT;
BEGIN
  IF NOT command_may('admin.users') THEN
    RAISE EXCEPTION 'Changing what somebody can do is an administrator''s job.';
  END IF;

  SELECT * INTO cap FROM capability_catalog WHERE key = p_capability;
  IF cap IS NULL THEN
    RAISE EXCEPTION
      'There is no permission called %. The register is the list, and a name not on it can never be granted.',
      p_capability;
  END IF;

  SELECT full_name INTO who FROM profiles WHERE id = p_user;
  IF who IS NULL THEN
    RAISE EXCEPTION 'There is nobody here with that id.';
  END IF;

  had := actor_holds(p_user, p_capability);

  /* Guard 4. A capability whose prerequisite is missing resolves and
     then fails at the route, which reads as a broken button rather than
     a missing permission. Named rather than counted: knowing it needs
     `crm.view` is the whole of what somebody has to do next. */
  IF p_granted IS TRUE AND array_length(cap.requires, 1) > 0 THEN
    SELECT string_agg(r, ', ') INTO missing
      FROM unnest(cap.requires) r
     WHERE NOT actor_holds(p_user, r)
       AND NOT EXISTS (
         SELECT 1 FROM user_capability_overrides o
          WHERE o.user_id = p_user AND o.capability = r AND o.granted);
    IF missing IS NOT NULL THEN
      RAISE EXCEPTION
        '% needs % first, or the button appears and the save refuses them.',
        cap.label, missing;
    END IF;
  END IF;

  /* Guards 1 and 2, which are the same guard asked twice. */
  IF p_capability = 'admin.users' AND p_granted IS DISTINCT FROM TRUE THEN
    IF p_user = current_actor() THEN
      RAISE EXCEPTION
        'That would take your own administrator access away, and nobody can put it back but an administrator.';
    END IF;
    IF NOT someone_else_can_admin(p_user) THEN
      RAISE EXCEPTION
        'They are the only person who can manage users. Give somebody else that permission first.';
    END IF;
  END IF;

  IF p_granted IS NULL THEN
    DELETE FROM user_capability_overrides
     WHERE user_id = p_user AND capability = p_capability;
  ELSE
    INSERT INTO user_capability_overrides
      (user_id, capability, granted, scope, reason, granted_by, granted_at, expires_at)
    VALUES
      (p_user, p_capability, p_granted, p_scope, NULLIF(btrim(p_reason), ''),
       current_actor(), NOW(), p_expires)
    ON CONFLICT (user_id, capability) DO UPDATE SET
      granted    = EXCLUDED.granted,
      scope      = EXCLUDED.scope,
      reason     = EXCLUDED.reason,
      granted_by = EXCLUDED.granted_by,
      granted_at = NOW(),
      expires_at = EXCLUDED.expires_at;
  END IF;

  PERFORM audit(
    'permission_change', 'profiles', p_user, who,
    jsonb_build_object(
      'capability', p_capability,
      'label', cap.label,
      'was', had,
      'now', actor_holds(p_user, p_capability),
      'override', p_granted,
      'reason', NULLIF(btrim(p_reason), '')
    )
  );

  RETURN jsonb_build_object(
    'who', who,
    'capability', p_capability,
    'label', cap.label,
    'holds', actor_holds(p_user, p_capability),
    'override', p_granted
  );
END;
$fn$;

REVOKE ALL ON FUNCTION admin_set_capability FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_set_capability TO authenticated;

-- -------------------------------------------------------------
-- 3. Moving somebody onto a role template.
--
-- The template is the shape somebody's access takes; the overrides above
-- are the exceptions to it. Moving a person between templates therefore
-- keeps their overrides, deliberately: an exception somebody was granted
-- for a reason does not stop being true because their job changed.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_set_role_template(p_user UUID, p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  who      TEXT;
  tpl      role_templates;
  was      TEXT;
BEGIN
  IF NOT command_may('admin.users') THEN
    RAISE EXCEPTION 'Changing somebody''s role is an administrator''s job.';
  END IF;

  SELECT full_name INTO who FROM profiles WHERE id = p_user;
  IF who IS NULL THEN RAISE EXCEPTION 'There is nobody here with that id.'; END IF;

  SELECT name INTO was FROM role_templates
   WHERE id = (SELECT role_template_id FROM profiles WHERE id = p_user);

  IF p_slug IS NULL THEN
    /* Off templates entirely, back to the legacy role column. Allowed,
       because every account was on that path before migration 049 and
       some still are. */
    tpl := NULL;
  ELSE
    SELECT * INTO tpl FROM role_templates WHERE slug = p_slug AND COALESCE(is_active, TRUE);
    IF tpl IS NULL THEN
      RAISE EXCEPTION 'There is no role called %.', p_slug;
    END IF;
  END IF;

  UPDATE profiles SET role_template_id = tpl.id WHERE id = p_user;

  /* Guard 1, asked after the change rather than predicted before it.
     Whether somebody still holds `admin.users` depends on the template,
     the legacy role and their overrides together, and reimplementing
     that resolution here would be a second copy of `command_may`. */
  IF NOT actor_holds(p_user, 'admin.users') AND NOT someone_else_can_admin(p_user) THEN
    RAISE EXCEPTION
      'That would leave nobody able to manage users. Give somebody else administrator access first.';
  END IF;
  IF p_user = current_actor() AND NOT actor_holds(p_user, 'admin.users') THEN
    RAISE EXCEPTION 'That would take your own administrator access away.';
  END IF;

  PERFORM audit(
    'role_change', 'profiles', p_user, who,
    jsonb_build_object('was', was, 'now', tpl.name)
  );

  RETURN jsonb_build_object('who', who, 'was', was, 'now', tpl.name);
END;
$fn$;

REVOKE ALL ON FUNCTION admin_set_role_template FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_set_role_template TO authenticated;

-- -------------------------------------------------------------
-- 4. Turning somebody off, and back on.
--
-- Not a delete. Somebody who has left owns leads, meetings, contracts
-- and notes, and removing the row would take the history of who did what
-- with them. Deactivating keeps every record and stops the account.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_set_active(p_user UUID, p_active BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE who TEXT;
BEGIN
  IF NOT command_may('admin.users') THEN
    RAISE EXCEPTION 'Turning an account off is an administrator''s job.';
  END IF;

  SELECT full_name INTO who FROM profiles WHERE id = p_user;
  IF who IS NULL THEN RAISE EXCEPTION 'There is nobody here with that id.'; END IF;

  IF p_active IS FALSE THEN
    IF p_user = current_actor() THEN
      RAISE EXCEPTION 'You cannot turn your own account off.';
    END IF;
    IF actor_holds(p_user, 'admin.users') AND NOT someone_else_can_admin(p_user) THEN
      RAISE EXCEPTION
        'They are the only person who can manage users. Give somebody else that permission first.';
    END IF;
  END IF;

  UPDATE profiles
     SET is_active = p_active,
         deactivated_at = CASE WHEN p_active THEN NULL ELSE NOW() END
   WHERE id = p_user;

  PERFORM audit(
    'permission_change', 'profiles', p_user, who,
    jsonb_build_object('active', p_active)
  );

  RETURN jsonb_build_object('who', who, 'active', p_active);
END;
$fn$;

REVOKE ALL ON FUNCTION admin_set_active FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_set_active TO authenticated;

-- -------------------------------------------------------------
-- 5. The team, as a directory.
--
-- One row per person with everything the overview shows, including how
-- many permissions they actually resolve to. That count is the thing
-- that makes the page useful at a glance: two Marketers with different
-- numbers next to them is the question worth clicking into.
--
-- Readable by anybody signed in, because a team directory is a phone
-- list. The permission columns are only filled in for somebody who may
-- manage users, so a viewer sees who works here and not who can do what.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION team_directory()
RETURNS TABLE (
  id             UUID,
  full_name      TEXT,
  email          TEXT,
  job_title      TEXT,
  photo_url      TEXT,
  location       TEXT,
  department     TEXT,
  manager        TEXT,
  role           TEXT,
  role_template  TEXT,
  template_slug  TEXT,
  is_active      BOOLEAN,
  capabilities   INT,
  overrides      INT,
  joined         TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE may_manage BOOLEAN;
BEGIN
  IF current_actor() IS NULL THEN
    RAISE EXCEPTION 'team_directory: not signed in';
  END IF;
  may_manage := command_may('admin.users');

  RETURN QUERY
  SELECT p.id, p.full_name, p.email, p.job_title, p.photo_url, p.location,
         d.name, m.full_name,
         p.role,
         t.name, t.slug,
         COALESCE(p.is_active, TRUE),
         CASE WHEN may_manage THEN (
           SELECT count(*)::INT FROM capability_catalog c
            WHERE actor_holds(p.id, c.key)
         ) END,
         CASE WHEN may_manage THEN (
           SELECT count(*)::INT FROM user_capability_overrides o
            WHERE o.user_id = p.id
         ) END,
         p.created_at
    FROM profiles p
    LEFT JOIN departments d   ON d.id = p.department_id
    LEFT JOIN profiles m      ON m.id = p.manager_id
    LEFT JOIN role_templates t ON t.id = p.role_template_id
   ORDER BY COALESCE(p.is_active, TRUE) DESC, p.full_name;
END;
$fn$;

GRANT EXECUTE ON FUNCTION team_directory() TO authenticated;

-- -------------------------------------------------------------
-- 6. Somebody's own permissions, for their own settings screen.
--
-- `capability_report` already answers this and refuses to answer it
-- about anybody else, which is right for an admin screen and wrong for
-- a person reading their own. This is the same answer about yourself,
-- and it needs no permission at all: knowing what you can do is not
-- privileged information about you.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION my_capabilities()
RETURNS TABLE (
  key         TEXT,
  label       TEXT,
  description TEXT,
  area        TEXT,
  feature     TEXT,
  granted     BOOLEAN,
  source      TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE me UUID;
BEGIN
  me := current_actor();
  IF me IS NULL THEN RAISE EXCEPTION 'my_capabilities: not signed in'; END IF;

  RETURN QUERY
  SELECT c.key, c.label, c.description, c.area, c.feature,
         actor_holds(me, c.key),
         CASE
           WHEN EXISTS (SELECT 1 FROM user_capability_overrides o
                         WHERE o.user_id = me AND o.capability = c.key AND o.granted)
             THEN 'granted to you specifically'
           WHEN EXISTS (SELECT 1 FROM user_capability_overrides o
                         WHERE o.user_id = me AND o.capability = c.key AND NOT o.granted)
             THEN 'refused to you specifically'
           WHEN actor_holds(me, c.key) THEN 'from your role'
           ELSE 'not in your role'
         END
    FROM capability_catalog c
   /* The same filter `capability_report` uses. A capability that has
      been retired is not a permission somebody is missing, and listing
      it on their own settings screen invites them to ask for it. */
   WHERE c.is_active
   ORDER BY c.area, c.feature, c.position;
END;
$fn$;

GRANT EXECUTE ON FUNCTION my_capabilities() TO authenticated;

-- -------------------------------------------------------------
-- 7. Somebody's own profile, written by them.
--
-- The columns a person owns about themselves. Deliberately not `role`,
-- `role_template_id`, `is_active` or `entity_id`: those are somebody
-- else's to set, and a policy that let a person write their own row
-- without naming the columns would let them write those too.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_my_profile(
  p_full_name       TEXT DEFAULT NULL,
  p_job_title       TEXT DEFAULT NULL,
  p_location        TEXT DEFAULT NULL,
  p_timezone        TEXT DEFAULT NULL,
  p_working_hours   TEXT DEFAULT NULL,
  p_responsibilities TEXT DEFAULT NULL,
  p_skills          TEXT[] DEFAULT NULL,
  p_photo_url       TEXT DEFAULT NULL,
  p_theme           TEXT DEFAULT NULL
)
RETURNS profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE me UUID; result profiles;
BEGIN
  me := current_actor();
  IF me IS NULL THEN RAISE EXCEPTION 'Sign in first.'; END IF;

  IF p_full_name IS NOT NULL AND NULLIF(btrim(p_full_name), '') IS NULL THEN
    RAISE EXCEPTION 'A name is how everybody else finds you, so it cannot be blank.';
  END IF;
  IF p_theme IS NOT NULL AND p_theme NOT IN ('dark', 'light') THEN
    RAISE EXCEPTION 'A theme is dark or light.';
  END IF;

  UPDATE profiles SET
    full_name       = COALESCE(NULLIF(btrim(p_full_name), ''), full_name),
    /* The rest take an empty string as "clear it", because a job title
       somebody typed by mistake has to be removable and COALESCE alone
       would make every field write once and never blank. */
    job_title       = CASE WHEN p_job_title IS NULL THEN job_title
                           ELSE NULLIF(btrim(p_job_title), '') END,
    location        = CASE WHEN p_location IS NULL THEN location
                           ELSE NULLIF(btrim(p_location), '') END,
    timezone        = CASE WHEN p_timezone IS NULL THEN timezone
                           ELSE NULLIF(btrim(p_timezone), '') END,
    working_hours   = CASE WHEN p_working_hours IS NULL THEN working_hours
                           ELSE NULLIF(btrim(p_working_hours), '') END,
    responsibilities = CASE WHEN p_responsibilities IS NULL THEN responsibilities
                           ELSE NULLIF(btrim(p_responsibilities), '') END,
    skills          = COALESCE(p_skills, skills),
    photo_url       = CASE WHEN p_photo_url IS NULL THEN photo_url
                           ELSE NULLIF(btrim(p_photo_url), '') END,
    theme           = COALESCE(p_theme, theme)
  WHERE id = me
  RETURNING * INTO result;

  RETURN result;
END;
$fn$;

REVOKE ALL ON FUNCTION update_my_profile FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_my_profile TO authenticated;

-- -------------------------------------------------------------
-- 8. And an administrator writing somebody else's details.
--
-- The directory half rather than the permission half: a job title, a
-- department, a manager. Separate from the function above because the
-- guards are different, and separate from the permission functions
-- because changing somebody's phone extension is not a permission
-- change and should not fill the audit log as one.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_update_profile(
  p_user       UUID,
  p_job_title  TEXT DEFAULT NULL,
  p_location   TEXT DEFAULT NULL,
  p_department UUID DEFAULT NULL,
  p_manager    UUID DEFAULT NULL
)
RETURNS profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE result profiles;
BEGIN
  IF NOT command_may('admin.users') THEN
    RAISE EXCEPTION 'Changing somebody else''s details is an administrator''s job.';
  END IF;
  IF p_manager = p_user THEN
    RAISE EXCEPTION 'Somebody cannot report to themselves.';
  END IF;

  UPDATE profiles SET
    job_title     = CASE WHEN p_job_title IS NULL THEN job_title
                         ELSE NULLIF(btrim(p_job_title), '') END,
    location      = CASE WHEN p_location IS NULL THEN location
                         ELSE NULLIF(btrim(p_location), '') END,
    department_id = COALESCE(p_department, department_id),
    manager_id    = COALESCE(p_manager, manager_id)
  WHERE id = p_user
  RETURNING * INTO result;

  IF result IS NULL THEN RAISE EXCEPTION 'There is nobody here with that id.'; END IF;
  RETURN result;
END;
$fn$;

REVOKE ALL ON FUNCTION admin_update_profile FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_update_profile TO authenticated;

-- -------------------------------------------------------------
-- 9. The hole every function above would otherwise be decoration for.
--
-- `authenticated` holds INSERT, UPDATE and DELETE on `profiles`,
-- granted by Supabase to every table in `public`, and the row level
-- policy `profiles_update_self` lets a person write their own row. That
-- pair is deliberate: it is how somebody changes their own name and
-- theme, and revoking the grant would lock administrators out with
-- everybody else.
--
-- Migration 005 put a trigger there for exactly this reason, and it
-- named two columns: `role` and `dashboard_variant`. They were the only
-- two that decided anything at the time.
--
-- Then migration 048 added `is_active`, `entity_id`, `department_id`
-- and `manager_id`, and migration 049 added `role_template_id`. Five
-- more columns that decide what somebody can do, none of them known to
-- a guard written before they existed. `actor_holds` reads the template
-- BEFORE the legacy role, so a viewer setting one column on their own
-- row became an administrator, and the trigger that exists to stop
-- precisely that let it through because it was checking a different
-- column.
--
-- So the guard is rewritten to name every column that carries
-- authority, and to be added to rather than replaced when the next one
-- arrives.
--
-- Two other things change with it:
--
--   It asks `actor_holds(..., 'admin.users')` rather than reading
--   `role = 'admin'`. An administrator whose access comes from a
--   template rather than the legacy column was being refused by their
--   own guard, which is the same bug 068 was: a permission model with
--   one route hard coded through it.
--
--   It says which column it refused. "Only an administrator can change
--   a role" on an update that touched four fields tells nobody which
--   one to take back out.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_profile_privileges()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  touched TEXT;
BEGIN
  /* No signed in user is the service role key, which is server only and
     already omnipotent. Blocking it here would break nothing an
     attacker can reach and would break the seeder. */
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  IF actor_holds(auth.uid(), 'admin.users') THEN RETURN NEW; END IF;

  /* Read through jsonb rather than as NEW.<column>, because these
     columns arrive across five migrations and this trigger has to work
     on a database where the later ones have not run yet. Naming a
     missing column directly would fail on every profile update. */
  SELECT c INTO touched
    FROM unnest(ARRAY[
      'role',              -- who you are, the legacy way
      'role_template_id',  -- who you are, the current way
      'dashboard_variant', -- which dashboard you get
      'is_active',         -- whether the account works at all
      'deactivated_at',
      'entity_id',         -- which side of the business you can see
      'department_id',     -- and `actor_scope` reads this one
      'manager_id'
    ]) AS c
   WHERE to_jsonb(NEW) ->> c IS DISTINCT FROM to_jsonb(OLD) ->> c
   LIMIT 1;

  IF touched IS NOT NULL THEN
    RAISE EXCEPTION
      'Only an administrator can change %. Everything else on your profile is yours to edit.',
      touched;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS profiles_guard_privileges ON profiles;
CREATE TRIGGER profiles_guard_privileges
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION guard_profile_privileges();

-- -------------------------------------------------------------
-- 10. Did it land.
-- -------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'admin_set_capability') THEN
    RAISE EXCEPTION 'the permission hub has no way to grant a capability';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'profiles_guard_privileges') THEN
    RAISE EXCEPTION 'the profile guard is not on the table, so anybody can promote themselves';
  END IF;
  RAISE NOTICE 'ok  permissions can now be granted, refused and cleared, and every change is audited';
  RAISE NOTICE 'ok  eight columns on a profile now need admin.users, where two did';
END $$;

COMMENT ON FUNCTION admin_set_capability IS
  'Grant, refuse or clear one capability for one person. NULL clears the '
  'override so their role decides again, which is the state that makes '
  'the model recoverable from a mistake.';
