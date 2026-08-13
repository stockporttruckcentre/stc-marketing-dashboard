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
import { DEPOTS, isReservedWord } from './lexicon';
import { distance } from './normalise';
import type { CrmCapabilities } from '@/lib/crm/permissions';

export type EditOp = 'set' | 'add' | 'subtract' | 'clear';

export type EditTarget =
  /** One record, named by its stock number or its company name. */
  | { kind: 'stock'; text: string; label: string }
  | { kind: 'company'; text: string; label: string }
  /**
   * Every record matching a description, for the instructions people
   * give in bulk: "mark all outstanding social posts as approved". The
   * confirmation counts them before anything is written, because "all"
   * is a word worth being sure about.
   */
  | { kind: 'filter'; text: string; label: string; column: string; value: string };

export type EditPlan = {
  entity: WritableEntity;
  field: WritableField;
  op: EditOp;
  /** Null for a clear, and null while the value is still missing. */
  value: string | number | null;
  valueLabel: string;
  /** The first record named. Kept for the single record case. */
  target: EditTarget | null;
  /**
   * Every record named. "Mark STC143580 and 144504 as sold" is two
   * units, and answering it for one of them is a bug that looks like it
   * worked.
   */
  targets: EditTarget[];
  /**
   * Some instructions are understood here and carried out somewhere
   * else. Selling raises a commission line on a tracker and needs a
   * price, so the bar hands it to that flow with the units already
   * named rather than writing a status column behind its back.
   */
  handoff?: 'markSold';
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
  let best: { field: WritableField; alias: string } | null = null;
  for (const f of WRITABLE_FIELDS) {
    if (caps && !caps.has(f.capability)) continue;
    for (const a of f.aliases) {
      if (!t.includes(` ${a} `) && !t.includes(` ${a}s `) && !fuzzyContains(t, a)) continue;
      if (!best || a.length > best.alias.length) best = { field: f, alias: a };
    }
  }
  if (best) return best;

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
 */
function findCompany(original: string, fieldAlias: string): string | null {
  const cleaned = original
    .split(':')[0]
    .replace(new RegExp(fieldAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ')
    .replace(/\s+/g, ' ')
    .trim();

  /* The capture has to stop before the value, or "change the owner on
     Dawson Group to Dave" files the change against a company called
     Dawson Group Dave. "on", "for" and "against" name the record; "to"
     usually introduces the new value, so it is only read as the record
     when nothing else did. */
  const STOP = String.raw`(?=\s+(?:to|and|with|as|is|are|=|from)\b|[:,;]|$)`;
  const m =
    cleaned.match(new RegExp(String.raw`\b(?:on|for|against)\s+([A-Za-z0-9&'.\- ]{2,60}?)${STOP}`, 'i'))
    ?? cleaned.match(new RegExp(String.raw`\bto\s+([A-Za-z0-9&'.\- ]{2,60}?)${STOP}`, 'i'));
  const raw = (m?.[1] ?? '').trim().replace(/[.,:;]+$/, '');
  if (!raw) return null;
  const words = raw.split(/\s+/).filter((w) => !NOT_A_VALUE.has(lower(w)));
  if (!words.length) return null;
  if (words.every((w) => isReservedWord(w))) return null;
  const name = words.join(' ');
  return name.length >= 2 ? name : null;
}

/**
 * An instruction, or null if this is not one.
 *
 * Returns a plan even when something is still missing, because the one
 * thing a command bar must never do is throw away a sentence somebody
 * has already typed. Missing the amount is a question worth asking.
 * Missing the whole instruction is not.
 */
export function parseEdit(input: string, caps?: CrmCapabilities): EditPlan | null {
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

  const { op: rawOp, word: opWord } = findOp(raw);

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
  const asTarget = (t: string): EditTarget => ({ kind: 'stock', text: t, label: t });
  let targets: EditTarget[] = [];

  if (stcNoField) {
    targets = [...refs.coded, ...refs.bare].map(asTarget);
  } else {
    targets = refs.stc.map(asTarget);
    const numeric = spec.kind === 'money' || spec.kind === 'number';
    if (!numeric || targets.length) {
      for (const b of refs.bare) if (!targets.some((t) => t.text.endsWith(b))) targets.push(asTarget(b));
      if (!numeric) for (const c of refs.coded) targets.push(asTarget(c));
    }
    if (!targets.length && spec.entity === 'contacts') {
      const name = findCompany(raw, field.alias);
      if (name) targets = [{ kind: 'company', text: name, label: name }];
    }
    if (!targets.length) {
      const bulk = readBulkTarget(raw, spec, String(value ?? ''));
      if (bulk) targets = [bulk];
    }
  }
  const target = targets[0] ?? null;

  /* Selling is understood here and carried out elsewhere. It needs a
     price and it raises a commission line on somebody's tracker, so the
     bar names the units and hands over rather than quietly writing a
     status column. */
  const handoff = spec.key === 'status' && spec.entity === 'trailers' && value === 'sold'
    ? ('markSold' as const) : undefined;
  if (handoff && !targets.length) return null;

  const missing: ('target' | 'value')[] = [];
  if (!target) missing.push('target');
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
    target,
    targets,
    handoff,
    missing,
    summary: handoff
      ? `Mark ${targets.map((t) => t.label).join(' and ')} sold`
      : describe(spec, op, valueLabel, target, targets),
    confidence: confidenceOf(spec, op, value, target, opWord),
  };
}

/**
 * "All the outstanding ones", rather than a named record.
 *
 * Only fires on a word that genuinely means every match, and only when
 * the sentence also says which ones. "Mark all outstanding social posts
 * as approved" narrows to the ones awaiting approval; "approve
 * everything" names no subset and is refused, because a bar that acts on
 * a whole table from four words is a bar that ruins somebody's afternoon.
 *
 * Nothing is written on the strength of this. The confirmation counts
 * the matches first and says the number out loud.
 */
function readBulkTarget(raw: string, spec: WritableField, newValue: string): EditTarget | null {
  const t = soften(raw);
  if (!/\b(all|every|any|the lot|everything|each)\b/.test(t)) return null;

  /* Which subset, from the same vocabulary that supplies the new value,
     and read from the half of the sentence before "as". That is where
     the description of the rows lives; after it is where they are
     going. */
  if (spec.kind !== 'enum' || !spec.vocabulary) return null;
  const subject = soften(splitOnAs(raw).subject);
  let hit = '';
  let hitValue = '';
  for (const [word, value] of Object.entries(spec.vocabulary)) {
    if (value === newValue) continue;            // that is the destination, not the subset
    if (!subject.includes(` ${word} `)) continue;
    if (word.length > hit.length) { hit = word; hitValue = value; }
  }
  if (!hit) return null;

  return {
    kind: 'filter',
    text: hit,
    label: `every ${spec.entity === 'posts' ? 'post' : 'record'} currently ${hit}`,
    column: spec.key,
    value: hitValue,
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

  // A depot name is a location however it is phrased.
  if (spec.key === 'location') {
    const t = ` ${stripped.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ')} `;
    for (const [word, depot] of Object.entries(DEPOTS)) {
      if (t.includes(` ${word} `)) return depot;
    }
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
  spec: WritableField, op: EditOp, valueLabel: string,
  target: EditTarget | null, targets: EditTarget[] = [],
): string {
  const named = targets.length ? targets.map((t) => t.label).join(' and ') : target?.label;
  const on = named ? ` on ${named}` : '';
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

function confidenceOf(
  spec: WritableField, op: EditOp, value: string | number | null,
  target: EditTarget | null, opWord: string,
): number {
  let score = 4;
  if (target?.kind === 'stock') score += 4;        // a stock number is unambiguous
  else if (target) score += 2;
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

export function composeEdits(input: string, caps: CrmCapabilities, limit = 6): EditSuggestion[] {
  const raw = input.trim();
  if (raw.length < 3) return [];
  if (raw.endsWith('?')) return [];

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
