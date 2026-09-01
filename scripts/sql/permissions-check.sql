-- =============================================================
-- The permission hub, and the five things it must never let happen.
--
-- 1. Somebody who is not an administrator changing anybody's access.
-- 2. The last administrator losing `admin.users`, by any of the three
--    routes that can take it: an override, a role template, or the
--    account being turned off.
-- 3. An administrator taking their own administrator access away, which
--    is the same lockout with a friendlier click.
-- 4. A capability granted on top of a prerequisite the person does not
--    hold, which resolves and then fails at the route.
-- 5. A permission change with no line in the audit log saying who made
--    it and to whom.
--
-- Plus the one thing it must always let happen: clearing an override so
-- the role decides again. Without that third state the only way back
-- from a mistake is a refusal that stays on the record forever.
--
-- Everything below runs as `authenticated` where it matters. `postgres`
-- owns these tables and bypasses row level security, so a file that
-- stayed superuser would report that a viewer had been stopped when in
-- fact the write went through.
--
-- One trap worth naming, because it was found the hard way in the
-- amendments check: `SET ROLE` issued inside a plpgsql function is
-- rolled back when that function returns. Every role switch below is
-- therefore a top level statement, never a helper.
--
-- Run with `npm run check:permissions`.
-- =============================================================
\set ON_ERROR_STOP on

BEGIN;

-- -------------------------------------------------------------
-- The people. Two administrators, so the last-admin guard has
-- something to allow as well as something to refuse, then one of them
-- is removed to make the other the last one.
-- -------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('cc000000-0000-0000-0000-000000000001', 'perm.admin@example.test'),
  ('cc000000-0000-0000-0000-000000000002', 'perm.second.admin@example.test'),
  ('cc000000-0000-0000-0000-000000000003', 'perm.sales@example.test'),
  ('cc000000-0000-0000-0000-000000000004', 'perm.viewer@example.test')
ON CONFLICT DO NOTHING;

UPDATE profiles SET role = 'admin',  role_template_id = NULL, full_name = 'Perm Admin'
 WHERE id = 'cc000000-0000-0000-0000-000000000001';
UPDATE profiles SET role = 'admin',  role_template_id = NULL, full_name = 'Perm Second Admin'
 WHERE id = 'cc000000-0000-0000-0000-000000000002';
UPDATE profiles SET role = 'sales',  role_template_id = NULL, full_name = 'Perm Sales'
 WHERE id = 'cc000000-0000-0000-0000-000000000003';
UPDATE profiles SET role = 'viewer', role_template_id = NULL, full_name = 'Perm Viewer'
 WHERE id = 'cc000000-0000-0000-0000-000000000004';

-- Everybody else in the fixture goes off admin, so "the last
-- administrator" means the two above and nothing the legacy row
-- fixture happens to carry.
UPDATE profiles SET role = 'viewer', role_template_id = NULL
 WHERE role = 'admin' AND id::TEXT NOT LIKE 'cc000000-%';

DO $$
BEGIN
  IF (SELECT count(*) FROM profiles WHERE id::TEXT LIKE 'cc000000-%') <> 4 THEN
    RAISE EXCEPTION 'fixture: expected four people, found %',
      (SELECT count(*) FROM profiles WHERE id::TEXT LIKE 'cc000000-%');
  END IF;
  IF (SELECT count(*) FROM capability_catalog) = 0 THEN
    RAISE EXCEPTION
      'fixture: the register is empty, so every assertion below is testing nothing';
  END IF;
  IF NOT actor_holds('cc000000-0000-0000-0000-000000000001', 'admin.users') THEN
    RAISE EXCEPTION 'fixture: the admin does not hold admin.users, so nothing below is a guard';
  END IF;
  IF actor_holds('cc000000-0000-0000-0000-000000000003', 'admin.users') THEN
    RAISE EXCEPTION 'fixture: sales holds admin.users, so the refusals below prove nothing';
  END IF;
  RAISE NOTICE 'ok  fixture: two administrators, one sales, one viewer, on the legacy role path';
END $$;

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_who UUID) RETURNS VOID
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_who::TEXT, TRUE);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
END;
$fn$;

-- A capability that takes a prerequisite, and one that does not, both
-- read off the register rather than named, so this file does not go
-- stale the day somebody renumbers the catalog.
CREATE OR REPLACE FUNCTION pg_temp.a_capability_needing(p_needing BOOLEAN) RETURNS TEXT
LANGUAGE sql STABLE AS $fn$
  SELECT key FROM capability_catalog
   WHERE (COALESCE(array_length(requires, 1), 0) > 0) = p_needing
     AND key <> 'admin.users'
   ORDER BY key LIMIT 1;
$fn$;

-- =============================================================
-- 1. Nobody but an administrator changes anybody's access.
-- =============================================================
SET ROLE authenticated;

DO $$
DECLARE cap TEXT; ok BOOLEAN;
BEGIN
  /* Read the register as somebody, because it is behind row level
     security and an anonymous read comes back empty. A fixture that
     silently found nothing is a file full of assertions about NULL. */
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000003');
  cap := pg_temp.a_capability_needing(FALSE);
  IF cap IS NULL THEN RAISE EXCEPTION 'fixture: no capability without prerequisites'; END IF;

  ok := FALSE;
  BEGIN
    PERFORM admin_set_capability('cc000000-0000-0000-0000-000000000004', cap, TRUE, 'because I said so');
  EXCEPTION WHEN OTHERS THEN ok := TRUE;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'a salesperson granted % to somebody. The screen is the only thing stopping them.', cap;
  END IF;

  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000004');
  ok := FALSE;
  BEGIN
    PERFORM admin_set_role_template('cc000000-0000-0000-0000-000000000003', 'administrator');
  EXCEPTION WHEN OTHERS THEN ok := TRUE;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'a viewer made somebody an administrator'; END IF;

  ok := FALSE;
  BEGIN
    PERFORM admin_set_active('cc000000-0000-0000-0000-000000000001', FALSE);
  EXCEPTION WHEN OTHERS THEN ok := TRUE;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'a viewer turned an administrator off'; END IF;

  ok := FALSE;
  BEGIN
    PERFORM admin_update_profile('cc000000-0000-0000-0000-000000000003', 'Head of Everything');
  EXCEPTION WHEN OTHERS THEN ok := TRUE;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'a viewer rewrote somebody else''s job title'; END IF;

  RAISE NOTICE 'ok  a salesperson and a viewer are refused all four write operations';
END $$;

-- =============================================================
-- 2. Grant, refuse, and clear. The three states.
-- =============================================================
DO $$
DECLARE cap TEXT; before_state BOOLEAN;
BEGIN
  cap := pg_temp.a_capability_needing(FALSE);
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');

  before_state := actor_holds('cc000000-0000-0000-0000-000000000004', cap);

  PERFORM admin_set_capability('cc000000-0000-0000-0000-000000000004', cap, TRUE, 'covering while Dave is away');
  IF NOT actor_holds('cc000000-0000-0000-0000-000000000004', cap) THEN
    RAISE EXCEPTION 'granting % did not grant it', cap;
  END IF;

  PERFORM admin_set_capability('cc000000-0000-0000-0000-000000000004', cap, FALSE, 'Dave is back');
  IF actor_holds('cc000000-0000-0000-0000-000000000004', cap) THEN
    RAISE EXCEPTION 'refusing % left them holding it', cap;
  END IF;

  /* The state that makes the model recoverable. Clearing is not the
     same as refusing, and a screen that only had two buttons would
     leave a refusal on the record forever. */
  PERFORM admin_set_capability('cc000000-0000-0000-0000-000000000004', cap, NULL);
  IF EXISTS (SELECT 1 FROM user_capability_overrides
              WHERE user_id = 'cc000000-0000-0000-0000-000000000004' AND capability = cap) THEN
    RAISE EXCEPTION 'clearing the override on % left the row behind', cap;
  END IF;
  IF actor_holds('cc000000-0000-0000-0000-000000000004', cap) IS DISTINCT FROM before_state THEN
    RAISE EXCEPTION
      'clearing the override on % did not put them back where they started', cap;
  END IF;

  RAISE NOTICE 'ok  grant, refuse and clear, and clearing puts the role back in charge';
END $$;

-- =============================================================
-- 3. A capability whose prerequisite is missing is refused, and named.
-- =============================================================
DO $$
DECLARE cap TEXT; needs TEXT[]; ok BOOLEAN; msg TEXT;
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');

  SELECT c.key, c.requires INTO cap, needs
    FROM capability_catalog c
   WHERE COALESCE(array_length(c.requires, 1), 0) > 0
     AND NOT actor_holds('cc000000-0000-0000-0000-000000000004', c.requires[1])
   ORDER BY c.key LIMIT 1;

  IF cap IS NULL THEN
    RAISE NOTICE 'ok  (skipped) the viewer already holds every prerequisite in the register';
    RETURN;
  END IF;

  ok := FALSE;
  BEGIN
    PERFORM admin_set_capability('cc000000-0000-0000-0000-000000000004', cap, TRUE, 'go on then');
  EXCEPTION WHEN OTHERS THEN ok := TRUE; msg := SQLERRM;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION
      '% was granted without %, so the button appears and the save refuses them', cap, needs[1];
  END IF;
  IF position(needs[1] IN msg) = 0 THEN
    RAISE EXCEPTION
      'the refusal did not name what is missing. It said: %', msg;
  END IF;

  /* And it goes through once the prerequisite is there, which is the
     half that proves the guard is a prerequisite check and not a
     blanket refusal. */
  PERFORM admin_set_capability('cc000000-0000-0000-0000-000000000004', needs[1], TRUE, 'first things first');
  PERFORM admin_set_capability('cc000000-0000-0000-0000-000000000004', cap, TRUE, 'and now this');
  IF NOT actor_holds('cc000000-0000-0000-0000-000000000004', cap) THEN
    RAISE EXCEPTION '% still did not land with % in place', cap, needs[1];
  END IF;

  PERFORM admin_set_capability('cc000000-0000-0000-0000-000000000004', cap, NULL);
  PERFORM admin_set_capability('cc000000-0000-0000-0000-000000000004', needs[1], NULL);

  RAISE NOTICE 'ok  a capability missing its prerequisite is refused, and the refusal names it';
END $$;

-- =============================================================
-- 4. A name not on the register can never be granted.
-- =============================================================
DO $$
DECLARE ok BOOLEAN := FALSE;
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');
  BEGIN
    PERFORM admin_set_capability('cc000000-0000-0000-0000-000000000004', 'crm.doAnything', TRUE);
  EXCEPTION WHEN OTHERS THEN ok := TRUE;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'a capability nothing checks was written to somebody''s record';
  END IF;
  RAISE NOTICE 'ok  a permission that is not in the register cannot be granted';
END $$;

-- =============================================================
-- 5. The lockout guards. Three routes, one door.
-- =============================================================
DO $$
DECLARE ok BOOLEAN;
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');

  -- Route one, while there are still two administrators: allowed.
  PERFORM admin_set_capability('cc000000-0000-0000-0000-000000000002', 'admin.users', FALSE,
                               'stepping back from user management');
  IF actor_holds('cc000000-0000-0000-0000-000000000002', 'admin.users') THEN
    RAISE EXCEPTION 'the second administrator kept admin.users after it was refused';
  END IF;

  -- And now there is one. Every route out is shut.
  IF someone_else_can_admin('cc000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION
      'fixture: somebody else can still administer, so the last-admin guards below prove nothing';
  END IF;

  -- Route one again, on the last one. Refused.
  ok := FALSE;
  BEGIN
    PERFORM admin_set_capability('cc000000-0000-0000-0000-000000000001', 'admin.users', FALSE);
  EXCEPTION WHEN OTHERS THEN ok := TRUE;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'the last administrator refused themselves admin.users'; END IF;

  -- Route two: a role template with no admin.users on it. Refused.
  ok := FALSE;
  BEGIN
    PERFORM admin_set_role_template('cc000000-0000-0000-0000-000000000001', 'observer');
  EXCEPTION WHEN OTHERS THEN ok := TRUE;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'the last administrator moved themselves onto a template with no admin'; END IF;
  IF NOT actor_holds('cc000000-0000-0000-0000-000000000001', 'admin.users') THEN
    RAISE EXCEPTION
      'the refusal did not roll back. They are locked out and the error message said they were not.';
  END IF;

  -- Route three: turning the account off. Refused.
  ok := FALSE;
  BEGIN
    PERFORM admin_set_active('cc000000-0000-0000-0000-000000000001', FALSE);
  EXCEPTION WHEN OTHERS THEN ok := TRUE;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'the last administrator turned their own account off'; END IF;

  RAISE NOTICE 'ok  the last administrator cannot be removed by an override, a template, or being turned off';
END $$;

-- =============================================================
-- 6. Somebody else gets admin, and then the door opens again.
-- =============================================================
DO $$
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');

  PERFORM admin_set_capability('cc000000-0000-0000-0000-000000000003', 'admin.users', TRUE,
                               'taking over user management');
  IF NOT actor_holds('cc000000-0000-0000-0000-000000000003', 'admin.users') THEN
    RAISE EXCEPTION 'granting admin.users did not grant it';
  END IF;

  -- Now the first one can step down, because somebody else is holding
  -- the door. Done by the new administrator, because you still cannot
  -- take your own admin away.
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000003');
  PERFORM admin_set_capability('cc000000-0000-0000-0000-000000000001', 'admin.users', FALSE,
                               'handed over');
  IF actor_holds('cc000000-0000-0000-0000-000000000001', 'admin.users') THEN
    RAISE EXCEPTION 'the handover did not take the old administrator''s access away';
  END IF;

  -- Put it back for the rest of the file.
  PERFORM admin_set_capability('cc000000-0000-0000-0000-000000000001', 'admin.users', TRUE, 'back on');
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');
  PERFORM admin_set_capability('cc000000-0000-0000-0000-000000000003', 'admin.users', NULL);
  PERFORM admin_set_capability('cc000000-0000-0000-0000-000000000002', 'admin.users', NULL);

  RAISE NOTICE 'ok  a handover works: grant somebody else first, and the door opens';
END $$;

-- =============================================================
-- 7. You cannot take your own administrator access away, even when
--    somebody else has it.
-- =============================================================
DO $$
DECLARE ok BOOLEAN := FALSE;
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');
  IF NOT someone_else_can_admin('cc000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'fixture: nobody else can administer, so this assertion is the previous one again';
  END IF;
  BEGIN
    PERFORM admin_set_capability('cc000000-0000-0000-0000-000000000001', 'admin.users', FALSE);
  EXCEPTION WHEN OTHERS THEN ok := TRUE;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'an administrator shut the door behind themselves';
  END IF;
  RAISE NOTICE 'ok  nobody takes their own administrator access away, whoever else holds it';
END $$;

-- =============================================================
-- 8. Role templates, and the overrides that survive them.
-- =============================================================
DO $$
DECLARE kept BOOLEAN; cap TEXT;
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');
  cap := pg_temp.a_capability_needing(FALSE);

  PERFORM admin_set_capability('cc000000-0000-0000-0000-000000000004', cap, TRUE, 'an exception, on purpose');
  PERFORM admin_set_role_template('cc000000-0000-0000-0000-000000000004', 'contributor');

  IF (SELECT t.slug FROM profiles p JOIN role_templates t ON t.id = p.role_template_id
       WHERE p.id = 'cc000000-0000-0000-0000-000000000004') <> 'contributor' THEN
    RAISE EXCEPTION 'the template did not move';
  END IF;

  /* Deliberate: an exception somebody was granted for a reason does not
     stop being true because their job changed. */
  kept := EXISTS (SELECT 1 FROM user_capability_overrides
                   WHERE user_id = 'cc000000-0000-0000-0000-000000000004' AND capability = cap);
  IF NOT kept THEN
    RAISE EXCEPTION 'moving somebody onto a template quietly threw their exceptions away';
  END IF;

  PERFORM admin_set_capability('cc000000-0000-0000-0000-000000000004', cap, NULL);
  PERFORM admin_set_role_template('cc000000-0000-0000-0000-000000000004', NULL);
  IF (SELECT role_template_id FROM profiles WHERE id = 'cc000000-0000-0000-0000-000000000004') IS NOT NULL THEN
    RAISE EXCEPTION 'taking somebody off templates left them on one';
  END IF;

  RAISE NOTICE 'ok  a template moves, keeps their exceptions, and can be taken off again';
END $$;

-- =============================================================
-- 9. Turning somebody off and back on, and never yourself.
-- =============================================================
DO $$
DECLARE ok BOOLEAN := FALSE;
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');

  PERFORM admin_set_active('cc000000-0000-0000-0000-000000000004', FALSE);
  IF (SELECT is_active FROM profiles WHERE id = 'cc000000-0000-0000-0000-000000000004') THEN
    RAISE EXCEPTION 'deactivating did not deactivate';
  END IF;
  IF (SELECT deactivated_at FROM profiles WHERE id = 'cc000000-0000-0000-0000-000000000004') IS NULL THEN
    RAISE EXCEPTION 'nothing recorded when the account was turned off';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = 'cc000000-0000-0000-0000-000000000004') THEN
    RAISE EXCEPTION 'deactivating deleted the row, and every record they own with it';
  END IF;

  PERFORM admin_set_active('cc000000-0000-0000-0000-000000000004', TRUE);
  IF (SELECT deactivated_at FROM profiles WHERE id = 'cc000000-0000-0000-0000-000000000004') IS NOT NULL THEN
    RAISE EXCEPTION 'turning the account back on left the date it went off';
  END IF;

  BEGIN
    PERFORM admin_set_active('cc000000-0000-0000-0000-000000000001', FALSE);
  EXCEPTION WHEN OTHERS THEN ok := TRUE;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'an administrator turned their own account off'; END IF;

  RAISE NOTICE 'ok  an account is turned off and on, the row survives, and never your own';
END $$;

-- =============================================================
-- 10. Everything is audited, and the line says who and to whom.
-- =============================================================
DO $$
DECLARE lines INT; cap TEXT;
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');
  cap := pg_temp.a_capability_needing(FALSE);

  SELECT count(*) INTO lines FROM audit_log
   WHERE action = 'permission_change' AND target_id = 'cc000000-0000-0000-0000-000000000004';

  PERFORM admin_set_capability('cc000000-0000-0000-0000-000000000004', cap, TRUE, 'auditable');

  IF (SELECT count(*) FROM audit_log
       WHERE action = 'permission_change' AND target_id = 'cc000000-0000-0000-0000-000000000004') <> lines + 1 THEN
    RAISE EXCEPTION 'a permission change wrote no line to the audit log';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM audit_log
     WHERE action = 'permission_change'
       AND target_id = 'cc000000-0000-0000-0000-000000000004'
       AND actor_id = 'cc000000-0000-0000-0000-000000000001'
       AND before ->> 'capability' = cap
       AND before ->> 'reason' = 'auditable'
     ORDER BY id DESC LIMIT 1
  ) THEN
    RAISE EXCEPTION
      'the audit line does not say who changed what, or why, which is the whole point of writing one';
  END IF;

  PERFORM admin_set_capability('cc000000-0000-0000-0000-000000000004', cap, NULL);
  RAISE NOTICE 'ok  every permission change writes a line naming the actor, the capability and the reason';
END $$;

-- =============================================================
-- 11. What a person can read about themselves, and about the team.
-- =============================================================
DO $$
DECLARE mine INT; holds INT; team INT; withCounts INT;
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000004');

  SELECT count(*) INTO mine FROM my_capabilities();
  IF mine <> (SELECT count(*) FROM capability_catalog WHERE is_active) THEN
    RAISE EXCEPTION
      'my_capabilities showed % of % live permissions. A screen that lists only what you have cannot show what you do not.',
      mine, (SELECT count(*) FROM capability_catalog WHERE is_active);
  END IF;
  IF EXISTS (SELECT 1 FROM my_capabilities() m
              JOIN capability_catalog c ON c.key = m.key WHERE NOT c.is_active) THEN
    RAISE EXCEPTION
      'a retired capability was listed, which invites somebody to ask for a permission that no longer decides anything';
  END IF;

  SELECT count(*) INTO holds FROM my_capabilities() WHERE granted;
  IF holds = 0 THEN
    RAISE EXCEPTION 'a viewer resolved to no permissions at all, which cannot be right';
  END IF;

  IF EXISTS (SELECT 1 FROM my_capabilities() WHERE source IS NULL OR source = '') THEN
    RAISE EXCEPTION 'a permission with no explanation of where it came from';
  END IF;

  -- The directory is a phone list, so a viewer sees the people.
  SELECT count(*) INTO team FROM team_directory();
  IF team < 4 THEN
    RAISE EXCEPTION 'the directory showed % people, and there are at least four', team;
  END IF;

  -- And not who can do what.
  SELECT count(*) INTO withCounts FROM team_directory() WHERE capabilities IS NOT NULL;
  IF withCounts <> 0 THEN
    RAISE EXCEPTION
      'a viewer was shown how many permissions everybody holds, which is a map of the building';
  END IF;

  RAISE NOTICE 'ok  a viewer sees every permission with its source, the whole team, and nobody''s permission counts';
END $$;

DO $$
DECLARE withCounts INT; me RECORD;
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');
  SELECT count(*) INTO withCounts FROM team_directory() WHERE capabilities IS NOT NULL;
  IF withCounts < 4 THEN
    RAISE EXCEPTION
      'an administrator was shown permission counts for only % people', withCounts;
  END IF;

  SELECT * INTO me FROM team_directory() WHERE id = 'cc000000-0000-0000-0000-000000000001';
  IF me.full_name IS NULL OR me.role IS NULL THEN
    RAISE EXCEPTION 'the directory row is missing the name or the role';
  END IF;
  IF me.capabilities = 0 THEN
    RAISE EXCEPTION 'the administrator resolves to no permissions, so the count is not counting';
  END IF;

  RAISE NOTICE 'ok  an administrator sees the permission counts that make the overview worth clicking';
END $$;

-- =============================================================
-- 11b. The two sentences the admin screen reads an override out of.
--
-- `capability_report` reports the three states as prose, and the screen
-- has nothing else to switch on. `overrideState` in lib/platform/team.ts
-- matches the first two words of each. Reword either sentence without
-- this assertion and every exception on the screen quietly reads as
-- "from their role", which is the one thing the screen exists to show.
-- =============================================================
DO $$
DECLARE cap TEXT; said TEXT;
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');
  cap := pg_temp.a_capability_needing(FALSE);

  PERFORM admin_set_capability('cc000000-0000-0000-0000-000000000004', cap, TRUE, 'for the wording');
  SELECT source INTO said FROM capability_report('cc000000-0000-0000-0000-000000000004') WHERE key = cap;
  IF said NOT LIKE 'granted to%' THEN
    RAISE EXCEPTION
      'a granted override reads "%", and lib/platform/team.ts matches "granted to". Every exception on the admin screen would read as coming from their role.',
      said;
  END IF;

  PERFORM admin_set_capability('cc000000-0000-0000-0000-000000000004', cap, FALSE, 'for the wording');
  SELECT source INTO said FROM capability_report('cc000000-0000-0000-0000-000000000004') WHERE key = cap;
  IF said NOT LIKE 'refused to%' THEN
    RAISE EXCEPTION
      'a refused override reads "%", and lib/platform/team.ts matches "refused to".', said;
  END IF;

  PERFORM admin_set_capability('cc000000-0000-0000-0000-000000000004', cap, NULL);
  SELECT source INTO said FROM capability_report('cc000000-0000-0000-0000-000000000004') WHERE key = cap;
  IF said LIKE 'granted to%' OR said LIKE 'refused to%' THEN
    RAISE EXCEPTION
      'with no override the source still reads "%", so a cleared permission would show as an exception forever', said;
  END IF;

  RAISE NOTICE 'ok  the three override states still read the way the screen matches them';
END $$;

-- =============================================================
-- 12. A person's own profile: what they may write, and what they cannot.
-- =============================================================
DO $$
DECLARE p profiles; ok BOOLEAN := FALSE;
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000004');

  p := update_my_profile(p_full_name := 'Perm Viewer Renamed', p_job_title := 'Yard Supervisor');
  IF p.full_name <> 'Perm Viewer Renamed' OR p.job_title <> 'Yard Supervisor' THEN
    RAISE EXCEPTION 'somebody could not write their own name or job title';
  END IF;

  -- An empty string clears; NULL leaves alone. Both matter: a title
  -- typed by mistake has to be removable, and a form that posts one
  -- field must not blank the other nine.
  p := update_my_profile(p_job_title := '');
  IF p.job_title IS NOT NULL THEN RAISE EXCEPTION 'an empty job title did not clear it'; END IF;
  IF p.full_name <> 'Perm Viewer Renamed' THEN
    RAISE EXCEPTION 'writing one field blanked another';
  END IF;

  BEGIN
    PERFORM update_my_profile(p_full_name := '   ');
  EXCEPTION WHEN OTHERS THEN ok := TRUE;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'somebody blanked their own name and vanished from every list'; END IF;

  -- The columns they do not own are not arguments, so there is no way
  -- to reach them. Proved by the signature rather than by a refusal:
  -- an argument that does not exist cannot be passed.
  IF EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'update_my_profile'
       AND pg_get_function_arguments(oid) ~ '(role|is_active|entity_id|role_template_id)'
  ) THEN
    RAISE EXCEPTION
      'update_my_profile takes a column somebody should not be able to set on themselves';
  END IF;

  RAISE NOTICE 'ok  a person writes their own details, cannot blank their name, and cannot reach their own role';
END $$;

-- =============================================================
-- 13. The row itself is not a back door.
--
-- `authenticated` can UPDATE `profiles`, and the policy lets a person
-- write their own row. Everything above is decoration if a viewer can
-- set one column on themselves and be an administrator, which is what
-- the guard written in migration 005 allowed once migrations 048 and
-- 049 added columns it had never heard of.
--
-- Every column below is tried one at a time, because a guard that
-- catches four out of five is a guard with a hole in it and a loop
-- checking "did anything get through" would not say which.
--
-- The value is written into the statement already typed, and the state
-- code is checked as well as the message. The first draft of this
-- passed a TEXT parameter into a UUID column: Postgres refused it on
-- type before the trigger ever ran, the datatype error happened to
-- contain the column name, and five of the seven assertions were
-- reporting a guard that was not there. A refusal is only this guard's
-- refusal if it is P0001, which is what RAISE EXCEPTION produces.
-- =============================================================
DO $$
DECLARE
  col       TEXT;
  value     TEXT;
  admin_tpl UUID;
  got       TEXT;
  state     TEXT;
  ok        BOOLEAN;
  columns   TEXT[][];
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');
  SELECT id INTO admin_tpl FROM role_templates WHERE slug = 'administrator';
  IF admin_tpl IS NULL THEN RAISE EXCEPTION 'fixture: no administrator template to escalate onto'; END IF;

  /* A write that does not change the value is not a write the trigger
     has any reason to refuse, so the two columns pointing at other
     tables need somewhere real and different to point. */
  UPDATE profiles SET entity_id = NULL, department_id = NULL
   WHERE id = 'cc000000-0000-0000-0000-000000000004';
  IF NOT EXISTS (SELECT 1 FROM entities) OR NOT EXISTS (SELECT 1 FROM departments) THEN
    RAISE EXCEPTION
      'fixture: no entity or no department, so two of the seven assertions below would change nothing and pass';
  END IF;

  columns := ARRAY[
    ARRAY['role',             quote_literal('admin')],
    ARRAY['role_template_id', quote_literal(admin_tpl::TEXT) || '::UUID'],
    ARRAY['is_active',        'FALSE'],
    ARRAY['deactivated_at',   'NOW()'],
    ARRAY['entity_id',        '(SELECT id FROM entities LIMIT 1)'],
    ARRAY['department_id',    '(SELECT id FROM departments LIMIT 1)'],
    ARRAY['manager_id',       quote_literal('cc000000-0000-0000-0000-000000000001') || '::UUID']
  ];

  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000004');

  FOR i IN 1 .. array_length(columns, 1) LOOP
    col   := columns[i][1];
    value := columns[i][2];
    ok    := FALSE;
    BEGIN
      EXECUTE format(
        'UPDATE profiles SET %I = %s WHERE id = ''cc000000-0000-0000-0000-000000000004''',
        col, value);
    EXCEPTION WHEN OTHERS THEN
      ok := TRUE; got := SQLERRM; state := SQLSTATE;
    END;

    IF NOT ok THEN
      RAISE EXCEPTION
        'a viewer wrote profiles.% on their own row. Every guard above goes through a function, and this does not.',
        col;
    END IF;
    IF state <> 'P0001' THEN
      RAISE EXCEPTION
        'the write to % failed for a reason that is not the guard (%): %. That assertion was testing nothing.',
        col, state, got;
    END IF;
    IF position(col IN got) = 0 THEN
      RAISE EXCEPTION
        'the refusal on % did not say which column it refused, so nobody knows what to take back out. It said: %',
        col, got;
    END IF;
  END LOOP;

  /* And the half that proves it is a guard and not a wall: their own
     name and theme are still theirs. */
  UPDATE profiles SET full_name = 'Perm Viewer', theme = 'light'
   WHERE id = 'cc000000-0000-0000-0000-000000000004';
  IF (SELECT theme FROM profiles WHERE id = 'cc000000-0000-0000-0000-000000000004') <> 'light' THEN
    RAISE EXCEPTION 'the guard stopped somebody changing their own theme';
  END IF;

  RAISE NOTICE 'ok  seven columns that decide what somebody can do are refused on their own row, by name, and their name and theme are not';
END $$;

-- An administrator on a role template rather than the legacy role
-- column is still an administrator to the guard. The old one read
-- `role = 'admin'` and would have refused them their own screen.
DO $$
DECLARE admin_tpl UUID;
BEGIN
  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000001');
  SELECT id INTO admin_tpl FROM role_templates WHERE slug = 'administrator';

  UPDATE profiles SET role_template_id = admin_tpl, role = 'viewer'
   WHERE id = 'cc000000-0000-0000-0000-000000000002';

  PERFORM pg_temp.act_as('cc000000-0000-0000-0000-000000000002');
  IF NOT actor_holds('cc000000-0000-0000-0000-000000000002', 'admin.users') THEN
    RAISE EXCEPTION 'fixture: the administrator template does not carry admin.users';
  END IF;

  UPDATE profiles SET job_title = 'Set by a template administrator'
   WHERE id = 'cc000000-0000-0000-0000-000000000003';
  PERFORM admin_set_capability('cc000000-0000-0000-0000-000000000003',
                               pg_temp.a_capability_needing(FALSE), TRUE, 'by a template admin');

  RAISE NOTICE 'ok  an administrator by template, with a viewer''s legacy role, is still an administrator';
END $$;

-- =============================================================
-- 14. The table itself is not a back door.
--
-- Supabase grants `authenticated` ALL on every table in `public` by
-- default, so a function with guards on it means nothing if the same
-- row can be written directly. Checked against the catalog rather than
-- by attempting a write, because the owner of these tables bypasses
-- row level security and would pass either way.
-- =============================================================
RESET ROLE;
DO $$
DECLARE bad TEXT;
BEGIN
  SELECT string_agg(format('%s.%s', table_name, privilege_type), ', ')
    INTO bad
    FROM information_schema.role_table_grants
   WHERE grantee = 'authenticated'
     AND table_schema = 'public'
     AND table_name IN ('user_capability_overrides', 'role_template_capabilities', 'role_templates')
     AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'authenticated can write permissions directly, so every guard above is advisory: %', bad;
  END IF;
  RAISE NOTICE 'ok  the permission tables are read only to authenticated, so the functions are the only way in';
END $$;

ROLLBACK;
