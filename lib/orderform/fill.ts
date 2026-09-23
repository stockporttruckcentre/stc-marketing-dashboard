/* =============================================================
   Fill the order form. Do not draw one.

   ---- The rule this is built to ----

   From CLAUDE.md, about a design sent as a finished file:

     Your permission has been removed now to vibecode and do your own
     thing. [...] IM A PROFESSIONAL DESIGNER, I DESIGN FIRST THEN HAND
     IT TO YOU AND YOU PORT IT IN.

   `docs/source/trailer_sales_order/STC-Trailer-Sales-Order.docx` is a
   finished document. So nothing here draws anything. It opens the file
   the author made, writes values into the boxes the author left empty,
   and hands the file back. Every border, column width, font, colour and
   the logo are untouched, because no code here so much as reads them.

   ---- How a value is written ----

   The author left every empty box as a real paragraph with a real run
   and an empty `<w:t>`, already carrying the font, size and colour that
   box is meant to use. So writing a value is putting text inside a tag
   that is already there, and a second line is that same paragraph
   copied. There is no formatting decision to make, which is the point.

   The addresses come from `template.generated.ts`, read out of the file
   by `npm run orderform:extract`. If the template moves a column, the
   extract fails and nothing is generated, rather than a VAT number
   quietly landing in the box marked Company Number.

   ---- THE ONE FAULT IN THE TEMPLATE ----

   The Deposit cell contains, as visible text, the ESCAPED XML of the
   three paragraphs it was meant to contain:

     &lt;w:p&gt;...&lt;w:t&gt;£&lt;/w:t&gt;... and two more

   On screen it prints that markup. It is a slip in whatever produced
   the file, and it is on every copy.

   The repair is mechanical rather than chosen, which is the only reason
   it is done here at all: the intended three lines are fully determined
   by the escaped XML sitting in the cell, so they are read out of it
   rather than written from a guess. `DEPOSIT_FALLBACK` below is that
   unescape, and a generated form never shows a customer a line of XML.
   ============================================================= */
import JSZip from 'jszip';
import {
  SCHEDULE, SIGNING_TABLE, SLOTS, TEMPLATE_SHA256, TERMS_POINTER_MARK,
} from './template.generated';

/* -------------------------------------------------------------
   The same small reader the extractor uses, so one idea of where a
   cell starts serves both.
   ------------------------------------------------------------- */

export function spansOf(xml: string, tag: string, from = 0, to = xml.length): Array<[number, number]> {
  const open = `<w:${tag}`;
  const close = `</w:${tag}>`;
  const out: Array<[number, number]> = [];
  let i = from;
  while (i < to) {
    const s = xml.indexOf(open, i);
    if (s < 0 || s >= to) break;
    const after = xml[s + open.length];
    if (after !== '>' && after !== ' ' && after !== '/') { i = s + open.length; continue; }
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

function tablesOf(xml: string) {
  const all = spansOf(xml, 'tbl');
  const top = all.filter(([s, e]) => !all.some(([s2, e2]) => s2 < s && e <= e2));
  return top.map(([ts, te]) => {
    const nested = spansOf(xml, 'tbl', ts + 1, te);
    const rows = spansOf(xml, 'tr', ts, te)
      .filter(([rs, re]) => !nested.some(([ns, ne]) => ns < rs && re <= ne));
    return {
      span: [ts, te] as [number, number],
      rows: rows.map(([rs, re]) => ({
        span: [rs, re] as [number, number],
        cells: spansOf(xml, 'tc', rs, re),
      })),
    };
  });
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function unesc(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * The cell's last paragraph, cloned once per line with the text put in.
 *
 * The last one rather than the first, because the wide boxes carry
 * their own heading in the first paragraph and the empty one under it
 * is where the value goes. In an ordinary box there is only one and the
 * two readings agree.
 */
function paragraphsFor(cellXml: string, lines: string[]): { head: string; body: string } | null {
  const ps = spansOf(cellXml, 'p');
  if (ps.length === 0) return null;
  const last = ps[ps.length - 1];
  const model = cellXml.slice(last[0], last[1]);
  const head = cellXml.slice(0, last[0]);

  const written = lines.map((line) =>
    /* Every `<w:t>` in the model gets the line, and every model here has
       exactly one. Written with a replace rather than a build so the
       tag's own attributes, `xml:space="preserve"` included, survive. */
    model.replace(/(<w:t(?:\s[^>]*)?>)[\s\S]*?(<\/w:t>)/, `$1${esc(line)}$2`),
  );
  return { head, body: written.join('') };
}

/** Write lines into one cell, returning the whole document. */
function writeCell(xml: string, span: [number, number], lines: string[]): string {
  const cell = xml.slice(span[0], span[1]);
  const built = paragraphsFor(cell, lines.length ? lines : ['']);
  if (!built) return xml;
  const tail = cell.slice(cell.lastIndexOf('</w:tc>'));
  return xml.slice(0, span[0]) + built.head + built.body + tail + xml.slice(span[1]);
}

/* -------------------------------------------------------------
   What goes on the form.
   ------------------------------------------------------------- */

/** One line of the trailer schedule, in the template's own column order. */
export type OrderLine = {
  /** "Trailer Manufacturer & Year" */
  manufacturer: string;
  qty: string;
  chassis: string;
  stockNo: string;
  motExpiry: string;
  ministryNo: string;
  condition: string;
  /** "Net Price Per Trailer (excl. VAT)" */
  netPrice: string;
};

export type OrderForm = {
  customer_name: string;
  company_number: string;
  vat_number: string;
  registered_office: string;
  representative: string;
  contact_details: string;
  order_number: string;
  delivery_estimate: string;
  mot_expiry: string;
  specification: string;
  net_price: string;
  vat: string;
  delivery_address: string;
  total_price: string;
  deposit: string;
  lines: OrderLine[];
};

export type OrderVariant = 'order' | 'proposal';

/**
 * The three lines the Deposit cell was meant to carry, read out of the
 * escaped XML the template has in it rather than written from memory.
 *
 * See the header. This is a repair of somebody else's slip, and it is
 * done by unescaping what is already in the file so that nothing about
 * the wording is a decision.
 */
export const DEPOSIT_FALLBACK = [
  '£',
  'Date received:',
  'Payment made by    ☐ BACS    ☐ Credit card    ☐ Debit card    ☐ Other',
];

/** Read those three lines out of a template, to prove the list above. */
export function depositLinesInTemplate(xml: string): string[] {
  const slot = SLOTS.find((s) => s.key === 'deposit');
  if (!slot) return [];
  const t = tablesOf(xml)[slot.table];
  const span = t?.rows[slot.row]?.cells[slot.cell];
  if (!span) return [];
  const cell = xml.slice(span[0], span[1]);
  const text = unesc(
    (cell.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) ?? [])
      .map((m) => m.replace(/<[^>]+>/g, '')).join(''),
  );
  /* What it holds is markup, so the lines are the `<w:t>` contents of
     the markup it holds. One level of unescaping, then read it again. */
  return (text.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) ?? [])
    .map((m) => unesc(m.replace(/<[^>]+>/g, '')));
}

/**
 * The form, filled.
 *
 * `variant` decides how much of the author's document is kept:
 *
 *   order     all of it: the schedule, the signing page and the terms.
 *   proposal  the same document with the signing page, the terms and
 *             the sentence pointing at them taken out. Nothing is
 *             added, moved or restyled, so a proposal is the order form
 *             with pages removed rather than a second document that has
 *             to be kept in step with the first.
 *
 * That is the shape FleetSmart+ already uses, and it is the reason its
 * proposal can never quote a different figure from its contract.
 */
export async function fillOrderForm(
  templateBytes: Buffer | Uint8Array,
  form: OrderForm,
  variant: OrderVariant = 'order',
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(templateBytes);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('That template has no word/document.xml in it.');
  let xml = await docFile.async('string');

  /* ---- 1. The trailer schedule, one row per unit ----

     The author left four blank rows. A deal with six units needs six,
     and a deal with two should not print four. So the first body row is
     the model and the rest are copies of it, which keeps every border
     and width the author set. A form with no units keeps the four blank
     rows, because a blank order form is a thing people print. */
  if (form.lines.length > 0) {
    const tables = tablesOf(xml);
    const sched = tables[SCHEDULE.table];
    const body = sched.rows.slice(SCHEDULE.firstBodyRow);
    const model = xml.slice(body[0].span[0], body[0].span[1]);

    const built = form.lines.map((line) => {
      const values = [
        line.manufacturer, line.qty, line.chassis, line.stockNo,
        line.motExpiry, line.ministryNo, line.condition, line.netPrice,
      ];
      /* The model row's cells, in order, each given its value. Done on
         the row in isolation so the offsets are the row's own. */
      let row = model;
      for (let c = values.length - 1; c >= 0; c -= 1) {
        const cells = spansOf(row, 'tc');
        if (!cells[c]) continue;
        row = writeCell(row, cells[c], [values[c] ?? '']);
      }
      return row;
    }).join('');

    const from = body[0].span[0];
    const to = body[body.length - 1].span[1];
    xml = xml.slice(0, from) + built + xml.slice(to);
  }

  /* ---- 2. Every named box ---- */
  const deposit = form.deposit.trim() ? [form.deposit] : DEPOSIT_FALLBACK;
  const values: Record<string, string[]> = {
    customer_name:     [form.customer_name],
    company_number:    [form.company_number],
    vat_number:        [form.vat_number],
    registered_office: form.registered_office.split('\n'),
    representative:    [form.representative],
    contact_details:   form.contact_details.split('\n'),
    order_number:      [form.order_number],
    delivery_estimate: [form.delivery_estimate],
    mot_expiry:        [form.mot_expiry],
    specification:     form.specification.split('\n'),
    net_price:         [form.net_price],
    vat:               [form.vat],
    delivery_address:  form.delivery_address.split('\n'),
    total_price:       [form.total_price],
    deposit,
  };

  /* Back to front through the document, so writing one box cannot move
     the box that has not been written yet. */
  const ordered = [...SLOTS].map((slot) => {
    const t = tablesOf(xml)[slot.table];
    const span = t?.rows[slot.row]?.cells[slot.cell];
    return span ? { slot, at: span[0] } : null;
  }).filter(Boolean) as Array<{ slot: typeof SLOTS[number]; at: number }>;
  ordered.sort((a, b) => b.at - a.at);

  for (const { slot } of ordered) {
    const tables = tablesOf(xml);
    const span = tables[slot.table]?.rows[slot.row]?.cells[slot.cell];
    if (!span) continue;
    xml = writeCell(xml, span, values[slot.key] ?? ['']);
  }

  /* ---- 3. A proposal has no signing page and no terms ----

     The terms are not one block. They are two tables, a warning box and
     then a hundred and fifty loose paragraphs of clauses, which is how
     Word writes a document somebody typed. Cutting "tables 6 and 7"
     leaves every clause behind, which is exactly what the first version
     of this did.

     So the boundary is the author's own sentence, not a table index:

       All Orders are subject to [...] standard terms and conditions.
       Please refer to the copy attached overleaf.

     Everything from that paragraph to the end of the body IS the copy
     attached overleaf. A proposal has nothing attached, so it says
     nothing about it and stops there. Nothing is counted by eye and a
     clause added to the terms next year is inside the cut without
     anybody remembering to widen it.

     The section properties at the very end stay: they are the page
     size and the footer, not content. */
  if (variant === 'proposal') {
    const pointer = xml.indexOf(TERMS_POINTER_MARK);
    if (pointer < 0) {
      throw new Error(
        'A proposal is the order form with the terms taken off, and the sentence that '
        + 'says where the terms start is not in this template. Nothing is generated, '
        + 'because a proposal that still carries the signing page is a proposal '
        + 'somebody signs.',
      );
    }
    const holder = spansOf(xml, 'p').find(([s, e]) => s < pointer && pointer < e);
    if (!holder) throw new Error('The terms sentence is not in a paragraph of its own.');

    /* THE PAGE SETUP IS INSIDE THE PARAGRAPH BEING CUT.

       The document is three sections: the order page in one column, the
       terms heading, then the clauses in TWO columns. Word ends a
       section by putting its `<w:sectPr>` in the last paragraph of it,
       and the last paragraph of the order page is this very sentence.

       So cutting the paragraph and stopping there would take the order
       page's own page size, margins and footer with it, and leave the
       document governed by the two column section properties at the
       bottom. A proposal would come out in two columns.

       The section properties are therefore lifted out of the paragraph
       and put where the document's own last ones were. Nothing about
       them is changed: they are the author's setup for the page the
       proposal consists of. */
    const para = xml.slice(holder[0], holder[1]);
    const sectInPara = para.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/)?.[0] ?? null;

    const bodyEnd = xml.lastIndexOf('</w:body>');
    const lastSect = xml.lastIndexOf('<w:sectPr', bodyEnd);
    const lastSectEnd = lastSect >= 0
      ? xml.indexOf('</w:sectPr>', lastSect) + '</w:sectPr>'.length
      : -1;

    const tables = tablesOf(xml);
    const signing = tables[SIGNING_TABLE];

    /* Everything from that sentence to the end of the body. */
    let head = xml.slice(0, holder[0]);
    const tail = xml.slice(bodyEnd);

    /* The signing page sits ABOVE the sentence, so it comes out of the
       head separately. Named by index and then confirmed by what is in
       it, because an index on its own is the thing that goes stale. */
    if (signing) {
      const firstCell = signing.rows[0]?.cells[0];
      const cellXml = firstCell ? xml.slice(firstCell[0], firstCell[1]) : '';
      if (cellXml.includes('Authorised Signatory') && signing.span[1] <= holder[0]) {
        head = head.slice(0, signing.span[0]) + head.slice(signing.span[1]);
      }
    }

    const setup = sectInPara
      ?? (lastSectEnd > 0 ? xml.slice(lastSect, lastSectEnd) : '');
    xml = head + setup + tail;
  }

  zip.file('word/document.xml', xml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) as Promise<Buffer>;
}

export { TEMPLATE_SHA256 };
