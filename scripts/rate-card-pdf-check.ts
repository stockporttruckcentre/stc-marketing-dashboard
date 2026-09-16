/* =============================================================
   The PDF is the workbook. Not a drawing of it, the file itself.

   From the business, having been sent a PDF that carried the same
   figures in a layout of its own:

     I specifically wrote that currently you are generating a PDF that
     has a design that differs from the xlsx version and to mirror the
     xlsx version, even if it's just a PNG image of it inside a pdf, i
     don't care, it HAS to mirror it as compliance have signed off.

   The check that was here asserted that every VALUE in the workbook was
   in the PDF, and it passed, and the document was still wrong. Values
   were never the question. The question was whether it is the same
   document, and that is what is asserted here:

     1. the PDF came out of LibreOffice, so it is a conversion
     2. nothing in the export path draws a PDF
     3. it has the pages the MASTER converts to, not a page count of
        somebody's choosing
     4. the master's own styling is in it: its fonts and its fills
     5. and the values are still the card's

   Points 1 to 4 are the ones that were missing. A renderer can satisfy
   5 forever while producing a document compliance never saw.

   Needs LibreOffice Calc and poppler:

     apt-get install libreoffice-calc poppler-utils

   Run with `npm run check:rate-card-pdf`.
   ============================================================= */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { buildWorkbook } from '../lib/ratecards/export-xlsx';
import { buildRateCardPdf } from '../lib/ratecards/export-pdf';
import { sheetGrid, sheetWrites, WINGDINGS_TICK } from '../lib/ratecards/sheet';
import { money } from '../lib/ratecards/format';
import type { FullCard } from '../lib/ratecards/types';
import { kndsCard } from './support/rate-card-fixture';

const MASTER = 'docs/source/rate_cards/master/KNDS UK - Customer Rates 2026.xlsx';

let bad = 0;
const ok = (what: string, held: boolean, why?: string) => {
  console.log(`  ${held ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!held) { bad += 1; if (why) console.log(`        ${why}`); }
};
const head = (s: string) => console.log(`\n  ${s}\n  ${'-'.repeat(s.length)}`);

const dir = mkdtempSync(path.join(tmpdir(), 'rate-card-pdf-check-'));

/** The words on a PDF, through poppler, laid out as the page lays them. */
function textOf(pdf: Uint8Array | string, name: string): string {
  const file = typeof pdf === 'string' ? pdf : path.join(dir, `${name}.pdf`);
  if (typeof pdf !== 'string') writeFileSync(file, Buffer.from(pdf));
  const out = path.join(dir, `${name}.txt`);
  execFileSync('pdftotext', ['-layout', file, out]);
  return readFileSync(out, 'utf8');
}

/** How many pages, read out of the file rather than counted by eye. */
function pagesOf(pdf: Uint8Array | string, name: string): number {
  const file = typeof pdf === 'string' ? pdf : path.join(dir, `${name}.pdf`);
  if (typeof pdf !== 'string') writeFileSync(file, Buffer.from(pdf));
  const info = execFileSync('pdfinfo', [file]).toString();
  return Number(/Pages:\s*(\d+)/.exec(info)?.[1] ?? 0);
}

/** Everything the file says about itself. */
function infoOf(pdf: Uint8Array, name: string): string {
  const file = path.join(dir, `${name}.pdf`);
  writeFileSync(file, Buffer.from(pdf));
  return execFileSync('pdfinfo', [file]).toString();
}

/** The fonts a PDF actually embeds, which is where a redraw gives itself away. */
function fontsOf(pdf: Uint8Array | string, name: string): string[] {
  const file = typeof pdf === 'string' ? pdf : path.join(dir, `${name}.pdf`);
  if (typeof pdf !== 'string') writeFileSync(file, Buffer.from(pdf));
  return execFileSync('pdffonts', [file]).toString()
    .split('\n').slice(2)
    .map((l) => l.trim().split(/\s+/)[0] ?? '')
    .filter(Boolean)
    .map((f) => f.replace(/^[A-Z]{6}\+/, ''));
}

/** Source with its comments taken out, so a check reads code only. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
}

/** Convert a file the way a person would, for the master's own baseline. */
function convert(file: string, name: string): string {
  const out = path.join(dir, name);
  execFileSync('soffice', [
    '--headless', '--norestore', '--invisible', '--nolockcheck',
    `-env:UserInstallation=file://${path.join(dir, `p-${name}`)}`,
    '--convert-to', 'pdf:calc_pdf_Export', '--outdir', out, file,
  ], { stdio: 'ignore' });
  const made = execFileSync('ls', [out]).toString().trim().split('\n')[0]!;
  return path.join(out, made);
}

async function main() {
  const card = kndsCard();

  head('It is a conversion, not a drawing');

  const pdf = await buildRateCardPdf(card);
  ok('the pdf says it is a pdf',
    Buffer.from(pdf.slice(0, 5)).toString() === '%PDF-');

  const info = infoOf(pdf, 'built');
  ok('and it says LibreOffice made it',
    /Producer:\s*LibreOffice/i.test(info),
    `it says: ${/Producer:.*/.exec(info)?.[0] ?? 'nothing'}`);

  /* ---- The guard that would have caught the original mistake ----

     A check of what a document CONTAINS cannot tell a conversion from a
     good enough redraw, and the redraw is what got sent. So the export
     path is read: if anything in it can draw a PDF, this fails, whatever
     the resulting document looks like. */
  {
    /* Comments first. That file explains at length what it no longer
       does, and the words 'pdf-lib' and 'drawText' are in the
       explanation. Scanning the raw text failed on its own history. */
    const src = stripComments(readFileSync('lib/ratecards/export-pdf.ts', 'utf8'));
    ok('nothing in the export path can draw a PDF',
      !/pdf-lib|pdfkit|jspdf|drawText|drawLine/i.test(src),
      'the exporter has a drawing library in it, which is how a second design gets made');
    ok('and it converts the workbook it just built',
      src.includes('buildWorkbook') && src.includes('convert-to'),
      'the PDF has to come from the same workbook the customer is sent');
  }

  head('It is the master’s own document');

  const masterPdf = convert(MASTER, 'master');
  const builtPages = pagesOf(pdf, 'built');

  /* ---- One page ----

     From the business:

       should see all rows/columns filled on the same page of the pdf,
       1 page total.

     The master carries no print setup, so converting it untouched gives
     six portrait pages with the item names on one and their prices on
     another. The copy handed to the converter asks for a single
     landscape page over a print area that stops at the last cell with
     anything in it. */
  ok('the whole card is on one page', builtPages === 1,
    `it converts to ${builtPages} pages, and the master's own ${pagesOf(masterPdf, 'master')} `
    + 'is what that looks like when the print setup is missing');

  ok('and that page is A4 landscape, so the columns are across it',
    /Page size:\s+841[.\d]*\s+x\s+59[0-9][.\d]*/.test(infoOf(pdf, 'built')),
    `it says: ${/Page size:.*/.exec(infoOf(pdf, 'built'))?.[0] ?? 'nothing'}`);

  /* The master's fonts, not a renderer's. This is the single clearest
     tell: the drawn PDF carried Helvetica and nothing else, because
     Helvetica is what pdf-lib has built in. */
  const masterFonts = new Set(fontsOf(masterPdf, 'master'));
  const builtFonts = new Set(fontsOf(pdf, 'built'));
  const missing = [...masterFonts].filter((f) => !builtFonts.has(f));
  ok(`every one of the ${masterFonts.size} fonts the master uses is in it`,
    missing.length === 0,
    `the master has ${[...masterFonts].join(', ')} and this has ${[...builtFonts].join(', ')}`);

  ok('and it brought no font of its own',
    [...builtFonts].every((f) => masterFonts.has(f)),
    `${[...builtFonts].filter((f) => !masterFonts.has(f)).join(', ')} is not in the master`);

  /* The navy section bars and the blue panel are fills in the master.
     A page with no colour on it is a page that lost them. */
  {
    const png = path.join(dir, 'page');
    writeFileSync(path.join(dir, 'built.pdf'), Buffer.from(pdf));
    execFileSync('pdftoppm', ['-r', '60', '-png', '-f', '1', '-l', '1',
      path.join(dir, 'built.pdf'), png]);
    const raw = execFileSync('pdftoppm', ['-r', '60', '-f', '1', '-l', '1',
      path.join(dir, 'built.pdf')]).toString('latin1');
    /* A PPM, so the pixels are plain bytes. Anything that is not grey is
       a colour the master put there. */
    const body = raw.slice(raw.indexOf('255\n') + 4);
    let coloured = 0;
    for (let i = 0; i + 2 < body.length; i += 3) {
      const r = body.charCodeAt(i); const g = body.charCodeAt(i + 1); const b = body.charCodeAt(i + 2);
      if (Math.abs(r - g) > 12 || Math.abs(g - b) > 12 || Math.abs(r - b) > 12) coloured += 1;
    }
    ok('the master’s fills are on the page', coloured > 2000,
      `${coloured} coloured pixels on page 1, which is a page drawn in black and white`);
  }

  head('And it is this card, not the master’s own figures');

  const xlsx = await buildWorkbook(card);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(xlsx) as unknown as ArrayBuffer);
  const sheet = book.worksheets[0]!;
  const grid = sheetGrid(card);
  const words = textOf(pdf, 'built');

  /* ---- Present, in the shape the master puts it in ----

     'Add to Truckfile?' does not appear on the page as those three
     words in a row. It is a narrow column, so the cell wraps, and the
     extracted text carries 'Add to' above the header row and
     'Truckfile?' below it.

     That is not a loss. It is what the master does: converting the
     customer's own untouched file splits it exactly the same way. So
     the master's conversion is the yardstick. A value the master keeps
     whole has to be whole here. A value the master itself breaks up may
     be broken up here too, and every word of it still has to be on the
     page. */
  const masterWords = textOf(masterPdf, 'master');
  const shown = (text: string, wanted: string) => text.includes(wanted)
    || (!masterWords.includes(wanted)
      && wanted.split(/\s+/).filter(Boolean).every((w) => text.includes(w)));

  let checked = 0;
  const gone: string[] = [];
  for (const [at, cell] of grid.cells) {
    const written = sheet.getCell(at).value;
    if (written === null || written === undefined || written === '') continue;
    const wanted = cell.kind === 'money' && typeof cell.value === 'number'
      ? money(cell.value).replace('£', '')
      : cell.value === WINGDINGS_TICK ? null
        : String(cell.value);
    if (!wanted) continue;
    checked += 1;
    if (!shown(words, wanted)) gone.push(`${at} "${wanted}"`);
  }
  ok(`all ${checked} values on the sheet are on the pages`, gone.length === 0,
    gone.slice(0, 8).join(', '));

  const priced = card.rates.filter((r) => r.price !== null);
  ok(`every one of the ${priced.length} priced rates is on the pages`,
    priced.every((r) => words.includes(money(r.price as number).replace('£', ''))),
    'a rate in the workbook and not in the PDF');

  const ticked = card.fleetsmart.inclusions.filter((i) => i.gold);
  ok(`all ${ticked.length} inclusions ticked on Gold are named`,
    ticked.every((i) => words.includes(i.inclusion.slice(0, 14))));

  head('And the workbook a customer downloads is untouched');

  /* Printing on one page is a property of the copy that goes to the
     converter. The spreadsheet a customer is sent has to stay what it
     was, because the other half of this task is that the workbook is
     indistinguishable from the master. */
  {
    const plain = new ExcelJS.Workbook();
    await plain.xlsx.load(Buffer.from(await buildWorkbook(card)) as unknown as ArrayBuffer);
    const plainSheet = plain.worksheets[0]!;

    const master = new ExcelJS.Workbook();
    await master.xlsx.readFile(MASTER);
    const masterSheet = master.getWorksheet('Costing Info')!;

    ok('the downloaded workbook has no print area of its own',
      (plainSheet.pageSetup.printArea ?? '') === (masterSheet.pageSetup.printArea ?? ''),
      `it says "${plainSheet.pageSetup.printArea ?? ''}" and the master says `
      + `"${masterSheet.pageSetup.printArea ?? ''}"`);
    ok('and is not asked to fit to a page either',
      !plainSheet.pageSetup.fitToPage === !masterSheet.pageSetup.fitToPage,
      'the customer\u2019s spreadsheet has been given a print setup the master does not have');

    const forPdf = new ExcelJS.Workbook();
    await forPdf.xlsx.load(
      Buffer.from(await buildWorkbook(card, { onOnePage: true })) as unknown as ArrayBuffer,
    );
    const pdfSheet = forPdf.worksheets[0]!;
    ok('while the copy that becomes the PDF is set to one landscape page',
      pdfSheet.pageSetup.fitToPage === true
      && pdfSheet.pageSetup.fitToWidth === 1
      && pdfSheet.pageSetup.fitToHeight === 1
      && pdfSheet.pageSetup.orientation === 'landscape',
      `fitToPage ${String(pdfSheet.pageSetup.fitToPage)}, `
      + `${String(pdfSheet.pageSetup.fitToWidth)} by ${String(pdfSheet.pageSetup.fitToHeight)}, `
      + `${String(pdfSheet.pageSetup.orientation)}`);

    /* The print area stops at the content. Running it to the master's
       full 72 rows would shrink the card to fit paper nobody needs. */
    const area = pdfSheet.pageSetup.printArea ?? '';
    const lastRow = Number(/([0-9]+)$/.exec(area)?.[1] ?? 0);
    let written = 0;
    for (const [at] of sheetGrid(card).cells) {
      written = Math.max(written, Number(at.replace(/^[A-Z]+/, '')));
    }
    ok(`the print area reaches the last row with anything on it, row ${written}`,
      lastRow >= written,
      `the print area is ${area} and there is something on row ${written}`);
  }

  head('The terms and the extra inclusions, which the scope names');

  const withTerms = kndsCard();
  withTerms.card.other_detail = 'Payment terms: 30 days from invoice';
  withTerms.card.accounts_detail = 'accounts@knds.co.uk';
  withTerms.fleetsmart.extras = [
    { inclusion: 'Loan trailer while in workshop', tiers: ['Gold', 'Platinum'] },
  ] as FullCard['fleetsmart']['extras'];

  const termsBook = new ExcelJS.Workbook();
  await termsBook.xlsx.load(Buffer.from(await buildWorkbook(withTerms)) as unknown as ArrayBuffer);
  const termsSheet = termsBook.worksheets[0]!;
  const termsWords = textOf(await buildRateCardPdf(withTerms), 'terms');

  ok('the customer term is in the workbook and on the pages',
    String(termsSheet.getCell('B7').value ?? '').includes('30 days')
    && termsWords.includes('30 days'),
    `workbook B7 "${String(termsSheet.getCell('B7').value ?? '')}"`);

  ok('and the accounts details',
    String(termsSheet.getCell('B8').value ?? '').includes('accounts@knds.co.uk')
    && termsWords.includes('accounts@knds.co.uk'));

  const extraRow = 11 + withTerms.fleetsmart.inclusions.length;
  ok('the extra inclusion is in both, and ticked on the tiers it was given',
    String(termsSheet.getCell(`K${extraRow}`).value ?? '').includes('Loan trailer')
    && termsSheet.getCell(`M${extraRow}`).value === WINGDINGS_TICK
    && termsSheet.getCell(`N${extraRow}`).value === WINGDINGS_TICK
    && termsSheet.getCell(`L${extraRow}`).value !== WINGDINGS_TICK
    && termsWords.includes('Loan trailer'),
    `workbook K${extraRow} "${String(termsSheet.getCell(`K${extraRow}`).value ?? '')}", `
    + `pdf has it: ${termsWords.includes('Loan trailer')}`);

  head('The FleetSmart+ section can be hidden, and then it is in neither');

  const hidden = kndsCard();
  (hidden.fleetsmart as { shown: boolean }).shown = false;
  const hiddenWritten = new Set(sheetWrites(hidden)
    .filter((w) => w.value !== null && w.value !== '').map((w) => w.at));
  ok('with it hidden, the workbook writes no inclusion',
    ![...hiddenWritten].some((at) => at.startsWith('K1') || at.startsWith('K2') || at.startsWith('K3')),
    'the card hides the section and the workbook writes it anyway');

  const hiddenWords = textOf(await buildRateCardPdf(hidden), 'hidden');
  ok('and none reaches the PDF',
    !hiddenWords.includes('Maintenance Scheduling'),
    'the FleetSmart+ section is hidden on the card and printed anyway');
  ok('and the rates are still all there',
    priced.every((r) => hiddenWords.includes(money(r.price as number).replace('£', ''))));

  console.log(bad === 0
    ? '\n  The PDF is the Excel rate card, converted, with the master’s own design on it.\n'
    : `\n  ${bad} failed.\n`);
  process.exit(bad === 0 ? 0 : 1);
}

void main();
