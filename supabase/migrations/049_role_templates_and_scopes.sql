-- =============================================================
-- Brought in from the Frame intranet package, renumbered.
--
-- It arrived as 043_role_templates_and_scopes.sql. This repository already had a 043 of its
-- own: the leads architecture took 040 to 045, so everything from the
-- package moves up by six and 047 onwards keeps its relative order.
-- The order is `scripts/sql/order.txt`, which is what builds the
-- disposable server every check runs against, so what gets pasted into
-- a SQL editor and what the checks prove are the same sequence.
-- =============================================================

-- =============================================================
-- 043. Role templates, capabilities, scopes and per-user overrides.
--
-- Scope sections 33 and 34. "The STC model of four broad roles is not
-- enough" is the opening line of 33, and it is right for a reason the
-- from the meeting, makes concrete: this company holds material non-public
-- information, and "everyone in Sales can see all deals" is not an
-- acceptable default at a business that gets audited.
--
-- The model is four layers:
--
--   role template   a named set of capabilities, each with a scope
--   capability      the verb: crm.edit, content.approve, admin.users
--   scope           how far it reaches: own, assigned, team, department,
--                   project, company, specific
--   override        one person, one capability, granted or denied,
--                   with a reason and who granted it
--
-- ---- Why scope is on the grant, not on the role ----
--
-- Scope 34's example is "can view all CRM organizations, can edit
-- Growth-owned relationships". That is two different reaches for two
-- different verbs held by one person. A scope attached to the role
-- cannot say it. A scope attached to each capability can.
--
-- ---- Compatibility, deliberately ----
--
-- `command_may()` is called by eighteen database functions and is the
-- authorization check for the whole command runtime. It reads
-- `command_capability_roles`, seeded from `lib/crm/permissions.ts`.
--
-- Replacing it outright would mean every one of those functions changes
-- behavior in the same commit that introduces an untested permission
-- model. So it is extended rather than replaced, and it answers in a
-- fixed order:
--
--   1. an explicit per-user DENY      always wins
--   2. an explicit per-user GRANT     wins over any role
--   3. the person's role template
--   4. the legacy role seed           still authoritative for anybody
--                                     who has not been given a template
--
-- Step 4 is what keeps today's application working while the templates
-- are populated. It is removed once every account holds a template, and
-- `docs/` should say so when that happens rather than the removal being
-- a surprise.
--
-- ---- What is deliberately not here ----
--
-- from the meeting, 4.6 describes auditors' IT general controls testing:
-- access request flows, quarterly access reviews, segregation of duties
-- between deploying and granting admin. Confirmed as out of scope for
-- now, to be revisited once the application is built. The shape of this
-- table does not prevent any of it: grants are rows with an actor and a
-- timestamp, so an access review is a query rather than an archaeology
-- project, which is scope 33's stated reason for storing permissions as
-- data in the first place.
-- =============================================================

-- -------------------------------------------------------------
-- 1. How far a capability reaches.
--
-- A domain rather than an enum, because adding a value to an enum in
-- PostgreSQL cannot happen inside a transaction that also uses it, and
-- every migration here runs inside one.
-- -------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'capability_scope') THEN
    CREATE DOMAIN capability_scope AS TEXT
      CHECK (VALUE IN ('own', 'assigned', 'team', 'department',
                       'project', 'company', 'specific'));
  END IF;
END $$;

-- Which scope is wider, so a person holding a capability twice gets the
-- more generous answer. `specific` sits at the bottom: it means named
-- records and nothing else, so it never wins a comparison.
CREATE OR REPLACE FUNCTION scope_rank(p_scope TEXT)
RETURNS INTEGER
LANGUAGE SQL
IMMUTABLE
AS $fn$
  SELECT CASE p_scope
    WHEN 'company'    THEN 60
    WHEN 'department' THEN 50
    WHEN 'team'       THEN 40
    WHEN 'project'    THEN 30
    WHEN 'assigned'   THEN 20
    WHEN 'own'        THEN 10
    WHEN 'specific'   THEN 5
    ELSE 0
  END
$fn$;

-- -------------------------------------------------------------
-- 2. Role templates.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role_templates (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z][a-z0-9_]{1,40}$'),
  name        TEXT NOT NULL,
  description TEXT,
  -- A template can belong to one side of the business or to both.
  entity_id   UUID REFERENCES entities ON DELETE SET NULL,
  -- A system template is one the application depends on. It can be
  -- edited but not deleted, so nobody removes the last administrator
  -- template and locks the company out.
  is_system   BOOLEAN NOT NULL DEFAULT FALSE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_template_capabilities (
  role_template_id UUID NOT NULL REFERENCES role_templates ON DELETE CASCADE,
  capability       TEXT NOT NULL,
  scope            capability_scope NOT NULL DEFAULT 'own',
  PRIMARY KEY (role_template_id, capability)
);

CREATE INDEX IF NOT EXISTS idx_rtc_capability ON role_template_capabilities (capability);

-- Which template a person holds. One, plus overrides, which is the shape
-- scope 33 describes: a base role and then additions and removals.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS role_template_id UUID REFERENCES role_templates ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_role_template ON profiles (role_template_id);

-- -------------------------------------------------------------
-- 3. Per-user overrides.
--
-- `granted` false is a real value and is not the same as no row. A deny
-- beats every grant, so removing one capability from somebody who
-- otherwise has the right template is a single row rather than a bespoke
-- template that then drifts from the one it was copied from.
--
-- `reason` is not decoration. from the meeting, 4.6 expects access grants to
-- be reviewable, and a grant nobody can explain is a finding.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_capability_overrides (
  user_id    UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  capability TEXT NOT NULL,
  granted    BOOLEAN NOT NULL,
  scope      capability_scope,
  reason     TEXT,
  granted_by UUID REFERENCES auth.users ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Time-limited access, for cover during leave. Null means indefinite.
  expires_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, capability)
);

CREATE INDEX IF NOT EXISTS idx_overrides_capability ON user_capability_overrides (capability);

-- -------------------------------------------------------------
-- 4. Seeding the templates.
--
-- The four existing roles become templates so nothing changes behavior
-- on the day this lands, plus Compliance, which the four roles could not
-- express.
--
-- from the meeting, section 3: Rafe is the compliance authority and Sean
-- defers to him on compliance calls. Any approval workflow, publishing
-- gate or disclosure review routes to a compliance role, and that role
-- must be able to block rather than only comment. The capability is
-- granted here; the approvals engine that reads it is later work.
-- -------------------------------------------------------------
INSERT INTO role_templates (slug, name, description, is_system, sort_order) VALUES
  ('administrator', 'Administrator',
   'Everything, including roles, settings and the directory.', TRUE, 1),
  ('compliance',    'Compliance',
   'Reviews and blocks anything that leaves the company. Can veto a publication or an outbound campaign, not merely comment on it.',
   TRUE, 2),
  ('member',        'Member',
   'The ordinary working role. Own and assigned records, full editing, no administration.',
   TRUE, 3),
  ('contributor',   'Contributor',
   'Edits records but does not create, delete, share or export in bulk.',
   TRUE, 4),
  ('observer',      'Observer',
   'Reads and exports. Changes nothing.', TRUE, 5)
ON CONFLICT (slug) DO NOTHING;

-- Capabilities per template. Replaced wholesale on every run rather than
-- merged, for the same reason `016_capability_roles_seed.sql` gives: a
-- seed that only ever grows is how a revoked permission survives.
DELETE FROM role_template_capabilities
WHERE role_template_id IN (SELECT id FROM role_templates WHERE is_system);

INSERT INTO role_template_capabilities (role_template_id, capability, scope)
SELECT rt.id, v.capability, v.scope::capability_scope
FROM role_templates rt
JOIN (VALUES
  -- ---- administrator ----
  ('administrator', 'crm.view',             'company'),
  ('administrator', 'crm.viewGlobal',       'company'),
  ('administrator', 'crm.viewOthers',       'company'),
  ('administrator', 'crm.edit',             'company'),
  ('administrator', 'crm.create',           'company'),
  ('administrator', 'crm.delete',           'company'),
  ('administrator', 'crm.assign',           'company'),
  ('administrator', 'crm.manageLists',      'company'),
  ('administrator', 'crm.proposal',         'company'),
  ('administrator', 'crm.proposalForOthers','company'),
  ('administrator', 'crm.delegate',         'company'),
  ('administrator', 'crm.enrich',           'company'),
  ('administrator', 'crm.import',           'company'),
  ('administrator', 'crm.export',           'company'),
  ('administrator', 'admin.users',          'company'),
  ('administrator', 'admin.settings',       'company'),
  ('administrator', 'admin.audit',          'company'),
  ('administrator', 'stock.edit',           'company'),
  ('administrator', 'marketing.edit',       'company'),
  ('administrator', 'marketing.approve',    'company'),

  -- ---- compliance ----
  -- Reads everything, because you cannot review what you cannot see.
  -- Approves, and by extension blocks. Does not edit records and does
  -- not administer accounts: a reviewer who can also change the thing
  -- under review is not a control.
  ('compliance',    'crm.view',             'company'),
  ('compliance',    'crm.viewGlobal',       'company'),
  ('compliance',    'crm.viewOthers',       'company'),
  ('compliance',    'crm.export',           'company'),
  ('compliance',    'marketing.approve',    'company'),
  -- Reviewing without being able to read the trail is not reviewing.
  ('compliance',    'admin.audit',          'company'),

  -- ---- member ----
  ('member',        'crm.view',             'company'),
  ('member',        'crm.viewGlobal',       'company'),
  ('member',        'crm.edit',             'assigned'),
  ('member',        'crm.create',           'own'),
  ('member',        'crm.delete',           'own'),
  ('member',        'crm.assign',           'team'),
  ('member',        'crm.delegate',         'team'),
  ('member',        'crm.manageLists',      'own'),
  ('member',        'crm.proposal',         'own'),
  ('member',        'crm.import',           'own'),
  ('member',        'crm.export',           'assigned'),
  ('member',        'stock.edit',           'company'),

  -- ---- contributor ----
  ('contributor',   'crm.view',             'company'),
  ('contributor',   'crm.viewGlobal',       'company'),
  ('contributor',   'crm.edit',             'assigned'),
  ('contributor',   'crm.export',           'own'),
  ('contributor',   'stock.edit',           'company'),
  ('contributor',   'marketing.edit',       'own'),

  -- ---- observer ----
  ('observer',      'crm.view',             'company'),
  ('observer',      'crm.viewGlobal',       'company'),
  ('observer',      'crm.export',           'own')
) AS v(template, capability, scope) ON v.template = rt.slug;

-- -------------------------------------------------------------
-- 5. Asking the question.
--
-- `command_may` keeps its name and its signature, because eighteen
-- functions call it. What changes is what it consults, in the order the
-- header describes.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION command_may(p_capability TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $fn$
DECLARE
  override BOOLEAN;
  template UUID;
BEGIN
  -- 1 and 2. An explicit decision about this person beats everything.
  SELECT granted INTO override
  FROM user_capability_overrides
  WHERE user_id = current_actor()
    AND capability = p_capability
    AND (expires_at IS NULL OR expires_at > NOW());

  IF override IS NOT NULL THEN
    RETURN override;
  END IF;

  -- 3. Their template.
  SELECT role_template_id INTO template FROM profiles WHERE id = current_actor();

  IF template IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM role_template_capabilities
      WHERE role_template_id = template AND capability = p_capability
    );
  END IF;

  -- 4. Nobody has given this account a template yet, so the legacy role
  --    seed still answers. Removed once every account holds one.
  RETURN EXISTS (
    SELECT 1 FROM command_capability_roles r
    WHERE r.capability = p_capability
      AND r.role = current_role_safe()
  );
END;
$fn$;

REVOKE ALL ON FUNCTION command_may(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION command_may(TEXT) TO authenticated;

-- How far does this person's grant reach. Null means they do not hold
-- the capability at all, which is a different answer from 'own' and
-- callers must not conflate them.
CREATE OR REPLACE FUNCTION actor_scope(p_capability TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $fn$
DECLARE
  o_granted BOOLEAN;
  o_scope   TEXT;
  t_scope   TEXT;
  template  UUID;
BEGIN
  SELECT granted, scope INTO o_granted, o_scope
  FROM user_capability_overrides
  WHERE user_id = current_actor()
    AND capability = p_capability
    AND (expires_at IS NULL OR expires_at > NOW());

  IF o_granted IS FALSE THEN
    RETURN NULL;
  END IF;

  SELECT role_template_id INTO template FROM profiles WHERE id = current_actor();
  SELECT scope INTO t_scope
  FROM role_template_capabilities
  WHERE role_template_id = template AND capability = p_capability;

  -- An override granting a capability with no scope of its own inherits
  -- the template's, and falls back to the narrowest rather than the
  -- widest. Guessing generously here would hand somebody company-wide
  -- reach because a form left a field blank.
  IF o_granted IS TRUE THEN
    RETURN COALESCE(o_scope, t_scope, 'own');
  END IF;

  IF t_scope IS NOT NULL THEN
    RETURN t_scope;
  END IF;

  -- Legacy path. The old four roles had no notion of scope, and the one
  -- they behaved as was company-wide, so saying anything narrower here
  -- would silently take access away from accounts that work today.
  IF EXISTS (
    SELECT 1 FROM command_capability_roles r
    WHERE r.capability = p_capability AND r.role = current_role_safe()
  ) THEN
    RETURN 'company';
  END IF;

  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION actor_scope(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION actor_scope(TEXT) TO authenticated;

-- -------------------------------------------------------------
-- 6. Reading and writing the model.
--
-- Templates and their capabilities are readable by everybody signed in,
-- because the command bar filters what it offers on capability and has
-- to know what the caller holds. Overrides are not: who was given an
-- exception, and why, is between them and an administrator.
-- -------------------------------------------------------------
ALTER TABLE role_templates             ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_template_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_capability_overrides  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "role_templates_read"  ON role_templates;
DROP POLICY IF EXISTS "role_caps_read"       ON role_template_capabilities;
DROP POLICY IF EXISTS "overrides_read"       ON user_capability_overrides;

CREATE POLICY "role_templates_read" ON role_templates
  FOR SELECT USING (current_actor() IS NOT NULL);
CREATE POLICY "role_caps_read" ON role_template_capabilities
  FOR SELECT USING (current_actor() IS NOT NULL);

-- Your own exceptions, or an administrator's view of everybody's.
CREATE POLICY "overrides_read" ON user_capability_overrides
  FOR SELECT USING (
    user_id = current_actor() OR command_may('admin.users')
  );

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['role_templates', 'role_template_capabilities',
                           'user_capability_overrides'] LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I FROM PUBLIC', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I FROM authenticated', t);
  END LOOP;
END $$;
