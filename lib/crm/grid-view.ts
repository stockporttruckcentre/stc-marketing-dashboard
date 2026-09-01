import type { GridApi } from 'ag-grid-community';

/* =============================================================
   The way somebody has arranged the grid, kept.

   Clicking Email to sort by it, dragging a column narrower, moving one
   left: all of that was thrown away on the next page load, so the
   arrangement somebody wanted was something they had to redo every
   morning. This keeps it.

   ---- What is kept ----

   The column state, which is AG Grid's word for sort, width, order,
   visibility and pinning in one object, and the filter model. Those are
   the two things a person changes by hand.

   Not the row data, not the scroll position, not which list is open.
   The open list is already kept separately and is a different kind of
   thing: it says which customers, not how they are arranged.

   ---- Why the browser and not the database ----

   Being straight about this, because it is a real limitation rather
   than an oversight. It is per browser. Sign in on another machine and
   the grid is back to its default arrangement.

   The alternative is a row per person, which means a migration, a
   handover file and somebody pasting SQL into an editor to make a sort
   order stick. That is the wrong trade for this, and the upgrade path
   is short if it turns out to matter: this module keeps the shape, and
   only these three functions would change.

   ---- Keyed on the person ----

   Two people sharing a machine do not share an arrangement, and
   somebody signing out and back in as somebody else does not inherit
   the last person's sort. The key carries the user id for that reason
   rather than for privacy: nothing here is a secret, it is just not
   theirs.
   ============================================================= */

export type SavedView = {
  /** AG Grid's `getColumnState()`: sort, width, order, visibility, pinning. */
  columns: unknown[];
  /** AG Grid's `getFilterModel()`. */
  filter: Record<string, unknown>;
  /** So a change to the grid's columns can retire an arrangement built
      against the old ones rather than applying it half. */
  version: number;
};

/* Bumped when the column set changes in a way that makes a saved
   arrangement wrong rather than merely stale. A saved state naming a
   column that no longer exists is ignored by AG Grid, which is fine;
   this is for the case where a column changes meaning. */
const VERSION = 1;

const PREFIX = 'stc:crm:view';

export function viewKey(userId: string): string {
  return `${PREFIX}:${userId}`;
}

export function readView(userId: string): SavedView | null {
  try {
    const raw = localStorage.getItem(viewKey(userId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<SavedView>;
    if (parsed.version !== VERSION) return null;
    if (!Array.isArray(parsed.columns)) return null;

    return {
      columns: parsed.columns,
      filter: typeof parsed.filter === 'object' && parsed.filter !== null
        ? parsed.filter as Record<string, unknown>
        : {},
      version: VERSION,
    };
  } catch {
    /* A private window, cleared site data, or something else in this
       key. None of those are worth an error: the grid draws its
       default arrangement, which is what it did before any of this. */
    return null;
  }
}

export function writeView(userId: string, api: GridApi): void {
  try {
    const view: SavedView = {
      columns: api.getColumnState(),
      filter: api.getFilterModel() as Record<string, unknown>,
      version: VERSION,
    };
    localStorage.setItem(viewKey(userId), JSON.stringify(view));
  } catch {
    /* Storage full, or refused. Losing the arrangement is a small
       thing and it must not take the grid with it. */
  }
}

export function clearView(userId: string): void {
  try {
    localStorage.removeItem(viewKey(userId));
  } catch { /* as above */ }
}

/**
 * Put a saved arrangement back on the grid.
 *
 * `applyOrder` matters: without it a saved state restores the sort and
 * the widths and leaves the columns in their declared order, so
 * somebody who moved Status to the front finds it back in the middle
 * and reasonably concludes the whole thing did not work.
 */
export function applyView(api: GridApi, view: SavedView): void {
  api.applyColumnState({ state: view.columns as never, applyOrder: true });
  api.setFilterModel(view.filter);
}

/**
 * What the arrangement is doing, in words, for the line under the grid.
 *
 * A sort somebody set last Tuesday and forgot is a sort they blame the
 * data for. Saying it out loud is what stops "why is this in a mad
 * order" becoming a bug report.
 */
export function describeView(view: SavedView, headerFor: (colId: string) => string): string | null {
  const bits: string[] = [];

  const sorted = (view.columns as { colId?: string; sort?: string | null }[])
    .filter((c) => c.sort === 'asc' || c.sort === 'desc');

  if (sorted.length === 1) {
    const c = sorted[0];
    bits.push(`sorted by ${headerFor(c.colId ?? '')}${c.sort === 'desc' ? ', highest first' : ''}`);
  } else if (sorted.length > 1) {
    bits.push(`sorted by ${sorted.length} columns`);
  }

  const filters = Object.keys(view.filter ?? {}).length;
  if (filters > 0) {
    bits.push(`${filters} column ${filters === 1 ? 'filter' : 'filters'}`);
  }

  const hidden = (view.columns as { hide?: boolean }[]).filter((c) => c.hide).length;
  if (hidden > 0) bits.push(`${hidden} hidden`);

  if (bits.length === 0) return null;
  return bits.join(', ');
}
