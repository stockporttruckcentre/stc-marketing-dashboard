/* =============================================================
   The capability register, for the compiler.

   `supabase/migrations/048_capability_catalog.sql` is the register. It
   is a table rather than a constant for a reason the migration gives at
   length: the granular admin screen is the last thing built and has to
   render capabilities added after it shipped, which a compiled-in list
   cannot do.

   This file exists anyway, and it is deliberately a mirror rather than
   a source. TypeScript cannot narrow a string that only exists in a
   database, so without it every capability check in the application is
   `command_may('sociall.approve')` waiting to happen: a typo that
   compiles, deploys, and silently answers no forever.

   So the table is the register and this is the type. `check:catalog`
   asserts they cannot disagree, by reading the migration's own seed
   rather than by anybody remembering to update both.

   ---- Adding a capability ----

   1. Add it to the seed in the migration, or to a later migration.
   2. Add it here.
   3. `npm run check:catalog` proves the two agree.
   4. `npm run check:capabilities` proves the database answers for it
      the same way `command_may` does.

   Nothing here decides anything. What a person may do is answered by
   `command_may()` in the database, inside the same transaction as the
   write, which is the only place an answer cannot be bypassed by
   calling a different route.
   ============================================================= */

/** How much damage a capability can do, so a screen can say so. */
export type CapabilityDanger = 'routine' | 'sensitive' | 'destructive';

/**
 * How far a grant reaches. Mirrors the `capability_scope` domain in
 * migration 043, in the same order, widest first.
 */
export const SCOPES = [
  'company', 'department', 'team', 'project', 'assigned', 'own', 'specific',
] as const;
export type CapabilityScope = (typeof SCOPES)[number];

export type CapabilityEntry = {
  key: Capability;
  label: string;
  description: string;
  /** The section of the admin screen. */
  area: string;
  /** The panel within that section. */
  feature: string;
  danger: CapabilityDanger;
  /** Capabilities this one is meaningless without. */
  requires: readonly Capability[];
  /** Whether choosing a scope for this one means anything. */
  scoped: boolean;
  position: number;
};

/**
 * Every capability in the product.
 *
 * The union is written out rather than derived from the array, because
 * derived unions widen to `string` the moment somebody annotates the
 * array, and a union that has quietly become `string` is exactly the
 * typo this file exists to prevent.
 */
export type Capability =
  // ---- CRM ----
  | 'crm.view' | 'crm.viewGlobal' | 'crm.viewOthers'
  | 'crm.edit' | 'crm.create' | 'crm.delete' | 'crm.assign' | 'crm.manageLists'
  | 'crm.proposal' | 'crm.proposalForOthers' | 'crm.delegate'
  | 'crm.enrich' | 'crm.import' | 'crm.export'
  // ---- Stock ----
  | 'stock.edit'
  // ---- Content ----
  | 'social.view' | 'social.draft' | 'social.editAny' | 'social.templates' | 'social.tags'
  | 'social.schedule' | 'social.approve' | 'social.approveOwn' | 'social.publishNow'
  | 'social.delete' | 'social.channels' | 'social.library'
  | 'social.analytics' | 'social.metricSets' | 'social.analyticsExport'
  // ---- Content, the coarse pair these grew out of ----
  | 'marketing.edit' | 'marketing.approve'
  // ---- Work ----
  | 'work.view' | 'work.viewAll' | 'work.viewDepartment'
  | 'work.create' | 'work.assignOthers' | 'work.assignDepartment'
  | 'work.edit' | 'work.editAny' | 'work.reassign' | 'work.setDue' | 'work.delete'
  | 'work.requestRelease' | 'work.decideRelease' | 'work.forceRelease'
  | 'work.review' | 'work.approve'
  | 'work.projects' | 'work.manageProjects' | 'work.publishProject'
  | 'work.views' | 'work.shareViews' | 'work.manageFields' | 'work.manageSystemViews'
  | 'work.schedule' | 'work.rollback' | 'work.analytics' | 'work.analyticsAll'
  // ---- The company split, and the information barrier ----
  | 'entity.viewAll' | 'entity.setOwn' | 'entity.setOthers'
  | 'compliance.sensitive'
  // ---- FleetSmart+ ----
  | 'fleetsmart.view' | 'fleetsmart.build' | 'fleetsmart.discount' | 'fleetsmart.send'
  // ---- Administration ----
  | 'admin.users' | 'admin.settings' | 'admin.audit';

/* -------------------------------------------------------------
   The mirror.

   Kept in the migration's order so a diff between the two reads
   straight down. `check:catalog` compares them field by field.
   ------------------------------------------------------------- */
export const CAPABILITY_CATALOG = [
  // ---- CRM ----
  { key: 'crm.view', label: 'See the CRM', description: 'Open the CRM and see the organizations they are allowed to see.', area: 'CRM', feature: 'Access', danger: 'routine', requires: [], scoped: true, position: 10 },
  { key: 'crm.viewGlobal', label: 'See every organization', description: 'See the whole company list, not only their own accounts.', area: 'CRM', feature: 'Access', danger: 'routine', requires: ['crm.view'], scoped: false, position: 20 },
  { key: 'crm.viewOthers', label: "See a colleague's accounts", description: "Look at a named colleague's portfolio.", area: 'CRM', feature: 'Access', danger: 'sensitive', requires: ['crm.view'], scoped: false, position: 30 },
  { key: 'crm.edit', label: 'Change records', description: 'Edit fields on an organization or contact.', area: 'CRM', feature: 'Records', danger: 'routine', requires: ['crm.view'], scoped: true, position: 40 },
  { key: 'crm.create', label: 'Add records', description: 'Create new organizations and contacts.', area: 'CRM', feature: 'Records', danger: 'routine', requires: ['crm.view'], scoped: false, position: 50 },
  { key: 'crm.delete', label: 'Remove records', description: 'Delete an organization or contact. Deletion is recoverable, but it disappears from every list until somebody restores it.', area: 'CRM', feature: 'Records', danger: 'destructive', requires: ['crm.view'], scoped: true, position: 60 },
  { key: 'crm.assign', label: 'Change who owns an account', description: 'Hand an account to somebody else, including taking one from them.', area: 'CRM', feature: 'Records', danger: 'sensitive', requires: ['crm.view'], scoped: false, position: 70 },
  { key: 'crm.manageLists', label: 'Make and share lists', description: 'Create working lists and share them with other people.', area: 'CRM', feature: 'Records', danger: 'routine', requires: ['crm.view'], scoped: false, position: 80 },
  { key: 'crm.proposal', label: 'Raise a proposal', description: 'Generate a proposal document from a record.', area: 'CRM', feature: 'Documents', danger: 'routine', requires: ['crm.view'], scoped: false, position: 90 },
  { key: 'crm.proposalForOthers', label: 'Raise one for somebody else', description: "Raise a proposal in a colleague's name, for when they are away.", area: 'CRM', feature: 'Documents', danger: 'sensitive', requires: ['crm.proposal'], scoped: false, position: 100 },
  { key: 'crm.delegate', label: 'Book into another diary', description: "Put a call or meeting into somebody else's calendar.", area: 'CRM', feature: 'Documents', danger: 'sensitive', requires: ['crm.view'], scoped: false, position: 110 },
  { key: 'crm.enrich', label: 'Spend an enrichment credit', description: 'Look a company up through the paid data provider. Each lookup costs money from a shared allowance.', area: 'CRM', feature: 'Data', danger: 'sensitive', requires: ['crm.view'], scoped: false, position: 120 },
  { key: 'crm.import', label: 'Bring data in', description: 'Import records in bulk from a spreadsheet.', area: 'CRM', feature: 'Data', danger: 'sensitive', requires: ['crm.view'], scoped: false, position: 130 },
  { key: 'crm.export', label: 'Take data out', description: 'Export records to a file. Anything exported leaves the audit trail behind.', area: 'CRM', feature: 'Data', danger: 'sensitive', requires: ['crm.view'], scoped: false, position: 140 },

  // ---- Stock ----
  { key: 'stock.edit', label: 'Change stock', description: 'Edit the stock list.', area: 'Stock', feature: 'Records', danger: 'routine', requires: [], scoped: false, position: 10 },

  // ---- Content ----
  { key: 'social.view', label: 'Open Content', description: 'See the content planner, the calendar and the library.', area: 'Content', feature: 'Access', danger: 'routine', requires: [], scoped: true, position: 10 },
  { key: 'social.draft', label: 'Write drafts', description: 'Create and edit their own drafts. Nothing they write can go out on its own.', area: 'Content', feature: 'Writing', danger: 'routine', requires: ['social.view'], scoped: false, position: 20 },
  { key: 'social.editAny', label: "Edit anybody's draft", description: 'Change a draft somebody else wrote, including one already submitted for approval.', area: 'Content', feature: 'Writing', danger: 'sensitive', requires: ['social.view'], scoped: true, position: 30 },
  { key: 'social.templates', label: 'Manage templates', description: 'Create and change the templates everybody else starts from.', area: 'Content', feature: 'Writing', danger: 'routine', requires: ['social.view'], scoped: false, position: 40 },
  { key: 'social.tags', label: 'Manage tags', description: 'Create, rename and merge the tags used to organize and report on content.', area: 'Content', feature: 'Writing', danger: 'routine', requires: ['social.view'], scoped: false, position: 50 },
  { key: 'social.schedule', label: 'Schedule', description: 'Put content into the queue and choose when it goes out.', area: 'Content', feature: 'Publishing', danger: 'sensitive', requires: ['social.view'], scoped: false, position: 60 },
  { key: 'social.approve', label: 'Approve content', description: 'Approve or reject content so it can be scheduled. This is the gate before anything reaches the public.', area: 'Content', feature: 'Publishing', danger: 'sensitive', requires: ['social.view'], scoped: false, position: 70 },
  { key: 'social.approveOwn', label: 'Approve their own work', description: 'Approve content they wrote themselves. Off by default: an approval step that a person can grant themselves is not an approval step.', area: 'Content', feature: 'Publishing', danger: 'destructive', requires: ['social.approve'], scoped: false, position: 80 },
  { key: 'social.publishNow', label: 'Publish immediately', description: 'Send something out now, skipping the queue. There is no undo once a network has it.', area: 'Content', feature: 'Publishing', danger: 'destructive', requires: ['social.view'], scoped: false, position: 90 },
  { key: 'social.delete', label: 'Delete content', description: 'Remove a draft or a scheduled post. Published posts keep their record either way.', area: 'Content', feature: 'Publishing', danger: 'destructive', requires: ['social.view'], scoped: true, position: 100 },
  { key: 'social.channels', label: 'Manage channels', description: 'Connect and disconnect the accounts content goes out to, and change their posting slots.', area: 'Content', feature: 'Setup', danger: 'destructive', requires: ['social.view'], scoped: false, position: 110 },
  { key: 'social.library', label: 'Manage the library', description: 'Upload assets and change or remove the ones already there.', area: 'Content', feature: 'Setup', danger: 'routine', requires: ['social.view'], scoped: false, position: 120 },
  { key: 'social.analytics', label: 'See performance', description: 'See how content performed, per post and per channel.', area: 'Content', feature: 'Analytics', danger: 'routine', requires: ['social.view'], scoped: true, position: 130 },
  { key: 'social.metricSets', label: 'Build metric sets', description: 'Create and change the saved sets of metrics everybody reports on.', area: 'Content', feature: 'Analytics', danger: 'routine', requires: ['social.analytics'], scoped: false, position: 140 },
  { key: 'social.analyticsExport', label: 'Export reports', description: 'Download performance reports. Anything exported leaves the audit trail behind.', area: 'Content', feature: 'Analytics', danger: 'sensitive', requires: ['social.analytics'], scoped: false, position: 150 },

  // ---- Content, legacy ----
  { key: 'marketing.edit', label: 'Edit marketing content', description: 'The older, coarser permission. Kept so existing grants still resolve.', area: 'Content', feature: 'Legacy', danger: 'routine', requires: [], scoped: false, position: 900 },
  { key: 'marketing.approve', label: 'Approve marketing content', description: 'The older, coarser approval permission. Kept so existing grants still resolve.', area: 'Content', feature: 'Legacy', danger: 'sensitive', requires: [], scoped: false, position: 910 },

  // ---- Administration ----
  { key: 'admin.users', label: 'Manage people', description: 'Add people, change their role, and set what they can reach.', area: 'Admin', feature: 'People', danger: 'destructive', requires: [], scoped: false, position: 10 },
  { key: 'admin.settings', label: 'Change settings', description: 'Change what this installation is called, how it is branded, and how its pipelines are configured.', area: 'Admin', feature: 'Installation', danger: 'destructive', requires: [], scoped: false, position: 20 },
  // ---- Work ----
  { key: 'work.view', label: 'See the Work tab', description: 'Open Work and see the tasks they are allowed to see.', area: 'Work', feature: 'Access', danger: 'routine', requires: [], scoped: true, position: 10 },
  { key: 'work.viewAll', label: 'See everybody\'s work', description: 'See every task in the company, not only their own and their department\'s.', area: 'Work', feature: 'Access', danger: 'sensitive', requires: ['work.view'], scoped: false, position: 20 },
  { key: 'work.viewDepartment', label: 'See their department\'s work', description: 'See everything assigned to their own department.', area: 'Work', feature: 'Access', danger: 'routine', requires: ['work.view'], scoped: false, position: 30 },
  { key: 'work.create', label: 'Raise a task', description: 'Create work for themselves.', area: 'Work', feature: 'Tasks', danger: 'routine', requires: ['work.view'], scoped: false, position: 40 },
  { key: 'work.assignOthers', label: 'Assign work to a person', description: 'Put a task on somebody else. This is what makes them a delegator, and what the person receiving it can appeal to.', area: 'Work', feature: 'Tasks', danger: 'sensitive', requires: ['work.create'], scoped: false, position: 50 },
  { key: 'work.assignDepartment', label: 'Assign work to a department', description: 'Task a whole department rather than a named person, leaving the head of it to place it.', area: 'Work', feature: 'Tasks', danger: 'sensitive', requires: ['work.create'], scoped: false, position: 60 },
  { key: 'work.edit', label: 'Change a task', description: 'Edit the fields of a task they can see.', area: 'Work', feature: 'Tasks', danger: 'routine', requires: ['work.view'], scoped: true, position: 70 },
  { key: 'work.editAny', label: 'Change anybody\'s task', description: 'Edit a task they neither raised nor were assigned.', area: 'Work', feature: 'Tasks', danger: 'sensitive', requires: ['work.edit'], scoped: false, position: 80 },
  { key: 'work.reassign', label: 'Move work between people', description: 'Take a task off one person and give it to another.', area: 'Work', feature: 'Tasks', danger: 'sensitive', requires: ['work.edit'], scoped: false, position: 90 },
  { key: 'work.setDue', label: 'Change a due date', description: 'Move a deadline. Separate from editing because a date somebody else committed to is not an ordinary field.', area: 'Work', feature: 'Tasks', danger: 'sensitive', requires: ['work.edit'], scoped: false, position: 100 },
  { key: 'work.delete', label: 'Remove a task', description: 'Delete a task. Recoverable, but it leaves every list until somebody restores it.', area: 'Work', feature: 'Tasks', danger: 'destructive', requires: ['work.edit'], scoped: false, position: 110 },
  { key: 'work.requestRelease', label: 'Ask to be let off a task', description: 'Ask whoever assigned it to cancel it, pass it on, or move the date. Everybody who can be assigned work needs this.', area: 'Work', feature: 'Delegation', danger: 'routine', requires: ['work.view'], scoped: false, position: 120 },
  { key: 'work.decideRelease', label: 'Answer those requests', description: 'Grant or refuse a request to cancel, reassign or extend work they delegated.', area: 'Work', feature: 'Delegation', danger: 'sensitive', requires: ['work.assignOthers'], scoped: false, position: 130 },
  { key: 'work.forceRelease', label: 'Override a delegator', description: 'Decide a release request on somebody else\'s delegated task, for when the delegator has left or is away.', area: 'Work', feature: 'Delegation', danger: 'sensitive', requires: ['work.decideRelease'], scoped: false, position: 140 },
  { key: 'work.review', label: 'Review finished work', description: 'Accept or send back a task that is in review.', area: 'Work', feature: 'Approval', danger: 'routine', requires: ['work.view'], scoped: false, position: 150 },
  { key: 'work.approve', label: 'Approve work', description: 'Give the approval a task is waiting on.', area: 'Work', feature: 'Approval', danger: 'sensitive', requires: ['work.view'], scoped: false, position: 160 },
  { key: 'work.projects', label: 'See projects', description: 'Open the project, workstream and milestone structure.', area: 'Work', feature: 'Projects', danger: 'routine', requires: ['work.view'], scoped: false, position: 170 },
  { key: 'work.manageProjects', label: 'Run projects', description: 'Create and change projects, workstreams and milestones, and set project health.', area: 'Work', feature: 'Projects', danger: 'sensitive', requires: ['work.projects'], scoped: false, position: 180 },
  { key: 'work.publishProject', label: 'Put a project on the public tracker', description: 'Mark a project or milestone as publicly visible. What this exposes leaves the company.', area: 'Work', feature: 'Projects', danger: 'sensitive', requires: ['work.manageProjects'], scoped: false, position: 190 },
  { key: 'work.views', label: 'Build views', description: 'Make saved views of the work list, with their own grouping, filtering and columns.', area: 'Work', feature: 'Views', danger: 'routine', requires: ['work.view'], scoped: false, position: 200 },
  { key: 'work.shareViews', label: 'Share a view', description: 'Share a saved view with a person, a team or a whole department.', area: 'Work', feature: 'Views', danger: 'routine', requires: ['work.views'], scoped: false, position: 210 },
  { key: 'work.manageFields', label: 'Add custom fields', description: 'Define new fields on tasks, for the whole installation or for one project.', area: 'Work', feature: 'Views', danger: 'sensitive', requires: ['work.view'], scoped: false, position: 220 },
  { key: 'work.manageSystemViews', label: 'Change the built in views', description: 'Edit or reorder the views everybody starts with.', area: 'Work', feature: 'Views', danger: 'sensitive', requires: ['work.manageFields'], scoped: false, position: 230 },
  { key: 'work.schedule', label: 'Schedule recurring work', description: 'Set up work that repeats, and pause or end it.', area: 'Work', feature: 'Scheduling', danger: 'sensitive', requires: ['work.assignOthers'], scoped: false, position: 240 },
  { key: 'work.rollback', label: 'Undo a batch of work', description: 'Reverse a set of tasks created in one action, such as everything a call transcript proposed.', area: 'Work', feature: 'Scheduling', danger: 'destructive', requires: ['work.assignOthers'], scoped: false, position: 250 },
  { key: 'work.analytics', label: 'See work analytics', description: 'Throughput, cycle time, where work is stuck and who is carrying it.', area: 'Work', feature: 'Analysis', danger: 'routine', requires: ['work.view'], scoped: false, position: 260 },
  { key: 'work.analyticsAll', label: 'See analytics for everybody', description: 'The same figures across every department rather than their own.', area: 'Work', feature: 'Analysis', danger: 'sensitive', requires: ['work.analytics'], scoped: false, position: 270 },

  // ---- The company split, and the information barrier ----
  { key: 'compliance.sensitive', label: 'Read commercially sensitive information', description: 'Open records flagged as Commercially sensitive. This is the inside of the information barrier, and everyone holding it belongs on an insider list.', area: 'Compliance', feature: 'Information barrier', danger: 'sensitive', requires: [], scoped: false, position: 10 },
  { key: 'entity.viewAll', label: 'See both companies', description: 'See records belonging to every company in the group, whichever they work for. Auditors, the board, and whoever reconciles the two.', area: 'Compliance', feature: 'Company split', danger: 'sensitive', requires: [], scoped: false, position: 20 },
  { key: 'entity.setOwn', label: 'Choose their own company', description: 'Set which of the companies they work for in their own settings. Somebody who genuinely works for both should not need a ticket.', area: 'Compliance', feature: 'Company split', danger: 'routine', requires: [], scoped: false, position: 30 },
  { key: 'entity.setOthers', label: 'Set somebody else\'s company', description: 'Decide which companies a colleague belongs to. This is the control that decides what a new starter can see.', area: 'Compliance', feature: 'Company split', danger: 'sensitive', requires: [], scoped: false, position: 40 },

  // ---- FleetSmart+ ----
  { key: 'fleetsmart.view', label: 'See FleetSmart+ contracts', description: 'Open the FleetSmart+ tab and read the contracts on it, whoever built them.', area: 'FleetSmart+', feature: 'Contracts', danger: 'routine', requires: [], scoped: false, position: 10 },
  { key: 'fleetsmart.build', label: 'Build a contract', description: 'Price a fleet and save the result as a draft. The price comes off the rate card, so this is not the right to set a price.', area: 'FleetSmart+', feature: 'Contracts', danger: 'routine', requires: ['fleetsmart.view'], scoped: false, position: 20 },
  { key: 'fleetsmart.discount', label: 'Apply a manager\'s discount', description: 'Take a percentage off the whole contract before the promotional discount. The one number on the document that comes out of somebody else\'s margin.', area: 'FleetSmart+', feature: 'Contracts', danger: 'sensitive', requires: ['fleetsmart.build'], scoped: false, position: 30 },
  { key: 'fleetsmart.send', label: 'Send a contract to a customer', description: 'Mark a contract sent and record what went out. A price a customer has seen is a price they will hold you to.', area: 'FleetSmart+', feature: 'Contracts', danger: 'sensitive', requires: ['fleetsmart.build'], scoped: false, position: 40 },

  { key: 'admin.audit', label: 'Read the audit trail', description: 'Read the permanent record of who changed what, and generate insider lists from it.', area: 'Admin', feature: 'Compliance', danger: 'sensitive', requires: [], scoped: false, position: 30 },
] as const satisfies readonly CapabilityEntry[];

/* -------------------------------------------------------------
   The union and the array cannot disagree.

   Both directions, and at compile time rather than in a check, because
   a capability in the union that nothing lists is one the admin screen
   silently never offers, and a capability in the list that the union
   does not carry is one no call site can name.

   If this line stops compiling, the two lists above have drifted and
   the error names which way.
   ------------------------------------------------------------- */
type ListedCapability = (typeof CAPABILITY_CATALOG)[number]['key'];
type MissingFromList = Exclude<Capability, ListedCapability>;
type ListedButUntyped = Exclude<ListedCapability, Capability>;
const _capabilityListsAgree: [MissingFromList, ListedButUntyped] extends [never, never]
  ? true : ['capability lists have drifted', MissingFromList, ListedButUntyped] = true;
void _capabilityListsAgree;

/** The catalog as a plain array, for callers that sort, filter or map it. */
export const CAPABILITY_LIST: readonly CapabilityEntry[] = CAPABILITY_CATALOG;

/** Keyed, for the lookups a screen does per row. */
export const CAPABILITY_BY_KEY: Record<Capability, CapabilityEntry> =
  Object.fromEntries(CAPABILITY_LIST.map((c) => [c.key, c])) as Record<Capability, CapabilityEntry>;

/**
 * The areas, in the order the admin screen shows them.
 *
 * Explicit rather than alphabetical: Admin belongs at the bottom
 * because it is the one somebody scrolls past on the way to what they
 * came for, and putting the dangerous section first invites a mis-click.
 */
export const AREA_ORDER = ['CRM', 'Work', 'Content', 'Stock', 'Compliance', 'Admin'] as const;

export function capabilitiesByArea(): { area: string; features: { feature: string; items: CapabilityEntry[] }[] }[] {
  const areas = [...new Set(CAPABILITY_LIST.map((c) => c.area))].sort(
    (a, b) => AREA_ORDER.indexOf(a as never) - AREA_ORDER.indexOf(b as never),
  );
  return areas.map((area) => {
    const inArea = CAPABILITY_LIST.filter((c) => c.area === area).sort((a, b) => a.position - b.position);
    const features = [...new Set(inArea.map((c) => c.feature))];
    return { area, features: features.map((feature) => ({ feature, items: inArea.filter((c) => c.feature === feature) })) };
  });
}

/**
 * Everything a capability needs in order to be worth anything.
 *
 * Transitive, because `social.metricSets` needs `social.analytics`
 * which needs `social.view`, and a screen that granted only the first
 * two would produce somebody who holds a capability they cannot reach.
 */
export function prerequisitesOf(key: Capability): Capability[] {
  const out: Capability[] = [];
  const walk = (k: Capability, depth: number) => {
    if (depth > 10) return;
    for (const r of CAPABILITY_BY_KEY[k]?.requires ?? []) {
      if (!out.includes(r)) { out.push(r); walk(r, depth + 1); }
    }
  };
  walk(key, 0);
  return out;
}

/** What a screen holds after resolving somebody's grants. */
export type Capabilities = Set<Capability>;

export function holds(caps: Capabilities, cap: Capability): boolean {
  return caps.has(cap);
}

/**
 * Whether a scope reaches at least as far as another.
 *
 * Mirrors `scope_rank` in migration 043. Used for the sentence a screen
 * shows next to a grant, never to decide a write: that is the
 * database's job, in the same transaction as the write.
 */
export function scopeReaches(held: CapabilityScope | null, needed: CapabilityScope): boolean {
  if (!held) return false;
  return SCOPES.indexOf(held) <= SCOPES.indexOf(needed);
}
