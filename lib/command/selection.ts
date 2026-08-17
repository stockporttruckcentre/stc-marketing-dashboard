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

let current: ScreenSelection | null = null;
const listeners = new Set<(s: ScreenSelection | null) => void>();

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

export function onSelectionChange(fn: (s: ScreenSelection | null) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
