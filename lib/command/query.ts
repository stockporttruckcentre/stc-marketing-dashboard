/* =============================================================
   Query composition.

   Turns a sentence into a plan the server can run: which thing, which
   number, filtered how, grouped by what, over what period. One engine
   instead of an intent per question.

     "how many trailers in stock"          count trailers where status=in_stock
     "what are the sold trailers worth"    sum sales_price where status=sold
     "how many trailers by make"           count trailers grouped by make
     "average profit on sold trailers"     avg profit where status=sold
     "list my quoted proposals"            list deals where status=quoted, mine
     "how many Schmitz in Hyde"            count trailers make~Schmitz location~Hyde
   ============================================================= */
import { ENTITIES, MEASURE_WORDS, type EntitySpec, type Measure } from './schema';
import { extract } from './entities';
import { tokenise } from './normalise';
import {
  deFluff, readDepot, readPlaceAfterPreposition, readRep, readSize,
  STATE_PHRASES, STATE_LABEL, BODY_TYPES, isReservedWord,
} from './lexicon';
import { readGrammar, DERIVED, type Grammar, type How } from './grammar';
import { findValues } from './vocab';
import { columnNamed } from './attributes';

export type PlanFilter = {
  key: string; column: string;
  op: 'eq' | 'ilike' | 'gte' | 'lte' | 'anyOf' | 'empty' | 'present';
  value: string; label: string;
  /**
   * Where in the sentence the word that produced this filter sat.
   *
   * Negation needs it. "Everything except trailers that's available"
   * inverts the trailers and leaves the availability alone, and the only
   * thing that says which is which is where each word appeared relative
   * to the word "except".
   */
  at?: number;
  /** Match everything this filter does NOT describe. */
  negate?: boolean;
  /**
   * For `anyOf`: match any of these words in any of these columns.
   *
   * Body type is the reason this exists. A trailer's type is recorded in
   * `category` on some rows and in `model` on others, and `model` is the
   * one the team actually fills in. Filtering on `category` alone
   * answered "how many curtainsiders in stock" with 1 when the real
   * figure is in the thousands, which is the worst kind of wrong: a
   * confident number nobody would think to check.
   */
  columns?: string[];
  values?: string[];
};

export type QueryPlan = {
  entity: EntitySpec;
  measure: Measure;
  amountColumn?: string;
  amountLabel?: string;
  filters: PlanFilter[];
  groupBy?: { column: string; label: string };
  range?: { from: string; to: string; label: string };
  /**
   * Which date the period is measured against.
   *
   * "Vehicles added between May and July" is about the day they arrived.
   * The entity's default date is the day they left, so without this the
   * question came back with everything still in the yard excluded, and
   * nothing said why.
   */
  rangeColumn?: string;
  scope: 'mine' | 'all';
  /** Sort, from a superlative or an explicit ordering. */
  order?: { column: string; direction: 'asc' | 'desc'; label: string };
  /** How many rows to keep after sorting. */
  limit?: number;
  /**
   * An attribute nothing stores. Stock age is a subtraction from the
   * date a trailer arrived, and the answer is worked out on the rows
   * rather than asked of the database.
   */
  derived?: { id: string; from: string; how: How; label: string };
  /** Two values of one attribute, answered side by side. */
  compare?: { column: string; label: string; values: string[] };
  /**
   * What the sentence asked for that this app cannot answer.
   *
   * "The highest mileage vehicle that isn't sold" is three requests, and
   * two of them work. There is no mileage column here, so the ordering
   * has nowhere to go, and quietly returning unsorted rows would look
   * like an answer to the question that was asked. Saying which part
   * went unanswered is the difference between a tool that is honest
   * about its data and one that is confidently wrong about it.
   */
  unmet?: string[];
  /** Plain English summary, shown before it runs. */
  summary: string;
  confidence: number;
};

const MINE = /\b(my|mine|i|i've|i have|me)\b/i;
const ALL = /\b(all|company|everyone|team|total|whole|across)\b/i;

/**
 * Filters whose value is spread across several columns.
 *
 * Keyed by filter then entity, because the same idea lives in different
 * places on different tables. Only body type today, and it is enough on
 * its own to justify the mechanism: `category` is a tidy enum somebody
 * set up and `model` is where the team writes what the trailer actually
 * is, so the tidy one is nearly empty and the useful one was unread.
 */
const SPREAD_COLUMNS: Record<string, Record<string, string[]>> = {
  category: { trailers: ['category', 'model', 'description'] },
};

function pickMeasure(text: string): { measure: Measure; hit: string } {
  const t = text.toLowerCase();

  /* Where the word sits matters more than how long it is.
     Longest-match alone read "average profit on curtain trailers
     invoiced" as a sum, because "invoiced" is one letter longer than
     "average" and happened to also be a revenue word. What somebody
     asked for is at the front of the sentence: measures lead, and
     everything after the first few words is describing the rows.

     Within the same position band the longest phrase still wins, so
     "how many" beats "how much" on a sentence starting with either. */
  let best: { measure: Measure; hit: string; at: number } | null = null;
  for (const m of MEASURE_WORDS) {
    for (const w of m.words) {
      const at = t.indexOf(w);
      if (at === -1) continue;
      // Word boundaries, or "sum" matches inside "consumed".
      if (at > 0 && /[a-z0-9]/.test(t[at - 1])) continue;
      const after = t[at + w.length];
      if (after && /[a-z0-9]/.test(after)) continue;

      if (!best) { best = { measure: m.measure, hit: w, at }; continue; }
      // Earlier wins outright; a tie goes to the longer phrase.
      if (at < best.at || (at === best.at && w.length > best.hit.length)) {
        best = { measure: m.measure, hit: w, at };
      }
    }
  }
  return best ? { measure: best.measure, hit: best.hit } : { measure: 'list', hit: '' };
}

/**
 * Which thing is being asked about. Later mentions lose to earlier ones,
 * so "trailers sold to customers" is about trailers, not customers.
 */
function pickEntity(
  text: string,
  grammar?: Grammar,
): { entity: EntitySpec; at: number; noun: string } | null {
  const t = ` ${text.toLowerCase()} `;
  let best: { entity: EntitySpec; at: number; noun: string } | null = null;
  for (const e of ENTITIES) {
    for (const n of e.nouns) {
      const at = t.indexOf(` ${n} `);
      if (at === -1) continue;
      if (!best || at < best.at) best = { entity: e, at, noun: n };
    }
  }
  if (best) return best;

  // No noun naming the thing. "total commission this year" and "how many
  // new builds" are still answerable: infer from the vocabulary that only
  // one entity owns.
  for (const e of ENTITIES) {
    for (const a of e.amounts) {
      for (const w of a.words) {
        if (w.length > 4 && t.includes(` ${w} `)) return { entity: e, at: t.indexOf(w), noun: '' };
      }
    }
  }
  // A vocabulary word can name the thing on its own: "how many tautliners
  // sold this week" has no noun for a trailer in it anywhere.
  //
  // Three characters, not five, so "taut", "low" and "tip" are reachable,
  // but only when exactly one entity claims the word. Anything shared
  // stays ambiguous and is left alone rather than guessed at.
  const owners = new Map<string, EntitySpec[]>();
  for (const e of ENTITIES) {
    for (const f of e.filters) {
      for (const w of Object.keys(f.vocabulary ?? {})) {
        if (w.length < 3) continue;
        owners.set(w, [...(owners.get(w) ?? []), e]);
      }
    }
  }
  let bestWord: { entity: EntitySpec; at: number } | null = null;
  for (const [w, es] of owners) {
    if (new Set(es.map((e) => e.id)).size !== 1) continue;
    const at = t.search(new RegExp(`\\b${w}s?\\b`));
    if (at === -1) continue;
    if (!bestWord || at < bestWord.at) bestWord = { entity: es[0], at };
  }
  if (bestWord) return { entity: bestWord.entity, at: bestWord.at, noun: '' };

  /* --- a computed attribute names the thing ---
     "What's been sitting in Stockport longest" contains no noun for a
     trailer, no vocabulary word, and a depot that three entities share.
     What it does contain is a stock age, and only stock has one. An
     operator that applies to exactly one entity has named it. */
  const derive = grammar?.operations.find((o) => o.op === 'derive');
  if (derive && derive.op === 'derive') {
    const d = DERIVED.find((x) => x.id === derive.id);
    if (d && d.on.length === 1) {
      const e = ENTITIES.find((x) => x.id === d.on[0]);
      if (e) return { entity: e, at: derive.at, noun: '' };
    }
  }

  /* --- the data names the thing ---
     "DAFs older than 2022 excluding anything at Warrington" contains no
     noun for a trailer and no vocabulary word. It resolved to nothing at
     all, and the only reason a person reads it as stock is that they
     have seen DAF in the make column.

     So ask the data. A word that appears in `stock_trailers.make` IS a
     make, and a make only exists on trailers, which names the thing
     without anybody listing a single manufacturer. Empty index, no
     behaviour change: this is the last resort before giving up. */
  const fromData = findValues(text);
  if (fromData.length) {
    const votes = new Map<string, { entity: EntitySpec; at: number; weight: number }>();
    for (const v of fromData) {
      // A word that is a value on four entities says nothing about which.
      const distinct = new Set(v.hits.map((h) => h.entity));
      if (distinct.size !== 1) continue;
      const id = v.hits[0].entity;
      const e = ENTITIES.find((x) => x.id === id);
      if (!e) continue;
      const prev = votes.get(id);
      votes.set(id, {
        entity: e,
        at: Math.min(prev?.at ?? v.at, v.at),
        weight: (prev?.weight ?? 0) + 1,
      });
    }
    const ranked = [...votes.values()].sort((a, b) => b.weight - a.weight || a.at - b.at);
    if (ranked.length) return { entity: ranked[0].entity, at: ranked[0].at, noun: '' };
  }

  /* --- a breakdown names the thing ---
     "How many 6x2s have we got by depot" says nothing this app holds
     except `depot`, and only one entity is broken down by one. Counting
     something is better than refusing to, and the summary says what was
     counted so a wrong guess is visible rather than silent. */
  const byWord = t.match(/\b(?:by|per|split by|grouped by|broken down by)\s+([a-z]+)/);
  if (byWord) {
    const dimOwners = ENTITIES.filter((e) =>
      e.dimensions.some((d) => d.words.includes(byWord[1]) || d.key === byWord[1]));
    if (dimOwners.length === 1) {
      return { entity: dimOwners[0], at: byWord.index ?? 0, noun: '' };
    }
  }
  return null;
}

/* -------------------------------------------------------------
   A year, said as a comparison rather than a range.

     older than 2022     built in 2022 or before
     newer than 2019     2019 or after
     pre 2020            before 2020
     2021 or newer       2021 or after

   Years are not prices, and reading one as the other put "DAFs older
   than 2022" into a price bracket. The four digits and the word in front
   of them are what tell them apart.
   ------------------------------------------------------------- */
function readYear(text: string): { op: 'gte' | 'lte' | 'eq'; year: number; label: string } | null {
  const t = text.toLowerCase();
  const older = t.match(/\b(?:older than|before|earlier than|pre|prior to|up to)\s*-?\s*(\d{4})\b/);
  if (older) return { op: 'lte', year: Number(older[1]), label: `${older[1]} or older` };

  const newer = t.match(/\b(?:newer than|younger than|after|since|from)\s+(\d{4})\b/);
  if (newer) return { op: 'gte', year: Number(newer[1]), label: `${newer[1]} or newer` };

  const orNewer = t.match(/\b(\d{4})\s+(?:or newer|onwards|plus|and newer|and up)\b/);
  if (orNewer) return { op: 'gte', year: Number(orNewer[1]), label: `${orNewer[1]} or newer` };

  const orOlder = t.match(/\b(\d{4})\s+(?:or older|and older|and before|or earlier)\b/);
  if (orOlder) return { op: 'lte', year: Number(orOlder[1]), label: `${orOlder[1]} or older` };

  /* A bare year only counts next to a word that means a year. "£2019"
     is money and "2019 trailers" is a count of them. */
  const bare = t.match(/\b(?:year|reg|plate|model year|built|built in|from)\s+(\d{4})\b/)
            ?? t.match(/\b(\d{4})\s+(?:plate|reg|model|build)\b/);
  if (bare) {
    const y = Number(bare[1]);
    if (y >= 1980 && y <= new Date().getFullYear() + 2) {
      return { op: 'eq', year: y, label: `${y}` };
    }
  }
  return null;
}

export function parseQuery(input: string): QueryPlan | null {
  const raw = input.trim();
  if (raw.length < 3) return null;

  /**
   * Politeness stripped before anything reads the sentence.
   *
   * Not cosmetic. "Tell me how many trailers we have" used to answer for
   * the asker's own accounts, because "me" matched the word that decides
   * whose records a question is about. A courtesy changed the number.
   */
  const text = deFluff(raw) || raw;

  /* The grammar reads first.
     Superlatives, limits, negation, comparison, derived attributes and
     emptiness are read off the ORIGINAL sentence, before politeness is
     stripped and before anything decides which thing is being asked
     about. They apply to whatever attribute turns up, which is what
     makes them compose. */
  const grammar = readGrammar(raw);
  const ops = grammar.operations;

  const picked = pickEntity(text, grammar);
  if (!picked) return null;
  const entity = picked.entity;
  const lower = text.toLowerCase();

  // The word that named the entity is not also a filter. Without this,
  // "how many customers" reads "customers" as status=customer, and
  // "how many quoted proposals" loses the actual status.
  const entityNoun = picked.noun;
  // Nor is whatever follows "by": that is the grouping.
  const groupWord = (lower.match(/\b(?:by|per|split by|grouped by|broken down by)\s+([a-z]+)/) ?? [])[1] ?? '';

  const { measure: rawMeasure, hit: measureHit } = pickMeasure(text);
  let measure = rawMeasure;
  let confidence = measureHit ? 8 : 4;

  /* Naming a number is asking for it.
     "Show me this month's profit" was coming back as a list of trailers,
     because "show me" is a list word and "profit" was only ever read as
     which column to use once somebody had already said "total". Nobody
     says "total" first. They name the figure they want: profit, revenue,
     commission, turnover. If the sentence names an amount and has not
     asked for a list of rows in so many words, it wants the amount. */
  const namesAnAmount = entity.amounts.some((a) =>
    a.words.some((w) => w !== groupWord && w.length >= 3
      && new RegExp(`\\b${w.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'i').test(lower)));
  const asksForRows = /\b(list|which|show me the|rows|records|each|every one)\b/i.test(lower);

  if (measure === 'list' && namesAnAmount && !asksForRows) {
    measure = 'sum';
    confidence += 4;
  } else if (namesAnAmount) {
    confidence += 2;
  }

  // --- which number ---------------------------------------------------
  let amountColumn: string | undefined;
  let amountLabel: string | undefined;
  if (measure === 'sum' || measure === 'avg') {
    const amt = entity.amounts.find((a) => a.words.some((w) => w !== groupWord && lower.includes(w)))
             ?? entity.amounts[0];
    if (!amt) { measure = 'count'; }
    else { amountColumn = amt.column; amountLabel = amt.label; }
  }

  // --- filters --------------------------------------------------------
  const filters: PlanFilter[] = [];
  const consumed: string[] = [];

  /* --- yard talk ---
     Nobody says "status equals in_stock". They say it is sat there,
     parked up, on the yard, or that we are storing it.

     Before the schema vocabulary rather than after, and longest phrase
     first. Both matter: the schema knows the word "sold", the lexicon
     knows "not sold" and "provisionally sold", and whichever runs first
     wins. Running the short list first meant "provisionally sold" was
     answered as sold, which is the opposite of the truth. */
  if (!filters.some((f) => f.key === 'status') && entity.filters.some((f) => f.key === 'status')) {
    const spec = entity.filters.find((f) => f.key === 'status')!;
    const phrases = STATE_PHRASES
      .flatMap((p) => p.words.map((w) => ({ w, p })))
      .sort((a, b) => b.w.length - a.w.length);
    for (const { w, p } of phrases) {
      if (w === entityNoun || w === groupWord) continue;
      if (!new RegExp(`\\b${w}\\b`, 'i').test(text)) continue;
      // Only a value this entity actually has. "on hire" means nothing
      // to a proposal.
      const known = Object.values(spec.vocabulary ?? {}).includes(p.value)
        || spec.vocabulary === undefined;
      if (!known) continue;
      filters.push({
        key: 'status', column: spec.column, op: 'eq', value: p.value,
        label: STATE_LABEL[p.value] ?? `${spec.label} ${w}`,
        at: lower.indexOf(w), negate: grammar.negates(w),
      });
      consumed.push(w);
      confidence += 4;
      break;
    }
  }

  for (const f of entity.filters) {
    // Already answered by the yard-talk pass above. Without this,
    // "sold last week" picked up status twice and the summary read
    // "where sold and status sold".
    if (filters.some((x) => x.column === f.column)) continue;
    if (f.vocabulary) {
      // Longest vocabulary phrase first, so "in stock" beats "stock".
      const words = Object.keys(f.vocabulary)
        .filter((w) => w !== entityNoun && w !== groupWord)
        .sort((a, b) => b.length - a.length);
      for (const w of words) {
        if (!new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower)) continue;

        /* Body type is written in more than one place. Everything that
           maps to the same value goes into the match, so a row saying
           "Tautliner" in `model` is found by somebody typing
           "curtainsider", which is how the yard actually talks. */
        const spread = SPREAD_COLUMNS[f.key]?.[entity.id];
        if (spread) {
          const value = f.vocabulary[w];
          const synonyms = [...new Set(
            Object.entries(f.vocabulary)
              .filter(([, v]) => v === value)
              .map(([word]) => word)
              .concat(value),
          )].filter((x) => x.length >= 2);
          filters.push({
            key: f.key, column: f.column, op: 'anyOf', value,
            columns: spread, values: synonyms,
            label: `${f.label} ${w}`,
            at: lower.indexOf(w), negate: grammar.negates(w),
          });
        } else {
          filters.push({
            key: f.key, column: f.column, op: 'eq', value: f.vocabulary[w],
            label: `${f.label} ${w}`,
            at: lower.indexOf(w), negate: grammar.negates(w),
          });
        }
        consumed.push(w);
        confidence += 4;
        break;
      }
    }
  }

  // Some nouns both name the thing and narrow it: "leads" is every deal
  // at status lead, while "customers" is simply all of them. "Box" is the
  // same shape but narrows the body type rather than the status, so the
  // key comes from whichever filter owns the column instead of being
  // assumed to be status.
  const implied = entity.nounImpliesFilter?.[entityNoun];
  if (implied && !filters.some((f) => f.column === implied.column)) {
    const owner = entity.filters.find((f) => f.column === implied.column);
    /* The same spread applies here. "How many boxes in stock" reaches
       this branch rather than the vocabulary one above, and pushing a
       plain eq meant box trailers were counted off the tidy category
       column while curtainsiders were counted off all three. One noun
       behaving differently from the rest is worse than either. */
    const spread = owner ? SPREAD_COLUMNS[owner.key]?.[entity.id] : undefined;
    if (spread && owner?.vocabulary) {
      const synonyms = [...new Set(
        Object.entries(owner.vocabulary)
          .filter(([, v]) => v === implied.value)
          .map(([word]) => word)
          .concat(implied.value),
      )].filter((x) => x.length >= 2);
      filters.push({
        key: owner.key, column: implied.column, op: 'anyOf', value: implied.value,
        columns: spread, values: synonyms, label: implied.label,
      });
    } else {
      filters.push({
        key: owner?.key ?? 'status', column: implied.column,
        op: 'eq', value: implied.value, label: implied.label,
      });
    }
    confidence += 3;
  }

  /* --- where ---
     A known depot anywhere in the sentence, including bare at the front
     as in "carrington, how many parked up". Falls back to whatever
     follows a preposition for a yard nobody has listed yet. */
  const locSpec = entity.filters.find((f) => f.key === 'location');
  if (locSpec && !filters.some((f) => f.column === locSpec.column)) {
    const place = readDepot(text) ?? readPlaceAfterPreposition(text);
    if (place) {
      filters.push({
        key: 'location', column: locSpec.column, op: 'ilike', value: place,
        label: `at ${place}`, at: lower.indexOf(place.toLowerCase()),
        negate: grammar.negates(place),
      });
      consumed.push(place);
      confidence += 4;
    }
  }

  /* --- who sold it ---
     "by dave" is the rep. "to Dawson" is the buyer. Getting these the
     wrong way round answers a completely different question. */
  const repSpec = entity.filters.find((f) => f.key === 'rep' || f.key === 'owner');
  if (repSpec && !filters.some((f) => f.column === repSpec.column)) {
    const who = readRep(text);
    /* A name after "for" is usually the rep. "Average stock age for DAF
       versus Volvo" is not: DAF is in the make column, and the data
       saying so beats a preposition every time. */
    const isSomethingElse = who && findValues(who).some((v) =>
      v.hits.some((h) => h.entity === entity.id && h.column !== repSpec.column));
    if (who && !isSomethingElse) {
      filters.push({ key: repSpec.key, column: repSpec.column, op: 'ilike', value: who, label: `by ${who}` });
      consumed.push(who);
      confidence += 4;
    }
  }

  /* --- how much ---
     "Blue curtainsiders between 5k and 10k" used to answer with every
     blue curtainsider, because a price bracket is not a word the
     vocabulary knows. Under, over and between all land on the same
     column: whichever amount the sentence is about, or the price. */
  const bracket = readBracket(text);
  if (bracket && entity.amounts.length) {
    const amt = entity.amounts.find((a) => a.words.some((w) => lower.includes(w))) ?? entity.amounts[0];
    if (bracket.min != null) {
      filters.push({ key: 'min', column: amt.column, op: 'gte', value: String(bracket.min),
        label: `${amt.label} over ${money(bracket.min)}` });
    }
    if (bracket.max != null) {
      filters.push({ key: 'max', column: amt.column, op: 'lte', value: String(bracket.max),
        label: `${amt.label} under ${money(bracket.max)}` });
    }
    confidence += 4;
  }

  /* --- how long ---
     There is no length column, so a size matches against the description,
     which is where the spec sheet ends up. */
  const size = readSize(text);
  if (size && entity.id === 'trailers') {
    filters.push({ key: 'size', column: 'description', op: 'ilike', value: size, label: `${size}m` });
    consumed.push(size);
    confidence += 3;
  }

  // Free-text filters take proper nouns: "how many Schmitz in Hyde".
  const entities = extract(text, tokenise(text));
  const freeSpecs = entity.filters.filter((f) => f.freeText);

  /* --- the data says which column ---
     Before the guessing below, because the guessing is guessing. A word
     that appears in `make` is a make; it does not need a preposition in
     front of it to prove it, and "DAFs older than 2022" has none.

     This is also what stops a customer being read as a depot. The old
     rule was that "in X" means a place, which is right until somebody
     writes "trailers in Dawsongroup's colours". */
  for (const found of findValues(text)) {
    const hit = found.hits.find((h) => h.entity === entity.id);
    if (!hit) continue;
    if (filters.some((x) => x.column === hit.column)) continue;
    if (consumed.some((c) => c.toLowerCase().includes(found.word))) continue;
    const spec = entity.filters.find((f) => f.column === hit.column);
    if (!spec) continue;
    filters.push({
      key: spec.key, column: hit.column, op: 'ilike', value: hit.value,
      label: `${spec.label} ${hit.value}`,
      at: found.at, negate: grammar.negates(found.word),
    });
    consumed.push(found.word);
    confidence += 4;
  }
  /* A word already used by a vocabulary phrase is spent.
     Matching on the whole phrase was not enough: "how many social posts
     are left to approve" consumed "left to approve" as the status, and
     then read the leftover "approve" as the name of the person who
     wrote them. Any word inside a consumed phrase is gone. */
  const spentWords = new Set(consumed.flatMap((c) => c.toLowerCase().split(/\s+/)));
  const availableNouns = entities.properNouns.filter(
    (n) => !spentWords.has(n.toLowerCase()) && !isReservedWord(n),
  );
  if (availableNouns.length && freeSpecs.length) {
    // "to X" / "for X" is the customer; "in X" / "at X" is the location.
    for (const noun of availableNouns) {
      const esc = noun.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const inPlace = new RegExp(`\\b(in|at|from)\\s+${esc}\\b`, 'i').test(text);
      const toWhom = new RegExp(`\\b(to|for|with)\\s+${esc}\\b`, 'i').test(text);
      let spec = inPlace ? freeSpecs.find((f) => f.key === 'location')
               : toWhom ? freeSpecs.find((f) => f.key === 'customer')
               : undefined;
      // Otherwise guess by what the word looks like: a known make, else customer.
      if (!spec) spec = freeSpecs.find((f) => f.key === 'make') ?? freeSpecs[0];
      if (!spec) continue;
      if (filters.some((x) => x.column === spec!.column)) continue;
      filters.push({
        key: spec.key, column: spec.column, op: 'ilike', value: noun,
        label: `${spec.label} ${noun}`,
        at: lower.indexOf(noun.toLowerCase()), negate: grammar.negates(noun),
      });
      confidence += 3;
    }
  }

  /* --- which year ---
     A year is not a price and not a row count. "DAFs older than 2022"
     read 2022 as money until this existed, and answered with every DAF
     under twenty two hundred pounds. */
  const yearSpec = entity.id === 'trailers' ? 'year' : null;
  const year = yearSpec ? readYear(text) : null;
  if (year && yearSpec) {
    filters.push({
      key: 'year', column: yearSpec,
      op: year.op === 'eq' ? 'eq' : year.op,
      value: String(year.year), label: year.label,
      at: lower.indexOf(String(year.year)), negate: grammar.negates(String(year.year)),
    });
    confidence += 4;
  }

  /* --- nothing in it ---
     "Stock where price hasn't been entered" is a question about which
     rows have none. Answering it with a total of the prices that are
     there is wrong in a way that looks entirely reasonable, which is
     how it survived until somebody checked one. */
  const emptyOp = ops.find((o) => o.op === 'empty');
  if (emptyOp && emptyOp.op === 'empty') {
    /* Which attribute is empty: whichever the sentence names. When it
       said so right after "with no", those words are the answer and
       nothing else in the sentence gets a vote. */
    const target = columnNamed(entity, emptyOp.hint ?? lower, !!emptyOp.hint);
    if (target) {
      filters.push({
        key: 'empty', column: target.column,
        op: emptyOp.filled ? 'present' : 'empty',
        value: '', label: `${target.label} ${emptyOp.filled ? 'filled in' : 'empty'}`,
        at: emptyOp.at,
      });
      confidence += 5;
      /* A question about which rows are missing something is a question
         about rows. Without this it came back as a total of the values
         that were not missing, which is the opposite of what was asked. */
      if (measure === 'sum' || measure === 'avg') { measure = 'list'; }
    }
  }

  // --- grouping -------------------------------------------------------
  let groupBy: QueryPlan['groupBy'];
  const byMatch = lower.match(/\b(?:by|per|split by|grouped by|broken down by)\s+([a-z]+)/);
  if (byMatch) {
    const dim = entity.dimensions.find((d) => d.words.includes(byMatch[1]) || d.key === byMatch[1]);
    if (dim) { groupBy = { column: dim.column, label: dim.label }; confidence += 5; }
  }

  /* --- period ---
     In stock is a state you are in now, not something that happened on a
     date, so "how many trailers in stock today" is asking about right
     now and a range on the dispatch date would answer nothing. Any other
     period alongside it is somebody being loose with words, and the
     state is the part they meant. */
  const presentTense = filters.some((f) => f.key === 'status' && f.value === 'in_stock');
  const dropRange = presentTense && /^(today|this week|this month|this year)$/.test(entities.range?.label ?? '');
  const range = entities.range && !dropRange
    ? { from: entities.range.from.toISOString(), to: entities.range.to.toISOString(), label: entities.range.label }
    : undefined;
  if (range) confidence += 3;

  /* Which date the period is about. The sentence usually says: added,
     arrived, sold, dispatched, ordered. Falls back to the entity's own
     default when it does not. */
  const rangeColumn = range
    ? (entity.dates?.find((d) => d.words.some((w) => lower.includes(w)))?.column ?? entity.dateColumn)
    : undefined;

  // --- whose ----------------------------------------------------------
  const scope: 'mine' | 'all' =
    MINE.test(text) ? 'mine' : ALL.test(text) ? 'all' : (entity.scope ?? 'all');

  /* =============================================================
     The operators, bound to this entity's own columns.

     Everything above reads words and produces filters. Everything below
     takes the operators the grammar found and attaches them to whatever
     attribute this particular thing happens to have, which is why the
     same six operators work on trailers, customers and posts without
     any of them being mentioned by name.
     ============================================================= */

  // --- a computed attribute --------------------------------------------
  const deriveOp = ops.find((o) => o.op === 'derive');
  let derived: QueryPlan['derived'];
  if (deriveOp && deriveOp.op === 'derive') {
    const d = DERIVED_FOR(entity, deriveOp.id, deriveOp.from);
    if (d) { derived = d; confidence += 4; }
  }

  // --- sorting ----------------------------------------------------------
  const unmet: string[] = [];
  const orderOp = ops.find((o) => o.op === 'order');
  let order: QueryPlan['order'];
  if (orderOp && orderOp.op === 'order') {
    const column = bindOrder(entity, orderOp.wants, lower, derived, amountColumn);
    if (!column) {
      unmet.push(`nothing on a ${entity.labelOne} to sort "${orderOp.label}" by`);
    }
    if (column) {
      /* A duration runs backwards against the date it comes from.
         Longest in stock is the EARLIEST arrival date, and getting this
         the wrong way round puts the newest trailer at the top of a
         question about the oldest. */
      const flip = derived?.how === 'days since' && column.column === derived.from;
      order = {
        column: column.column,
        direction: flip ? (orderOp.direction === 'desc' ? 'asc' : 'desc') : orderOp.direction,
        label: `${orderOp.label} by ${column.label}`,
      };
      confidence += 4;
    }
  }

  // --- how many of them -------------------------------------------------
  const limitOp = ops.find((o) => o.op === 'limit');
  /* A limit without a sort is not a limit, it is an arbitrary handful.
     "Show me 5 trailers" is fine; "the cheapest" without a price column
     to sort on would otherwise return one row chosen by nothing. */
  const limit = limitOp && limitOp.op === 'limit'
    ? (order || !ops.some((o) => o.op === 'order') ? limitOp.n : undefined)
    : undefined;
  if (limit) confidence += 2;

  // --- side by side -----------------------------------------------------
  const compareOp = ops.find((o) => o.op === 'compare');
  let compare: QueryPlan['compare'];
  if (compareOp && compareOp.op === 'compare') {
    /* Two values of one attribute. Which attribute is whichever one
       holds both of them, so "DAF versus Volvo" compares makes and
       "Carrington against Hyde" compares depots, with nothing written
       down about either. */
    const col = columnHolding(entity, compareOp.against);
    if (col) {
      compare = { column: col.column, label: col.label, values: col.values ?? compareOp.against };
      /* Comparing IS grouping, on the attribute being compared. */
      if (!groupBy) groupBy = { column: col.column, label: col.label };
      confidence += 5;
      /* The two things being compared are not also filters. Without
         this, "DAF versus Volvo" narrowed to DAF and then compared it
         with itself. */
      for (let i = filters.length - 1; i >= 0; i--) {
        if (filters[i].column === col.column
            && compareOp.against.some((v) => filters[i].value.toLowerCase() === v.toLowerCase())) {
          filters.splice(i, 1);
        }
      }
    }
  }

  // --- readable summary ------------------------------------------------
  const measured = derived ? derived.label : amountLabel;
  const verb = measure === 'count' ? 'Count'
             : measure === 'sum' ? `Total ${measured}`
             : measure === 'avg' ? `Average ${measured}`
             : 'List';
  const bits = [
    `${verb} of ${entity.label}`,
    filters.length
      ? `where ${filters.map((f) => `${f.negate ? 'not ' : ''}${f.label}`).join(' and ')}`
      : '',
    groupBy ? `by ${groupBy.label}` : '',
    compare ? `(${compare.values.join(' against ')})` : '',
    range ? (/^(past|last)/.test(range.label) ? `in the ${range.label}` : range.label) : '',
    order ? `${order.label}` : '',
    limit ? (limit === 1 ? 'top one' : `top ${limit}`) : '',
    scope === 'mine' ? '(yours)' : '',
  ].filter(Boolean);

  return {
    entity, measure, amountColumn, amountLabel, filters, groupBy, range, rangeColumn, scope,
    order, limit, derived, compare,
    unmet: unmet.length ? unmet : undefined,
    summary: bits.join(' '),
    confidence,
  };
}

/* -------------------------------------------------------------
   Binding an operator to a column.

   The operator says what kind of thing it wants. The entity says which
   of its columns are that kind. Neither knows about the other, which is
   the whole reason "highest mileage" will work the day a mileage column
   exists without a line being written here.
   ------------------------------------------------------------- */
function bindOrder(
  entity: EntitySpec,
  wants: 'money' | 'date' | 'duration' | 'any',
  lower: string,
  derived: QueryPlan['derived'],
  amountColumn?: string,
): { column: string; label: string } | null {
  const namedAmount = entity.amounts.find((a) => a.words.some((w) => lower.includes(w)));
  const namedDate = entity.dates?.find((d) => d.words.some((w) => lower.includes(w)));

  if (wants === 'money') {
    const a = namedAmount ?? entity.amounts.find((x) => x.key === 'price') ?? entity.amounts[0];
    return a ? { column: a.column, label: a.label } : null;
  }
  if (wants === 'date') {
    const d = namedDate
      ?? entity.dates?.[0]
      ?? (entity.dateColumn ? { column: entity.dateColumn, label: 'date' } : null);
    return d ? { column: d.column, label: d.label } : null;
  }
  if (wants === 'duration') {
    // A duration is an age, and an age is a date read backwards.
    if (derived) return { column: derived.from, label: derived.label };
    const d = namedDate ?? entity.dates?.[0];
    return d ? { column: d.column, label: d.label } : null;
  }
  /* `any` means the sentence has to say. "Highest" on its own orders
     nothing, because guessing which column somebody meant by "highest"
     is exactly the kind of confident wrong answer this is here to
     stop. */
  if (namedAmount) return { column: namedAmount.column, label: namedAmount.label };
  if (namedDate) return { column: namedDate.column, label: namedDate.label };
  if (amountColumn) {
    const a = entity.amounts.find((x) => x.column === amountColumn);
    if (a) return { column: a.column, label: a.label };
  }
  return null;
}

/** The derived attribute, if this entity is one it applies to. */
function DERIVED_FOR(entity: EntitySpec, id: string, from: string): QueryPlan['derived'] {
  const d = DERIVED.find((x) => x.id === id);
  if (!d || !d.on.includes(entity.id)) return undefined;
  // The column it is computed from has to exist on this entity.
  const known = entity.dates?.some((x) => x.column === from)
    || entity.amounts.some((x) => x.column === from)
    || entity.dateColumn === from;
  if (!known) return undefined;
  return { id: d.id, from: d.from, how: d.how, label: d.label };
}

/** Which column holds both of these values. */
function columnHolding(
  entity: EntitySpec,
  values: string[],
): { column: string; label: string; values?: string[] } | null {
  // The data knows first: two makes are two rows in the make column.
  const hits = values.map((v) => findValues(v));
  if (hits.every((h) => h.length)) {
    const shared = hits[0].flatMap((h) => h.hits)
      .filter((a) => hits.slice(1).every((rest) =>
        rest.flatMap((r) => r.hits).some((b) => b.column === a.column && b.entity === a.entity)))
      .find((h) => h.entity === entity.id);
    if (shared) {
      const f = entity.filters.find((x) => x.column === shared.column);
      /* Written back the way the column stores them, so a comparison
         reads "DAF against Volvo" rather than repeating whatever
         casing somebody typed in a hurry. */
      const canonical = hits.map((h, i) =>
        h.flatMap((x) => x.hits).find((x) => x.entity === entity.id && x.column === shared.column)
          ?.value ?? values[i]);
      return { column: shared.column, label: f?.label ?? shared.column, values: canonical };
    }
  }
  // Otherwise a filter whose vocabulary claims both of them.
  for (const f of entity.filters) {
    if (!f.vocabulary) continue;
    if (values.every((v) => f.vocabulary![v.toLowerCase()])) {
      return { column: f.column, label: f.label };
    }
  }
  /* Nothing in the data and nothing in the vocabulary. A free text
     column is still a fair guess when both sides look like names, and
     the summary says which column so a wrong one is visible. */
  const free = entity.filters.find((f) => f.freeText && f.key === 'make')
    ?? entity.filters.find((f) => f.freeText);
  return free ? { column: free.column, label: free.label } : null;
}

/**
 * A price bracket, in the shorthand people use for one.
 *
 *   between 5k and 10k        5000 to 10000
 *   from £5,000 to £10,000    the same
 *   under 10k / below 10k     no floor
 *   over 5k / more than 5k    no ceiling
 *   5k-10k                    the same, written the fast way
 */
function readBracket(text: string): { min: number | null; max: number | null } | null {
  const t = text.toLowerCase().replace(/,/g, '');
  const num = String.raw`(?:£|\$|€)?\s*(\d+(?:\.\d+)?)\s*(k|m|grand)?`;
  const scale = (n: string, s?: string) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return null;
    const suffix = (s ?? '').toLowerCase();
    if (suffix === 'k' || suffix === 'grand') return v * 1000;
    if (suffix === 'm') return v * 1_000_000;
    return v;
  };

  // The dash alternatives are escapes rather than the characters
  // themselves, because people paste all three and the repo bans two of
  // them on sight.
  const DASH = String.raw`[-\u2013\u2014]`;
  const span = t.match(new RegExp(String.raw`\b(?:between|from)\s+${num}\s*(?:and|to|${DASH})\s*${num}`))
    ?? t.match(new RegExp(String.raw`\b${num}\s*(?:${DASH}|to)\s*${num}\b`));
  if (span) {
    const min = scale(span[1], span[2]);
    const max = scale(span[3], span[4]);
    if (min != null && max != null) return { min: Math.min(min, max), max: Math.max(min, max) };
  }

  const under = t.match(new RegExp(String.raw`\b(?:under|below|less than|cheaper than|up to|no more than|max)\s+${num}`));
  if (under) { const v = scale(under[1], under[2]); if (v != null) return { min: null, max: v }; }

  const over = t.match(new RegExp(String.raw`\b(?:over|above|more than|at least|north of|from)\s+${num}`));
  if (over) { const v = scale(over[1], over[2]); if (v != null) return { min: v, max: null }; }

  return null;
}

function money(n: number): string {
  return `£${n.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
}

/** Serialisable form, for posting to the query route. */
export function planToPayload(p: QueryPlan) {
  return {
    entityId: p.entity.id,
    measure: p.measure,
    amountColumn: p.amountColumn,
    amountLabel: p.amountLabel,
    filters: p.filters,
    groupBy: p.groupBy,
    range: p.range,
    scope: p.scope,
    order: p.order,
    limit: p.limit,
    derived: p.derived,
    compare: p.compare,
    /* Which date the period applies to, when the sentence named one.
       "Added between May and July" measures the arrival date, not the
       dispatch date the entity uses by default. */
    rangeColumn: p.rangeColumn,
    summary: p.summary,
  };
}
