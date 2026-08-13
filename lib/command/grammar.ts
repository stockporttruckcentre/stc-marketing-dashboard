/* =============================================================
   The grammar.

   Ten sentences were put to this engine that had never appeared in any
   test, lexicon or example. It scored zero, and three of the ten came
   back meaning the opposite of what was typed: "isn't sold" returned
   sold trailers, "except trailers" returned trailers, "price hasn't been
   entered" returned a total of prices.

   Every one of those failures was a missing OPERATOR, not a missing
   word. No number of aliases fixes "cheapest", because cheapest is not a
   thing to look up, it is something you do to an attribute.

     cheapest        order by an attribute, ascending, take one
     five            take five
     except          invert whatever follows
     newest first    order by a date, descending
     DAF vs Volvo    group by an attribute and compare the groups
     stock age       an attribute computed from another one
     not entered     that attribute is empty

   Seven operators. They apply to any attribute the data declares, in any
   combination, which is what makes "the five cheapest available rigids"
   work without anybody writing that sentence down. It is four
   independent facts that happen to appear together, and so are the
   several thousand other sentences built from the same four.

   That is the difference between a grammar and a phrasebook. A
   phrasebook grows by one entry per sentence and never finishes. A
   grammar grows by one entry per idea, and the sentences come free.

   The first version of this file got that wrong in miniature. It listed
   "longest in stock", "been sitting longest" and "longest on the yard"
   as three superlatives, so "what's been sitting in Stockport longest"
   matched none of them: the words were the same and the order was not.
   A superlative carries a DIRECTION and the KIND of attribute it wants.
   Which attribute is the sentence's business, not the operator's.

   Nothing here knows about trailers. Operators take a kind and return a
   modifier, so the day trucks arrive with a mileage column, "highest
   mileage" works without a line being added.
   ============================================================= */

/** What kind of column a superlative is reaching for. */
export type Wants = 'money' | 'date' | 'duration' | 'any';

/** What an operator does to a query, once the attribute is known. */
export type Operation =
  /** Sort by an attribute. `wants` binds it when the sentence names none. */
  | { op: 'order'; direction: 'asc' | 'desc'; wants: Wants; label: string; at: number }
  /** Take the first n rows after ordering. */
  | { op: 'limit'; n: number; label: string; at: number }
  /** Everything the clause from `at` to `until` does NOT describe. */
  | { op: 'negate'; label: string; at: number; until: number }
  /** Split the answer by an attribute and show the groups side by side. */
  | { op: 'compare'; against: string[]; label: string; at: number }
  /** An attribute computed from another rather than stored. */
  | { op: 'derive'; id: string; from: string; how: How; label: string; at: number }
  /**
   * That attribute holds nothing, or holds something.
   *
   * `hint` is the words that followed a "with no", when the sentence
   * named the attribute there rather than anywhere else. The grammar
   * cannot know whether "refurb cost" is a column; it can know that
   * whatever follows "with no" is the thing said to be absent.
   */
  | { op: 'empty'; filled: boolean; label: string; at: number; hint?: string };

/** How a derived attribute is computed from the column it comes from. */
export type How = 'days since' | 'days until' | 'ratio';

/* -------------------------------------------------------------
   Superlatives.

   Direction plus the kind of thing wanted. "Cheapest" wants money and
   points up; "dearest" wants money and points down; "longest" wants a
   duration, and which duration is whatever the sentence is about.

   `any` means the sentence has to name the attribute itself, which is
   why "highest mileage" and "highest profit" both work and "highest" on
   its own does not order anything.
   ------------------------------------------------------------- */
export const SUPERLATIVES: {
  words: string[]; direction: 'asc' | 'desc'; wants: Wants; label: string;
}[] = [
  { words: ['cheapest', 'least expensive', 'lowest priced', 'lowest price', 'best value',
            'best price', 'keenest'],
    direction: 'asc', wants: 'money', label: 'cheapest' },
  { words: ['most expensive', 'dearest', 'priciest', 'highest priced', 'highest price',
            'top priced', 'costliest'],
    direction: 'desc', wants: 'money', label: 'most expensive' },
  { words: ['newest', 'latest', 'most recent', 'freshest', 'just in', 'last in'],
    direction: 'desc', wants: 'date', label: 'newest' },
  { words: ['oldest', 'earliest', 'first in'],
    direction: 'asc', wants: 'date', label: 'oldest' },
  /* Duration words. "Longest" and "stalest" ask how long something has
     been the way it is, which is a derived attribute rather than a
     stored one. */
  { words: ['longest', 'longest standing', 'stalest', 'slowest moving', 'been here longest'],
    direction: 'desc', wants: 'duration', label: 'longest' },
  { words: ['shortest', 'quickest', 'fastest moving'],
    direction: 'asc', wants: 'duration', label: 'shortest' },
  { words: ['highest', 'biggest', 'largest', 'greatest', 'heaviest'],
    direction: 'desc', wants: 'any', label: 'highest' },
  { words: ['lowest', 'smallest', 'fewest', 'lightest'],
    direction: 'asc', wants: 'any', label: 'lowest' },
];

/* -------------------------------------------------------------
   Ordering without a superlative. "Newest first", "by price descending".
   ------------------------------------------------------------- */
const ORDER_WORDS: { words: string[]; direction: 'asc' | 'desc'; wants: Wants }[] = [
  { words: ['newest first', 'most recent first', 'latest first', 'newest at the top'],
    direction: 'desc', wants: 'date' },
  { words: ['oldest first', 'earliest first', 'oldest at the top'],
    direction: 'asc', wants: 'date' },
  /* A price said as an ordering. "Cheapest first" names the attribute
     as surely as "cheapest" does, and leaving it as `any` meant the
     sentence sorted by nothing at all. */
  { words: ['dearest first', 'most expensive first', 'priciest first'],
    direction: 'desc', wants: 'money' },
  { words: ['cheapest first', 'lowest priced first', 'least expensive first'],
    direction: 'asc', wants: 'money' },
  { words: ['descending', 'high to low', 'biggest first', 'highest first', 'most first',
            'largest first', 'top down'],
    direction: 'desc', wants: 'any' },
  { words: ['ascending', 'low to high', 'smallest first', 'lowest first', 'least first'],
    direction: 'asc', wants: 'any' },
];

/* -------------------------------------------------------------
   Limits.
   ------------------------------------------------------------- */
const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, hundred: 100,
};

const NOUNISH =
  String.raw`(?:trailers?|units?|vehicles?|customers?|contacts?|companies|firms|records?|rows?|results?|posts?|deals?|leads?|quotes?|meetings?|of them)`;

/* -------------------------------------------------------------
   Negation.

   The dangerous one. Three of the ten failures were an inversion, and an
   inverted answer is worse than no answer because it looks right.

   Two forms, both explicit. A general "not" rule is not safe: a company
   called Nottingham, a status called "not started", a depot with "north"
   in it would all flip a query silently.

   Scope matters as much as detection. "Except trailers that's available"
   inverts the trailers, not the availability, so a negation runs from
   where it appears to the end of its clause and only the filters inside
   that span are inverted.
   ------------------------------------------------------------- */
const NEGATORS = [
  'except for', 'except', 'excluding', 'apart from', 'other than', 'but not',
  'not including', 'ignoring', 'leaving out', 'excl', 'aside from', 'besides',
  'anything but', 'everything but', 'rather than', 'instead of',
];

/** Contracted negatives attached to a verb: isn't sold, hasn't been entered. */
const NEGATED_VERB =
  /\b(is|are|was|were|has|have|had|does|do|did|will|would|can|could|been)\s*(?:n[o’']?t|not)\b/i;

/** Where a negated clause stops. A comma, or a joining word. */
const CLAUSE_END = /[,;.]|\b(?:and|but|with|then|order(?:ed)? by|sorted by)\b/;

/* -------------------------------------------------------------
   Comparison. "DAF versus Volvo", "Carrington against Hyde".
   ------------------------------------------------------------- */
const COMPARATORS = ['versus', 'vs', 'v', 'against', 'compared to', 'compared with',
                     'next to', 'side by side with'];

/* -------------------------------------------------------------
   Emptiness.

   "Price hasn't been entered" is not a question about price. It is a
   question about which rows have none, and answering it with a total of
   the prices that ARE there is both wrong and plausible.

   The words are about the act of filling a field in, so they compose
   with negation rather than duplicating it: "entered" means present,
   "hasn't been entered" means absent, and one list covers both.
   ------------------------------------------------------------- */
const FILLED_WORDS = [
  'entered', 'filled in', 'filled', 'set', 'populated', 'recorded', 'completed',
  'been given', 'been added', 'added yet', 'in there', 'on it', 'against it',
  'been put in', 'specified', 'listed',
];
/** Absence said directly, without a negation to invert. */
const EMPTY_WORDS = [
  'missing', 'blank', 'empty', 'unset', 'not set', 'no value', 'nothing in',
  'left blank', 'left empty', 'tbc', 'unknown',
];

/* -------------------------------------------------------------
   Derived attributes.

   Things people ask about that no column holds. Stock age is the obvious
   one: nobody stores it, everybody asks for it, and it is a subtraction
   from a date that is stored.

   `near` is what makes a duration superlative bind without the attribute
   being named. "What's been sitting longest" contains no attribute at
   all, and `sitting` is the word that says which duration is meant.
   ------------------------------------------------------------- */
export const DERIVED: {
  id: string; on: string[]; words: string[]; near: string[];
  from: string; how: How; label: string;
}[] = [
  { id: 'stock_age', on: ['trailers'],
    words: ['stock age', 'days in stock', 'age in stock', 'how long in stock',
            'time on the yard', 'days on the yard', 'time in stock', 'age of the stock'],
    near: ['sitting', 'sat', 'standing', 'stood', 'yard', 'stock', 'here', 'unsold', 'shifted'],
    from: 'received_date', how: 'days since', label: 'stock age' },

  { id: 'days_since_contact', on: ['contacts', 'deals'],
    words: ['days since contact', 'time since contact', 'how long since we spoke',
            'how long since contact', 'days since we spoke'],
    near: ['contacted', 'spoken', 'spoke', 'touched', 'quiet', 'heard'],
    from: 'last_contact', how: 'days since', label: 'days since contact' },

  { id: 'days_to_mot', on: ['trailers'],
    words: ['days to mot', 'mot due in', 'how long until mot', 'time until mot',
            'mot remaining', 'days until mot'],
    near: ['mot'],
    from: 'mot_date', how: 'days until', label: 'days until MOT' },

  { id: 'margin_pct', on: ['trailers', 'deals'],
    words: ['margin percent', 'margin percentage', 'profit percent', 'profit percentage',
            'percentage margin', 'margin %'],
    near: [],
    from: 'profit', how: 'ratio', label: 'margin percentage' },
];

/* =============================================================
   Reading them.
   ============================================================= */

const soften = (s: string) =>
  ` ${s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9£$€'% ]+/g, ' ')
       .replace(/\s+/g, ' ').trim()} `;

export type Grammar = {
  operations: Operation[];
  /** Words the grammar accounted for, so nothing reads them twice. */
  consumed: string[];
  /** The text of each negated clause, as it was written. */
  negatedText: string[];
  /**
   * Is this word inside something that was negated?
   *
   * By word rather than by index deliberately. The caller reads a
   * politeness-stripped copy of the sentence, so its offsets and the
   * grammar's do not line up, and scoping a negation by a number that
   * means something different in each copy is how a filter ends up
   * inverted for a reason nobody can trace.
   */
  negates: (word: string) => boolean;
};

/**
 * Every operator a sentence carries.
 *
 * Longer phrases are tried before shorter ones so "most recent" is not
 * read as "most". Beyond that the operators are independent and compose
 * in any combination, which is the point.
 */
export function readGrammar(input: string): Grammar {
  const t = soften(input);
  const operations: Operation[] = [];
  const consumed: string[] = [];

  const find = (phrase: string): number => {
    const at = t.indexOf(` ${phrase} `);
    return at === -1 ? -1 : at + 1;
  };
  const spent = (at: number, len: number) =>
    consumed.some((c) => {
      const ca = t.indexOf(` ${c} `);
      return ca >= 0 && at >= ca && at < ca + c.length + 2;
    });

  /* --- derived attributes, named outright ---
     Before anything else: "stock age" contains "stock", and letting the
     entity reader see it first turns a computed attribute into a status
     filter on everything sitting in the yard. */
  for (const d of DERIVED) {
    for (const w of [...d.words].sort((a, b) => b.length - a.length)) {
      const at = find(w);
      if (at === -1) continue;
      operations.push({ op: 'derive', id: d.id, from: d.from, how: d.how, label: d.label, at });
      consumed.push(w);
      break;
    }
  }

  /* --- explicit ordering, before superlatives ---
     "Newest first" is a sort. "Newest" is a single trailer. Reading the
     superlative first turned "vehicles added between May and July,
     newest first" into the one newest vehicle, which is a list of one
     where a list was asked for. The longer phrase is the more specific
     instruction and goes first. */
  const orders = ORDER_WORDS
    .flatMap((o) => o.words.map((w) => ({ w, o })))
    .sort((a, b) => b.w.length - a.w.length);
  for (const { w, o } of orders) {
    const at = find(w);
    if (at === -1) continue;
    operations.push({ op: 'order', direction: o.direction, wants: o.wants, label: w, at });
    consumed.push(w);
    break;
  }

  /* --- superlatives --- */
  const supers = SUPERLATIVES
    .flatMap((s) => s.words.map((w) => ({ w, s })))
    .sort((a, b) => b.w.length - a.w.length);
  for (const { w, s } of supers) {
    if (operations.some((o) => o.op === 'order')) break;
    const at = find(w);
    if (at === -1 || spent(at, w.length)) continue;
    operations.push({ op: 'order', direction: s.direction, wants: s.wants, label: s.label, at });
    consumed.push(w);

    /* A duration superlative with no derived attribute named needs one.
       "What's been sitting longest" says `sitting`, and that is enough
       to say which duration without naming it. */
    if (s.wants === 'duration' && !operations.some((o) => o.op === 'derive')) {
      const d = DERIVED.find((x) => x.near.some((n) => find(n) !== -1));
      if (d) {
        operations.push({ op: 'derive', id: d.id, from: d.from, how: d.how, label: d.label, at });
      }
    }
    break;
  }

  /* --- limits ---
     A number in front of a countable noun, after a taking word, or in
     front of a superlative. The same care as everywhere else: "under 25
     thousand" is not a request for twenty five rows, and neither is
     "older than 2022". */
  const numberWords = Object.keys(WORD_NUMBERS).join('|');
  const NUM = String.raw`(\d{1,4}|${numberWords})`;
  const superWords = supers.map((s) => s.w.replace(/ /g, String.raw`\s`)).join('|');

  const shapes = [
    new RegExp(String.raw`\b(?:top|first|last|limit|best|worst)\s+${NUM}\b`),
    new RegExp(String.raw`\b${NUM}\s+(?:${superWords})\b`),
    new RegExp(String.raw`\b(?:show me|give me|find|list|get me|pull|bring up|bring me)\s+${NUM}\b`),
    new RegExp(String.raw`\b${NUM}\s+(?:\w+\s+){0,3}?${NOUNISH}\b`),
  ];
  let n: number | null = null;
  let limitAt = -1;
  for (const re of shapes) {
    const m = t.match(re);
    if (!m) continue;
    const v = /^\d+$/.test(m[1]) ? Number(m[1]) : WORD_NUMBERS[m[1]];
    if (!Number.isFinite(v) || v <= 0) continue;
    n = v; limitAt = m.index ?? -1;
    break;
  }
  /* A superlative on its own means one of them. "The cheapest" is a
     single trailer; "the five cheapest" is five, and the number already
     found above wins. */
  const superlative = operations.find((o) => o.op === 'order' && SUPERLATIVES.some(
    (s) => s.label === o.label));
  if (n == null && superlative) { n = 1; limitAt = superlative.at; }

  if (n != null) {
    operations.push({ op: 'limit', n: Math.min(n, 500), label: n === 1 ? 'one' : `top ${n}`, at: limitAt });
  }

  /* --- negation, with scope ---
     Explicit only, and bounded. Everything from the negator to the end
     of its clause is what gets inverted, so "except trailers that's
     available" inverts the trailers and leaves the availability alone. */
  const negations: { at: number; until: number; label: string }[] = [];
  for (const w of [...NEGATORS].sort((a, b) => b.length - a.length)) {
    const at = find(w);
    if (at === -1) continue;
    if (negations.some((x) => at >= x.at && at < x.until)) continue;
    const rest = t.slice(at + w.length);
    const end = rest.search(CLAUSE_END);
    negations.push({ at, until: end === -1 ? t.length : at + w.length + end, label: w });
    consumed.push(w);
  }
  const verbNeg = NEGATED_VERB.exec(t);
  if (verbNeg && !negations.some((x) => verbNeg.index >= x.at && verbNeg.index < x.until)) {
    /* A contracted negative attaches backwards as well as forwards.
       "Price hasn't been entered" negates `entered`, which is after it;
       "the vehicle that isn't sold" negates `sold`, also after it. The
       span therefore starts at the verb and runs to the clause end. */
    const rest = t.slice(verbNeg.index + verbNeg[0].length);
    const end = rest.search(CLAUSE_END);
    negations.push({
      at: verbNeg.index,
      until: end === -1 ? t.length : verbNeg.index + verbNeg[0].length + end,
      label: verbNeg[0].trim(),
    });
  }
  for (const neg of negations) {
    operations.push({ op: 'negate', label: neg.label, at: neg.at, until: neg.until });
  }
  const negatedText = negations.map((x) => t.slice(x.at, x.until));
  const negatedAt = (index: number) => negations.some((x) => index >= x.at && index < x.until);
  const negates = (word: string) => {
    const w = word.toLowerCase().trim();
    if (!w) return false;
    return negatedText.some((span) => new RegExp(`\\b${
      w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(span));
  };

  /* --- emptiness ---
     Composed rather than listed: "entered" means the field has a value,
     and a negation over it means the opposite. Said directly, "blank"
     and "missing" mean absent with nothing to invert.

     "With no refurb cost", "without a customer", "that have no MOT" go
     first, because they are the more specific shape and they name the
     column in the same breath. Reading them second turned "trailers
     with no refurb completed" into a search for trailers where the
     refurb IS completed, on the strength of the word "completed". */
  let emptyAt = -1; let filled: boolean | null = null;
  let hint: string | undefined;

  const noneOf = t.match(
    /\b(?:with no|with none of|without any|without an|without a|without|having no|that have no|that has no|missing a|missing an)\s+([a-z][a-z0-9 ]{2,40})/);
  if (noneOf) {
    /* Captured to the end of the clause rather than to the first short
       word. The lazy version stopped at "at", "on" or "in", which
       turned "no refurb costs at sale" into "no refurb costs" and
       answered about a different column. Whatever reads the hint
       matches the longest column name the phrase starts with, so
       trailing words are harmless and a truncated one is not. */
    hint = noneOf[1].trim();
    filled = false; emptyAt = noneOf.index ?? -1;
    consumed.push(noneOf[0].trim());
  }

  if (filled === null) {
    for (const w of [...FILLED_WORDS].sort((a, b) => b.length - a.length)) {
      const at = find(w);
      if (at === -1) continue;
      emptyAt = at; filled = !negatedAt(at);
      consumed.push(w);
      break;
    }
  }
  if (filled === null) {
    for (const w of [...EMPTY_WORDS].sort((a, b) => b.length - a.length)) {
      const at = find(w);
      if (at === -1) continue;
      emptyAt = at; filled = negatedAt(at);
      consumed.push(w);
      break;
    }
  }

  if (filled !== null) {
    operations.push({
      op: 'empty', filled,
      label: filled ? 'has a value' : 'has nothing in it',
      at: emptyAt, hint,
    });
  }

  /* --- comparison --- */
  for (const c of [...COMPARATORS].sort((a, b) => b.length - a.length)) {
    const m = t.match(new RegExp(String.raw`\b([a-z0-9']{2,20})\s+${c}\s+([a-z0-9']{2,20})\b`));
    if (!m) continue;
    const [left, right] = [m[1], m[2]];
    if (left === right) continue;
    operations.push({
      op: 'compare', against: [left, right],
      label: `${left} against ${right}`, at: m.index ?? -1,
    });
    consumed.push(c);
    break;
  }

  return { operations, consumed, negatedText, negates };
}

/** Plain English, for showing what was understood before it runs. */
export function describeGrammar(ops: Operation[]): string {
  return ops.map((o) => {
    switch (o.op) {
      case 'order': return `${o.label} first`;
      case 'limit': return o.n === 1 ? 'just the one' : `only ${o.n}`;
      case 'negate': return `not ${o.label}`;
      case 'compare': return o.against.join(' against ');
      case 'derive': return o.label;
      case 'empty': return o.label;
    }
  }).join(', ');
}
