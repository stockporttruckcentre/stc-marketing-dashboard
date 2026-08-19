/* =============================================================
   What the screen has selected, so the bar can be told.

   A module with a subscription rather than a React context, because the
   bar lives in the dashboard shell and the grids live several layers
   down inside pages, and threading a provider through every screen to
   carry one array is a lot of scaffolding for one array.

   NOTHING HERE DECIDES ANYTHING.

   It is a postbox. The screen puts what it has in it, the bar reads it
   and sends it with the sentence, and the server reads every id back
   through the caller's own session before acting on any of it. A stale
   selection narrows to rows that still exist and that this person can
   still see, which is the worst it can do.
   ============================================================= */

export type ScreenSelection = { entity: string; ids: string[] };

/**
 * The working list a screen has open.
 *
 * Separate from the selection, because it is a different fact. A CRM
 * screen with nothing ticked still has a list open, and "share this
 * list with Dave" is about the list rather than about any rows on it.
 * Without this the sentence had nothing to point at and read as a share
 * of whatever happened to be selected.
 */
export type ScreenList = { id: string; name: string };

let current: ScreenSelection | null = null;
let openList: ScreenList | null = null;
const listeners = new Set<(s: ScreenSelection | null) => void>();
const listListeners = new Set<(l: ScreenList | null) => void>();

/** Called by a screen when its selection changes. */
export function publishSelection(selection: ScreenSelection | null): void {
  const next = selection && selection.ids.length ? selection : null;
  const same = JSON.stringify(next) === JSON.stringify(current);
  if (same) return;
  current = next;
  for (const listener of listeners) listener(current);
}

export function currentSelection(): ScreenSelection | null {
  return current;
}

/** Called by a screen when the list it is showing changes. */
export function publishOpenList(list: ScreenList | null): void {
  const same = JSON.stringify(list) === JSON.stringify(openList);
  if (same) return;
  openList = list;
  for (const listener of listListeners) listener(openList);
}

export function currentOpenList(): ScreenList | null {
  return openList;
}

export function onOpenListChange(fn: (l: ScreenList | null) => void): () => void {
  listListeners.add(fn);
  return () => { listListeners.delete(fn); };
}

export function onSelectionChange(fn: (s: ScreenSelection | null) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
