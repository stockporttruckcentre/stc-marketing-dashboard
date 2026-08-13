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

export type PlanFilter = {
  key: string; column: string; op: 'eq' | 'ilike' | 'gte' | 'lte' | 'anyOf'; value: string; label: string;
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
  scope: 'mine' | 'all';
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
function pickEntity(text: string): { entity: EntitySpec; at: number; noun: string } | null {
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

  const picked = pickEntity(text);
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
          });
        } else {
          filters.push({ key: f.key, column: f.column, op: 'eq', value: f.vocabulary[w], label: `${f.label} ${w}` });
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
      filters.push({ key: 'location', column: locSpec.column, op: 'ilike', value: place, label: `at ${place}` });
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
    if (who) {
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
      filters.push({ key: spec.key, column: spec.column, op: 'ilike', value: noun, label: `${spec.label} ${noun}` });
      confidence += 3;
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

  // --- whose ----------------------------------------------------------
  const scope: 'mine' | 'all' =
    MINE.test(text) ? 'mine' : ALL.test(text) ? 'all' : (entity.scope ?? 'all');

  // --- readable summary ------------------------------------------------
  const verb = measure === 'count' ? 'Count'
             : measure === 'sum' ? `Total ${amountLabel}`
             : measure === 'avg' ? `Average ${amountLabel}`
             : 'List';
  const bits = [
    `${verb} of ${entity.label}`,
    filters.length ? `where ${filters.map((f) => f.label).join(' and ')}` : '',
    groupBy ? `by ${groupBy.label}` : '',
    range ? (/^(past|last)/.test(range.label) ? `in the ${range.label}` : range.label) : '',
    scope === 'mine' ? '(yours)' : '',
  ].filter(Boolean);

  return {
    entity, measure, amountColumn, amountLabel, filters, groupBy, range, scope,
    summary: bits.join(' '),
    confidence,
  };
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
    summary: p.summary,
  };
}
