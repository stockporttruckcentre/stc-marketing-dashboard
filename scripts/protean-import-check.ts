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


/* =============================================================
   THE SAGE RENTAL EXPORT.

   From the business:

     it's not accepting the attached file on Revenue which is from SAGE
     not protean. We can only take rental information from sage.

   It was refused for two reasons at once, and either alone would have
   done it: different column names, and a byte order mark that the
   Windows-1252 decode turned into three characters on the front of the
   first header, so even the columns it did share did not match.

   Every figure below is taken from the real file the business sent.
   ============================================================= */

const SAGE = [
  'Document No,Type,Date,Code,Customer Name,Invoiced Net Value,Total Gross Value',
  '0000007388,Invoice,01/04/2025,BOOKER,Booker,5200.00,6240.00',
  '0000007369,Invoice,01/04/2025,GOWER,Gower Granary Ltd,411.67,494.00',
  /* A CREDIT NOTE, written positive, as Sage writes them. */
  '0000007418,Credit Note,12/05/2025,DAVIESTU,Davies Turner,200.00,240.00',
  /* The last row of the real file, and the one that proves the date is
     read day first: there is no month 24. */
  '0000007982,Invoice,24/08/2026,SUTTLE,Suttle Transport Service Ltd,145.00,174.00',
].join('\n');

{
  const read = readProteanExport(SAGE);
  ok('the Sage export is recognised', read.ok, read.ok ? '' : read.why);

  if (read.ok && read.kind === 'invoices') {
    ok('every row is usable', read.rows.length === 4 && read.unusable === 0,
      `${read.rows.length} rows, ${read.unusable} unusable`);

    const booker = read.rows.find((r) => r.alpha === 'BOOKER');
    ok('the document number is the invoice number', booker?.invoice_no === '0000007388',
      String(booker?.invoice_no));
    ok('Code becomes the account', booker?.alpha === 'BOOKER');
    ok('Customer Name becomes the name', booker?.protean_name === 'Booker');
    ok('the net is the net', booker?.net === 5200, String(booker?.net));
    /* Sage has no tax column. Gross less net IS the tax, and 6240 less
       5200 is 1040, which is twenty per cent. */
    ok('the tax is worked out from gross and net', booker?.tax === 1040, String(booker?.tax));

    /* DAY FIRST. `01/04/2025` is the first of April, not the fourth of
       January, and a whole year of figures moves by a quarter if this
       is wrong, with nothing on any screen to show for it. */
    ok('01/04/2025 is the first of April', booker?.tax_point === '2025-04-01',
      String(booker?.tax_point));
    const last = read.rows.find((r) => r.alpha === 'SUTTLE');
    ok('24/08/2026 is the twenty fourth of August', last?.tax_point === '2026-08-24',
      String(last?.tax_point));

    /* A CREDIT NOTE COMES OFF. Sage writes 200.00 positive and puts the
       sign in the Type column. Taken at face value a credit ADDS to
       revenue, so it is wrong by twice its own value. */
    const credit = read.rows.find((r) => r.alpha === 'DAVIESTU');
    ok('a credit note is negative', credit?.net === -200, String(credit?.net));
    ok('and so is its gross', credit?.gross === -240, String(credit?.gross));
    ok('and so is its tax', credit?.tax === -40, String(credit?.tax));

    const total = read.rows.reduce((s, r) => s + Number(r.net ?? 0), 0);
    ok('the total is the invoices less the credits',
      Math.round(total * 100) === Math.round((5200 + 411.67 - 200 + 145) * 100), String(total));

    ok('the accounts are found', accountsIn(read).length === 4,
      String(accountsIn(read).length));
  }
}

/* ---- A type nobody has seen yet comes off rather than on ----

   Two types appear in the real file. A third arriving one day and being
   counted as income by default is the expensive way round to be wrong. */
{
  const read = readProteanExport([
    'Document No,Type,Date,Code,Customer Name,Invoiced Net Value,Total Gross Value',
    '0000009999,Refund,01/06/2026,BOOKER,Booker,50.00,60.00',
  ].join('\n'));
  ok('an unfamiliar document type comes off rather than on',
    read.ok && read.kind === 'invoices' && read.rows[0]?.net === -50,
    read.ok && read.kind === 'invoices' ? String(read.rows[0]?.net) : 'not read');
}

/* ---- The ENCODING, which is the other half of why the file was refused ----

   The Sage export is UTF-8 with a byte order mark. `readFileAsProtean`
   used to decode every dropped file as Windows-1252, which turns those
   three bytes into three CHARACTERS rather than into a mark:

     ï»¿Document No

   Papa strips a real U+FEFF and cannot strip that, because it is not a
   byte order mark any more, it is a company name as far as anything
   downstream is concerned. So the first column was named something no
   marker matched, and the file was refused with every column present.

   Asserted from the real bytes rather than from a string with a mark
   typed into it: a test that prefixes U+FEFF proves nothing, because
   Papa handles that case and always did. I wrote that test first and it
   failed, which is how this note exists. */
{
  const bytes = new Uint8Array([
    0xEF, 0xBB, 0xBF,
    ...Array.from(SAGE).map((c) => c.charCodeAt(0)),
  ]);

  const asCp1252 = new TextDecoder('windows-1252').decode(bytes);
  ok('read as Windows-1252, the mark becomes text on the front of the first header',
    asCp1252.startsWith('ï»¿Document No'), asCp1252.slice(0, 20));
  ok('and the file is then refused', !readProteanExport(asCp1252).ok,
    'the mojibake header matched a marker anyway, so this check is not reproducing the fault');

  /* And the rule `readFileAsProtean` follows now. */
  let asUtf8: string;
  try {
    const s = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    asUtf8 = s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
  } catch { asUtf8 = new TextDecoder('windows-1252').decode(bytes); }

  ok('read as UTF-8 with the mark taken off, the same bytes are read',
    readProteanExport(asUtf8).ok);
}

/* ---- And a Windows-1252 file with a pound sign in it still reads ----

   That is the whole reason this decoded as cp1252 in the first place.
   Byte A3 is a pound sign there and is not valid UTF-8 on its own, so
   the strict decode throws and the fallback is taken. */
{
  const line = 'Invoice No,Document No,Customer Ref,Alpha,Customer,Site Name,'
    + 'Created,Tax Point,Created By,Due,Net(\u00A3),Tax(\u00A3),Gross(\u00A3)';
  const bytes = new Uint8Array(Array.from(line).map((c) => c.charCodeAt(0)));
  let out: string;
  try {
    out = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { out = new TextDecoder('windows-1252').decode(bytes); }
  ok('a lone pound sign byte falls back to Windows-1252 and stays a pound sign',
    out.includes('Net(\u00A3)'), out.slice(-24));
}

/* ---- And the two Protean exports still read as themselves ----

   The Sage test runs first in the reader, so a marker set that was too
   loose would swallow the maintenance invoices. */
{
  const inv = readProteanExport(INVOICES);
  ok('the Protean invoice export is still read as itself',
    inv.ok && inv.kind === 'invoices' && !!inv.rows[0]?.alpha);
  const jobs = readProteanExport(OPEN_JOBS);
  ok('the Protean open jobs export is still read as itself',
    jobs.ok && jobs.kind === 'open_jobs');
}

console.log(`\n  ${pass}/${pass + fail} hold.\n`);
if (fail) {
  console.log('  failures:');
  for (const f of failures) console.log(f);
  process.exit(1);
}
console.log('  All three exports are read as themselves, a credit note comes off rather '
  + 'than on, a slash date is read day first, and a row that will not go in is counted '
  + 'before it is offered.\n');
