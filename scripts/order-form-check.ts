/* =============================================================
   The order form check.

   A rule of the form "the generated document matches the template"
   cannot be kept by reading it, because the person who wrote the filler
   is the person judging the match. So this reads the document back out
   of the file it just produced and asserts, cell by cell, that the
   value put in one box came out of that same box.

   That is the shape of every check in this repository that has ever
   caught anything: the assertion is on what came back, not on what was
   sent.

     npm run check:order-form
   ============================================================= */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import { extract, spansOf, textOf } from './order-form-extract';
import {
  DEPOSIT_FALLBACK, depositLinesInTemplate, fillOrderForm,
  type OrderForm,
} from '../lib/orderform/fill';
import {
  SCHEDULE, SIGNING_TABLE, SLOTS, TEMPLATE_PATH, TEMPLATE_SHA256, TERMS_POINTER,
} from '../lib/orderform/template.generated';

let failed = 0;
function ok(cond: boolean, what: string, detail = '') {
  if (cond) { console.log(`  ok   ${what}`); return; }
  failed += 1;
  console.log(`  FAIL ${what}${detail ? `\n       ${detail}` : ''}`);
}

function tablesOf(xml: string) {
  const all = spansOf(xml, 'tbl');
  const top = all.filter(([s, e]) => !all.some(([s2, e2]) => s2 < s && e <= e2));
  return top.map(([ts, te]) => {
    const nested = spansOf(xml, 'tbl', ts + 1, te);
    const rows = spansOf(xml, 'tr', ts, te)
      .filter(([rs, re]) => !nested.some(([ns, ne]) => ns < rs && re <= ne));
    return { rows: rows.map(([rs, re]) => ({ cells: spansOf(xml, 'tc', rs, re) })) };
  });
}

async function documentXml(bytes: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const f = zip.file('word/document.xml');
  if (!f) throw new Error('no word/document.xml');
  return f.async('string');
}

/* One deliberately awkward set of values: an ampersand, a quote, an
   angle bracket, an accent and a multi line address. Every one of those
   breaks a naive string substitution into XML, which is why they are
   the values the check uses rather than "Test Ltd". */
const FORM: OrderForm = {
  customer_name:     'Smith & Sons <Haulage> Ltd',
  company_number:    '05085895',
  vat_number:        'GB 123 4567 89',
  registered_office: 'Unit 4, Bredbury Park Way\nStockport\nSK6 2SN',
  representative:    "Seán O'Brien",
  contact_details:   'sean@example.com\n0161 494 9200',
  order_number:      'STC-ORD-2026-0041',
  delivery_estimate: '14 October 2026',
  mot_expiry:        '31 March 2027',
  specification:     '4.7m curtain, PSK flats, drawbar\nCustomer livery both sides',
  net_price:         '£126,000.00',
  vat:               '£25,200.00',
  delivery_address:  'Bredbury Park Way, Stockport\nDelivered, no charge',
  total_price:       '£151,200.00',
  deposit:           '£15,000.00 received 2 October 2026 by BACS',
  lines: [
    { manufacturer: 'SDC 2024', qty: '2', chassis: 'SDC12345', stockNo: 'STC143980',
      motExpiry: '31/03/2027', ministryNo: 'M998877', condition: 'Used', netPrice: '£21,000.00' },
    { manufacturer: 'Schmitz 2026', qty: '1', chassis: 'SCH99881', stockNo: 'STC144010',
      motExpiry: '-', ministryNo: '-', condition: 'New', netPrice: '£42,000.00' },
    { manufacturer: 'Tiger 2019', qty: '3', chassis: 'TGR55512', stockNo: 'STC141221',
      motExpiry: '12/08/2026', ministryNo: 'M551122', condition: 'Used', netPrice: '£14,000.00' },
    { manufacturer: 'Dennison 2022', qty: '1', chassis: 'DEN77341', stockNo: 'STC142777',
      motExpiry: '02/02/2027', ministryNo: 'M334455', condition: 'Used', netPrice: '£18,500.00' },
    { manufacturer: 'Montracon 2021', qty: '1', chassis: 'MON10298', stockNo: 'STC142001',
      motExpiry: '19/11/2026', ministryNo: 'M110022', condition: 'Used', netPrice: '£16,750.00' },
  ],
};

async function main() {
  console.log('\nThe template is the one the addresses were read from');
  const bytes = readFileSync(resolve(process.cwd(), TEMPLATE_PATH));
  const sha = createHash('sha256').update(bytes).digest('hex');
  ok(sha === TEMPLATE_SHA256,
    'the .docx has not changed since npm run orderform:extract',
    sha === TEMPLATE_SHA256 ? '' : `template is ${sha}, the extract was taken from ${TEMPLATE_SHA256}`);

  console.log('\nThe addresses still agree with the file');
  try {
    const e = await extract();
    ok(e.slots.length === SLOTS.length, `${SLOTS.length} slots, all found and all labelled as expected`);
    ok(e.schedule.columns.length === 8, 'the trailer schedule still has its eight columns');
  } catch (err) {
    ok(false, 'the extract runs against this template', String((err as Error)?.message ?? err));
  }

  console.log('\nThe fault in the template, and what is done about it');
  const templateXml = await documentXml(bytes);
  const inFile = depositLinesInTemplate(templateXml);
  ok(inFile.length === 3,
    'the Deposit cell holds three paragraphs of escaped markup, which is the fault',
    `found ${inFile.length}`);
  ok(JSON.stringify(inFile) === JSON.stringify(DEPOSIT_FALLBACK),
    'the repair is exactly what the escaped markup says, not a rewrite of it',
    `file says ${JSON.stringify(inFile)}\n       code says ${JSON.stringify(DEPOSIT_FALLBACK)}`);

  console.log('\nAn order form, filled');
  const order = await fillOrderForm(bytes, FORM, 'order');
  const oxml = await documentXml(order);
  ok(!oxml.includes('&lt;w:p&gt;'),
    'no line of XML reaches the customer where the deposit goes');

  const tables = tablesOf(oxml);
  for (const slot of SLOTS) {
    const span = tables[slot.table]?.rows[slot.row]?.cells[slot.cell];
    if (!span) { ok(false, `${slot.key} has a cell`); continue; }
    const got = textOf(oxml.slice(span[0], span[1]));
    const want = (FORM as unknown as Record<string, string>)[slot.key];
    /* The specification box carries its own heading, so what comes back
       is the heading and then the value. Every other box is the value. */
    const expect = slot.cell === 0 ? `${slot.label}${want.replace(/\n/g, '')}` : want.replace(/\n/g, '');
    ok(got === expect, `${slot.key} came back out of the box marked "${slot.label}"`,
      got === expect ? '' : `wanted ${JSON.stringify(expect)}\n       got    ${JSON.stringify(got)}`);
  }

  console.log('\nThe trailer schedule');
  const sched = tables[SCHEDULE.table];
  ok(sched.rows.length === FORM.lines.length + 1,
    `five units print five rows and not the template's four`,
    `found ${sched.rows.length - 1} body rows`);
  const firstRow = sched.rows[1].cells.map((c) => textOf(oxml.slice(c[0], c[1])));
  ok(JSON.stringify(firstRow) === JSON.stringify([
    'SDC 2024', '2', 'SDC12345', 'STC143980', '31/03/2027', 'M998877', 'Used', '£21,000.00']),
    'the first unit reads across in the template’s own column order',
    `got ${JSON.stringify(firstRow)}`);
  const lastRow = sched.rows[sched.rows.length - 1].cells.map((c) => textOf(oxml.slice(c[0], c[1])));
  ok(lastRow[3] === 'STC142001' && lastRow[7] === '£16,750.00',
    'and so does the fifth, which the template had no row for',
    `got ${JSON.stringify(lastRow)}`);

  console.log('\nThe order form keeps the signing page and the terms');
  ok(oxml.includes('Authorised Signatory for the Customer'), 'the signing page is there');
  ok(oxml.includes('Basis of contract'), 'the terms are there');
  ok(oxml.includes('PLEASE READ THESE TERMS CAREFULLY'), 'and the warning above them');

  console.log('\nA proposal is the same document with those pages taken out');
  const proposal = await fillOrderForm(bytes, FORM, 'proposal');
  const pxml = await documentXml(proposal);
  ok(!pxml.includes('Authorised Signatory for the Customer'), 'no signing page');
  ok(!pxml.includes('Basis of contract'), 'no terms');
  ok(!pxml.includes(TERMS_POINTER.slice(0, 40)), 'and no sentence pointing at terms that are not attached');

  const ptables = tablesOf(pxml);
  ok(ptables.length === SIGNING_TABLE, `${SIGNING_TABLE} tables left, down from ${tables.length}`,
    `found ${ptables.length}`);

  /* The trap this exists for. The order page's page setup is inside the
     very paragraph the cut removes, and the setup left at the bottom of
     the document is the two column one the terms are typeset in. Cut it
     naively and the proposal comes out in two columns. */
  const psects = pxml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/g) ?? [];
  ok(psects.length === 1, 'the proposal is one section, not three', `found ${psects.length}`);
  ok(Boolean(psects[0]?.includes('w:num="1"')),
    'and it keeps the order page’s one column, not the terms’ two',
    psects[0]?.slice(0, 200));
  ok(Boolean(psects[0]?.includes('w:h="16838"') && psects[0]?.includes('w:right="851"')),
    'with the author’s own page size and margins');
  ok(Boolean(psects[0]?.includes('rIdFtr')), 'and the author’s footer');

  console.log('\nAnd it still says everything the order form says');
  const pslot = SLOTS.find((s) => s.key === 'total_price')!;
  const pspan = ptables[pslot.table].rows[pslot.row].cells[pslot.cell];
  ok(textOf(pxml.slice(pspan[0], pspan[1])) === FORM.total_price,
    'the proposal quotes the same total as the order',
    `got ${JSON.stringify(textOf(pxml.slice(pspan[0], pspan[1])))}`);
  ok(ptables[SCHEDULE.table].rows.length === FORM.lines.length + 1,
    'and lists the same five units');

  console.log('\nNothing the author drew was touched');
  const tzip = await JSZip.loadAsync(bytes);
  const ozip = await JSZip.loadAsync(order);
  const names = Object.keys(tzip.files).filter((n) => !tzip.files[n].dir).sort();
  ok(JSON.stringify(names) === JSON.stringify(
    Object.keys(ozip.files).filter((n) => !ozip.files[n].dir).sort()),
    'the same parts are in the file, and no more');
  for (const name of names) {
    if (name === 'word/document.xml') continue;
    const a = await tzip.file(name)!.async('uint8array');
    const b = await ozip.file(name)!.async('uint8array');
    ok(Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0,
      `${name} is byte for byte the author's`);
  }

  console.log(failed === 0
    ? '\nThe order form is the author’s document with the deal written into it.\n'
    : `\n${failed} failed.\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
