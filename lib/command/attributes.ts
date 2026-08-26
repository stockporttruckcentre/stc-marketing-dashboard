/* =============================================================
   Which column a phrase names.

   This knowledge was in four places and each place knew a different
   part of it.

     schema.ts    amounts and dates, for grouping and filtering
     fields.ts    all 104 writable columns, with their aliases
     select.ts    a hand written list of seventeen nullable columns
     columns.ts   every column of every table

   Asking only the first meant "trailers with no refurb cost" resolved
   to book value, because `cost` is one of the words for book value and
   refurb cost is not something anybody groups by. Asking only the third
   meant "customers with no email" worked and "customers with no
   website" did not, for no reason a person could see.

   So the sources are merged once, here, and everything asks this. A
   column somebody can write is a column they can ask about, and a
   column they can ask about is one they can select on. Those were three
   separate lists that drifted apart the moment any of them was edited.

   The rule that matters is longest alias first. "Cost" matching inside
   "refurb cost" is not a near miss, it is a different column and a
   wrong answer.
   ============================================================= */
import { type EntitySpec } from './schema';
import { WRITABLE_FIELDS } from './fields';

export type NamedColumn = { column: string; label: string; alias: string };

/**
 * Phrasings nothing else in the app declares.
 *
 * These came from the emptiness clauses in `select.ts`, which is the
 * only place anybody had written down that "anybody on it" means the
 * owner column. They are yard phrasings for columns the other sources
 * already know, so they live here as aliases rather than as a fourth
 * list of columns.
 */
const EXTRA_ALIASES: Record<string, { phrase?: string; aliases: string[] }> = {
  assigned_to: { phrase: 'owner', aliases: ['owner', 'account manager', 'anybody on it', 'anyone on it', 'who owns it'] },
  email: { phrase: 'email', aliases: ['email address', 'e mail', 'their email'] },
  phone: { phrase: 'phone number', aliases: ['phone number', 'telephone', 'mobile', 'their number'] },
  contact_name: { phrase: 'contact name', aliases: ['named contact', 'person', 'who to speak to'] },
  links: { phrase: 'website', aliases: ['website', 'web site', 'url'] },
  notes: { phrase: 'notes', aliases: ['history', 'anything written'] },
  next_action: { phrase: 'next action', aliases: ['next step', 'follow up'] },
  fleet_size: { phrase: 'fleet size', aliases: ['fleet size', 'units on their fleet'] },
  estimated_value: { phrase: 'estimated value', aliases: ['deal value'] },
  mot_date: { phrase: 'MOT date', aliases: ['mot'] },
  stc_no: { phrase: 'stock number', aliases: ['stock number', 'stc number'] },
  chassis_number: { phrase: 'chassis number', aliases: ['chassis'] },
  customer: { phrase: 'customer', aliases: ['buyer'] },
  sales_price: { phrase: 'sale price', aliases: [] },
  refurb_costs: { phrase: 'refurb cost', aliases: [] },
};

/**
 * A column's name as it reads inside a sentence.
 *
 * "No Phone" and "no Next action" are field headings dropped into
 * prose. The heading is right on a form and wrong in "customers with no
 * phone number", and the two want different words often enough to be
 * worth saying which is which.
 */
function phraseFor(column: string, label: string): string {
  const extra = EXTRA_ALIASES[column]?.phrase;
  if (extra) return extra;
  // An initialism keeps its capitals. Everything else reads as prose.
  const [first, ...rest] = label.split(' ');
  if (first && first === first.toUpperCase() && first.length > 1) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** `fields.ts` names its entities slightly differently from `schema.ts`. */
function sameEntity(fieldEntity: string, entityId: string): boolean {
  if (fieldEntity === entityId) return true;
  /* `deals` and `leads` are one thing under two names: the entity people
     ask questions about is called `deals`, the entity people edit is
     called `leads`, and both are `crm_leads`.
     
     A customer used to be here too, because a proposal and a customer
     were rows in the same table and a field on one was reachable from
     the other. Migration 040 ended that, and leaving it would mean "set
     the sale price on Dawson" quietly writing a deal column onto a
     company. */
  return (fieldEntity === 'leads' && entityId === 'deals')
      || (fieldEntity === 'deals' && entityId === 'leads');
}

const CACHE = new Map<string, NamedColumn[]>();

/** Every way of naming a column on this thing, longest first. */
export function attributeNames(entity: EntitySpec): NamedColumn[] {
  const cached = CACHE.get(entity.id);
  if (cached) return cached;

  const named: NamedColumn[] = [];
  const add = (column: string, label: string, alias: string) => {
    const a = alias.trim().toLowerCase();
    if (a.length >= 3) named.push({ column, label, alias: a });
  };

  for (const a of entity.amounts) {
    add(a.column, a.label, a.label);
    for (const w of a.words) add(a.column, a.label, w);
  }
  for (const d of entity.dates ?? []) {
    add(d.column, d.label, d.label);
    for (const w of d.words) add(d.column, d.label, w);
  }
  for (const f of entity.filters) {
    add(f.column, f.label, f.label);
    add(f.column, f.label, f.column.replace(/_/g, ' '));
  }
  for (const f of WRITABLE_FIELDS) {
    if (!sameEntity(f.entity, entity.id)) continue;
    add(f.key, f.label, f.label);
    for (const a of f.aliases) add(f.key, f.label, a);
  }
  /* The extras attach to a column already known, so nothing here can
     make a column reachable that no other source declares. */
  const known = new Set(named.map((n) => n.column));
  for (const [column, extra] of Object.entries(EXTRA_ALIASES)) {
    if (!known.has(column)) continue;
    const label = named.find((n) => n.column === column)!.label;
    for (const a of extra.aliases) add(column, label, a);
  }

  // Read as prose, since that is where these labels end up.
  for (const n of named) n.label = phraseFor(n.column, n.label);

  const ranked = named.sort((a, b) => b.alias.length - a.alias.length);
  CACHE.set(entity.id, ranked);
  return ranked;
}

/**
 * The column a phrase names, or nothing.
 *
 * `exact` is for a phrase that IS the name, as in the words right after
 * "with no". There, a word buried inside a longer alias is not good
 * enough, because "no cost" and "no refurb cost" are different
 * questions and one of them is not being asked.
 */
export function columnNamed(
  entity: EntitySpec,
  phrase: string,
  exact = false,
): { column: string; label: string } | null {
  const p = phrase.trim().toLowerCase();
  if (p.length < 3) return null;
  const names = attributeNames(entity);

  if (exact) {
    const whole = names.find((n) => n.alias === p);
    if (whole) return { column: whole.column, label: whole.label };
    /* The column name comes first and anything after it is the rest of
       the sentence, so the longest alias the phrase STARTS with is the
       answer. Matching anywhere inside instead read "with no refurb
       costs at sale" as the refurb cost column, because that name is
       also in there and is shorter. */
    const starts = names.find((n) => p === n.alias || p.startsWith(`${n.alias} `));
    if (starts) return { column: starts.column, label: starts.label };
    const near = names.find((n) => n.alias.startsWith(`${p} `) || p.includes(` ${n.alias} `));
    return near ? { column: near.column, label: near.label } : null;
  }
  const hit = names.find((n) => new RegExp(`\\b${
    n.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(p));
  return hit ? { column: hit.column, label: hit.label } : null;
}

/**
 * Every column a sentence names AFTER one of these lead words.
 *
 * "With no email", "missing a chassis number", "without an owner". The
 * lead says something is absent; the words after it say what.
 *
 * All of them, not the first. "Customers with no next action and no
 * phone number" is two clauses, and returning one of them answers a
 * question nobody asked with a list that is too long.
 */
export function columnAfter(
  entity: EntitySpec,
  softened: string,
  leads: string[],
): { column: string; label: string; spoken: string }[] {
  const names = attributeNames(entity);
  const found: { column: string; label: string; spoken: string }[] = [];
  const taken: [number, number][] = [];

  // Longest lead first, or "without an email" is read as "without".
  for (const lead of [...leads].sort((a, b) => b.length - a.length)) {
    for (const n of names) {
      const phrase = ` ${lead} ${n.alias}`;
      let at = softened.indexOf(phrase);
      while (at !== -1) {
        const end = at + phrase.length;
        // The alias has to end where a word ends, or "no price" matches
        // inside "no priceless thing".
        const after = softened[end];
        const clean = !after || !/[a-z0-9]/.test(after);
        // Nothing already claimed by a longer lead or a longer alias.
        const free = !taken.some(([s, e]) => at < e && end > s);
        if (clean && free && !found.some((f) => f.column === n.column)) {
          found.push({ column: n.column, label: n.label, spoken: `${lead} ${n.alias}` });
          taken.push([at, end]);
        }
        at = softened.indexOf(phrase, at + 1);
      }
    }
  }
  return found;
}
