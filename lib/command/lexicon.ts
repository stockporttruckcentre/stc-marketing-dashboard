/* =============================================================
   The words people actually use.

   A note on the shape of this file, because it is the thing that decides
   whether the toolbar keeps working a year from now.

   The ask was tens of thousands of lines of variants: every phrasing,
   every typo, every word order. Written literally that is a lookup table,
   and a lookup table is the one design that cannot work here. It goes
   stale the day somebody adds a depot, it cannot handle a phrasing nobody
   thought of, and nobody will ever read 40,000 lines to find out why one
   sentence missed.

   So the variants are generated rather than listed. Roughly three hundred
   groups below, combined with word order independence, filler stripping
   and fuzzy matching, already cover millions of sentences. "How many
   curtainsiders at Carrington", "Carrington, curtain trailer count",
   "cutrainsiders in carrington?" and "can you tell me how many tautliners
   we have sat at the Carrington yard" are one rule, not four entries.

   The tens of thousands belong somewhere else: in
   scripts/query-compose-check.ts, as assertions. A phrasing that is
   listed here is a guess. A phrasing that is asserted there is a promise,
   and the day it breaks the check goes red.

   **When you add a feature, add its words here and a case there.** That
   is the whole contract.
   ============================================================= */

/* -------------------------------------------------------------
   Filler.

   Stripped before anything else looks at the sentence. Half of these
   exist because they were actively causing wrong answers: "tell me" made
   the engine decide the question was about the asker's own accounts, so
   "tell me how many trailers we have" answered for one person's
   portfolio and quietly gave the wrong number.
   ------------------------------------------------------------- */
export const FILLER = [
  'can you', 'could you', 'would you', 'will you', 'please could you', 'please can you',
  'i need to know', 'i want to know', 'i would like to know', 'id like to know',
  'let me know', 'tell me', 'show me', 'give me', 'find me', 'get me', 'fetch me',
  'have a look at', 'take a look at', 'look at', 'check the', 'check',
  'do we know', 'do you know', 'any idea', 'any chance', 'whats the',
  'i just want', 'just want', 'quickly', 'quick', 'please', 'thanks', 'cheers', 'ta',
  'for me', 'if you can', 'if possible', 'and tell me', 'and let me know',
  'right now', 'at the moment', 'currently', 'as it stands', 'as things stand',
  'at present', 'so far',
];

/* "today" is deliberately not filler.
   It was, and "how much revenue did we make from just trailer sales
   today" came back with no period at all, answering for all time. The
   one case it was there for, "how many trailers in stock today", is
   handled properly in query.ts instead: in stock is a state you are in
   now, so a date range on it is meaningless and gets dropped. */

/* -------------------------------------------------------------
   Depots.

   STC's own sites plus the ones people say instead. Carrington is the
   example that started this: it is a storage yard people name before the
   question rather than after it, as in "carrington, how many parked up".
   ------------------------------------------------------------- */
export const DEPOTS: Record<string, string> = {
  carrington: 'Carrington', carington: 'Carrington', carrigton: 'Carrington',
  bredbury: 'Bredbury', bredbry: 'Bredbury',
  hyde: 'Hyde',
  haydock: 'Haydock', haydoc: 'Haydock',
  atherton: 'Atherton',
  dukinfield: 'Dukinfield', duki: 'Dukinfield', dukenfield: 'Dukinfield',
  birkenhead: 'Birkenhead', birkinhead: 'Birkenhead',
  stockport: 'Stockport',
  renbury: 'Renbury',
};

/* -------------------------------------------------------------
   States, as verbs and yard talk rather than database values.

   Nobody says "status equals in_stock". They say it is sat there, parked
   up, on the yard, on the list, available, unsold, still here.
   ------------------------------------------------------------- */
export const STATE_PHRASES: { words: string[]; filter: string; value: string }[] = [
  {
    filter: 'status', value: 'in_stock',
    words: [
      'in stock', 'in the stock', 'on the stock list', 'on the stocklist', 'stocklist',
      'stock list', 'storing', 'stored', 'in storage', 'being stored', 'we store',
      'parked', 'parked up', 'sat', 'sat there', 'sitting', 'stood', 'standing',
      'on the yard', 'in the yard', 'on site', 'available', 'unsold', 'not sold',
      'still have', 'still got', 'we have', 'weve got', 'we hold', 'holding',
      'on hand', 'spare', 'free', 'ready',
    ],
  },
  {
    filter: 'status', value: 'sold',
    words: [
      'sold', 'sell', 'sells', 'selling', 'shifted', 'moved on', 'gone',
      'invoiced', 'delivered', 'dispatched', 'despatched', 'out the door', 'off the books',
    ],
  },
  {
    filter: 'status', value: 'rental',
    words: ['on hire', 'hired', 'hire', 'rented', 'renting', 'on rent', 'out on rental', 'rental'],
  },
  {
    filter: 'status', value: 'sales_order',
    words: ['on order', 'ordered', 'sales order', 'reserved', 'deposit taken', 'provisionally sold', 'pending'],
  },
  {
    filter: 'status', value: 'new_build',
    words: ['new build', 'new builds', 'newbuild', 'on build', 'being built', 'in build', 'coming'],
  },
  {
    filter: 'status', value: 'scrap',
    words: ['scrap', 'scrapped', 'written off', 'broken up', 'weighed in'],
  },
];

/** How a status reads in a summary, rather than whichever word matched. */
export const STATE_LABEL: Record<string, string> = {
  in_stock: 'in stock',
  sold: 'sold',
  rental: 'on hire',
  sales_order: 'on order',
  new_build: 'on build',
  scrap: 'scrapped',
};

/* -------------------------------------------------------------
   Body types.

   Every word a driver, a salesman and a spreadsheet each use for the
   same trailer. Fuzzy matching handles the typos on top of this, so
   "cutrainsider" lands without being listed.
   ------------------------------------------------------------- */
export const BODY_TYPES: Record<string, string> = {
  curtain: 'Curtainsider', curtains: 'Curtainsider', curtainsider: 'Curtainsider',
  curtainsiders: 'Curtainsider', curtainside: 'Curtainsider', tautliner: 'Curtainsider',
  tautliners: 'Curtainsider', tautlinner: 'Curtainsider', taut: 'Curtainsider',
  cs: 'Curtainsider', sider: 'Curtainsider', siders: 'Curtainsider',

  fridge: 'Fridge', fridges: 'Fridge', reefer: 'Fridge', reefers: 'Fridge',
  chilled: 'Fridge', frigo: 'Fridge', freezer: 'Fridge', temperature: 'Fridge',
  refrigerated: 'Fridge',

  flat: 'Flat', flats: 'Flat', flatbed: 'Flat', flatbeds: 'Flat', platform: 'Flat',

  skeli: 'Skeletal', skelly: 'Skeletal', skeletal: 'Skeletal', skel: 'Skeletal',
  skellies: 'Skeletal', container: 'Skeletal', containers: 'Skeletal',

  tipper: 'Tipper', tippers: 'Tipper', tip: 'Tipper', bulk: 'Tipper',

  box: 'Box', boxes: 'Box', boxvan: 'Box', 'box van': 'Box', dryfreight: 'Box',

  lowloader: 'Lowloader', 'low loader': 'Lowloader', low: 'Lowloader', step: 'Lowloader',
  stepframe: 'Lowloader', 'step frame': 'Lowloader',
};

/* -------------------------------------------------------------
   Size.

   Trailer length is spoken in metres and written half a dozen ways:
   4.2m, 4.2 m, 4.2metre, 13.6, 13m6. There is no length column, so a
   size lands as a text match against the description, which is where
   the spec sheet ends up.
   ------------------------------------------------------------- */
export const SIZE_RE = /\b(\d{1,2})(?:[.,](\d))?\s?(?:m|metre|meter|metres|meters|mtr)\b/i;

export function readSize(text: string): string | null {
  const m = SIZE_RE.exec(text);
  if (!m) return null;
  const whole = Number(m[1]);
  // A plausible trailer, not a year or a quantity. 13.6m is the longest
  // thing on a UK road; 2m is about the shortest anybody calls a trailer.
  if (whole < 2 || whole > 20) return null;
  return m[2] ? `${whole}.${m[2]}` : String(whole);
}

/* -------------------------------------------------------------
   People.

   "by dave", "dave's", "for dean", "who did lewis sell to". A name after
   one of these is the rep rather than the customer, which is the
   difference between two very different answers.
   ------------------------------------------------------------- */
export const REP_LEADINS = ['by', 'from', 'for', 'sold by', 'done by', 'handled by', 'belonging to'];
export const CUSTOMER_LEADINS = ['to', 'with', 'at company', 'for customer', 'sold to', 'account'];

/* -------------------------------------------------------------
   Where.

   A location can arrive after a preposition, or on its own at the front
   of the sentence with a dash after it, which is how people write when
   they are in a hurry.
   ------------------------------------------------------------- */
export const PLACE_LEADINS = ['at', 'in', 'on', 'near', 'around', 'based at', 'stored at', 'sat at', 'parked at'];

/** Strip filler, so what is left is the question. */
export function deFluff(input: string): string {
  let t = ` ${input
    .toLowerCase()
    // Sentence punctuation goes, but not a decimal point between digits.
    // Stripping it turned "4.2m curtainsiders" into "4 2m", and the size
    // came out as 2 metres.
    .replace(/(?<!\d)[?!.]+|[?!.]+(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')} `;
  // Longest first, so "please can you" goes before "please".
  for (const f of [...FILLER].sort((a, b) => b.length - a.length)) {
    t = t.split(` ${f} `).join(' ');
  }
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * A depot named anywhere in the sentence.
 *
 * Checked as whole words against the known list first, because a known
 * depot is worth more than a guess from a preposition, and it catches
 * the bare leading form: "carrington, how many parked up".
 */
export function readDepot(text: string): string | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ')} `;
  for (const [word, depot] of Object.entries(DEPOTS)) {
    if (t.includes(` ${word} `)) return depot;
  }
  return null;
}

/** A place after a preposition, for somewhere not on the depot list. */
export function readPlaceAfterPreposition(text: string): string | null {
  const t = text.replace(/[?!.,]+/g, ' ');
  for (const lead of [...PLACE_LEADINS].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`\\b${lead}\\s+(?:the\\s+)?([A-Za-z][A-Za-z'-]{2,}(?:\\s+[A-Z][A-Za-z'-]+)?)`, 'i');
    const m = re.exec(t);
    if (!m) continue;
    const word = m[1].trim();
    // Prepositions run into ordinary words constantly. Reject if any part
    // of the capture is doing another job: "on the stock list" was being
    // read as a place called Stock List.
    if (word.split(/\s+/).some(isReservedWord)) continue;
    return word.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return null;
}

/** A name after "by", which means the rep rather than the buyer. */
export function readRep(text: string): string | null {
  const t = text.replace(/[?!.,]+/g, ' ');
  for (const lead of [...REP_LEADINS].sort((a, b) => b.length - a.length)) {
    const m = new RegExp(`\\b${lead}\\s+([A-Za-z][A-Za-z'-]{2,})`, 'i').exec(t);
    if (!m) continue;
    const word = m[1].trim();
    if (word.split(/\s+/).some(isReservedWord)) continue;
    return word.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return null;
}

/**
 * Words that mean something else in this grammar and must never be read
 * as a name or a place. Without this, "sold in the past 9 weeks" reads
 * "the" as a location and "for each make" reads "each" as a person.
 */
const RESERVED = new Set([
  'stocklist', 'list',
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'each', 'every', 'all', 'any',
  'stock', 'total', 'past', 'last', 'next', 'week', 'weeks', 'month', 'months',
  'year', 'years', 'day', 'days', 'today', 'yesterday', 'tomorrow', 'now',
  'me', 'us', 'them', 'we', 'you', 'our', 'my', 'their', 'his', 'her',
  'sale', 'sales', 'stocklist', 'list', 'lists', 'value', 'worth', 'many', 'much',
  'trailer', 'trailers', 'unit', 'units', 'vehicle', 'vehicles', 'customer',
  'customers', 'deal', 'deals', 'order', 'orders', 'hire', 'rental', 'storage',
  'site', 'depot', 'yard', 'stockport truck centre', 'stc',
  /* Time words. A preposition runs straight into a period constantly,
     and "trailers booked in between May and July" was answered for a
     depot called Between, in a month called May, with the range thrown
     away. Months and the words that bracket them are never places. */
  'between', 'during', 'through', 'until', 'till', 'since', 'before', 'after',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'quarter', 'ytd', 'q1', 'q2', 'q3', 'q4',

  /* Narrowing words. "How much revenue did we make from just trailer
     sales today" read "just" as the rep who sold them, and answered for
     a person who does not exist. Anything that qualifies a noun rather
     than naming one belongs here. */
  'just', 'only', 'solely', 'purely', 'simply', 'merely', 'exactly',
  'about', 'roughly', 'approximately', 'around', 'mainly', 'mostly',
  'outstanding', 'pending', 'remaining', 'left', 'still', 'other', 'others',
  'blue', 'red', 'white', 'black', 'green', 'silver', 'grey', 'gray', 'yellow',

  /* The Work tab's own vocabulary. Every one of these means something
     in that grammar, so none of them can be read as a person or a
     place. "Pass this task to somebody else" was the sentence that
     needed it: without "task" and "somebody" here, a preposition runs
     into them and the bar decides there is a customer called Somebody
     Else at a depot called Task.

     The indefinite people are here for the same reason and are worth
     spelling out: nobody is ever called Anybody. */
  'work', 'task', 'tasks', 'job', 'jobs', 'todo', 'backlog', 'blocked',
  'overdue', 'deadline', 'due', 'priority', 'board', 'view', 'views',
  'note', 'notes', 'comment', 'comments', 'project', 'projects', 'department',
  'somebody', 'someone', 'anybody', 'anyone', 'nobody', 'everybody', 'everyone',
  ...Object.keys(BODY_TYPES),
]);

export function isReservedWord(word: string): boolean {
  return RESERVED.has(word.toLowerCase().trim());
}
