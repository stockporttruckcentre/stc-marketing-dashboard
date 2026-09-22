-- =============================================================
-- 143. Who may open whose portfolio is grantable in the app.
--
-- From the business:
--
--   if I leave this company in a month, that is one permission that
--   can't be granted to specific people and therefore the app fails on
--   being self-sustainable. I won't always be here.
--
-- ---- What this reverses, and why ----
--
-- Migration 117 wrote the rule down and then wrote this, on purpose:
--
--   Writable by nobody through PostgREST: changing who can see whose
--   revenue is a migration or an administrator with direct access, not
--   an API call.
--
-- That was a reasonable instinct about a sensitive permission and it
-- is the wrong trade for this company. It means the only way to let
-- somebody new see a colleague's numbers is a developer writing SQL,
-- and in a month there is no developer. A permission that cannot be
-- granted without me is a permission this company loses when I go.
--
-- It is also invisible: the Roles tab lists capabilities, portfolio
-- visibility is a role-to-role table, so the tab was silently
-- incomplete on exactly the sensitive thing somebody would go looking
-- for. The business found that by looking for it and not finding it.
--
-- ---- What replaces it ----
--
-- Two levels, and the more specific one wins:
--
--   THE LADDER, by role, which is what 117 seeded and is still the
--   sensible default: a senior sees the reps, the MD sees everybody.
--   Now editable through a function instead of only by migration.
--
--   A GRANT, by person, which is the thing that was missing. "Alex may
--   open Tom's portfolio" regardless of either role. It can also be a
--   REFUSAL: "Alex may not open Tom's", overriding the ladder, because
--   an exception in one direction without the other is half a control.
--
-- Nobody can grant themselves anything: both functions need
-- `admin.users`, the right that already means "you manage people", and
-- every change writes an audit line naming who did it and to whom.
-- =============================================================

-- -------------------------------------------------------------
-- 1. The exception, by person.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS personal_analytics_grants (
  viewer_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  granted    BOOLEAN NOT NULL,
  reason     TEXT,
  granted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (viewer_id, subject_id),
  CONSTRAINT nobody_grants_themselves CHECK (viewer_id <> subject_id)
);

COMMENT ON TABLE personal_analytics_grants IS
  'One person may, or may not, open one other person''s Personal Analytics, '
  'whatever their roles say. The exception to personal_analytics_authority, and '
  'the more specific of the two, so it wins.';

ALTER TABLE personal_analytics_grants ENABLE ROW LEVEL SECURITY;

/* Readable by whoever manages people, and by the person it is about,
   so somebody can see what they have been given without asking. */
DROP POLICY IF EXISTS "portfolio_grants_read" ON personal_analytics_grants;
CREATE POLICY "portfolio_grants_read" ON personal_analytics_grants
  FOR SELECT USING (
    viewer_id = auth.uid() OR subject_id = auth.uid() OR command_may('admin.users')
  );

/* Written only through the function below, which is what carries the
   permission check and the audit line. */
GRANT SELECT ON personal_analytics_grants TO authenticated;

-- -------------------------------------------------------------
-- 2. THE RULE, with the exception in it.
--
-- Order matters and is the whole point: yourself, then the person by
-- person answer if there is one, then the ladder. A refusal written
-- against a pair beats a ladder that would have allowed it.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION personal_analytics_may_view(p_person UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT p_person IS NOT NULL
     AND personal_analytics_eligible()
     AND CASE
       /* Yourself. Identity, not a role pairing. */
       WHEN p_person = current_actor()
         THEN personal_analytics_slug(p_person) IS NOT NULL

       /* Said about these two people by name, either way. */
       WHEN EXISTS (
         SELECT 1 FROM personal_analytics_grants g
          WHERE g.viewer_id = current_actor() AND g.subject_id = p_person
       ) THEN (
         SELECT g.granted FROM personal_analytics_grants g
          WHERE g.viewer_id = current_actor() AND g.subject_id = p_person
       )

       /* Otherwise the ladder, as before. */
       ELSE EXISTS (
         SELECT 1
           FROM personal_analytics_authority a
          WHERE a.viewer_slug   = personal_analytics_slug(current_actor())
            AND a.may_view_slug = personal_analytics_slug(p_person)
       )
     END;
$fn$;

COMMENT ON FUNCTION personal_analytics_may_view(UUID) IS
  'The one rule for Personal Analytics visibility: yourself, then anything said '
  'about the two of you by name, then the role ladder. Every function that '
  'returns a personal figure calls this before returning a row.';

REVOKE ALL ON FUNCTION personal_analytics_may_view(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION personal_analytics_may_view(UUID) TO authenticated;

-- -------------------------------------------------------------
-- 3. Granting and refusing, by person.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS set_portfolio_grant(UUID, UUID, BOOLEAN, TEXT);
CREATE OR REPLACE FUNCTION set_portfolio_grant(
  p_viewer  UUID,
  p_subject UUID,
  p_granted BOOLEAN,
  p_reason  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  viewer_name  TEXT;
  subject_name TEXT;
  had          BOOLEAN;
BEGIN
  IF NOT command_may('admin.users') THEN
    RAISE EXCEPTION 'Saying whose figures somebody may open needs permission to manage people.';
  END IF;
  IF p_viewer IS NULL OR p_subject IS NULL THEN
    RAISE EXCEPTION 'Both people are needed.';
  END IF;
  IF p_viewer = p_subject THEN
    RAISE EXCEPTION 'Everybody can already see their own figures.';
  END IF;

  SELECT COALESCE(full_name, email) INTO viewer_name  FROM profiles WHERE id = p_viewer;
  SELECT COALESCE(full_name, email) INTO subject_name FROM profiles WHERE id = p_subject;
  IF viewer_name IS NULL THEN RAISE EXCEPTION 'There is nobody with that id to give it to.'; END IF;
  IF subject_name IS NULL THEN RAISE EXCEPTION 'There is nobody with that id to give it over.'; END IF;

  SELECT granted INTO had FROM personal_analytics_grants
   WHERE viewer_id = p_viewer AND subject_id = p_subject;

  INSERT INTO personal_analytics_grants
    (viewer_id, subject_id, granted, reason, granted_by, granted_at)
  VALUES (p_viewer, p_subject, p_granted, p_reason, current_actor(), NOW())
  ON CONFLICT (viewer_id, subject_id) DO UPDATE
    SET granted = EXCLUDED.granted, reason = EXCLUDED.reason,
        granted_by = EXCLUDED.granted_by, granted_at = NOW();

  /* `permission_change` because audit_log's action is a fixed
     vocabulary and this is one. What KIND of permission changed goes
     in the payload, where it can be read without widening a constraint
     every screen depends on. */
  PERFORM audit(
    'permission_change', 'profile', p_viewer, viewer_name,
    CASE WHEN had IS NULL THEN NULL
         ELSE jsonb_build_object('what', 'portfolio_visibility', 'granted', had) END,
    jsonb_build_object('what', 'portfolio_visibility',
                       'granted', p_granted, 'subject', subject_name),
    'ui', p_reason);

  RETURN jsonb_build_object(
    'ok', TRUE, 'viewer', viewer_name, 'subject', subject_name, 'granted', p_granted);
END;
$fn$;

-- -------------------------------------------------------------
-- 4. Taking the exception away, so the ladder decides again.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS clear_portfolio_grant(UUID, UUID);
CREATE OR REPLACE FUNCTION clear_portfolio_grant(p_viewer UUID, p_subject UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE viewer_name TEXT; subject_name TEXT; had BOOLEAN;
BEGIN
  IF NOT command_may('admin.users') THEN
    RAISE EXCEPTION 'Saying whose figures somebody may open needs permission to manage people.';
  END IF;

  SELECT granted INTO had FROM personal_analytics_grants
   WHERE viewer_id = p_viewer AND subject_id = p_subject;
  IF had IS NULL THEN
    RETURN jsonb_build_object('ok', TRUE, 'changed', FALSE);
  END IF;

  SELECT COALESCE(full_name, email) INTO viewer_name  FROM profiles WHERE id = p_viewer;
  SELECT COALESCE(full_name, email) INTO subject_name FROM profiles WHERE id = p_subject;

  DELETE FROM personal_analytics_grants
   WHERE viewer_id = p_viewer AND subject_id = p_subject;

  PERFORM audit('permission_change', 'profile', p_viewer, viewer_name,
    jsonb_build_object('what', 'portfolio_visibility',
                       'granted', had, 'subject', subject_name),
    jsonb_build_object('what', 'portfolio_visibility', 'granted', NULL), 'ui');

  RETURN jsonb_build_object('ok', TRUE, 'changed', TRUE,
    'viewer', viewer_name, 'subject', subject_name);
END;
$fn$;

-- -------------------------------------------------------------
-- 5. And the ladder itself, editable rather than only seeded.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS set_portfolio_ladder(TEXT, TEXT, BOOLEAN);
CREATE OR REPLACE FUNCTION set_portfolio_ladder(
  p_viewer_slug TEXT, p_may_view_slug TEXT, p_allowed BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('admin.users') THEN
    RAISE EXCEPTION 'Changing which roles may open whose figures needs permission to manage people.';
  END IF;
  IF p_viewer_slug = p_may_view_slug THEN
    /* 117 explains this at length and it still holds: seeding a role
       as able to view itself reads as "they see their own" and means
       every rep can open every other rep. */
    RAISE EXCEPTION 'A role cannot be given sight of itself. Everybody already sees their own, and this would open every colleague on that role to each other.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM role_templates WHERE slug = p_viewer_slug) THEN
    RAISE EXCEPTION 'There is no role called %.', p_viewer_slug;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM role_templates WHERE slug = p_may_view_slug) THEN
    RAISE EXCEPTION 'There is no role called %.', p_may_view_slug;
  END IF;

  IF p_allowed THEN
    INSERT INTO personal_analytics_authority (viewer_slug, may_view_slug)
    VALUES (p_viewer_slug, p_may_view_slug) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM personal_analytics_authority
     WHERE viewer_slug = p_viewer_slug AND may_view_slug = p_may_view_slug;
  END IF;

  PERFORM audit('role_change', 'role', NULL, p_viewer_slug, NULL,
    jsonb_build_object('what', 'portfolio_ladder',
                       'viewer', p_viewer_slug, 'may_view', p_may_view_slug,
                       'allowed', p_allowed), 'ui');

  RETURN jsonb_build_object('ok', TRUE);
END;
$fn$;

REVOKE ALL ON FUNCTION set_portfolio_grant(UUID, UUID, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION clear_portfolio_grant(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION set_portfolio_ladder(TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_portfolio_grant(UUID, UUID, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION clear_portfolio_grant(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION set_portfolio_ladder(TEXT, TEXT, BOOLEAN) TO authenticated;

-- -------------------------------------------------------------
-- 6. What one person's portfolio access looks like, for the screen.
--
-- Everybody, with why: their own, a grant, a refusal, or the ladder.
-- The screen never works this out itself, because a second copy of the
-- rule is a second rule.
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS portfolio_access_for(UUID);
CREATE OR REPLACE FUNCTION portfolio_access_for(p_viewer UUID)
RETURNS TABLE (
  subject_id   UUID,
  full_name    TEXT,
  role_slug    TEXT,
  role_name    TEXT,
  may_view     BOOLEAN,
  because      TEXT,
  is_exception BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT command_may('admin.users') AND p_viewer <> current_actor() THEN
    RAISE EXCEPTION 'Reading somebody else''s portfolio access needs permission to manage people.';
  END IF;

  RETURN QUERY
  SELECT p.id,
         COALESCE(p.full_name, p.email),
         t.slug,
         t.name,
         CASE
           WHEN p.id = p_viewer THEN TRUE
           WHEN g.granted IS NOT NULL THEN g.granted
           ELSE EXISTS (SELECT 1 FROM personal_analytics_authority a
                         WHERE a.viewer_slug = (SELECT t2.slug FROM profiles p2
                                                  JOIN role_templates t2 ON t2.id = p2.role_template_id
                                                 WHERE p2.id = p_viewer)
                           AND a.may_view_slug = t.slug)
         END,
         CASE
           WHEN p.id = p_viewer THEN 'Their own'
           WHEN g.granted IS TRUE THEN 'Given to them by name'
           WHEN g.granted IS FALSE THEN 'Taken away by name'
           ELSE 'Their role'
         END,
         (g.granted IS NOT NULL)
    FROM profiles p
    JOIN role_templates t ON t.id = p.role_template_id
    LEFT JOIN personal_analytics_grants g
      ON g.viewer_id = p_viewer AND g.subject_id = p.id
   WHERE p.is_active
     AND EXISTS (SELECT 1 FROM personal_analytics_roles r WHERE r.slug = t.slug)
   ORDER BY COALESCE(p.full_name, p.email);
END;
$fn$;

REVOKE ALL ON FUNCTION portfolio_access_for(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portfolio_access_for(UUID) TO authenticated;

DO $$ BEGIN
  RAISE NOTICE 'portfolio visibility can now be granted person by person, in the app';
END $$;
