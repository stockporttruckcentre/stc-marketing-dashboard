/* =============================================================
   Suggestions built rather than listed.

   The bug this exists to fix: typing "export" produced nothing. The
   action registry only scored a hit when an object word matched, so a
   bare verb fell straight through to "nothing matches that yet", and
   the one thing a command bar must never do is tell somebody their
   perfectly reasonable word is not a word.

   The deeper problem underneath it: even with the verb fixed, "export"
   would have offered two entries called Export a customer and Export a
   list. That is not what somebody means. They mean "what can I export",
   and the honest answer is hundreds of things: trailers in stock,
   trailers at a depot, curtainsiders sold this month, customers in
   Carrington, customers nobody has rung in a fortnight, everybody I have
   met this year.

   Listing those by hand is the lookup table problem again. So they are
   generated from the same data dictionary the query engine already uses.
   Every entity times every filter value times every period is already
   thousands of real, runnable sentences. This picks the ones worth
   showing for what has been typed so far and narrows as more is typed.

   That is the shape a command bar should have: type a verb, see what
   the verb can do. Type more, see less. Never a dead end.
   ============================================================= */
import { ENTITIES, type EntitySpec } from './schema';
import { DEPOTS, STATE_LABEL } from './lexicon';
import type { CrmCapabilities, CrmCapability } from '@/lib/crm/permissions';

export type Composed = {
  /** The sentence this runs. Put straight into the bar. */
  phrase: string;
  label: string;
  sub: string;
  score: number;
};

/** What a person is trying to do, from the verb alone. */
type Operation = {
  id: string;
  /** Words that start this operation. */
  verbs: string[];
  /** How the generated sentence begins. */
  stem: string;
  label: (what: string) => string;
  /** How this operation says "the ones that are mine". */
  mine: (noun: string) => string;
  capability?: CrmCapability;
};

const OPERATIONS: Operation[] = [
  {
    id: 'export', stem: 'export', capability: 'crm.export',
    verbs: ['export', 'download', 'save', 'extract', 'pull', 'csv', 'spreadsheet', 'send me', 'get me a list'],
    label: (what) => `Export ${what}`, mine: (n: string) => `export my ${n}`,
  },
  {
    id: 'count', stem: 'how many',
    verbs: ['how many', 'count', 'number of', 'how much stock', 'total number', 'howmany'],
    // "how many my trailers" is not English. Every operation says this
    // its own way, which is why it is a function rather than a prefix.
    label: (what) => `Count ${what}`, mine: (n: string) => `how many of my ${n}`,
  },
  {
    id: 'list', stem: 'list',
    verbs: ['list', 'show', 'show me', 'which', 'what are', 'find', 'display', 'see'],
    label: (what) => `List ${what}`, mine: (n: string) => `list my ${n}`,
  },
  {
    id: 'value', stem: 'total value of',
    verbs: ['value of', 'worth', 'how much', 'total', 'revenue', 'turnover', 'sum'],
    label: (what) => `Value of ${what}`, mine: (n: string) => `total value of my ${n}`,
  },
];

/** Periods worth offering, in the order people actually ask for them. */
const PERIODS = [
  'this week', 'last week', 'this month', 'last month',
  'in the past 7 days', 'in the past 30 days', 'this year',
];

const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The distinct values a filter can take, as the words a person would type. */
function valuesFor(entity: EntitySpec, key: string): { word: string; label: string }[] {
  const spec = entity.filters.find((f) => f.key === key);
  if (!spec) return [];

  if (spec.vocabulary) {
    // One entry per distinct value, using the tidiest word that maps to it.
    const byValue = new Map<string, string>();
    for (const [word, value] of Object.entries(spec.vocabulary)) {
      const existing = byValue.get(value);
      if (!existing || word.length > existing.length) byValue.set(value, word);
    }
    return [...byValue.entries()].map(([value, word]) => ({
      word,
      label: STATE_LABEL[value] ?? word,
    }));
  }
  // Free text has no fixed list, except the places we know about.
  if (key === 'location') {
    const seen = new Set<string>();
    return Object.values(DEPOTS)
      .filter((d) => (seen.has(d) ? false : (seen.add(d), true)))
      .map((d) => ({ word: d.toLowerCase(), label: d }));
  }
  return [];
}

/**
 * Concrete, runnable suggestions for whatever has been typed so far.
 *
 * Narrows as it goes. "export" offers a spread across everything
 * exportable. "export customers" offers customer exports by status,
 * place and period. "export customers in carrington" offers periods and
 * the plain version. Nothing is ever a dead end.
 */
export function composeSuggestions(input: string, caps: CrmCapabilities, limit = 8): Composed[] {
  const q = fold(input);
  if (q.length < 2) return [];

  // Which operation, from the verb. Longest verb wins so "how much" is
  // not read as "how many".
  let op: Operation | null = null;
  let opHit = '';
  for (const o of OPERATIONS) {
    for (const v of o.verbs) {
      if (q.includes(v) && v.length > opHit.length) { op = o; opHit = v; }
    }
  }
  // Half typed counts too, so "expo" already offers exports.
  if (!op) {
    for (const o of OPERATIONS) {
      if (o.verbs.some((v) => v.length >= 4 && v.startsWith(q))) { op = o; opHit = q; break; }
    }
  }
  if (!op) return [];
  if (op.capability && !caps.has(op.capability)) return [];

  const rest = q.replace(opHit, ' ').replace(/\s+/g, ' ').trim();

  // Which thing, if they have said yet.
  let entity: EntitySpec | null = null;
  for (const e of ENTITIES) {
    if (e.nouns.some((n) => new RegExp(`\\b${n}\\b`).test(rest))) { entity = e; break; }
  }

  const out: Composed[] = [];
  const push = (phrase: string, label: string, sub: string, score: number) => {
    if (out.some((c) => c.phrase === phrase)) return;
    out.push({ phrase, label, sub, score });
  };

  const entities = entity ? [entity] : ENTITIES;

  for (const e of entities) {
    const noun = e.label;

    // The plain one first: everything of this kind.
    push(`${op.stem} ${noun}`, op.label(`all ${noun}`), 'Every record, no filter', entity ? 70 : 50);

    if (e.filters.some((f) => f.key === 'assigned' || f.key === 'rep')) {
      push(op.mine(noun), op.label(`my ${noun}`), 'Only your records', entity ? 66 : 45);
    }

    /* Interleaved rather than one dimension at a time.
       Taking eight status values before looking at location meant a
       customer export never offered a depot at all, and taking every
       filter before any period meant "everybody I have met this year"
       was unreachable. Both were asked for by name. Round robin across
       status, type, place, side and date, so the first handful somebody
       sees spans all five rather than exhausting one. */
    const perFilter = ['status', 'category', 'location', 'side'].map(
      (key) => valuesFor(e, key).slice(0, 6).map((v) => ({ key, v })),
    );
    const periodLane = (entity ? PERIODS : PERIODS.slice(0, 2))
      .map((p) => ({ key: 'period', v: { word: p, label: p } }));
    const lanes = [...perFilter, periodLane];

    const rounds = Math.max(0, ...lanes.map((l) => l.length));
    for (let i = 0; i < rounds; i++) {
      for (const list of lanes) {
        const item = list[i];
        if (!item) continue;
        const { key, v } = item;
        const where = key === 'location' ? `at ${v.word}` : v.word;
        push(
          `${op.stem} ${noun} ${where}`,
          op.label(`${noun} ${key === 'location' ? `at ${v.label}` : v.label}`),
          key === 'period' ? 'Filtered by date' : `Filtered by ${key}`,
          entity ? 62 : 40,
        );
      }
    }

    if (entity) {
      // Two filters at once, which is where the real questions live:
      // customers in a town nobody has rung this month, trailers of one
      // body type sold this year.
      for (const list of perFilter) {
        for (const { key, v } of list.slice(0, 4)) {
          const where = key === 'location' ? `at ${v.word}` : v.word;
          for (const p of PERIODS.slice(0, 4)) {
            push(
              `${op.stem} ${noun} ${where} ${p}`,
              op.label(`${noun} ${key === 'location' ? `at ${v.label}` : v.label} ${p}`),
              `Filtered by ${key} and date`,
              54,
            );
          }
        }
      }
    }
  }

  /* Anything already typed beyond the verb should pull matching
     suggestions up, so "export cust" surfaces the customer ones without
     needing the whole word. */
  const words = rest.split(' ').filter((w) => w.length >= 3);
  for (const c of out) {
    for (const w of words) {
      if (fold(c.phrase).includes(w)) c.score += 12;
      else if (fold(c.phrase).split(' ').some((p) => p.startsWith(w))) c.score += 8;
    }
  }

  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
