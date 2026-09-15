/* =============================================================
   The exported workbook against the master it was built from.

   From the business:

     the xlsx should be identical sizing/formatting to the attached.

   And from the handoff, on why that matters:

     The workbook has to be indistinguishable from the master, because
     customers compare year on year.

   "Built from a copy of the master" is a claim about a method. This is
   the claim about the RESULT, which is the one that matters: open the
   file the exporter produced beside the customer's own file and compare
   everything that is not a value.

   Run with `npm run check:rate-card-export`.
   ============================================================= */
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { buildWorkbook } from '../lib/ratecards/export-xlsx';
import { KIT_RATES, LABOUR_POOLS, FS_INCLUSIONS } from '../lib/ratecards/kit.generated';
import type { FullCard } from '../lib/ratecards/types';

const MASTER = 'docs/source/rate_cards/master/KNDS UK - Customer Rates 2026.xlsx';
const SHEET = 'Costing Info';

let bad = 0;
const ok = (what: string, held: boolean, why?: string) => {
  console.log(`  ${held ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!held) { bad += 1; if (why) console.log(`        ${why}`); }
};
const head = (s: string) => console.log(`\n  ${s}\n  ${'-'.repeat(s.length)}`);

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/* A stable rendering of a style object.

   `JSON.stringify` orders keys by insertion, and ExcelJS inserts them in
   a different order when it reads a file it wrote than when it reads the
   original. That made 774 cells look like they had changed font when not
   one of them had: same keys, same values, different order. Sorting the
   keys is the difference between comparing the style and comparing the
   serialiser. */
function stable(v: unknown): string {
  if (v === null || v === undefined) return 'none';
  if (typeof v !== 'object') return String(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  return `{${Object.keys(v as Record<string, unknown>).sort()
    .map((k) => `${k}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
}

/** A card at the kit's own rates, which is the signed KNDS card. */
function kndsCard(): FullCard {
  const rates = KIT_RATES.flatMap((r) => {
    const cols = r.axles ?? [0];
    return cols.map((axle, c) => {
      const signed = r.signed[c];
      const pool = r.pool ? LABOUR_POOLS[r.pool]! : null;
      return {
        id: `${r.id}-${axle}`, card_id: 'x', rate_id: r.id, section: r.section, item: r.item,
        axle: r.axles ? axle : 0, basis: r.basis,
        hours: r.hours?.[c] ?? null, pool: r.pool,
        amount: typeof signed === 'number' && r.basis !== 'derived' ? signed : null,
        text_value: typeof signed === 'string' ? signed : null,
        override_value: null, overridden_by: null, overridden_at: null,
        cap: r.cap, cap_by: r.capBy, position: 0,
        price: r.basis === 'derived' && r.hours ? round2(r.hours[c]! * pool!)
          : typeof signed === 'number' ? signed : null,
        price_stc: null, would_be: null, over_cap: false,
      };
    });
  });

  return {
    card: {
      id: 'x', ref: 'RC-1', contact_id: null, customer_name: 'KNDS UK',
      effective_from: '2026-09-15', good_until: '2027-09-15', status: 'draft',
      main_contact: 'Sarah Bradd', address: 'Sir Richard Fairey Road, Stockport, SK4 5DY',
      telephone: '0161 9755729', email: 'sarah.bradd@knds.co.uk',
      other_detail: null, accounts_detail: null, contract_id: 'c1', show_fleetsmart: true,
      extra_inclusions: [], owner_id: null, approved_by: null, approved_at: null,
      updated_at: new Date().toISOString(), days_old: 0, ageing: false, expired: false, editable: true,
    },
    labour: [], rates: rates as FullCard['rates'], managers: [],
    fleetsmart: {
      contract: { id: 'c1', ref: 'FS-1', plan: 'Platinum', starts_on: '2026-09-15', status: 'accepted', extras: {} },
      shown: true, extras: [],
      inclusions: FS_INCLUSIONS.map((i, n) => ({ ...i, position: n })),
    },
    parts: [], missing: [],
  };
}

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), 'rate-card-export-'));
  const out = path.join(dir, 'out.xlsx');
  writeFileSync(out, await buildWorkbook(kndsCard()));

  const master = new ExcelJS.Workbook();
  await master.xlsx.readFile(MASTER);
  const built = new ExcelJS.Workbook();
  await built.xlsx.readFile(out);

  const a = master.getWorksheet(SHEET)!;
  const b = built.getWorksheet(SHEET)!;

  head('The shape of the sheet is the master’s');
  ok('the sheet is still called what it is called', b.name === a.name);
  ok('the same number of rows and columns',
    b.rowCount === a.rowCount && b.columnCount === a.columnCount,
    `master ${a.rowCount}x${a.columnCount}, built ${b.rowCount}x${b.columnCount}`);

  const merges = (ws: ExcelJS.Worksheet) =>
    [...new Set(((ws as unknown as { _merges: Record<string, { range: string }> })._merges ?? {} as never)
      && Object.values((ws as unknown as { _merges: Record<string, { range: string }> })._merges ?? {})
        .map((m) => m.range))].sort();
  ok(`all ${merges(a).length} merged ranges survive`,
    merges(a).join('|') === merges(b).join('|'));

  const widths = (ws: ExcelJS.Worksheet) => {
    const out: string[] = [];
    ws.columns?.forEach((c, i) => { if (c.width) out.push(`${i}:${c.width}`); });
    return out.join(',');
  };
  ok('every column width survives', widths(a) === widths(b));

  const heights = (ws: ExcelJS.Worksheet) => {
    const out: string[] = [];
    for (let r = 1; r <= ws.rowCount; r += 1) {
      const h = ws.getRow(r).height;
      if (h) out.push(`${r}:${h}`);
    }
    return out.join(',');
  };
  ok('every row height survives', heights(a) === heights(b));

  ok('the logo is still in the workbook',
    built.model.media?.length === master.model.media?.length
    && (built.model.media?.length ?? 0) > 0,
    `master has ${master.model.media?.length ?? 0}, built has ${built.model.media?.length ?? 0}`);

  head('Nothing about how a cell is drawn has changed');
  {
    const differences: string[] = [];
    for (let r = 1; r <= a.rowCount; r += 1) {
      for (let c = 1; c <= a.columnCount; c += 1) {
        const x = a.getRow(r).getCell(c);
        const y = b.getRow(r).getCell(c);
        if (x.numFmt !== y.numFmt) differences.push(`${x.address} number format`);
        if (stable(x.font) !== stable(y.font)) differences.push(`${x.address} font`);
        if (stable(x.fill) !== stable(y.fill)) differences.push(`${x.address} fill`);
        if (stable(x.border) !== stable(y.border)) differences.push(`${x.address} border`);
        if (stable(x.alignment) !== stable(y.alignment)) differences.push(`${x.address} alignment`);
      }
    }
    ok('every cell keeps the master’s number format, font, fill, border and alignment',
      differences.length === 0,
      `${differences.length} difference(s), first few: ${differences.slice(0, 6).join(', ')}`);
  }

  head('And the figures are the signed KNDS card');
  {
    /* A card built at the kit's own labour rates IS the signed card, so
       every priced cell should come back the same as the master's. That
       is the end to end proof that the derivation is right: hours out
       of the model, times a labour rate, landing on the customer's own
       signed figure. */
    const differences: string[] = [];
    for (let r = 10; r <= 58; r += 1) {
      for (const col of ['C', 'D', 'E', 'F', 'G']) {
        const x = a.getCell(`${col}${r}`).value;
        const y = b.getCell(`${col}${r}`).value;
        if (typeof x === 'number' || typeof y === 'number') {
          if (x !== y) differences.push(`${col}${r}: master ${String(x)}, built ${String(y)}`);
        }
      }
    }
    ok('every priced cell matches the signed card to the penny',
      differences.length === 0,
      differences.slice(0, 8).join('\n        '));
  }

  head('The tick is the one the master uses');
  {
    const ticks: string[] = [];
    for (let r = 11; r <= 34; r += 1) {
      for (const col of ['L', 'M', 'N']) {
        const v = b.getCell(`${col}${r}`).value;
        if (v !== null && v !== '' && v !== undefined) ticks.push(String(v));
      }
    }
    ok(`${ticks.length} ticks written, and every one the letter P`,
      ticks.length > 0 && ticks.every((t) => t === 'P'),
      `found ${[...new Set(ticks)].join(', ')}`);
    ok('no Unicode checkmark anywhere in the workbook',
      !ticks.some((t) => t.includes('✓') || t.includes('✔')));
  }

  head('A card with no FleetSmart+ does not inherit the master’s');
  {
    const plain = kndsCard();
    plain.fleetsmart = { contract: null, shown: false, extras: [], inclusions: [] };
    const other = path.join(dir, 'plain.xlsx');
    writeFileSync(other, await buildWorkbook(plain));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(other);
    const ws = wb.getWorksheet(SHEET)!;

    const leftovers: string[] = [];
    for (let r = 11; r <= 34; r += 1) {
      for (const col of ['K', 'L', 'M', 'N']) {
        const v = ws.getCell(`${col}${r}`).value;
        if (v !== null && v !== '' && v !== undefined) leftovers.push(`${col}${r}=${String(v)}`);
      }
    }
    ok('the inclusions panel is empty when the card hides it',
      leftovers.length === 0, leftovers.slice(0, 6).join(', '));
    ok('and the status cell says NO rather than being left saying YES',
      ws.getCell('M6').value === 'NO', `M6 reads ${String(ws.getCell('M6').value)}`);
  }

  console.log(bad === 0
    ? '\n  The exported workbook is the customer’s own file with new values in it.\n'
    : `\n  ${bad} failed.\n`);
  process.exit(bad === 0 ? 0 : 1);
}

void main();
