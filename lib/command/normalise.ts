/* =============================================================
   Text normalisation for the command bar.

   No model, no API. Everything here is deterministic: fold the input
   down to comparable tokens, expand the vocabulary people actually use,
   and tolerate the typos they actually make.
   ============================================================= */

/** Levenshtein distance, capped so long inputs stay cheap. */
export function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 3) return 99;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let carry = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        carry + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      carry = t;
    }
  }
  return prev[b.length];
}

/** How wrong a word may be before it stops counting as that word. */
export function fuzzyEq(a: string, b: string): boolean {
  if (a === b) return true;
  const len = Math.max(a.length, b.length);
  // Below five characters a single edit turns one real word into another.
  // "gold" is one edit from "sold", "call" from "cell", "lead" from "load".
  // Short words must match exactly.
  if (len <= 4) return false;
  const allowed = len <= 6 ? 1 : len <= 9 ? 2 : 3;
  return distance(a, b) <= allowed;
}

/**
 * Words that mean the same thing to a user in a hurry. Left side is what
 * they type, right side is the canonical token the intents match on.
 */
const SYNONYMS: Record<string, string> = {
  // creating
  make: 'create', new: 'create', add: 'create', generate: 'create',
  raise: 'create', draw: 'create', build: 'create', start: 'create',
  register: 'create', log: 'create', put: 'create', enter: 'create',
  // finding
  find: 'find', show: 'find', get: 'find', open: 'find', pull: 'find',
  search: 'find', look: 'find', see: 'find', view: 'find', display: 'find',
  // counting and asking
  many: 'count', much: 'count', total: 'count', number: 'count',
  count: 'count', sum: 'count', worth: 'count',
  // scheduling
  schedule: 'schedule', book: 'schedule', arrange: 'schedule',
  diarise: 'schedule', diary: 'schedule', set: 'schedule',
  // objects
  prospect: 'contact', lead: 'contact', customer: 'contact',
  client: 'contact', company: 'contact', account: 'contact',
  business: 'contact', firm: 'contact',
  trailer: 'trailer', unit: 'trailer', box: 'trailer', vehicle: 'trailer',
  trailers: 'trailer', units: 'trailer', vehicles: 'trailer',
  stocklist: 'stock', stock: 'stock', inventory: 'stock', fleet: 'stock',
  contract: 'contract', agreement: 'contract', deal: 'contract',
  quote: 'proposal', quotation: 'proposal', proposal: 'proposal',
  tender: 'proposal', estimate: 'proposal',
  call: 'call', phone: 'call', ring: 'call', chat: 'call',
  meeting: 'meeting', meet: 'meeting', appointment: 'meeting', visit: 'meeting',
  invoice: 'invoice', invoices: 'invoice', invoiced: 'invoice', billing: 'invoice',
  target: 'target', goal: 'target', budget: 'target', quota: 'target',
  sold: 'sold', sale: 'sold', sales: 'sold', selling: 'sold',
  // noise
  please: '', kindly: '', just: '', can: '', could: '', would: '',
  the: '', a: '', an: '', to: '', for: '', of: '', in: '', on: '',
  do: '', does: '', did: '', we: '', i: '', me: '', my: '', us: '',
  have: '', has: '', is: '', are: '', be: '', it: '', that: '',
  with: '', and: '', at: '', up: '', all: '', want: '', need: '',
};

/** Every word the app itself uses. A word in here is never a name. */
export const KNOWN_WORDS = new Set(Object.keys(SYNONYMS));

export type Token = { raw: string; norm: string; canon: string; index: number };

/** Split into tokens, keeping the raw form so entity extraction can use it. */
export function tokenise(input: string): Token[] {
  const raw = input.trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  const out: Token[] = [];
  parts.forEach((p, i) => {
    const norm = p.toLowerCase().replace(/^[^\w£$€]+|[^\w%+]+$/g, '');
    if (!norm) return;
    let canon = SYNONYMS[norm];
    if (canon === undefined) {
      // Not a known word. Try a fuzzy hit against the synonym keys so
      // "scedule" and "genrate" still land.
      const hit = Object.keys(SYNONYMS).find((k) => k.length > 4 && fuzzyEq(norm, k));
      canon = hit ? SYNONYMS[hit] : norm;
    }
    out.push({ raw: p, norm, canon, index: i });
  });
  return out;
}

/** Canonical tokens with the noise words dropped. */
export function canonicalSet(tokens: Token[]): Set<string> {
  return new Set(tokens.map((t) => t.canon).filter(Boolean));
}

/** Does this phrase appear in the token stream, allowing for typos? */
export function hasWord(tokens: Token[], word: string): boolean {
  return tokens.some((t) => t.canon === word || t.norm === word || fuzzyEq(t.norm, word));
}
