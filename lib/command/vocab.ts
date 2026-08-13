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

/** word (lowercased) -> everywhere that word is a value */
const INDEX = new Map<string, ValueHit[]>();

/** Columns worth indexing: declared free text, on a declared entity. */
function indexable(entityId: string, column: string): { key: string } | null {
  const e = ENTITIES.find((x) => x.id === entityId);
  const f = e?.filters.find((x) => x.column === column && x.freeText);
  return f ? { key: f.key } : null;
}

/**
 * Load values for one entity.
 *
 * Called with whatever the database actually holds. Passing the same
 * entity twice replaces it, so a refresh is a second call rather than a
 * reset and a rebuild.
 */
export function setVocabulary(
  entityId: string,
  columns: Record<string, { value: string; rows: number }[]>,
): void {
  // Drop anything previously held for this entity, so a refresh shrinks
  // as well as grows.
  for (const [word, hits] of INDEX) {
    const kept = hits.filter((h) => h.entity !== entityId);
    if (kept.length) INDEX.set(word, kept); else INDEX.delete(word);
  }

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
        INDEX.set(form, [...(INDEX.get(form) ?? []), hit]);
      }
    }
  }
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
 * Everywhere this word is a stored value.
 *
 * Plurals are handled because people type them: "DAFs" and "Volvos" are
 * how anybody refers to more than one.
 */
export function lookupValue(word: string): ValueHit[] {
  const w = word.toLowerCase().trim();
  const direct = INDEX.get(w);
  if (direct?.length) return direct;
  if (w.endsWith('s')) {
    const singular = INDEX.get(w.slice(0, -1));
    if (singular?.length) return singular;
  }
  if (w.endsWith('es')) {
    const singular = INDEX.get(w.slice(0, -2));
    if (singular?.length) return singular;
  }
  return [];
}

/** The first value in a sentence that the data recognises. */
export function findValues(text: string): { word: string; at: number; hits: ValueHit[] }[] {
  const t = text.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ');
  const words = t.split(/\s+/).filter(Boolean);
  const out: { word: string; at: number; hits: ValueHit[] }[] = [];
  let at = 0;
  for (const w of words) {
    const pos = t.indexOf(w, at);
    at = pos + w.length;
    if (w.length < 3 || STOP.has(w)) continue;
    const hits = lookupValue(w);
    if (hits.length) out.push({ word: w, at: pos, hits });
  }
  /* Two word values, checked after, so "Lawrence David" beats the two
     single word hits it also produces. */
  for (let i = 0; i < words.length - 1; i++) {
    const pair = `${words[i]} ${words[i + 1]}`;
    const hits = lookupValue(pair);
    if (!hits.length) continue;
    const pos = t.indexOf(pair);
    out.unshift({ word: pair, at: pos, hits });
  }
  return out;
}

/** Nothing loaded means every caller behaves as it did before. */
export function vocabularyLoaded(): boolean {
  return INDEX.size > 0;
}

export function vocabularySize(): number {
  return INDEX.size;
}
