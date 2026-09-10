import type { Capability } from './catalog';

/* =============================================================
   Who does what at Stockport Truck Centre.

   Eleven roles, written down once, in the words the business used:

     Read only - this can go.
     Admin - this is for our admin users (nothing to do with
     Administrator in the app) who manage our company admin ...
     Sr Admin - this is the same but gives full access to the revenue
     tab ... MD - access to the entire app.

   ---- Why these are role TEMPLATES and not new roles ----

   `profiles.role` is four values wide and is read by name all over the
   application. Adding eight more to it would mean every existing
   `role = 'admin'` becomes ambiguous the moment "Admin" also means the
   office administrators, which is a different job from the one that
   column has meant since the first migration.

   `command_may` already resolves in three layers, and the second one is
   exactly this:

     1. a per user override
     2. the person's role TEMPLATE
     3. the legacy role seed, for anybody who has no template yet

   So a role here is a template. The `role` column stays where it is and
   goes on answering for accounts nobody has moved yet, which is what
   layer three is for. Administrator keeps its name in that column and
   is presented as Managing Director, which is what the business asked
   for: "Administrator role can be renamed to Managing Director so we
   don't have to delete it".

   ---- The rule the seniority follows ----

   From the business:

     An issue in our industry is a sales person joining a company,
     exporting their crm and stock, then leaving the company. We can't
     risk that but Sr Sales can have access ... Use logic to think
     "what should a Sr be able to do that the users they're in charge
     of cannot - such as a large import of data or something that
     requires approval first".

   So the line between a role and its senior is drawn in one place and
   it is always the same three things:

     TAKING DATA OUT      export of the CRM, the stock list, revenue
     PUTTING DATA IN      bulk import, which overwrites what is there
     LETTING SOMEBODY     approving a post, a discount, a request

   Everything else, the daily work, is the same for both. A senior is
   not a person who can do more work, it is the person who signs off
   the three things that are hard to undo.

   ---- Nothing here decides anything ----

   This file is the type and the intent. What somebody may actually do
   is answered by `command_may()` in the database, inside the same
   transaction as the write. `npm run check:roles` proves the migration
   that seeds those templates says exactly what this file says.
   ============================================================= */

export const ROLE_SLUGS = [
  'developer', 'managing_director', 'business_development',
  'sr_sales', 'sales_rep',
  'sr_marketing', 'marketing_exec',
  'sr_finance', 'finance',
  'sr_office_admin', 'office_admin',
] as const;

export type RoleSlug = (typeof ROLE_SLUGS)[number];

/**
 * The parts of the business, as the sidebar divides them.
 *
 * `exec` is not a department anybody works in. It is the three roles
 * that are not inside one: the MD, the developer, and Tom, who runs two
 * of the others.
 */
export const DEPARTMENTS = ['sales', 'marketing', 'finance', 'admin', 'exec'] as const;
export type Department = (typeof DEPARTMENTS)[number];

export type RoleTemplate = {
  slug: RoleSlug;
  name: string;
  description: string;
  /** Who signs off what this role is refused. Null where nothing is. */
  escalatesTo: RoleSlug | null;
  /** Which part of the business somebody on this role works in. */
  department: Department;
  /**
   * Which departments this role RUNS.
   *
   * From the business, about Tom: "he manages sales and marketing
   * departments. He needs everything they have and ways of managing
   * them." So this is what `admin.usersDepartment` reaches, and it is
   * also what decides who hears about a red account: "Account owner, Sr
   * Sales and BD", which is the owner plus everybody who runs sales.
   *
   * Written here rather than as a list of slugs in a migration, because
   * a list of slugs stops being right the first time somebody adds a
   * role and nothing tells them.
   */
  manages: readonly Department[];
  sort: number;
  capabilities: readonly Capability[];
};

/* -------------------------------------------------------------
   The building blocks

   Written as sets rather than repeated per role, because the same
   sentence appearing in eleven places is eleven places to forget one.
   ------------------------------------------------------------- */

/** Everybody signed in gets these. The dashboard, their own diary, their own work. */
const OWN_WORK: Capability[] = [
  'work.view', 'work.create', 'work.edit', 'work.setDue',
  'work.views', 'work.requestRelease', 'entity.setOwn',
];

/** Seeing the CRM and keeping it up to date. No taking it out, no bulk in. */
const CRM_DAILY: Capability[] = [
  'crm.view', 'crm.viewGlobal', 'crm.edit', 'crm.create', 'crm.health',
  'crm.manageLists', 'crm.proposal', 'crm.delegate',
];

/** The three things a senior signs off, gathered so the diff is one line. */
const TAKES_DATA_OUT: Capability[] = ['crm.export', 'stock.export', 'revenue.export', 'reports.export'];
const PUTS_DATA_IN: Capability[] = ['crm.import', 'revenue.import'];

/** The marketing section of the sidebar, at the level that runs it. */
const MARKETING_DOES: Capability[] = [
  'social.view', 'social.draft', 'social.editAny', 'social.templates', 'social.tags',
  'social.schedule', 'social.library', 'social.analytics', 'social.metricSets',
  'brand.view', 'news.view', 'marketing.edit',
];

/** What only the senior marketer adds: letting work out of the door. */
const MARKETING_SIGNS_OFF: Capability[] = [
  'social.approve', 'social.approveOwn', 'social.publishNow', 'social.delete',
  'social.channels', 'social.analyticsExport', 'brand.manage', 'marketing.approve',
];

/** The sales section, at the level that works it. */
const SALES_DOES: Capability[] = [
  ...CRM_DAILY, 'crm.assign', 'crm.enrich', 'leads.create', 'tracker.view',
  'finder.view', 'stock.view', 'stock.edit', 'revenue.view',
  'fleetsmart.view', 'fleetsmart.build', 'fleetsmart.send',
  'reports.view', 'analytics.view',
];

/** Overseeing people: seeing their work and deciding what they ask for. */
const OVERSEES: Capability[] = [
  'crm.viewOthers', 'crm.proposalForOthers', 'work.viewDepartment', 'work.viewAll',
  'work.assignOthers', 'work.assignDepartment', 'work.editAny', 'work.reassign',
  'work.review', 'work.approve', 'work.decideRelease', 'work.analytics',
  'access.decide',
];

/** Everything in the catalogue. Used by the two roles that get it all. */
const EVERYTHING: Capability[] = [
  'crm.view', 'crm.viewGlobal', 'crm.viewOthers', 'crm.health', 'analytics.targets',
  'crm.edit', 'crm.create', 'crm.delete', 'crm.assign', 'crm.manageLists',
  'crm.proposal', 'crm.proposalForOthers', 'crm.delegate',
  'crm.enrich', 'crm.import', 'crm.export', 'leads.create',
  'stock.edit', 'stock.view', 'stock.export',
  'social.view', 'social.draft', 'social.editAny', 'social.templates', 'social.tags',
  'social.schedule', 'social.approve', 'social.approveOwn', 'social.publishNow',
  'social.delete', 'social.channels', 'social.library',
  'social.analytics', 'social.metricSets', 'social.analyticsExport',
  'marketing.edit', 'marketing.approve', 'brand.view', 'brand.manage', 'news.view',
  'work.view', 'work.viewAll', 'work.viewDepartment',
  'work.create', 'work.assignOthers', 'work.assignDepartment',
  'work.edit', 'work.editAny', 'work.reassign', 'work.setDue', 'work.delete',
  'work.requestRelease', 'work.decideRelease', 'work.forceRelease',
  'work.review', 'work.approve',
  'work.projects', 'work.manageProjects', 'work.publishProject',
  'work.views', 'work.shareViews', 'work.manageFields', 'work.manageSystemViews',
  'work.schedule', 'work.rollback', 'work.analytics', 'work.analyticsAll',
  'entity.viewAll', 'entity.setOwn', 'entity.setOthers', 'compliance.sensitive',
  'fleetsmart.view', 'fleetsmart.build', 'fleetsmart.discount', 'fleetsmart.send',
  'analytics.view', 'reports.view', 'reports.export',
  'revenue.view', 'revenue.import', 'revenue.export',
  'tracker.view', 'finder.view',
  'admin.users', 'admin.roles', 'admin.usersDepartment', 'admin.settings', 'admin.audit',
  'access.request', 'access.decide',
];

/** Everything except the Marketing section of the sidebar. */
const MARKETING_SECTION: Capability[] = [
  ...MARKETING_DOES, ...MARKETING_SIGNS_OFF, 'social.approveOwn',
];

const without = (all: Capability[], drop: Capability[]): Capability[] =>
  all.filter((c) => !drop.includes(c));

const set = (...groups: Capability[][]): Capability[] =>
  [...new Set(groups.flat())].sort();

/* -------------------------------------------------------------
   The eleven
   ------------------------------------------------------------- */
export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    slug: 'developer',
    name: 'Developer',
    description: 'Access to the entire app, including settings and the audit trail.',
    escalatesTo: null,
    department: 'exec',
    manages: ['sales', 'marketing', 'finance', 'admin', 'exec'],
    sort: 1,
    capabilities: set(EVERYTHING),
  },
  {
    slug: 'managing_director',
    name: 'Managing Director',
    description: 'Access to the entire app.',
    escalatesTo: null,
    department: 'exec',
    manages: ['sales', 'marketing', 'finance', 'admin', 'exec'],
    sort: 2,
    capabilities: set(EVERYTHING),
  },
  {
    /* From the business: "this is tom's role, he manages sales and
       marketing departments. He needs everything they have and ways of
       managing them."

       So: everything both senior roles have, plus the overseeing set,
       plus user management SCOPED TO HIS OWN DEPARTMENTS. That last one
       is `admin.usersDepartment` rather than `admin.users`: he can move
       a salesperson or a marketer between roles and cannot touch
       finance, the office administrators or a director. */
    slug: 'business_development',
    name: 'Business Development',
    description: 'Runs sales and marketing. Everything both departments have, '
      + 'the approvals over them, and their accounts.',
    escalatesTo: 'managing_director',
    department: 'exec',
    manages: ['sales', 'marketing'],
    sort: 3,
    capabilities: set(
      OWN_WORK, SALES_DOES, MARKETING_DOES, MARKETING_SIGNS_OFF, OVERSEES,
      TAKES_DATA_OUT, PUTS_DATA_IN,
      ['crm.delete', 'fleetsmart.discount', 'analytics.targets',
       'admin.usersDepartment', 'entity.viewAll', 'work.projects',
       'work.manageProjects', 'work.shareViews', 'access.request'],
    ),
  },

  // ---- Sales ----
  {
    /* From the business: "the only difference here is that they're the
       sales overseer, so like when you mark a crm customer as red it'll
       alert Sr Sales etc."

       And the industry risk, in their words: "a sales person joining a
       company, exporting their crm and stock, then leaving the company.
       We can't risk that but Sr Sales can have access." */
    slug: 'sr_sales',
    name: 'Sr Sales',
    description: 'Everything a salesperson does, plus the exports, the bulk imports, '
      + 'the manager discount and the decisions on what the team asks for.',
    escalatesTo: 'business_development',
    department: 'sales',
    manages: ['sales'],
    sort: 4,
    capabilities: set(
      OWN_WORK, SALES_DOES, OVERSEES, TAKES_DATA_OUT, PUTS_DATA_IN,
      ['social.view', 'brand.view', 'news.view', 'crm.delete',
       'fleetsmart.discount', 'access.request'],
    ),
  },
  {
    /* From the business, describing Dean: "Dean can add a customer,
       create a lead, update the lead, create a contract and make it
       live, manage and add stock but not export it all, he can manage
       his workload and diary, run reports to send to Tom, can see
       what's set to be posted on socials in case they want to advertise
       some stock but they can't manage the posts as they're not Sr
       Marketing. They can grab a colour from the brand kit if they need
       it but can't manage them."

       Every clause of that is a line below. `social.view` and
       `brand.view` without the managing pair are "can see" and "can
       grab a colour". No export of any kind, which is the whole point
       of the role. */
    slug: 'sales_rep',
    name: 'Sales',
    description: 'The full sales desk: customers, leads, contracts, stock and reports. '
      + 'Exports and bulk imports go to Sr Sales.',
    escalatesTo: 'sr_sales',
    department: 'sales',
    manages: [],
    sort: 5,
    capabilities: set(
      OWN_WORK, SALES_DOES,
      ['social.view', 'brand.view', 'news.view', 'reports.export', 'access.request'],
    ),
  },

  // ---- Marketing ----
  {
    slug: 'sr_marketing',
    name: 'Sr Marketing',
    description: 'Runs marketing. Approves posts, manages the brand kit, and can take '
      + 'data out of the CRM and put it back in.',
    escalatesTo: 'business_development',
    department: 'marketing',
    manages: ['marketing'],
    sort: 6,
    capabilities: set(
      OWN_WORK, CRM_DAILY, MARKETING_DOES, MARKETING_SIGNS_OFF,
      TAKES_DATA_OUT, PUTS_DATA_IN,
      ['revenue.view', 'reports.view', 'analytics.view', 'finder.view',
       'work.viewDepartment', 'work.assignOthers', 'work.review', 'work.approve',
       'access.decide', 'access.request'],
    ),
  },
  {
    /* From the business: "access to all the marketing section, no
       trailer sales access, no sales tracker (but can see leads in crm
       records), access to revenue entirely but cannot export/import,
       full access within marketing aside from people able to approve
       posts or add brand kit assets. Cannot export from the CRM, cannot
       import to CRM but can create records, cannot create leads."

       So `crm.create` yes and `leads.create` no, which is why those are
       two capabilities rather than one. No `tracker.view`, no
       `stock.view`. `revenue.view` and neither of its two verbs. */
    slug: 'marketing_exec',
    name: 'Marketing',
    description: 'The whole marketing section, short of approving posts and managing '
      + 'the brand kit. Can create CRM records but not leads, and cannot '
      + 'take data out or bring it in.',
    escalatesTo: 'sr_marketing',
    department: 'marketing',
    manages: [],
    sort: 7,
    capabilities: set(
      OWN_WORK, CRM_DAILY, MARKETING_DOES,
      ['revenue.view', 'reports.view', 'analytics.view', 'finder.view', 'access.request'],
    ),
  },

  // ---- Finance ----
  {
    /* From the business: "this is financial director level, he'll need
       full access across the app but doesn't need anything in the
       Marketing section of the global sidebar." */
    slug: 'sr_finance',
    name: 'Sr Finance',
    description: 'Financial director. The whole application except the Marketing section.',
    escalatesTo: 'managing_director',
    department: 'finance',
    manages: ['finance', 'admin'],
    sort: 8,
    capabilities: set(without(EVERYTHING, MARKETING_SECTION)),
  },
  {
    /* From the business: "can see dashboard, analytics, all of reports,
       work, diary, crm, company finder, trailer sales, fleetsmart+, all
       of revenue, team." */
    slug: 'finance',
    name: 'Finance',
    description: 'Dashboard, analytics, every report, the CRM, the finder, trailer sales, '
      + 'FleetSmart+ and all of revenue.',
    escalatesTo: 'sr_finance',
    department: 'finance',
    manages: [],
    sort: 9,
    capabilities: set(
      OWN_WORK, CRM_DAILY,
      ['analytics.view', 'reports.view', 'reports.export',
       'revenue.view', 'revenue.import', 'revenue.export',
       'finder.view', 'stock.view', 'fleetsmart.view',
       'tracker.view', 'crm.viewOthers', 'analytics.targets', 'access.request'],
    ),
  },

  // ---- The office administrators ----
  {
    /* From the business: "this is the same but gives full access to the
       revenue tab. They can export reports, not just view them (have a
       hover-over 'ask your department lead to run this' for regular
       admin users). This will be for the person in charge of the admin
       team." */
    slug: 'sr_office_admin',
    name: 'Sr Admin',
    description: 'Runs the admin team. Everything an administrator does, plus taking '
      + 'revenue and reports out.',
    escalatesTo: 'managing_director',
    department: 'admin',
    manages: ['admin'],
    sort: 10,
    capabilities: set(
      OWN_WORK,
      ['crm.view', 'crm.viewGlobal', 'crm.health', 'crm.proposal',
       'reports.view', 'reports.export',
       'revenue.view', 'revenue.import', 'revenue.export',
       'finder.view', 'fleetsmart.view',
       'work.viewDepartment', 'work.assignOthers', 'access.decide', 'access.request'],
    ),
  },
  {
    /* From the business: "this is for our admin users (nothing to do
       with Administrator in the app) who manage our company admin.
       They'll need access to run reports, see the revenue tab entirely
       and import but no export, see team page, use company finder, see
       CRM pipeline, see Fleetsmart, access their own diary and work and
       dashboard. No analytics tab. That's about it."

       Read literally, and that is deliberate. This role is the one a
       shared login sits on, so it is the one to be tight with: adding
       a capability later is a line in a migration, and finding out
       afterwards that a shared account could export the CRM is not
       recoverable. `crm.health` is the one addition, because whoever
       takes the call about a late trailer has to be able to record it.

       No `analytics.view`, which is why that capability exists at all:
       Analytics and Reports both gated on `crm.view` until now, so
       there was no way to give one and withhold the other. */
    slug: 'office_admin',
    name: 'Admin',
    description: 'The company administrators. Reports, the whole revenue tab and its '
      + 'imports, the finder, the CRM pipeline and FleetSmart+. No analytics, '
      + 'and exports go to Sr Admin.',
    escalatesTo: 'sr_office_admin',
    department: 'admin',
    manages: [],
    sort: 11,
    capabilities: set(
      OWN_WORK,
      ['crm.view', 'crm.viewGlobal', 'crm.health',
       'reports.view',
       'revenue.view', 'revenue.import',
       'finder.view', 'fleetsmart.view', 'access.request'],
    ),
  },
];

/** One by slug, for a screen that has to say what somebody holds. */
export const ROLE_BY_SLUG: Record<RoleSlug, RoleTemplate> =
  Object.fromEntries(ROLE_TEMPLATES.map((r) => [r.slug, r])) as Record<RoleSlug, RoleTemplate>;

/**
 * Who to ask, for a capability this person does not hold.
 *
 * From the business: "ensure the button states reflect this across the
 * accounts, that one user understand why they don't have access and who
 * to contact to perform that task."
 *
 * So a refusal names a role rather than a person: people leave, and a
 * button that names somebody who left is worse than one that names
 * nobody. The Team screen turns the role into the person holding it.
 */
export function escalationFor(slug: RoleSlug, capability: Capability): RoleSlug | null {
  const role = ROLE_BY_SLUG[slug];
  if (!role || role.capabilities.includes(capability)) return null;

  let at: RoleSlug | null = role.escalatesTo;
  const seen = new Set<RoleSlug>([slug]);
  while (at && !seen.has(at)) {
    seen.add(at);
    const up: RoleTemplate | undefined = ROLE_BY_SLUG[at];
    if (!up) return null;
    if (up.capabilities.includes(capability)) return at;
    at = up.escalatesTo;
  }
  return null;
}
