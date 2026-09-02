/* =============================================================
   An order somebody chose, remembered on their machine.

   From the business, about the tracker's three division tabs:

     make it so people can re-order them by drag and it saves forever
     device-wide.

   ---- Why the machine and not the account ----

   "Device-wide" is the ask, and it is also the right place. Tab order
   is a habit of the hand, not a fact about the person: somebody who
   sells trailers all day on the office desktop wants Trailer sales
   first there, and the same person checking a rental on their phone in
   a yard wants whatever suits the phone. Putting it on the profile
   would sync a preference between two contexts that do not want the
   same thing, and would need a migration, a column and a write on every
   drag.

   ---- What "forever" has to survive ----

   Not just a refresh. The stored order is a list of keys written some
   time ago, and the tabs it is applied to are whatever the application
   has TODAY. Those two disagree the moment a division is added or
   renamed, and a naive `sort by stored index` answers that by hiding
   the new one. So:

     a key that is stored and no longer exists     ignored
     a key that exists and was never stored        kept, at the end
     a stored list that is nonsense                the order as declared

   The last matters most. `localStorage` is a string somebody can edit,
   another tab can overwrite, and a browser can hand back empty. None of
   those may leave the tracker with no tabs on it.
   ============================================================= */

/** Anything with a stable key. Tabs, columns, sections. */
export type Ordered = { key: string };

/**
 * The items, in the order that was saved, then everything else.
 *
 * Pure, and total: it returns every item it was given exactly once
 * whatever the saved order says, including when the saved order is
 * null, empty, full of keys that no longer exist, or carries the same
 * key three times.
 */
export function applyOrder<T extends Ordered>(items: T[], saved: readonly string[] | null): T[] {
  if (!saved?.length) return items;
  const at = new Map<string, number>();
  saved.forEach((key, i) => { if (!at.has(key)) at.set(key, i); });
  /* A tab nobody has an opinion about goes after the ones they do.
     Sorting it to the front would put a division added next year ahead
     of the order somebody deliberately set. */
  const unseen = saved.length;
  return [...items].sort((a, b) =>
    (at.get(a.key) ?? unseen) - (at.get(b.key) ?? unseen));
}

/**
 * One item moved to another position, as a list of keys.
 *
 * `to` is where the item ends up in the list AFTER it has been lifted
 * out, which is what a drop between two tabs means and what every
 * off-by-one in a reorder comes from.
 */
export function moveTo(keys: readonly string[], from: number, to: number): string[] {
  if (from === to) return [...keys];
  if (from < 0 || from >= keys.length) return [...keys];
  const out = [...keys];
  const [lifted] = out.splice(from, 1);
  if (lifted === undefined) return [...keys];
  out.splice(Math.max(0, Math.min(out.length, to)), 0, lifted);
  return out;
}

const KEY = (name: string) => `stc-order:${name}`;

/**
 * What was saved, or null.
 *
 * Every access is wrapped. `localStorage` is not merely empty in a
 * private window or with site data blocked: reading the property itself
 * throws in some browsers, before any method is called. An order that
 * cannot be read is not an error worth showing anybody, it is a screen
 * that opens in the order it was declared in.
 */
export function readOrder(name: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(KEY(name));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const keys = parsed.filter((k): k is string => typeof k === 'string');
    return keys.length ? keys : null;
  } catch {
    return null;
  }
}

/** Written on every drop. Failing to write is silent, for the same reason. */
export function writeOrder(name: string, keys: readonly string[]): void {
  try {
    window.localStorage.setItem(KEY(name), JSON.stringify(keys));
  } catch {
    /* Nothing to do and nothing worth saying. The order holds for this
       session either way; it just will not be there tomorrow. */
  }
}

/** Back to the order the application declares. */
export function forgetOrder(name: string): void {
  try {
    window.localStorage.removeItem(KEY(name));
  } catch {
    /* As above. */
  }
}
