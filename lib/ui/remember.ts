/* =============================================================
   One choice somebody made, remembered on their machine.

   `order.ts` next door remembers a LIST of keys, because that is what a
   row of draggable tabs is. This remembers a single value out of a
   closed set, which is the other shape the same habit takes: which
   layout a view is drawn in, which grouping, which of two panes is open.

   ---- Why this exists at all ----

   The Work screen shipped with twelve saved views, two of which were the
   same question drawn a different way:

     My work     assigned to me, as a list
     My board    assigned to me, as a board

   From the business:

     My Work and my board seem like the same thing just a different view,
     then they both offer viewing options etc.

   They were, and the toolbar above both of them can turn either into the
   other in one press. The reason a second row existed anyway is that the
   press did not last: switch My work to a board, come back tomorrow, and
   it is a list again. A preference that does not survive the morning is
   not a preference, so people asked for a row instead.

   Remembering the press removes the reason for the row.

   ---- Per device, and per view ----

   The key carries the view's id, so somebody drawing My work as a board
   and Team work as a table gets both, rather than one global layout that
   the last screen touched decides for every other screen.

   Device rather than account, for the reason `order.ts` gives: how a
   screen is drawn is a habit of the desk it is looked at from. A board
   is right on a wide monitor and wrong on a phone held in a yard, and
   the same person is both of those people in one day.

   ---- What it never does ----

   It never returns a value that is not in the set it was handed. A
   stored layout naming something that no longer exists, or a string
   somebody typed into local storage by hand, gives back null and the
   screen opens the way it was saved. Reading the property itself throws
   in a private window in some browsers, before any method is called, so
   every access is wrapped.
   ============================================================= */

const KEY = (name: string) => `stc-choice:${name}`;

/**
 * What was chosen, if it is still one of the choices.
 *
 * `allowed` is the whole point rather than a nicety: this reads a string
 * out of storage that anything on the machine can have written, and
 * hands it back as a union type. Without the check that is a lie the
 * type system cannot catch, and it surfaces as a screen that draws
 * nothing because `view.layout` is a word no layout answers to.
 */
export function readChoice<T extends string>(
  name: string,
  allowed: readonly T[],
): T | null {
  try {
    const raw = window.localStorage.getItem(KEY(name));
    if (!raw) return null;
    return (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
  } catch {
    return null;
  }
}

/** Written when somebody chooses. Failing to write is silent. */
export function writeChoice(name: string, value: string): void {
  try {
    window.localStorage.setItem(KEY(name), value);
  } catch {
    /* The choice holds for this session either way. It just will not be
       there tomorrow, which is the state everything was in before. */
  }
}

/** Back to whatever the thing itself declares. */
export function forgetChoice(name: string): void {
  try {
    window.localStorage.removeItem(KEY(name));
  } catch {
    /* As above. */
  }
}
