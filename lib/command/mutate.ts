/* =============================================================
   Instructions, as opposed to questions.

   "How many curtainsiders at Carrington" is a question and the query
   engine answers it. "Add £1k refurb value to STC143980" is an
   instruction, and until this file existed the bar quietly read it as a
   question and returned a list of trailers. Answering an instruction
   with a number is worse than doing nothing, because it looks like it
   worked.

   What this reads:

     add £1k refurb value to STC143980       +1000 on refurb_costs
     stc143980 refurb 1200                   set refurb_costs to 1200
     set the nbv on STC1439 to 8,500         set nbv to 8500
     move STC143980 to Carrington            set location to Carrington
     knock 250 off the retail on STC143980   -250 on retail_price
     mot on stc143980 is 14/03/2027          set mot_date
     clear the customer on STC143980         null the column
     add a note to Dawson: chasing tyres     append to notes

   Word order does not matter, the field can come before or after the
   record, and the fill words in between are thrown away. What it will
   not do is guess: a sentence missing the value or the record comes back
   with that named in `missing`, so the bar can ask for the one thing it
   needs rather than failing the whole sentence.

   Nothing here writes. It produces a plan, the bar shows it with the
   current value beside the new one, and only a deliberate confirm sends
   it. An instruction that changes a record without showing what it is
   about to change is a trap.
   ============================================================= */
import { WRITABLE_FIELDS, type WritableField, type WritableEntity } from './fields';
import { parseQuery } from './query';
import { condForFilters } from './ir/conditions';
import { capability, entity as entityDef } from './ir/registry';
import type { Cardinality, Cond } from './ir/types';
import { EMPTY_VOCABULARY, type VocabularyIndex } from './vocab';
import {
  EMPTY_CONTEXT, readContextReference, resolveContext, type CommandContext,
} from './context';
import { DEPOTS, isReservedWord } from './lexicon';
import { distance } from './normalise';
import type { CrmCapabilities } from '@/lib/crm/permissions';

export type EditOp = 'set' | 'add' | 'subtract' | 'clear';


export type EditPlan = {
  entity: WritableEntity;
  field: WritableField;
  op: EditOp;
  /** Null for a clear, and null while the value is still missing. */
  value: string | number | null;
  valueLabel: string;
  /**
   * Which rows, in the canonical condition language.
   *
   * The same `Cond` a question produces, from the same machinery. There
   * used to be a separate `EditTarget` union here with its own reader,
   * and it could express less than the read side could: `readBulkTarget`
   * narrowed on one enum on the field being written, so an instruction
   * could say "all the outstanding ones" and could not say "at Hyde".
   * Deleting it did not lose a feature, it removed a ceiling.
   */
  match: Cond | null;
  /**
   * How many rows the SENTENCE named, never how many matched.
   *
   * `many` only where the words say every match. A company name that
   * turns out to fit forty accounts is an ambiguity to raise, not
   * permission to write forty.
   */
  expect: Cardinality;
  /** The rows in words, for the preview. */
  matchLabel: string;
  /** Each record the sentence named, for a preview that lists them. */
  named: string[];
  /**
   * Some instructions are understood here and carried out somewhere
   * else. Selling raises a commission line on a tracker and needs a
   * price, so the bar hands it to that flow with the units already
   * named rather than writing a status column behind its back.
   */
  handoff?: 'markSold';
  /**
   * Values a business operation needs, read out of the sentence.
   *
   * Filled from the capability's own declared `inputs` rather than from
   * anything written down here, so "mark STC143580 as sold for £24,995"
   * carries the price without this file knowing what a sale is. See
   * `CapabilityDef.inputs`.
   */
  args?: Record<string, string | number | null>;
  /** What still has to be supplied before this can run. */
  missing: ('target' | 'value')[];
  /** Plain English, shown before anything happens. */
  summary: string;
  confidence: number;
};

/* -------------------------------------------------------------
   Words.
   ------------------------------------------------------------- */

/** Increase what is already there. */
const ADD_WORDS = [
  'add another', 'put another', 'add a further', 'another', 'add', 'increase', 'increase by',
  'bump', 'bump up', 'raise', 'raise by', 'up by', 'plus', 'top up', 'topup', 'stick another',
  'whack another', 'append', 'chuck another', 'put on', 'log',
];

/** Decrease it. */
const SUB_WORDS = [
  'take off', 'knock off', 'knock', 'reduce', 'reduce by', 'deduct', 'subtract', 'minus',
  'less', 'drop by', 'lower by', 'take away', 'come off', 'discount by',
];

/* English puts the amount in the middle of the verb, and the contiguous
   list above cannot see that. "Take 100 off the refurb" was read as a
   set, so a reduction of a hundred became a refurb cost of a hundred.
   These match the verb with its object in the way people write it. */
const SPLIT_SUB = /\b(take|knock|shave|chop|cut|trim)\b[^.]{0,20}?\b(off|away|out)\b/i;
const SPLIT_ADD = /\b(put|stick|add|chuck|whack|bung)\b[^.]{0,20}?\b(on|onto|to)\b/i;

/** Replace it outright. */
const SET_WORDS = [
  'set', 'change', 'update', 'amend', 'correct', 'make', 'switch', 'move', 'put', 'mark',
  'record', 'enter', 'assign', 'give', 'is', 'are', 'to', 'should be', 'equals', 'now',
];

/** Empty it. */
const CLEAR_WORDS = [
  'clear', 'blank', 'wipe', 'empty', 'unset', 'reset', 'remove the', 'delete the', 'take out',
];

/**
 * Words that are never a value, however much they look like one.
 *
 * Without this "set the location on STC1 to the yard" stores the word
 * "the", which is the sort of thing nobody notices until a report is
 * wrong.
 */
const NOT_A_VALUE = new Set([
  'the', 'a', 'an', 'to', 'on', 'for', 'of', 'in', 'at', 'it', 'its', 'this', 'that',
  'please', 'can', 'you', 'could', 'would', 'will', 'and', 'with', 'value', 'field',
  'record', 'row', 'entry', 'trailer', 'unit', 'customer', 'contact', 'account', 'company',
]);

const lower = (s: string) => s.toLowerCase();

/** Softened for matching. Keeps digits, £ and the punctuation in dates. */
function soften(s: string): string {
  return ` ${s.toLowerCase().replace(/[^a-z0-9£$€.,/:@'\- ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

/**
 * Does this softened sentence contain this word, typos and all?
 *
 * Exact first, because that is almost always the answer and it is free.
 * Otherwise every token is compared with the transposition-aware
 * distance, on a budget that grows with the length of the word: one slip
 * in a short word, two in a long one. Short words are left alone, since
 * at four letters nearly everything is one edit from everything else.
 *
 * Instructions need this as much as questions do. "Aprove all pending
 * social posts" was falling through to the query engine and being
 * answered as a list, for one missing p.
 */
function fuzzyContains(softened: string, word: string): boolean {
  if (softened.includes(` ${word} `)) return true;
  if (word.includes(' ') || word.length < 5) return false;
  const budget = word.length >= 8 ? 2 : 1;
  for (const token of softened.trim().split(' ')) {
    if (token.length < 4) continue;
    if (Math.abs(token.length - word.length) > budget) continue;
    /* The first two letters have to agree.
       Without that anchor, "unapproved" is two edits from "approved" and
       the budget lets it match, so "mark all outstanding posts as
       approved" resolved to unapproved and inverted the instruction. A
       negation is never a typo. */
    if (token.slice(0, 2) !== word.slice(0, 2)) continue;
    if (distance(token, word) <= budget) return true;
  }
  return false;
}

/* -------------------------------------------------------------
   Values.
   ------------------------------------------------------------- */

/**
 * Money and plain numbers, in the shorthand people actually write.
 * "£1k" is a thousand pounds, "1.2m" is 1,200,000, "8,500" is 8500.
 */
const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100, thousand: 1000, grand: 1000, million: 1_000_000,
};

export function readAmount(text: string): { value: number; raw: string } | null {
  // A leading minus is a reduction written the short way: "refurb -100".
  const m = text.match(/(-)?\s*(£|\$|€)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|m|grand)?\b/i);
  if (m) {
    let n = Number(m[3].replace(/,/g, ''));
    if (!Number.isFinite(n)) return null;
    const suffix = (m[4] ?? '').toLowerCase();
    if (suffix === 'k' || suffix === 'grand') n *= 1000;
    if (suffix === 'm') n *= 1_000_000;
    return { value: m[1] ? -n : n, raw: m[0].trim() };
  }

  /* Written out, because plenty of people do. "Knock a hundred off the
     refurb" came back asking what amount, which is a silly question to
     ask somebody who just told you. */
  const words = text.toLowerCase().match(
    /\b(?:a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)?\s*(hundred|thousand|grand|million)\b/,
  );
  if (words) {
    const lead = words[0].trim().split(/\s+/)[0];
    const mult = WORD_NUMBERS[words[1]] ?? 1;
    const count = lead === words[1] || lead === 'a' ? 1 : (WORD_NUMBERS[lead] ?? 1);
    return { value: count * mult, raw: words[0].trim() };
  }

  const bare = text.toLowerCase().match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/,
  );
  if (bare) return { value: WORD_NUMBERS[bare[1]], raw: bare[1] };

  return null;
}

/** Dates, UK order, plus the two words everybody uses instead. */
export function readDate(text: string, today = new Date()): { value: string; raw: string } | null {
  const t = text.toLowerCase();

  const day = (offset: number) => {
    const d = new Date(today.getTime());
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  if (/\btoday\b/.test(t)) return { value: day(0), raw: 'today' };
  if (/\btomorrow\b/.test(t)) return { value: day(1), raw: 'tomorrow' };
  if (/\byesterday\b/.test(t)) return { value: day(-1), raw: 'yesterday' };

  // 14/03/2027, 14-3-27, 14.03.2027. Day first, because this is a UK yard.
  const slash = t.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/);
  if (slash) {
    const d = Number(slash[1]);
    const mo = Number(slash[2]);
    let y = Number(slash[3]);
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
      return {
        value: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        raw: slash[0],
      };
    }
  }

  // 14 March 2027, March 14 2027, 14 Mar 27.
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
                  'august', 'september', 'october', 'november', 'december'];
  const named = t.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\s*(\d{2,4})?\b|\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\s*(\d{2,4})?\b/,
  );
  if (named) {
    const d = Number(named[1] ?? named[5]);
    const word = (named[2] ?? named[4] ?? '').toLowerCase();
    const mi = MONTHS.findIndex((m) => m.startsWith(word.slice(0, 3)) && word.length >= 3);
    let y = Number(named[3] ?? named[6] ?? today.getFullYear());
    if (y < 100) y += 2000;
    if (mi >= 0 && d >= 1 && d <= 31) {
      return {
        value: `${y}-${String(mi + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        raw: named[0].trim(),
      };
    }
  }
  return null;
}

/** A stock number, however somebody spaces or cases it. */
export function readStockRef(text: string): { value: string; raw: string } | null {
  const m = text.match(/\bstc[\s\-_]?(\d{3,8})\b/i);
  if (!m) return null;
  return { value: `STC${m[1]}`, raw: m[0] };
}

/**
 * Every record this sentence names, not just the first.
 *
 * Three shapes, because a unit gets referred to by all three:
 *
 *   stc    STC143580, stc 143580, STC-143580
 *   coded  C734105, a chassis or supplier reference
 *   bare   143480, the stock number with the prefix left off
 *
 * Bare digits are the risky one, since they are also how somebody writes
 * an amount. The caller decides whether to trust them, and only does so
 * when the field being written cannot take a number anyway.
 */
/** Letter runs that are words, not the start of a reference. */
const CODE_STOPWORDS = new Set(['and', 'the', 'no', 'to', 'on', 'at', 'in', 'a', 'of', 'is', 'by']);

export function readRecordRefs(text: string): { stc: string[]; coded: string[]; bare: string[]; raws: string[] } {
  const stc: string[] = [];
  const coded: string[] = [];
  const bare: string[] = [];
  const raws: string[] = [];

  for (const m of text.matchAll(/\bstc[\s\-_]?(\d{3,8})\b/gi)) {
    stc.push(`STC${m[1]}`);
    raws.push(m[0]);
  }
  /* A letter or two then digits, run together: chassis and supplier
     references like C734105. Deliberately no space allowed between the
     letters and the digits, because "and 144504" was being read as a
     reference called AND144504 and the second trailer in the sentence
     went missing. */
  for (const m of text.matchAll(/\b([A-Za-z]{1,3}\d{4,10})\b/g)) {
    if (/^stc/i.test(m[1])) continue;
    if (CODE_STOPWORDS.has(m[1].replace(/\d+$/, '').toLowerCase())) continue;
    coded.push(m[1].toUpperCase());
    raws.push(m[0]);
  }
  // Digits on their own, long enough to be a stock number rather than a
  // price. Anything already claimed above is skipped.
  let rest = text;
  for (const r of raws) rest = rest.replace(r, ' ');
  for (const m of rest.matchAll(/\b(\d{5,8})\b/g)) bare.push(m[1]);

  return { stc, coded, bare, raws };
}

/* -------------------------------------------------------------
   The parse.
   ------------------------------------------------------------- */

/** Verbs that mean "put it somewhere", which name the location field without saying it. */
const MOVE_WORDS = ['move', 'relocate', 'shift', 'transfer', 'park', 'parked', 'store',
                    'stored', 'send', 'put', 'stick', 'place', 'drop', 'bring'];

/** The field being written, longest alias first so "refurb at sale" beats "refurb". */
function findField(text: string, caps?: CrmCapabilities): { field: WritableField; alias: string } | null {
  /* Anything after a colon is the value, not the field. Without this
     cut, "add a note to Dawson: chasing tyre quote" was filed under
     Tread depths, because "tyres" is one of its words and it is a longer
     match than "note". */
  const beforeColon = text.split(':')[0];
  const t = soften(beforeColon);

  /* WHAT THEY BECOME NAMES THE FIELD.

     "Mark all the in stock curtainsiders as sold" was filed as a change
     to the CATEGORY, set to Curtainsider, on every trailer in stock. The
     alias loop below matched "curtainsiders" against the category field
     and returned before anything looked at the word after "as", and
     "curtainsiders" is the longer match, so it won on length as well.

     The half after "as" is where the rows are going, so a state word in
     it names the column being written. The half before it describes the
     rows and must not. */
  const destination = soften(splitOnAs(beforeColon).destination);
  const destinationState = (): { field: WritableField; alias: string } | null => {
    if (!destination.trim() || !MARK_WORDS.some((w) => fuzzyContains(t, w))) return null;
    let hit: { field: WritableField; alias: string } | null = null;
    for (const f of WRITABLE_FIELDS) {
      if (f.kind !== 'enum' || !f.vocabulary) continue;
      if (caps && !caps.has(f.capability)) continue;
      /* The entity comes from the whole sentence, since that is where
         the noun is. Only the VALUE has to be in the destination. */
      if (!mentionsEntity(t, f.entity)) continue;
      for (const word of Object.keys(f.vocabulary)) {
        if (!fuzzyContains(destination, word)) continue;
        if (!hit || word.length > hit.alias.length) hit = { field: f, alias: word };
      }
    }
    return hit;
  };

  let best: { field: WritableField; alias: string } | null = null;
  for (const f of WRITABLE_FIELDS) {
    if (caps && !caps.has(f.capability)) continue;
    for (const a of f.aliases) {
      if (!t.includes(` ${a} `) && !t.includes(` ${a}s `) && !fuzzyContains(t, a)) continue;
      /* A word somebody is POINTING at is the thing, not a column of
         it. "Add a note to this customer" was filed as a change to a
         trailer's customer column, because "customer" is a longer alias
         than "note" and nothing looked at the word in front of it. */
      if (pointedAt(t, a)) continue;
      if (!best || a.length > best.alias.length) best = { field: f, alias: a };
    }
  }
  /* An alias that is also one of its own field's VALUES is describing
     the rows, not naming the column.

     "Curtainsiders" is an alias of the category field and also a
     category, so "mark all the in stock curtainsiders as sold" matched
     it, and matched it more strongly than anything else because it is a
     long word. The instruction became: set the category to Curtainsider
     on every trailer in stock.

     "Paid in full" is an alias of its field and not a value of it, so
     "set paid in full on STC143980 to yes" is a sentence that genuinely
     names its column and keeps it. */
  if (best) {
    const alias = best.alias;
    /* Two ways an alias can be describing the rows or the price rather
       than naming the column being written.

       It is also one of its own field's VALUES. "Curtainsiders" is an
       alias of the category field and also a category, so "mark all the
       in stock curtainsiders as sold" set the category to Curtainsider
       on every trailer in stock.

       It is inside the half that says what the rows BECOME. "Mark
       STC143580 as sold for £24,995" is a sale at a price, and the
       price words are in the destination alongside the state, so the
       sentence came out as a change to the sale price with the sale
       itself dropped. "Set paid in full on STC143980 to yes" keeps its
       column, because that alias is in the half describing the record. */
    const namesAValue = !!best.field.vocabulary
      && Object.keys(best.field.vocabulary).some((w) => w === alias || w.startsWith(alias));
    const aliasIsInDestination = destination.includes(` ${alias} `);

    if (namesAValue || aliasIsInDestination) {
      const destinationField = destinationState();
      if (destinationField && destinationField.field.key !== best.field.key) return destinationField;
    }
    return best;
  }

  /* Some sentences name the field by naming the value. "Move STC143980
     to Carrington" never says the word location, and asking somebody to
     say it is the sort of thing that makes people stop using the bar. */
  if (MOVE_WORDS.some((w) => t.includes(` ${w} `))) {
    for (const word of Object.keys(DEPOTS)) {
      if (!t.includes(` ${word} `)) continue;
      const loc = WRITABLE_FIELDS.find((f) => f.key === 'location' && f.entity === 'trailers');
      if (loc && (!caps || caps.has(loc.capability))) return { field: loc, alias: word };
    }
  }

  /* Same again for a state. "Mark STC143580 as sold" and "mark all
     outstanding social posts as approved" never say the word status, and
     nobody would. Only after an explicit marking verb, so a question
     with the word "sold" in it is not turned into an instruction.

     Which entity, from which vocabulary owns the word. Longest match
     wins so "pending review" is not read as "review". */
  if (MARK_WORDS.some((w) => fuzzyContains(t, w))) {
    /* The destination half first, for the same reason as above. */
    const destinationField = destinationState();
    if (destinationField) return destinationField;

    let hit: { field: WritableField; alias: string } | null = null;
    for (const f of WRITABLE_FIELDS) {
      if (f.kind !== 'enum' || !f.vocabulary) continue;
      if (caps && !caps.has(f.capability)) continue;
      // Only where the sentence is plausibly about this entity.
      if (!mentionsEntity(t, f.entity)) continue;
      for (const word of Object.keys(f.vocabulary)) {
        if (!fuzzyContains(t, word)) continue;
        if (!hit || word.length > hit.alias.length) hit = { field: f, alias: word };
      }
    }
    if (hit) return hit;
  }
  return null;
}

/** Words that point at what is on the screen rather than at a column. */
const POINTING = ['this', 'that', 'these', 'those', 'the current', 'the open'];

function pointedAt(softened: string, alias: string): boolean {
  return POINTING.some((p) => softened.includes(` ${p} ${alias} `));
}

/** Marking verbs, which is what turns a state word into an instruction. */
const MARK_WORDS = [
  'mark', 'set', 'make', 'flag', 'change', 'move', 'switch', 'update', 'put',
  /* The verb is often the state itself. "Sell STC143580" and "approve all
     the outstanding posts" name no field and no status word, and both
     were falling through to the query engine and being answered as
     questions. */
  'sell', 'sold', 'approve', 'approving', 'sign off', 'publish', 'schedule', 'scrap',
];

/** Words that say which table a sentence is about. */
const ENTITY_WORDS: Record<WritableEntity, string[]> = {
  trailers: ['trailer', 'trailers', 'unit', 'units', 'stock', 'stc', 'vehicle', 'vehicles'],
  contacts: ['customer', 'customers', 'contact', 'contacts', 'account', 'accounts',
             'company', 'companies', 'lead', 'leads', 'deal', 'deals', 'proposal', 'proposals'],
  posts: ['post', 'posts', 'social', 'socials', 'content'],
  meetings: ['meeting', 'meetings', 'call', 'calls', 'appointment', 'appointments',
             'visit', 'visits', 'diary', 'event', 'events'],
};

function mentionsEntity(softened: string, entity: WritableEntity): boolean {
  if (ENTITY_WORDS[entity].some((w) => softened.includes(` ${w} `))) return true;
  // A stock reference names a trailer without using any of those words.
  if (entity === 'trailers') return /\bstc[\s\-_]?\d{3,8}\b/i.test(softened);
  return false;
}

/** set, add, subtract or clear, from the words around it. */
function findOp(text: string): { op: EditOp; word: string } {
  const t = soften(text);
  const longest = (words: string[]) => {
    let hit = '';
    for (const w of words) if (t.includes(` ${w} `) && w.length > hit.length) hit = w;
    return hit;
  };
  const clear = longest(CLEAR_WORDS);
  const add = longest(ADD_WORDS);
  const sub = longest(SUB_WORDS);
  const set = longest(SET_WORDS);

  // Longest wins, so "take off" is a subtraction rather than a set on the
  // word "off", and "add another" beats the bare "add".
  /* A split verb outranks whatever single word the contiguous lists
     found, because "take 100 off" ends up matching the bare "to" in the
     set list and quietly becomes a set. */
  const splitSub = SPLIT_SUB.exec(t);
  if (splitSub && !clear) return { op: 'subtract', word: splitSub[1] };
  const splitAdd = SPLIT_ADD.exec(t);
  if (splitAdd && !clear && !sub) return { op: 'add', word: splitAdd[1] };

  const best = [
    { op: 'clear' as EditOp, word: clear },
    { op: 'subtract' as EditOp, word: sub },
    { op: 'add' as EditOp, word: add },
    { op: 'set' as EditOp, word: set },
  ].sort((a, b) => b.word.length - a.word.length)[0];

  return best.word ? best : { op: 'set', word: '' };
}

/**
 * A company name, for the sentences that name a customer rather than a
 * stock number. Taken from after the preposition, with the field words
 * and anything reserved stripped, because "add a note to Dawson" means
 * the company and "add a note to the record" means nothing at all.
 *
 * `value` is what the sentence is going to write, and it is here to
 * settle the one word English uses for both jobs. "On", "for" and
 * "against" name the record. "To" usually introduces the new value, so
 * it is only read as the record when nothing else was, and when what it
 * captured turns out to BE the value it is not the record either:
 *
 *   assign Dawson Group to Dave
 *
 * came back as a change to a customer called Dave, with the owner set
 * to Dave, at a confidence high enough to act on. The company is in the
 * other half of the sentence, which is where this looks next.
 */
function findCompany(
  original: string, fieldAlias: string, value: string | number | null, opWord: string,
): string | null {
  const cleaned = original
    .split(':')[0]
    .replace(new RegExp(fieldAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const STOP = String.raw`(?=\s+(?:to|and|with|as|is|are|=|from)\b|[:,;]|$)`;
  const tidy = (raw: string): string | null => {
    const trimmed = raw.trim().replace(/[.,:;]+$/, '');
    if (!trimmed) return null;
    const words = trimmed.split(/\s+/)
      .filter((w) => !NOT_A_VALUE.has(lower(w)))
      .filter((w) => !opWord || lower(w) !== lower(opWord));
    if (!words.length) return null;
    if (words.every((w) => isReservedWord(w))) return null;
    const name = words.join(' ');
    return name.length >= 2 ? name : null;
  };

  const named = tidy(
    cleaned.match(new RegExp(String.raw`\b(?:on|for|against)\s+([A-Za-z0-9&'.\- ]{2,60}?)${STOP}`, 'i'))?.[1] ?? '',
  );
  if (named) return named;

  const afterTo = tidy(
    cleaned.match(new RegExp(String.raw`\bto\s+([A-Za-z0-9&'.\- ]{2,60}?)${STOP}`, 'i'))?.[1] ?? '',
  );
  const isTheValue = afterTo != null && value != null
    && lower(afterTo) === lower(String(value));
  if (afterTo && !isTheValue) return afterTo;

  /* The half before the word that introduced the value. "Assign Dawson
     Group to Dave" says who it is about first and what it becomes
     second, which is the ordinary way round for a verb that takes both. */
  if (isTheValue) return tidy(cleaned.split(/\s+\b(?:to|as|into)\b\s+/i)[0] ?? '');
  return null;
}

/**
 * An instruction, or null if this is not one.
 *
 * Returns a plan even when something is still missing, because the one
 * thing a command bar must never do is throw away a sentence somebody
 * has already typed. Missing the amount is a question worth asking.
 * Missing the whole instruction is not.
 */
export function parseEdit(
  input: string,
  caps?: CrmCapabilities,
  vocabulary: VocabularyIndex = EMPTY_VOCABULARY,
  context: CommandContext = EMPTY_CONTEXT,
): EditPlan | null {
  const raw = input.trim();
  if (raw.length < 4) return null;

  const field = findField(raw, caps);
  if (!field) return null;

  // A question is not an instruction. "How much is the refurb on STC1"
  // names a field and a record and still wants an answer, not a write.
  if (/^\s*(how|what|which|who|when|where|why|is there|are there|do we|did we|can you tell)\b/i.test(raw)) return null;
  if (raw.trim().endsWith('?')) return null;

  const refs = readRecordRefs(raw);
  const stock = refs.stc.length ? { value: refs.stc[0], raw: refs.stc[0] } : null;

  /* Notes, status and location exist on both a trailer and a customer,
     and the trailer copy is listed first. A sentence with no stock
     number in it is not about a trailer, so the customer copy wins.
     Without this, "add a note to Dawson" is filed against the stock
     list and then has nowhere to go. */
  let spec = field.field;
  if (!stock && spec.entity === 'trailers') {
    const twin = WRITABLE_FIELDS.find(
      (f) => f.entity === 'contacts' && f.aliases.includes(field.alias)
        && (!caps || caps.has(f.capability)),
    );
    if (twin) spec = twin;
  }

  /* WITHOUT THE FIELD'S OWN NAME IN IT.

     "Clear the refurb update on STC143580" was read as a SET with no
     value, because "update" is one of the words that means set and it
     is longer than "clear", and it is in the sentence only because it
     is half the field's name. A verb inside the column's own name is
     not a verb. */
  const { op: rawOp, word: opWord } = findOp(
    raw.replace(new RegExp(field.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' '),
  );

  /* The value hunt runs on the sentence with the record reference and
     the field name taken out. Without that, "add 1k refurb to STC143980"
     reads 143980 as the amount, which is the kind of bug that puts six
     figures on a trailer. */
  let stripped = raw;
  for (const r of refs.raws) stripped = stripped.replace(r, ' ');
  stripped = stripped
    .replace(new RegExp(spec.aliases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'ig'), ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let value: string | number | null = null;
  let valueLabel = '';

  if (rawOp !== 'clear') {
    switch (spec.kind) {
      case 'money': {
        const a = readAmount(stripped);
        if (a) { value = a.value; valueLabel = formatMoney(a.value); }
        break;
      }
      case 'number': {
        const a = readAmount(stripped);
        if (a) { value = a.value; valueLabel = String(a.value); }
        break;
      }
      case 'date': {
        const d = readDate(stripped);
        if (d) { value = d.value; valueLabel = d.raw; }
        break;
      }
      case 'enum': {
        const vocab = spec.vocabulary ?? {};
        /* Which state is the destination and which is the subset.
           "Mark all outstanding social posts as approved" contains both,
           and taking the longest match made it set every approved post
           back to outstanding: the instruction exactly inverted. The
           word after "as" or "to" is where the record is going. */
        const { destination, subject } = splitOnAs(stripped);
        const pick = (segment: string) => {
          const t = soften(segment);
          let hit = '';
          for (const word of Object.keys(vocab)) {
            if (fuzzyContains(t, word) && word.length > hit.length) hit = word;
          }
          return hit;
        };
        /* With no "as" in the sentence the verb is the destination.
           "Approve all the outstanding posts" contains both states and no
           split, and taking the longest match set every approved post
           back to outstanding: the instruction exactly inverted. */
        const opener = soften(stripped.trim().split(/\s+/).slice(0, 2).join(' '));
        const fromVerb = Object.keys(vocab)
          .filter((w) => fuzzyContains(opener, w))
          .sort((a, b) => b.length - a.length)[0] ?? '';
        const hit = pick(destination) || fromVerb || pick(subject);
        if (hit) { value = vocab[hit]; valueLabel = String(vocab[hit]).replace(/_/g, ' '); }
        break;
      }
      case 'text':
      case 'longtext': {
        const t = readFreeText(stripped, spec, opWord);
        if (t) { value = t; valueLabel = t; }
        break;
      }
    }
  }

  /* Setting the stock number is the one instruction where the STC
     reference is the value rather than the record. A unit arrives on its
     chassis number and is given a stock number later, so "add stock
     number STC150001 to C734105" writes STC150001 onto the record found
     by C734105. Read the other way round it renames the wrong trailer. */
  const stcNoField = spec.key === 'stc_no';
  if (stcNoField && rawOp !== 'clear') {
    value = refs.stc[0] ?? null;
    valueLabel = String(value ?? '');
  }

  /* A minus sign with no verb is a reduction. "stc143140 refurb -100"
     means take a hundred off, not store minus a hundred, and a negative
     refurb cost is not a thing that exists. */
  let op = rawOp;
  if (typeof value === 'number' && value < 0 && (op === 'set' || op === 'add')) {
    op = 'subtract';
    value = Math.abs(value);
    valueLabel = formatMoney(value);
  }

  // Adding to something that cannot be added to is just setting it.
  if ((op === 'add' || op === 'subtract') && !spec.arithmetic) op = 'set';
  if (op === 'subtract' && spec.kind !== 'money' && spec.kind !== 'number') op = 'set';

  /* Which records. All of them, because "mark STC143580 and 144504 as
     sold" is two units and doing one of them silently is a bug that
     looks like a success.

     Bare digits are only trusted when the field cannot take a number
     anyway, or when the sentence already named a record properly. That
     is what stops "set refurb 143980 on STC1" reading the amount as a
     second trailer. */
  let named: string[] = [];

  if (stcNoField) {
    named = [...refs.coded, ...refs.bare];
  } else {
    named = [...refs.stc];
    const numeric = spec.kind === 'money' || spec.kind === 'number';
    if (!numeric || named.length) {
      for (const b of refs.bare) if (!named.some((t) => t.endsWith(b))) named.push(b);
      if (!numeric) for (const c of refs.coded) named.push(c);
    }
    if (!named.length && spec.entity === 'contacts') {
      const name = findCompany(raw, field.alias, value, opWord);
      if (name) named = [name];
    }
  }

  /* THE SAME CONDITION MACHINERY A QUESTION USES.
     A named record is a loose match on the entity's own title. A
     described set goes through `parseQuery`, which is the reader that
     already knows what "available curtainsiders at Hyde" means, and its
     filters become a `Cond` through the one function that turns filters
     into conditions. `readBulkTarget` is gone: it read one enum on the
     field being written and nothing else. */
  const title = entityDef(spec.entity)?.titleField ?? null;
  let match: Cond | null = null;
  let expect: Cardinality = 'one';
  let matchLabel = '';

  if (named.length && title) {
    const conds: Cond[] = named.map((t) => ({
      kind: 'cmp', op: 'contains',
      left: { kind: 'field', of: { entity: spec.entity, field: title } },
      right: { kind: 'literal', value: t },
    }));
    match = conds.length === 1 ? conds[0] : { kind: 'or', of: conds };
    matchLabel = named.join(' and ');
  } else if (!named.length) {
    /* WHAT IS ON THE SCREEN, WHEN THE SENTENCE POINTS AT IT.

       "Add a note to this customer" and "move these to Bredbury" are
       about records the person is looking at, and the screen sends what
       it has. It resolves to ids and nothing else, so a context that
       resolved to a name could never match a record nobody was looking
       at. Read before the described set, because "these" is not a
       description of anything. */
    const pointed = readContextReference(raw);
    const fromScreen = pointed ? resolveContext(pointed, context, spec.entity) : null;
    if (fromScreen) {
      match = fromScreen.match;
      expect = fromScreen.expect;
      matchLabel = fromScreen.label;
    } else {
      const described = readDescribedSet(raw, spec, value, vocabulary);
      if (described) {
        match = described.match;
        expect = 'many';
        matchLabel = described.label;
      }
    }
  }

  /* Selling is understood here and carried out elsewhere. It needs a
     price and it raises a commission line on somebody's tracker, so the
     bar names the units and hands over rather than quietly writing a
     status column. */
  const handoff = spec.key === 'status' && spec.entity === 'trailers' && value === 'sold'
    ? ('markSold' as const) : undefined;
  if (handoff && !match) return null;

  /* WHAT THE OPERATION NEEDS, IF THE SENTENCE SAID IT.

     The capability declares its inputs and this looks for each one in
     the words, using the readers that were already here for field
     values. Nothing about a sale is written here: "mark STC143580 as
     sold for £24,995" carries a price because the capability says a
     sale takes one, and an operation added later is read the same way
     without this file changing. */
  const args = handoff
    ? readCapabilityInputs(withoutReferences(raw, named), HANDOFF_CAPABILITY[handoff])
    : undefined;

  const missing: ('target' | 'value')[] = [];
  if (!match) missing.push('target');
  if (op !== 'clear' && value == null) missing.push('value');

  /* A bare field name with nothing else said is somebody starting a
     sentence, not giving an instruction. Offering to write a column at
     that point is presumptuous, and it steals the input from the query
     engine for anybody who was about to ask a question about it. */
  if (missing.length === 2) return null;

  return {
    entity: spec.entity,
    field: spec,
    op,
    value,
    valueLabel,
    match,
    expect,
    matchLabel,
    named,
    handoff,
    ...(args && Object.keys(args).length ? { args } : {}),
    missing,
    summary: handoff
      ? `Mark ${matchLabel} sold`
      : describe(spec, op, valueLabel, matchLabel),
    confidence: confidenceOf(
      spec, op, value,
      { named: named.length, stock: refs.stc.length > 0, described: !named.length && !!match },
      /* The verb that made this an instruction, whichever list it came
         from. "Approve all the outstanding social posts" has no set,
         add, subtract or clear word in it, so it scored as though
         nobody had said what to do, came one point under the threshold
         that decides instruction from question, and was answered with a
         list of posts. */
      opWord || (MARK_WORDS.find((w) => fuzzyContains(soften(raw), w)) ?? ''),
    ),
  };
}

/**
 * The sentence with the records it names taken out.
 *
 * A stock number is six digits, and reading a business operation's price
 * out of the whole sentence turned "mark STC143580 as sold" into a sale
 * at one hundred and forty three thousand five hundred and eighty
 * pounds. The reference is not a value, whatever it looks like.
 */
function withoutReferences(raw: string, named: string[]): string {
  let out = raw.replace(/\bSTC\s?\d+\b/gi, ' ');
  for (const n of named) out = out.split(n).join(' ');
  return out.replace(/\s+/g, ' ');
}

/** Which capability each handoff hands off to. */
const HANDOFF_CAPABILITY: Record<'markSold', string> = { markSold: 'deal.markSold' };

/**
 * Values a business operation declares it needs, found in the sentence.
 *
 * One loop over `CapabilityDef.inputs`, using the same readers a field
 * value goes through. A capability that declares a money input gets the
 * amount out of "for £24,995"; one that declares a date gets the date.
 * Neither this function nor the capability knows about the other beyond
 * the declaration.
 */
function readCapabilityInputs(
  raw: string, capabilityId: string,
): Record<string, string | number | null> {
  const cap = capability(capabilityId);
  const out: Record<string, string | number | null> = {};
  for (const input of cap?.inputs ?? []) {
    if (input.kind === 'money' || input.kind === 'number') {
      const a = readAmount(soften(raw));
      if (a) out[input.key] = a.value;
    } else if (input.kind === 'date') {
      const d = readDate(soften(raw));
      if (d) out[input.key] = d.value;
    }
  }
  return out;
}

/**
 * "All the outstanding ones at Hyde", rather than a named record.
 *
 * Read by `parseQuery`, which is the machinery that already knows what
 * a described set of rows is. `readBulkTarget` used to live here and
 * did the job badly: it matched one enum value on the field being
 * written, so it could read "all the outstanding posts" and could not
 * read "every available curtainsider at Hyde". Deleting it removed a
 * ceiling rather than a feature.
 *
 * Still refuses a sentence that names no subset. "Approve everything"
 * is four words and a whole table, and a bar that acts on that is a bar
 * that ruins somebody's afternoon.
 */
function readDescribedSet(
  raw: string, spec: WritableField, value: string | number | null,
  vocabulary: VocabularyIndex,
): { match: Cond; label: string } | null {
  const t = soften(raw);
  /* A word that genuinely means every match. Without one, a sentence
     with no named record is incomplete rather than a bulk write. */
  if (!COLLECTIVE.test(t)) return null;

  /* WHICHEVER HALF THE COLLECTIVE WORD IS IN.
     One half of the sentence describes the rows and the other says what
     they become, and English puts them in either order:

       move every available curtainsider at Hyde to Bredbury
       add 250 refurb costs to every available curtainsider at Hyde

     Always taking the half before the split word read the second of
     those as "add 250 refurb costs", which names no rows at all, so the
     instruction came back incomplete. The word that means every match is
     in the half that describes the rows, by definition, which is a
     better question to ask than which side of the sentence it is on. */
  const halves = splitOnAs(raw);
  const inSubject = COLLECTIVE.test(soften(halves.subject));
  const inDestination = COLLECTIVE.test(soften(halves.destination));
  const subject = inSubject === inDestination ? halves.subject
    : inSubject ? halves.subject : halves.destination;

  const read = parseQuery(subject, vocabulary);
  if (!read || read.entity.id !== spec.entity) return null;

  /* The destination is not a description of the rows.
     "Approve all outstanding posts" has no "as" to split on, so the word
     the value came from is still in the subject, and selecting on it
     would pick the posts that are already approved.

     Only that exact value goes, not every mention of the column. The
     column being written is very often the column the rows are described
     by: "move every available curtainsider at Hyde to Bredbury" writes
     the location and selects on it, and dropping the whole column
     narrowed that to every trailer in the yard. */
  const filters = read.filters.filter(
    (f) => !(f.column === spec.key && String(f.value ?? '') === String(value ?? '')),
  );
  const match = condForFilters(spec.entity, filters);
  if (!match) return null;

  return {
    match,
    label: read.summary.replace(/^Count of /i, 'every ').replace(/^List of /i, 'every '),
  };
}

/**
 * Split an instruction at the word that introduces the new value.
 *
 * "Mark all outstanding social posts as approved" is two halves: which
 * records, then what they become. Reading it as one string meant the
 * longest state word won, and the longest one was the description of the
 * records rather than their destination.
 */
/** A word that means every match, rather than some of them. */
const COLLECTIVE = /\b(all|every|any|the lot|everything|each)\b/;

function splitOnAs(text: string): { subject: string; destination: string } {
  const m = text.match(/^(.*?)\s+(?:as|to|into)\s+(.+)$/i);
  if (!m) return { subject: text, destination: '' };
  return { subject: m[1], destination: m[2] };
}

function readFreeText(stripped: string, spec: WritableField, opWord: string): string | null {
  // Anything after a colon is the whole point of the sentence: "add a
  // note to Dawson: chasing tyre quote".
  const colon = stripped.match(/:\s*(.+)$/);
  if (colon) return colon[1].trim();

  /* A depot name is a location however it is phrased, and a sentence
     that moves rows between depots names two of them:

       move all the trailers at Carrington to Hyde

     Taking the first left every Carrington trailer set to Carrington,
     which is a change that looks like it worked and does nothing. The
     half after "to" is where they are going. */
  if (spec.key === 'location') {
    const depot = (text: string): string | null => {
      const t = ` ${text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ')} `;
      for (const [word, name] of Object.entries(DEPOTS)) {
        if (t.includes(` ${word} `)) return name;
      }
      return null;
    };
    const halves = splitOnAs(stripped);
    return depot(halves.destination) ?? depot(stripped);
  }

  // Otherwise the words after "to" or after the verb, minus the filler.
  const after = stripped.match(/\b(?:to|as|=)\s+(.+)$/i)?.[1]
    ?? (opWord ? stripped.split(new RegExp(`\\b${opWord}\\b`, 'i')).slice(1).join(' ') : '');
  const words = (after || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !NOT_A_VALUE.has(lower(w.replace(/[.,:;]+$/, ''))));
  const out = words.join(' ').replace(/[.,:;]+$/, '').trim();
  return out.length >= 2 ? out : null;
}

function formatMoney(n: number): string {
  return `£${n.toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;
}

function describe(
  spec: WritableField, op: EditOp, valueLabel: string, matchLabel: string,
): string {
  const on = matchLabel ? ` on ${matchLabel}` : '';
  switch (op) {
    case 'clear': return `Clear ${spec.label}${on}`;
    case 'add':
      return spec.kind === 'longtext'
        ? `Add to ${spec.label}${on}`
        : `Add ${valueLabel || 'an amount'} to ${spec.label}${on}`;
    case 'subtract': return `Take ${valueLabel || 'an amount'} off ${spec.label}${on}`;
    default: return `Set ${spec.label} to ${valueLabel || 'a value'}${on}`;
  }
}

/**
 * How sure this reading is.
 *
 * `selection` is what the sentence gave us to find rows with, not the
 * `Cond` it became. Scoring the condition tree would say a loose title
 * match and a stock number are the same shape, and they are not: a stock
 * number is one unit and nothing else, whereas a company name is a guess
 * that happens to be expressible as the same comparison.
 *
 * A DESCRIBED SET COUNTS AS SAYING WHICH ROWS.
 *
 * It scored nothing at all until the reader could express one properly.
 * "Move every available curtainsider at Hyde to Bredbury" names three
 * things about the rows and came out one point below the threshold that
 * decides whether a sentence is an instruction, so it was read as a
 * question, and the question it was read as had the destination in its
 * filters: "list trailers in stock, curtainsiders, at Bredbury". A
 * confident wrong answer, from a scorer that had never seen a sentence
 * like it because the reader could not produce one.
 */
function confidenceOf(
  spec: WritableField, op: EditOp, value: string | number | null,
  selection: { named: number; stock: boolean; described: boolean }, opWord: string,
): number {
  let score = 4;
  if (selection.stock) score += 4;                 // a stock number is unambiguous
  else if (selection.named || selection.described) score += 2;
  if (value != null) score += 3;
  if (opWord) score += 2;
  if (op === 'clear') score += 1;
  // A free text field with a guessed value is the easiest thing to get
  // wrong, so it has to clear a higher bar before it is acted on.
  if ((spec.kind === 'text' || spec.kind === 'longtext') && !opWord) score -= 2;
  return score;
}

/* =============================================================
   Guiding, rather than waiting to be guessed at.

   Somebody who types a stock number and stops has not failed. They are
   part way through a sentence, and the bar knows every field that
   sentence could end in. These are the endings worth offering.
   ============================================================= */
export type EditSuggestion = { phrase: string; label: string; sub: string; score: number };

/** The fields most worth offering first, because they are what changes. */
const PROMINENT = [
  'refurb_costs', 'location', 'status', 'sales_price', 'nbv', 'retail_price',
  'mot_date', 'customer', 'notes', 'sales_rep',
];

/**
 * Words that mean this is a question, not the start of an instruction.
 *
 * "Show me this month's profit" was offering Set Profit on a customer,
 * because the sentence names a writable field and nothing said it was a
 * read. Offering to write a column to somebody who asked to see a number
 * is the same failure as answering an instruction with a count, in the
 * other direction.
 */
const ASKING = /\b(show me|how much|how many|what is|what are|whats|which|list|export|download|count|total|value of|report|give me)\b/i;

export function composeEdits(input: string, caps: CrmCapabilities, limit = 6): EditSuggestion[] {
  const raw = input.trim();
  if (raw.length < 3) return [];
  if (raw.endsWith('?')) return [];
  if (ASKING.test(raw)) return [];

  const stock = readStockRef(raw);
  const field = findField(raw, caps);
  const out: EditSuggestion[] = [];
  const push = (phrase: string, label: string, sub: string, score: number) => {
    if (out.some((o) => o.phrase.toLowerCase() === phrase.toLowerCase())) return;
    out.push({ phrase, label, sub, score });
  };

  // A stock number on its own: offer what can be done to that trailer.
  if (stock && !field) {
    const fields = WRITABLE_FIELDS
      .filter((f) => f.entity === 'trailers' && caps.has(f.capability))
      .sort((a, b) => rank(a.key) - rank(b.key));
    for (const f of fields.slice(0, limit)) {
      push(
        `set ${f.aliases[0]} on ${stock.value} to `,
        `Set ${f.label} on ${stock.value}`,
        exampleFor(f),
        90 - rank(f.key),
      );
    }
    return out.slice(0, limit);
  }

  // A field named with no record: show the shape of the finished sentence.
  if (field && !stock) {
    const f = field.field;
    if (f.entity === 'trailers') {
      push(`set ${field.alias} on STC00000 to `, `Set ${f.label} on a trailer`,
        'Name the stock number, like STC143980', 84);
      if (f.arithmetic && f.kind !== 'longtext') {
        push(`add 1000 ${field.alias} to STC00000`, `Add to ${f.label} on a trailer`,
          'Adds to whatever is already there', 80);
      }
    } else {
      push(`set ${field.alias} on `, `Set ${f.label} on a customer`,
        'Name the company after "on"', 84);
    }
    return out.slice(0, limit);
  }

  return [];
}

function rank(key: string): number {
  const i = PROMINENT.indexOf(key);
  return i === -1 ? PROMINENT.length + 1 : i;
}

function exampleFor(f: WritableField): string {
  switch (f.kind) {
    case 'money': return 'An amount, like £1,250 or 1.2k';
    case 'number': return 'A whole number';
    case 'date': return 'A date, like 14/03/2027';
    case 'enum': return Object.values(f.vocabulary ?? {})
      .filter((v, i, a) => a.indexOf(v) === i).slice(0, 4).join(', ').replace(/_/g, ' ');
    case 'longtext': return 'Free text, added to what is there';
    default: return 'Free text';
  }
}
