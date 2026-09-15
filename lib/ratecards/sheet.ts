/* =============================================================
   What goes in which cell of the customer's workbook.

   ONE description, read by two things: the exporter, which writes these
   into a copy of the master, and the in-app preview, which draws them.
   Two descriptions would be two answers, and the preview would stop
   being a preview the first time one of them was edited.

   ---- Why a copy of the master, and not a generated sheet ----

   From the handoff:

     The workbook has to be indistinguishable from the master, because
     customers compare year on year. Build the export by writing cell
     values into a copy of the master, never by generating a sheet from
     scratch.

   Styles, merges, column widths, row heights, the logo drawing and the
   print area then survive, and only values change. So this module never
   describes a font or a border: it describes values and addresses, and
   the master supplies everything else.
   ============================================================= */
import { ROW_OF, SHEET_COLUMNS } from './kit.generated';
import { round2 } from './format';
import type { FullCard } from './types';

/** A value bound for one cell. */
export type CellWrite = {
  /** 'A2', 'D41' and so on. */
  at: string;
  value: string | number | null;
  /** How the preview should draw it, and nothing to do with the export. */
  kind: 'text' | 'money' | 'words' | 'tick' | 'label';
};

/* ---- The header block ----

   Addresses read out of the master: A2 the customer, C2 the effective
   date, and B3 to B8 the contact block, which is merged as B3:I6 in the
   file itself and so only the anchor is written. */
const HEAD = {
  customer: 'A2',
  effective: 'C2',
  mainContact: 'B3',
  address: 'B4',
  telephone: 'B5',
  email: 'B6',
  other: 'B7',
  accounts: 'B8',
} as const;

/* The FleetSmart+ panel, which occupies K6:N35 in the master. */
const FS = {
  statusLabel: 'K6',
  statusWord: 'L6',
  statusYesNo: 'M6',
  extrasLabel: 'L7',
  extrasYesNo: 'M7',
  firstInclusionRow: 11,
  inclusionColumn: 'K',
  tierColumns: { Silver: 'L', Gold: 'M', Platinum: 'N' },
} as const;

/** The tick in the inclusions matrix is the letter P in Wingdings. */
export const WINGDINGS_TICK = 'P';

/**
 * Every value this card puts into the workbook.
 *
 * Nothing is formatted here beyond rounding: the master's own number
 * formats turn 85 into £85.00, and a string written into a money cell
 * would defeat them. `n/a` and `TBC` stay text on purpose, because they
 * are text in the master and a zero would be a lie.
 */
export function sheetWrites(card: FullCard): CellWrite[] {
  const out: CellWrite[] = [];
  const c = card.card;

  out.push({ at: HEAD.customer, value: c.customer_name, kind: 'label' });
  out.push({
    at: HEAD.effective,
    value: `Effective from ${ordinal(c.effective_from)}`,
    kind: 'text',
  });
  out.push({ at: HEAD.mainContact, value: c.main_contact ?? '', kind: 'text' });
  out.push({ at: HEAD.address, value: c.address ?? '', kind: 'text' });
  out.push({ at: HEAD.telephone, value: c.telephone ?? '', kind: 'text' });
  out.push({ at: HEAD.email, value: c.email ?? '', kind: 'text' });
  out.push({ at: HEAD.other, value: c.other_detail ?? '', kind: 'text' });
  out.push({ at: HEAD.accounts, value: c.accounts_detail ?? '', kind: 'text' });

  /* ---- The rates ----

     One write per priced column. A rate with no price writes the words
     the card carries, which is 'TBC' or 'n/a' or nothing at all, rather
     than a zero. */
  for (const r of card.rates) {
    if (r.section === 'Parts Rates') continue;
    const row = ROW_OF[r.rate_id];
    if (!row) continue;
    const col = r.axle > 0 ? SHEET_COLUMNS.axle[r.axle - 1] : SHEET_COLUMNS.single;
    if (!col) continue;

    if (r.price !== null) {
      out.push({ at: `${col}${row}`, value: round2(r.price), kind: 'money' });
    } else if (r.text_value) {
      out.push({ at: `${col}${row}`, value: r.text_value, kind: 'words' });
    } else if (r.basis === 'tbc') {
      out.push({ at: `${col}${row}`, value: 'TBC', kind: 'words' });
    }
  }

  /* ---- Parts markup ----

     The master prints the words rather than a number, because the
     markup is agreed per customer and written as '%' or '£ + %'. */
  for (const p of card.parts) {
    const row = ROW_OF[p.rate_id];
    if (!row) continue;
    out.push({
      at: `${SHEET_COLUMNS.single}${row}`,
      value: p.text_value ?? (p.price !== null ? round2(p.price) : ''),
      kind: p.text_value ? 'words' : 'money',
    });
  }

  /* ---- The FleetSmart+ panel ----

     Written only when the card shows it. Hiding the section is
     presentational, so what changes is that these cells are cleared
     rather than that the contract is unlinked. */
  const fs = card.fleetsmart;
  const show = fs.shown && fs.contract !== null;

  out.push({ at: FS.statusLabel, value: `${c.customer_name} Contract Status`, kind: 'label' });
  out.push({ at: FS.statusWord, value: show ? 'On FleetSmart+' : '', kind: 'text' });
  out.push({ at: FS.statusYesNo, value: show ? 'YES' : 'NO', kind: 'text' });
  out.push({ at: FS.extrasLabel, value: show ? 'Extra Inclusions' : '', kind: 'text' });
  out.push({
    at: FS.extrasYesNo,
    value: show && (fs.extras?.length ?? 0) > 0 ? 'YES' : 'NO',
    kind: 'text',
  });

  const rows = show ? [...fs.inclusions.map((i) => ({
    inclusion: i.inclusion,
    tiers: [
      ...(i.silver ? ['Silver'] : []),
      ...(i.gold ? ['Gold'] : []),
      ...(i.platinum ? ['Platinum'] : []),
    ],
  })), ...(fs.extras ?? [])] : [];

  rows.forEach((row, n) => {
    const at = FS.firstInclusionRow + n;
    out.push({ at: `${FS.inclusionColumn}${at}`, value: row.inclusion, kind: 'text' });
    for (const [tier, col] of Object.entries(FS.tierColumns)) {
      out.push({
        at: `${col}${at}`,
        value: row.tiers.includes(tier) ? WINGDINGS_TICK : '',
        kind: 'tick',
      });
    }
  });

  return out;
}

/** The cells the FleetSmart+ panel occupies, for clearing when hidden. */
export function fleetsmartCells(): string[] {
  const out: string[] = [FS.statusWord, FS.statusYesNo, FS.extrasLabel, FS.extrasYesNo];
  for (let r = FS.firstInclusionRow; r <= 35; r += 1) {
    out.push(`${FS.inclusionColumn}${r}`);
    for (const col of Object.values(FS.tierColumns)) out.push(`${col}${r}`);
  }
  return out;
}

/** "15th September 2026", which is how the master writes the date. */
function ordinal(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.getDate();
  const suffix = day % 10 === 1 && day !== 11 ? 'st'
    : day % 10 === 2 && day !== 12 ? 'nd'
    : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
  return `${day}${suffix} ${d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`;
}

/** The grid the preview draws: 72 rows by 15 columns, as the master is. */
export const SHEET_EXTENT = { rows: 72, columns: 15 };
