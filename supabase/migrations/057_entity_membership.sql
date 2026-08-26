-- =============================================================
-- Brought in from the Frame intranet package, renumbered.
--
-- It arrived as 052_entity_membership.sql. This repository already had a 052 of its
-- own: the leads architecture took 040 to 045, so everything from the
-- package moves up by six and 047 onwards keeps its relative order.
-- The order is `scripts/sql/order.txt`, which is what builds the
-- disposable server every check runs against, so what gets pasted into
-- a SQL editor and what the checks prove are the same sequence.
-- =============================================================

-- =============================================================
-- Which company somebody works for, when the answer can be both.
--
-- Migration 042 gave every person one `entity_id` and every record an
-- `owning_entity_id`. One is not enough. Legal, finance and the founders
-- work for TCC and for Frame, and the two companies are going to run
-- this installation together: TCC staff task Frame staff and Frame staff
-- task TCC staff, and neither can do that if belonging to one company
-- hides the other.
--
-- So membership becomes a set, and `profiles.entity_id` stays as the
-- primary: the one a new record is stamped with when nobody says
-- otherwise. Nothing reading `entity_id` breaks, and `actor_entity()`
-- keeps returning what it always returned.
--
-- ---- What membership decides, and what it does not ----
--
-- It decides what somebody SEES BY DEFAULT, and what they can be shown
-- at all for sensitive records. It does not decide who can be given
-- work. A task owned by TCC and assigned to a Frame engineer is a
-- normal thing, and the engineer can see it because they are on it, not
-- because of who employs them.
--
-- The design system puts it the same way: cyan marks Frame RECORDS, and
-- "TCC-only records must be invisible to Frame-only staff, so this is a
-- permission boundary before it is a label".
-- =============================================================

-- -------------------------------------------------------------
-- 1. Membership
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profile_entities (
  user_id    UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  entity_id  UUID NOT NULL REFERENCES entities   ON DELETE CASCADE,
  -- The one new records default to. Exactly one per person, below.
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  added_by   UUID REFERENCES auth.users ON DELETE SET NULL,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, entity_id)
);

-- One primary each. Without this, "which company does a new task belong
-- to" has two answers and the row gets whichever the planner returned.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_primary_entity
  ON profile_entities (user_id) WHERE is_primary;

CREATE INDEX IF NOT EXISTS idx_profile_entities_entity ON profile_entities (entity_id);

-- Everybody who already had an entity keeps it, as their primary. This
-- is the whole backfill: one company each, which is what the single
-- column could express, and anybody who works for both is added by an
-- admin or by themselves in Settings.
INSERT INTO profile_entities (user_id, entity_id, is_primary)
SELECT p.id, p.entity_id, TRUE
  FROM profiles p
 WHERE p.entity_id IS NOT NULL
ON CONFLICT (user_id, entity_id) DO NOTHING;

-- -------------------------------------------------------------
-- 2. Asking the question
-- -------------------------------------------------------------

-- Every company somebody belongs to. Falls back to the single column so
-- a profile that predates this migration and never got a row still
-- answers correctly.
CREATE OR REPLACE FUNCTION actor_entities()
RETURNS UUID[]
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(
    NULLIF(ARRAY(SELECT entity_id FROM profile_entities WHERE user_id = current_actor()), '{}'),
    ARRAY(SELECT entity_id FROM profiles WHERE id = current_actor() AND entity_id IS NOT NULL)
  )
$fn$;

-- Does this person work for more than one company. The Work screen and
-- the CRM use it to decide whether to draw a switcher at all: somebody
-- who only works for Frame should never see a control offering to show
-- them TCC.
CREATE OR REPLACE FUNCTION actor_is_multi_entity()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(array_length(actor_entities(), 1), 0) > 1
$fn$;

-- Whether a record belonging to this company is one they may see.
--
-- NULL means unattributed, which is readable by anybody: refusing it
-- would hide every row written before entities existed.
CREATE OR REPLACE FUNCTION actor_in_entity(p_entity UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT p_entity IS NULL
      OR p_entity = ANY (actor_entities())
      /* Somebody who can see across the whole group. An auditor, a
         board member, the people who have to reconcile the two. */
      OR command_may('entity.viewAll')
$fn$;

REVOKE ALL ON FUNCTION actor_entities()          FROM PUBLIC;
REVOKE ALL ON FUNCTION actor_is_multi_entity()   FROM PUBLIC;
REVOKE ALL ON FUNCTION actor_in_entity(UUID)     FROM PUBLIC;
GRANT EXECUTE ON FUNCTION actor_entities()        TO authenticated;
GRANT EXECUTE ON FUNCTION actor_is_multi_entity() TO authenticated;
GRANT EXECUTE ON FUNCTION actor_in_entity(UUID)   TO authenticated;

-- -------------------------------------------------------------
-- 3. Capabilities
-- -------------------------------------------------------------
INSERT INTO capability_catalog (key, label, description, area, feature, danger, requires, scoped, position) VALUES
('entity.viewAll',      'See both companies',        'See records belonging to every company in the group, whichever they work for. Auditors, the board, and whoever reconciles the two.', 'Compliance', 'Company split', 'sensitive', '{}', FALSE, 20),
('entity.setOwn',       'Choose their own company',  'Set which of the companies they work for in their own settings. Somebody who genuinely works for both should not need a ticket.', 'Compliance', 'Company split', 'routine', '{}', FALSE, 30),
('entity.setOthers',    'Set somebody else''s company', 'Decide which companies a colleague belongs to. This is the control that decides what a new starter can see.', 'Compliance', 'Company split', 'sensitive', '{}', FALSE, 40)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, description = EXCLUDED.description,
      area = EXCLUDED.area, feature = EXCLUDED.feature, danger = EXCLUDED.danger,
      requires = EXCLUDED.requires, scoped = EXCLUDED.scoped, position = EXCLUDED.position;

-- The role grants for these three live in the generated
-- `016_capability_roles_seed.sql`, which replaces
-- `command_capability_roles` wholesale. Seeding them again here would
-- run after that replacement and undo a revocation.

-- -------------------------------------------------------------
-- 4. Policies
-- -------------------------------------------------------------
ALTER TABLE profile_entities ENABLE ROW LEVEL SECURITY;

-- Who works for which company is not a secret inside the company. It
-- has to be readable, or an assignee picker cannot show which side
-- somebody is on, which is exactly the thing a person needs to know
-- before tasking them.
DROP POLICY IF EXISTS profile_entities_read ON profile_entities;
CREATE POLICY profile_entities_read ON profile_entities
  FOR SELECT USING (current_actor() IS NOT NULL);

DROP POLICY IF EXISTS profile_entities_write ON profile_entities;
CREATE POLICY profile_entities_write ON profile_entities FOR ALL
  USING (
    (user_id = current_actor() AND command_may('entity.setOwn'))
    OR command_may('entity.setOthers')
  )
  WITH CHECK (
    (user_id = current_actor() AND command_may('entity.setOwn'))
    OR command_may('entity.setOthers')
  );

REVOKE ALL ON profile_entities FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON profile_entities TO authenticated;

-- -------------------------------------------------------------
-- 5. Setting it, as one call
--
-- A person choosing "both" is three writes: add the missing row, keep
-- the existing one, move the primary. Doing that from the client means
-- a moment where somebody belongs to nothing, and a unique index that
-- fires halfway through. One function, one transaction.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_actor_entities(
  p_user       UUID,
  p_entities   UUID[],
  p_primary    UUID
)
RETURNS TABLE (entity_id UUID, is_primary BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF current_actor() IS NULL THEN
    RAISE EXCEPTION 'not signed in';
  END IF;

  IF p_user <> current_actor() AND NOT command_may('entity.setOthers') THEN
    RAISE EXCEPTION 'you cannot set which company somebody else works for';
  END IF;
  IF p_user = current_actor() AND NOT command_may('entity.setOwn')
     AND NOT command_may('entity.setOthers') THEN
    RAISE EXCEPTION 'you cannot change your own company';
  END IF;

  IF p_entities IS NULL OR array_length(p_entities, 1) IS NULL THEN
    RAISE EXCEPTION 'somebody has to work for at least one company';
  END IF;
  IF NOT (p_primary = ANY (p_entities)) THEN
    RAISE EXCEPTION 'the primary company has to be one of the companies they work for';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_entities) e
              WHERE NOT EXISTS (SELECT 1 FROM entities x WHERE x.id = e AND x.is_active)) THEN
    RAISE EXCEPTION 'one of those is not a company this installation has';
  END IF;

  DELETE FROM profile_entities pe
   WHERE pe.user_id = p_user AND NOT (pe.entity_id = ANY (p_entities));

  -- Primary is cleared first. Setting the new one while the old one
  -- still holds the flag trips the single-primary index.
  UPDATE profile_entities pe SET is_primary = FALSE
   WHERE pe.user_id = p_user AND pe.is_primary;

  INSERT INTO profile_entities (user_id, entity_id, is_primary, added_by)
  SELECT p_user, e, FALSE, current_actor() FROM unnest(p_entities) e
  ON CONFLICT (user_id, entity_id) DO NOTHING;

  UPDATE profile_entities pe SET is_primary = TRUE
   WHERE pe.user_id = p_user AND pe.entity_id = p_primary;

  -- The old single column stays true, so everything still reading it
  -- keeps working and a rollback of this migration loses nothing.
  UPDATE profiles SET entity_id = p_primary WHERE id = p_user;

  PERFORM audit('update', 'profiles', p_user, NULL, NULL,
                jsonb_build_object('entities', p_entities, 'primary', p_primary));

  RETURN QUERY
    SELECT pe.entity_id, pe.is_primary FROM profile_entities pe
     WHERE pe.user_id = p_user
     ORDER BY pe.is_primary DESC;
END;
$fn$;

REVOKE ALL ON FUNCTION set_actor_entities(UUID, UUID[], UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_actor_entities(UUID, UUID[], UUID) TO authenticated;

-- -------------------------------------------------------------
-- 6. The company split, applied to work
--
-- Replacing the function migration 056 defined, now that membership
-- exists. Same signature, so every policy that calls it is unchanged.
--
-- The ordering is the whole design, and the case that drives it is the
-- one the split exists for: a TCC director tasks a Frame engineer.
--
--   The task is owned by TCC, because the director raised it.
--   The engineer works for Frame only.
--   The engineer has to be able to see the task they were given.
--
-- So being named on a piece of work beats the company filter, and the
-- company filter only decides what somebody sees when they are NOT
-- involved. That is what makes cross-company delegation work without
-- opening TCC's confidential work to everybody at Frame.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION can_reach_task(
  p_task            UUID,
  p_assignee        UUID,
  p_assignee_dept   UUID,
  p_created_by      UUID,
  p_delegated_by    UUID,
  p_reviewer        UUID,
  p_approver        UUID,
  p_classification  TEXT,
  p_is_sensitive         BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN current_actor() IS NULL THEN FALSE

    /* commercially sensitive first, before anything at all. from the meeting, 4.1. */
    WHEN p_is_sensitive AND NOT command_may('compliance.sensitive') THEN FALSE

    /* Secret work: only the people doing it, whatever else they hold. */
    WHEN classification_rank(p_classification) >= classification_rank('secret')
     AND current_actor() NOT IN (p_assignee, p_created_by, p_delegated_by, p_reviewer, p_approver)
     THEN FALSE

    /* Involvement beats the company filter. This is the line that lets
       TCC task Frame and Frame task TCC. */
    WHEN current_actor() IN (p_assignee, p_created_by, p_delegated_by, p_reviewer, p_approver) THEN TRUE
    WHEN EXISTS (
      SELECT 1 FROM task_participants tp
       WHERE tp.task_id = p_task AND tp.user_id = current_actor()
    ) THEN TRUE

    /* Not involved. Now the company matters: confidential work stays
       inside the company that owns it, which is what "TCC-only records
       must be invisible to Frame-only staff" asks for. */
    WHEN classification_rank(p_classification) >= classification_rank('confidential')
     AND NOT actor_in_entity((SELECT t.owning_entity_id FROM tasks t WHERE t.id = p_task))
     THEN FALSE

    WHEN p_assignee_dept IS NOT NULL
     AND command_may('work.viewDepartment')
     AND p_assignee_dept = actor_department() THEN TRUE

    WHEN command_may('work.viewAll') THEN TRUE
    ELSE FALSE
  END
$fn$;

REVOKE ALL ON FUNCTION can_reach_task(UUID,UUID,UUID,UUID,UUID,UUID,UUID,TEXT,BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION can_reach_task(UUID,UUID,UUID,UUID,UUID,UUID,UUID,TEXT,BOOLEAN) TO authenticated;

-- -------------------------------------------------------------
-- 7. What a new record belongs to
--
-- Stamped from the person's primary company rather than left to the
-- screen to send, because a screen that forgets produces an
-- unattributed record and nobody notices until an audit asks.
--
-- An explicit value always wins: somebody at TCC raising work that
-- belongs to Frame says so, and this does not argue.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION stamp_owning_entity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF NEW.owning_entity_id IS NULL THEN
    NEW.owning_entity_id := COALESCE(
      (SELECT pe.entity_id FROM profile_entities pe
        WHERE pe.user_id = current_actor() AND pe.is_primary),
      actor_entity(),
      (SELECT id FROM entities WHERE is_default)
    );
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_tasks_entity ON tasks;
CREATE TRIGGER trg_tasks_entity BEFORE INSERT ON tasks
  FOR EACH ROW EXECUTE FUNCTION stamp_owning_entity();

DROP TRIGGER IF EXISTS trg_projects_entity ON projects;
CREATE TRIGGER trg_projects_entity BEFORE INSERT ON projects
  FOR EACH ROW EXECUTE FUNCTION stamp_owning_entity();

DROP TRIGGER IF EXISTS trg_task_comments_entity ON task_comments;
CREATE TRIGGER trg_task_comments_entity BEFORE INSERT ON task_comments
  FOR EACH ROW EXECUTE FUNCTION stamp_owning_entity();

-- -------------------------------------------------------------
-- 8. Who somebody can be given work
--
-- The picker reads this rather than `profiles` directly, so it can show
-- which company each person is on and mark the ones who are not on
-- yours. Cross-company assignment is normal and this makes it visible
-- rather than silent.
-- -------------------------------------------------------------
CREATE OR REPLACE VIEW assignable_people AS
SELECT
  p.id,
  p.full_name,
  p.email,
  p.role,
  p.department_id,
  d.name                     AS department_name,
  pe.entity_id               AS primary_entity_id,
  e.code                     AS primary_entity_code,
  e.name                     AS primary_entity_name,
  ARRAY(SELECT x.entity_id FROM profile_entities x WHERE x.user_id = p.id) AS entity_ids,
  -- Whether they are on a different company from the person looking.
  NOT (COALESCE(pe.entity_id, p.entity_id) = ANY (actor_entities())) AS is_cross_entity
FROM profiles p
LEFT JOIN profile_entities pe ON pe.user_id = p.id AND pe.is_primary
LEFT JOIN entities   e ON e.id = COALESCE(pe.entity_id, p.entity_id)
LEFT JOIN departments d ON d.id = p.department_id;

GRANT SELECT ON assignable_people TO authenticated;

COMMENT ON VIEW assignable_people IS
  'Everybody who can be given work, with the company they are on. '
  '`is_cross_entity` is what the picker uses to mark somebody at the '
  'other company, which is allowed and should be obvious.';
