'use client';

import { useMemo } from 'react';
import { Scrim } from './modals';
import { IClose } from './icons';
import { sheetWrites, SHEET_EXTENT, WINGDINGS_TICK } from '@/lib/ratecards/sheet';
import { money } from '@/lib/ratecards/format';
import type { FullCard } from '@/lib/ratecards/types';

/* =============================================================
   The sheet, as Excel will draw it, without leaving the application.

   From the business:

     Ensure we have a preview of the rate card - how it looks in excel -
     within the app.

   Drawn from `sheetWrites`, which is the same list of cell values the
   exporter writes into the copy of the master. That is the whole reason
   this is trustworthy: if the preview and the workbook disagreed, one
   of them would be a drawing of what somebody thought would happen.

   What it cannot show is the master's own styling, because that lives
   in the customer's file rather than in this repository. So it draws
   the grid, the addresses and the values, and says plainly that the
   borders, fonts and the logo come from the master.
   ============================================================= */

const COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'];

/* The master's own column widths, in its units, so the preview is
   proportioned like the sheet rather than evenly. Read from the file
   and quoted in the handoff: A 24.29, B 38.86, H 12.71, I 11.71,
   K 45, L 14.86, M 13.14, N 16.86. */
const WIDTH: Record<string, number> = {
  A: 24.29, B: 38.86, C: 9, D: 9, E: 9, F: 9, G: 9, H: 12.71, I: 11.71,
  J: 3, K: 45, L: 14.86, M: 13.14, N: 16.86, O: 9,
};

export function SheetPreview({ card, onClose }: { card: FullCard; onClose: () => void }) {
  const cells = useMemo(() => {
    const map = new Map<string, { value: string | number | null; kind: string }>();
    for (const w of sheetWrites(card)) map.set(w.at, { value: w.value, kind: w.kind });
    return map;
  }, [card]);

  /* The rows worth drawing: everything up to the last one with anything
     on it, so a card with no FleetSmart+ section does not scroll through
     twenty empty rows. */
  const lastRow = useMemo(() => {
    let last = 12;
    for (const at of cells.keys()) {
      const n = Number(at.replace(/^[A-Z]+/, ''));
      if (n > last) last = n;
    }
    return Math.min(SHEET_EXTENT.rows, last + 2);
  }, [cells]);

  const total = COLUMNS.reduce((n, c) => n + (WIDTH[c] ?? 9), 0);

  return (
    <Scrim onClose={onClose} label="Preview of the rate card">
      <div className="rc-4m" style={{ width: 'min(1180px, 94vw)' }}>
        <div className="rc-1n">
          <div className="rc-1o">
            <span className="rc-1p">{card.card.customer_name}, as the workbook</span>
            <span className="rc-1q">
              Every value here is the one the export writes, from the same list. The borders,
              fonts, merges and the logo come from the master workbook and are not redrawn.
            </span>
          </div>
          <button className="rc-1r" onClick={onClose} title="Close the preview"><IClose /></button>
        </div>

        <div className="rc-1s" style={{ overflow: 'auto', maxHeight: '70vh' }}>
          <table
            style={{
              borderCollapse: 'collapse', width: '100%', minWidth: 900,
              fontSize: 11.5, fontVariantNumeric: 'tabular-nums',
            }}
          >
            <colgroup>
              {COLUMNS.map((c) => (
                <col key={c} style={{ width: `${((WIDTH[c] ?? 9) / total) * 100}%` }} />
              ))}
            </colgroup>
            <tbody>
              {Array.from({ length: lastRow }, (_, i) => i + 1).map((row) => (
                <tr key={row}>
                  {COLUMNS.map((col) => {
                    const cell = cells.get(`${col}${row}`);
                    if (!cell) return <td key={col} style={cellStyle} />;
                    return (
                      <td
                        key={col}
                        title={`${col}${row}`}
                        style={{
                          ...cellStyle,
                          textAlign: cell.kind === 'money' ? 'right'
                            : cell.kind === 'tick' ? 'center' : 'left',
                          fontWeight: cell.kind === 'label' ? 700 : 400,
                          fontFamily: cell.kind === 'label' ? 'var(--panton)' : undefined,
                          color: cell.kind === 'words' ? 'var(--text-subtle)' : 'var(--text)',
                        }}
                      >
                        {cell.kind === 'money' && typeof cell.value === 'number'
                          ? money(cell.value)
                          : cell.value === WINGDINGS_TICK
                            ? <span title="Wingdings P, which is the tick in the master">&#10003;</span>
                            : String(cell.value ?? '')}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rc-1t">
          <span className="rc-y" style={{ marginRight: 'auto' }}>
            {cells.size} value{cells.size === 1 ? '' : 's'} written into a copy of the master.
            {!card.fleetsmart.shown && ' The FleetSmart+ section is hidden on this card, so its cells are left empty.'}
          </span>
          <button className="rc-27" onClick={onClose}><span>Close</span></button>
        </div>
      </div>
    </Scrim>
  );
}

const cellStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  padding: '3px 5px',
  height: 19,
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: 0,
};
