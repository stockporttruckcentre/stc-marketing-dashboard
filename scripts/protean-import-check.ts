/* =============================================================
   Reading the two Protean exports.

   The headers here are copied from the real files, character for
   character, including the currency in the column name and the trailing
   empty columns the open jobs export ends every row with.

   What this is guarding against is the failure that leaves no trace: a
   file read the wrong way parses, imports, and reports a cheerful count
   with every money column at zero. There is nothing to notice.

   npm run check:protean-import
   ============================================================= */
import { readProteanExport, accountsIn, inBatches } from '../lib/protean/import';

let pass = 0, fail = 0;
const failures: string[] = [];
function ok(what: string, cond: boolean, got = '') {
  if (cond) { pass += 1; return; }
  fail += 1;
  failures.push(`  ${what}${got ? `\n      ${got}` : ''}`);
}

/* Exactly the header Protean writes, and two real rows from the export. */
const INVOICES = [
  'Invoice No,Document No,Customer Ref,Alpha,Customer,Site Name,Created,Tax Point,Created By,Due,Net(£),Tax(£),Gross(£)',
  '296288,249957,STC145525,STCSALES,STC Sales and Leasing Limited,STC Sales and Leasing Limited,02-Sep-26,28-Aug-26,JD,26-Nov-26,£250.30,£50.06,£300.36',
  '296289,Multiple,STC145526,BOOKER,Booker Limited,Haydock,02-Sep-26,28-Aug-26,JD,26-Nov-26,"£1,234.56",£246.91,"£1,481.47"',
].join('\n');

const OPEN_JOBS = [
  'Job No,Equip No,Job Type,Status,Customer,Site,Depot,Logged Date,Last Visit Date,Entered By,Job Total(£),Authority,Attachments,WIP Note,Booker/SSO Codes,Order No,Sales Rep,Mileage',
  '250691,18345x,General Repair,Unallocated,Booker Limited,Booker Limited,Haydock,27-Aug-26,,JOT,£4.40,,,,,,,',
].join('\n');

/* -------------------------------------------------------------
   1. Each file is recognised as itself.
   ------------------------------------------------------------- */
{
  const inv = readProteanExport(INVOICES);
  ok('the invoice export is read as invoices', inv.ok && inv.kind === 'invoices',
    inv.ok ? inv.kind : inv.why);

  const jobs = readProteanExport(OPEN_JOBS);
  ok('the open jobs export is read as open jobs', jobs.ok && jobs.kind === 'open_jobs',
    jobs.ok ? jobs.kind : jobs.why);

  /* Somebody drops the trailer stock list in. It must say so rather
     than import a thousand rows of nothing. */
  const wrong = readProteanExport('Make,Model,Year,Price\nSchmitz,Curtainsider,2019,18500');
  ok('a file that is neither is refused', !wrong.ok,
    wrong.ok ? wrong.kind : '');
  ok('and the refusal says what the right file looks like',
    !wrong.ok && wrong.why.includes('Invoice No') && wrong.why.includes('Job No'),
    !wrong.ok ? wrong.why : '');

  const empty = readProteanExport('');
  ok('an empty file is refused', !empty.ok);
}

/* -------------------------------------------------------------
   2. The columns arrive as the database wants them.

   This is the one that has no symptom when it breaks. `Net(£)` read as
   text is zero, and a zero total looks exactly like a quiet month.
   ------------------------------------------------------------- */
{
  const inv = readProteanExport(INVOICES);
  if (!inv.ok || inv.kind !== 'invoices') throw new Error('the invoice fixture stopped parsing');
  const [a, b] = inv.rows;

  ok('the money column is found by name, currency and all',
    a!.net === 250.3, String(a!.net));
  ok('a thousands separator inside quotes survives the CSV',
    b!.net === 1234.56, String(b!.net));
  ok('the tax point is the accounting date, read as a date',
    a!.tax_point === '2026-08-28', String(a!.tax_point));
  ok('and Created is kept separately, because it drifts over a month end',
    a!.created_on === '2026-09-02', String(a!.created_on));
  ok('the code is upper case whatever the file says',
    a!.alpha === 'STCSALES', a!.alpha);
  ok('"Multiple" in Document No is kept, not treated as a number',
    b!.document_no === 'Multiple', String(b!.document_no));

  const jobs = readProteanExport(OPEN_JOBS);
  if (!jobs.ok || jobs.kind !== 'open_jobs') throw new Error('the open jobs fixture stopped parsing');
  const j = jobs.rows[0]!;
  ok('a job total reads as money', j.job_total === 4.4, String(j.job_total));
  ok('an empty last visit date is nothing, not today', j.last_visit_on === null,
    String(j.last_visit_on));
  ok('the customer name comes through', j.protean_name === 'Booker Limited', j.protean_name);
  ok('and the trailing empty columns do not become values',
    j.order_no === null && j.sales_rep === null && j.mileage === null);
}

/* -------------------------------------------------------------
   3. A row the database would refuse is counted here too.

   The number on the screen before the import and the number in the log
   afterwards have to come from the same rule, or the import looks like
   it lost rows it never had.
   ------------------------------------------------------------- */
{
  const ragged = readProteanExport([
    'Invoice No,Document No,Customer Ref,Alpha,Customer,Site Name,Created,Tax Point,Created By,Due,Net(£),Tax(£),Gross(£)',
    '1,1,r,AAA,A Ltd,A,01-Jan-26,01-Jan-26,JD,01-Feb-26,£10.00,£2.00,£12.00',
    ',1,r,AAA,A Ltd,A,01-Jan-26,01-Jan-26,JD,01-Feb-26,£10.00,£2.00,£12.00',
    '3,1,r,AAA,A Ltd,A,01-Jan-26,,JD,01-Feb-26,£10.00,£2.00,£12.00',
    '4,1,r,AAA,A Ltd,A,01-Jan-26,01-Jan-26,JD,01-Feb-26,,,',
  ].join('\n'));
  if (!ragged.ok) throw new Error(ragged.why);

  ok('four rows are read', ragged.read === 4, String(ragged.read));
  ok('one is usable', ragged.rows.length === 1, String(ragged.rows.length));
  ok('and the other three are counted rather than dropped in silence',
    ragged.unusable === 3, String(ragged.unusable));
  ok('none of them are blank rows: every one carries real data',
    ragged.blank === 0, String(ragged.blank));
}

/* -------------------------------------------------------------
   3b. A BLANK row is not a broken one.

   The real rental export lists every invoice number the system has ever
   issued and fills in only the ones inside the date range asked for.
   The first file is 335 invoices and 2,653 bare numbers: invoice 2654
   is dated 1 April 2025, the first day of the range, and everything
   below it predates it.

   Counting those as rejected data puts a four figure warning on a
   screen where nothing is wrong, and a warning that is usually wrong is
   a warning nobody reads on the day it is right.
   ------------------------------------------------------------- */
{
  const header = 'Invoice No,Alpha,Customer,Site Name,Created,Created By,Tax Point,Due,Net(£),Tax(£),Gross(£)';
  const rental = readProteanExport([
    header,
    '2988,ABG,ABG Enterprises LLP,ABG Enterprises LLP,01-Sep-26,RD,01-Sep-26,01-Sep-26,12500,2500,15000',
    '2987,ABG,ABG Enterprises LLP,ABG Enterprises LLP,01-Sep-26,RD,01-Sep-26,01-Sep-26,400,80,480',
    /* Everything but the number. The export left these behind. */
    '2653,,,,,,,,,,',
    '2652,,,,,,,,,,',
    '2651,,,,,,,,,,',
    /* Genuinely broken: it has a customer and a figure and no date. */
    '2650,BROKE,Broken Ltd,Broken Ltd,01-Sep-26,RD,,01-Sep-26,999,0,999',
  ].join('\n'));
  if (!rental.ok || rental.kind !== 'invoices') throw new Error('the rental fixture stopped parsing');

  ok('the rental export is read as invoices', rental.kind === 'invoices');
  ok('two real invoices come through', rental.rows.length === 2, String(rental.rows.length));
  ok('three bare invoice numbers are counted as blank',
    rental.blank === 3, String(rental.blank));
  ok('and only the genuinely broken row is counted as unusable',
    rental.unusable === 1, String(rental.unusable));
  ok('a spreadsheet number needs no unpicking',
    rental.rows[0]!.net === 12500, String(rental.rows[0]!.net));

  /* A file that is ENTIRELY blank rows still says nothing came through,
     rather than reporting a clean import of nought. */
  const allBlank = readProteanExport([header, '10,,,,,,,,,,', '9,,,,,,,,,,'].join('\n'));
  ok('a file of nothing but bare numbers yields no invoices',
    allBlank.ok && allBlank.kind === 'invoices' && allBlank.rows.length === 0
      && allBlank.blank === 2,
    allBlank.ok ? `${allBlank.rows.length} rows, ${allBlank.blank} blank` : allBlank.why);
}

/* -------------------------------------------------------------
   4. The accounts a file mentions, and the slices it goes in.
   ------------------------------------------------------------- */
{
  const inv = readProteanExport(INVOICES);
  const accounts = accountsIn(inv);
  ok('two invoices on two codes are two accounts', accounts.length === 2,
    JSON.stringify(accounts.map((a) => a.account)));
  ok('an account is named as Protean names it',
    accounts.some((a) => a.name === 'Booker Limited'),
    JSON.stringify(accounts.map((a) => a.name)));

  /* The open jobs export carries no code, so it creates no accounts. */
  ok('the open jobs export creates no accounts',
    accountsIn(readProteanExport(OPEN_JOBS)).length === 0);

  const slices = inBatches(Array.from({ length: 20817 }, (_, i) => i), 500);
  ok('twenty thousand rows go in 42 slices', slices.length === 42, String(slices.length));
  ok('and no row is lost or repeated between them',
    slices.flat().length === 20817 && new Set(slices.flat()).size === 20817);
  ok('an empty file is no slices at all', inBatches([], 500).length === 0);
}

console.log(`\n  ${pass}/${pass + fail} hold.\n`);
if (fail) {
  console.log('  failures:');
  for (const f of failures) console.log(f);
  process.exit(1);
}
console.log('  Both exports are read as themselves, every money column parses, '
  + 'and a row that will not go in is counted before it is offered.\n');
