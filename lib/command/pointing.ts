/* =============================================================
   The words that point at something rather than naming it.

   Three parts of the reader need these and each had grown its own copy:

     context.ts     "this customer" and "these" mean the screen
     clauses.ts     "export them" means what the clause before produced
     lifecycle.ts   "this account" is not a name for a new record

   Three lists of nearly the same words is how the OPENERS duplication
   started, and it fails the same way: somebody adds "the highlighted
   ones" to one of them and two thirds of the reader carries on not
   knowing it.

   So the words live here once, in the groups that mean different
   things, and each reader derives what it needs.

     ONE      the record in front of you
     MANY     however many are ticked
     BACK     what the clause before produced, including a person

   A word is in a group because of what it MEANS, not because of which
   file asked for it. `them` points backwards and never at the screen;
   `these` does both.
   ============================================================= */

/** One record, the one in front of you. */
export const ONE_WORDS = ['this', 'that', 'the current', 'the open', 'here'] as const;

/** However many are ticked. */
export const MANY_WORDS = [
  'these', 'those', 'the selected', 'selected', 'the ones selected',
  'the selection', 'the ticked', 'highlighted', 'the ones i have selected',
  'the ones i picked', 'the marked',
] as const;

/**
 * What the clause before produced.
 *
 * Including the personal ones. A clause can produce a PERSON as easily
 * as a set of rows, and "change Dave to sales and export him to CSV"
 * points back with a word the row-shaped list did not hold.
 */
export const BACK_WORDS = [
  'them', 'these', 'those', 'it', 'that', 'the result', 'the results',
  'the list', 'that list', 'the lot', 'him', 'her', 'they', 'he', 'she',
] as const;

/**
 * Whose. The record the thing belongs to.
 *
 * "Their main address", "its owner", "his account". A possessive is the
 * same act of pointing as "this", in another grammatical position, and
 * what it points at is the record in front of you: "make this address
 * their main address" says which customer without naming one.
 *
 * One record and never a selection, because a possessive says whose and
 * a set of forty ticked rows has no single whose. "My" and "our" are
 * deliberately absent: those point at the person typing, which is a
 * different fact and one the ownership reader deals with.
 */
export const OWNED_WORDS = ['their', 'its', 'his', 'her'] as const;

/**
 * Every single word that points at something rather than naming it.
 *
 * Derived from the groups above plus the remaining possessives, which
 * are the same act of pointing again: "their LinkedIn profile" is about
 * a record that already exists. Used where the question is only "is
 * this a name or a reference", which is what the create reader asks.
 */
export const POINTING_WORDS: ReadonlySet<string> = new Set([
  ...ONE_WORDS, ...MANY_WORDS, ...BACK_WORDS, ...OWNED_WORDS,
  'theirs', 'hers', 'my', 'mine', 'our', 'ours', 'your', 'yours',
].flatMap((phrase) => phrase.split(/\s+/)));
