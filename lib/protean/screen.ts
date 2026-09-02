/* =============================================================
   What the revenue screen shows, decided once and testable.

   ---- The bug this exists because of ----

   The first version made this decision inline, in the middle of the
   render:

     {nothingAtAll ? <EmptyState/> : <><Tabs/>...<ImportPanel/></>}

   Which reads as reasonable and is a deadlock. `nothingAtAll` is true
   until something has been imported, so the tab bar was not drawn, so
   the Import tab did not exist, so the two buttons that set the tab to
   `import` changed a piece of state that nothing was reading. They did
   nothing at all, forever, and the only way out of the state was the
   thing the state was preventing.

   An empty database is not an edge case here. It is how every
   installation starts, so it was the ONLY state the screen was ever in
   on the day it shipped.

   ---- Why it is a function and not a comment ----

   A render decision written inline can only be checked by loading the
   page in the state you are worried about, which is exactly the state
   nobody thinks to try. Written here it is four booleans from six, and
   `npm run check:revenue-screen` sweeps every combination that matters.
   ============================================================= */

export type RevenueTab = 'customers' | 'groups' | 'open' | 'accounts' | 'import';

export const REVENUE_TABS: RevenueTab[] = [
  'customers', 'groups', 'open', 'accounts', 'import',
];

export type ScreenState = {
  /** Still reading. Nothing is empty until we know it is. */
  loading: boolean;
  tab: RevenueTab;
  /** Customers with billing against them. */
  customers: number;
  groups: number;
  openJobs: number;
  /** Protean accounts with nobody on them yet. */
  waiting: number;
  mayImport: boolean;
};

export type Showing = {
  /** The totals across the top. */
  stats: boolean;
  /** The tab bar, and therefore every route into the screen. */
  tabs: boolean;
  /** The whole screen as one invitation to import something. */
  invitation: boolean;
  /** Which panel to draw, or null when the invitation stands in for it. */
  body: RevenueTab | null;
};

/**
 * Nothing has been imported.
 *
 * All five, because any one of them means an import has happened.
 * `waiting` especially: an import whose accounts are all unplaced has
 * no customers and no groups and is very much not an empty screen.
 */
export function nothingYet(s: ScreenState): boolean {
  return !s.loading && !s.customers && !s.groups && !s.openJobs && !s.waiting;
}

export function whatToShow(s: ScreenState): Showing {
  const empty = nothingYet(s);

  /* A tab somebody may not open is not a tab. Asked here as well as in
     the tab list so that a stale `?tab=import` in the address cannot
     put somebody on a panel they would be refused at. */
  const tab: RevenueTab = s.tab === 'import' && !s.mayImport ? 'customers' : s.tab;

  /* THE FIX. Somebody who may import must always be able to reach the
     import, and an empty database is the state they will be in when
     they most need to. Somebody who may not has nothing to click, so
     the bar is noise and the invitation says what it says without one. */
  const tabs = !empty || s.mayImport;

  /* Not while loading: a screen that says "nothing here yet" and then
     fills in has told somebody something false. */
  const invitation = empty && tab !== 'import';

  return {
    stats: !empty && !s.loading,
    tabs,
    invitation,
    body: invitation ? null : tab,
  };
}

/**
 * The invariant, stated so it can be asserted rather than believed.
 *
 * If a person may import, there is a way to the import from wherever
 * they are standing. That is the whole of what went wrong.
 */
export function canReachTheImport(s: ScreenState): boolean {
  if (!s.mayImport) return true;
  const showing = whatToShow(s);
  return showing.tabs || showing.body === 'import';
}
