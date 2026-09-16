import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { sheetGrid, WINGDINGS_TICK, SHEET_ALIGN } from './sheet';
import { money } from './format';
import type { FullCard } from './types';

/* =============================================================
   The rate card as a PDF, which is the workbook on a page.

   From the agreed development scope, Task 6:

     There is one Rate Card design. The existing Excel Rate Card is the
     authoritative design. The PDF must be the PDF representation of
     that same Rate Card. It must not be a separately designed "nice
     PDF".

   So this draws `sheetGrid`, the same grid the preview draws and the
   same values the workbook receives. It decides nothing about what is
   on the card, in what order, or in which column. Given the grid, the
   only thing left here is how to put ink on paper: a page size, a
   margin, and how to break a long sheet across pages.

   ---- Why not convert the workbook itself ----

   The scope prefers that, and it is right to. It needs a spreadsheet
   engine at run time, and this application deploys as a Next.js server
   with no LibreOffice behind it. A converter that works on one machine
   and fails on the deployment is worse than a renderer that works
   everywhere, so the scope's second route is the one taken: one
   canonical model, two renderers, and a parity check across them.

   What this cannot reproduce is the master's own fonts, its logo and
   its exact borders, because those live in the customer's file rather
   than in this repository. The layout, the ordering, the values, the
   ticks and the terms are the same.
   ============================================================= */

/** A4 landscape in points, which is what a wide rate card wants. */
const PAGE = { width: 841.89, height: 595.28 };
const MARGIN = 28;
const ROW_HEIGHT = 13;
const HEAD_SIZE = 12;

/* The cell's own breathing room, left and right, in points. */
const PAD = 3;

const INK = rgb(0.06, 0.09, 0.16);
const FAINT = rgb(0.45, 0.48, 0.55);
const RULE = rgb(0.80, 0.82, 0.86);

/** What a cell reads as on paper. */
function textOf(cell: { value: string | number | null; kind: string }): string {
  if (cell.value === null || cell.value === undefined || cell.value === '') return '';
  if (cell.kind === 'money' && typeof cell.value === 'number') return money(cell.value);
  /* The tick in the master is the letter P in Wingdings, which is not a
     tick in any font this has. Drawn as one. */
  if (cell.value === WINGDINGS_TICK) return 'Y';
  return String(cell.value);
}

/* ---- Characters the built in fonts cannot write ----

   Helvetica here is a standard PDF font, which carries WinAnsi and
   nothing else, and pdf-lib THROWS on a character outside it rather
   than dropping it. A customer whose name carries a Polish ł or a
   Turkish ş would have turned the whole export into a 500, and the
   person exporting would have been told the file could not be built
   with no way to find out why.

   So a character that cannot be written is written as a question mark
   and the rest of the card comes out. Cached, because the same few
   hundred characters come round for every cell on the sheet. */
const WRITABLE = new Map<string, boolean>();
function printable(text: string, font: PDFFont): string {
  let out = '';
  for (const ch of text) {
    let can = WRITABLE.get(ch);
    if (can === undefined) {
      try { font.encodeText(ch); can = true; } catch { can = false; }
      WRITABLE.set(ch, can);
    }
    out += can ? ch : '?';
  }
  return out;
}

/** Cut a string to what fits, because a sheet cell clips rather than wraps. */
function clip(text: string, font: PDFFont, size: number, room: number): string {
  if (!text) return '';
  if (font.widthOfTextAtSize(text, size) <= room) return text;
  let cut = text;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}...`, size) > room) {
    cut = cut.slice(0, -1);
  }
  return `${cut}...`;
}

/* ---- How wide a cell really is ----

   A spreadsheet cell is not a box that swallows what will not fit. Text
   runs on across its neighbours for as long as they are empty, and stops
   at the first one that has something in it. Right aligned text runs the
   other way for the same reason.

   Without this the PDF clipped at the column edge and lost the halves of
   things that Excel shows in full: 'Effective from 15th September 2026'
   came out as 'Effective from 15t...', and the FleetSmart+ inclusions,
   which sit in a 45 unit column and spill into two empty ones, lost
   their qualifiers. The check that compares the two documents read them
   as values present in the workbook and missing from the PDF, which is
   exactly what they were. */
function roomFor(
  col: string,
  row: number,
  align: 'left' | 'right' | 'centre',
  grid: { columns: readonly string[]; cells: Map<string, { value: string | number | null }> },
  widthOf: (c: string) => number,
): { room: number; left: number } {
  const i = grid.columns.indexOf(col);
  const own = widthOf(col);
  let room = own;
  let left = 0;

  const empty = (c: string) => {
    const cell = grid.cells.get(`${c}${row}`);
    return !cell || cell.value === null || cell.value === undefined || cell.value === '';
  };

  if (align !== 'right') {
    for (let n = i + 1; n < grid.columns.length && empty(grid.columns[n]!); n += 1) {
      room += widthOf(grid.columns[n]!);
    }
  }
  if (align !== 'left') {
    for (let n = i - 1; n >= 0 && empty(grid.columns[n]!); n -= 1) {
      const w = widthOf(grid.columns[n]!);
      room += w;
      left += w;
    }
  }
  return { room: room - PAD * 2, left };
}

export async function buildRateCardPdf(card: FullCard): Promise<Uint8Array> {
  const grid = sheetGrid(card);

  const pdf = await PDFDocument.create();
  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  pdf.setTitle(`${card.card.customer_name} - Customer Rates`);
  pdf.setSubject('Rate card');
  pdf.setProducer('Stockport Truck Centre');

  /* The master's column widths, scaled to the page. Proportions rather
     than points, so the card is the same shape here as on screen. */
  const usable = PAGE.width - MARGIN * 2;
  const totalUnits = grid.columns.reduce((n, c) => n + (grid.width[c] ?? 9), 0);
  const colWidth = new Map(grid.columns.map((c) => [c, ((grid.width[c] ?? 9) / totalUnits) * usable]));
  const colLeft = new Map<string, number>();
  {
    let x = MARGIN;
    for (const c of grid.columns) { colLeft.set(c, x); x += colWidth.get(c) ?? 0; }
  }
  const widthOf = (c: string) => colWidth.get(c) ?? 0;

  /* ---- The type size is read off the sheet, not chosen ----

     A column width in a workbook is counted in characters: width 9 means
     nine digits of the sheet's own font fit across it. So the size that
     makes this page behave like the sheet is the one where a digit is
     exactly one of those units wide, and it falls out of the arithmetic
     rather than being picked.

     Picked, it was 7.2, which is a fifth too big for the grid it was
     drawn on. Every three figure price overflowed its column and came
     out of the clipper as '£123....' while the workbook said £123.00. */
  const unit = usable / totalUnits;
  const FONT_SIZE = unit / body.widthOfTextAtSize('0', 1);

  const headRoom = HEAD_SIZE + 16;
  const perPage = Math.floor((PAGE.height - MARGIN * 2 - headRoom) / ROW_HEIGHT);

  let page: PDFPage | null = null;
  let top = 0;
  let onPage = 0;
  let pageNo = 0;

  const newPage = () => {
    page = pdf.addPage([PAGE.width, PAGE.height]);
    pageNo += 1;
    onPage = 0;
    top = PAGE.height - MARGIN;

    page.drawText(printable(card.card.customer_name, bold), {
      x: MARGIN, y: top - HEAD_SIZE, size: HEAD_SIZE, font: bold, color: INK,
    });
    const right = `Customer rates${pageNo > 1 ? `, page ${pageNo}` : ''}`;
    page.drawText(right, {
      x: PAGE.width - MARGIN - body.widthOfTextAtSize(right, FONT_SIZE),
      y: top - HEAD_SIZE, size: FONT_SIZE, font: body, color: FAINT,
    });
    top -= headRoom;
  };

  newPage();

  for (let row = 1; row <= grid.rows; row += 1) {
    if (onPage >= perPage) newPage();
    const y = top - onPage * ROW_HEIGHT;

    for (const col of grid.columns) {
      const cell = grid.cells.get(`${col}${row}`);
      const x = colLeft.get(col) ?? MARGIN;
      const w = colWidth.get(col) ?? 0;

      /* Every cell gets its rule, empty or not, because the grid is the
         document: a rate card with the lines missing under the empty
         cells stops looking like the sheet it is. */
      page!.drawLine({
        start: { x, y: y - ROW_HEIGHT + 2 },
        end: { x: x + w, y: y - ROW_HEIGHT + 2 },
        thickness: 0.3,
        color: RULE,
      });

      if (!cell) continue;

      const font = cell.kind === 'label' ? bold : body;
      const align = cell.align ?? SHEET_ALIGN[cell.kind] ?? 'left';
      const { room, left } = roomFor(col, row, align, grid, widthOf);

      const text = clip(printable(textOf(cell), font), font, FONT_SIZE, room);
      if (!text) continue;

      const width = font.widthOfTextAtSize(text, FONT_SIZE);
      const at = align === 'right' ? x + w - PAD - width
        : align === 'centre' ? x + (w - width) / 2
        : x - left + PAD;

      page!.drawText(text, {
        x: at,
        y: y - ROW_HEIGHT + 5,
        size: FONT_SIZE,
        font,
        color: cell.kind === 'words' ? FAINT : INK,
      });
    }

    onPage += 1;
  }

  return pdf.save();
}
