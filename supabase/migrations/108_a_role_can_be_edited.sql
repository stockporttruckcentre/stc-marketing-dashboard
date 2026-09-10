-- =============================================================
-- 108. Changing what a role can do.
--
-- From the business, sending the Roles kit:
--
--   Within here, I should be able to also manage what each role type
--   can do, which auto-affects users within that role on their
--   role-inherited permissions.
--
-- The second half of that sentence is already true and is worth saying
-- out loud, because it is the reason this is one write rather than a
-- job that walks every account. `command_may` resolves in three layers:
--
--   1. `user_capability_overrides`, a decision about one person
--   2. `role_templates` through `profiles.role_template_id`
--   3. the legacy `profiles.role` seed, for accounts on no template
--
-- Layer 2 is a JOIN, not a copy. So granting a capability to Sr Sales
-- grants it to everybody on Sr Sales at their next request, and to
-- nobody who has been refused it individually, which is what an
-- override is for and is the behaviour somebody would expect from a
-- screen that says "manage what each role can do".
--
-- ---- What this file adds ----
--
--   set_role_capability     grant, revoke, or change the scope of one
--   role_capability_history what has been changed, and by whom
--
-- One capability at a time on purpose. A screen that saves a whole
-- role at once has to describe what it is about to do in a sentence
-- nobody reads, and gets it wrong silently when two people have the
-- screen open. One toggle is one row and one audit line, and the second
-- person's toggle lands on top of the first rather than reverting it.
--
-- ---- The four refusals ----
--
-- Every one of these is a way somebody could lock the company out of
-- its own administration, and all four are refused in the database
-- rather than by hiding a control.
--
--   1. Only `admin.roles` may do it at all.
--   2. The last role holding `admin.users` cannot have it taken away.
--      Migration 049's comment already says nothing inside this
--      application can put that back.
--   3. You cannot take a capability off your own role if that would
--      stop you administering roles. Losing it by your own hand is
--      indistinguishable from a bug and needs a second person.
--   4. There is no fourth. A first version refused `is_system`, which
--      all eleven carry, so it would have blocked everything while
--      looking careful. What it was really aimed at is the seed in
--      migration 103, and that is handled by `customised_at` instead:
--      the seed stops touching a role the moment a person changes it.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The capability to do it.
--
-- Separate from `admin.users` because they are different jobs.
-- Managing people is putting Dean on Sr Sales. Managing roles is
-- deciding what Sr Sales means, which changes it for everybody on it at
-- once and is the more dangerous of the two.
-- -------------------------------------------------------------
/* The catalogue row for `admin.roles` is in migration 103, beside the
   rest of the eleven roles' catalogue, because the seed there grants
   it and 103 asserts that everything it grants can be explained. */

/* Whoever already administers accounts gets it, which is the two
   templates that hold `admin.users`. Nobody else, and it is not given
   to a role by being senior: Sr Finance administers accounts and can
   now change a role, Business Development runs two departments and
   cannot. */
INSERT INTO role_template_capabilities (role_template_id, capability, scope)
SELECT t.id, 'admin.roles', 'company'
  FROM role_templates t
 WHERE EXISTS (SELECT 1 FROM role_template_capabilities r
                WHERE r.role_template_id = t.id AND r.capability = 'admin.users')
ON CONFLICT (role_template_id, capability) DO NOTHING;

-- -------------------------------------------------------------
-- 2. What was changed, and by whom.
--
-- `audit_log` already records every change and is append only. This is
-- a view over the lines this screen writes, so the Roles tab can show
-- its own history without reading the whole log and without a second
-- copy of the same facts drifting from the first.
-- -------------------------------------------------------------
DROP VIEW IF EXISTS role_capability_history;

CREATE OR REPLACE VIEW role_capability_history AS
SELECT a.id,
       a.at,
       a.actor_label,
       /* ---- Which of the three it was ----

          `audit_log.action` is a closed vocabulary and
          `permission_change` is its word for this. Inventing
          `role.capability.granted` fails the check constraint at the
          moment somebody presses the switch, which is exactly the class
          of "wired but not" this session has been clearing out.

          So the KIND is derived from what changed, which is where the
          fact actually lives. */
       CASE WHEN NOT (a.before ->> 'granted')::BOOLEAN
             AND (a.after ->> 'granted')::BOOLEAN          THEN 'granted'
            WHEN (a.before ->> 'granted')::BOOLEAN
             AND NOT (a.after ->> 'granted')::BOOLEAN      THEN 'revoked'
            ELSE 'rescoped' END                            AS kind,
       a.target_id                                   AS role_template_id,
       a.target_label                                AS role_name,
       a.after ->> 'capability'                      AS capability,
       COALESCE(c.label, a.after ->> 'capability')   AS capability_label,
       a.before ->> 'scope'                          AS scope_before,
       a.after  ->> 'scope'                          AS scope_after
  FROM audit_log a
  LEFT JOIN capability_catalog c ON c.key = a.after ->> 'capability'
 WHERE a.target_type = 'role_template'
   AND a.action = 'permission_change'
 ORDER BY a.at DESC;

GRANT SELECT ON role_capability_history TO authenticated;

COMMENT ON VIEW role_capability_history IS
  'Every grant, revoke and scope change on a role template, newest '
  'first, taken from the append only audit log.';

-- -------------------------------------------------------------
-- 3. The write.
--
-- `p_granted = FALSE` removes the row. There is no such thing as an
-- explicit deny on a template: the table means "this role holds this",
-- and absence means it does not. A deny for ONE PERSON is
-- `user_capability_overrides`, which is a different question with a
-- different answer and its own screen.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_role_capability(
  p_role       UUID,
  p_capability TEXT,
  p_granted    BOOLEAN,
  p_scope      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  role_row   role_templates;
  had        BOOLEAN;
  had_scope  TEXT;
  use_scope  TEXT;
  my_role    UUID;
  holders    INTEGER;
  act        TEXT;
BEGIN
  IF NOT command_may('admin.roles') THEN
    RAISE EXCEPTION 'Changing what a role can do needs the Change what a role can do permission.';
  END IF;

  SELECT * INTO role_row FROM role_templates WHERE id = p_role;
  IF role_row IS NULL THEN
    RAISE EXCEPTION 'There is no role with that id.';
  END IF;

  IF NOT role_row.is_active THEN
    RAISE EXCEPTION 'That role is archived. Bring it back before changing it.';
  END IF;

  /* ---- The refusal that is NOT here, and why ----

     A first version refused any role with `is_system` set, on the
     reasoning that the migrations depend on those. All eleven have it
     set, so that refusal would have blocked the entire feature while
     looking like a safety measure. It is gone.

     The real danger it was aimed at is worth stating, because it was
     real and is now handled somewhere better: migration 103 DELETES
     every grant on the eleven and puts the seed back, so an edit made
     here would have vanished the next time the catch-up bundle was
     pasted, silently, with the screen still showing the old answer
     until somebody reloaded.

     `customised_at` below is the fix. The seed skips a role the moment
     a person has changed it, so the two cannot fight. Refusals 2 and 3
     are what actually stop somebody locking the company out, and they
     are about consequences rather than about which file made the row.
  */

  IF NOT EXISTS (SELECT 1 FROM capability_catalog WHERE key = p_capability AND is_active) THEN
    RAISE EXCEPTION 'There is no permission called %.', p_capability;
  END IF;

  SELECT TRUE, scope INTO had, had_scope
    FROM role_template_capabilities
   WHERE role_template_id = p_role AND capability = p_capability;
  had := COALESCE(had, FALSE);

  /* ---- Refusal 2: somebody has to be able to administer accounts ----

     Counted over ACTIVE templates that somebody actually holds, because
     a capability parked on a role nobody is on is not a way back in. */
  IF NOT p_granted AND p_capability = 'admin.users' THEN
    SELECT count(*) INTO holders
      FROM role_template_capabilities r
      JOIN role_templates t ON t.id = r.role_template_id AND t.is_active
     WHERE r.capability = 'admin.users'
       AND r.role_template_id <> p_role
       AND EXISTS (SELECT 1 FROM profiles p
                    WHERE p.role_template_id = t.id AND p.is_active);
    IF holders = 0 THEN
      RAISE EXCEPTION
        'Taking Manage users off % would leave nobody able to administer accounts, and nothing inside this application could put it back.',
        role_row.name;
    END IF;
  END IF;

  /* ---- Refusal 3: not your own way in ----

     Somebody removing their own ability to edit roles has locked the
     door from the inside, and the only fix is another administrator or
     the SQL editor. Refused rather than confirmed, because a
     confirmation is a thing people click. */
  SELECT role_template_id INTO my_role FROM profiles WHERE id = current_actor();
  IF NOT p_granted
     AND my_role = p_role
     AND p_capability IN ('admin.roles', 'admin.users')
     AND NOT EXISTS (SELECT 1 FROM user_capability_overrides o
                      WHERE o.user_id = current_actor()
                        AND o.capability = p_capability
                        AND o.granted
                        AND (o.expires_at IS NULL OR o.expires_at > NOW()))
  THEN
    RAISE EXCEPTION
      'That is your own role and % is how you got to this screen. Ask another administrator to take it off you.',
      p_capability;
  END IF;

  -- ---- The write itself ----
  IF p_granted THEN
    /* The scope defaults to what it already had, then to the narrowest
       thing that means anything. Not to `company`: a permission that
       silently arrives unlimited is the one nobody notices. */
    use_scope := COALESCE(NULLIF(btrim(COALESCE(p_scope, '')), ''), had_scope, 'own');

    INSERT INTO role_template_capabilities (role_template_id, capability, scope)
    VALUES (p_role, p_capability, use_scope)
    ON CONFLICT (role_template_id, capability)
      DO UPDATE SET scope = EXCLUDED.scope;

    act := CASE WHEN had AND had_scope IS DISTINCT FROM use_scope THEN 'permission_change'
                WHEN had THEN NULL
                ELSE 'permission_change' END;
  ELSE
    DELETE FROM role_template_capabilities
     WHERE role_template_id = p_role AND capability = p_capability;
    act := CASE WHEN had THEN 'permission_change' ELSE NULL END;
  END IF;

  /* Nothing changed, so nothing is recorded. A log with a line in it
     for every time somebody clicked the switch that was already on
     is a log people stop reading. */
  IF act IS NOT NULL THEN
    /* From here the seed in migration 103 leaves this role alone. Set
       on the FIRST real change and never cleared, because a role that
       has been taken over stays taken over: reverting one toggle does
       not hand it back to the migrations. */
    UPDATE role_templates SET customised_at = COALESCE(customised_at, NOW())
     WHERE id = p_role;

    PERFORM audit(
      act, 'role_template', p_role, role_row.name,
      jsonb_build_object('capability', p_capability,
                         'granted', had,
                         'scope', had_scope),
      jsonb_build_object('capability', p_capability,
                         'granted', p_granted,
                         'scope', CASE WHEN p_granted THEN use_scope END),
      'ui', NULL, NULL, NULL,
      (SELECT danger::TEXT FROM capability_catalog WHERE key = p_capability),
      (SELECT danger <> 'routine' FROM capability_catalog WHERE key = p_capability)
    );
  END IF;

  RETURN jsonb_build_object(
    'role', role_row.name,
    'capability', p_capability,
    'granted', p_granted,
    'scope', CASE WHEN p_granted THEN use_scope END,
    'changed', act IS NOT NULL,
    /* True from the first change onwards. The screen says so, because
       "the migrations no longer maintain this role" is a fact somebody
       taking it over should be told once. */
    'takenOver', (SELECT customised_at IS NOT NULL FROM role_templates WHERE id = p_role),
    /* How many people this just applied to, which is the sentence the
       screen says back. Counted rather than estimated. */
    'people', (SELECT count(*) FROM profiles p
                WHERE p.role_template_id = p_role AND p.is_active));
END;
$fn$;

REVOKE ALL ON FUNCTION set_role_capability(UUID, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_role_capability(UUID, TEXT, BOOLEAN, TEXT) TO authenticated;

COMMENT ON FUNCTION set_role_capability(UUID, TEXT, BOOLEAN, TEXT) IS
  'Grant, revoke or rescope one capability on one role template. '
  'Applies to everybody on that role at once, because the resolution '
  'is a join rather than a copy. Refuses a system role, the last way '
  'to administer accounts, and taking your own way in off yourself.';

-- -------------------------------------------------------------
-- 4. Who holds a role, for the Holders card.
--
-- A view rather than a select in the page, because `profiles` is
-- readable to everybody signed in and this is the shape the screen
-- needs: one row per person with the role they are on.
-- -------------------------------------------------------------
DROP VIEW IF EXISTS role_holders;

CREATE OR REPLACE VIEW role_holders AS
SELECT p.id,
       p.role_template_id,
       COALESCE(p.full_name, p.email) AS name,
       p.email,
       p.job_title,
       p.photo_url,
       p.is_active
  FROM profiles p
 WHERE p.role_template_id IS NOT NULL;

GRANT SELECT ON role_holders TO authenticated;

COMMENT ON VIEW role_holders IS
  'Everybody who is on a role template, for the Holders card on the '
  'Roles tab.';

DO $$
BEGIN
  RAISE NOTICE 'a role can be edited: % templates, % of them editable',
    (SELECT count(*) FROM role_templates WHERE is_active),
    (SELECT count(*) FROM role_templates WHERE is_active AND NOT is_system);
END $$;
