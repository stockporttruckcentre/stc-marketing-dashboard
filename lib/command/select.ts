/* =============================================================
   Which rows, said in any combination.

   This is the file the count was missing.

   A command is a verb, a set of rows, and sometimes a field and a value.
   I built verbs, and fields, and values, and then built the set of rows
   as either "this one record" or "everything with one status". That is
   why the item count read 253 when the truthful number is far larger:
   the selector is the combinatorial part and it was the part written
   flat.

   A selector composes. Every clause below can appear with every other
   clause, in any order, and each one narrows what came before:

     customers in Manchester
     customers in Manchester with no owner
     customers in Manchester with no owner not contacted in 30 days
     ... with a fleet over 50
     ... that Dave owns
     ... quoted, added this month, turnover over 2m, no email

   Six clause kinds against forty five columns is not six commands. Put a
   verb in front of it and it is every question, every export, every bulk
   assignment and every bulk edit anybody will ever type.

   Nothing here runs anything. It reads a sentence into a set of
   conditions, and whatever holds the verb decides what to do with them.
   ============================================================= */
import { ENTITIES, type EntitySpec } from './schema';
import { DEPOTS, isReservedWord } from './lexicon';
import { TABLES } from './columns';
import { readSlots } from './params';
import { attributeNames, columnAfter } from './attributes';

export type Condition =
  /** column = value, for the enums. */
  | { kind: 'eq'; column: string; value: string; label: string }
  /** column contains text, for names and places. */
  | { kind: 'ilike'; column: string; value: string; label: string }
  /** column is null or empty. "with no owner", "missing an email". */
  | { kind: 'empty'; column: string; label: string }
  /** column has something in it. "with a phone number". */
  | { kind: 'present'; column: string; label: string }
  /** column >= or <= a number. "fleet over 50", "turnover under 2m". */
  | { kind: 'gte' | 'lte'; column: string; value: number; label: string }
  /** column is older or newer than a point in time. */
  | { kind: 'before' | 'after'; column: string; value: string; label: string }
  /** rows belonging to this person, or to nobody. */
  | { kind: 'owner'; value: string | null; label: string };

export type Selection = {
  entity: EntitySpec;
  conditions: Condition[];
  /** Plain English for the whole set, shown before anything happens. */
  label: string;
  /** How much of the sentence was actually used. */
  confidence: number;
};

const soften = (s: string) =>
  ` ${s.toLowerCase().replace(/[^a-z0-9£$€.' ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;

/* -------------------------------------------------------------
   Clause words.
   ------------------------------------------------------------- */

/** The ways people say a column is empty. */
const EMPTY_LEADS = [
  'with no', 'without a', 'without an', 'without', 'no', 'missing a', 'missing an',
  'missing', 'has no', 'have no', 'havent got a', 'lacking a', 'lacking', 'blank',
];

/** And the ways they say it is not. */
const PRESENT_LEADS = [
  'with a', 'with an', 'with', 'has a', 'have a', 'that have a', 'who have a',
];

/**
 * Which columns an emptiness clause can reach.
 *
 * This used to be seventeen columns written out here, on the reasoning
 * that "with no owner" and "set the owner" are different meanings even
 * though they share words. The meanings are different; the COLUMN is the
 * same one, and keeping a second list of them meant "customers with no
 * email" worked while "customers with no website" did not, for no
 * reason anybody could see from either file.
 *
 * So the columns now come from `attributes.ts`, which merges what the
 * schema, the writable fields and the yard phrasings all know. Every
 * column anybody can name is a column they can ask to be empty.
 */
function nullableFor(entity: EntitySpec): { words: string[]; column: string; label: string }[] {
  const byColumn = new Map<string, { words: string[]; column: string; label: string }>();
  for (const n of attributeNames(entity)) {
    const prev = byColumn.get(n.column);
    if (prev) { if (!prev.words.includes(n.alias)) prev.words.push(n.alias); continue; }
    byColumn.set(n.column, { words: [n.alias], column: n.column, label: n.label });
  }
  return [...byColumn.values()];
}

/** For the census, which counts clauses rather than reading a sentence. */
const NULLABLE_COUNT = (entity: EntitySpec) => nullableFor(entity).length;

/** Numeric columns somebody compares against a figure. */
const COMPARABLE: { words: string[]; column: string; label: string; money?: boolean }[] = [
  { words: ['fleet', 'fleet size', 'vehicles', 'units on their fleet'], column: 'fleet_size', label: 'fleet' },
  { words: ['trucks'], column: 'trucks', label: 'trucks' },
  { words: ['trailers on fleet', 'their trailers'], column: 'trailers', label: 'trailers' },
  { words: ['vans'], column: 'vans', label: 'vans' },
  { words: ['employees', 'staff', 'headcount', 'people'], column: 'employee_count', label: 'employees' },
  { words: ['turnover'], column: 'turnover', label: 'turnover', money: true },
  { words: ['estimated value', 'deal value', 'value', 'worth'], column: 'estimated_value', label: 'estimated value', money: true },
  { words: ['sale price', 'sold for', 'price'], column: 'sale_price', label: 'sale price', money: true },
  { words: ['profit', 'margin'], column: 'profit', label: 'profit', money: true },
  { words: ['nbv', 'book value'], column: 'nbv', label: 'book value', money: true },
  { words: ['refurb', 'refurb cost'], column: 'refurb_costs', label: 'refurb cost', money: true },
  { words: ['year'], column: 'year', label: 'year' },
];

/** Date columns and the words that point at them. */
const DATED: { words: string[]; column: string; label: string }[] = [
  { words: ['contacted', 'last contact', 'last contacted', 'spoken to', 'heard from', 'rung', 'called'],
    column: 'last_contact', label: 'last contact' },
  { words: ['added', 'created', 'came in', 'enquired', 'enquiry'],
    column: 'date_of_enquiry', label: 'enquiry date' },
  { words: ['ordered', 'order date'], column: 'order_date', label: 'order date' },
  { words: ['dispatched', 'delivered', 'dispatch'], column: 'dispatch_date', label: 'dispatch date' },
  { words: ['mot', 'tested', 'plated'], column: 'mot_date', label: 'MOT' },
];

const MINE = /\b(my|mine|i own|belonging to me|on my book|in my portfolio)\b/i;
const UNOWNED = /\b(unassigned|unowned|nobody|no one|noone|up for grabs|unclaimed)\b/i;

/* -------------------------------------------------------------
   Reading it.
   ------------------------------------------------------------- */

/**
 * Every condition a sentence carries, against one entity.
 *
 * `me` is the caller's name, so "my customers" resolves to something the
 * server can actually filter on.
 */
export function parseSelection(input: string, me?: string): Selection | null {
  const raw = input.trim();
  if (raw.length < 3) return null;

  const picked = pickEntityNoun(raw);
  if (!picked) return null;
  const { entity, noun: entityNoun } = picked;

  const t = soften(raw);
  const conditions: Condition[] = [];
  const spoken: string[] = [];
  const has = (c: string) => conditions.some((x) => 'column' in x && x.column === c);

  /* --- who owns it --- */
  if (UNOWNED.test(raw)) {
    conditions.push({ kind: 'owner', value: null, label: 'nobody owns' });
    spoken.push('unassigned');
  } else if (MINE.test(raw) && me) {
    conditions.push({ kind: 'owner', value: me, label: `yours` });
    spoken.push('yours');
  } else {
    const named = raw.match(/\b(?:owned by|assigned to|belonging to|on)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
    if (named && !isReservedWord(named[1])) {
      conditions.push({ kind: 'owner', value: named[1], label: `${named[1]} owns` });
      spoken.push(named[1]);
    }
  }

  /* --- bigger or smaller than a number ---
     Before the emptiness clauses, because "with a fleet over 50"
     starts with the same words as "with a fleet" and the presence
     test would otherwise swallow it and drop the number. */
  for (const c of COMPARABLE) {
    if (has(c.column)) continue;
    for (const w of [...c.words].sort((a, b) => b.length - a.length)) {
      const over = t.match(new RegExp(String.raw`\b${esc(w)}\s+(?:of\s+)?(?:over|above|more than|bigger than|at least|north of)\s+(${NUM})`));
      const under = t.match(new RegExp(String.raw`\b${esc(w)}\s+(?:of\s+)?(?:under|below|less than|fewer than|smaller than|up to)\s+(${NUM})`));
      // And the other word order, which is just as common.
      const over2 = t.match(new RegExp(String.raw`\b(?:over|above|more than|at least)\s+(${NUM})\s+${esc(w)}\b`));
      const under2 = t.match(new RegExp(String.raw`\b(?:under|below|less than|fewer than)\s+(${NUM})\s+${esc(w)}\b`));

      const hit = over ?? over2 ?? under ?? under2;
      if (!hit) continue;
      const n = scale(hit[1]);
      if (n == null) continue;
      const isOver = !!(over ?? over2);
      conditions.push({
        kind: isOver ? 'gte' : 'lte',
        column: c.column,
        value: n,
        label: `${c.label} ${isOver ? 'over' : 'under'} ${c.money ? money(n) : n}`,
      });
      spoken.push(w);
      break;
    }
  }

  /* --- is it empty, or is it not ---
     Longest lead first, so "with no" beats "no" and "without an" beats
     "without". Getting that backwards turns "without an email" into a
     search for rows containing the word "an". */
  for (const [leads, kind] of [[EMPTY_LEADS, 'empty'], [PRESENT_LEADS, 'present']] as const) {
    for (const found of columnAfter(entity, t, [...leads])) {
      if (has(found.column)) continue;
      conditions.push(kind === 'empty'
        ? { kind: 'empty', column: found.column, label: `no ${found.label}` }
        : { kind: 'present', column: found.column, label: `has a ${found.label}` });
      spoken.push(found.spoken);
    }
  }

  /* --- how long ago ---
     "Not contacted in 30 days" is the single most useful selector in a
     CRM and it was unreachable. */
  for (const d of DATED) {
    if (has(d.column)) continue;
    for (const w of [...d.words].sort((a, b) => b.length - a.length)) {
      const stale = t.match(new RegExp(
        String.raw`\b(?:not|never|havent|hasnt|not been)\s+${esc(w)}\s+(?:in|for|since|within)?\s*(?:the\s+)?(?:last\s+|past\s+)?(\d{1,4})\s*(day|days|week|weeks|month|months|year|years)\b`));
      if (stale) {
        conditions.push({
          kind: 'before', column: d.column, value: ago(Number(stale[1]), stale[2]),
          label: `not ${w} in ${stale[1]} ${stale[2]}`,
        });
        spoken.push(w);
        break;
      }
      const recent = t.match(new RegExp(
        String.raw`\b${esc(w)}\s+(?:in|within)\s+(?:the\s+)?(?:last\s+|past\s+)?(\d{1,4})\s*(day|days|week|weeks|month|months)\b`));
      if (recent) {
        conditions.push({
          kind: 'after', column: d.column, value: ago(Number(recent[1]), recent[2]),
          label: `${w} in the last ${recent[1]} ${recent[2]}`,
        });
        spoken.push(w);
        break;
      }
      // "never contacted" with no number is a different thing again.
      if (new RegExp(String.raw`\bnever\s+${esc(w)}\b`).test(t)) {
        conditions.push({ kind: 'empty', column: d.column, label: `never ${w}` });
        spoken.push(w);
        break;
      }
    }
  }

  /* --- a value from the entity's own vocabulary --- */
  for (const f of entity.filters) {
    if (!f.vocabulary || has(f.column)) continue;
    const words = Object.keys(f.vocabulary).sort((a, b) => b.length - a.length);
    for (const w of words) {
      /* The noun that named the entity is not also a filter on it.
         Without this, "quoted customers" comes back as status=customer
         and the actual status is thrown away. */
      if (w === entityNoun) continue;
      if (spoken.some((s) => s.includes(w))) continue;
      if (!t.includes(` ${w} `)) continue;
      conditions.push({
        kind: 'eq', column: f.column, value: f.vocabulary[w],
        label: `${f.label} ${w}`,
      });
      spoken.push(w);
      break;
    }
  }

  /* --- where --- */
  const locSpec = entity.filters.find((f) => f.key === 'location');
  if (locSpec && !has(locSpec.column)) {
    const slots = readSlots(raw);
    const depot = Object.entries(DEPOTS).find(([w]) => t.includes(` ${w} `))?.[1];
    /* A depot first, and a free-text place only when it does not overlap
       something already claimed. "Owned by Dave added in the last 7
       days" was coming back with a place called Dave Added. */
    const loose = slots.place?.value;
    const clean = loose && !spoken.some((w) => loose.toLowerCase().includes(w.toLowerCase()))
      && !/\b(added|created|contacted|owned|assigned)\b/i.test(loose)
      ? loose : undefined;
    const place = depot ?? clean;
    if (place) {
      conditions.push({ kind: 'ilike', column: locSpec.column, value: place, label: `in ${place}` });
      spoken.push(place.toLowerCase());
    }
  }

  if (!conditions.length) return null;

  return {
    entity,
    conditions,
    label: `${entity.label} ${conditions.map((c) => c.label).join(', ')}`,
    confidence: 4 + conditions.length * 3,
  };
}

/* -------------------------------------------------------------
   Bits.
   ------------------------------------------------------------- */

const NUM = String.raw`(?:£|\$|€)?\s*\d[\d,]*(?:\.\d+)?\s*(?:k|m|grand)?`;

function esc(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function scale(raw: string): number | null {
  const m = raw.match(/(\d[\d,]*(?:\.\d+)?)\s*(k|m|grand)?/i);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const s = (m[2] ?? '').toLowerCase();
  if (s === 'k' || s === 'grand') n *= 1000;
  if (s === 'm') n *= 1_000_000;
  return n;
}

function money(n: number): string {
  return `£${n.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
}

/** A date that many days, weeks, months or years back. */
function ago(n: number, unit: string): string {
  const d = new Date();
  if (unit.startsWith('day')) d.setDate(d.getDate() - n);
  else if (unit.startsWith('week')) d.setDate(d.getDate() - n * 7);
  else if (unit.startsWith('month')) d.setMonth(d.getMonth() - n);
  else if (unit.startsWith('year')) d.setFullYear(d.getFullYear() - n);
  return d.toISOString().slice(0, 10);
}

function pickEntityNoun(text: string): { entity: EntitySpec; noun: string } | null {
  const t = ` ${text.toLowerCase()} `;
  let best: { entity: EntitySpec; at: number; noun: string } | null = null;
  for (const e of ENTITIES) {
    for (const n of e.nouns) {
      const at = t.indexOf(` ${n} `);
      if (at === -1) continue;
      if (!best || at < best.at) best = { entity: e, at, noun: n };
    }
  }
  return best ? { entity: best.entity, noun: best.noun } : null;
}

/**
 * How many distinct sets of rows this vocabulary can pick out.
 *
 * The census needs this because "how many commands" is a question about
 * combinations, and counting entries in a file answers a different one.
 * Every clause is optional and independent, so the total is the product
 * of the states each clause can be in.
 *
 * Counted per entity against the columns that entity actually has, so a
 * social post is not credited with a fleet size. Deliberately
 * conservative at each step: three numeric magnitudes rather than every
 * number somebody could type, four time windows rather than every one.
 * The real figure is larger and unbounded, which is the point, but a
 * number nobody can check is worth nothing.
 */
export function selectionSpace(entity: EntitySpec): number {
  const cols = new Set(
    (TABLES.find((t) => t.table === entity.table)?.columns ?? []).map((c) => c.name),
  );
  const owns = (list: { column: string }[]) => list.filter((x) => cols.has(x.column)).length;

  // Absent, empty, or present.
  const nullable = 3 ** NULLABLE_COUNT(entity);
  // Absent, or over/under at three rough magnitudes.
  const compare = 7 ** owns(COMPARABLE);
  // Absent, never, or before/after at four windows.
  const dated = 9 ** owns(DATED);
  // Every value of every vocabulary filter, or none of them.
  const vocab = entity.filters.reduce(
    (n, f) => n * (f.vocabulary ? new Set(Object.values(f.vocabulary)).size + 1 : 1), 1,
  );
  const owner = entity.filters.some((f) => f.key === 'assigned' || f.key === 'rep') ? 4 : 1;
  const place = entity.filters.some((f) => f.key === 'location')
    ? new Set(Object.values(DEPOTS)).size + 1 : 1;

  const total = nullable * compare * dated * vocab * owner * place;
  return Number.isFinite(total) ? total : Number.MAX_SAFE_INTEGER;
}

/** The clause kinds, for the census to show its working. */
export function clauseCounts(entity: EntitySpec) {
  const cols = new Set(
    (TABLES.find((t) => t.table === entity.table)?.columns ?? []).map((c) => c.name),
  );
  return {
    nullable: NULLABLE_COUNT(entity),
    comparable: COMPARABLE.filter((x) => cols.has(x.column)).length,
    dated: DATED.filter((x) => cols.has(x.column)).length,
  };
}

export const SELECTOR_CLAUSES = {
  nullable: Math.max(...ENTITIES.map(NULLABLE_COUNT)),
  comparable: COMPARABLE.length,
  dated: DATED.length,
};
