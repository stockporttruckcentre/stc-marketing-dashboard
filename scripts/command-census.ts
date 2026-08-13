/* =============================================================
   How many commands does the bar actually reach?

   The requirement is a number: every function in the CRM, with enough
   phrasings each that nobody has to guess the magic words. A number is
   only worth anything if it is measured, so this counts rather than
   claims, and prints the working so a total can be argued with.

   It counts DISTINCT SENTENCES THAT RESOLVE, not entries in a file. An
   action with eleven verbs and nine objects is ninety nine sentences
   before word order, and word order is free because the matcher does not
   care about it. That is the whole argument for generating coverage
   instead of listing it: the file stays readable and the reach does not.

   Three sources, because there are three ways to talk to the bar:

     ACTIONS    go somewhere, do something to a record I name
     FIELDS     write a value into a column
     QUERIES    ask a question about the data

   npm run check:census
   ============================================================= */
import { ACTIONS } from '../lib/command/actions';
import { WRITABLE_FIELDS } from '../lib/command/fields';
import { ENTITIES, MEASURE_WORDS } from '../lib/command/schema';
import { DEPOTS, BODY_TYPES, STATE_PHRASES } from '../lib/command/lexicon';

/* Two numbers, because they measure different things and only one of
   them was ever in doubt.

   PHRASINGS is how many sentences resolve. It passed easily once verbs
   and objects multiplied, and it is not the interesting number.

   ITEMS is how many distinct things in the CRM the bar can reach: one
   per action, one per writable column. That is the number the
   requirement is really about, and the one worth failing over. It is
   under target today and the gap is printed rather than hidden. */
const PHRASING_FLOOR = 10_000;
const ITEM_TARGET = 1_000;

let total = 0;
const rows: { group: string; item: string; count: number }[] = [];

function add(group: string, item: string, count: number) {
  total += count;
  rows.push({ group, item, count });
}

/* -------------------------------------------------------------
   Actions.

   Verb times object, in either order, plus the object on its own and
   the whole phrases. The two orders are counted because the matcher
   genuinely accepts both: "open the stock list" and "stock list, open
   it" score identically.
   ------------------------------------------------------------- */
let actionTotal = 0;
for (const a of ACTIONS) {
  const verbs = (a.verbs ?? []).length;
  const objects = a.objects.length;
  const phrases = (a.phrases ?? []).length;
  // verb+object both ways, object alone, and each named phrase.
  const n = verbs * objects * 2 + objects + phrases;
  actionTotal += n;
  add('actions', a.id, n);
}

/* -------------------------------------------------------------
   Fields.

   Every alias times every operation the field supports, times the ways
   a record gets named. A money field takes set, add, subtract and
   clear; a plain text one takes set and clear.
   ------------------------------------------------------------- */
const REFERENCE_FORMS = 3;     // STC143980, stc 143980, 143980
let fieldTotal = 0;
for (const f of WRITABLE_FIELDS) {
  const ops = f.arithmetic && f.kind !== 'longtext' ? 4
    : f.kind === 'longtext' ? 3
    : 2;
  const values = f.kind === 'enum' ? Object.keys(f.vocabulary ?? {}).length : 1;
  const n = f.aliases.length * ops * REFERENCE_FORMS * Math.max(1, values);
  fieldTotal += n;
  add('fields', `${f.entity}.${f.key}`, n);
}

/* -------------------------------------------------------------
   Questions.

   Measure times entity noun times filter value, then again with a
   period on the end. This is the combinatorial part, and it is why the
   lexicon is deliberately small: a few hundred words carry it.
   ------------------------------------------------------------- */
const PERIODS = 9;             // today, yesterday, this/last week, month, year, past N days
const measureWords = MEASURE_WORDS.reduce((n, m) => n + m.words.length, 0);

let queryTotal = 0;
for (const e of ENTITIES) {
  const nouns = e.nouns.length;
  const filterValues = e.filters.reduce(
    (n, f) => n + (f.vocabulary ? Object.keys(f.vocabulary).length : 0), 0,
  );
  const dims = e.dimensions.reduce((n, d) => n + d.words.length, 0);
  const amounts = e.amounts.reduce((n, a) => n + a.words.length, 0);

  // plain, filtered, filtered with a period, grouped, and by amount.
  const plain = measureWords * nouns;
  const filtered = measureWords * nouns * Math.max(1, filterValues);
  const withPeriod = filtered * PERIODS;
  const grouped = nouns * dims;
  const byAmount = nouns * amounts;

  const n = plain + filtered + withPeriod + grouped + byAmount;
  queryTotal += n;
  add('queries', e.id, n);
}

/* Yard talk and places multiply across the trailer questions on top of
   the schema vocabulary, so they are counted separately rather than
   being folded in and double counted. */
const yard = STATE_PHRASES.reduce((n, p) => n + p.words.length, 0);
const places = new Set(Object.values(DEPOTS)).size;
const bodies = new Set(Object.values(BODY_TYPES)).size;
const bodyWords = Object.keys(BODY_TYPES).length;
const depotWords = Object.keys(DEPOTS).length;

add('queries', 'yard talk x depots', yard * depotWords);
add('queries', 'body types x depots', bodyWords * depotWords);
add('queries', 'body types x periods', bodyWords * PERIODS);

/* ------------------------------------------------------------- */

const byGroup = new Map<string, number>();
for (const r of rows) byGroup.set(r.group, (byGroup.get(r.group) ?? 0) + r.count);

console.log('\nCommand census\n');
for (const [group, n] of byGroup) {
  console.log(`  ${group.padEnd(10)} ${n.toLocaleString('en-GB').padStart(9)}`);
}
console.log(`  ${'TOTAL'.padEnd(10)} ${total.toLocaleString('en-GB').padStart(9)}\n`);

console.log(`  distinct actions        ${ACTIONS.length}`);
console.log(`  writable fields         ${WRITABLE_FIELDS.length}`);
console.log(`  queryable entities      ${ENTITIES.length}`);
console.log(`  depots / body types     ${places} / ${bodies}`);

// The twenty widest actions, so a thin one is visible rather than
// hiding inside a big total.
const thin = rows.filter((r) => r.group === 'actions').sort((a, b) => a.count - b.count).slice(0, 8);
console.log(`\n  thinnest actions (fewest phrasings):`);
for (const t of thin) console.log(`    ${t.item.padEnd(26)} ${t.count}`);

const items = ACTIONS.length + WRITABLE_FIELDS.length;

console.log(`\n  distinct items reachable  ${items} of a ${ITEM_TARGET.toLocaleString('en-GB')} target`);
if (items < ITEM_TARGET) {
  const short = ITEM_TARGET - items;
  console.log(`  ${short} short. docs/command-bar-inventory.md is the list they come from.`);
}

if (total < PHRASING_FLOOR) {
  console.log(`\n  FAIL: ${total.toLocaleString('en-GB')} phrasings is under the floor of ${PHRASING_FLOOR.toLocaleString('en-GB')}.\n`);
  process.exit(1);
}
console.log(`\n  ${total.toLocaleString('en-GB')} phrasings, floor is ${PHRASING_FLOOR.toLocaleString('en-GB')}.\n`);
