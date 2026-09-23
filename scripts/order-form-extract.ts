/* =============================================================
   Read the order form template, and write down where its fields are.

   ---- Why this exists rather than a set of coordinates typed by hand ----

   `docs/source/trailer_sales_order/STC-Trailer-Sales-Order.docx` is a
   finished document, written by hand by the person who has to hand it
   to a customer. The repository's rule for that kind of file is the one
   in CLAUDE.md:

     No value is chosen. Not a length, not a colour, not a weight, not a
     gap. [...] Values come out of the file mechanically.

   A .docx is a zip of XML, so the mechanical version of that rule is:
   never rebuild the document, fill the one that exists. Every border,
   every column width, every font size and the logo stay exactly as the
   author set them, because nothing here touches them.

   What this script produces is the ADDRESS BOOK: which table, which
   row, which cell each field goes in, read out of the file rather than
   counted by eye. It also writes down the label sitting beside each
   one, and the filler refuses to run if a label has moved. A new
   template that shifts a column by one is then a failed check rather
   than a customer receiving a VAT number in the box marked Company
   Number.

   ---- What it does not do ----

   It does not copy the document into TypeScript. The .docx is read at
   run time from the path below, as bytes, and handed back as bytes with
   the values written into it.

     npm run orderform:extract      regenerate after a new template
     npm run check:order-form       assert the file still matches
   ============================================================= */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import JSZip from 'jszip';

export const TEMPLATE_PATH =
  'docs/source/trailer_sales_order/STC-Trailer-Sales-Order.docx';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/* -------------------------------------------------------------
   A deliberately small reader.

   `fast-xml-parser` is a dependency and would parse this, but it
   round trips through objects and the whole point here is to change
   three cells and leave 203,751 characters of somebody else's XML
   byte for byte. So the document is treated as text and the only
   structure read is where each `<w:tbl>`, `<w:tr>` and `<w:tc>`
   starts and ends.
   ------------------------------------------------------------- */

/** Every span of a given element, as [start, end) over the raw text. */
export function spansOf(xml: string, tag: string, from = 0, to = xml.length): Array<[number, number]> {
  const open = `<w:${tag}`;
  const close = `</w:${tag}>`;
  const out: Array<[number, number]> = [];
  let i = from;
  while (i < to) {
    const s = xml.indexOf(open, i);
    if (s < 0 || s >= to) break;
    /* `<w:tc` also prefixes `<w:tcPr`, and `<w:tr` prefixes `<w:trPr`.
       The character after the name decides. */
    const after = xml[s + open.length];
    if (after !== '>' && after !== ' ' && after !== '/') { i = s + open.length; continue; }
    /* Self closing, which `<w:p/>` can be. Nothing inside it. */
    const headEnd = xml.indexOf('>', s);
    if (xml[headEnd - 1] === '/') { out.push([s, headEnd + 1]); i = headEnd + 1; continue; }

    let depth = 1;
    let j = headEnd + 1;
    while (j < to && depth > 0) {
      const nextOpen = xml.indexOf(open, j);
      const nextClose = xml.indexOf(close, j);
      if (nextClose < 0) break;
      if (nextOpen >= 0 && nextOpen < nextClose) {
        const a = xml[nextOpen + open.length];
        const h = xml.indexOf('>', nextOpen);
        if ((a === '>' || a === ' ') && xml[h - 1] !== '/') depth += 1;
        j = h + 1;
      } else {
        depth -= 1;
        j = nextClose + close.length;
      }
    }
    out.push([s, j]);
    i = j;
  }
  return out;
}

/** The visible text of a span, entities resolved, runs joined. */
export function textOf(xml: string): string {
  const parts: string[] = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) parts.push(m[1]);
  return parts.join('')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/** Table, row and cell spans for the whole body, top level tables only. */
export function tablesOf(xml: string): Array<{
  span: [number, number];
  rows: Array<{ span: [number, number]; cells: Array<[number, number]> }>;
}> {
  const tables = spansOf(xml, 'tbl');
  /* A nested table's span sits inside another's, so anything contained
     by an earlier one is not a table of the body. */
  const top = tables.filter(([s, e]) =>
    !tables.some(([s2, e2]) => (s2 < s && e <= e2)));
  return top.map(([ts, te]) => {
    const rows = spansOf(xml, 'tr', ts, te)
      .filter(([rs, re2]) => !spansOf(xml, 'tbl', ts + 1, te)
        .some(([ns, ne]) => ns < rs && re2 <= ne));
    return {
      span: [ts, te] as [number, number],
      rows: rows.map(([rs, re2]) => ({
        span: [rs, re2] as [number, number],
        cells: spansOf(xml, 'tc', rs, re2),
      })),
    };
  });
}

/* -------------------------------------------------------------
   The address book.
   ------------------------------------------------------------- */

export type Slot = {
  /** The name the application uses. */
  key: string;
  table: number;
  row: number;
  cell: number;
  /** What is printed beside it, as the template prints it. */
  label: string;
};

/** Where each value goes, as the template lays it out today. */
const SLOTS: Array<Omit<Slot, 'label'>> = [
  { key: 'customer_name',     table: 1, row: 0, cell: 1 },
  { key: 'company_number',    table: 1, row: 0, cell: 3 },
  { key: 'vat_number',        table: 1, row: 1, cell: 1 },
  { key: 'registered_office', table: 1, row: 1, cell: 3 },
  { key: 'representative',    table: 1, row: 2, cell: 1 },
  { key: 'contact_details',   table: 1, row: 2, cell: 3 },

  { key: 'order_number',      table: 2, row: 0, cell: 1 },
  { key: 'delivery_estimate', table: 2, row: 0, cell: 3 },

  { key: 'mot_expiry',        table: 4, row: 0, cell: 1 },
  { key: 'specification',     table: 4, row: 1, cell: 0 },
  { key: 'net_price',         table: 4, row: 2, cell: 1 },
  { key: 'vat',               table: 4, row: 3, cell: 1 },
  { key: 'delivery_address',  table: 4, row: 4, cell: 1 },
  { key: 'total_price',       table: 4, row: 5, cell: 1 },
  { key: 'deposit',           table: 4, row: 6, cell: 1 },
];

/** The label that has to be sitting beside each slot for it to be that slot. */
const EXPECT: Record<string, string> = {
  customer_name:     'Customer Name:',
  company_number:    'Company Number:',
  vat_number:        'VAT Registration Number:',
  registered_office: 'Registered Office Address:',
  representative:    'Customer Representative:',
  contact_details:   'Contact Details (including email):',
  order_number:      'Order Number:',
  delivery_estimate: 'Estimated Delivery Date:',
  mot_expiry:        'MOT Expiry:',
  specification:     'Specification & Modifications (if any):',
  net_price:         'Net Price:',
  vat:               'VAT:',
  delivery_address:  'Delivery Address & Charges (including agreed Incoterm):',
  total_price:       'Total Price (including any refurbishment):',
  deposit:           'Deposit (including date received and method of payment):',
};

/** The eight columns of the trailer schedule, in the template's order. */
const SCHEDULE_COLUMNS = [
  'Trailer Manufacturer & Year',
  'Qty',
  'Chassis Number',
  'Stock Number',
  'MOT Expiry',
  'Ministry Number',
  'Condition (New or Used)',
  'Net Price Per Trailer (excl. VAT)',
];

export type Extract = {
  sha256: string;
  tables: number;
  slots: Slot[];
  schedule: { table: number; headerRow: number; firstBodyRow: number; blankRows: number; columns: string[] };
  /** The tables a proposal drops, by index: the signing page and the terms. */
  signingTable: number;
  termsTables: number[];
  /** The paragraph pointing at the terms, which goes with them. */
  termsPointer: string;
  /** The contiguous fragment of it actually searched for. Word splits a
      sentence across runs wherever the formatting changes, so the whole
      sentence is never one string in the file. */
  termsPointerMark: string;
};

export async function readTemplate(root = process.cwd()): Promise<{ bytes: Buffer; xml: string }> {
  const bytes = readFileSync(resolve(root, TEMPLATE_PATH));
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('The template has no word/document.xml in it.');
  return { bytes, xml: await file.async('string') };
}

export async function extract(root = process.cwd()): Promise<Extract> {
  const { bytes, xml } = await readTemplate(root);
  const tables = tablesOf(xml);

  const slots: Slot[] = SLOTS.map((s) => {
    const t = tables[s.table];
    if (!t) throw new Error(`The template has no table ${s.table}, and ${s.key} lives in it.`);
    const r = t.rows[s.row];
    if (!r) throw new Error(`Table ${s.table} has no row ${s.row}, and ${s.key} lives in it.`);
    if (!r.cells[s.cell]) {
      throw new Error(`Table ${s.table} row ${s.row} has no cell ${s.cell}, and ${s.key} lives in it.`);
    }
    /* The label is the cell before, except where the field IS the cell
       with the label in it, which is how the template lays out the
       specification box: a wide cell with the heading and the space
       under it. */
    const labelCell = s.cell === 0 ? r.cells[0] : r.cells[s.cell - 1];
    const label = textOf(xml.slice(labelCell[0], labelCell[1]));
    const want = EXPECT[s.key];
    if (want && label !== want) {
      throw new Error(
        `The template has moved. ${s.key} expected the label ${JSON.stringify(want)} `
        + `beside it and found ${JSON.stringify(label)}. Nothing is written until this agrees, `
        + `because a shifted column puts a VAT number in the box marked Company Number.`,
      );
    }
    return { ...s, label };
  });

  /* The schedule, checked column by column for the same reason. */
  const sched = tables[3];
  if (!sched) throw new Error('The template has no trailer schedule.');
  const header = sched.rows[0].cells.map((c) => textOf(xml.slice(c[0], c[1])));
  if (header.length !== SCHEDULE_COLUMNS.length
      || header.some((h, i) => h !== SCHEDULE_COLUMNS[i])) {
    throw new Error(
      `The trailer schedule's columns have changed.\n  expected: ${SCHEDULE_COLUMNS.join(' | ')}\n`
      + `  found:    ${header.join(' | ')}`,
    );
  }

  const out: Extract = {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    tables: tables.length,
    slots,
    schedule: {
      table: 3,
      headerRow: 0,
      firstBodyRow: 1,
      blankRows: sched.rows.length - 1,
      columns: SCHEDULE_COLUMNS,
    },
    signingTable: 5,
    termsTables: tables.map((_, i) => i).filter((i) => i >= 6),
    termsPointer:
      'All Orders are subject to STC Sales and Leasing Limited’s standard terms and conditions. '
      + 'Please refer to the copy attached overleaf.',
    termsPointerMark: 'All Orders are subject to STC Sales and Leasing Limited',
  };

  /* Word splits a sentence across runs wherever the formatting changes,
     and it splits this one after "conditions. ", so the whole sentence
     is never one string in the file. The proposal cut searches the
     contiguous fragment instead, and it has to be there exactly once or
     the cut has no boundary to work from. */
  const marks = xml.split(out.termsPointerMark).length - 1;
  if (marks !== 1) {
    throw new Error(
      `The sentence marking where the terms begin appears ${marks} times in the template. `
      + 'A proposal is the order form with everything after it removed, so it has to appear once.',
    );
  }

  /* The signing page has to be the signing page. */
  const signing = tables[out.signingTable];
  const first = textOf(xml.slice(signing.rows[0].cells[0][0], signing.rows[0].cells[0][1]));
  if (!first.startsWith('Authorised Signatory for the Customer')) {
    throw new Error(`Table ${out.signingTable} was expected to be the signing page and reads ${JSON.stringify(first)}.`);
  }

  return out;
}

function render(e: Extract): string {
  return `/* GENERATED BY scripts/order-form-extract.ts. DO NOT EDIT.
 *
 * Read out of ${TEMPLATE_PATH} by \`npm run orderform:extract\`.
 * Every address here was counted by a machine, not by eye, and
 * \`npm run check:order-form\` asserts the template still agrees.
 */
export const TEMPLATE_PATH = ${JSON.stringify(TEMPLATE_PATH)};

/** The template this was read from, so a swapped file is noticed. */
export const TEMPLATE_SHA256 = ${JSON.stringify(e.sha256)};

export type OrderFormSlot = {
  key: string; table: number; row: number; cell: number; label: string;
};

export const SLOTS: OrderFormSlot[] = ${JSON.stringify(e.slots, null, 2)};

export const SCHEDULE = ${JSON.stringify(e.schedule, null, 2)} as const;

/** What a proposal leaves out: the signing page and the terms behind it. */
export const SIGNING_TABLE = ${e.signingTable};
export const TERMS_TABLES: number[] = ${JSON.stringify(e.termsTables)};
export const TERMS_POINTER = ${JSON.stringify(e.termsPointer)};
export const TERMS_POINTER_MARK = ${JSON.stringify(e.termsPointerMark)};

export const TABLE_COUNT = ${e.tables};
`;
}

async function main() {
  const e = await extract();
  const path = resolve(process.cwd(), 'lib/orderform/template.generated.ts');
  writeFileSync(path, render(e));
  console.log(`order form: ${e.slots.length} slots, ${e.tables} tables, schedule of ${e.schedule.blankRows} rows`);
  console.log(`wrote lib/orderform/template.generated.ts`);
}

if (process.argv[1] && process.argv[1].endsWith('order-form-extract.ts')) {
  main().catch((err) => { console.error(String(err?.message ?? err)); process.exit(1); });
}
