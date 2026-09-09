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

   The `?view=` names that used to be asserted here are gone with the
   tabs. From the business: "Not keen on tabs here, people miss tabs."
   Everything behind them is in the division column it belongs to now,
   so there is no view to name and nothing for an action to land on
   beyond the page itself. What replaces that assertion is the one
   below: no command bar action may still point at a `?view=` that no
   longer exists.
   ============================================================= */

import { readFileSync } from 'node:fs';
import { monthsOfTheYear, sameMonthLastYear } from '../lib/protean/finance';

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

console.log('\n  The command bar\n  ---------------');

/* NOTHING POINTS AT A SCREEN THAT NO LONGER EXISTS.

   Two rounds of this now. First eleven actions navigated to
   `?period=30d` and its siblings, which nothing had read for months.
   Then seven pointed at `?view=deals` and the rest, which existed for
   one commit and went with the tabs.

   Both times the action was offered, accepted, navigated, and did
   nothing. So the rule is asserted rather than the list: an analytics
   action may carry no query string at all, because the page has no
   states left to address. */
{
  const actions = require('../lib/command/actions') as
    { ACTIONS: { id: string; path?: string }[] };
  const withQuery = actions.ACTIONS
    .filter((a) => a.path?.startsWith('/dashboard/analytics') && a.path.includes('?'));
  ok('no analytics action navigates to a query the screen does not read',
    withQuery.length === 0,
    withQuery.map((a) => `${a.id} -> ${a.path}`).join(', '));

  const plain = actions.ACTIONS.filter((a) => a.path === '/dashboard/analytics');
  ok('and the screen is still reachable', plain.length > 0);
}

console.log('\n  The customer panels\n  -------------------');

/* THE LIST AND ITS FOOTNOTE COUNT THE SAME CUSTOMERS.

   From the business: "increase top/bottom customers to 10, currently
   says top ten but shows 8."

   The footnote under Biggest customers reads "Top ten are n%", which
   comes from `revenue_concentration` and really is over ten. The bars
   beside it were the top eight. Two different tens on one panel, and
   the smaller one with no number on it, which is the shape of mistake
   nobody catches by looking: eight bars under a sentence about ten
   look exactly like ten bars under a sentence about ten.

   So the count is one constant and this asserts the three places it
   has to reach.

   Read out of the source rather than imported, because the hub is a
   client component and pulling it into Node drags React and every
   chart in with it for the sake of one number. */
{
  const src = readFileSync('components/analytics/legacy/AnalyticsHub.tsx', 'utf8');

  const shows = Number(src.match(/const SHOW_CUSTOMERS = (\d+)/)?.[1] ?? 0);
  ok('the customer panels name how many they show', shows > 0,
     'SHOW_CUSTOMERS is not declared');
  ok('and it is ten, which is what the footnote claims', shows === 10,
     `it is ${shows}`);

  /* Both lists, and neither of them a number typed at the call site.
     A second literal is how the two panels came to disagree in the
     first place. */
  const literal = [...src.matchAll(/\.slice\(0,\s*(\d+)\)/g)].map((m) => m[1]);
  ok('neither customer list slices to a number of its own',
     literal.length === 0,
     `still cutting at ${literal.join(', ')}`);
  ok('both of them cut to the constant',
     (src.match(/\.slice\(0, SHOW_CUSTOMERS\)/g) ?? []).length === 2,
     'expected the biggest customers and the movers');

  /* AND ENOUGH IS FETCHED TO FILL THEM.

     Unscoped, the three division lists are netted together by
     customer, so the group's tenth biggest can sit eleventh inside
     their own division and never arrive. Asking each division for only
     ten would quietly return a top ten that is not the top ten. */
  const perDivision = src.match(/const FETCH_PER_DIVISION = SHOW_CUSTOMERS \* (\d+)/)?.[1];
  ok('each division is asked for more than the panel shows, because the lists are netted',
     Number(perDivision ?? 0) > 1,
     'FETCH_PER_DIVISION must be a multiple of SHOW_CUSTOMERS above one');
  ok('the per division fetch is the one the RPC is given',
     /p_limit: FETCH_PER_DIVISION/.test(src));
  ok('and the movers are fetched the same way, since the unchanged are dropped after',
     /customerMovement\(supabase, upto, FETCH_PER_DIVISION, /.test(src));
}

console.log('\n  Every panel narrows when a division is picked\n  ---------------------------------------------');

/* THE DRILL IN REACHES EVERY PANEL.

   From the business: "is this page wired? who moved doesn't change
   when i go between divisions?"

   It did not. Two of the eight panels ignored the division, and both
   for the same underlying reason: they were the only two whose figures
   the database ranks and cuts before the page sees a row, so they
   cannot be filtered here. `customer_movement` returned the COMPANY's
   biggest movers, and `revenue_concentration` was being handed a
   hardcoded null while sitting under a panel whose bars did narrow.

   Nothing about that was visible. The other six filter what they were
   given, so they looked identical in the source and behaved
   differently on the screen, and the panel went on saying "Against the
   same point last year" over a list that was not about the division
   named beside it.

   So each one is asserted by name. A panel added later that forgets
   `only` fails here rather than in a demo.

   Read out of the source rather than imported: the hub is a client
   component and pulling it into Node drags React and every chart in
   with it. */
{
  const src = readFileSync('components/analytics/legacy/AnalyticsHub.tsx', 'utf8');

  /* The six that filter rows they already hold. Each is a `useMemo`,
     and the division has to be in its dependency list or React hands
     back the previous answer for the previous division. */
  for (const [what, panel] of [
    ['customers', 'Biggest customers'],
    ['ageing', 'How old the open work is'],
    ['funnel', 'What is coming'],
    ['oldest', 'the ninety day footnote'],
    ['gaps', 'Billed to a name with no customer record'],
    ['stack', 'Invoiced by month'],
  ] as [string, string][]) {
    const deps = src.match(
      new RegExp(`const ${what} = useMemo[\\s\\S]*?\\}, \\[([^\\]]*)\\]\\);`),
    )?.[1] ?? '';
    /* `scope` counts. It is `only ? divisions.filter(...) : divisions`
       and nothing else, so a memo that depends on it depends on the
       division through one hop rather than not at all. */
    ok(`${panel} is redrawn when the division changes`,
       /\bonly\b/.test(deps) || /\bscope\b/.test(deps),
       `${what} depends on [${deps.trim()}]`);
  }

  /* `scope` is accepted above only because this holds. If it ever stops
     being derived from the division, six assertions quietly stop
     meaning anything. */
  /* `scope` is a one line memo, so it ends at the first `);` rather
     than at a `}, [`. Matching the same shape as the block memos above
     ran straight past it into the next one. */
  const scopeAt = src.indexOf('const scope = useMemo');
  const scopeDeps = src.slice(scopeAt, src.indexOf(');', scopeAt));
  ok('and `scope` is itself the division',
     /\bonly\b/.test(scopeDeps), `scope depends on [${scopeDeps.trim()}]`);

  /* The two the database has to narrow. Asserted on the call, because
     a division that never leaves the browser is the bug itself. */
  ok('Who moved asks the database for the division',
     /customerMovement\(supabase, upto, FETCH_PER_DIVISION, asDivision\(only\)\)/.test(src),
     'customer_movement ranks and cuts before we see a row, so it cannot be filtered here');
  ok('and the top ten footnote asks for it too',
     /concentration\(supabase, asDivision\(only\), upto\)/.test(src),
     'it was being handed a hardcoded null under a panel whose bars did narrow');
  ok('both are re-asked when the division changes',
     /\}, \[supabase, upto, only\]\);/.test(src),
     'loadScoped must depend on only');

  /* And neither of them may go back to being filtered here, which is
     the wrong answer dressed as the right one: it returns the
     company's biggest movers that happen to touch a division. */
  ok('and neither is filtered in the browser instead',
     !/movers[\s\S]{0,400}?\.filter\([^)]*divisions/.test(src),
     'filtering after the ranking answers a different question');

  /* The panel says which customers it is ranking. A correct list under
     a caption about the whole company is the same fault reported one
     step later. */
  ok('and the panel names the division it is showing',
     /hint=\{picked/.test(src) && /caption=\{picked/.test(src));
}

console.log(
  failed === 0
    ? '\n  The table covers the right months, compares against the right ones,\n'
      + '  both customer panels show ten, and every panel narrows with the division.\n'
    : `\n  ${failed} to fix.\n`,
);
process.exit(failed === 0 ? 0 : 1);
