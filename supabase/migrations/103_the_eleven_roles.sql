-- =============================================================
-- 103. The eleven roles.
--
-- From the business, in one message:
--
--   Read only - this can go. Admin - this is for our admin users
--   (nothing to do with Administrator in the app) who manage our company
--   admin ... Sr Admin - this is the same but gives full access to the
--   revenue tab ... Finance ... Sr Finance - this is financial director
--   level ... MD - access to the entire app. Developer - access to the
--   entire app. Marketing ... Sr Marketing ... Sales ... Sr Sales ...
--   BD - this is tom's role, he manages sales and marketing departments.
--
-- Eleven roles where there were four.
--
-- ---- Why these are templates and not values of profiles.role ----
--
-- `profiles.role` is four values wide and is read by name across the
-- application. The moment "Admin" also means the office administrators,
-- every existing `role = 'admin'` is ambiguous, and that column has
-- meant the application administrator since the first migration.
--
-- Migration 049 already built the right mechanism. `command_may()`
-- answers in three layers:
--
--   1. a per user override
--   2. the person's role TEMPLATE
--   3. the legacy role seed, for anybody with no template yet
--
-- So the eleven are templates. The `role` column keeps its four values
-- and goes on answering for accounts nobody has moved, which is what
-- layer three is for.
--
-- ---- What the seniority line is ----
--
-- From the business:
--
--   An issue in our industry is a sales person joining a company,
--   exporting their crm and stock, then leaving the company. We can't
--   risk that but Sr Sales can have access ... Use logic to think "what
--   should a Sr be able to do that the users they're in charge of
--   cannot".
--
-- Drawn in one place and always the same three things: taking data out,
-- putting data in, and letting somebody else do something. Everything
-- else, the daily work, is identical either side of the line.
--
-- ---- Where the capability sets actually live ----
--
-- `lib/platform/permissions/roles.ts`. The block between the two GENERATED
-- markers below is written from it by `npm run gen:roles`, and
-- `npm run check:roles` fails the build if what is committed here has
-- drifted from that file.
--
-- Four hundred grants typed by hand into a migration disagree with the
-- code the first time somebody edits one of them, and a permission that
-- disagrees does not throw. It answers no, and the screen shows a button
-- the route behind it refuses. That is the fault `check:capabilities`
-- was written for after the four FleetSmart+ capabilities sat in the
-- code and not in the database for seven migrations.
--
-- ---- Safe to run twice ----
--
-- Every statement is an upsert or is scoped to what it just wrote. The
-- capability rows for the eleven are deleted and rewritten rather than
-- merged, for the reason migration 016 gives: a seed that only ever
-- grows is how a revoked permission survives.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1. The capabilities the eleven roles need in order to differ.
--
-- Analytics and Reports were both gated on `crm.view`, so there was no
-- way to give somebody one and withhold the other. The office
-- administrators need exactly that: "access to run reports ... No
-- analytics tab". Same for the tracker against the CRM, the stock list
-- against exporting it, and creating a customer against raising a lead:
-- "can create records, cannot create leads".
--
-- Mirrored in `lib/platform/permissions/catalog.ts`, and
-- `npm run check:capabilities` asserts the two cannot drift.
-- -------------------------------------------------------------
INSERT INTO capability_catalog (key, label, description, area, feature, danger, requires, scoped, position) VALUES
  ('leads.create', 'Raise a lead', 'Create a lead against a customer. Adding the customer and raising a lead against them are different jobs, and marketing does the first and not the second.', 'CRM', 'Records', 'routine', '{crm.view}', FALSE, 55),
  ('tracker.view', 'Open the sales tracker', 'See the pipeline board. Marketing can read a lead on a customer record without having the tracker.', 'CRM', 'Access', 'routine', '{crm.view}', FALSE, 150),
  ('stock.view', 'See the stock list', 'Open trailer sales and read the stock.', 'Stock', 'Records', 'routine', '{}', FALSE, 5),
  ('stock.export', 'Take the stock list out', 'Export the stock list to a file. This is the one a salesperson takes with them when they leave, so it sits with the senior.', 'Stock', 'Records', 'sensitive', '{stock.view}', FALSE, 20),
  ('analytics.view', 'Open Analytics', 'See the Analytics hub. Separate from the CRM, because the office administrators read Reports and do not need Analytics.', 'CRM', 'Analytics', 'routine', '{}', FALSE, 300),
  ('reports.view', 'Run a report', 'Open the Reports hub and run any report on screen.', 'CRM', 'Analytics', 'routine', '{}', FALSE, 310),
  ('reports.export', 'Take a report out', 'Download a report as a file. Anything downloaded leaves the audit trail behind, which is why running one and taking it away are different rights.', 'CRM', 'Analytics', 'sensitive', '{reports.view}', FALSE, 320),
  ('revenue.view', 'See the revenue tab', 'Open Revenue and read every division.', 'CRM', 'Revenue', 'routine', '{}', FALSE, 350),
  ('revenue.import', 'Import invoicing', 'Load a Protean or Sage export into revenue. One wrong file moves every figure on Analytics, Reports and the customer records.', 'CRM', 'Revenue', 'destructive', '{revenue.view}', FALSE, 360),
  ('revenue.export', 'Take revenue out', 'Export revenue figures to a file.', 'CRM', 'Revenue', 'sensitive', '{revenue.view}', FALSE, 370),
  ('finder.view', 'Use the company finder', 'Search for companies near a depot and add them to the CRM.', 'CRM', 'Data', 'routine', '{}', FALSE, 125),
  ('news.view', 'Read industry news', 'See the trade press feed.', 'Content', 'Brand', 'routine', '{}', FALSE, 220),
  ('brand.view', 'Use the brand kit', 'Open the brand kit and take a colour, a logo or a font from it.', 'Content', 'Brand', 'routine', '{}', FALSE, 200),
  ('brand.manage', 'Change the brand kit', 'Add, replace or remove brand assets. Everybody downstream uses whatever is in here.', 'Content', 'Brand', 'sensitive', '{brand.view}', FALSE, 210),
  ('access.request', 'Ask for something you may not do', 'Raise a request to whoever is senior to you for an export, an import or an approval you do not hold yourself.', 'Admin', 'Requests', 'routine', '{}', FALSE, 40),
  /* Added with migration 108, which is what uses it, but declared here
     because the seed below grants it and 103 refuses to finish if a
     granted capability has no catalogue row. That assertion is why
     this is in the right file: it caught the ordering at build time
     rather than leaving a permission nothing could ever explain. */
  ('admin.roles', 'Change what a role can do', 'Grant or take away a permission on a role template. It applies at once to everybody on that role, so this is the most far reaching change in the application.', 'Admin', 'Roles', 'destructive', '{}', FALSE, 45),
  ('access.decide', 'Decide those requests', 'Approve or refuse what the people you are senior to have asked for.', 'Admin', 'Requests', 'sensitive', '{}', FALSE, 50),
  ('admin.usersDepartment', 'Manage accounts in your own departments', 'Change roles and permissions for people in the departments you run, and nobody else. Narrower than admin.users, which reaches everybody.', 'Admin', 'Accounts', 'sensitive', '{}', FALSE, 15)
ON CONFLICT (key) DO UPDATE
  SET label       = EXCLUDED.label,
      description = EXCLUDED.description,
      area        = EXCLUDED.area,
      feature     = EXCLUDED.feature,
      danger      = EXCLUDED.danger,
      requires    = EXCLUDED.requires,
      scoped      = EXCLUDED.scoped,
      position    = EXCLUDED.position,
      is_active   = TRUE;

-- -------------------------------------------------------------
-- 2. The eleven themselves.
--
-- Generated. Edit `lib/platform/permissions/roles.ts` and run
-- `npm run gen:roles`, never this block.
-- -------------------------------------------------------------
/* ---- The column the seed below checks ----

   Set by `set_role_capability` in migration 108 the first time somebody
   changes a role through the Roles tab. The generated block skips any
   role where it is set, so re-pasting the catch-up bundle cannot undo
   a change made through the interface.

   Added here rather than in 108 because the seed below reads it, and
   103 runs first. */
ALTER TABLE role_templates ADD COLUMN IF NOT EXISTS customised_at TIMESTAMPTZ;

COMMENT ON COLUMN role_templates.customised_at IS
  'When a person first changed this role through the Roles tab. Set '
  'means the seed in migration 103 no longer touches it.';

-- >>> GENERATED FROM lib/platform/permissions/roles.ts. Do not edit by hand.

DELETE FROM role_template_capabilities
 WHERE role_template_id IN (SELECT id FROM role_templates WHERE slug IN (
   'developer', 'managing_director', 'business_development', 'sr_sales', 'sales_rep', 'sr_marketing', 'marketing_exec', 'sr_finance', 'finance', 'sr_office_admin', 'office_admin'
 ) AND customised_at IS NULL);

INSERT INTO role_templates (slug, name, description, is_system, sort_order) VALUES
  ('developer', 'Developer', 'Access to the entire app, including settings and the audit trail.', TRUE, 1),
  ('managing_director', 'Managing Director', 'Access to the entire app.', TRUE, 2),
  ('business_development', 'Business Development', 'Runs sales and marketing. Everything both departments have, the approvals over them, and their accounts.', TRUE, 3),
  ('sr_sales', 'Sr Sales', 'Everything a salesperson does, plus the exports, the bulk imports, the manager discount and the decisions on what the team asks for.', TRUE, 4),
  ('sales_rep', 'Sales', 'The full sales desk: customers, leads, contracts, stock and reports. Exports and bulk imports go to Sr Sales.', TRUE, 5),
  ('sr_marketing', 'Sr Marketing', 'Runs marketing. Approves posts, manages the brand kit, and can take data out of the CRM and put it back in.', TRUE, 6),
  ('marketing_exec', 'Marketing', 'The whole marketing section, short of approving posts and managing the brand kit. Can create CRM records but not leads, and cannot take data out or bring it in.', TRUE, 7),
  ('sr_finance', 'Sr Finance', 'Financial director. The whole application except the Marketing section.', TRUE, 8),
  ('finance', 'Finance', 'Dashboard, analytics, every report, the CRM, the finder, trailer sales, FleetSmart+ and all of revenue.', TRUE, 9),
  ('sr_office_admin', 'Sr Admin', 'Runs the admin team. Everything an administrator does, plus taking revenue and reports out.', TRUE, 10),
  ('office_admin', 'Admin', 'The company administrators. Reports, the whole revenue tab and its imports, the finder, the CRM pipeline and FleetSmart+. No analytics, and exports go to Sr Admin.', TRUE, 11)
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      is_system = TRUE,
      is_active = TRUE,
      sort_order = EXCLUDED.sort_order;

INSERT INTO role_template_capabilities (role_template_id, capability, scope)
SELECT rt.id, cap, 'company'::capability_scope
  FROM role_templates rt
  JOIN (VALUES
  -- Developer (90)
  ('developer', ARRAY[
    'access.decide', 'access.request', 'admin.audit', 'admin.roles',
    'admin.settings', 'admin.users', 'admin.usersDepartment', 'analytics.targets',
    'analytics.view', 'brand.manage', 'brand.view', 'compliance.sensitive',
    'crm.assign', 'crm.create', 'crm.delegate', 'crm.delete',
    'crm.edit', 'crm.enrich', 'crm.export', 'crm.health',
    'crm.import', 'crm.manageLists', 'crm.proposal', 'crm.proposalForOthers',
    'crm.view', 'crm.viewGlobal', 'crm.viewOthers', 'entity.setOthers',
    'entity.setOwn', 'entity.viewAll', 'finder.view', 'fleetsmart.build',
    'fleetsmart.discount', 'fleetsmart.send', 'fleetsmart.view', 'leads.create',
    'marketing.approve', 'marketing.edit', 'news.view', 'reports.export',
    'reports.view', 'revenue.export', 'revenue.import', 'revenue.view',
    'social.analytics', 'social.analyticsExport', 'social.approve', 'social.approveOwn',
    'social.channels', 'social.delete', 'social.draft', 'social.editAny',
    'social.library', 'social.metricSets', 'social.publishNow', 'social.schedule',
    'social.tags', 'social.templates', 'social.view', 'stock.edit',
    'stock.export', 'stock.view', 'tracker.view', 'work.analytics',
    'work.analyticsAll', 'work.approve', 'work.assignDepartment', 'work.assignOthers',
    'work.create', 'work.decideRelease', 'work.delete', 'work.edit',
    'work.editAny', 'work.forceRelease', 'work.manageFields', 'work.manageProjects',
    'work.manageSystemViews', 'work.projects', 'work.publishProject', 'work.reassign',
    'work.requestRelease', 'work.review', 'work.rollback', 'work.schedule',
    'work.setDue', 'work.shareViews', 'work.view', 'work.viewAll',
    'work.viewDepartment', 'work.views'
  ]),
  -- Managing Director (90)
  ('managing_director', ARRAY[
    'access.decide', 'access.request', 'admin.audit', 'admin.roles',
    'admin.settings', 'admin.users', 'admin.usersDepartment', 'analytics.targets',
    'analytics.view', 'brand.manage', 'brand.view', 'compliance.sensitive',
    'crm.assign', 'crm.create', 'crm.delegate', 'crm.delete',
    'crm.edit', 'crm.enrich', 'crm.export', 'crm.health',
    'crm.import', 'crm.manageLists', 'crm.proposal', 'crm.proposalForOthers',
    'crm.view', 'crm.viewGlobal', 'crm.viewOthers', 'entity.setOthers',
    'entity.setOwn', 'entity.viewAll', 'finder.view', 'fleetsmart.build',
    'fleetsmart.discount', 'fleetsmart.send', 'fleetsmart.view', 'leads.create',
    'marketing.approve', 'marketing.edit', 'news.view', 'reports.export',
    'reports.view', 'revenue.export', 'revenue.import', 'revenue.view',
    'social.analytics', 'social.analyticsExport', 'social.approve', 'social.approveOwn',
    'social.channels', 'social.delete', 'social.draft', 'social.editAny',
    'social.library', 'social.metricSets', 'social.publishNow', 'social.schedule',
    'social.tags', 'social.templates', 'social.view', 'stock.edit',
    'stock.export', 'stock.view', 'tracker.view', 'work.analytics',
    'work.analyticsAll', 'work.approve', 'work.assignDepartment', 'work.assignOthers',
    'work.create', 'work.decideRelease', 'work.delete', 'work.edit',
    'work.editAny', 'work.forceRelease', 'work.manageFields', 'work.manageProjects',
    'work.manageSystemViews', 'work.projects', 'work.publishProject', 'work.reassign',
    'work.requestRelease', 'work.review', 'work.rollback', 'work.schedule',
    'work.setDue', 'work.shareViews', 'work.view', 'work.viewAll',
    'work.viewDepartment', 'work.views'
  ]),
  -- Business Development (76)
  ('business_development', ARRAY[
    'access.decide', 'access.request', 'admin.usersDepartment', 'analytics.targets',
    'analytics.view', 'brand.manage', 'brand.view', 'crm.assign',
    'crm.create', 'crm.delegate', 'crm.delete', 'crm.edit',
    'crm.enrich', 'crm.export', 'crm.health', 'crm.import',
    'crm.manageLists', 'crm.proposal', 'crm.proposalForOthers', 'crm.view',
    'crm.viewGlobal', 'crm.viewOthers', 'entity.setOwn', 'entity.viewAll',
    'finder.view', 'fleetsmart.build', 'fleetsmart.discount', 'fleetsmart.send',
    'fleetsmart.view', 'leads.create', 'marketing.approve', 'marketing.edit',
    'news.view', 'reports.export', 'reports.view', 'revenue.export',
    'revenue.import', 'revenue.view', 'social.analytics', 'social.analyticsExport',
    'social.approve', 'social.approveOwn', 'social.channels', 'social.delete',
    'social.draft', 'social.editAny', 'social.library', 'social.metricSets',
    'social.publishNow', 'social.schedule', 'social.tags', 'social.templates',
    'social.view', 'stock.edit', 'stock.export', 'stock.view',
    'tracker.view', 'work.analytics', 'work.approve', 'work.assignDepartment',
    'work.assignOthers', 'work.create', 'work.decideRelease', 'work.edit',
    'work.editAny', 'work.manageProjects', 'work.projects', 'work.reassign',
    'work.requestRelease', 'work.review', 'work.setDue', 'work.shareViews',
    'work.view', 'work.viewAll', 'work.viewDepartment', 'work.views'
  ]),
  -- Sr Sales (53)
  ('sr_sales', ARRAY[
    'access.decide', 'access.request', 'analytics.view', 'brand.view',
    'crm.assign', 'crm.create', 'crm.delegate', 'crm.delete',
    'crm.edit', 'crm.enrich', 'crm.export', 'crm.health',
    'crm.import', 'crm.manageLists', 'crm.proposal', 'crm.proposalForOthers',
    'crm.view', 'crm.viewGlobal', 'crm.viewOthers', 'entity.setOwn',
    'finder.view', 'fleetsmart.build', 'fleetsmart.discount', 'fleetsmart.send',
    'fleetsmart.view', 'leads.create', 'news.view', 'reports.export',
    'reports.view', 'revenue.export', 'revenue.import', 'revenue.view',
    'social.view', 'stock.edit', 'stock.export', 'stock.view',
    'tracker.view', 'work.analytics', 'work.approve', 'work.assignDepartment',
    'work.assignOthers', 'work.create', 'work.decideRelease', 'work.edit',
    'work.editAny', 'work.reassign', 'work.requestRelease', 'work.review',
    'work.setDue', 'work.view', 'work.viewAll', 'work.viewDepartment',
    'work.views'
  ]),
  -- Sales (33)
  ('sales_rep', ARRAY[
    'access.request', 'analytics.view', 'brand.view', 'crm.assign',
    'crm.create', 'crm.delegate', 'crm.edit', 'crm.enrich',
    'crm.health', 'crm.manageLists', 'crm.proposal', 'crm.view',
    'crm.viewGlobal', 'entity.setOwn', 'finder.view', 'fleetsmart.build',
    'fleetsmart.send', 'fleetsmart.view', 'leads.create', 'news.view',
    'reports.export', 'reports.view', 'revenue.view', 'social.view',
    'stock.edit', 'stock.view', 'tracker.view', 'work.create',
    'work.edit', 'work.requestRelease', 'work.setDue', 'work.view',
    'work.views'
  ]),
  -- Sr Marketing (51)
  ('sr_marketing', ARRAY[
    'access.decide', 'access.request', 'analytics.view', 'brand.manage',
    'brand.view', 'crm.create', 'crm.delegate', 'crm.edit',
    'crm.export', 'crm.health', 'crm.import', 'crm.manageLists',
    'crm.proposal', 'crm.view', 'crm.viewGlobal', 'entity.setOwn',
    'finder.view', 'marketing.approve', 'marketing.edit', 'news.view',
    'reports.export', 'reports.view', 'revenue.export', 'revenue.import',
    'revenue.view', 'social.analytics', 'social.analyticsExport', 'social.approve',
    'social.approveOwn', 'social.channels', 'social.delete', 'social.draft',
    'social.editAny', 'social.library', 'social.metricSets', 'social.publishNow',
    'social.schedule', 'social.tags', 'social.templates', 'social.view',
    'stock.export', 'work.approve', 'work.assignOthers', 'work.create',
    'work.edit', 'work.requestRelease', 'work.review', 'work.setDue',
    'work.view', 'work.viewDepartment', 'work.views'
  ]),
  -- Marketing (32)
  ('marketing_exec', ARRAY[
    'access.request', 'analytics.view', 'brand.view', 'crm.create',
    'crm.delegate', 'crm.edit', 'crm.health', 'crm.manageLists',
    'crm.proposal', 'crm.view', 'crm.viewGlobal', 'entity.setOwn',
    'finder.view', 'marketing.edit', 'news.view', 'reports.view',
    'revenue.view', 'social.analytics', 'social.draft', 'social.editAny',
    'social.library', 'social.metricSets', 'social.schedule', 'social.tags',
    'social.templates', 'social.view', 'work.create', 'work.edit',
    'work.requestRelease', 'work.setDue', 'work.view', 'work.views'
  ]),
  -- Sr Finance (70)
  ('sr_finance', ARRAY[
    'access.decide', 'access.request', 'admin.audit', 'admin.roles',
    'admin.settings', 'admin.users', 'admin.usersDepartment', 'analytics.targets',
    'analytics.view', 'compliance.sensitive', 'crm.assign', 'crm.create',
    'crm.delegate', 'crm.delete', 'crm.edit', 'crm.enrich',
    'crm.export', 'crm.health', 'crm.import', 'crm.manageLists',
    'crm.proposal', 'crm.proposalForOthers', 'crm.view', 'crm.viewGlobal',
    'crm.viewOthers', 'entity.setOthers', 'entity.setOwn', 'entity.viewAll',
    'finder.view', 'fleetsmart.build', 'fleetsmart.discount', 'fleetsmart.send',
    'fleetsmart.view', 'leads.create', 'reports.export', 'reports.view',
    'revenue.export', 'revenue.import', 'revenue.view', 'stock.edit',
    'stock.export', 'stock.view', 'tracker.view', 'work.analytics',
    'work.analyticsAll', 'work.approve', 'work.assignDepartment', 'work.assignOthers',
    'work.create', 'work.decideRelease', 'work.delete', 'work.edit',
    'work.editAny', 'work.forceRelease', 'work.manageFields', 'work.manageProjects',
    'work.manageSystemViews', 'work.projects', 'work.publishProject', 'work.reassign',
    'work.requestRelease', 'work.review', 'work.rollback', 'work.schedule',
    'work.setDue', 'work.shareViews', 'work.view', 'work.viewAll',
    'work.viewDepartment', 'work.views'
  ]),
  -- Finance (28)
  ('finance', ARRAY[
    'access.request', 'analytics.targets', 'analytics.view', 'crm.create',
    'crm.delegate', 'crm.edit', 'crm.health', 'crm.manageLists',
    'crm.proposal', 'crm.view', 'crm.viewGlobal', 'crm.viewOthers',
    'entity.setOwn', 'finder.view', 'fleetsmart.view', 'reports.export',
    'reports.view', 'revenue.export', 'revenue.import', 'revenue.view',
    'stock.view', 'tracker.view', 'work.create', 'work.edit',
    'work.requestRelease', 'work.setDue', 'work.view', 'work.views'
  ]),
  -- Sr Admin (22)
  ('sr_office_admin', ARRAY[
    'access.decide', 'access.request', 'crm.health', 'crm.proposal',
    'crm.view', 'crm.viewGlobal', 'entity.setOwn', 'finder.view',
    'fleetsmart.view', 'reports.export', 'reports.view', 'revenue.export',
    'revenue.import', 'revenue.view', 'work.assignOthers', 'work.create',
    'work.edit', 'work.requestRelease', 'work.setDue', 'work.view',
    'work.viewDepartment', 'work.views'
  ]),
  -- Admin (16)
  ('office_admin', ARRAY[
    'access.request', 'crm.health', 'crm.view', 'crm.viewGlobal',
    'entity.setOwn', 'finder.view', 'fleetsmart.view', 'reports.view',
    'revenue.import', 'revenue.view', 'work.create', 'work.edit',
    'work.requestRelease', 'work.setDue', 'work.view', 'work.views'
  ])
  ) AS v(slug, caps) ON v.slug = rt.slug
  CROSS JOIN LATERAL unnest(v.caps) AS cap
 WHERE rt.customised_at IS NULL
ON CONFLICT (role_template_id, capability) DO UPDATE SET scope = EXCLUDED.scope;

-- <<< END GENERATED

-- -------------------------------------------------------------
-- 3. Administrator becomes Managing Director.
--
-- From the business: "Administrator role can be renamed to Managing
-- Director so we don't have to delete it, I can move people's roles in
-- the crm afterwards."
--
-- Renaming the row in place would leave the slug reading `administrator`
-- forever, and the slug is what a migration and a check both name. So
-- the people move instead: anybody on the old template is put on
-- `managing_director`, which holds everything the old one held and then
-- some, so nobody loses anything in the move.
--
-- The old template is not deleted. Deactivated, so it stops being
-- offered on the Team screen while every grant it ever made still
-- resolves and every audit row still reads.
-- -------------------------------------------------------------
UPDATE profiles p
   SET role_template_id = (SELECT id FROM role_templates WHERE slug = 'managing_director')
 WHERE p.role_template_id = (SELECT id FROM role_templates WHERE slug = 'administrator');

-- "Read only - this can go", and the four that came in with the Frame
-- package and describe a company this is not.
UPDATE role_templates
   SET is_active = FALSE
 WHERE slug IN ('administrator', 'compliance', 'member', 'contributor', 'observer');

-- Anybody sitting on one of the other four goes to the nearest of the
-- eleven. Observer and contributor read and little else, which is the
-- office administrator's shape; member works records, which is Sales.
-- Compliance is left alone: nobody holds it, and guessing a home for a
-- reviewer role would be inventing a decision the business has not made.
UPDATE profiles p
   SET role_template_id = (SELECT id FROM role_templates WHERE slug = 'office_admin')
 WHERE p.role_template_id IN
   (SELECT id FROM role_templates WHERE slug IN ('observer', 'contributor'));

UPDATE profiles p
   SET role_template_id = (SELECT id FROM role_templates WHERE slug = 'sales_rep')
 WHERE p.role_template_id IN (SELECT id FROM role_templates WHERE slug = 'member');

-- -------------------------------------------------------------
-- 4. Did it land.
--
-- Said out loud, so a migration that matched nothing is not mistaken for
-- one that worked. Every one of these has failed at least once on a
-- first run of some file in this folder.
-- -------------------------------------------------------------
DO $$
DECLARE
  n_roles   INTEGER;
  n_grants  INTEGER;
  orphan    TEXT;
  empty     TEXT;
  stranded  INTEGER;
BEGIN
  SELECT count(*) INTO n_roles
    FROM role_templates
   WHERE is_active AND slug IN ('developer', 'managing_director', 'business_development',
                                'sr_sales', 'sales_rep', 'sr_marketing', 'marketing_exec',
                                'sr_finance', 'finance', 'sr_office_admin', 'office_admin');
  IF n_roles <> 11 THEN
    RAISE EXCEPTION '103 did not land: % of the eleven roles are active, not 11', n_roles;
  END IF;

  /* A grant naming a capability that does not exist is the exact bug
     that put a Save button in front of a route that refused it. It does
     not throw on its own, because role_template_capabilities.capability
     is free text. So it is checked here. */
  SELECT string_agg(DISTINCT rtc.capability, ', ' ORDER BY rtc.capability) INTO orphan
    FROM role_template_capabilities rtc
    JOIN role_templates rt ON rt.id = rtc.role_template_id
   WHERE rt.is_active
     AND NOT EXISTS (SELECT 1 FROM capability_catalog c WHERE c.key = rtc.capability);
  IF orphan IS NOT NULL THEN
    RAISE EXCEPTION '103 did not land: granted but not in the catalog: %', orphan;
  END IF;

  /* A role with nothing in it is a role that silently locks somebody
     out of the whole application. */
  SELECT string_agg(rt.slug, ', ' ORDER BY rt.slug) INTO empty
    FROM role_templates rt
   WHERE rt.is_active
     AND NOT EXISTS (SELECT 1 FROM role_template_capabilities x WHERE x.role_template_id = rt.id);
  IF empty IS NOT NULL THEN
    RAISE EXCEPTION '103 did not land: these roles hold nothing: %', empty;
  END IF;

  /* Nobody may be left holding a template that is no longer offered. */
  SELECT count(*) INTO stranded
    FROM profiles p JOIN role_templates rt ON rt.id = p.role_template_id
   WHERE NOT rt.is_active;
  IF stranded > 0 THEN
    RAISE EXCEPTION '103 did not land: % people still hold a retired template', stranded;
  END IF;

  SELECT count(*) INTO n_grants
    FROM role_template_capabilities rtc
    JOIN role_templates rt ON rt.id = rtc.role_template_id
   WHERE rt.is_active;

  RAISE NOTICE 'the eleven roles: % active roles, % grants', n_roles, n_grants;
END $$;

COMMIT;

-- PostgREST caches the schema. New rows do not need it, but the Team
-- screen reads role_templates through the API and a stale cache is how
-- a role that is definitely there does not appear in a dropdown.
NOTIFY pgrst, 'reload schema';
