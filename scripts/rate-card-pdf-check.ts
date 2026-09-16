/* =============================================================
   The PDF against the workbook. Same card, same figures, same order.

   From the agreed development scope, Task 6:

     A rate present in Excel but absent from PDF is a failure. An
     inclusion ticked in one and unticked in the other is a failure. A
     customer term present in one and absent in the other is a failure.

   So it builds both from one card and reads them BACK: the workbook
   through ExcelJS, the PDF by pulling its text out. Neither is trusted
   to have done what it was told.

   The comparison is of VALUES AND ORDER, not of appearance. The
   workbook carries the master's fonts, borders and logo, which live in
   the customer's file and cannot be in a PDF this draws. What must
   match is every figure, every word, every tick, and the order they
   come in.

   Run with `npm run check:rate-card-pdf`.
   ============================================================= */
import { inflateSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import { buildWorkbook } from '../lib/ratecards/export-xlsx';
import { buildRateCardPdf } from '../lib/ratecards/export-pdf';
import { sheetGrid, sheetWrites, WINGDINGS_TICK, SHEET_ALIGN } from '../lib/ratecards/sheet';
import { money } from '../lib/ratecards/format';
import { SHEET_STATIC } from '../lib/ratecards/kit.generated';
import type { FullCard } from '../lib/ratecards/types';
import type { CellWrite } from '../lib/ratecards/sheet';

let bad = 0;
const ok = (what: string, held: boolean, why?: string) => {
  console.log(`  ${held ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!held) { bad += 1; if (why) console.log(`        ${why}`); }
};
const head = (s: string) => console.log(`\n  ${s}\n  ${'-'.repeat(s.length)}`);

/* The same card `check:rate-card-export` builds, on purpose.

   Two fixtures would be two cards, and the parity this asserts would be
   between a PDF of one and a workbook of the other. Imported rather
   than copied so they cannot come apart. */
import { kndsCard } from './support/rate-card-fixture';

/**
 * Everything the PDF says, as one string.
 *
 * Read out of the FILE rather than asked of the renderer. A check that
 * asked `buildRateCardPdf` what it had drawn would be asking the thing
 * under test, and would pass on a PDF nobody could open.
 *
 * The content streams are Flate compressed, which the first version of
 * this did not allow for: it read the raw bytes, found no text, and
 * reported every single value missing. Inflated here, then the text
 * operators are pulled out of the page description.
 */
/* WinAnsi is Latin-1 except for 0x80 to 0x9F, where it carries the
   punctuation Latin-1 leaves empty. The master writes 'Loaded blocks –
   Trailers' with an en dash, pdf-lib encodes it as 0x96, and reading
   that back as a code point said the PDF had lost a value it had. */
const WIN_ANSI_HIGH: Record<number, string> = {
  0x80: '\u20AC', 0x82: '\u201A', 0x83: '\u0192', 0x84: '\u201E', 0x85: '\u2026',
  0x86: '\u2020', 0x87: '\u2021', 0x88: '\u02C6', 0x89: '\u2030', 0x8A: '\u0160',
  0x8B: '\u2039', 0x8C: '\u0152', 0x8E: '\u017D', 0x91: '\u2018', 0x92: '\u2019',
  0x93: '\u201C', 0x94: '\u201D', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014',
  0x98: '\u02DC', 0x99: '\u2122', 0x9A: '\u0161', 0x9B: '\u203A', 0x9C: '\u0153',
  0x9E: '\u017E', 0x9F: '\u0178',
};
const fromWinAnsi = (byte: number) => WIN_ANSI_HIGH[byte] ?? String.fromCharCode(byte);

function wordsFrom(pdf: Uint8Array): string[] {
  const raw = Buffer.from(pdf);
  const out: string[] = [];

  /* Every stream in the file, inflated where it will inflate. */
  const streams: Buffer[] = [];
  let at = 0;
  for (;;) {
    const open = raw.indexOf('stream', at);
    if (open < 0) break;
    let from = open + 6;
    if (raw[from] === 0x0d) from += 1;
    if (raw[from] === 0x0a) from += 1;
    const shut = raw.indexOf('endstream', from);
    if (shut < 0) break;
    const body = raw.subarray(from, shut);
    try {
      streams.push(inflateSync(body));
    } catch {
      streams.push(body);
    }
    at = shut + 9;
  }

  for (const s of streams) {
    const text = s.toString('latin1');

    /* pdf-lib writes strings as HEX, `<4B4E445320554B> Tj`, not as
       `(KNDS UK) Tj`. The first version of this looked only for the
       second shape, read nothing, and reported all 171 values missing
       from a PDF that had every one of them. Both shapes are read now,
       because a file written by another tool may use either. */
    for (const m of text.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)) {
      const hex = m[1]!.replace(/\s+/g, '');
      let word = '';
      for (let i = 0; i + 1 < hex.length; i += 2) {
        word += fromWinAnsi(parseInt(hex.slice(i, i + 2), 16));
      }
      out.push(word);
    }

    for (const m of text.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) {
      out.push(m[1]!.replace(/\\([()\\])/g, '$1'));
    }
  }
  return out;
}

/** The same, as one string, for asking whether something is on the page. */
const textFrom = (pdf: Uint8Array) => wordsFrom(pdf).join('\n');

async function main() {
  const card = kndsCard();
  const grid = sheetGrid(card);

  /* ---- How much room a cell has, in the master's own units ----

     A column width in a workbook is counted in characters, so 'room' and
     'length' are in the same units and can be compared directly. Text
     runs on across neighbours that are empty and stops at the first one
     that is not, which is what a spreadsheet does. */
  const roomInUnits = (at: string, cell: { kind: CellWrite['kind']; align?: string }) => {
    const col = at.replace(/[0-9]+$/, '');
    const row = Number(at.replace(/^[A-Z]+/, ''));
    const align = cell.align ?? SHEET_ALIGN[cell.kind] ?? 'left';
    const i = grid.columns.indexOf(col);
    const has = (c: string) => {
      const n = grid.cells.get(`${c}${row}`);
      return !!n && n.value !== null && n.value !== undefined && n.value !== '';
    };
    let units = grid.width[col] ?? 9;
    if (align !== 'right') {
      for (let n = i + 1; n < grid.columns.length && !has(grid.columns[n]!); n += 1) {
        units += grid.width[grid.columns[n]!] ?? 9;
      }
    }
    if (align !== 'left') {
      for (let n = i - 1; n >= 0 && !has(grid.columns[n]!); n -= 1) {
        units += grid.width[grid.columns[n]!] ?? 9;
      }
    }
    return units;
  };

  /* ---- Clipped, but only where the sheet itself clips ----

     'Add to Truckfile?' is 17 characters in a column with 14.71 of
     room, and Excel cuts it off too, so the PDF cutting it is the sheet
     rather than a loss.

     What is NOT faithful is cutting off something that fits, which is
     what the first version of this renderer did to every three figure
     price: £123.00 is seven characters in a column nine wide, and it
     came out '£123....'. So a value that fits has to be there in full,
     and only one that would not fit on the sheet either may arrive
     short. */
  const shown = (text: string, wanted: string, units: number) => (
    wanted.length <= units
      ? text.includes(wanted)
      : text.includes(wanted.slice(0, Math.max(1, Math.floor(units) - 4)))
  );

  const [xlsx, pdf] = await Promise.all([buildWorkbook(card), buildRateCardPdf(card)]);

  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(xlsx) as unknown as ArrayBuffer);
  const sheet = book.worksheets[0]!;

  const inPdf = textFrom(pdf);

  head('Both were built at all');
  ok('the workbook has bytes', xlsx.byteLength > 5_000, `${xlsx.byteLength} bytes`);
  ok('the pdf has bytes', pdf.byteLength > 1_000, `${pdf.byteLength} bytes`);
  ok('and the pdf says it is a pdf',
    Buffer.from(pdf.slice(0, 5)).toString() === '%PDF-', 'no PDF header');
  ok('the pdf carries text', inPdf.length > 200, `${inPdf.length} characters read back`);

  head('Every value in the workbook is in the PDF');

  let checked = 0;
  const missing: string[] = [];
  for (const [at, cell] of grid.cells) {
    const written = sheet.getCell(at).value;
    if (written === null || written === undefined || written === '') continue;

    /* What the PDF should read for this cell, by the same rules the
       renderer uses, which are the grid's rules and not its own. */
    const wanted = cell.kind === 'money' && typeof cell.value === 'number'
      ? money(cell.value)
      : cell.value === WINGDINGS_TICK ? 'Y'
      : String(cell.value);
    if (!wanted) continue;

    checked += 1;
    if (!shown(inPdf, wanted, roomInUnits(at, cell))) {
      missing.push(`${at} "${wanted}" (${roomInUnits(at, cell).toFixed(2)} units of room)`);
    }
  }

  ok(`all ${checked} written cells appear in the PDF`, missing.length === 0,
    missing.length ? `missing: ${missing.slice(0, 8).join(', ')}` : undefined);

  head('The things the scope names one at a time');

  const priced = card.rates.filter((r) => r.price !== null);
  ok(`every one of the ${priced.length} priced rates is in the PDF`,
    priced.every((r) => inPdf.includes(money(r.price as number))),
    'a rate in the workbook and not in the PDF');

  const ticked = card.fleetsmart.inclusions.filter((i) => i.gold);
  ok(`all ${ticked.length} inclusions ticked on Gold are named in the PDF`,
    ticked.every((i) => inPdf.includes(i.inclusion.slice(0, 18))));

  ok('the customer, the contact and the address are all in the PDF',
    inPdf.includes(card.card.customer_name)
    && inPdf.includes(card.card.main_contact!)
    && inPdf.includes(card.card.address!),
    `head of the card: ${inPdf.slice(0, 120).replace(/\n/g, ' | ')}`);

  /* ---- The terms and the extra inclusions ----

     The signed KNDS card carries neither: `other_detail` and
     `accounts_detail` are blank on it and it has no extras. So a card
     that DOES carry them is built from the same fixture, because the
     scope names both by name:

       An inclusion ticked in one and unticked in the other is a
       failure. A customer term present in one and absent in the other
       is a failure.

     Asserting them against a card that has neither would be a check
     that passes because there is nothing to find. */
  const withTerms = kndsCard();
  withTerms.card.other_detail = 'Payment terms: 30 days from invoice';
  withTerms.card.accounts_detail = 'accounts@knds.co.uk';
  withTerms.fleetsmart.extras = [{ inclusion: 'Loan trailer while in workshop', tiers: ['Gold', 'Platinum'] }] as FullCard['fleetsmart']['extras'];

  const termsBook = new ExcelJS.Workbook();
  await termsBook.xlsx.load(Buffer.from(await buildWorkbook(withTerms)) as unknown as ArrayBuffer);
  const termsSheet = termsBook.worksheets[0]!;
  const termsPdf = textFrom(await buildRateCardPdf(withTerms));

  ok('the customer term is in both',
    String(termsSheet.getCell('B7').value ?? '').includes('30 days')
    && termsPdf.includes('30 days'),
    `workbook B7 "${String(termsSheet.getCell('B7').value ?? '')}", pdf has 30 days: ${termsPdf.includes('30 days')}`);

  ok('and so are the accounts details',
    String(termsSheet.getCell('B8').value ?? '').includes('accounts@knds.co.uk')
    && termsPdf.includes('accounts@knds.co.uk'));

  /* The extras sit under the standard inclusions, so where they land is
     a consequence of how many there are rather than a row to write down
     here: the check would go green on a card with one more inclusion on
     it while the workbook wrote the extra somewhere else. */
  const extraRow = 11 + withTerms.fleetsmart.inclusions.length;
  ok('the extra inclusion is in both, and ticked on the tiers it was given',
    String(termsSheet.getCell(`K${extraRow}`).value ?? '').includes('Loan trailer')
    && termsSheet.getCell(`M${extraRow}`).value === WINGDINGS_TICK
    && termsSheet.getCell(`N${extraRow}`).value === WINGDINGS_TICK
    && termsSheet.getCell(`L${extraRow}`).value !== WINGDINGS_TICK
    && termsPdf.includes('Loan trailer while in workshop'),
    `workbook K${extraRow} "${String(termsSheet.getCell(`K${extraRow}`).value ?? '')}", `
    + `L "${String(termsSheet.getCell(`L${extraRow}`).value ?? '')}", `
    + `M "${String(termsSheet.getCell(`M${extraRow}`).value ?? '')}", `
    + `N "${String(termsSheet.getCell(`N${extraRow}`).value ?? '')}", `
    + `pdf has it: ${termsPdf.includes('Loan trailer while in workshop')}`);

  head('The master\'s own labels are on it, and never over a figure');

  const labelMissing = SHEET_STATIC.filter((l) => {
    const cell = grid.cells.get(l.at);
    return !cell || !shown(inPdf, l.text, roomInUnits(l.at, cell));
  });
  ok(`all ${SHEET_STATIC.length} labels the master prints are on the PDF`,
    labelMissing.length === 0,
    labelMissing.slice(0, 6).map((l) => `${l.at} "${l.text}"`).join(', '));

  /* A label sitting on an address a card writes to would put KNDS's own
     sheet furniture on top of another customer's figure, or the other
     way about. The two sets are read out of one file by one script, so
     the only thing that can put them back together is a new master with
     a different shape, and this is what would catch that. */
  {
    const everything = kndsCard();
    everything.card.other_detail = 'terms';
    everything.card.accounts_detail = 'accounts';
    everything.fleetsmart.extras = [
      { inclusion: 'One', tiers: ['Silver'] }, { inclusion: 'Two', tiers: ['Gold'] },
    ] as FullCard['fleetsmart']['extras'];
    const written = new Set(sheetWrites(everything).map((w) => w.at));
    const clash = SHEET_STATIC.filter((l) => written.has(l.at));
    ok('no label sits on an address a card writes to',
      clash.length === 0,
      clash.slice(0, 6).map((l) => `${l.at} "${l.text}"`).join(', '));
  }

  head('A character the built in fonts cannot write does not lose the card');
  {
    const odd = kndsCard();
    odd.card.customer_name = 'Wójcik Transport \u0141\u00F3d\u017A \u2192 UK';
    let built: Uint8Array | null = null;
    let why = '';
    try { built = await buildRateCardPdf(odd); } catch (e) { why = String(e); }
    ok('the PDF is still built', built !== null, why);
    const oddText = built ? textFrom(built) : '';
    ok('and every rate is still on it',
      priced.every((r) => oddText.includes(money(r.price as number))));
  }

  head('And the order is the sheet\'s order, not a new one');

  /* Every price the grid holds, in the sheet's own order: down the rows,
     and left to right across each one. The PDF draws in that order, so
     the money it puts on the page should come out as the same list.

     The first version of this looked up each value with `indexOf` and
     asked whether the positions rose. They cannot: £70.00 is on the card
     four times, and all four look up the same first occurrence. It
     reported a reordered card when nothing was out of order. Comparing
     the two lists outright is both stricter and honest about repeats. */
  const colAt = (at: string) => grid.columns.indexOf(at.replace(/[0-9]+$/, ''));
  const rowAt = (at: string) => Number(at.replace(/^[A-Z]+/, ''));

  const inSheetOrder = [...grid.cells.entries()]
    .filter(([, c]) => c.kind === 'money' && typeof c.value === 'number')
    .sort((a, b) => rowAt(a[0]) - rowAt(b[0]) || colAt(a[0]) - colAt(b[0]))
    .map(([, c]) => money(c.value as number));

  const MONEY = /^£[0-9,]+\.[0-9]{2}$/;
  const onPage = wordsFrom(pdf).filter((w) => MONEY.test(w));

  const firstDifference = inSheetOrder.findIndex((v, i) => onPage[i] !== v);
  ok(`the ${inSheetOrder.length} priced cells come out in sheet order`,
    onPage.length === inSheetOrder.length && firstDifference === -1,
    firstDifference >= 0
      ? `at position ${firstDifference} the sheet says ${inSheetOrder[firstDifference]} and the page says ${String(onPage[firstDifference])}`
      : `sheet has ${inSheetOrder.length} prices, the page has ${onPage.length}`);

  head('The FleetSmart+ section can be hidden, and then it is in neither');

  const hidden = kndsCard();
  (hidden.fleetsmart as { shown: boolean }).shown = false;
  const hiddenPdf = textFrom(await buildRateCardPdf(hidden));
  ok('with it hidden, no inclusion reaches the PDF',
    !hiddenPdf.includes('Loan trailer'),
    'the FleetSmart+ section is hidden on the card and printed anyway');
  ok('and the rates are still all there',
    priced.every((r) => hiddenPdf.includes(money(r.price as number))));

  console.log(bad === 0
    ? '\n  The PDF and the workbook are the same rate card.\n'
    : `\n  ${bad} failed.\n`);
  process.exit(bad === 0 ? 0 : 1);
}

void main();
