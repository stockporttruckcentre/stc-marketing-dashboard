/* =============================================================
   The table as a real PDF.

   Written here rather than pulled in, and that is a deliberate choice
   worth defending. This application has no PDF library, and the two
   candidates are a rendering engine (a headless browser, which is a
   second runtime to install, keep patched and hope is present on the
   server) or a document library (another dependency in a product that
   already ships four megabytes of spreadsheet and document code).

   A table of text in a base-14 font needs neither. PDF's fourteen
   standard fonts are guaranteed present in every reader and need no
   embedding, so the whole job is: lay text out at known widths, write
   the content streams, and get the cross reference table right. That is
   what this does, and it produces a file every reader opens.

   THE WIDTHS ARE REAL WIDTHS.

   `HELVETICA` below is the metric table from the standard font, not an
   average. Guessing at half an em is how columns end up overlapping in
   one reader and fine in another, and a report where two figures touch
   is a report somebody misreads.
   ============================================================= */
import { stemFor, type Artefact, type Table } from './table';

/* -------------------------------------------------------------
   Font metrics
   ------------------------------------------------------------- */

/** Helvetica advance widths, 1000 per em, for 32 to 126. */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

function charWidth(code: number): number {
  if (code >= 32 && code <= 126) return HELVETICA[code - 32];
  if (code === 0xa3) return 556;              // £
  if (code === 0xa0) return 278;              // non-breaking space
  return 556;
}

export function widthOf(text: string, size: number): number {
  let total = 0;
  for (const ch of text) total += charWidth(ch.codePointAt(0) ?? 63);
  return (total * size) / 1000;
}

/** Cut to fit, with an ellipsis, so a long note cannot run into the next column. */
function clip(text: string, size: number, max: number): string {
  if (widthOf(text, size) <= max) return text;
  let out = '';
  for (const ch of text) {
    if (widthOf(`${out}${ch}...`, size) > max) break;
    out += ch;
  }
  return `${out}...`;
}

/* -------------------------------------------------------------
   Writing the file
   ------------------------------------------------------------- */

/**
 * WinAnsi, with the two characters that break a PDF escaped.
 *
 * Anything outside the encoding becomes a question mark rather than a
 * byte the reader will misread as something else.
 */
function pdfString(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63;
    if (ch === '(' || ch === ')' || ch === '\\') out += `\\${ch}`;
    else if (code === 0xa3) out += '\\243';
    else if (code < 32) out += ' ';
    else if (code < 127) out += ch;
    else if (code === 0x2019 || code === 0x2018) out += "'";
    else if (code === 0x201c || code === 0x201d) out += '"';
    else if (code === 0x2013 || code === 0x2014) out += '-';
    else if (code < 256) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += '?';
  }
  return out;
}

const PAGE = { width: 842, height: 595, margin: 36 };   // A4 landscape, points
const SIZE = { title: 15, subtitle: 8.5, header: 7.5, body: 7.5 };
const ROW_HEIGHT = 13;

type Piece = { text: string; x: number; y: number; size: number; bold: boolean };

/**
 * Which columns fit across the page, in order.
 *
 * A selection can name more columns than a page holds. Dropping the
 * overflow would produce a file that looks complete and is not, so the
 * columns are split into groups and every group gets its own pages with
 * the same rows. The document says which columns each group holds.
 */
function columnGroups(table: Table): { indexes: number[]; widths: number[] }[] {
  const usable = PAGE.width - PAGE.margin * 2;
  const groups: { indexes: number[]; widths: number[] }[] = [];
  let current: { indexes: number[]; widths: number[] } = { indexes: [], widths: [] };
  let used = 0;

  table.columns.forEach((column, i) => {
    let widest = widthOf(column.label, SIZE.header);
    for (const row of table.rows) {
      widest = Math.max(widest, widthOf(row[i]?.text ?? '', SIZE.body));
    }
    const width = Math.min(Math.max(widest + 10, 40), 200);

    if (used + width > usable && current.indexes.length) {
      groups.push(current);
      current = { indexes: [], widths: [] };
      used = 0;
    }
    current.indexes.push(i);
    current.widths.push(width);
    used += width;
  });

  if (current.indexes.length) groups.push(current);
  return groups.length ? groups : [{ indexes: [], widths: [] }];
}

export function renderPdf(table: Table): Artefact {
  const groups = columnGroups(table);
  const pages: Piece[][] = [];

  for (const [g, group] of groups.entries()) {
    const perPage = Math.floor((PAGE.height - PAGE.margin * 2 - 70) / ROW_HEIGHT);
    const total = Math.max(Math.ceil(table.rows.length / perPage), 1);

    for (let p = 0; p < total; p++) {
      const pieces: Piece[] = [];
      let y = PAGE.height - PAGE.margin - SIZE.title;

      pieces.push({ text: table.title, x: PAGE.margin, y, size: SIZE.title, bold: true });
      y -= 16;
      const part = groups.length > 1
        ? `${table.subtitle}. Columns ${group.indexes[0] + 1} to ${group.indexes[group.indexes.length - 1] + 1} of ${table.columns.length}.`
        : table.subtitle;
      pieces.push({ text: part, x: PAGE.margin, y, size: SIZE.subtitle, bold: false });
      y -= 22;

      let x = PAGE.margin;
      group.indexes.forEach((c, i) => {
        pieces.push({
          text: clip(table.columns[c].label, SIZE.header, group.widths[i] - 6),
          x, y, size: SIZE.header, bold: true,
        });
        x += group.widths[i];
      });
      y -= ROW_HEIGHT;

      for (const row of table.rows.slice(p * perPage, (p + 1) * perPage)) {
        x = PAGE.margin;
        group.indexes.forEach((c, i) => {
          pieces.push({
            text: clip(row[c]?.text ?? '', SIZE.body, group.widths[i] - 6),
            x, y, size: SIZE.body, bold: false,
          });
          x += group.widths[i];
        });
        y -= ROW_HEIGHT;
      }

      pieces.push({
        text: `${table.count} ${table.count === 1 ? 'row' : 'rows'}.  `
          + `Page ${p + 1} of ${total}${groups.length > 1 ? `, part ${g + 1} of ${groups.length}` : ''}.`,
        x: PAGE.margin, y: PAGE.margin, size: SIZE.subtitle, bold: false,
      });

      pages.push(pieces);
    }
  }

  return assemble(pages, table.title);
}

/**
 * The file itself.
 *
 * A catalog, a page tree, two fonts and one content stream per page,
 * then a cross reference table whose offsets have to be the real byte
 * offsets of each object. Getting those wrong is the one mistake a
 * reader will not recover from.
 */
function assemble(pages: Piece[][], title: string): Artefact {
  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };

  const catalog = add('');                    // filled in once the pages are numbered
  const pageTree = add('');
  const regular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  const pageIds: number[] = [];
  for (const pieces of pages) {
    const stream = pieces.map((p) =>
      `BT /${p.bold ? 'F2' : 'F1'} ${p.size} Tf 1 0 0 1 ${p.x.toFixed(2)} ${p.y.toFixed(2)} Tm (${pdfString(p.text)}) Tj ET`,
    ).join('\n');

    const contents = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(
      `<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] `
      + `/Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${contents} 0 R >>`,
    ));
  }

  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pageTree} 0 R >>`;
  objects[pageTree - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  const parts: string[] = ['%PDF-1.4\n%âãÏÓ\n'];
  const offsets: number[] = [];
  let length = Buffer.byteLength(parts[0], 'latin1');

  objects.forEach((body, i) => {
    const text = `${i + 1} 0 obj\n${body}\nendobj\n`;
    offsets.push(length);
    parts.push(text);
    length += Buffer.byteLength(text, 'latin1');
  });

  const xref = length;
  let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) table += `${String(offset).padStart(10, '0')} 00000 n \n`;
  table += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  parts.push(table);

  return {
    filename: `${stemFor(title)}.pdf`,
    mime: 'application/pdf',
    bytes: new Uint8Array(Buffer.from(parts.join(''), 'latin1')),
  };
}
