/* =============================================================
   What can somebody type that the bar does not answer?

   check:fuzz proves the sentences I built work. It cannot find the ones
   I never built, because it generates from the same shapes it asserts.
   Every bug reported so far has been in that blind spot: "how many
   curtainsiders in stock" returning 1, "show me this month's profit"
   offering to write a field, "export a list" offering to create one.
   Each was found by a person typing, one at a time, which does not
   scale and should not have to.

   So this generates from the DATA rather than from the grammar. Every
   column, every amount, every enum value, every dimension the app
   declares, wrapped in the plain phrasings a person uses, and then
   asks: does this resolve to something sensible?

   It is not a pass or fail. It is a list of sentences that a reasonable
   person would type and the bar currently fumbles, ordered so the
   cheapest wins are at the top.

     npm run check:gaps
   ============================================================= */
import { parseQuery } from '../lib/command/query';
import { parseEdit } from '../lib/command/mutate';
import { parseSelection } from '../lib/command/select';
import { ENTITIES } from '../lib/command/schema';
import { WRITABLE_FIELDS } from '../lib/command/fields';
import { TABLES } from '../lib/command/columns';
import { capabilitiesFor } from '../lib/crm/permissions';

const caps = capabilitiesFor({ role: 'admin' });

type Gap = { sentence: string; why: string; group: string };
const gaps: Gap[] = [];
let tried = 0;

const record = (sentence: string, why: string, group: string) => {
  gaps.push({ sentence, why, group });
};

/* -------------------------------------------------------------
   1. Every amount, asked for the way people ask for money.
   ------------------------------------------------------------- */
const MONEY_SHAPES = [
  (w: string) => `show me our ${w}`,
  (w: string) => `what is our ${w}`,
  (w: string) => `total ${w} this month`,
  (w: string) => `${w} this year`,
  (w: string) => `how much ${w} have we made`,
  (w: string) => `${w} by rep`,
  (w: string) => `average ${w}`,
];

for (const e of ENTITIES) {
  for (const amount of e.amounts) {
    for (const word of amount.words) {
      if (word.length < 4) continue;
      for (const shape of MONEY_SHAPES) {
        const s = shape(word);
        tried++;
        const p = parseQuery(s);
        if (!p) { record(s, 'no plan at all', 'amounts'); continue; }
        /* A sentence naming a figure and no rows should not come back as
           a list. That was the "show me this month's profit" bug. */
        if (p.measure === 'list' && !/\blist\b|\bwhich\b/.test(s)) {
          record(s, `answered as a list of ${p.entity.label}`, 'amounts');
        }
      }
    }
  }
}

/* -------------------------------------------------------------
   2. Every dimension, asked for as a breakdown.
   ------------------------------------------------------------- */
for (const e of ENTITIES) {
  for (const dim of e.dimensions) {
    for (const word of dim.words) {
      for (const s of [`${e.label} by ${word}`, `break ${e.label} down by ${word}`,
                       `how many ${e.label} per ${word}`]) {
        tried++;
        const p = parseQuery(s);
        if (!p) { record(s, 'no plan at all', 'breakdowns'); continue; }
        if (!p.groupBy) record(s, 'parsed but did not group', 'breakdowns');
      }
    }
  }
}

/* -------------------------------------------------------------
   3. Every enum value, counted and listed.
   ------------------------------------------------------------- */
for (const e of ENTITIES) {
  for (const f of e.filters) {
    if (!f.vocabulary) continue;
    for (const [word, value] of Object.entries(f.vocabulary)) {
      if (word.length < 3) continue;
      for (const s of [`how many ${word} ${e.label}`, `list ${word} ${e.label}`]) {
        tried++;
        const p = parseQuery(s);
        if (!p) { record(s, 'no plan at all', 'values'); continue; }
        const hit = p.filters.find((x) => x.column === f.column);
        if (!hit) record(s, `did not narrow on ${f.label}`, 'values');
        else if (hit.value !== value) record(s, `narrowed to ${hit.value}, not ${value}`, 'values');
      }
    }
  }
}

/* -------------------------------------------------------------
   4. Every writable column, asked about as well as written.

   Somebody who can set a field will ask about it, and the two use the
   same words. This is where "show me the profit" went wrong.
   ------------------------------------------------------------- */
for (const f of WRITABLE_FIELDS) {
  for (const alias of f.aliases.slice(0, 2)) {
    if (alias.length < 4) continue;
    const noun = f.entity === 'trailers' ? 'trailers'
      : f.entity === 'contacts' ? 'customers'
      : f.entity === 'posts' ? 'social posts' : 'meetings';

    const asking = `show me the ${alias} on all ${noun}`;
    tried++;
    if (parseEdit(asking, caps)) record(asking, 'a question offered to write a field', 'reads vs writes');

    const selecting = `${noun} with no ${alias}`;
    tried++;
    const sel = parseSelection(selecting, 'Alex Ellis');
    if (!sel) record(selecting, 'cannot select on it being empty', 'selectors');
  }
}

/* -------------------------------------------------------------
   5. Every column in the database, asked about at all.

   The widest net: if a column exists and nothing in the bar responds to
   its name, nobody can reach it by typing.
   ------------------------------------------------------------- */
for (const t of TABLES) {
  for (const c of t.columns) {
    if (c.kind === 'system') continue;
    const word = c.name.replace(/_/g, ' ');
    const s = `${t.label} by ${word}`;
    tried++;
    const p = parseQuery(s);
    if (!p) record(s, `nothing responds to the ${t.table}.${c.name} column`, 'unreachable columns');
  }
}

/* ------------------------------------------------------------- */

const byGroup = new Map<string, Gap[]>();
for (const g of gaps) byGroup.set(g.group, [...(byGroup.get(g.group) ?? []), g]);

console.log(`\n${tried.toLocaleString('en-GB')} plain sentences tried, `
  + `${gaps.length.toLocaleString('en-GB')} of them the bar fumbles.\n`);

for (const [group, list] of [...byGroup.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${group}  (${list.length})`);
  // A handful each, so the output stays readable and still names names.
  const seen = new Set<string>();
  for (const g of list) {
    if (seen.size >= 6) break;
    if (seen.has(g.why)) continue;
    seen.add(g.why);
    console.log(`    "${g.sentence}"`);
    console.log(`       ${g.why}`);
  }
  if (list.length > seen.size) console.log(`    and ${list.length - seen.size} more`);
  console.log();
}

if (!gaps.length) console.log('  Nothing fumbled. Widen the shapes above.\n');
