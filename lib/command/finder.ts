/* =============================================================
   One screen, thousands of sentences.

   The Company Finder was four entries in the action registry. It is a
   form with six controls, and six controls that each take a value are
   not four commands, they are every combination somebody can ask for:

     show me 4 companies in manchester in transport
     bring up 50 companies within 5 miles of hyde
     find warehousing firms near haydock with over 100 staff
     20 construction companies within 15 miles of bredbury
     a few small hauliers round the corner from carrington

   None of those are listed anywhere and none of them need to be. The
   slots are read out of the sentence by params.ts and assembled here.

   The same shape applies to every screen with a form on it. This is the
   first one done properly, and it is the pattern the rest follow.
   ============================================================= */
import { readSlots, INDUSTRIES, type Slots } from './params';
import type { CrmCapabilities } from '@/lib/crm/permissions';

export type FinderPlan = {
  /** What the finder posts to /api/lusha/search. */
  location: string;
  radiusMiles: number;
  industryIds: number[];
  minEmployees: number;
  maxEmployees: number;
  limit: number;
  /** Plain English, shown before it runs. */
  summary: string;
  /** The link that opens the finder already filled in. */
  href: string;
  /** What was said, and what was assumed. */
  filled: string[];
  assumed: string[];
  /**
   * What the sentence actually carried, before the defaults were laid
   * over it.
   *
   * The difference matters the moment this stops being a link and
   * becomes a search somebody is charged for. A place nobody named is
   * filled in with Hyde so the screen opens somewhere, and running the
   * search on that would spend a credit on a place nobody asked about.
   */
  slots: Slots;
  confidence: number;
};

/** Words that mean "go and find companies", as opposed to search our own. */
export const FIND_VERBS = [
  'find', 'search', 'look for', 'look up', 'prospect', 'hunt', 'show me', 'show',
  'bring up', 'get me', 'give me', 'list', 'pull up', 'who is', 'who are', 'any',
];

/**
 * Words that mean the companies are NOT ours.
 *
 * This is the whole difficulty. "Show me 20 customers near Hyde" is a
 * question about the CRM. "Show me 20 companies near Hyde" is the
 * finder. One word apart, two completely different screens, and getting
 * it wrong sends somebody prospecting through their own account list.
 */
const OUTSIDE_NOUNS = [
  'companies', 'company', 'firms', 'firm', 'businesses', 'business',
  'hauliers', 'haulier', 'operators', 'operator', 'prospects', 'prospect',
  'new business', 'leads out there', 'someone new', 'somebody new',
];

/** Words that mean the opposite: our own records. */
const INSIDE_NOUNS = [
  'customer', 'customers', 'contact', 'contacts', 'account', 'accounts',
  'client', 'clients', 'my ', 'our ', 'on the crm', 'in the crm', 'on our',
];

const soften = (s: string) =>
  ` ${s.toLowerCase().replace(/[^a-z0-9. ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;

/** The defaults the screen itself starts on, so an assumption is honest. */
const DEFAULTS = { location: 'Hyde', radius: 10, min: 1, max: 10000, limit: 25 };

/**
 * A finder search, or null if this sentence is about our own records.
 *
 * Deliberately strict about the difference. An outside noun has to be
 * present and an inside noun has to be absent, because prospecting
 * through the CRM and searching the CRM look identical from a distance
 * and are not remotely the same thing.
 */
export function parseFinder(input: string, caps?: CrmCapabilities): FinderPlan | null {
  const raw = input.trim();
  if (raw.length < 4) return null;
  const t = soften(raw);

  if (INSIDE_NOUNS.some((w) => t.includes(` ${w.trim()} `) || t.includes(w))) return null;
  const noun = OUTSIDE_NOUNS.find((w) => t.includes(` ${w} `));
  if (!noun) return null;

  const verb = FIND_VERBS.find((v) => t.includes(` ${v} `) || t.trim().startsWith(v));
  const slots = readSlots(raw);

  /* A place or an industry has to be present. Without either, "find
     companies" is somebody opening the screen rather than running a
     search, and running one on the defaults spends a credit they did
     not ask to spend. */
  if (!slots.place && !slots.industry && !slots.radius) return null;

  return build(slots, verb ?? 'find', caps);
}

function build(slots: Slots, verb: string, _caps?: CrmCapabilities): FinderPlan {
  const filled: string[] = [];
  const assumed: string[] = [];

  const location = slots.place?.value ?? DEFAULTS.location;
  if (slots.place) filled.push(`near ${location}`);
  else assumed.push(`near ${DEFAULTS.location}`);

  const radiusMiles = slots.radius ?? DEFAULTS.radius;
  if (slots.radius) filled.push(`within ${radiusMiles} miles`);
  else assumed.push(`within ${DEFAULTS.radius} miles`);

  const industryIds = slots.industry ? [slots.industry.id] : [];
  if (slots.industry) filled.push(slots.industry.label.toLowerCase());

  const minEmployees = slots.employees?.min ?? DEFAULTS.min;
  const maxEmployees = slots.employees?.max ?? DEFAULTS.max;
  if (slots.employees) filled.push(`${minEmployees} to ${maxEmployees} staff`);

  const limit = slots.count ?? DEFAULTS.limit;
  if (slots.count) filled.push(`${limit} of them`);
  else assumed.push(`the first ${DEFAULTS.limit}`);

  const what = slots.industry ? slots.industry.label.toLowerCase() : 'companies';
  const size = slots.employees ? `, ${minEmployees} to ${maxEmployees} staff` : '';
  const summary =
    `Find ${limit} ${what} within ${radiusMiles} miles of ${location}${size}`;

  const params = new URLSearchParams({
    location,
    radius: String(radiusMiles),
    limit: String(limit),
    min: String(minEmployees),
    max: String(maxEmployees),
  });
  if (industryIds.length) params.set('industry', String(industryIds[0]));

  /* Confidence is how much of it they actually said. A sentence naming
     a place, a trade and a number is a real instruction; one naming only
     a trade is closer to a browse, and the bar should offer rather than
     run it. */
  let confidence = 4;
  if (slots.place) confidence += 4;
  if (slots.industry) confidence += 3;
  if (slots.count) confidence += 2;
  if (slots.radius) confidence += 2;
  if (slots.employees) confidence += 2;
  if (FIND_VERBS.includes(verb)) confidence += 1;

  return {
    location, radiusMiles, industryIds, minEmployees, maxEmployees, limit,
    summary,
    href: `/dashboard/finder?${params.toString()}`,
    filled, assumed, slots, confidence,
  };
}

/* =============================================================
   Guiding, when only part of it was said.

   Somebody who types "companies near Hyde" has given a place and
   nothing else. Rather than running on the defaults, the bar offers the
   sentences they might have meant: by trade, by size, by how many.
   ============================================================= */
export type FinderSuggestion = { phrase: string; label: string; sub: string; score: number };

/** The trades worth offering first, because this is a truck dealer. */
const PROMINENT_INDUSTRIES = [116, 92, 93, 48, 1981, 23];

export function composeFinder(input: string, caps: CrmCapabilities, limit = 6): FinderSuggestion[] {
  const raw = input.trim();
  if (raw.length < 3) return [];
  const t = soften(raw);
  if (INSIDE_NOUNS.some((w) => t.includes(w))) return [];

  const wantsCompanies = OUTSIDE_NOUNS.some((w) => t.includes(` ${w} `))
    || /\b(prospect|prospecting|new business|find me someone)\b/.test(t);
  if (!wantsCompanies) return [];

  const slots = readSlots(raw);
  const out: FinderSuggestion[] = [];
  const push = (phrase: string, label: string, sub: string, score: number) => {
    if (out.some((o) => o.phrase.toLowerCase() === phrase.toLowerCase())) return;
    out.push({ phrase, label, sub, score });
  };

  const where = slots.place ? ` near ${slots.place.value}` : ' near Hyde';

  // A place but no trade: offer the trades.
  if (!slots.industry) {
    for (const id of PROMINENT_INDUSTRIES) {
      const i = INDUSTRIES.find((x) => x.id === id);
      if (!i) continue;
      push(
        `find ${i.words[0]} companies${where}`,
        `${i.label} companies${where}`,
        'Narrowed by trade',
        80 - PROMINENT_INDUSTRIES.indexOf(id),
      );
    }
  }

  // A trade but no place: offer the depots.
  if (slots.industry && !slots.place) {
    for (const depot of ['Hyde', 'Carrington', 'Bredbury', 'Haydock', 'Atherton']) {
      push(
        `find ${slots.industry.word} companies near ${depot}`,
        `${slots.industry.label} near ${depot}`,
        'Narrowed by depot',
        78,
      );
    }
  }

  // Both, but no size or count: offer the shapes that finish the sentence.
  if (slots.industry && slots.place) {
    push(`find 20 ${slots.industry.word} companies${where}`,
      `Just the first 20`, 'How many to bring back', 74);
    push(`find ${slots.industry.word} companies${where} with over 50 staff`,
      `Only the bigger ones`, 'Over 50 staff', 72);
    push(`find small ${slots.industry.word} companies${where}`,
      `Only the small ones`, 'Up to 25 staff', 70);
    for (const r of [5, 25, 50]) {
      push(`find ${slots.industry.word} companies within ${r} miles of ${slots.place.value}`,
        `Within ${r} miles`, 'Wider or tighter', 68);
    }
  }

  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
