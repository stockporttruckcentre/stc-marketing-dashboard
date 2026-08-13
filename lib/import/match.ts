/* =============================================================
   Working out which column is which.

   Scoring, in the order it is trusted:

     100  the header is an exact alias
      92  the header contains an alias as a whole phrase
      78  the header is one or two typos from an alias
      70  the values overwhelmingly look like the field
      55  values look like it, less certainly

   Anything under 50 is not offered. A wrong guess the user has to notice
   and undo is worse than an honest "not mapped", because the whole point
   of the review step is that it is trustworthy enough to skim.

   Fields are assigned by best score first, so a sheet with both
   "Email" and "Old email" gives the real one to `email` and reports the
   other as a duplicate mapping rather than racing on column order.
   ============================================================= */
import { CRM_CONTACTS, fold, distance, type Dictionary, type FieldDef } from './dictionary';

/**
 * Words so generic they only count as an exact header, never as part of
 * a longer one. "Name" alone is a contact name; "Company Name" is not,
 * and without this rule the bare alias wins on containment and takes the
 * column off the field that should have had it.
 */
const EXACT_ONLY = new Set([
  'name', 'number', 'no', 'num', 'date', 'address', 'value', 'size',
  'units', 'state', 'detail', 'details', 'info', 'sales', 'account', 'source',
]);

/**
 * Words that only ever qualify a noun, never change it. "No of trailers"
 * is the trailers column; "trailer park operator" is not. The difference
 * is whether the leftover words are counting words or new subject matter.
 */
const QUALIFIERS = new Set([
  'no', 'number', 'num', 'of', 'count', 'total', 'qty', 'quantity', 'the',
  'their', 'current', 'approx', 'est', 'estimated', 'fleet', 'company',
  'customer', 'client', 'primary', 'main', 'contact', 'business',
]);

export type ColumnMatch = {
  /** The header exactly as it appeared, including whatever whitespace. */
  header: string;
  index: number;
  samples: string[];
  /** Target column, null for a deliberate drop, undefined for no match. */
  target?: string | null;
  field?: FieldDef;
  confidence: number;
  reason: string;
  /** Set when the user overrode the guess. */
  manual?: boolean;
};

const MIN = 50;

type Candidate = { field: FieldDef; score: number; reason: string };

function scoreHeader(header: string, field: FieldDef): Candidate | null {
  const h = fold(header);
  if (!h) return null;

  for (const alias of field.aliases) {
    const a = fold(alias);
    if (h === a) return { field, score: 100, reason: `header matches "${alias}"` };
  }
  const headerWords = h.split(' ');
  for (const alias of field.aliases) {
    const a = fold(alias);
    if (a.length < 4 || EXACT_ONLY.has(a)) continue;
    if (!new RegExp(`(^| )${a}( |$)`).test(h)) continue;
    // The leftover words decide it. Counting words qualify the same
    // column, so "no of trailers" is the trailers column. Anything else
    // means the header is about a different subject, so "trailer park
    // operator" is not.
    const aliasWords = new Set(a.split(' '));
    const leftover = headerWords.filter((w) => !aliasWords.has(w));
    if (leftover.every((w) => QUALIFIERS.has(w))) {
      return { field, score: 92, reason: `header contains "${alias}"` };
    }
  }
  for (const alias of field.aliases) {
    const a = fold(alias);
    if (a.length < 4) continue;
    const d = distance(h, a);
    if (d > 0 && d <= (a.length >= 8 ? 2 : 1)) {
      return { field, score: 78, reason: `header looks like "${alias}"` };
    }
  }
  return null;
}

function scoreValues(samples: string[], field: FieldDef): Candidate | null {
  if (!field.sniff) return null;
  const s = field.sniff(samples);
  if (s >= 0.8) return { field, score: 70, reason: `the values are ${field.label.toLowerCase()} addresses`.replace('email addresses addresses', 'email addresses') };
  if (s >= 0.6) return { field, score: 55, reason: `most values look like ${field.label.toLowerCase()}` };
  return null;
}

/**
 * Match every column, then hand each field to its strongest claimant.
 *
 * The second pass matters. Sorting by score and assigning greedily is
 * what stops the first column that vaguely resembles an email from
 * taking the field off a column that plainly is one.
 */
export function matchColumns(
  headers: string[],
  rows: Record<string, any>[],
  dict: Dictionary = CRM_CONTACTS,
): ColumnMatch[] {
  const sampleOf = (h: string) => rows.slice(0, 60).map((r) => String(r[h] ?? '')).filter((v) => v.trim() !== '');

  const columns: ColumnMatch[] = headers.map((header, index) => ({
    header, index, samples: sampleOf(header).slice(0, 4), confidence: 0, reason: 'no match',
  }));

  const all: { col: number; cand: Candidate }[] = [];
  headers.forEach((header, i) => {
    const samples = sampleOf(header);
    for (const field of dict.fields) {
      const byHeader = scoreHeader(header, field);
      const byValue = scoreValues(samples, field);
      const best = !byHeader ? byValue : !byValue ? byHeader : (byHeader.score >= byValue.score ? byHeader : byValue);
      if (best && best.score >= MIN) all.push({ col: i, cand: best });
    }
  });

  all.sort((a, b) => b.cand.score - a.cand.score);

  const takenField = new Set<FieldDef>();
  const takenCol = new Set<number>();
  for (const { col, cand } of all) {
    if (takenCol.has(col)) continue;
    // A drop target can absorb any number of columns; a real field takes one.
    if (cand.field.target !== null && takenField.has(cand.field)) continue;
    takenCol.add(col);
    if (cand.field.target !== null) takenField.add(cand.field);
    columns[col].target = cand.field.target;
    columns[col].field = cand.field;
    columns[col].confidence = cand.score;
    columns[col].reason = cand.field.target === null
      ? `${cand.field.label}: ${cand.field.ignoredBecause}`
      : cand.reason;
  }

  return columns;
}

/* =============================================================
   Turning a cell into something the column will accept.
   ============================================================= */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** UK order. 03/04/2026 is 3 April, which is the whole reason this exists. */
export function parseDate(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);

  let m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const [, d, mo, y] = m;
    const year = y.length === 2 ? Number(y) + 2000 : Number(y);
    const day = Number(d), month = Number(mo);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  m = v.match(/^(\d{1,2})\s+([a-z]{3,9})\s+(\d{2,4})$/i);
  if (m) {
    const idx = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (idx < 0) return null;
    const year = m[3].length === 2 ? Number(m[3]) + 2000 : Number(m[3]);
    return `${year}-${String(idx + 1).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
  }
  return null;
}

/** "£1,250,000", "1.25m", "450k" and "1250000" are the same number. */
export function parseMoney(raw: string): number | null {
  const v = raw.trim().toLowerCase().replace(/[£$€,\s]/g, '');
  if (!v) return null;
  const mult = v.endsWith('m') ? 1_000_000 : v.endsWith('k') ? 1_000 : 1;
  const n = Number(mult === 1 ? v : v.slice(0, -1));
  return Number.isFinite(n) ? Math.round(n * mult) : null;
}

const STATUSES = ['lead', 'contacted', 'quoted', 'won', 'customer', 'lost'];
const STATUS_SYNONYMS: Record<string, string> = {
  new: 'lead', prospect: 'lead', enquiry: 'lead', open: 'lead', cold: 'lead',
  called: 'contacted', spoken: 'contacted', 'in progress': 'contacted', warm: 'contacted', working: 'contacted',
  quote: 'quoted', quotation: 'quoted', proposal: 'quoted', proposed: 'quoted', pending: 'quoted',
  sold: 'won', closed: 'won', 'closed won': 'won', converted: 'won', ordered: 'won',
  active: 'customer', existing: 'customer', account: 'customer', live: 'customer',
  dead: 'lost', 'closed lost': 'lost', declined: 'lost', rejected: 'lost', 'no': 'lost',
};

export function parseStatus(raw: string): string | null {
  const v = fold(raw);
  if (!v) return null;
  if (STATUSES.includes(v)) return v;
  if (STATUS_SYNONYMS[v]) return STATUS_SYNONYMS[v];
  for (const s of STATUSES) if (v.includes(s)) return s;
  return null;
}

export function parseNumber(raw: string): number | null {
  const n = Number(raw.replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Excel writes leading apostrophes and non-breaking spaces into phone columns. */
export function cleanPhone(raw: string): string | null {
  const v = raw.replace(/^'/, '').replace(/ /g, ' ').trim();
  return v || null;
}

export function coerce(kind: string, raw: any): any {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  switch (kind) {
    case 'money': return parseMoney(v);
    case 'number': return parseNumber(v);
    case 'date': return parseDate(v);
    case 'status': return parseStatus(v);
    case 'phone': return cleanPhone(v);
    case 'email': return v.toLowerCase();
    case 'url': return /^https?:\/\//i.test(v) ? v : `https://${v}`;
    default: return v;
  }
}
