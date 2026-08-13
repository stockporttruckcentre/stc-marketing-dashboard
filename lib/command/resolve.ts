/* =============================================================
   Understanding, rather than matching.

   The engine underneath this used to be greedy and single pass. It
   picked an entity, then walked the filters taking the first word that
   matched each one, never looked back, and never considered that the
   sentence might mean something else. Every collision then needed a hand
   written tiebreak, and every tiebreak created the next collision. That
   is not a vocabulary problem and no amount of vocabulary fixes it.

   "Profit" is the example that makes it obvious. Profit is on a trailer,
   on a deal, on the maintenance side, and computed from sale price less
   book value. Matching the word to a column is impossible in principle,
   because the word does not carry the answer.

   The sentence does. "Profit on the trailers we sold Dawson last month"
   contains `trailers` and a customer and a period, and those make one
   reading overwhelmingly better than the others. The old engine threw
   that away by deciding the entity first.

   So this builds EVERY plausible reading of the whole sentence, scores
   each on how much of the sentence it actually explains, and then does
   one of two things:

     one reading clearly wins   run it
     two are close             ask, naming both, in one short question

   Asking is not a failure. It is what a person does when somebody says
   "what's the profit" across a desk, and it is the difference between a
   tool that understands and a tool that guesses confidently.
   ============================================================= */
import { ENTITIES, MEASURE_WORDS, type EntitySpec, type Measure } from './schema';
import { deFluff, isReservedWord } from './lexicon';

/** One way the sentence could be read. */
export type Reading = {
  entity: EntitySpec;
  measure: Measure;
  /** The column an ambiguous word bound to, when one did. */
  amountColumn?: string;
  amountLabel?: string;
  /**
   * The words of the sentence this reading accounts for. Coverage is the
   * whole basis of the score: a reading that explains nine words of a ten
   * word sentence is better than one that explains three, and that is a
   * judgement about the sentence rather than about the vocabulary.
   */
  explains: Set<string>;
  score: number;
  /** Plain English, used to ask the question when two readings are close. */
  describe: string;
};

export type Resolution = {
  best: Reading;
  runnerUp?: Reading;
  /** True when the top two are too close to choose between. */
  ambiguous: boolean;
  /** The question to ask, when it is. */
  question?: string;
  options?: { label: string; hint: string; reading: Reading }[];
};

const words = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9£$€ ]+/g, ' ').split(/\s+/).filter(Boolean);

/**
 * Words that tie a sentence to one side of the business.
 *
 * These are the evidence that resolves "profit" without anybody having
 * to say which profit. Nobody says "trailer profit"; they say "profit on
 * what we sold", and the word `sold` next to `trailers` is the signal.
 */
const CONTEXT: { words: string[]; entity: string; weight: number; why: string }[] = [
  { words: ['trailer', 'trailers', 'unit', 'units', 'stock', 'stocklist', 'yard', 'chassis',
            'curtainsider', 'fridge', 'flatbed', 'skeletal', 'tipper', 'box'],
    entity: 'trailers', weight: 6, why: 'the stock list' },
  { words: ['depot', 'carrington', 'bredbury', 'hyde', 'haydock', 'atherton', 'dukinfield'],
    entity: 'trailers', weight: 2, why: 'a depot' },
  { words: ['nbv', 'book', 'refurb', 'mot', 'make', 'model'],
    entity: 'trailers', weight: 4, why: 'trailer detail' },

  { words: ['deal', 'deals', 'proposal', 'proposals', 'quote', 'quoted', 'pipeline',
            'opportunity', 'enquiry', 'lead', 'leads'],
    entity: 'deals', weight: 6, why: 'your tracker' },
  { words: ['commission', 'my', 'mine', 'tracker'],
    entity: 'deals', weight: 3, why: 'your own deals' },
  { words: ['maintenance', 'workshop', 'service', 'servicing', 'trukplan', 'repair'],
    entity: 'deals', weight: 6, why: 'the maintenance side' },

  { words: ['customer', 'customers', 'contact', 'contacts', 'company', 'companies',
            'account', 'accounts', 'client', 'clients', 'prospect'],
    entity: 'contacts', weight: 6, why: 'the CRM' },
  { words: ['fleet', 'turnover', 'employees', 'email', 'phone'],
    entity: 'contacts', weight: 4, why: 'customer detail' },

  { words: ['post', 'posts', 'social', 'linkedin', 'facebook', 'instagram', 'approval'],
    entity: 'posts', weight: 6, why: 'the social planner' },
  { words: ['meeting', 'meetings', 'diary', 'calendar', 'appointment', 'visit'],
    entity: 'meetings', weight: 6, why: 'the calendar' },
];

/**
 * Every reading of a sentence, best first.
 *
 * One reading per entity that the sentence gives any evidence for, with
 * the ambiguous words bound to that entity's own columns. Scored on
 * evidence, not on which entity happened to be listed first.
 */
export function readings(input: string): Reading[] {
  const text = deFluff(input) || input;
  const w = words(text);
  const present = new Set(w);
  const out: Reading[] = [];

  for (const entity of ENTITIES) {
    const explains = new Set<string>();
    let score = 0;

    /* --- does the sentence name this thing outright --- */
    for (const noun of entity.nouns) {
      if (present.has(noun)) { score += 10; explains.add(noun); }
    }

    /* --- context words that lean this way --- */
    for (const c of CONTEXT) {
      if (c.entity !== entity.id) continue;
      for (const cw of c.words) {
        if (!present.has(cw)) continue;
        score += c.weight;
        explains.add(cw);
      }
    }

    /* --- a value only this entity has ---
       "How many quoted" names no thing at all, and only the deal statuses
       contain the word, so the sentence is about deals. That is evidence
       nobody had to write down as a rule. */
    for (const f of entity.filters) {
      for (const word of Object.keys(f.vocabulary ?? {})) {
        if (word.length < 3 || !present.has(word)) continue;
        const shared = ENTITIES.filter((e) => e.filters.some(
          (x) => Object.keys(x.vocabulary ?? {}).includes(word))).length;
        // A word only one entity claims is strong evidence. A word four
        // of them claim is none at all.
        score += shared === 1 ? 6 : 1;
        explains.add(word);
      }
    }

    /* --- which number, if the sentence names one ---
       This is where profit lands. The word is worth almost nothing on its
       own; what makes a reading good is everything ELSE in the sentence
       agreeing with it. */
    let amountColumn: string | undefined;
    let amountLabel: string | undefined;
    for (const a of entity.amounts) {
      for (const aw of a.words) {
        if (!present.has(aw) && !text.toLowerCase().includes(aw)) continue;
        amountColumn = a.column;
        amountLabel = a.label;
        explains.add(aw);
        // Deliberately small. An ambiguous money word must never be the
        // reason one reading beats another; the context around it is.
        score += 2;
        break;
      }
      if (amountColumn) break;
    }

    const { measure } = pickMeasure(text, !!amountColumn);
    if (measure !== 'list') { score += 2; }

    /* --- what it could not account for ---
       A reading that leaves half the sentence unexplained is a worse
       reading, even if everything it did explain fitted well. */
    const meaningful = w.filter((x) => x.length >= 3 && !isReservedWord(x));
    const unexplained = meaningful.filter((x) => !explains.has(x)).length;
    score -= Math.min(unexplained, 6);

    if (score <= 0) continue;
    out.push({
      entity, measure, amountColumn, amountLabel, explains, score,
      describe: describe(entity, measure, amountLabel),
    });
  }

  return out.sort((a, b) => b.score - a.score);
}

/**
 * The reading to act on, or the question to ask instead.
 *
 * The gap is what matters, not the winner's score. Two readings four
 * points apart on a sentence that gave twelve points of evidence is a
 * clear answer; two readings one point apart is a coin toss, and
 * flipping it silently is how somebody ends up quoting the wrong number
 * in a meeting.
 */
export function resolve(input: string): Resolution | null {
  const all = readings(input);
  if (!all.length) return null;

  const [best, runnerUp] = all;
  const gap = runnerUp ? best.score - runnerUp.score : Infinity;

  /* Only worth asking when the thing in question is genuinely different.
     Two readings of the same entity are not a question, they are the
     same answer twice. */
  const differentEntity = runnerUp && runnerUp.entity.id !== best.entity.id;
  const ambiguous = !!(differentEntity && gap < 4);

  if (!ambiguous) return { best, runnerUp, ambiguous: false };

  const noun = sharedWord(best, runnerUp!) ?? 'that';
  return {
    best,
    runnerUp,
    ambiguous: true,
    question: `Which ${noun}?`,
    options: [best, runnerUp!].map((r) => ({
      label: r.describe,
      hint: whyFor(r),
      reading: r,
    })),
  };
}

/* ------------------------------------------------------------- */

function pickMeasure(text: string, namesAnAmount: boolean): { measure: Measure } {
  const t = text.toLowerCase();
  let best: { measure: Measure; at: number; len: number } | null = null;
  for (const m of MEASURE_WORDS) {
    for (const word of m.words) {
      const at = t.indexOf(word);
      if (at === -1) continue;
      if (at > 0 && /[a-z0-9]/.test(t[at - 1])) continue;
      const after = t[at + word.length];
      if (after && /[a-z0-9]/.test(after)) continue;
      if (!best || at < best.at || (at === best.at && word.length > best.len)) {
        best = { measure: m.measure, at, len: word.length };
      }
    }
  }
  const measure = best?.measure ?? 'list';
  // Naming a figure and not asking for rows means you want the figure.
  if (measure === 'list' && namesAnAmount && !/\b(list|which|show me the rows|each)\b/.test(t)) {
    return { measure: 'sum' };
  }
  return { measure };
}

function describe(entity: EntitySpec, measure: Measure, amountLabel?: string): string {
  const what = amountLabel ?? entity.label;
  switch (measure) {
    case 'count': return `Count of ${entity.label}`;
    case 'sum': return `Total ${what} on ${entity.label}`;
    case 'avg': return `Average ${what} on ${entity.label}`;
    default: return `List of ${entity.label}`;
  }
}

/** The ambiguous word both readings are fighting over. */
function sharedWord(a: Reading, b: Reading): string | null {
  if (a.amountLabel && a.amountLabel === b.amountLabel) return a.amountLabel;
  for (const x of a.explains) if (b.explains.has(x)) return x;
  return null;
}

/** Why this reading, in the words of the sentence that produced it. */
function whyFor(r: Reading): string {
  const c = CONTEXT.find((x) => x.entity === r.entity.id
    && x.words.some((w) => r.explains.has(w)));
  return c ? `From ${c.why}` : `On the ${r.entity.label}`;
}
