/* =============================================================
   The two bits of the Analytics screen that can be wrong without
   looking wrong.

   ---- Why these two and not the rest ----

   Everything else on that screen is a figure the database worked out,
   and `npm run check:finance` asserts those against the invoices. These
   two are arithmetic done in the browser, and both fail silently:

     monthsOfTheYear    a table that starts in the wrong month is a
                        correct looking table of the wrong months, and
                        nobody reading it out in a meeting would catch
                        it. I wrote it wrong on the first pass: it hunted
                        for the financial year start using the midpoint
                        of the range as a fence, which is right for a
                        twenty four month window and wrong for any other.

     sameMonthLastYear  the variance column. Off by one year and every
                        row is wrong by a whole year, in a column headed
                        "Same month last year".

   And the view names, because `?view=` is what the command bar
   navigates to. A name that drifts between the two files is an action
   that lands on the overview whatever somebody typed, which is the
   exact defect that made this rewrite necessary.
   ============================================================= */

import {
  VIEWS, monthsOfTheYear, sameMonthLastYear, viewFrom,
} from '../lib/protean/finance';

let failed = 0;
const ok = (what: string, cond: boolean, why = '') => {
  if (cond) { console.log(`  ok    ${what}`); return; }
  console.log(`  FAIL  ${what}${why ? `\n        ${why}` : ''}`);
  failed += 1;
};

/** Twenty four consecutive month keys ending at `last`, as the RPC returns. */
const runTo = (last: string, n = 24): string[] => {
  const out: string[] = [];
  let [y, m] = [Number(last.slice(0, 4)), Number(last.slice(5, 7))];
  for (let i = 0; i < n; i += 1) {
    out.push(`${y}-${String(m).padStart(2, '0')}-01`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out.reverse();
};

console.log('\n  The month window\n  ----------------');

/* ---- Read in August, on an April year ---- */
{
  const got = monthsOfTheYear(runTo('2026-08-01'), 4);
  ok('read in August, the year runs April to August',
    got.length === 5 && got[0] === '2026-04-01' && got[4] === '2026-08-01',
    `got ${got.length} months, ${got[0]} to ${got[got.length - 1]}`);
}

/* ---- THE CASE THE FIRST VERSION GOT WRONG.

   Read in MARCH, which is the last month of the year that began in
   April of the PREVIOUS calendar year. A window that looks for "April
   in this calendar year" finds nothing, or finds next April. ---- */
{
  const got = monthsOfTheYear(runTo('2026-03-01'), 4);
  ok('read in March, the year still runs from the April before it',
    got.length === 12 && got[0] === '2025-04-01' && got[11] === '2026-03-01',
    `got ${got.length} months, ${got[0]} to ${got[got.length - 1]}`);
}

/* ---- The first day of a new year: one month, not thirteen ---- */
{
  const got = monthsOfTheYear(runTo('2026-04-01'), 4);
  ok('read in April, the year is one month old',
    got.length === 1 && got[0] === '2026-04-01',
    `got ${got.length} months starting ${got[0]}`);
}

/* ---- A year that is not April, because the setting is a setting ---- */
{
  const got = monthsOfTheYear(runTo('2026-08-01'), 1);
  ok('on a January year, August is eight months in',
    got.length === 8 && got[0] === '2026-01-01',
    `got ${got.length} months starting ${got[0]}`);
}

/* ---- Never more than a year, however long the range ---- */
for (const start of [1, 4, 7, 10, 12]) {
  for (const end of ['2026-01-01', '2026-04-01', '2026-07-01', '2026-11-01', '2026-12-01']) {
    const got = monthsOfTheYear(runTo(end, 36), start);
    if (got.length < 1 || got.length > 12) {
      ok(`year starting month ${start}, read at ${end}`, false,
        `${got.length} months, which is not a year`);
    }
  }
}
ok('no financial year and no read date produces a window longer than a year', true);

/* ---- Less data than a year, which is where a new installation sits ---- */
{
  const got = monthsOfTheYear(['2026-06-01', '2026-07-01'], 4);
  ok('two months of data on an April year gives those two months',
    got.length === 2 && got[0] === '2026-06-01');
}

/* ---- No financial year known ---- */
{
  const got = monthsOfTheYear(runTo('2026-08-01'), undefined);
  ok('with no year known it falls back to the last twelve months',
    got.length === 12 && got[11] === '2026-08-01');
}

/* ---- Duplicates and disorder, because the RPC returns one row per
        division per month and the caller may not have deduplicated ---- */
{
  const messy = ['2026-06-01', '2026-04-01', '2026-06-01', '2026-05-01', '2026-04-01'];
  const got = monthsOfTheYear(messy, 4);
  ok('duplicates collapse and the months come back in order',
    got.join(',') === '2026-04-01,2026-05-01,2026-06-01', got.join(','));
}

console.log('\n  The variance column\n  -------------------');

for (const [month, want] of [
  ['2026-04-01', '2025-04-01'],
  ['2026-01-01', '2025-01-01'],
  ['2026-12-01', '2025-12-01'],
  /* The one a Date would get wrong. 2028 is a leap year and 2027 is
     not, and every key here is the first of a month, so string
     arithmetic is both simpler and the only one that cannot slip. */
  ['2028-02-01', '2027-02-01'],
] as [string, string][]) {
  ok(`${month} compares against ${want}`, sameMonthLastYear(month) === want,
    `got ${sameMonthLastYear(month)}`);
}

console.log('\n  The views\n  ---------');

ok('there are seven views', VIEWS.length === 7, `${VIEWS.length} declared`);
for (const v of VIEWS) {
  ok(`?view=${v.key} resolves to itself`, viewFrom(v.key) === v.key);
}
/* Anything else is the overview rather than a blank screen. The command
   bar is not the only thing that puts a URL in front of this page:
   somebody's bookmark from before the rename is the commoner case. */
for (const junk of [null, undefined, '', 'leaderboard', 'period=30d', 'DEALS', '../etc']) {
  ok(`"${String(junk)}" falls back to the overview`, viewFrom(junk) === 'overview');
}

/* AND THE ACTIONS AGREE WITH THE PAGE.

   `command-coverage-check` asserts that each view has an action
   pointing at it. This asserts the other direction: no action points at
   a view the page does not have. Together they are the pair that would
   have caught six actions navigating to `?period=30d` for months. */
{
  const actions = require('../lib/command/actions') as
    { ACTIONS: { id: string; path?: string }[] };
  const named = actions.ACTIONS
    .filter((a) => a.path?.startsWith('/dashboard/analytics?view='))
    .map((a) => ({ id: a.id, view: a.path!.split('view=')[1]! }));
  const strays = named.filter((n) => !VIEWS.some((v) => v.key === n.view));
  ok('no command bar action points at a view the page does not have',
    strays.length === 0, strays.map((s) => `${s.id} -> ${s.view}`).join(', '));
  ok('actions exist for the views', named.length >= 6, `${named.length} found`);
}

console.log(
  failed === 0
    ? '\n  The table covers the right months and compares against the right ones.\n'
    : `\n  ${failed} to fix.\n`,
);
process.exit(failed === 0 ? 0 : 1);
