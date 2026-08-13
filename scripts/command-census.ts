/* =============================================================
   How many distinct commands does the bar reach?

   The first version of this counted entries in files and reported 253
   items, which was wrong in a way worth writing down. A command is not
   an entry. It is

     verb  x  which rows  x  which field  x  which value

   and only the first of those was ever a list. "Which rows" is the
   combinatorial part: a selector composes freely, so "customers in
   Manchester with no owner not contacted in 30 days with a fleet over
   50" is one of an enormous number of sets somebody can name, and every
   verb applies to every one of them.

   Counting entries answered "how many things did I write down". This
   answers "how many different things can somebody type that do
   different work", which is the question that was actually asked.

   Every number below is deliberately conservative. Three magnitudes per
   numeric comparison rather than every number anybody could type. Four
   time windows rather than every window. Nine periods rather than every
   date range. The real space is unbounded, because a person can type any
   number; a figure nobody can check is worth nothing, so this counts the
   shapes rather than the values inside them.

   npm run check:census
   ============================================================= */
import { ACTIONS } from '../lib/command/actions';
import { WRITABLE_FIELDS } from '../lib/command/fields';
import { ENTITIES, MEASURE_WORDS } from '../lib/command/schema';
import { DEPOTS, BODY_TYPES } from '../lib/command/lexicon';
import { selectionSpace, clauseCounts } from '../lib/command/select';
import { INDUSTRIES } from '../lib/command/params';

/** Below this the bar is not doing its job. */
const FLOOR = 1_000_000;

const rows: { group: string; item: string; count: number; how: string }[] = [];
const add = (group: string, item: string, count: number, how: string) =>
  rows.push({ group, item, count, how });

/* -------------------------------------------------------------
   1. Things you can do to a set of rows.

   This is the big one, and the one that was missing. Every verb that
   takes a selector multiplies by every selector.
   ------------------------------------------------------------- */

/** Verbs that operate on a named set rather than a named record. */
const SET_VERBS = [
  'count', 'list', 'total', 'average',      // the query engine
  'export',                                  // to CSV, Excel, Word, email
  'assign', 'unassign',                      // ownership in bulk
  'move to a list', 'copy to a list',
  'delete',
];

for (const e of ENTITIES) {
  const space = selectionSpace(e);
  const c = clauseCounts(e);
  add('sets', e.id, space * SET_VERBS.length,
    `${SET_VERBS.length} verbs x ${space.toExponential(1)} selections `
    + `(${c.nullable} emptiable, ${c.comparable} comparable, ${c.dated} dated)`);
}

/* -------------------------------------------------------------
   2. Writing a field on a set of rows.

   "Set the next action on every customer in Manchester nobody has rung
   in a month" is a field write against a selector, which is the two
   combinatorial parts multiplied together.
   ------------------------------------------------------------- */
for (const f of WRITABLE_FIELDS) {
  const entity = ENTITIES.find((e) =>
    (f.entity === 'trailers' && e.id === 'trailers')
    || (f.entity === 'contacts' && e.id === 'contacts')
    || (f.entity === 'posts' && e.id === 'posts')
    || (f.entity === 'meetings' && e.id === 'meetings'));
  if (!entity) continue;

  // set, add, subtract, clear, depending on what the field takes.
  const ops = f.arithmetic && f.kind !== 'longtext' ? 4 : f.kind === 'longtext' ? 3 : 2;
  // An enum has a fixed set of destinations; everything else is open.
  const values = f.kind === 'enum'
    ? new Set(Object.values(f.vocabulary ?? {})).size
    : 3;                                       // three shapes of value, not three values
  const space = selectionSpace(entity);

  add('field writes', `${f.entity}.${f.key}`, ops * values * space,
    `${ops} ops x ${values} value shapes x ${space.toExponential(1)} selections`);
}

/* -------------------------------------------------------------
   3. Writing a field on one named record.

   Separate from the above because naming a record is not selecting a
   set, and both are things people type.
   ------------------------------------------------------------- */
const REFERENCE_FORMS = 3;                     // STC143980, stc 143980, 143980
let namedTotal = 0;
for (const f of WRITABLE_FIELDS) {
  const ops = f.arithmetic && f.kind !== 'longtext' ? 4 : f.kind === 'longtext' ? 3 : 2;
  const values = f.kind === 'enum' ? Object.keys(f.vocabulary ?? {}).length : 1;
  namedTotal += f.aliases.length * ops * REFERENCE_FORMS * Math.max(1, values);
}
add('named records', 'every field, every alias', namedTotal,
  `${WRITABLE_FIELDS.length} fields x their aliases x ops x ${REFERENCE_FORMS} ways to name a record`);

/* -------------------------------------------------------------
   4. Questions, with a period on the end.
   ------------------------------------------------------------- */
const PERIODS = 9;
const measureWords = MEASURE_WORDS.reduce((n, m) => n + m.words.length, 0);
for (const e of ENTITIES) {
  const dims = e.dimensions.reduce((n, d) => n + d.words.length, 0);
  const amounts = e.amounts.reduce((n, a) => n + a.words.length, 0);
  const space = selectionSpace(e);
  add('questions', e.id,
    space * PERIODS * Math.max(1, dims + amounts),
    `${space.toExponential(1)} selections x ${PERIODS} periods x ${dims + amounts} groupings and measures`);
}

/* -------------------------------------------------------------
   5. Prospecting, which is its own parameter space.
   ------------------------------------------------------------- */
const places = new Set(Object.values(DEPOTS)).size + 20;   // depots, plus towns people type
const radii = 8;                                            // 5, 10, 15, 25, 50, 100, and the word forms
const sizes = 7;                                            // small, mid, large, and four numeric shapes
const counts = 10;                                          // a few, 4, 20, 50, top ten, and so on
add('prospecting', 'company finder',
  places * radii * (INDUSTRIES.length + 1) * sizes * counts,
  `${places} places x ${radii} radii x ${INDUSTRIES.length + 1} trades x ${sizes} sizes x ${counts} counts`);

/* -------------------------------------------------------------
   6. Flat actions: go somewhere, press the thing.
   ------------------------------------------------------------- */
let flat = 0;
for (const a of ACTIONS) {
  const verbs = (a.verbs ?? []).length;
  const objects = a.objects.length;
  flat += verbs * objects * 2 + objects + (a.phrases ?? []).length;
}
add('navigation and actions', `${ACTIONS.length} actions`, flat,
  'verb x object, both word orders, plus named phrases');

/* ------------------------------------------------------------- */

const total = rows.reduce((n, r) => n + r.count, 0);
const byGroup = new Map<string, number>();
for (const r of rows) byGroup.set(r.group, (byGroup.get(r.group) ?? 0) + r.count);

const fmt = (n: number) =>
  n >= 1e9 ? n.toExponential(2) : Math.round(n).toLocaleString('en-GB');

console.log('\nCommand census\n');
console.log('  Distinct commands, counted as verb x rows x field x value.\n');

for (const r of rows) {
  console.log(`  ${r.group.padEnd(22)} ${r.item.padEnd(28)} ${fmt(r.count).padStart(12)}`);
  console.log(`  ${''.padEnd(22)} ${r.how}`);
}

console.log('\n  ------------------------------------------------------------');
for (const [group, n] of byGroup) {
  console.log(`  ${group.padEnd(22)} ${fmt(n).padStart(28)}`);
}
console.log(`  ${'TOTAL'.padEnd(22)} ${fmt(total).padStart(28)}`);

console.log(`\n  Underneath it: ${ACTIONS.length} actions, ${WRITABLE_FIELDS.length} writable fields, `
  + `${ENTITIES.length} queryable entities, ${new Set(Object.values(DEPOTS)).size} depots, `
  + `${new Set(Object.values(BODY_TYPES)).size} body types, ${INDUSTRIES.length} trades.`);

/* The total above is honest multiplication and too large to be useful.
   It says the space is unbounded, which was never really in doubt. The
   number worth acting on is the smallest one, because a tab whose
   selector space is trivial is a tab where people still have to click.

   Anything under a thousand selections means that entity has no
   emptiable, comparable or dated columns registered in select.ts, and
   the sentences people actually type about it will not parse. */
const THIN = 1_000;
const thin = ENTITIES
  .map((e) => ({ id: e.id, space: selectionSpace(e), c: clauseCounts(e) }))
  .filter((x) => x.space < THIN);

if (thin.length) {
  console.log('\n  Thin entities. These still need clicking through:\n');
  for (const t of thin) {
    console.log(`    ${t.id.padEnd(12)} ${String(t.space).padStart(8)} selections  `
      + `(${t.c.nullable} emptiable, ${t.c.comparable} comparable, ${t.c.dated} dated)`);
  }
  console.log('\n    Fix by adding their columns to NULLABLE, COMPARABLE and DATED');
  console.log('    in lib/command/select.ts. Until then the tab is under served.');
}

if (total < FLOOR) {
  console.log(`\n  FAIL: ${fmt(total)} is under the floor of ${fmt(FLOOR)}.\n`);
  process.exit(1);
}
console.log(`\n  Floor is ${fmt(FLOOR)}. Passing.\n`);
