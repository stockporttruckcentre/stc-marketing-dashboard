import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { sheetWrites, fleetsmartCells, WINGDINGS_TICK } from './sheet';
import type { FullCard } from './types';

/* =============================================================
   The customer's workbook, built by writing values into a copy of the
   master.

   From the business:

     the xlsx should be identical sizing/formatting to the attached.

   And from the handoff, on how to achieve that:

     Build the export by writing cell values into a copy of the master,
     never by generating a sheet from scratch. Styles, merges, column
     widths, row heights, the logo drawing and the print area then
     survive, and only values change.

   So this module opens `master/KNDS UK - Customer Rates 2026.xlsx`,
   writes the values `sheetWrites` describes, and saves. It never
   creates a sheet, never sets a font, never sets a width, and never
   sets a border. Everything that makes the file look like the
   customer's file is the customer's file.

   ---- The one thing the copy does not preserve on its own ----

   ExcelJS re-serialises the style tables when it saves, and in doing so
   drops a backslash from one number format: the master writes
   `\£#,##0.00;[Red]"-£"#,##0.00` and ExcelJS writes `£#,##0.00;...`.
   The two render identically in Excel, because the backslash escapes a
   character that needs no escaping, but "identical formatting" was
   asked for literally and the difference is cheap to undo. `restore`
   below puts the master's own format codes back into the saved file,
   matched on the code with its backslashes removed, so it repairs this
   class of difference rather than one known string.

   ---- The tick ----

   From the handoff:

     The tick in the inclusions matrix is the letter P in Wingdings, not
     a Unicode checkmark. Using a checkmark is the tell that a card was
     not generated from the master.

   The cells in the master already carry the Wingdings font, so writing
   the letter P into them is the whole of it. Nothing here sets a font.
   ============================================================= */

const MASTER = path.join(
  process.cwd(), 'docs/source/rate_cards/master/KNDS UK - Customer Rates 2026.xlsx',
);

const SHEET = 'Costing Info';

export async function buildWorkbook(card: FullCard): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(MASTER);

  const ws = wb.getWorksheet(SHEET);
  if (!ws) {
    throw new Error(
      `The master workbook has no sheet called "${SHEET}". A new master has been dropped in with a renamed tab, and the export cannot guess which one to write to.`,
    );
  }

  /* The FleetSmart+ panel is cleared first, so a card that hides it, or
     a customer with no contract, does not inherit KNDS's inclusions
     from the master. Clearing sets the value and leaves the style, so
     the panel's borders and shading stay where they are. */
  for (const at of fleetsmartCells()) ws.getCell(at).value = null;

  for (const write of sheetWrites(card)) {
    const cell = ws.getCell(write.at);
    if (write.value === null || write.value === '') { cell.value = null; continue; }
    /* A number goes in as a number so the master's own currency format
       renders it, and text goes in as text. `n/a` and `TBC` are text in
       the master and a zero would be a lie about a rate nobody has set. */
    cell.value = write.value;
  }

  const out = await wb.xlsx.writeBuffer();
  return restoreNumberFormats(Buffer.from(out));
}

/**
 * Put the master's own number format codes back.
 *
 * Matched by comparing codes with every backslash removed, so this
 * repairs any escape ExcelJS normalises away rather than one string
 * somebody noticed. A code with no counterpart in the master is left
 * exactly as written.
 */
async function restoreNumberFormats(written: Buffer): Promise<Buffer> {
  const STYLES = 'xl/styles.xml';

  const masterZip = await JSZip.loadAsync(await readFile(MASTER));
  const outZip = await JSZip.loadAsync(written);

  const masterStyles = await masterZip.file(STYLES)?.async('string');
  const outStyles = await outZip.file(STYLES)?.async('string');
  if (!masterStyles || !outStyles) return written;

  const codes = (xml: string) =>
    [...xml.matchAll(/formatCode="([^"]*)"/g)].map((m) => m[1]!);

  const bare = (code: string) => code.replace(/\\/g, '');
  const fromMaster = new Map<string, string>();
  for (const code of codes(masterStyles)) fromMaster.set(bare(code), code);

  let changed = false;
  const patched = outStyles.replace(/formatCode="([^"]*)"/g, (whole, code: string) => {
    const original = fromMaster.get(bare(code));
    if (!original || original === code) return whole;
    changed = true;
    return `formatCode="${original}"`;
  });

  if (!changed) return written;

  outZip.file(STYLES, patched);
  return outZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
