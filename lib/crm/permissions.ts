/* =============================================================
   What a person can do in the CRM.

   The meeting was clear that this tab is not one interface shown to
   everyone. Dave sees his own portfolio. Gareth reads and touches
   nothing. Rama updates stock as if it were the spreadsheet and nothing
   else. Tom and Alex see the lot. The spec calls those Sales User,
   Read only viewer, Restricted updater and Admin.

   Two constraints shape this file.

   The admin panel is not built yet, so today a capability set is derived
   from `profiles.role`. That is a stopgap and it is written as one: the
   derivation lives in exactly one function, so when the panel arrives it
   overrides the derived set per user and nothing else in the CRM has to
   change.

   Permissions cannot come from Entra groups. Only IT can see Entra, and
   the CRM needs its own full admin control, so this stays the authority
   even after Microsoft sign in lands. Sign in answers who you are. This
   answers what you may do.

   Every capability is a question a screen actually asks. Nothing here is
   speculative, and a capability with no caller is a capability that
   should not exist.
   ============================================================= */
import type { Profile, UserRole } from '@/lib/types';

export type CrmCapability =
  /** See the CRM tab at all. */
  | 'crm.view'
  /** See the shared global pipeline, not just your own accounts. */
  | 'crm.viewGlobal'
  /** Look at a named colleague's portfolio. */
  | 'crm.viewOthers'
  /** Change contact fields. */
  | 'crm.edit'
  /** Create and delete contacts. */
  | 'crm.create'
  | 'crm.delete'
  /** Set the owner on an account, including handing it to somebody else. */
  | 'crm.assign'
  /** Make and share working lists. */
  | 'crm.manageLists'
  /** Raise a proposal from a contact record. */
  | 'crm.proposal'
  /** Raise one in a colleague's name, for when they are away. */
  | 'crm.proposalForOthers'
  /** Book a call or meeting into somebody else's diary. */
  | 'crm.delegate'
  /** Spend a Lusha credit. */
  | 'crm.enrich'
  /** Bulk data in and out. */
  | 'crm.import'
  | 'crm.export'
  /* ---- beyond the CRM tab ----
     The command bar reaches the whole product, so it needs to know what
     somebody may do outside this one screen. Kept here rather than in a
     second file, because two permission models is how they drift. */
  /** Manage the team: add people, change roles, set dashboards. */
  | 'admin.users'
  /** Trailer stock: add, edit, mark sold. */
  | 'stock.edit'
  /** Social planner and brand kit. */
  | 'marketing.edit'
  /** Approve social posts for publishing. */
  | 'marketing.approve';

export type CrmCapabilities = Set<CrmCapability>;

/**
 * The four roles the meeting named, expressed as capability sets.
 *
 * `sales` is the default working role: your own accounts, the shared
 * pipeline, full editing, and proposals in your own name. It can assign
 * an account and book into a colleague's diary, because both came
 * straight out of the meeting: claiming an unowned lead is everyday
 * work, and Dave taking a call while Dean is away and putting the
 * follow up in Dean's diary was the example given for delegation.
 *
 * What it does not get is reading a colleague's whole portfolio, or
 * raising a proposal in their name. Those are a manager's, which today
 * means admin.
 *
 * `viewer` is Gareth. Reads, exports, touches nothing.
 *
 * `marketer` is Rama's shape, and is the closest match the current role
 * column can express. She updates records and nothing else: no lists, no
 * proposals, no credit spending, no deleting. The genuinely restricted
 * version the meeting asked for needs the admin panel, because it is
 * scoped to stock rather than to a verb.
 */
const BY_ROLE: Record<UserRole, CrmCapability[]> = {
  admin: [
    'crm.view', 'crm.viewGlobal', 'crm.viewOthers', 'crm.edit', 'crm.create',
    'crm.delete', 'crm.assign', 'crm.manageLists', 'crm.proposal',
    'crm.proposalForOthers', 'crm.delegate', 'crm.enrich', 'crm.import', 'crm.export',
    'admin.users', 'stock.edit', 'marketing.edit', 'marketing.approve',
  ],
  sales: [
    'crm.view', 'crm.viewGlobal', 'crm.edit', 'crm.create', 'crm.delete',
    'crm.assign', 'crm.delegate', 'crm.manageLists', 'crm.proposal',
    'crm.enrich', 'crm.import', 'crm.export', 'stock.edit',
  ],
  marketer: [
    'crm.view', 'crm.viewGlobal', 'crm.edit', 'crm.export',
    'stock.edit', 'marketing.edit',
  ],
  viewer: [
    'crm.view', 'crm.viewGlobal', 'crm.export',
  ],
};

/**
 * Lusha, switched off at the door.
 *
 * The meeting asked for the company finder to be unclickable at rollout
 * until somebody decides a usage policy, because searches cost credits
 * out of a monthly allowance and one person exploring can spend the lot.
 * Tom named Dean; the point is that nobody should find out what a search
 * costs by accident.
 *
 * A single constant rather than a role change, because it is temporary
 * and it applies to everybody including admins. Set it to false to lift
 * the lock, and the per role capability sets take over again unchanged.
 * When the admin panel lands this becomes a stored setting, so somebody
 * can turn it on for the people who should have it without a deploy.
 */
export const LUSHA_LOCKED = true;

/**
 * The one place role becomes capability.
 *
 * When the admin panel lands it will store grants per user. Pass them in
 * as `overrides` and they win outright, so a person can be given or
 * denied a single capability without inventing a new role for them. That
 * is the whole point of the granular panel and this is the seam it plugs
 * into.
 */
export function capabilitiesFor(
  profile: Pick<Profile, 'role'>,
  overrides?: Partial<Record<CrmCapability, boolean>>,
): CrmCapabilities {
  const set = new Set<CrmCapability>(BY_ROLE[profile.role] ?? BY_ROLE.viewer);
  if (LUSHA_LOCKED) set.delete('crm.enrich');
  if (overrides) {
    for (const [cap, allowed] of Object.entries(overrides) as [CrmCapability, boolean][]) {
      if (allowed) set.add(cap); else set.delete(cap);
    }
  }
  return set;
}

export function can(caps: CrmCapabilities, cap: CrmCapability): boolean {
  return caps.has(cap);
}

/**
 * Where the CRM opens.
 *
 * Your own accounts, always, for anybody who works accounts. That was
 * asked for directly and it is also the right default: the global
 * pipeline is a few thousand rows of mostly other people's work, and
 * landing there every morning means scrolling past all of it to reach
 * the eight companies you actually owe a call.
 *
 * Somebody who cannot own accounts has no portfolio to open into, so
 * they get the shared pipeline instead.
 */
export function defaultScopeKind(caps: CrmCapabilities): 'mine' | 'all' {
  return caps.has('crm.edit') ? 'mine' : 'all';
}

/** Plain English for the header, so people can see what they are working as. */
export function roleLabel(role: UserRole): string {
  switch (role) {
    case 'admin': return 'Full access';
    case 'sales': return 'Sales';
    case 'marketer': return 'Restricted';
    case 'viewer': return 'Read only';
    default: return 'Read only';
  }
}
