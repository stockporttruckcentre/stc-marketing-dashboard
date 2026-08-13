/* =============================================================
   The slots a command carries.

   This file exists because of a mistake worth writing down. Questions
   were built as templates from the start: entity times filter times
   period, which is why "how many" reaches hundreds of thousands of
   sentences from a few hundred words. Actions were then written as flat
   entries, one per thing the screen does, and the Company Finder got
   four of them.

   The finder is not four commands. It takes a place, a radius, an
   industry, an employee range and a result count, and every one of those
   is a slot somebody fills differently every time they type:

     show me 4 companies in manchester in transport
     bring up 50 companies within 5 miles of hyde
     find warehousing firms near haydock with over 100 staff
     20 construction companies within 15 miles of bredbury

   That is one screen and thousands of sentences, and none of them are
   listed anywhere. They are read, out of the words, by what follows.

   Nothing here decides what to do. It pulls the numbers and the nouns
   out of a sentence so the thing that does decide has them.
   ============================================================= */
import { DEPOTS, isReservedWord } from './lexicon';

/** Numbers people write as words, up to the point they stop. */
const WORD_NUMBERS: Record<string, number> = {
  a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
  'a few': 3, 'a couple': 2, 'a handful': 5, 'a dozen': 12, dozen: 12,
};

const soften = (s: string) =>
  ` ${s.toLowerCase().replace(/[^a-z0-9. ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;

/**
 * How many they asked for.
 *
 * The number has to be attached to something countable, or "within 5
 * miles of Hyde" comes back as a request for five companies. So it is
 * read from the shapes that actually mean a quantity: a bare number in
 * front of a noun, or one of the words that introduce a top slice.
 */
export function readCount(text: string): number | null {
  const t = soften(text);

  // "top 10", "first 20", "limit 50", "up to 25".
  const lead = t.match(/\b(?:top|first|limit|up to|max|maximum|only)\s+(\d{1,4})\b/);
  if (lead) return clampCount(Number(lead[1]));

  const leadWord = t.match(/\b(?:top|first)\s+([a-z]+)\b/);
  if (leadWord && WORD_NUMBERS[leadWord[1]]) return clampCount(WORD_NUMBERS[leadWord[1]]);

  /* A number in front of a countable noun. Deliberately not any number:
     "within 10 miles" and "over 100 staff" both contain one and neither
     is a request for ten or a hundred results. */
  const COUNTABLE = String.raw`(?:compan\w*|firms?|businesses|hauliers?|operators?|customers?|contacts?|leads?|prospects?|accounts?|trailers?|units?|records?|rows?|results?|posts?|meetings?|deals?|proposals?|people|staff)`;
  const before = t.match(new RegExp(String.raw`\b(\d{1,4})\s+(?:\w+\s+){0,2}?${COUNTABLE}\b`));
  if (before) return clampCount(Number(before[1]));

  const beforeWord = t.match(new RegExp(String.raw`\b(a few|a couple|a handful|a dozen|${Object.keys(WORD_NUMBERS).filter((w) => !w.includes(' ')).join('|')})\s+(?:\w+\s+){0,2}?${COUNTABLE}\b`));
  if (beforeWord && WORD_NUMBERS[beforeWord[1]]) return clampCount(WORD_NUMBERS[beforeWord[1]]);

  return null;
}

function clampCount(n: number): number | null {
  if (!Number.isFinite(n) || n < 1) return null;
  // Nobody means eight thousand, and the finder caps well below this.
  return Math.min(n, 500);
}

/** "within 5 miles of", "10 mile radius", "5mi from", "half an hour away". */
export function readRadius(text: string): number | null {
  const t = soften(text);

  const miles = t.match(/\b(\d{1,3}(?:\.\d)?)\s*(?:mi|mile|miles)\b/);
  if (miles) return clampRadius(Number(miles[1]));

  const km = t.match(/\b(\d{1,3}(?:\.\d)?)\s*(?:km|kilometre|kilometres|kilometers)\b/);
  if (km) return clampRadius(Number(km[1]) * 0.621371);

  // The way people actually say it when they mean "not far".
  if (/\b(?:just|right)?\s*(?:round the corner|nearby|close by|local)\b/.test(t)) return 5;
  if (/\bwider\b|\bfurther out\b|\bbroader\b/.test(t)) return 50;

  return null;
}

function clampRadius(n: number): number | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.round(n), 300);      // the finder's own maximum
}

/**
 * Where they mean.
 *
 * A depot first, because those are the places with a known spelling and
 * a known set of typos. Anything else after a preposition is taken as a
 * town, which is how "in manchester" works without Manchester being
 * listed anywhere.
 */
export function readPlace(text: string): { value: string; known: boolean } | null {
  const t = soften(text);
  for (const [word, depot] of Object.entries(DEPOTS)) {
    if (t.includes(` ${word} `)) return { value: depot, known: true };
  }

  const m = text.match(
    /\b(?:in|near|around|round|about|close to|by|within .{0,18}? of|radius of|from)\s+([A-Za-z][A-Za-z'\- ]{2,30}?)(?=\s+(?:in|with|and|for|to|that|who|doing|over|under|between)\b|[,.?!]|$)/i,
  );
  const raw = (m?.[1] ?? '').trim();
  if (!raw) return null;

  const words = raw.split(/\s+/).filter((w) => !isReservedWord(w));
  if (!words.length) return null;
  // A place is a proper noun, not a description of one.
  if (words.every((w) => /^(the|a|an|my|our|their|this|that|here|there)$/i.test(w))) return null;

  const name = words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  return name.length >= 3 ? { value: name, known: false } : null;
}

/* -------------------------------------------------------------
   Industries, as the finder knows them.

   The ids are Lusha's and the words are ours. One entry per way
   somebody names a trade, which is what makes "in transport", "hauliers"
   and "logistics firms" all reach the same filter.
   ------------------------------------------------------------- */
export const INDUSTRIES: { id: number; label: string; words: string[] }[] = [
  { id: 116, label: 'Transportation, Logistics & Storage',
    words: ['transport', 'transportation', 'logistics', 'haulage', 'hauliers', 'haulier',
            'freight', 'shipping', 'distribution', '3pl', 'storage'] },
  { id: 92, label: 'Truck Transportation',
    words: ['trucking', 'truck transport', 'hgv', 'lorry', 'lorries', 'road haulage'] },
  { id: 93, label: 'Warehousing & Storage',
    words: ['warehousing', 'warehouse', 'warehouses', 'storage yard', 'fulfilment'] },
  { id: 48, label: 'Construction',
    words: ['construction', 'builders', 'building', 'groundworks', 'civils', 'contractors'] },
  { id: 25, label: 'Manufacturing',
    words: ['manufacturing', 'manufacturers', 'factories', 'factory', 'production'] },
  { id: 135, label: 'Industrial Machinery Manufacturing',
    words: ['industrial machinery', 'machinery', 'plant manufacturing'] },
  { id: 53, label: 'Motor Vehicle Manufacturing',
    words: ['motor vehicle', 'vehicle manufacturing', 'automotive manufacturing', 'car makers'] },
  { id: 27, label: 'Retail',
    words: ['retail', 'retailers', 'shops', 'stores', 'supermarkets'] },
  { id: 23, label: 'Food & Beverage Manufacturing',
    words: ['food', 'food and drink', 'beverage', 'drinks', 'food manufacturing', 'chilled'] },
  { id: 332, label: 'Oil, Gas & Mining', words: ['oil', 'gas', 'fuel', 'petrochemical'] },
  { id: 56, label: 'Mining', words: ['mining', 'quarry', 'quarries', 'aggregates'] },
  { id: 63, label: 'Farming', words: ['farming', 'farms', 'agriculture', 'agricultural'] },
  { id: 201, label: 'Farming, Ranching, Forestry', words: ['forestry', 'timber', 'ranching'] },
  { id: 1981, label: 'Waste Collection',
    words: ['waste', 'recycling', 'skip', 'skips', 'refuse', 'bin collection'] },
  { id: 2226, label: 'Vehicle Repair & Maintenance',
    words: ['vehicle repair', 'garages', 'workshops', 'commercial vehicle repair', 'bodyshops'] },
];

export function readIndustry(text: string): { id: number; label: string; word: string } | null {
  const t = soften(text);
  let best: { id: number; label: string; word: string } | null = null;
  for (const i of INDUSTRIES) {
    for (const w of i.words) {
      if (!t.includes(` ${w} `)) continue;
      if (!best || w.length > best.word.length) best = { id: i.id, label: i.label, word: w };
    }
  }
  return best;
}

/**
 * How big a company they want.
 *
 * "over 100 staff", "under 50 employees", "between 10 and 50 people",
 * "small firms", "big operators".
 */
export function readEmployees(text: string): { min: number; max: number } | null {
  const t = soften(text);
  const STAFF = String.raw`(?:employees?|staff|people|headcount|drivers?)`;

  const between = t.match(new RegExp(String.raw`\b(?:between|from)\s+(\d{1,6})\s*(?:and|to|-)\s*(\d{1,6})\s*${STAFF}?`));
  if (between) {
    const a = Number(between[1]);
    const b = Number(between[2]);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }

  const over = t.match(new RegExp(String.raw`\b(?:over|above|more than|at least|bigger than)\s+(\d{1,6})\s*${STAFF}`));
  if (over) return { min: Number(over[1]), max: 10000 };

  const under = t.match(new RegExp(String.raw`\b(?:under|below|less than|fewer than|smaller than|up to)\s+(\d{1,6})\s*${STAFF}`));
  if (under) return { min: 1, max: Number(under[1]) };

  // The words people use instead of a number.
  if (/\b(?:small|tiny|owner driver|one man|micro)\b/.test(t)) return { min: 1, max: 25 };
  if (/\b(?:mid sized|medium|mid size)\b/.test(t)) return { min: 25, max: 250 };
  if (/\b(?:big|large|major|national|blue chip|enterprise)\b/.test(t)) return { min: 250, max: 10000 };

  return null;
}

/** Everything a sentence carries, pulled out in one go. */
export type Slots = {
  count: number | null;
  radius: number | null;
  place: { value: string; known: boolean } | null;
  industry: { id: number; label: string; word: string } | null;
  employees: { min: number; max: number } | null;
};

export function readSlots(text: string): Slots {
  return {
    count: readCount(text),
    radius: readRadius(text),
    place: readPlace(text),
    industry: readIndustry(text),
    employees: readEmployees(text),
  };
}

/** Did the sentence carry anything worth acting on? */
export function anySlot(s: Slots): boolean {
  return !!(s.count || s.radius || s.place || s.industry || s.employees);
}
