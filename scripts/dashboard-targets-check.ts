/* =============================================================
   One calculation, and a link that lands where it says.

   From the agreed development scope, Task 4:

     Use the same target and actual definitions as Personal Analytics.
     There must not be one calculation on the dashboard and another in
     Analytics.

   and Task 17:

     Personal Target deep-link enters the current person's Personal
     Analytics; target actual is identical between Dashboard and
     Analytics.

   The second is not a number to compare, it is a property to enforce:
   the dashboard must not work anything out. If it calls the same
   database function and prints what comes back, the two cannot
   disagree, and if it ever starts doing arithmetic this fails.

   Run with `npm run check:dashboard-targets`.
   ============================================================= */
import { readFileSync } from 'node:fs';
import { analyticsHref, scopeFromQuery } from '../lib/analytics/scope';

let bad = 0;
const ok = (what: string, held: boolean, why?: string) => {
  console.log(`  ${held ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!held) { bad += 1; if (why) console.log(`        ${why}`); }
};
const head = (s: string) => console.log(`\n  ${s}\n  ${'-'.repeat(s.length)}`);

const ROUTE = 'app/api/dashboard/targets/route.ts';
const BLOCK = 'components/dashboard/FinancialYearTargets.tsx';

const route = readFileSync(ROUTE, 'utf8');
const block = readFileSync(BLOCK, 'utf8');

/* Comments out, so a sentence explaining the rule is not read as a
   breach of it. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

head('The dashboard does not work the figures out for itself');

ok('it calls personal_overview, the function Analytics calls',
  /personal_overview/.test(code(route)),
  'the dashboard is getting the personal figure from somewhere else');

ok('and company_fy_target for the company one',
  /company_fy_target/.test(code(route)));

ok('it never reads revenue_targets, which is the monthly grain',
  !/revenue_targets/.test(code(route)),
  'the annual blocks are reading the monthly table');

/* The arithmetic that would let the two screens disagree: working out
   the percentage, or the remainder, or the revenue. Printing what came
   back is fine; computing it again is not. */
for (const [what, pattern] of [
  ['a percentage of its own', /\/\s*target\b|achieved\s*=\s*[^=]/],
  ['a remainder of its own', /target\s*-\s*\w|-\s*target\b/],
  ['a total of its own from deals', /\bcrm_leads\b|\bsale_price\b|\bestimated_value\b/],
] as const) {
  ok(`the route works out no ${what}`, !pattern.test(code(route)),
    'a second calculation here is how the dashboard and Analytics start disagreeing');
}

head('The link lands in Personal, on whoever follows it');

const href = analyticsHref({ kind: 'personal', person: null });
ok('the personal block links to the analytics page', href.startsWith('/dashboard/analytics'),
  `it links to ${href}`);
ok('and asks for the personal scope', href.includes('scope=personal'), `it links to ${href}`);
ok('and names nobody, so it means whoever is signed in',
  !href.includes('person='),
  `it links to ${href}, which would open somebody else's portfolio for everybody who clicks it`);

const readBack = scopeFromQuery({ scope: 'personal' });
ok('and the analytics page reads it back as personal',
  readBack.kind === 'personal' && readBack.person === null);

ok('the block writes that link rather than a hand typed string',
  /analyticsHref\(/.test(code(block)),
  'a typed URL is a second grammar, and the two drift');

head('Nothing is drawn against a target that does not exist');

ok('a missing company target prints Not set', /Not set/.test(block));

/* Positions rather than a pattern spanning hundreds of characters. A
   multiline regular expression over source is a guess about layout, and
   the first version of these two failed on correct code because the
   file had grown a line. Where each landmark sits in the file is a fact. */
const at = (needle: string) => block.indexOf(needle);
const bars = [...block.matchAll(/width: `\$\{Math\.min\(100/g)].map((m) => m.index ?? -1);

ok('there is exactly one progress bar on the whole block', bars.length === 1,
  `found ${bars.length}`);

ok('and it is inside the personal block, not the company one',
  bars[0] !== undefined && at('Personal target') > 0 && bars[0] > at('Personal target'),
  'a bar against no company target draws empty and reads as having achieved none of it');

ok('and it is inside the branch that knows a target exists',
  bars[0] !== undefined
  && at('fy_target == null ?') > 0
  && bars[0] > at('fy_target == null ?'),
  'the bar is drawn outside the branch that checks there is a target');

head('Somebody with no Personal view gets no personal block');

ok('the block is behind canPersonal', /\{data\.canPersonal &&/.test(block),
  'the personal target is drawn for people who have no Personal Analytics');

ok('and the route decides that from the database, not from a role name',
  /personal_analytics_eligible/.test(code(route))
  && !/sales_rep|sr_sales|managing_director/.test(code(route)),
  'a role name written into the route is a second copy of the ladder');

console.log(bad === 0
  ? '\n  The dashboard prints what Analytics computed, and its link lands on the right person.\n'
  : `\n  ${bad} failed.\n`);
process.exit(bad === 0 ? 0 : 1);
