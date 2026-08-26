/* =============================================================
   Pins the import matcher against real spreadsheet headers.

   The command parser check earned its keep by finding four bugs that
   would otherwise have shipped, so the same treatment here. Every case
   below is a header somebody plausibly types, or a value format that has
   actually come out of Excel.

   npm run check:import
   ============================================================= */
import { matchColumns, parseDate, parseMoney, parseStatus, coerce } from '../lib/import/match';
import { buildPlan, countPlan } from '../lib/import/plan';
import { CRM_CONTACTS, STOCK_TRAILERS, SALES_TRACKER } from '../lib/import/dictionary';

let pass = 0, fail = 0;

function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
}

/* ---------- header matching ---------- */

function mapOf(headers: string[], rows: Record<string, any>[] = []) {
  const out: Record<string, string | null | undefined> = {};
  for (const c of matchColumns(headers, rows)) out[c.header] = c.target;
  return out;
}

check('plain headers',
  mapOf(['Company', 'Contact', 'Email', 'Phone']),
  { Company: 'company_name', Contact: 'contact_name', Email: 'email', Phone: 'phone' });

check('the exact case from the brief: "em addrs"',
  mapOf(['Company Name', 'em addrs']),
  { 'Company Name': 'company_name', 'em addrs': 'email' });

check('punctuation and case are folded away',
  mapOf(['E-Mail Address', 'Tel. No', 'Customer  Name']),
  { 'E-Mail Address': 'email', 'Tel. No': 'phone', 'Customer  Name': 'company_name' });

check('a typo still lands',
  mapOf(['Comapny Name', 'Emial']),
  { 'Comapny Name': 'company_name', Emial: 'email' });

check('trailer number is recognised and dropped, not ignored silently',
  mapOf(['Company', 'Trailer Number']),
  { Company: 'company_name', 'Trailer Number': null });

check('other stock columns drop too',
  mapOf(['Company', 'MOT Expiry', 'Net Book Value', 'Stock No']),
  { Company: 'company_name', 'MOT Expiry': null, 'Net Book Value': null, 'Stock No': null });

check('a genuinely unknown header stays unmapped',
  mapOf(['Company', 'Widget Preference']),
  { Company: 'company_name', 'Widget Preference': undefined });

// The bug this pins: a bare substring test made "trailer park operator"
// match the trailers field. Whole phrase only.
check('a word inside a longer phrase does not claim the field',
  mapOf(['Company', 'Trailer Park Operator']),
  { Company: 'company_name', 'Trailer Park Operator': undefined });

check('"no of trailers" does still match trailers',
  mapOf(['Company', 'No of Trailers']),
  { Company: 'company_name', 'No of Trailers': 'trailers' });

/* ---------- value sniffing, for when the header is useless ---------- */

check('a useless header is judged on its values',
  mapOf(['Company', 'Column F'], [
    { Company: 'A Ltd', 'Column F': 'ops@a.co.uk' },
    { Company: 'B Ltd', 'Column F': 'hello@b.com' },
    { Company: 'C Ltd', 'Column F': 'sales@c.co.uk' },
  ]),
  { Company: 'company_name', 'Column F': 'email' });

check('phone numbers are recognised by shape',
  mapOf(['Company', 'Unnamed: 3'], [
    { Company: 'A', 'Unnamed: 3': '0161 480 1234' },
    { Company: 'A', 'Unnamed: 3': '07700 900123' },
    { Company: 'A', 'Unnamed: 3': '+44 161 480 9999' },
  ]),
  { Company: 'company_name', 'Unnamed: 3': 'phone' });

// The bug this pins: greedy first-come assignment gave `email` to
// whichever email-ish column appeared first in the sheet. The loser is
// left honestly unmapped rather than being talked into a field.
check('the stronger claim wins the field',
  mapOf(['Old Email Notes', 'Email'], [
    { 'Old Email Notes': 'ops@a.co.uk', Email: 'real@a.co.uk' },
    { 'Old Email Notes': 'x@b.com', Email: 'real@b.com' },
  ]),
  { 'Old Email Notes': undefined, Email: 'email' });

/* ---------- value coercion ---------- */

check('UK date order', parseDate('03/04/2026'), '2026-04-03');
check('two digit year', parseDate('3/4/26'), '2026-04-03');
check('written month', parseDate('17 Aug 2026'), '2026-08-17');
check('ISO passes through', parseDate('2026-08-17T09:00:00Z'), '2026-08-17');
check('nonsense date is refused', parseDate('sometime'), null);
check('impossible month is refused', parseDate('03/13/2026'), null);

check('money with symbol and commas', parseMoney('£1,250,000'), 1250000);
check('shorthand millions', parseMoney('1.25m'), 1250000);
check('shorthand thousands', parseMoney('450k'), 450000);

check('status synonym', parseStatus('Closed Won'), 'won');
check('status shorthand', parseStatus('prospect'), 'lead');
check('unknown status is refused', parseStatus('marinated'), null);

check('excel leading apostrophe is stripped', coerce('phone', "'0161 480 1234"), '0161 480 1234');
check('email is lowercased', coerce('email', 'OPS@A.CO.UK'), 'ops@a.co.uk');
check('bare domain gets a scheme', coerce('url', 'stc-uk.com'), 'https://stc-uk.com');

/* ---------- the plan ---------- */

const headers = ['Company', 'em addrs', 'Trailer Number', 'Turnover', 'Last Contact'];
const rows = [
  { Company: 'Bredbury Haulage', 'em addrs': 'ops@bredbury.co.uk', 'Trailer Number': 'STC1421', Turnover: '£1,200,000', 'Last Contact': '03/04/2026' },
  { Company: 'FleetSmart', 'em addrs': 'hi@fleetsmart.com', 'Trailer Number': 'STC1422', Turnover: '450k', 'Last Contact': 'not a date' },
  { Company: 'Bredbury Haulage', 'em addrs': 'ops@bredbury.co.uk', 'Trailer Number': 'STC1423', Turnover: '', 'Last Contact': '' },
  { Company: '', 'em addrs': 'orphan@nowhere.com', 'Trailer Number': '', Turnover: '', 'Last Contact': '' },
  { Company: 'Dawson Group', 'em addrs': 'buy@dawson.co.uk', 'Trailer Number': '', Turnover: '', 'Last Contact': '' },
];
const existing = [{ id: 'x1', company_name: 'Dawson Group', email: 'buy@dawson.co.uk' }];
const plan = buildPlan(matchColumns(headers, rows), rows, existing, CRM_CONTACTS);

check('values are coerced into the record',
  plan.rows[0].values,
  { company_name: 'Bredbury Haulage', email: 'ops@bredbury.co.uk', turnover: 1200000, last_contact: '2026-04-03' });

check('an unreadable cell is reported, not written',
  [plan.rows[1].issues.length, plan.rows[1].values.last_contact],
  [1, undefined]);

check('a repeat inside the file is caught', plan.rows[2].duplicateInFile, 0);
check('a row with no company is skipped', plan.rows[3].decision, 'skip');
// The label comes from the dictionary now, not a hardcoded pair.
check('an existing record is caught', plan.rows[4].duplicateOf?.matchedOn, 'email');
check('and it names what it collided with', plan.rows[4].duplicateOf?.label, 'Dawson Group');
check('duplicates default to skip', plan.rows[4].decision, 'skip');

check('the dropped column is named and explained',
  plan.dropped.map((d) => d.header),
  ['Trailer Number']);

check('the counts add up',
  countPlan(plan),
  { create: 2, skip: 3, attach: 0, withIssues: 2, duplicates: 2, dropped: 1, unknown: 0 });

/* ---------- a company that is in the CRM but not on this list ----------

   Dean imports his customer sheet onto his own list. Half of it is
   already in the CRM on the shared pipeline. Checking only the list on
   screen found nothing, so every one of those was written again, which
   is the duplicate problem coming back through the front door on the
   day somebody first used the tab.

   It is not a new company and it is not a row to drop either: it is
   that company, and it goes onto this list as well. */
const elsewhere = [
  { id: 'x1', company_name: 'Dawson Group', email: 'buy@dawson.co.uk', onThisList: false },
];
const crossList = buildPlan(matchColumns(headers, rows), rows, elsewhere, CRM_CONTACTS);

check('a company on another list is recognised, not imported again',
  crossList.rows[4].duplicateOf?.id, 'x1');
check('and it says it is elsewhere in the CRM',
  crossList.rows[4].duplicateOf?.onThisList, false);
check('so the default is to put it on this list rather than skip it',
  crossList.rows[4].decision, 'attach');
check('it is counted as something to attach, not something to create',
  [countPlan(crossList).attach, countPlan(crossList).create], [1, 2]);

/* And a match on the list somebody has open still needs nothing. */
check('a company already on this list is still left alone',
  buildPlan(matchColumns(headers, rows), rows,
    [{ id: 'x1', company_name: 'Dawson Group', email: 'buy@dawson.co.uk', onThisList: true }],
    CRM_CONTACTS).rows[4].decision,
  'skip');

/* A dictionary with no lists behind it, like the stock list, says
   nothing about where a match lives and every match is right here. */
check('a table with no lists treats every match as already here',
  buildPlan(matchColumns(headers, rows), rows,
    [{ id: 'x1', company_name: 'Dawson Group', email: 'buy@dawson.co.uk' }],
    CRM_CONTACTS).rows[4].decision,
  'skip');

/* ---------- stock, where the same header means something else ---------- */

function stockMap(headers: string[], rows: Record<string, any>[] = []) {
  const out: Record<string, string | null | undefined> = {};
  for (const c of matchColumns(headers, rows, STOCK_TRAILERS)) out[c.header] = c.target;
  return out;
}

check('a stock sheet maps to stock columns',
  stockMap(['STC No', 'Make', 'Model', 'MOT Expiry', 'NBV']),
  { 'STC No': 'stc_no', Make: 'make', Model: 'model', 'MOT Expiry': 'mot_date', NBV: 'nbv' });

check("Dave's stock number, however it is spelled",
  stockMap(['Stock No', 'Chassis Number']),
  { 'Stock No': 'stc_no', 'Chassis Number': 'chassis_number' });

// The point of per tab dictionaries: an email column is real data on the
// contacts import and a category error here, and the reverse is true of a
// chassis number. Both are named and dropped rather than ignored.
check('a customer email is dropped from a stock import',
  stockMap(['STC No', 'Email', 'Phone']),
  { 'STC No': 'stc_no', Email: null, Phone: null });

check('a chassis number is dropped from a contacts import',
  mapOf(['Company', 'Chassis Number']),
  { Company: 'company_name', 'Chassis Number': null });

// The dictionary has to be passed to matchColumns as well as buildPlan.
// Leaving it off made both of these pass for the wrong reason: under the
// contacts dictionary "STC No" is a dropped column, so the row failed on
// a missing company name rather than on anything being tested here.
const noStockNo = [{ 'STC No': '', Make: 'SDC' }];
check('a stock row with no stock number cannot be imported',
  buildPlan(matchColumns(['STC No', 'Make'], noStockNo, STOCK_TRAILERS), noStockNo, [], STOCK_TRAILERS)
    .rows[0].decision,
  'skip');

const twice = [{ 'STC No': 'STC1421' }, { 'STC No': 'STC1421' }];
check('two units with the same stock number are caught',
  buildPlan(matchColumns(['STC No'], twice, STOCK_TRAILERS), twice, [], STOCK_TRAILERS)
    .rows[1].duplicateInFile,
  0);

/* ---------- the tracker, where deal money is real ---------- */

function trackerMap(headers: string[], rows: Record<string, any>[] = []) {
  const out: Record<string, string | null | undefined> = {};
  for (const c of matchColumns(headers, rows, SALES_TRACKER)) out[c.header] = c.target;
  return out;
}

// A price is dropped from a contacts import and kept on the tracker,
// because a tracker row is a deal rather than a company.
check('deal money is kept on the tracker',
  trackerMap(['Company', 'Deal Value', 'Sale Price', 'Profit']),
  { Company: 'company_name', 'Deal Value': 'estimated_value', 'Sale Price': 'sale_price', Profit: 'profit' });

check('a trailer number is still dropped on the tracker',
  trackerMap(['Company', 'Trailer Number']),
  { Company: 'company_name', 'Trailer Number': null });

check('the tracker still understands ordinary contact columns',
  trackerMap(['Customer Name', 'em addrs', 'Next Action']),
  { 'Customer Name': 'company_name', 'em addrs': 'email', 'Next Action': 'next_action' });

console.log(`\n${pass}/${pass + fail} passing`);
if (fail) process.exit(1);
