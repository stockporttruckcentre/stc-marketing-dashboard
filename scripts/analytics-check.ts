/* =============================================================
   Are the figures on the Analytics hub right?

   This is the check that matters most in the repository, because the
   failure mode of an analytics page is not a crash. It is a chart that
   renders beautifully over a total computed one row short, and is
   believed, and is taken into a board meeting.

   Three things are asserted, and the first two are the ones that go
   wrong quietly.

   1. PERIOD ARITHMETIC. Every window, every comparison, every part
      month trim, including the awkward dates: the end of a long month
      compared against a short one, a leap day, a financial year that
      starts in April, a custom range that crosses a year boundary.

   2. AGGREGATION. Leads, stock and contracts folded into the shapes the
      page draws, over fixtures built to contain exactly the cases that
      break a naive implementation: a lead won with no order date, a
      trailer with no cost, a person who raises leads and closes none, a
      contract cancelled the month after it started.

   3. THE RULES THE PAGE PROMISES. No figure without provenance. A
      missing number is null and never nought. The order date test on
      won business, which is the rule the tracker learned the hard way.

   npm run check:analytics
   ============================================================= */
import {
  addDays, addMonths, buildPeriod, compareWords, daysBetween, endOfMonth,
  startOfFinancialYear, startOfMonth, startOfQuarter, trimWords, windowFor, windowWords,
} from '../lib/analytics/period';
import {
  ageingBands, contractBook, decisionsFrom, divisionRows, headlineFigures, indexed,
  monthPoints, peopleRows, sourceFlows, stockUnits, verdictSentence,
  type ContractRow, type LeadRow, type TrailerRow, type WindowRow,
} from '../lib/analytics/shape';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(what: string, cond: boolean, extra?: string) {
  if (cond) { pass += 1; return; }
  fail += 1;
  failures.push(`${what}${extra ? `\n        ${extra}` : ''}`);
}

function eq<T>(what: string, got: T, want: T) {
  ok(what, JSON.stringify(got) === JSON.stringify(want),
    `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
}

/* =============================================================
   1. Dates
   ============================================================= */
console.log('\n  Periods and comparisons\n  -----------------------');

eq('a month starts on the first', startOfMonth('2026-09-09'), '2026-09-01');
eq('a month ends on its last day', endOfMonth('2026-09-09'), '2026-09-30');
eq('February in a leap year has 29 days', endOfMonth('2028-02-05'), '2028-02-29');
eq('February in an ordinary year has 28', endOfMonth('2026-02-05'), '2026-02-28');

eq('a quarter starts in January, April, July or October', startOfQuarter('2026-05-14'), '2026-04-01');
eq('and December is in the fourth', startOfQuarter('2026-12-31'), '2026-10-01');

eq('the financial year starts in the April just gone', startOfFinancialYear('2026-09-09'), '2026-04-01');
eq('and in February it is the previous April', startOfFinancialYear('2026-02-09'), '2025-04-01');
eq('and on 1 April it is that day', startOfFinancialYear('2026-04-01'), '2026-04-01');

/* The clamp is the case a naive implementation gets wrong and nobody
   notices: 31 March minus one month is 31 February, which JavaScript
   turns into 3 March, which double counts three days. */
eq('a month back from the 31st clamps rather than rolling over',
  addMonths('2026-03-31', -1), '2026-02-28');
eq('and a month back from the 30th of a long month lands on the 30th',
  addMonths('2026-05-30', -1), '2026-04-30');
eq('twelve months back from a leap day clamps',
  addMonths('2028-02-29', -12), '2027-02-28');

eq('days between are inclusive at both ends', daysBetween('2026-09-01', '2026-09-09'), 9);
eq('a single day is one day', daysBetween('2026-09-09', '2026-09-09'), 1);

/* -------------------------------------------------------------
   The part month guard, which is the whole reason this file exists
   ------------------------------------------------------------- */
{
  const p = buildPeriod({ kind: 'month', today: '2026-09-09', mode: 'previous', trim: true });
  eq('nine days into September, the window is the nine days',
    p.window, { from: '2026-09-01', to: '2026-09-09' });
  eq('and the comparison is the first nine days of August',
    p.compare, { from: '2026-08-01', to: '2026-08-09' });
  eq('both windows are the same length', [p.days, p.compareDays], [9, 9]);
  ok('and the page says it was trimmed', p.trimmed);
  ok('in words a person can check',
    (trimWords(p) ?? '').includes('first 9 days of August'), trimWords(p) ?? '');
}

{
  const p = buildPeriod({ kind: 'month', today: '2026-09-09', mode: 'previous', trim: false });
  eq('with the guard off, the comparison is the whole of August',
    p.compare, { from: '2026-08-01', to: '2026-08-31' });
  ok('and nothing claims it was trimmed', !p.trimmed);
  ok('so there is no footnote', trimWords(p) === null);
}

{
  /* A whole month against a whole month has nothing to warn about, and
     a footnote on every chart saying so is a footnote people stop
     reading. */
  const p = buildPeriod({ kind: 'month', today: '2026-08-31', mode: 'previous', trim: true });
  eq('a complete month compares against a complete month',
    p.compare, { from: '2026-07-01', to: '2026-07-31' });
  ok('and is not reported as trimmed', !p.trimmed);
}

{
  /* 31 days into a month compared against a 30 day one. The trim must
     not run past the end of the shorter month. */
  const p = buildPeriod({ kind: 'month', today: '2026-05-31', mode: 'previous', trim: true });
  eq('31 days of May trims to the whole of April rather than 31 April',
    p.compare, { from: '2026-04-01', to: '2026-04-30' });
}

{
  const p = buildPeriod({ kind: 'month', today: '2026-09-09', mode: 'lastyear', trim: true });
  eq('last year is the same nine days, twelve months back',
    p.compare, { from: '2025-09-01', to: '2025-09-09' });
}

{
  const p = buildPeriod({ kind: 'quarter', today: '2026-05-14', mode: 'previous', trim: true });
  eq('a quarter runs from the start of the quarter to today',
    p.window, { from: '2026-04-01', to: '2026-05-14' });
  eq('and compares against the same number of days of the quarter before',
    p.compare, { from: '2026-01-01', to: '2026-02-13' });
  eq('same length', [p.days, p.compareDays], [44, 44]);
}

{
  const p = buildPeriod({ kind: 'year', today: '2026-09-09', mode: 'previous', trim: true });
  eq('a year is the financial year to date', p.window, { from: '2026-04-01', to: '2026-09-09' });
  eq('against the same days of the year before', p.compare, { from: '2025-04-01', to: '2025-09-09' });
}

{
  const p = buildPeriod({
    kind: 'custom', today: '2026-09-09', from: '2026-08-20', to: '2026-09-05',
    mode: 'previous', trim: true,
  });
  eq('a custom range keeps its own dates', p.window, { from: '2026-08-20', to: '2026-09-05' });
  eq('and compares against the same length immediately before it',
    p.compare, { from: '2026-08-03', to: '2026-08-19' });
  eq('exactly as long', [p.days, p.compareDays], [17, 17]);
}

{
  const p = buildPeriod({ kind: 'month', today: '2026-09-09', mode: 'target', trim: true });
  ok('comparing against target has no second window', p.compare === null);
  eq('and says so', compareWords(p), 'Against target');
}

eq('a window inside one month reads as one range',
  windowWords({ from: '2026-09-01', to: '2026-09-09' }), '1 to 9 September 2026');
eq('a window across two months names both',
  windowWords({ from: '2026-08-20', to: '2026-09-05' }), '20 August to 5 September 2026');
eq('a single day is a single day',
  windowWords({ from: '2026-09-09', to: '2026-09-09' }), '9 September 2026');

eq('a month window ends today', windowFor('month', '2026-09-09'), { from: '2026-09-01', to: '2026-09-09' });

/* Every day of a year, swept. The trimmed comparison must never be
   longer than the window and must never start after it ends. Those two
   invariants are what a wrong comparison always breaks. */
{
  let bad = 0;
  for (let i = 0; i < 400; i += 1) {
    const today = addDays('2025-06-01', i);
    for (const kind of ['month', 'quarter', 'year'] as const) {
      for (const mode of ['previous', 'lastyear'] as const) {
        const p = buildPeriod({ kind, today, mode, trim: true });
        if (!p.compare) { bad += 1; continue; }
        if (p.compareDays > p.days) bad += 1;
        if (p.compare.from > p.compare.to) bad += 1;
        if (p.window.from > p.window.to) bad += 1;
        if (p.compare.to >= p.window.from && kind !== 'year' && mode === 'previous') bad += 1;
      }
    }
  }
  ok('over 400 days, three kinds and two modes, no comparison overlaps or outruns its window',
    bad === 0, `${bad} failures`);

  /* The two cases that were actually broken, named so they stay fixed
     rather than only being covered by the sweep above. */
  {
    const q = buildPeriod({ kind: 'quarter', today: '2026-03-31', mode: 'previous', trim: true });
    ok('a 90 day quarter does not compare into itself', q.compare!.to < q.window.from,
      JSON.stringify(q.compare));
    const y = buildPeriod({ kind: 'year', today: '2028-03-31', mode: 'previous', trim: true });
    ok('a leap financial year does not compare into itself', y.compare!.to < y.window.from,
      JSON.stringify(y.compare));
  }
}

/* =============================================================
   2. Divisions
   ============================================================= */
console.log('\n  Divisions\n  ---------');

const windowRows: WindowRow[] = [
  { division: 'stc', name: 'STC', revenue: 1284000, deals: 412, customers: 96,
    margin: null, was_revenue: 1098000, was_deals: 380, was_customers: 91, target: 1250000 },
  { division: 'trailer', name: 'Trailer Sales', revenue: 702000, deals: 24, customers: 21,
    margin: 129168, was_revenue: 560000, was_deals: 19, was_customers: 18, target: 560000 },
  { division: 'rental', name: 'Rentals', revenue: 146000, deals: 88, customers: 31,
    margin: null, was_revenue: 184000, was_deals: 96, was_customers: 33, target: 210000 },
];

{
  const rows = divisionRows(windowRows);
  eq('three divisions come back', rows.length, 3);
  ok('STC has no margin, because it records no cost', rows[0]!.margin === null);
  ok('and its scorecard says so rather than showing a zero',
    rows[0]!.detail.every((d) => d.label !== 'Margin'));
  ok('trailer sales does have a margin', rows[1]!.margin === 129168);
  eq('and it is worked out against revenue rather than guessed',
    rows[1]!.detail.find((d) => d.label === 'Margin')?.value, '18.4%');
  eq('an average invoice is revenue over invoices',
    rows[0]!.detail.find((d) => d.label === 'Average invoice')?.value, '£3,117');
}

{
  /* A division with no deals must not divide by zero and must not
     report an average of nought. */
  const rows = divisionRows([{ ...windowRows[0]!, revenue: 0, deals: 0, customers: 0, was_revenue: 0 }]);
  eq('a division with nothing in it says the average is not known',
    rows[0]!.detail.find((d) => d.label === 'Average invoice')?.value, 'not known');
}

{
  const rows = divisionRows(windowRows);
  const p = buildPeriod({ kind: 'month', today: '2026-09-09', mode: 'previous', trim: true });
  const said = verdictSentence(rows, p);
  ok('the verdict names the direction', /Group is (up|down) /.test(said), said);
  ok('and names the divisions that explain it', said.includes('Trailer Sales'), said);
  ok('and it is one sentence per clause, not a paragraph', said.length < 220, said);
}

{
  const p = buildPeriod({ kind: 'month', today: '2026-09-09', mode: 'previous', trim: true });
  const said = verdictSentence(divisionRows([
    { ...windowRows[0]!, revenue: 0, was_revenue: 0, deals: 0, customers: 0, target: null },
  ]), p);
  ok('with nothing invoiced it says so rather than dividing by zero',
    said.includes('nothing invoiced'), said);
}

/* =============================================================
   3. People
   ============================================================= */
console.log('\n  People\n  ------');

const period = buildPeriod({ kind: 'month', today: '2026-09-09', mode: 'previous', trim: true });
const names = new Map([['u1', 'Dean Mann'], ['u2', 'Tom Price'], ['u3', 'Sam Keane']]);

const leads: LeadRow[] = [
  // Dean: raised 3 this month, won 2 of them with dates.
  { id: 'l1', owner_id: 'u1', type: 'trailer_sales', status: 'customer', estimated_value: 30000,
    sale_price: 29000, order_date: '2026-09-04', created_at: '2026-09-01T09:00:00Z', contact_source: 'referral' },
  { id: 'l2', owner_id: 'u1', type: 'trailer_sales', status: 'customer', estimated_value: 26000,
    sale_price: 24000, order_date: '2026-09-06', created_at: '2026-09-02T09:00:00Z', contact_source: 'referral' },
  { id: 'l3', owner_id: 'u1', type: 'trailer_sales', status: 'quoted', estimated_value: 31000,
    sale_price: null, order_date: null, created_at: '2026-09-03T09:00:00Z', contact_source: 'website' },
  // Tom: four leads, none closed. The case that has to reach the decisions list.
  ...Array.from({ length: 5 }, (_, i): LeadRow => ({
    id: `t${i}`, owner_id: 'u2', type: 'maintenance', status: 'contacted',
    estimated_value: 4000, sale_price: null, order_date: null,
    created_at: `2026-09-0${i + 1}T09:00:00Z`, contact_source: 'outbound',
  })),
  // Sam: a customer row with NO order date. Imported invoicing, not a win.
  { id: 'l9', owner_id: 'u3', type: 'rental', status: 'customer', estimated_value: null,
    sale_price: 99999, order_date: null, created_at: '2026-09-02T09:00:00Z', contact_source: null },
  // Dean, last month, so it belongs to the comparison and not the window.
  { id: 'l10', owner_id: 'u1', type: 'trailer_sales', status: 'customer', estimated_value: 20000,
    sale_price: 18000, order_date: '2026-08-04', created_at: '2026-08-01T09:00:00Z', contact_source: 'referral' },
];

{
  const people = peopleRows(leads, names, period);
  const dean = people.find((p) => p.id === 'u1')!;
  const tom = people.find((p) => p.id === 'u2')!;
  const sam = people.find((p) => p.id === 'u3')!;

  eq('Dean raised three leads in the window', dean.leads, 3);
  eq('and closed two of them', dean.won, 2);
  eq('worth what was agreed, not what was estimated', dean.wonValue, 53000);
  eq('his comparison value is last month, not this', dean.wasValue, 18000);
  eq('and his open pipeline is the estimate on the one still live', dean.openValue, 31000);
  eq('his conversion is wins over leads raised', Math.round(dean.conversion * 100), 67);

  eq('Tom raised five and closed none', [tom.leads, tom.won], [5, 0]);
  eq('so his conversion is zero rather than undefined', tom.conversion, 0);

  /* The rule the tracker learned the hard way, asserted here so the
     Analytics hub can never repeat it. A customer row with no agreed
     date is imported invoicing. */
  eq('a customer with no order date is not a win', sam.won, 0);
  eq('and its price is not counted as new business', sam.wonValue, 0);

  eq('the leaderboard is ranked by what was won', people[0]!.id, 'u1');
  eq('a lead raised last month is not in this month’s count', dean.leads, 3);
}

{
  /* Nobody at all. Every summary on the page has to survive it. */
  const people = peopleRows([], names, period);
  eq('no leads gives no rows rather than a row of zeroes', people.length, 0);
}

{
  const flows = sourceFlows(leads, period);
  const referral = flows.find((s) => s.source === 'Referral')!;
  const outbound = flows.find((s) => s.source === 'Outbound')!;
  const unknown = flows.find((s) => s.source === 'Added by hand')!;

  eq('referrals brought two leads in the window', referral.leads, 2);
  eq('and both were won, on the trailer side', referral.won.trailer, 2);
  eq('outbound brought five', outbound.leads, 5);
  eq('and closed none', outbound.won.stc + outbound.won.trailer + outbound.won.rental, 0);
  eq('all five are still open rather than lost', outbound.open, 5);
  eq('a lead with no source is named rather than dropped', unknown.leads, 1);
  eq('the flows are ranked by volume', flows[0]!.source, 'Outbound');
}

/* =============================================================
   4. Stock
   ============================================================= */
console.log('\n  Stock\n  -----');

const trailers: TrailerRow[] = [
  { id: 's1', stc_no: 'STC1', make: 'Krone', model: 'Curtainsider', category: 'Curtainsider',
    status: 'in_stock', location: 'Carrington', retail_price: 30000, sales_price: null,
    total_nbv: 24000, nbv: 24000, created_at: '2026-08-30T00:00:00Z', order_date: null },
  { id: 's2', stc_no: 'STC2', make: 'SDC', model: 'Flatbed', category: 'Flatbed',
    status: 'in_stock', location: 'Hyde', retail_price: 20000, sales_price: null,
    total_nbv: 19600, nbv: 19600, created_at: '2026-01-01T00:00:00Z', order_date: null },
  // No cost recorded. Must not be treated as 100% margin.
  { id: 's3', stc_no: 'STC3', make: null, model: null, category: 'Fridge',
    status: 'in_stock', location: null, retail_price: 40000, sales_price: null,
    total_nbv: null, nbv: null, created_at: '2026-09-01T00:00:00Z', order_date: null },
  // Sold. Not stock any more.
  { id: 's4', stc_no: 'STC4', make: 'Krone', model: 'Box', category: 'Box',
    status: 'sold', location: 'Hyde', retail_price: 25000, sales_price: 25000,
    total_nbv: 20000, nbv: 20000, created_at: '2026-02-01T00:00:00Z', order_date: '2026-09-01' },
];

{
  const units = stockUnits(trailers, '2026-09-09');
  eq('sold units are not in stock', units.length, 3);
  eq('the oldest is first', units[0]!.ref, 'STC2');
  eq('days are counted from the day it was listed', units[0]!.days, 251);

  const noCost = units.find((u) => u.ref === 'STC3')!;
  ok('a unit with no cost has a null margin, not a full one', noCost.marginPct === null);

  const thin = units.find((u) => u.ref === 'STC2')!;
  eq('margin is what is left against the asking price', Math.round(thin.marginPct!), 2);

  const bands = ageingBands(units);
  eq('five bands', bands.length, 5);
  eq('and they account for every unit', bands.reduce((a, b) => a + b.units, 0), 3);
  eq('the oldest band is the one that says act now', bands[4]!.reading, 'Act now');
  eq('and it carries the value of what is in it', bands[4]!.value, 20000);
}

/* =============================================================
   5. The contract book
   ============================================================= */
console.log('\n  FleetSmart+\n  -----------');

const contracts: ContractRow[] = [
  { id: 'c1', plan: 'Gold', status: 'accepted', monthly_total: 900, annual_total: 10400,
    starts_on: '2026-04-01', created_at: '2026-03-20T00:00:00Z', decided_at: '2026-03-25T00:00:00Z' },
  { id: 'c2', plan: 'Platinum', status: 'accepted', monthly_total: 1800, annual_total: 20800,
    starts_on: '2026-06-01', created_at: '2026-05-20T00:00:00Z', decided_at: '2026-05-25T00:00:00Z' },
  { id: 'c3', plan: 'Silver', status: 'accepted', monthly_total: 400, annual_total: 5200,
    starts_on: '2026-09-01', created_at: '2026-08-20T00:00:00Z', decided_at: '2026-08-28T00:00:00Z' },
  // Sent and never signed. Not a book.
  { id: 'c4', plan: 'Gold', status: 'sent', monthly_total: 900, annual_total: 10400,
    starts_on: null, created_at: '2026-09-02T00:00:00Z', decided_at: null },
  // Declined.
  { id: 'c5', plan: 'Platinum', status: 'declined', monthly_total: 2000, annual_total: 26000,
    starts_on: null, created_at: '2026-07-02T00:00:00Z', decided_at: '2026-07-20T00:00:00Z' },
];

{
  const book = contractBook(contracts, period)!;
  ok('there is a book', book !== null);
  eq('only accepted contracts are in it', book.contracts, 3);
  eq('the weekly value is the annual total over 52', Math.round(book.thisWeek), 700);
  eq('annualised is that times 52 again, so it round trips',
    Math.round(book.annualised), 36400);
  eq('the tier mix has three rows', book.mix.length, 3);
  eq('and Platinum is the most valuable of them',
    [...book.mix].sort((a, b) => b.weekly - a.weekly)[0]!.tier, 'Platinum');
  eq('the Silver contract that started this month is counted as added',
    Math.round(book.addedThisPeriod), 100);

  const sept = book.months[book.months.length - 1]!;
  ok('September holds all three tiers', sept.silver > 0 && sept.gold > 0 && sept.platinum > 0);

  /* A contract signed in April is still in the September figure. The
     book is a stock, not a flow, and grouping by signing month is the
     commonest way to get this wrong. */
  ok('a contract signed in April is still in September’s book', sept.gold > 0);

  const cohortWithSignings = book.cohorts.filter((c) => c.signed > 0);
  ok('cohorts exist for the months that had signings', cohortWithSignings.length >= 1);
  for (const c of book.cohorts) {
    ok(`the ${c.month} cohort has no figure for a month that has not happened`,
      c.live.every((v, i) => (i < book.cohorts.length - book.cohorts.indexOf(c) ? true : v === null)));
  }
}

{
  eq('no contracts at all gives no book rather than an empty one',
    contractBook([], period), null);
}

/* =============================================================
   6. Months and indexing
   ============================================================= */
console.log('\n  Trend\n  -----');

{
  const points = monthPoints([
    { month: '2026-07-01', division: 'stc', net: 100 },
    { month: '2026-07-01', division: 'trailer', net: 50 },
    { month: '2026-08-01', division: 'stc', net: 150 },
    { month: '2026-08-01', division: 'trailer', net: 25 },
  ], [{ month: '2026-08-01', division: 'stc', target: 200 }]);

  eq('two months', points.length, 2);
  eq('and they are in order', points.map((p) => p.month), ['2026-07-01', '2026-08-01']);
  eq('a division with no row that month is nought rather than missing', points[0]!.rental, 0);
  eq('the target lands on its month', points[1]!.target, 200);
  ok('and a month with no target has none', points[0]!.target === null);

  const ix = indexed(points);
  eq('every division starts at 100', [ix[0]!.stc, ix[0]!.trailer], [100, 100]);
  eq('STC up by half reads as 150', ix[1]!.stc, 150);
  eq('trailer sales halved reads as 50', ix[1]!.trailer, 50);
  eq('a division with nothing at all stays at 100 rather than dividing by zero',
    ix[1]!.rental, 100);
}

/* =============================================================
   7. The rules the page promises
   ============================================================= */
console.log('\n  The rules\n  ---------');

{
  const rows = divisionRows(windowRows);
  const people = peopleRows(leads, names, period);
  const book = contractBook(contracts, period);
  const figures = headlineFigures({ divisions: rows, people, book, period });

  ok('there are headline figures', figures.length >= 3);
  for (const f of figures) {
    ok(`"${f.label}" says what it counts`, f.provenance.counts.length > 20, f.provenance.counts);
    ok(`"${f.label}" names where it comes from`, f.provenance.source.length > 3);
    ok(`"${f.label}" says who can change it`, f.provenance.changedBy.length > 3);
    ok(`"${f.label}" carries a note about its period`, f.note.length > 3);
  }

  const won = figures.find((f) => f.label === 'New business won')!;
  eq('new business won is what somebody closed, on an agreed date', won.value, 53000);
  ok('and it says the order date rule out loud',
    won.provenance.excludes!.toLowerCase().includes('order date'), won.provenance.excludes!);

  const margin = figures.find((f) => f.label === 'Trailer margin');
  ok('a trailer margin appears, because trailer sales records a cost', Boolean(margin));
  ok('and it says why there is no group margin',
    margin!.provenance.excludes!.includes('STC and Rentals'), margin!.provenance.excludes!);

  ok('no figure claims a group gross margin',
    !figures.some((f) => /group.*margin/i.test(f.label)));
}

{
  const rows = divisionRows(windowRows);
  const people = peopleRows(leads, names, period);
  const units = stockUnits(trailers, '2026-09-09');
  const decisions = decisionsFrom({ divisions: rows, stock: units, people, book: null });

  ok('rentals being behind target reaches the decisions list',
    decisions.some((d) => d.what.includes('Rentals') && d.what.includes('behind target')),
    JSON.stringify(decisions));
  ok('somebody who raised five leads and closed none reaches it',
    decisions.some((d) => d.what.includes('Tom Price')), JSON.stringify(decisions));
  ok('a division that beat its target does not',
    !decisions.some((d) => d.what.includes('Trailer Sales') && d.what.includes('behind')));
  ok('the list is capped, because a feed is not a shortlist', decisions.length <= 5);
  for (const d of decisions) {
    ok(`"${d.what.slice(0, 40)}" has somewhere to go`, d.href !== null || d.tone === 'info');
  }
}

/* No em dashes anywhere the page can print. Everything here is prose
   written for this repository, and the ban applies to all of it. */
{
  const banned = /[–—―]/;
  const rows = divisionRows(windowRows);
  const people = peopleRows(leads, names, period);
  const book = contractBook(contracts, period);
  const said = [
    verdictSentence(rows, period),
    trimWords(period) ?? '',
    compareWords(period),
    windowWords(period.window),
    ...headlineFigures({ divisions: rows, people, book, period })
      .flatMap((f) => [f.label, f.note, f.provenance.counts, f.provenance.excludes ?? '',
        f.provenance.source, f.provenance.changedBy]),
    ...decisionsFrom({ divisions: rows, stock: stockUnits(trailers, '2026-09-09'), people, book })
      .map((d) => d.what),
    ...rows.flatMap((r) => r.detail.map((d) => `${d.label} ${d.value}`)),
    ...ageingBands(stockUnits(trailers, '2026-09-09')).map((b) => `${b.label} ${b.reading}`),
  ];
  for (const s of said) {
    ok(`"${s.slice(0, 40)}" has no em dash`, !banned.test(s), s);
  }
}

console.log(`\n  ${pass}/${pass + fail} passing`);
if (failures.length) {
  console.log('\n  failures:');
  for (const f of failures.slice(0, 30)) console.log(`    ${f}`);
  if (failures.length > 30) console.log(`    ... and ${failures.length - 30} more`);
}
process.exit(fail === 0 ? 0 : 1);
