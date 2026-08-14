/* =============================================================
   The values, taken from the data rather than written down.

   "DAFs older than 2022 excluding anything at Warrington" resolved to
   nothing at all. Not because the grammar could not read "older than" or
   "excluding": because no word in the sentence named a thing, so the
   engine gave up before it started. It had no way of knowing DAF is a
   make, and the only reason a person knows is that they have seen it in
   the make column.

   The tempting fix is a list of makes in a file. That is the phrasebook
   again, one rung up: it goes stale the day somebody stocks a Chereau,
   and every other free text column needs its own copy.

   So this holds the values themselves, read from the database and kept
   in memory. A word that appears in `stock_trailers.make` IS a make, by
   definition, and needs nobody to say so. The same mechanism covers
   models, depots, customers and reps, and it covers the ones that do not
   exist yet without a line being written.

   Two properties matter:

     it is optional      an empty index changes nothing, so the engine
                         works offline and in tests exactly as before
     it is scoped        only columns an entity declares as free text are
                         indexed, so nothing here widens what can be
                         filtered on

   The app fills it once from /api/command/vocabulary. Checks fill it
   with a sample, which is the same thing a smaller database would give.
   ============================================================= */
import { ENTITIES } from './schema';

export type ValueHit = {
  entity: string;
  column: string;
  key: string;
  /** The value as it is stored, which is what a filter must use. */
  value: string;
  /** How many rows hold it. Rarity is evidence: one Chereau is still a make. */
  rows: number;
};

/**
 * Everything the database holds, for the columns that carry values.
 *
 * The wire shape and the argument shape at once, so the browser and the
 * server load the SAME thing rather than two things built the same way.
 * A make that exists only because somebody typed it into a row has to
 * mean the same on both sides, or the sentence the bar showed and the
 * sentence the server ran are different sentences.
 */
export type VocabularySnapshot =
  Record<string, Record<string, { value: string; rows: number }[]>>;

/**
 * word (lowercased) -> everywhere that word is a value
 *
 * An index is a VALUE and nothing in this module holds one. It is
 * built, passed to whoever is reading a sentence, and discarded.
 *
 * That is not tidiness. Some of these values are visible to one person
 * and not another: `crm_contacts` restricts SELECT to rows on a global
 * list, a list you own, or a list shared with you, so the company names
 * and owners it yields differ per user. While this module held one
 * index, whoever refreshed it last decided what everybody else's
 * sentences meant, and a value only one person could see became a value
 * everybody's bar could resolve. The fix put the index in the caller's
 * hands and left a synchronous install underneath; this removes the
 * install as well, so there is no shared thing left to get wrong.
 */
export type VocabularyIndex = ReadonlyMap<string, ValueHit[]>;

/**
 * What a reader gets when nobody supplied one.
 *
 * Frozen, empty, and shared safely because there is nothing in it. This
 * is what makes "no vocabulary" an explicit value rather than the
 * absence of a load somebody forgot to do.
 */
export const EMPTY_VOCABULARY: VocabularyIndex = new Map();

/** Columns worth indexing: declared free text, on a declared entity. */
function indexable(entityId: string, column: string): { key: string } | null {
  const e = ENTITIES.find((x) => x.id === entityId);
  const f = e?.filters.find((x) => x.column === column && x.freeText);
  return f ? { key: f.key } : null;
}

/**
 * Build an index from a snapshot. Pure: nothing is installed.
 *
 * Building and installing are separated so a caller can prepare the
 * right index while awaiting a database, and then put it in place in
 * one synchronous step with nothing able to interleave.
 */
export function buildIndex(snapshot: VocabularySnapshot): VocabularyIndex {
  const index = new Map<string, ValueHit[]>();

  for (const [entityId, columns] of Object.entries(snapshot)) {
    for (const [column, values] of Object.entries(columns)) {
      const spec = indexable(entityId, column);
      if (!spec) continue;
      for (const { value, rows } of values) {
        const clean = String(value ?? '').trim();
        if (clean.length < 2 || clean.length > 60) continue;
        const hit: ValueHit = { entity: entityId, column, key: spec.key, value: clean, rows };
        /* Indexed whole and by word, so "Lawrence David" is found by
           somebody typing either half of it, and "Gray & Adams" survives
           the punctuation being dropped. */
        for (const form of forms(clean)) {
          index.set(form, [...(index.get(form) ?? []), hit]);
        }
      }
    }
  }

  return index;
}

/** One index from several, for combining differently sourced values. */
export function mergeIndexes(...parts: VocabularyIndex[]): VocabularyIndex {
  const out = new Map<string, ValueHit[]>();
  for (const part of parts) {
    for (const [word, hits] of part) out.set(word, [...(out.get(word) ?? []), ...hits]);
  }
  return out;
}

function forms(value: string): string[] {
  const whole = value.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = whole.split(' ').filter((p) => p.length >= 3 && !STOP.has(p));
  return [...new Set([whole, ...parts])].filter(Boolean);
}

/* Words too common to be evidence of anything, even when a company is
   called them. "The Transport Company" must not make "the" a customer. */
const STOP = new Set([
  'the', 'and', 'ltd', 'limited', 'plc', 'llp', 'group', 'holdings', 'services',
  'transport', 'haulage', 'logistics', 'company', 'trailers', 'trailer', 'uk',
  'new', 'used', 'sold', 'stock', 'unit', 'units', 'yes', 'no', 'n/a', 'none',
]);

/**
 * Everywhere this word is a stored value, according to ONE index.
 *
 * Plurals are handled because people type them: "DAFs" and "Volvos" are
 * how anybody refers to more than one.
 */
export function lookupValue(index: VocabularyIndex, word: string): ValueHit[] {
  const w = word.toLowerCase().trim();
  const direct = index.get(w);
  if (direct?.length) return direct;
  if (w.endsWith('s')) {
    const singular = index.get(w.slice(0, -1));
    if (singular?.length) return singular;
  }
  if (w.endsWith('es')) {
    const singular = index.get(w.slice(0, -2));
    if (singular?.length) return singular;
  }
  return [];
}

/** Every value in a sentence that one index recognises. */
export function findValues(
  index: VocabularyIndex, text: string,
): { word: string; at: number; hits: ValueHit[] }[] {
  const t = text.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ');
  const words = t.split(/\s+/).filter(Boolean);
  const out: { word: string; at: number; hits: ValueHit[] }[] = [];
  let at = 0;
  for (const w of words) {
    const pos = t.indexOf(w, at);
    at = pos + w.length;
    if (w.length < 3 || STOP.has(w)) continue;
    const hits = lookupValue(index, w);
    if (hits.length) out.push({ word: w, at: pos, hits });
  }
  /* Two word values, checked after, so "Lawrence David" beats the two
     single word hits it also produces. */
  for (let i = 0; i < words.length - 1; i++) {
    const pair = `${words[i]} ${words[i + 1]}`;
    const hits = lookupValue(index, pair);
    if (!hits.length) continue;
    const pos = t.indexOf(pair);
    out.unshift({ word: pair, at: pos, hits });
  }
  return out;
}
