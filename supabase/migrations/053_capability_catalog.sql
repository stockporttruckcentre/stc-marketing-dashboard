-- =============================================================
-- Brought in from the Frame intranet package, renumbered.
--
-- It arrived as 048_capability_catalog.sql. This repository already had a 048 of its
-- own: the leads architecture took 040 to 045, so everything from the
-- package moves up by six and 047 onwards keeps its relative order.
-- The order is `scripts/sql/order.txt`, which is what builds the
-- disposable server every check runs against, so what gets pasted into
-- a SQL editor and what the checks prove are the same sequence.
-- =============================================================

-- =============================================================
-- 048. The capability catalog.
--
-- Migration 043 gave the machinery: role templates carrying
-- capabilities, and `user_capability_overrides` so one person can be
-- granted or refused a single capability without their role changing.
-- That is the Slack shape the user asked for: two people on Marketer,
-- one of them allowed to publish, without inventing a third role.
--
-- What 043 did NOT give is a list of what capabilities exist. They are
-- free text strings, implied by whoever happens to check one. An admin
-- screen cannot render a list it has to guess.
--
-- So this is the register. Every capability in the product, with the
-- words a person needs to decide whether to grant it, grouped the way
-- the admin screen will group them.
--
-- ---- Why the catalog is data and not a TypeScript constant ----
--
-- The admin screen is the last thing built, and it has to show every
-- capability including ones added after it ships. A constant in the
-- app means the screen only knows what was compiled with it. A table
-- means a feature added next year appears in the screen the moment its
-- migration runs.
--
-- `lib/platform/permissions/catalog.ts` mirrors it for the compiler,
-- and `check:capabilities` asserts the two cannot drift.
--
-- ---- The danger column ----
--
-- Not every capability is equal. Reading the CRM and deleting a
-- published post are both "capabilities", and an admin screen that
-- lists them identically invites somebody to tick the wrong box on a
-- Friday afternoon. Three levels, so the screen can say so.
-- =============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'capability_danger') THEN
    CREATE TYPE capability_danger AS ENUM ('routine', 'sensitive', 'destructive');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS capability_catalog (
  -- The string checked by command_may() and by requireCapability().
  key         TEXT PRIMARY KEY,

  -- What a person reading the admin screen sees.
  label       TEXT NOT NULL,
  -- Plain words. Not "grants social.publishNow" but what actually
  -- happens if you tick it.
  description TEXT NOT NULL,

  -- How the admin screen groups them. Area is the section, feature is
  -- the panel inside it.
  area        TEXT NOT NULL,
  feature     TEXT NOT NULL,

  danger      capability_danger NOT NULL DEFAULT 'routine',

  -- What this is worth on its own. Granting social.publishNow without
  -- social.view is meaningless, so the screen can offer the pair.
  requires    TEXT[] NOT NULL DEFAULT '{}',

  -- Whether scoping this capability means anything. "Edit anybody's
  -- draft" takes a scope; "see the analytics screen" does not.
  scoped      BOOLEAN NOT NULL DEFAULT FALSE,

  position    INTEGER NOT NULL DEFAULT 0,
  -- A capability whose feature has been removed stays in the table so
  -- that history and existing grants still resolve, but stops being
  -- offered.
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_capcat_area ON capability_catalog (area, feature, position);

ALTER TABLE capability_catalog ENABLE ROW LEVEL SECURITY;

-- Everybody signed in may read it: the interface needs to know what a
-- capability is called in order to explain why something is hidden.
DROP POLICY IF EXISTS capcat_select ON capability_catalog;
CREATE POLICY capcat_select ON capability_catalog
  FOR SELECT USING (current_actor() IS NOT NULL);

-- Nobody writes it from the app. It changes by migration, which is what
-- keeps it honest: a capability exists because a feature shipped.
--
-- The revoke is not decoration. Supabase grants the full set on new
-- tables in `public` by default, so a table that only ever adds a
-- SELECT grant is still insertable. Row level security would refuse the
-- write for want of a policy, but a permission register should not be
-- relying on a second mechanism to hold a door nobody should be able to
-- reach. `check:capabilities` asserts this stays true.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON capability_catalog FROM authenticated, anon;
GRANT SELECT ON capability_catalog TO authenticated;

-- -------------------------------------------------------------
-- The register itself.
-- -------------------------------------------------------------
INSERT INTO capability_catalog (key, label, description, area, feature, danger, requires, scoped, position) VALUES

-- ---- CRM ----
('crm.view',             'See the CRM',              'Open the CRM and see the organizations they are allowed to see.', 'CRM', 'Access', 'routine', '{}', TRUE, 10),
('crm.viewGlobal',       'See every organization',   'See the whole company list, not only their own accounts.', 'CRM', 'Access', 'routine', '{crm.view}', FALSE, 20),
('crm.viewOthers',       'See a colleague''s accounts', 'Look at a named colleague''s portfolio.', 'CRM', 'Access', 'sensitive', '{crm.view}', FALSE, 30),
('crm.edit',             'Change records',           'Edit fields on an organization or contact.', 'CRM', 'Records', 'routine', '{crm.view}', TRUE, 40),
('crm.create',           'Add records',              'Create new organizations and contacts.', 'CRM', 'Records', 'routine', '{crm.view}', FALSE, 50),
('crm.delete',           'Remove records',           'Delete an organization or contact. Deletion is recoverable, but it disappears from every list until somebody restores it.', 'CRM', 'Records', 'destructive', '{crm.view}', TRUE, 60),
('crm.assign',           'Change who owns an account', 'Hand an account to somebody else, including taking one from them.', 'CRM', 'Records', 'sensitive', '{crm.view}', FALSE, 70),
('crm.manageLists',      'Make and share lists',     'Create working lists and share them with other people.', 'CRM', 'Records', 'routine', '{crm.view}', FALSE, 80),
('crm.proposal',         'Raise a proposal',         'Generate a proposal document from a record.', 'CRM', 'Documents', 'routine', '{crm.view}', FALSE, 90),
('crm.proposalForOthers','Raise one for somebody else', 'Raise a proposal in a colleague''s name, for when they are away.', 'CRM', 'Documents', 'sensitive', '{crm.proposal}', FALSE, 100),
('crm.delegate',         'Book into another diary',  'Put a call or meeting into somebody else''s calendar.', 'CRM', 'Documents', 'sensitive', '{crm.view}', FALSE, 110),
('crm.enrich',           'Spend an enrichment credit', 'Look a company up through the paid data provider. Each lookup costs money from a shared allowance.', 'CRM', 'Data', 'sensitive', '{crm.view}', FALSE, 120),
('crm.import',           'Bring data in',            'Import records in bulk from a spreadsheet.', 'CRM', 'Data', 'sensitive', '{crm.view}', FALSE, 130),
('crm.export',           'Take data out',            'Export records to a file. Anything exported leaves the audit trail behind.', 'CRM', 'Data', 'sensitive', '{crm.view}', FALSE, 140),

-- ---- Stock ----
('stock.edit',           'Change stock',             'Edit the stock list.', 'Stock', 'Records', 'routine', '{}', FALSE, 10),

-- ---- Content, the Buffer replacement ----
-- Deliberately fine grained. The point of the override table is that
-- two people on the same role can differ on exactly one of these.
('social.view',          'Open Content',             'See the content planner, the calendar and the library.', 'Content', 'Access', 'routine', '{}', TRUE, 10),
('social.draft',         'Write drafts',             'Create and edit their own drafts. Nothing they write can go out on its own.', 'Content', 'Writing', 'routine', '{social.view}', FALSE, 20),
('social.editAny',       'Edit anybody''s draft',    'Change a draft somebody else wrote, including one already submitted for approval.', 'Content', 'Writing', 'sensitive', '{social.view}', TRUE, 30),
('social.templates',     'Manage templates',         'Create and change the templates everybody else starts from.', 'Content', 'Writing', 'routine', '{social.view}', FALSE, 40),
('social.tags',          'Manage tags',              'Create, rename and merge the tags used to organize and report on content.', 'Content', 'Writing', 'routine', '{social.view}', FALSE, 50),
('social.schedule',      'Schedule',                 'Put content into the queue and choose when it goes out.', 'Content', 'Publishing', 'sensitive', '{social.view}', FALSE, 60),
('social.approve',       'Approve content',          'Approve or reject content so it can be scheduled. This is the gate before anything reaches the public.', 'Content', 'Publishing', 'sensitive', '{social.view}', FALSE, 70),
('social.approveOwn',    'Approve their own work',   'Approve content they wrote themselves. Off by default: an approval step that a person can grant themselves is not an approval step.', 'Content', 'Publishing', 'destructive', '{social.approve}', FALSE, 80),
('social.publishNow',    'Publish immediately',      'Send something out now, skipping the queue. There is no undo once a network has it.', 'Content', 'Publishing', 'destructive', '{social.view}', FALSE, 90),
('social.delete',        'Delete content',           'Remove a draft or a scheduled post. Published posts keep their record either way.', 'Content', 'Publishing', 'destructive', '{social.view}', TRUE, 100),
('social.channels',      'Manage channels',          'Connect and disconnect the accounts content goes out to, and change their posting slots.', 'Content', 'Setup', 'destructive', '{social.view}', FALSE, 110),
('social.library',       'Manage the library',       'Upload assets and change or remove the ones already there.', 'Content', 'Setup', 'routine', '{social.view}', FALSE, 120),
('social.analytics',     'See performance',          'See how content performed, per post and per channel.', 'Content', 'Analytics', 'routine', '{social.view}', TRUE, 130),
('social.metricSets',    'Build metric sets',        'Create and change the saved sets of metrics everybody reports on.', 'Content', 'Analytics', 'routine', '{social.analytics}', FALSE, 140),
('social.analyticsExport','Export reports',          'Download performance reports. Anything exported leaves the audit trail behind.', 'Content', 'Analytics', 'sensitive', '{social.analytics}', FALSE, 150),

-- ---- Marketing, the older pair these grew out of ----
('marketing.edit',       'Edit marketing content',   'The older, coarser permission. Kept so existing grants still resolve.', 'Content', 'Legacy', 'routine', '{}', FALSE, 900),
('marketing.approve',    'Approve marketing content','The older, coarser approval permission. Kept so existing grants still resolve.', 'Content', 'Legacy', 'sensitive', '{}', FALSE, 910),

-- ---- Administration ----
('admin.users',          'Manage people',            'Add people, change their role, and set what they can reach.', 'Admin', 'People', 'destructive', '{}', FALSE, 10),
('admin.settings',       'Change settings',          'Change what this installation is called, how it is branded, and how its pipelines are configured.', 'Admin', 'Installation', 'destructive', '{}', FALSE, 20),
('admin.audit',          'Read the audit trail',     'Read the permanent record of who changed what, and generate insider lists from it.', 'Admin', 'Compliance', 'sensitive', '{}', FALSE, 30)

ON CONFLICT (key) DO UPDATE SET
  label       = EXCLUDED.label,
  description = EXCLUDED.description,
  area        = EXCLUDED.area,
  feature     = EXCLUDED.feature,
  danger      = EXCLUDED.danger,
  requires    = EXCLUDED.requires,
  scoped      = EXCLUDED.scoped,
  position    = EXCLUDED.position,
  is_active   = TRUE;

-- -------------------------------------------------------------
-- Seed the new Content capabilities onto the role templates.
--
-- The shape the user described: a Marketer can write, tag, use
-- templates and read performance, but cannot approve, cannot publish
-- immediately, and cannot connect a channel. Elevating one Marketer to
-- approve is then a single row in user_capability_overrides rather than
-- a new role.
-- -------------------------------------------------------------
DO $seed$
DECLARE
  admin_id      UUID;
  member_id     UUID;
  contrib_id    UUID;
  observer_id   UUID;
  compliance_id UUID;
BEGIN
  SELECT id INTO admin_id      FROM role_templates WHERE slug = 'administrator';
  SELECT id INTO member_id     FROM role_templates WHERE slug = 'member';
  SELECT id INTO contrib_id    FROM role_templates WHERE slug = 'contributor';
  SELECT id INTO observer_id   FROM role_templates WHERE slug = 'observer';
  SELECT id INTO compliance_id FROM role_templates WHERE slug = 'compliance';

  -- Administrator gets everything Content has, including the ones that
  -- are destructive, because somebody has to be able to connect a
  -- channel and pull a post.
  IF admin_id IS NOT NULL THEN
    INSERT INTO role_template_capabilities (role_template_id, capability, scope)
    SELECT admin_id, key, 'company'::capability_scope
      FROM capability_catalog WHERE area = 'Content' AND feature <> 'Legacy'
    ON CONFLICT DO NOTHING;
  END IF;

  -- Member: writes, organizes and reads performance. Cannot approve,
  -- cannot publish now, cannot touch channels.
  IF member_id IS NOT NULL THEN
    INSERT INTO role_template_capabilities (role_template_id, capability, scope) VALUES
      (member_id, 'social.view',      'company'),
      (member_id, 'social.draft',     'own'),
      (member_id, 'social.templates', 'company'),
      (member_id, 'social.tags',      'company'),
      (member_id, 'social.library',   'company'),
      (member_id, 'social.schedule',  'own'),
      (member_id, 'social.analytics', 'company')
    ON CONFLICT DO NOTHING;
  END IF;

  -- Contributor: writes their own and nothing else.
  IF contrib_id IS NOT NULL THEN
    INSERT INTO role_template_capabilities (role_template_id, capability, scope) VALUES
      (contrib_id, 'social.view',      'own'),
      (contrib_id, 'social.draft',     'own'),
      (contrib_id, 'social.analytics', 'own')
    ON CONFLICT DO NOTHING;
  END IF;

  -- Observer reads and nothing more.
  IF observer_id IS NOT NULL THEN
    INSERT INTO role_template_capabilities (role_template_id, capability, scope) VALUES
      (observer_id, 'social.view',      'company'),
      (observer_id, 'social.analytics', 'company')
    ON CONFLICT DO NOTHING;
  END IF;

  -- Compliance already holds marketing.approve in 043, which is the
  -- coarse ancestor of social.approve. It gets the fine grained one on
  -- the same reasoning: it reviews and it blocks, and it does not write.
  IF compliance_id IS NOT NULL THEN
    INSERT INTO role_template_capabilities (role_template_id, capability, scope) VALUES
      (compliance_id, 'social.view',      'company'),
      (compliance_id, 'social.approve',   'company'),
      (compliance_id, 'social.analytics', 'company')
    ON CONFLICT DO NOTHING;
  END IF;
END
$seed$;

-- -------------------------------------------------------------
-- What somebody can actually do, and why.
--
-- The admin screen has to answer "why can Theo publish" without a
-- person reading four tables. This gives the answer per capability: the
-- effective grant, and where it came from.
--
-- ---- It answers in command_may()'s order, all four steps ----
--
-- The first draft of this function read the override table and the
-- template and stopped there. That is wrong today and wrong in the way
-- that matters: `command_may` has a fourth step, the legacy role seed,
-- which is what still authorizes every account that has not been given
-- a template. Since no account has one yet, a report that skipped that
-- step would have said "not granted" for every capability every person
-- currently holds. A permissions screen that disagrees with the
-- permission check is worse than no screen.
--
-- `check:capabilities` asserts the two agree, capability by capability,
-- person by person, rather than trusting that they do.
--
-- ---- Who may run it ----
--
-- Reading somebody else's permissions is administration, so it is
-- refused unless the caller is asking about themselves or holds
-- admin.users or admin.audit. It raises rather than returning nothing,
-- because an empty result reads as "this person can do nothing" and
-- somebody would act on it.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION capability_report(p_user UUID)
RETURNS TABLE (
  key         TEXT,
  label       TEXT,
  description TEXT,
  area        TEXT,
  feature     TEXT,
  danger      capability_danger,
  granted     BOOLEAN,
  source      TEXT,
  scope       capability_scope,
  reason      TEXT,
  granted_by  UUID,
  expires_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  template   UUID;
  legacy_role TEXT;
BEGIN
  IF current_actor() IS NULL THEN
    RAISE EXCEPTION 'capability_report: not signed in';
  END IF;

  IF p_user <> current_actor()
     AND NOT command_may('admin.users')
     AND NOT command_may('admin.audit') THEN
    RAISE EXCEPTION 'capability_report: reading another person''s permissions needs admin.users or admin.audit';
  END IF;

  SELECT p.role_template_id, p.role INTO template, legacy_role
    FROM profiles p WHERE p.id = p_user;

  RETURN QUERY
  SELECT
    c.key,
    c.label,
    c.description,
    c.area,
    c.feature,
    c.danger,
    CASE
      WHEN o.capability IS NOT NULL THEN o.granted
      WHEN template IS NOT NULL     THEN rtc.capability IS NOT NULL
      ELSE legacy.capability IS NOT NULL
    END AS granted,
    CASE
      WHEN o.capability IS NOT NULL AND o.granted     THEN 'granted to this person'
      WHEN o.capability IS NOT NULL AND NOT o.granted THEN 'refused to this person'
      WHEN template IS NOT NULL AND rtc.capability IS NOT NULL THEN 'from their role'
      WHEN template IS NULL AND legacy.capability IS NOT NULL  THEN 'from their legacy role'
      ELSE 'not granted'
    END AS source,
    /* Mirrors actor_scope: an override with no scope of its own falls
       back to the template's and then to the narrowest, and the legacy
       path reports company because that is how the old four roles
       behaved. */
    /* Cast at the end: capability_scope is a domain over text, so a
       CASE mixing a domain column with a literal resolves to text and
       the function's declared return type rejects it. */
    (CASE
      WHEN o.capability IS NOT NULL AND o.granted THEN COALESCE(o.scope, rtc.scope, 'own')
      WHEN o.capability IS NOT NULL               THEN NULL
      WHEN rtc.capability IS NOT NULL             THEN rtc.scope
      WHEN template IS NULL AND legacy.capability IS NOT NULL THEN 'company'
      ELSE NULL
    END)::capability_scope AS scope,
    o.reason,
    o.granted_by,
    o.expires_at
  FROM capability_catalog c
  LEFT JOIN user_capability_overrides o
         ON o.capability = c.key
        AND o.user_id = p_user
        AND (o.expires_at IS NULL OR o.expires_at > NOW())
  LEFT JOIN role_template_capabilities rtc
         ON rtc.capability = c.key
        AND rtc.role_template_id = template
  LEFT JOIN LATERAL (
    SELECT r.capability FROM command_capability_roles r
     WHERE r.capability = c.key AND r.role = legacy_role
     LIMIT 1
  ) legacy ON TRUE
  WHERE c.is_active
  ORDER BY c.area, c.feature, c.position;
END;
$fn$;

REVOKE ALL ON FUNCTION capability_report(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION capability_report(UUID) TO authenticated;
