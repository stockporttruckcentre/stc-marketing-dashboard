/* =============================================================
   Entity extraction.

   Pulls the concrete values out of a sentence: money, counts, dates,
   axle configurations, stock numbers, and the proper nouns that are
   probably a company or a person.
   ============================================================= */
import { KNOWN_WORDS, type Token } from './normalise';

export type Extracted = {
  money: { amount: number; per: 'unit' | 'total'; label: string }[];
  counts: number[];
  axles: string[];          // 6x2, 4x2, tri-axle
  stockNos: string[];       // STC142345
  date: { at: Date; label: string } | null;
  range: { from: Date; to: Date; label: string } | null;
  properNouns: string[];    // candidate company or person names
  /** The name following "for" / "to" / "with". Usually the customer. */
  contactHint: string | null;
  productHints: string[];   // FleetSmart+, gold, silver
};

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, a: 1, an: 1,
};

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const TIER_WORDS = ['gold', 'silver', 'bronze', 'platinum', 'premium', 'standard', 'basic'];

/** Words that are never a company name even when capitalised mid-sentence. */
const NOT_A_NAME = new Set([
  'i', 'we', 'they', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
  'saturday', 'sunday', 'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
  'create', 'find', 'schedule', 'how', 'what', 'when', 'who', 'add', 'show',
  'generate', 'trailer', 'contract', 'call', 'stock', 'gold', 'silver',
]);

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

/** "this Thursday", "next Tuesday", "tomorrow", "on the 14th". */
function parseDate(text: string): { at: Date; label: string } | null {
  const t = text.toLowerCase();
  const now = new Date();

  if (/\btoday\b/.test(t)) return { at: startOfDay(now), label: 'today' };
  if (/\btomorrow\b/.test(t)) {
    const d = startOfDay(now); d.setDate(d.getDate() + 1);
    return { at: d, label: 'tomorrow' };
  }

  const dayMatch = t.match(/\b(this|next|coming|on)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (dayMatch) {
    const target = DAYS.indexOf(dayMatch[2]);
    const d = startOfDay(now);
    let delta = (target - d.getDay() + 7) % 7;
    if (delta === 0) delta = 7;                       // "this Thursday" on a Thursday means the next one
    if (dayMatch[1] === 'next' && delta < 7) delta += 7;
    d.setDate(d.getDate() + delta);
    d.setHours(10, 0, 0, 0);                          // sensible default hour for a call
    return { at: d, label: `${dayMatch[1] === 'next' ? 'next ' : ''}${dayMatch[2]}` };
  }

  const inDays = t.match(/\bin\s+(\d+)\s+(day|week)s?\b/);
  if (inDays) {
    const d = startOfDay(now);
    d.setDate(d.getDate() + Number(inDays[1]) * (inDays[2] === 'week' ? 7 : 1));
    return { at: d, label: `in ${inDays[1]} ${inDays[2]}s` };
  }
  return null;
}

/** "in the past 8 weeks", "last 3 months", "this year". */
function parseRange(text: string): { from: Date; to: Date; label: string } | null {
  const t = text.toLowerCase();
  const now = new Date();

  const rel = t.match(/\b(?:past|last|previous)\s+(\d+|[a-z]+)\s*(day|week|month|year)s?\b/);
  if (rel) {
    const n = /^\d+$/.test(rel[1]) ? Number(rel[1]) : (WORD_NUMBERS[rel[1]] ?? 0);
    if (n > 0) {
      const from = new Date(now);
      if (rel[2] === 'day') from.setDate(from.getDate() - n);
      if (rel[2] === 'week') from.setDate(from.getDate() - n * 7);
      if (rel[2] === 'month') from.setMonth(from.getMonth() - n);
      if (rel[2] === 'year') from.setFullYear(from.getFullYear() - n);
      return { from: startOfDay(from), to: now, label: `past ${n} ${rel[2]}${n === 1 ? '' : 's'}` };
    }
  }
  if (/\bthis year\b|\bytd\b|\byear to date\b/.test(t)) {
    return { from: new Date(now.getFullYear(), 0, 1), to: now, label: 'this year' };
  }
  if (/\bthis month\b|\bmtd\b/.test(t)) {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from, to: now, label: 'this month' };
  }
  if (/\blast month\b/.test(t)) {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    return { from, to, label: 'last month' };
  }
  return null;
}

export function extract(input: string, tokens: Token[]): Extracted {
  const text = input.toLowerCase();

  // Money. "£500", "500 pounds", "£1,250".
  const money: Extracted['money'] = [];
  for (const m of input.matchAll(/[£$€]\s?([\d,]+(?:\.\d+)?)|\b([\d,]+(?:\.\d+)?)\s*(?:pounds|quid|gbp)\b/gi)) {
    const amount = Number((m[1] ?? m[2] ?? '').replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount === 0) continue;
    const after = input.slice(m.index ?? 0, (m.index ?? 0) + 80).toLowerCase();
    const per = /\b(each|per|a)\s*(unit|trailer|vehicle|one)\b|\beach\b/.test(after) ? 'unit' : 'total';
    // Try to label it from the words that follow: "£500 wear and tear"
    const label = (after.replace(/^[£$€]?\s?[\d,.]+\s*/, '')
      .split(/\b(?:each|per|and then|,)\b/)[0] || '').trim().slice(0, 40);
    money.push({ amount, per, label });
  }

  // Counts. Digits not attached to a stock number or an axle spec.
  const counts: number[] = [];
  for (const m of text.matchAll(/(?<![a-z\d£$€x/-])(\d{1,3})(?![\dx/-])/g)) {
    counts.push(Number(m[1]));
  }
  for (const [w, n] of Object.entries(WORD_NUMBERS)) {
    if (w.length > 2 && new RegExp(`\\b${w}\\b`).test(text)) counts.push(n);
  }

  const axles = Array.from(text.matchAll(/\b(\d\s?x\s?\d)\b|\b(tri|twin|single)[- ]axle\b/g))
    .map((m) => (m[1] ?? `${m[2]}-axle`).replace(/\s/g, ''));

  const stockNos = Array.from(input.matchAll(/\b(stc[\s-]?\d{3,8})\b/gi))
    .map((m) => m[1].toUpperCase().replace(/[\s-]/g, ''));

  const productHints = TIER_WORDS.filter((w) => new RegExp(`\\b${w}\\b`).test(text));
  // Branded product names: a capitalised word carrying + or a known suffix.
  for (const m of input.matchAll(/\b([A-Z][A-Za-z]{2,}(?:\s?\+|Plus|\+))/g)) {
    productHints.unshift(m[1].trim());
  }

  // Proper nouns: capitalised runs in the original input, minus known words.
  const properNouns: string[] = [];
  for (const m of input.matchAll(/\b([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*)*)/g)) {
    const phrase = m[1].trim();
    const words = phrase.split(/\s+/);
    const kept = words.filter((w) => !NOT_A_NAME.has(w.toLowerCase()) && !/^\d+$/.test(w));
    if (!kept.length) continue;
    const candidate = kept.join(' ');
    if (candidate.length >= 2 && !stockNos.includes(candidate.toUpperCase())) {
      properNouns.push(candidate);
    }
  }
  // A lowercase name after "for" still counts: "schedule a call for dave".
  const forName = input.match(/\bfor\s+([a-z][a-z'-]{2,})\b/i);
  if (forName && !properNouns.some((p) => p.toLowerCase() === forName[1].toLowerCase())) {
    if (!NOT_A_NAME.has(forName[1].toLowerCase())) properNouns.push(forName[1]);
  }

  const products = Array.from(new Set(productHints));

  // A product name is not a customer. "FleetSmart+ gold contract for
  // Dawson" has two capitalised things in it and only one of them is who
  // the contract is for.
  const nouns = Array.from(new Set(properNouns)).filter(
    (n) => !products.some((p) => p.toLowerCase().includes(n.toLowerCase())
                             || n.toLowerCase().includes(p.toLowerCase())),
  );

  // Whoever follows "for", "to" or "with" is almost always the customer,
  // regardless of what else in the sentence happens to be capitalised.
  let contactHint: string | null = null;
  for (const m of input.matchAll(/\b(?:for|to|with)\s+([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*)*|[a-z][a-z'-]{2,})/g)) {
    const cand = m[1].trim();
    const first = cand.split(/\s+/)[0].toLowerCase();
    if (NOT_A_NAME.has(first)) continue;
    // "need to invoice" is a verb, not a customer. Anything in the app's
    // own vocabulary is a word, not a name.
    if (KNOWN_WORDS.has(first)) continue;
    if (products.some((p) => p.toLowerCase().includes(first))) continue;
    contactHint = cand;
    break;
  }

  return {
    money, counts, axles, stockNos,
    date: parseDate(text),
    range: parseRange(text),
    properNouns: contactHint && !nouns.includes(contactHint) ? [contactHint, ...nouns] : nouns,
    contactHint,
    productHints: products,
  };
}
