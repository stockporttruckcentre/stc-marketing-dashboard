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
-- >>> GENERATED FROM lib/platform/permissions/roles.ts. Do not edit by hand.

DELETE FROM role_template_capabilities
 WHERE role_template_id IN (SELECT id FROM role_templates WHERE slug IN (
   'developer', 'managing_director', 'business_development', 'sr_sales', 'sales_rep', 'sr_marketing', 'marketing_exec', 'sr_finance', 'finance', 'sr_office_admin', 'office_admin'
 ));

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
SELECT rt.id, v.capability, v.scope::capability_scope
  FROM role_templates rt
  JOIN (VALUES
  -- ---- Developer (89) ----
  ('developer', 'access.decide', 'company'),
  ('developer', 'access.request', 'company'),
  ('developer', 'admin.audit', 'company'),
  ('developer', 'admin.settings', 'company'),
  ('developer', 'admin.users', 'company'),
  ('developer', 'admin.usersDepartment', 'company'),
  ('developer', 'analytics.targets', 'company'),
  ('developer', 'analytics.view', 'company'),
  ('developer', 'brand.manage', 'company'),
  ('developer', 'brand.view', 'company'),
  ('developer', 'compliance.sensitive', 'company'),
  ('developer', 'crm.assign', 'company'),
  ('developer', 'crm.create', 'company'),
  ('developer', 'crm.delegate', 'company'),
  ('developer', 'crm.delete', 'company'),
  ('developer', 'crm.edit', 'company'),
  ('developer', 'crm.enrich', 'company'),
  ('developer', 'crm.export', 'company'),
  ('developer', 'crm.health', 'company'),
  ('developer', 'crm.import', 'company'),
  ('developer', 'crm.manageLists', 'company'),
  ('developer', 'crm.proposal', 'company'),
  ('developer', 'crm.proposalForOthers', 'company'),
  ('developer', 'crm.view', 'company'),
  ('developer', 'crm.viewGlobal', 'company'),
  ('developer', 'crm.viewOthers', 'company'),
  ('developer', 'entity.setOthers', 'company'),
  ('developer', 'entity.setOwn', 'company'),
  ('developer', 'entity.viewAll', 'company'),
  ('developer', 'finder.view', 'company'),
  ('developer', 'fleetsmart.build', 'company'),
  ('developer', 'fleetsmart.discount', 'company'),
  ('developer', 'fleetsmart.send', 'company'),
  ('developer', 'fleetsmart.view', 'company'),
  ('developer', 'leads.create', 'company'),
  ('developer', 'marketing.approve', 'company'),
  ('developer', 'marketing.edit', 'company'),
  ('developer', 'news.view', 'company'),
  ('developer', 'reports.export', 'company'),
  ('developer', 'reports.view', 'company'),
  ('developer', 'revenue.export', 'company'),
  ('developer', 'revenue.import', 'company'),
  ('developer', 'revenue.view', 'company'),
  ('developer', 'social.analytics', 'company'),
  ('developer', 'social.analyticsExport', 'company'),
  ('developer', 'social.approve', 'company'),
  ('developer', 'social.approveOwn', 'company'),
  ('developer', 'social.channels', 'company'),
  ('developer', 'social.delete', 'company'),
  ('developer', 'social.draft', 'company'),
  ('developer', 'social.editAny', 'company'),
  ('developer', 'social.library', 'company'),
  ('developer', 'social.metricSets', 'company'),
  ('developer', 'social.publishNow', 'company'),
  ('developer', 'social.schedule', 'company'),
  ('developer', 'social.tags', 'company'),
  ('developer', 'social.templates', 'company'),
  ('developer', 'social.view', 'company'),
  ('developer', 'stock.edit', 'company'),
  ('developer', 'stock.export', 'company'),
  ('developer', 'stock.view', 'company'),
  ('developer', 'tracker.view', 'company'),
  ('developer', 'work.analytics', 'company'),
  ('developer', 'work.analyticsAll', 'company'),
  ('developer', 'work.approve', 'company'),
  ('developer', 'work.assignDepartment', 'company'),
  ('developer', 'work.assignOthers', 'company'),
  ('developer', 'work.create', 'company'),
  ('developer', 'work.decideRelease', 'company'),
  ('developer', 'work.delete', 'company'),
  ('developer', 'work.edit', 'company'),
  ('developer', 'work.editAny', 'company'),
  ('developer', 'work.forceRelease', 'company'),
  ('developer', 'work.manageFields', 'company'),
  ('developer', 'work.manageProjects', 'company'),
  ('developer', 'work.manageSystemViews', 'company'),
  ('developer', 'work.projects', 'company'),
  ('developer', 'work.publishProject', 'company'),
  ('developer', 'work.reassign', 'company'),
  ('developer', 'work.requestRelease', 'company'),
  ('developer', 'work.review', 'company'),
  ('developer', 'work.rollback', 'company'),
  ('developer', 'work.schedule', 'company'),
  ('developer', 'work.setDue', 'company'),
  ('developer', 'work.shareViews', 'company'),
  ('developer', 'work.view', 'company'),
  ('developer', 'work.viewAll', 'company'),
  ('developer', 'work.viewDepartment', 'company'),
  ('developer', 'work.views', 'company'),
  -- ---- Managing Director (89) ----
  ('managing_director', 'access.decide', 'company'),
  ('managing_director', 'access.request', 'company'),
  ('managing_director', 'admin.audit', 'company'),
  ('managing_director', 'admin.settings', 'company'),
  ('managing_director', 'admin.users', 'company'),
  ('managing_director', 'admin.usersDepartment', 'company'),
  ('managing_director', 'analytics.targets', 'company'),
  ('managing_director', 'analytics.view', 'company'),
  ('managing_director', 'brand.manage', 'company'),
  ('managing_director', 'brand.view', 'company'),
  ('managing_director', 'compliance.sensitive', 'company'),
  ('managing_director', 'crm.assign', 'company'),
  ('managing_director', 'crm.create', 'company'),
  ('managing_director', 'crm.delegate', 'company'),
  ('managing_director', 'crm.delete', 'company'),
  ('managing_director', 'crm.edit', 'company'),
  ('managing_director', 'crm.enrich', 'company'),
  ('managing_director', 'crm.export', 'company'),
  ('managing_director', 'crm.health', 'company'),
  ('managing_director', 'crm.import', 'company'),
  ('managing_director', 'crm.manageLists', 'company'),
  ('managing_director', 'crm.proposal', 'company'),
  ('managing_director', 'crm.proposalForOthers', 'company'),
  ('managing_director', 'crm.view', 'company'),
  ('managing_director', 'crm.viewGlobal', 'company'),
  ('managing_director', 'crm.viewOthers', 'company'),
  ('managing_director', 'entity.setOthers', 'company'),
  ('managing_director', 'entity.setOwn', 'company'),
  ('managing_director', 'entity.viewAll', 'company'),
  ('managing_director', 'finder.view', 'company'),
  ('managing_director', 'fleetsmart.build', 'company'),
  ('managing_director', 'fleetsmart.discount', 'company'),
  ('managing_director', 'fleetsmart.send', 'company'),
  ('managing_director', 'fleetsmart.view', 'company'),
  ('managing_director', 'leads.create', 'company'),
  ('managing_director', 'marketing.approve', 'company'),
  ('managing_director', 'marketing.edit', 'company'),
  ('managing_director', 'news.view', 'company'),
  ('managing_director', 'reports.export', 'company'),
  ('managing_director', 'reports.view', 'company'),
  ('managing_director', 'revenue.export', 'company'),
  ('managing_director', 'revenue.import', 'company'),
  ('managing_director', 'revenue.view', 'company'),
  ('managing_director', 'social.analytics', 'company'),
  ('managing_director', 'social.analyticsExport', 'company'),
  ('managing_director', 'social.approve', 'company'),
  ('managing_director', 'social.approveOwn', 'company'),
  ('managing_director', 'social.channels', 'company'),
  ('managing_director', 'social.delete', 'company'),
  ('managing_director', 'social.draft', 'company'),
  ('managing_director', 'social.editAny', 'company'),
  ('managing_director', 'social.library', 'company'),
  ('managing_director', 'social.metricSets', 'company'),
  ('managing_director', 'social.publishNow', 'company'),
  ('managing_director', 'social.schedule', 'company'),
  ('managing_director', 'social.tags', 'company'),
  ('managing_director', 'social.templates', 'company'),
  ('managing_director', 'social.view', 'company'),
  ('managing_director', 'stock.edit', 'company'),
  ('managing_director', 'stock.export', 'company'),
  ('managing_director', 'stock.view', 'company'),
  ('managing_director', 'tracker.view', 'company'),
  ('managing_director', 'work.analytics', 'company'),
  ('managing_director', 'work.analyticsAll', 'company'),
  ('managing_director', 'work.approve', 'company'),
  ('managing_director', 'work.assignDepartment', 'company'),
  ('managing_director', 'work.assignOthers', 'company'),
  ('managing_director', 'work.create', 'company'),
  ('managing_director', 'work.decideRelease', 'company'),
  ('managing_director', 'work.delete', 'company'),
  ('managing_director', 'work.edit', 'company'),
  ('managing_director', 'work.editAny', 'company'),
  ('managing_director', 'work.forceRelease', 'company'),
  ('managing_director', 'work.manageFields', 'company'),
  ('managing_director', 'work.manageProjects', 'company'),
  ('managing_director', 'work.manageSystemViews', 'company'),
  ('managing_director', 'work.projects', 'company'),
  ('managing_director', 'work.publishProject', 'company'),
  ('managing_director', 'work.reassign', 'company'),
  ('managing_director', 'work.requestRelease', 'company'),
  ('managing_director', 'work.review', 'company'),
  ('managing_director', 'work.rollback', 'company'),
  ('managing_director', 'work.schedule', 'company'),
  ('managing_director', 'work.setDue', 'company'),
  ('managing_director', 'work.shareViews', 'company'),
  ('managing_director', 'work.view', 'company'),
  ('managing_director', 'work.viewAll', 'company'),
  ('managing_director', 'work.viewDepartment', 'company'),
  ('managing_director', 'work.views', 'company'),
  -- ---- Business Development (76) ----
  ('business_development', 'access.decide', 'company'),
  ('business_development', 'access.request', 'company'),
  ('business_development', 'admin.usersDepartment', 'company'),
  ('business_development', 'analytics.targets', 'company'),
  ('business_development', 'analytics.view', 'company'),
  ('business_development', 'brand.manage', 'company'),
  ('business_development', 'brand.view', 'company'),
  ('business_development', 'crm.assign', 'company'),
  ('business_development', 'crm.create', 'company'),
  ('business_development', 'crm.delegate', 'company'),
  ('business_development', 'crm.delete', 'company'),
  ('business_development', 'crm.edit', 'company'),
  ('business_development', 'crm.enrich', 'company'),
  ('business_development', 'crm.export', 'company'),
  ('business_development', 'crm.health', 'company'),
  ('business_development', 'crm.import', 'company'),
  ('business_development', 'crm.manageLists', 'company'),
  ('business_development', 'crm.proposal', 'company'),
  ('business_development', 'crm.proposalForOthers', 'company'),
  ('business_development', 'crm.view', 'company'),
  ('business_development', 'crm.viewGlobal', 'company'),
  ('business_development', 'crm.viewOthers', 'company'),
  ('business_development', 'entity.setOwn', 'company'),
  ('business_development', 'entity.viewAll', 'company'),
  ('business_development', 'finder.view', 'company'),
  ('business_development', 'fleetsmart.build', 'company'),
  ('business_development', 'fleetsmart.discount', 'company'),
  ('business_development', 'fleetsmart.send', 'company'),
  ('business_development', 'fleetsmart.view', 'company'),
  ('business_development', 'leads.create', 'company'),
  ('business_development', 'marketing.approve', 'company'),
  ('business_development', 'marketing.edit', 'company'),
  ('business_development', 'news.view', 'company'),
  ('business_development', 'reports.export', 'company'),
  ('business_development', 'reports.view', 'company'),
  ('business_development', 'revenue.export', 'company'),
  ('business_development', 'revenue.import', 'company'),
  ('business_development', 'revenue.view', 'company'),
  ('business_development', 'social.analytics', 'company'),
  ('business_development', 'social.analyticsExport', 'company'),
  ('business_development', 'social.approve', 'company'),
  ('business_development', 'social.approveOwn', 'company'),
  ('business_development', 'social.channels', 'company'),
  ('business_development', 'social.delete', 'company'),
  ('business_development', 'social.draft', 'company'),
  ('business_development', 'social.editAny', 'company'),
  ('business_development', 'social.library', 'company'),
  ('business_development', 'social.metricSets', 'company'),
  ('business_development', 'social.publishNow', 'company'),
  ('business_development', 'social.schedule', 'company'),
  ('business_development', 'social.tags', 'company'),
  ('business_development', 'social.templates', 'company'),
  ('business_development', 'social.view', 'company'),
  ('business_development', 'stock.edit', 'company'),
  ('business_development', 'stock.export', 'company'),
  ('business_development', 'stock.view', 'company'),
  ('business_development', 'tracker.view', 'company'),
  ('business_development', 'work.analytics', 'company'),
  ('business_development', 'work.approve', 'company'),
  ('business_development', 'work.assignDepartment', 'company'),
  ('business_development', 'work.assignOthers', 'company'),
  ('business_development', 'work.create', 'company'),
  ('business_development', 'work.decideRelease', 'company'),
  ('business_development', 'work.edit', 'company'),
  ('business_development', 'work.editAny', 'company'),
  ('business_development', 'work.manageProjects', 'company'),
  ('business_development', 'work.projects', 'company'),
  ('business_development', 'work.reassign', 'company'),
  ('business_development', 'work.requestRelease', 'company'),
  ('business_development', 'work.review', 'company'),
  ('business_development', 'work.setDue', 'company'),
  ('business_development', 'work.shareViews', 'company'),
  ('business_development', 'work.view', 'company'),
  ('business_development', 'work.viewAll', 'company'),
  ('business_development', 'work.viewDepartment', 'company'),
  ('business_development', 'work.views', 'company'),
  -- ---- Sr Sales (53) ----
  ('sr_sales', 'access.decide', 'company'),
  ('sr_sales', 'access.request', 'company'),
  ('sr_sales', 'analytics.view', 'company'),
  ('sr_sales', 'brand.view', 'company'),
  ('sr_sales', 'crm.assign', 'company'),
  ('sr_sales', 'crm.create', 'company'),
  ('sr_sales', 'crm.delegate', 'company'),
  ('sr_sales', 'crm.delete', 'company'),
  ('sr_sales', 'crm.edit', 'company'),
  ('sr_sales', 'crm.enrich', 'company'),
  ('sr_sales', 'crm.export', 'company'),
  ('sr_sales', 'crm.health', 'company'),
  ('sr_sales', 'crm.import', 'company'),
  ('sr_sales', 'crm.manageLists', 'company'),
  ('sr_sales', 'crm.proposal', 'company'),
  ('sr_sales', 'crm.proposalForOthers', 'company'),
  ('sr_sales', 'crm.view', 'company'),
  ('sr_sales', 'crm.viewGlobal', 'company'),
  ('sr_sales', 'crm.viewOthers', 'company'),
  ('sr_sales', 'entity.setOwn', 'company'),
  ('sr_sales', 'finder.view', 'company'),
  ('sr_sales', 'fleetsmart.build', 'company'),
  ('sr_sales', 'fleetsmart.discount', 'company'),
  ('sr_sales', 'fleetsmart.send', 'company'),
  ('sr_sales', 'fleetsmart.view', 'company'),
  ('sr_sales', 'leads.create', 'company'),
  ('sr_sales', 'news.view', 'company'),
  ('sr_sales', 'reports.export', 'company'),
  ('sr_sales', 'reports.view', 'company'),
  ('sr_sales', 'revenue.export', 'company'),
  ('sr_sales', 'revenue.import', 'company'),
  ('sr_sales', 'revenue.view', 'company'),
  ('sr_sales', 'social.view', 'company'),
  ('sr_sales', 'stock.edit', 'company'),
  ('sr_sales', 'stock.export', 'company'),
  ('sr_sales', 'stock.view', 'company'),
  ('sr_sales', 'tracker.view', 'company'),
  ('sr_sales', 'work.analytics', 'company'),
  ('sr_sales', 'work.approve', 'company'),
  ('sr_sales', 'work.assignDepartment', 'company'),
  ('sr_sales', 'work.assignOthers', 'company'),
  ('sr_sales', 'work.create', 'company'),
  ('sr_sales', 'work.decideRelease', 'company'),
  ('sr_sales', 'work.edit', 'company'),
  ('sr_sales', 'work.editAny', 'company'),
  ('sr_sales', 'work.reassign', 'company'),
  ('sr_sales', 'work.requestRelease', 'company'),
  ('sr_sales', 'work.review', 'company'),
  ('sr_sales', 'work.setDue', 'company'),
  ('sr_sales', 'work.view', 'company'),
  ('sr_sales', 'work.viewAll', 'company'),
  ('sr_sales', 'work.viewDepartment', 'company'),
  ('sr_sales', 'work.views', 'company'),
  -- ---- Sales (33) ----
  ('sales_rep', 'access.request', 'company'),
  ('sales_rep', 'analytics.view', 'company'),
  ('sales_rep', 'brand.view', 'company'),
  ('sales_rep', 'crm.assign', 'company'),
  ('sales_rep', 'crm.create', 'company'),
  ('sales_rep', 'crm.delegate', 'company'),
  ('sales_rep', 'crm.edit', 'company'),
  ('sales_rep', 'crm.enrich', 'company'),
  ('sales_rep', 'crm.health', 'company'),
  ('sales_rep', 'crm.manageLists', 'company'),
  ('sales_rep', 'crm.proposal', 'company'),
  ('sales_rep', 'crm.view', 'company'),
  ('sales_rep', 'crm.viewGlobal', 'company'),
  ('sales_rep', 'entity.setOwn', 'company'),
  ('sales_rep', 'finder.view', 'company'),
  ('sales_rep', 'fleetsmart.build', 'company'),
  ('sales_rep', 'fleetsmart.send', 'company'),
  ('sales_rep', 'fleetsmart.view', 'company'),
  ('sales_rep', 'leads.create', 'company'),
  ('sales_rep', 'news.view', 'company'),
  ('sales_rep', 'reports.export', 'company'),
  ('sales_rep', 'reports.view', 'company'),
  ('sales_rep', 'revenue.view', 'company'),
  ('sales_rep', 'social.view', 'company'),
  ('sales_rep', 'stock.edit', 'company'),
  ('sales_rep', 'stock.view', 'company'),
  ('sales_rep', 'tracker.view', 'company'),
  ('sales_rep', 'work.create', 'company'),
  ('sales_rep', 'work.edit', 'company'),
  ('sales_rep', 'work.requestRelease', 'company'),
  ('sales_rep', 'work.setDue', 'company'),
  ('sales_rep', 'work.view', 'company'),
  ('sales_rep', 'work.views', 'company'),
  -- ---- Sr Marketing (51) ----
  ('sr_marketing', 'access.decide', 'company'),
  ('sr_marketing', 'access.request', 'company'),
  ('sr_marketing', 'analytics.view', 'company'),
  ('sr_marketing', 'brand.manage', 'company'),
  ('sr_marketing', 'brand.view', 'company'),
  ('sr_marketing', 'crm.create', 'company'),
  ('sr_marketing', 'crm.delegate', 'company'),
  ('sr_marketing', 'crm.edit', 'company'),
  ('sr_marketing', 'crm.export', 'company'),
  ('sr_marketing', 'crm.health', 'company'),
  ('sr_marketing', 'crm.import', 'company'),
  ('sr_marketing', 'crm.manageLists', 'company'),
  ('sr_marketing', 'crm.proposal', 'company'),
  ('sr_marketing', 'crm.view', 'company'),
  ('sr_marketing', 'crm.viewGlobal', 'company'),
  ('sr_marketing', 'entity.setOwn', 'company'),
  ('sr_marketing', 'finder.view', 'company'),
  ('sr_marketing', 'marketing.approve', 'company'),
  ('sr_marketing', 'marketing.edit', 'company'),
  ('sr_marketing', 'news.view', 'company'),
  ('sr_marketing', 'reports.export', 'company'),
  ('sr_marketing', 'reports.view', 'company'),
  ('sr_marketing', 'revenue.export', 'company'),
  ('sr_marketing', 'revenue.import', 'company'),
  ('sr_marketing', 'revenue.view', 'company'),
  ('sr_marketing', 'social.analytics', 'company'),
  ('sr_marketing', 'social.analyticsExport', 'company'),
  ('sr_marketing', 'social.approve', 'company'),
  ('sr_marketing', 'social.approveOwn', 'company'),
  ('sr_marketing', 'social.channels', 'company'),
  ('sr_marketing', 'social.delete', 'company'),
  ('sr_marketing', 'social.draft', 'company'),
  ('sr_marketing', 'social.editAny', 'company'),
  ('sr_marketing', 'social.library', 'company'),
  ('sr_marketing', 'social.metricSets', 'company'),
  ('sr_marketing', 'social.publishNow', 'company'),
  ('sr_marketing', 'social.schedule', 'company'),
  ('sr_marketing', 'social.tags', 'company'),
  ('sr_marketing', 'social.templates', 'company'),
  ('sr_marketing', 'social.view', 'company'),
  ('sr_marketing', 'stock.export', 'company'),
  ('sr_marketing', 'work.approve', 'company'),
  ('sr_marketing', 'work.assignOthers', 'company'),
  ('sr_marketing', 'work.create', 'company'),
  ('sr_marketing', 'work.edit', 'company'),
  ('sr_marketing', 'work.requestRelease', 'company'),
  ('sr_marketing', 'work.review', 'company'),
  ('sr_marketing', 'work.setDue', 'company'),
  ('sr_marketing', 'work.view', 'company'),
  ('sr_marketing', 'work.viewDepartment', 'company'),
  ('sr_marketing', 'work.views', 'company'),
  -- ---- Marketing (32) ----
  ('marketing_exec', 'access.request', 'company'),
  ('marketing_exec', 'analytics.view', 'company'),
  ('marketing_exec', 'brand.view', 'company'),
  ('marketing_exec', 'crm.create', 'company'),
  ('marketing_exec', 'crm.delegate', 'company'),
  ('marketing_exec', 'crm.edit', 'company'),
  ('marketing_exec', 'crm.health', 'company'),
  ('marketing_exec', 'crm.manageLists', 'company'),
  ('marketing_exec', 'crm.proposal', 'company'),
  ('marketing_exec', 'crm.view', 'company'),
  ('marketing_exec', 'crm.viewGlobal', 'company'),
  ('marketing_exec', 'entity.setOwn', 'company'),
  ('marketing_exec', 'finder.view', 'company'),
  ('marketing_exec', 'marketing.edit', 'company'),
  ('marketing_exec', 'news.view', 'company'),
  ('marketing_exec', 'reports.view', 'company'),
  ('marketing_exec', 'revenue.view', 'company'),
  ('marketing_exec', 'social.analytics', 'company'),
  ('marketing_exec', 'social.draft', 'company'),
  ('marketing_exec', 'social.editAny', 'company'),
  ('marketing_exec', 'social.library', 'company'),
  ('marketing_exec', 'social.metricSets', 'company'),
  ('marketing_exec', 'social.schedule', 'company'),
  ('marketing_exec', 'social.tags', 'company'),
  ('marketing_exec', 'social.templates', 'company'),
  ('marketing_exec', 'social.view', 'company'),
  ('marketing_exec', 'work.create', 'company'),
  ('marketing_exec', 'work.edit', 'company'),
  ('marketing_exec', 'work.requestRelease', 'company'),
  ('marketing_exec', 'work.setDue', 'company'),
  ('marketing_exec', 'work.view', 'company'),
  ('marketing_exec', 'work.views', 'company'),
  -- ---- Sr Finance (69) ----
  ('sr_finance', 'access.decide', 'company'),
  ('sr_finance', 'access.request', 'company'),
  ('sr_finance', 'admin.audit', 'company'),
  ('sr_finance', 'admin.settings', 'company'),
  ('sr_finance', 'admin.users', 'company'),
  ('sr_finance', 'admin.usersDepartment', 'company'),
  ('sr_finance', 'analytics.targets', 'company'),
  ('sr_finance', 'analytics.view', 'company'),
  ('sr_finance', 'compliance.sensitive', 'company'),
  ('sr_finance', 'crm.assign', 'company'),
  ('sr_finance', 'crm.create', 'company'),
  ('sr_finance', 'crm.delegate', 'company'),
  ('sr_finance', 'crm.delete', 'company'),
  ('sr_finance', 'crm.edit', 'company'),
  ('sr_finance', 'crm.enrich', 'company'),
  ('sr_finance', 'crm.export', 'company'),
  ('sr_finance', 'crm.health', 'company'),
  ('sr_finance', 'crm.import', 'company'),
  ('sr_finance', 'crm.manageLists', 'company'),
  ('sr_finance', 'crm.proposal', 'company'),
  ('sr_finance', 'crm.proposalForOthers', 'company'),
  ('sr_finance', 'crm.view', 'company'),
  ('sr_finance', 'crm.viewGlobal', 'company'),
  ('sr_finance', 'crm.viewOthers', 'company'),
  ('sr_finance', 'entity.setOthers', 'company'),
  ('sr_finance', 'entity.setOwn', 'company'),
  ('sr_finance', 'entity.viewAll', 'company'),
  ('sr_finance', 'finder.view', 'company'),
  ('sr_finance', 'fleetsmart.build', 'company'),
  ('sr_finance', 'fleetsmart.discount', 'company'),
  ('sr_finance', 'fleetsmart.send', 'company'),
  ('sr_finance', 'fleetsmart.view', 'company'),
  ('sr_finance', 'leads.create', 'company'),
  ('sr_finance', 'reports.export', 'company'),
  ('sr_finance', 'reports.view', 'company'),
  ('sr_finance', 'revenue.export', 'company'),
  ('sr_finance', 'revenue.import', 'company'),
  ('sr_finance', 'revenue.view', 'company'),
  ('sr_finance', 'stock.edit', 'company'),
  ('sr_finance', 'stock.export', 'company'),
  ('sr_finance', 'stock.view', 'company'),
  ('sr_finance', 'tracker.view', 'company'),
  ('sr_finance', 'work.analytics', 'company'),
  ('sr_finance', 'work.analyticsAll', 'company'),
  ('sr_finance', 'work.approve', 'company'),
  ('sr_finance', 'work.assignDepartment', 'company'),
  ('sr_finance', 'work.assignOthers', 'company'),
  ('sr_finance', 'work.create', 'company'),
  ('sr_finance', 'work.decideRelease', 'company'),
  ('sr_finance', 'work.delete', 'company'),
  ('sr_finance', 'work.edit', 'company'),
  ('sr_finance', 'work.editAny', 'company'),
  ('sr_finance', 'work.forceRelease', 'company'),
  ('sr_finance', 'work.manageFields', 'company'),
  ('sr_finance', 'work.manageProjects', 'company'),
  ('sr_finance', 'work.manageSystemViews', 'company'),
  ('sr_finance', 'work.projects', 'company'),
  ('sr_finance', 'work.publishProject', 'company'),
  ('sr_finance', 'work.reassign', 'company'),
  ('sr_finance', 'work.requestRelease', 'company'),
  ('sr_finance', 'work.review', 'company'),
  ('sr_finance', 'work.rollback', 'company'),
  ('sr_finance', 'work.schedule', 'company'),
  ('sr_finance', 'work.setDue', 'company'),
  ('sr_finance', 'work.shareViews', 'company'),
  ('sr_finance', 'work.view', 'company'),
  ('sr_finance', 'work.viewAll', 'company'),
  ('sr_finance', 'work.viewDepartment', 'company'),
  ('sr_finance', 'work.views', 'company'),
  -- ---- Finance (28) ----
  ('finance', 'access.request', 'company'),
  ('finance', 'analytics.targets', 'company'),
  ('finance', 'analytics.view', 'company'),
  ('finance', 'crm.create', 'company'),
  ('finance', 'crm.delegate', 'company'),
  ('finance', 'crm.edit', 'company'),
  ('finance', 'crm.health', 'company'),
  ('finance', 'crm.manageLists', 'company'),
  ('finance', 'crm.proposal', 'company'),
  ('finance', 'crm.view', 'company'),
  ('finance', 'crm.viewGlobal', 'company'),
  ('finance', 'crm.viewOthers', 'company'),
  ('finance', 'entity.setOwn', 'company'),
  ('finance', 'finder.view', 'company'),
  ('finance', 'fleetsmart.view', 'company'),
  ('finance', 'reports.export', 'company'),
  ('finance', 'reports.view', 'company'),
  ('finance', 'revenue.export', 'company'),
  ('finance', 'revenue.import', 'company'),
  ('finance', 'revenue.view', 'company'),
  ('finance', 'stock.view', 'company'),
  ('finance', 'tracker.view', 'company'),
  ('finance', 'work.create', 'company'),
  ('finance', 'work.edit', 'company'),
  ('finance', 'work.requestRelease', 'company'),
  ('finance', 'work.setDue', 'company'),
  ('finance', 'work.view', 'company'),
  ('finance', 'work.views', 'company'),
  -- ---- Sr Admin (22) ----
  ('sr_office_admin', 'access.decide', 'company'),
  ('sr_office_admin', 'access.request', 'company'),
  ('sr_office_admin', 'crm.health', 'company'),
  ('sr_office_admin', 'crm.proposal', 'company'),
  ('sr_office_admin', 'crm.view', 'company'),
  ('sr_office_admin', 'crm.viewGlobal', 'company'),
  ('sr_office_admin', 'entity.setOwn', 'company'),
  ('sr_office_admin', 'finder.view', 'company'),
  ('sr_office_admin', 'fleetsmart.view', 'company'),
  ('sr_office_admin', 'reports.export', 'company'),
  ('sr_office_admin', 'reports.view', 'company'),
  ('sr_office_admin', 'revenue.export', 'company'),
  ('sr_office_admin', 'revenue.import', 'company'),
  ('sr_office_admin', 'revenue.view', 'company'),
  ('sr_office_admin', 'work.assignOthers', 'company'),
  ('sr_office_admin', 'work.create', 'company'),
  ('sr_office_admin', 'work.edit', 'company'),
  ('sr_office_admin', 'work.requestRelease', 'company'),
  ('sr_office_admin', 'work.setDue', 'company'),
  ('sr_office_admin', 'work.view', 'company'),
  ('sr_office_admin', 'work.viewDepartment', 'company'),
  ('sr_office_admin', 'work.views', 'company'),
  -- ---- Admin (16) ----
  ('office_admin', 'access.request', 'company'),
  ('office_admin', 'crm.health', 'company'),
  ('office_admin', 'crm.view', 'company'),
  ('office_admin', 'crm.viewGlobal', 'company'),
  ('office_admin', 'entity.setOwn', 'company'),
  ('office_admin', 'finder.view', 'company'),
  ('office_admin', 'fleetsmart.view', 'company'),
  ('office_admin', 'reports.view', 'company'),
  ('office_admin', 'revenue.import', 'company'),
  ('office_admin', 'revenue.view', 'company'),
  ('office_admin', 'work.create', 'company'),
  ('office_admin', 'work.edit', 'company'),
  ('office_admin', 'work.requestRelease', 'company'),
  ('office_admin', 'work.setDue', 'company'),
  ('office_admin', 'work.view', 'company'),
  ('office_admin', 'work.views', 'company')
  ) AS v(slug, capability, scope) ON v.slug = rt.slug
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
