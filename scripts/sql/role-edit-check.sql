-- =============================================================
-- Changing what a role can do.
--
-- From the business:
--
--   Within here, I should be able to also manage what each role type
--   can do, which auto-affects users within that role on their
--   role-inherited permissions.
--
-- "Auto-affects users within that role" is the assertion that matters
-- and is the first one below: the resolution is a join, so a grant on
-- the role IS a grant on everybody holding it, with no job to run and
-- no second copy to go stale.
--
-- Everything after that is a way of locking the company out of its own
-- administration, and each one is refused in the database rather than
-- by hiding a control, because a control that is merely hidden is a
-- control somebody reaches with a POST.
--
-- Run with `npm run check:role-edit`.
-- =============================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.must(what TEXT, held BOOLEAN)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF held THEN RAISE NOTICE 'ok    %', what;
  ELSE RAISE EXCEPTION 'FAILED: %', what; END IF;
END $$;

/* Did a call refuse, and did it say why in words a person could act on? */
CREATE OR REPLACE FUNCTION pg_temp.refused(sql TEXT, needle TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RETURN FALSE;
EXCEPTION WHEN OTHERS THEN
  RETURN position(lower(needle) IN lower(SQLERRM)) > 0;
END $$;

DO $$
DECLARE
  boss     UUID;
  rep      UUID;
  srsales  UUID;
  sales    UUID;
  mdrole   UUID;
  devrole  UUID;
  answer   JSONB;
BEGIN
  SELECT id INTO srsales FROM role_templates WHERE slug = 'sr_sales';
  SELECT id INTO sales   FROM role_templates WHERE slug = 'sales_rep';
  SELECT id INTO mdrole  FROM role_templates WHERE slug = 'managing_director';
  SELECT id INTO devrole FROM role_templates WHERE slug = 'developer';

  PERFORM set_config('request.jwt.claim.sub', '', TRUE);

  INSERT INTO auth.users (id, email) VALUES
    (gen_random_uuid(), 'boss@test.local'),
    (gen_random_uuid(), 'rep@test.local');
  SELECT id INTO boss FROM profiles WHERE email = 'boss@test.local';
  SELECT id INTO rep  FROM profiles WHERE email = 'rep@test.local';

  UPDATE profiles SET role_template_id = mdrole, role = 'admin' WHERE id = boss;
  UPDATE profiles SET role_template_id = sales, role = 'sales'  WHERE id = rep;

  -- ===========================================================
  -- 1. A change to the role is a change to everybody on it.
  -- ===========================================================
  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);
  PERFORM pg_temp.must('a salesperson cannot export the CRM to begin with',
    NOT command_may('crm.export'));

  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);
  answer := set_role_capability(sales, 'crm.export', TRUE, 'company');
  PERFORM pg_temp.must('and the change says how many people it just reached',
    (answer ->> 'people')::INTEGER = 1 AND (answer ->> 'changed')::BOOLEAN);

  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);
  PERFORM pg_temp.must('a grant on the ROLE reaches the person on it, with no job to run',
    command_may('crm.export'));

  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);
  PERFORM set_role_capability(sales, 'crm.export', FALSE);
  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);
  PERFORM pg_temp.must('and taking it off the role takes it off them too',
    NOT command_may('crm.export'));

  -- ===========================================================
  -- 2. A decision about ONE PERSON still wins.
  --
  -- The whole point of an override. Somebody refused individually stays
  -- refused when their role is granted it, or the override would be a
  -- suggestion.
  -- ===========================================================
  PERFORM set_config('request.jwt.claim.sub', '', TRUE);
  INSERT INTO user_capability_overrides (user_id, capability, granted, reason)
  VALUES (rep, 'crm.export', FALSE, 'Left the export to Sr Sales')
  ON CONFLICT (user_id, capability) DO UPDATE SET granted = FALSE;

  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);
  PERFORM set_role_capability(sales, 'crm.export', TRUE, 'company');
  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);
  PERFORM pg_temp.must('somebody refused individually stays refused when their role is granted it',
    NOT command_may('crm.export'));

  PERFORM set_config('request.jwt.claim.sub', '', TRUE);
  DELETE FROM user_capability_overrides WHERE user_id = rep AND capability = 'crm.export';

  -- ===========================================================
  -- 3. The refusals.
  -- ===========================================================
  PERFORM set_config('request.jwt.claim.sub', rep::TEXT, TRUE);
  PERFORM pg_temp.must('a salesperson cannot change what a role can do',
    pg_temp.refused(
      format('SELECT set_role_capability(%L, %L, TRUE)', sales, 'crm.export'),
      'needs the Change what a role can do permission'));

  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);

  PERFORM pg_temp.must('and a permission that does not exist is refused by name',
    pg_temp.refused(
      format('SELECT set_role_capability(%L, %L, TRUE)', sales, 'crm.teleport'),
      'no permission called'));

  PERFORM pg_temp.must('taking away your OWN way in is refused, not confirmed',
    pg_temp.refused(
      format('SELECT set_role_capability(%L, %L, FALSE)', mdrole, 'admin.roles'),
      'your own role'));

  /* ---- The last way to administer accounts ----

     Set up so that Managing Director is genuinely the last one: the
     only OTHER template holding `admin.users` is Developer, and nobody
     active is on it, so it is not a way back in.

     Boss is moved off both, onto Sales, and given `admin.roles` as a
     personal override. That is deliberate: it proves the refusal is
     about the company being locked out rather than about the caller
     protecting their own access, which refusal 3 covers separately. */
  PERFORM set_config('request.jwt.claim.sub', '', TRUE);
  UPDATE profiles SET is_active = FALSE WHERE id <> boss AND id <> rep;
  UPDATE profiles SET role_template_id = sales WHERE id = boss;
  INSERT INTO user_capability_overrides (user_id, capability, granted, reason)
  VALUES (boss, 'admin.roles', TRUE, 'Testing the lockout refusal')
  ON CONFLICT (user_id, capability) DO UPDATE SET granted = TRUE;

  /* Somebody active on Managing Director, so it counts as a real
     holder, and nobody on Developer. */
  INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'md@test.local');
  UPDATE profiles SET role_template_id = mdrole, is_active = TRUE
   WHERE email = 'md@test.local';
  UPDATE profiles SET is_active = FALSE WHERE role_template_id = devrole;

  PERFORM set_config('request.jwt.claim.sub', boss::TEXT, TRUE);

  PERFORM pg_temp.must('a role that is NOT the last can lose the permission',
    (set_role_capability(devrole, 'admin.users', FALSE) ->> 'changed')::BOOLEAN);

  PERFORM pg_temp.must('the last role that can administer accounts cannot lose it',
    pg_temp.refused(
      format('SELECT set_role_capability(%L, %L, FALSE)', mdrole, 'admin.users'),
      'nobody able to administer accounts'));

  -- ===========================================================
  -- 4. What was changed is recorded, and cannot be quietly undone.
  -- ===========================================================
  PERFORM pg_temp.must('every change is on the history, with who made it',
    (SELECT count(*) FROM role_capability_history
      WHERE role_template_id = sales AND capability = 'crm.export') >= 3);

  PERFORM pg_temp.must('and the history names the person rather than an id',
    (SELECT actor_label FROM role_capability_history
      WHERE role_template_id = sales ORDER BY at DESC LIMIT 1) IS NOT NULL);

  PERFORM pg_temp.must('setting a switch that is already set records nothing',
    (SELECT count(*) FROM role_capability_history WHERE role_template_id = sales)
    = (SELECT count(*) FROM role_capability_history WHERE role_template_id = sales));

  -- ===========================================================
  -- 5. THE SEED NO LONGER OVERWRITES IT.
  --
  -- The trap this whole migration turns on. Migration 103 deletes every
  -- grant on the eleven and puts the seed back, and the catch-up bundle
  -- is pasted often. Without this, every change made through the Roles
  -- tab would vanish at whatever moment somebody next ran the SQL, with
  -- nothing said and the screen still showing the old answer.
  -- ===========================================================
  PERFORM pg_temp.must('a role a person has changed is marked as taken over',
    (SELECT customised_at IS NOT NULL FROM role_templates WHERE id = sales));

  PERFORM pg_temp.must('and a role nobody has touched is not',
    (SELECT customised_at IS NULL FROM role_templates WHERE id = srsales));
END $$;

/* The seed, run again exactly as the catch-up bundle would run it. */
DELETE FROM role_template_capabilities
 WHERE role_template_id IN (SELECT id FROM role_templates WHERE slug IN (
   'developer', 'managing_director', 'sr_sales', 'sales_rep'
 ) AND customised_at IS NULL);

DO $$
DECLARE sales UUID;
BEGIN
  SELECT id INTO sales FROM role_templates WHERE slug = 'sales_rep';
  PERFORM pg_temp.must('re-running the seed leaves a role somebody has taken over alone',
    EXISTS (SELECT 1 FROM role_template_capabilities
             WHERE role_template_id = sales AND capability = 'crm.export'));
  PERFORM pg_temp.must('and still clears one nobody has',
    NOT EXISTS (SELECT 1 FROM role_template_capabilities
                 WHERE role_template_id = (SELECT id FROM role_templates WHERE slug = 'sr_sales')));
END $$;

DO $$
BEGIN
  RAISE NOTICE 'a role can be changed, it reaches everybody on it at once, an override still wins, and the seed cannot undo it';
END $$;

ROLLBACK;
