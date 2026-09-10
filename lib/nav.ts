import type { CrmCapability } from '@/lib/crm/permissions';

/* =============================================================
   Where every screen sits in the product, stated once.

   The sidebar had one hardcoded list and the breadcrumb had another,
   and they had already drifted: the breadcrumb map was missing
   FleetSmart+ and Notifications among others, so those screens told
   you that you were on the Dashboard when you were not. Two lists of
   the same thing is one list and a bug waiting to be noticed.

   ---- Why the icon is a string ----

   A React component cannot go in a database, and this is the shape of
   thing that ends up in one: which screens exist, in what order, under
   what heading, is configuration rather than code. The component that
   draws the sidebar owns the name to component map and resolves it.

   ---- Why capability and not role ----

   This is the change worth having. Gating a row on a list of roles is
   why turning a permission off changed what somebody could DO and not
   what they could SEE: the screen stayed in their sidebar, they
   clicked it, and the page refused them. Gating on the same capability
   the API route and the command bar already ask about means one toggle
   takes a screen out of all three at once.

   `capability: null` means everybody signed in, and it is deliberate on
   exactly four items: the dashboard, the diary, settings and the team
   directory. Nobody withholds somebody their own diary or their own
   password, and a phone list only an administrator can open is not a
   phone list.
   ============================================================= */

export type NavIcon =
  | 'dashboard' | 'analytics' | 'work' | 'diary' | 'news' | 'reports'
  | 'crm' | 'tracker' | 'finder' | 'stock' | 'fleetsmart'
  | 'social' | 'brand' | 'revenue'
  | 'team' | 'settings' | 'admin';

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  /** Null means everybody signed in. */
  capability: CrmCapability | null;
  /**
   * Any one of these is enough to see the row, instead of `capability`.
   * For a screen whose tabs are gated separately, so two different jobs
   * reach it and each finds only their own half.
   */
  anyOf?: CrmCapability[];
  /** Which live count sits on the right of the row. */
  badge?: 'content';
  /** Off the sidebar, still routed and still reachable by name. */
  hidden?: boolean;
  /** When the breadcrumb should read differently from the row. */
  crumb?: string;
  /**
   * Rows that open underneath this one.
   *
   * Revenue is two screens, one per division, and they cannot be two
   * top level rows: STC and S&L are the same question asked of two
   * systems, and a sidebar that lists them apart invites somebody to
   * read one as the company. Nested, the parent names the subject and
   * the children name the division.
   *
   * S&L is not called S&L Rental any more, because it is not only
   * rental: "the tab covers trailer sales and rentals". There may be a
   * third row for trailer sales later, which is a row and a page and
   * nothing here has to move for it.
   *
   * A child is a NavItem in its own right, so it carries its own
   * capability and its own breadcrumb, and `NAV_ITEMS` flattens them.
   */
  children?: NavItem[];
};

export type NavSection = {
  key: string;
  label: string;
  items: NavItem[];
  /** Drawn under the scroll rather than in it. */
  atFoot?: boolean;
};

export const NAVIGATION: NavSection[] = [
  {
    key: 'workspace', label: 'Workspace',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: 'dashboard', capability: null },
      { href: '/dashboard/analytics', label: 'Analytics', icon: 'analytics', capability: 'analytics.view' },
      /* Directly under Analytics, which is where the business put it
         once they had looked at it:

           place it on sidebar below Analytics

         It reads as the right pair. Analytics is the screen you go to
         when you want to know something; Reports is the screen you go to
         when somebody else needs to know it. Same figures, one on a
         screen and one on paper.

         It was `hidden` while a demonstration was running and it is not
         any more. */
      { href: '/dashboard/reports', label: 'Reports', icon: 'reports', capability: 'reports.view' },
      { href: '/dashboard/work', label: 'Work', icon: 'work', capability: 'work.view' },
      { href: '/dashboard/calendar', label: 'Diary', icon: 'diary', capability: null },
    ],
  },
  {
    key: 'sales', label: 'Sales',
    items: [
      { href: '/dashboard/crm', label: 'CRM portfolio', icon: 'crm', capability: 'crm.view' },
      { href: '/dashboard/leads', label: 'Sales tracker', icon: 'tracker', capability: 'tracker.view' },
      { href: '/dashboard/finder', label: 'Company finder', icon: 'finder', capability: 'finder.view' },
      { href: '/dashboard/sales', label: 'Trailer sales', icon: 'stock', capability: 'stock.view' },
      { href: '/dashboard/fleetsmart', label: 'FleetSmart+', icon: 'fleetsmart', capability: 'fleetsmart.view' },
      {
        href: '/dashboard/revenue', label: 'Revenue', icon: 'revenue', capability: 'revenue.view',
        /* Three divisions, one per row, which is what the business
           asked for and what `divisions` has held since migration 083.
           S&L covered trailer sales and rentals together and could not
           answer either question on its own. */
        children: [
          { href: '/dashboard/revenue/stc', label: 'STC', icon: 'revenue', capability: 'revenue.view', crumb: 'STC revenue' },
          { href: '/dashboard/revenue/trailer', label: 'Trailer Sales', icon: 'revenue', capability: 'revenue.view', crumb: 'Trailer sales revenue' },
          { href: '/dashboard/revenue/rental', label: 'Rentals', icon: 'revenue', capability: 'revenue.view', crumb: 'Rental revenue' },
        ],
      },
    ],
  },
  {
    key: 'marketing', label: 'Marketing',
    items: [
      { href: '/dashboard/social', label: 'Social planner', icon: 'social', capability: 'social.view', badge: 'content' },
      { href: '/dashboard/brand', label: 'Brand kit', icon: 'brand', capability: 'brand.view' },
      /* Moved out of Workspace. What the trade press is saying is
         something marketing reads and acts on, not a thing everybody
         passes on their way to their own work. */
      { href: '/dashboard/news', label: 'Industry news', icon: 'news', capability: 'news.view' },
    ],
  },
  {
    /* Its own section at the foot, under the scroll.

       Three rows, and the order is the point: Team, Settings, Admin.

       Team is a directory and belongs to everybody, so it goes first
       and carries no capability. Settings is the one thing everybody
       knows they want by name and the one thing that should never
       move. Admin is the role and permission hub, drawn only for
       whoever may actually open it rather than shown and then refused.

       Team and Admin were one screen until the business asked for
       three tabs here. They were also two questions: who works here,
       asked by anybody, and what can they do, asked by an
       administrator. One screen answering both made a phone list feel
       like an access review.

       No heading on this section. Three rows do not need one, and the
       rule above them already says a different kind of thing starts
       here. */
    key: 'admin', label: 'Admin', atFoot: true,
    items: [
      { href: '/dashboard/team', label: 'Team', icon: 'team', capability: null },
      { href: '/dashboard/settings', label: 'Settings', icon: 'settings', capability: null },
      /* ---- Why Admin takes two capabilities rather than one ----

         Admin was `admin.users` alone, and access requests were a
         nineteenth sidebar row called Access. That row was mine and
         nobody asked for it: the sidebar was already full, and Admin
         had carried a Requests tab all along, so it was a second copy
         of a screen that existed. It is gone.

         What it was solving is real, though. Sr Sales decides for their
         own salespeople and holds no administrative capability at all,
         because running a department is not the same as being able to
         edit accounts. Gated on `admin.users` alone, Admin would refuse
         them and a notification pointing there would point at a door
         they cannot open.

         So the row appears for either, and the tabs INSIDE it are gated
         one at a time: Sr Sales opens Admin and finds Requests and
         nothing else. `anyOf` is the whole of the mechanism, and it is
         a widening of who sees the row, never of what they can do. */
      { href: '/dashboard/admin', label: 'Admin', icon: 'admin',
        capability: 'admin.users', anyOf: ['admin.users', 'access.decide'] },
    ],
  },
];

/** Every item, sidebar or not, children included. What the breadcrumb reads. */
export const NAV_ITEMS: NavItem[] = NAVIGATION
  .flatMap((s) => s.items)
  .flatMap((i) => [i, ...(i.children ?? [])]);

/**
 * What a person may actually reach, given what they may do.
 *
 * Sections with nothing left in them are dropped: a heading over a list
 * of nothing is worse than no heading, because it reads as a thing that
 * failed to load.
 */
export function visibleSections(has: (c: CrmCapability) => boolean): NavSection[] {
  /* `anyOf` first where a row has one, so Admin appears for whoever
     runs a department as well as for whoever administers accounts. */
  const may = (i: { capability: CrmCapability | null; anyOf?: CrmCapability[] }) =>
    (i.anyOf ? i.anyOf.some(has) : i.capability === null || has(i.capability));

  return NAVIGATION
    .map((s) => ({
      ...s,
      items: s.items
        .filter((i) => !i.hidden && may(i))
        /* A parent whose children are all withheld keeps its own row
           only if it is a real screen in its own right. Revenue is not:
           it redirects to a division, so with no divisions to show
           there is nothing to open. */
        .map((i) => (i.children
          ? { ...i, children: i.children.filter((c) => !c.hidden && may(c)) }
          : i))
        .filter((i) => !i.children || i.children.length > 0),
    }))
    .filter((s) => s.items.length > 0);
}

/**
 * The breadcrumb for a path: the section, then the screen.
 *
 * Longest match wins, so a nested route says the screen it sits under.
 * The old version let the last matching key win, which is insertion
 * order, which is not a rule anybody can reason about or would think
 * to check.
 */
export function crumbsFor(path: string): [string, string] {
  let best: { section: string; item: NavItem } | null = null;

  for (const section of NAVIGATION) {
    /* Children are candidates in their own right. Without this, both
       revenue screens match only their parent's `/dashboard/revenue`
       and the breadcrumb says "Revenue" on a page whose whole purpose
       is to say which division you are looking at. */
    for (const item of section.items.flatMap((i) => [i, ...(i.children ?? [])])) {
      const hit = path === item.href || path.startsWith(`${item.href}/`);
      if (!hit) continue;
      if (!best || item.href.length > best.item.href.length) {
        best = { section: section.label, item };
      }
    }
  }

  if (!best) return ['Workspace', 'Dashboard'];
  return [best.section, best.item.crumb ?? best.item.label];
}
