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
import { WRITABLE_FIELDS, type WritableField } from './fields';
import { DEPOTS, isReservedWord } from './lexicon';
import type { CrmCapabilities } from '@/lib/crm/permissions';

export type EditOp = 'set' | 'add' | 'subtract' | 'clear';

export type EditTarget =
  | { kind: 'stock'; text: string; label: string }
  | { kind: 'company'; text: string; label: string };

export type EditPlan = {
  entity: 'trailers' | 'contacts';
  field: WritableField;
  op: EditOp;
  /** Null for a clear, and null while the value is still missing. */
  value: string | number | null;
  valueLabel: string;
  target: EditTarget | null;
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

/* -------------------------------------------------------------
   Values.
   ------------------------------------------------------------- */

/**
 * Money and plain numbers, in the shorthand people actually write.
 * "£1k" is a thousand pounds, "1.2m" is 1,200,000, "8,500" is 8500.
 */
export function readAmount(text: string): { value: number; raw: string } | null {
  const m = text.match(/(£|\$|€)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|m|grand)?\b/i);
  if (!m) return null;
  let n = Number(m[2].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const suffix = (m[3] ?? '').toLowerCase();
  if (suffix === 'k' || suffix === 'grand') n *= 1000;
  if (suffix === 'm') n *= 1_000_000;
  return { value: n, raw: m[0].trim() };
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

/* -------------------------------------------------------------
   The parse.
   ------------------------------------------------------------- */

/** Verbs that mean "put it somewhere", which name the location field without saying it. */
const MOVE_WORDS = ['move', 'relocate', 'shift', 'transfer', 'park', 'parked', 'store', 'stored', 'send'];

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
      if (!t.includes(` ${a} `) && !t.includes(` ${a}s `)) continue;
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
  return null;
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

  const stock = readStockRef(raw);

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
  const stripped = raw
    .replace(stock?.raw ?? ' ', ' ')
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
        const t = soften(stripped);
        let hit = '';
        for (const word of Object.keys(vocab)) {
          if (t.includes(` ${word} `) && word.length > hit.length) hit = word;
        }
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

  /* Marking a trailer sold is not a field edit. It raises a commission
     line on somebody's tracker and has its own confirmation, so the bar
     hands it over rather than writing the column behind its back. */
  if (spec.key === 'status' && spec.entity === 'trailers' && value === 'sold') return null;

  // Adding to something that cannot be added to is just setting it.
  let op = rawOp;
  if ((op === 'add' || op === 'subtract') && !spec.arithmetic) op = 'set';
  if (op === 'subtract' && spec.kind !== 'money' && spec.kind !== 'number') op = 'set';

  const target: EditTarget | null = stock
    ? { kind: 'stock', text: stock.value, label: stock.value }
    : (() => {
        if (spec.entity !== 'contacts') return null;
        const name = findCompany(raw, field.alias);
        return name ? { kind: 'company' as const, text: name, label: name } : null;
      })();

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
    missing,
    summary: describe(spec, op, valueLabel, target),
    confidence: confidenceOf(spec, op, value, target, opWord),
  };
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

function describe(spec: WritableField, op: EditOp, valueLabel: string, target: EditTarget | null): string {
  const on = target ? ` on ${target.label}` : '';
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
