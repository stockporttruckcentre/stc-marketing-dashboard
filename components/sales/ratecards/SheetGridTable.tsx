'use client';

import { useMemo } from 'react';
import { sheetGrid, WINGDINGS_TICK, SHEET_ALIGN } from '@/lib/ratecards/sheet';
import { money } from '@/lib/ratecards/format';
import type { FullCard } from '@/lib/ratecards/types';

/* =============================================================
   The rate card's grid, drawn once, for every screen that draws it.

   From the agreed development scope, Task 6:

     There is one Rate Card design. The existing Excel Rate Card is the
     authoritative design. [...] There must not remain two
     independently authored layouts that can drift.

   There were two. The in-app preview drew the master's grid. The print
   view, which is what a customer received as a PDF, rebuilt the card as
   sections and tables of its own: same figures out of `sheetWrites`,
   different document. A customer holding the spreadsheet and the PDF
   was holding two layouts of one card.

   So this is the grid, in HTML, and both draw it. The third renderer,
   `lib/ratecards/export-pdf.ts`, draws the same `sheetGrid` onto a page.
   None of the three decides what is on the card, which column it sits
   in, or what order it comes in: those are `lib/ratecards/sheet.ts`.

   What is left to the host is ink. A class name per cell and its kind
   as a data attribute, so the screen can draw it in the app's colours
   and the print view can draw it in black on white, without either one
   being able to move a value.
   ============================================================= */

export function SheetGridTable({
  card, className = 'rc-sheet', fontSize,
}: {
  card: FullCard;
  className?: string;
  /** The host's type size, because paper and a dialog want different ones. */
  fontSize?: number | string;
}) {
  const grid = useMemo(() => sheetGrid(card), [card]);
  const total = grid.columns.reduce((n, c) => n + (grid.width[c] ?? 9), 0);

  return (
    <table className={className} style={{ borderCollapse: 'collapse', width: '100%', fontSize }}>
      <colgroup>
        {grid.columns.map((c) => (
          <col key={c} style={{ width: `${((grid.width[c] ?? 9) / total) * 100}%` }} />
        ))}
      </colgroup>
      <tbody>
        {Array.from({ length: grid.rows }, (_, i) => i + 1).map((row) => (
          <tr key={row}>
            {grid.columns.map((col) => {
              const cell = grid.cells.get(`${col}${row}`);
              if (!cell) return <td key={col} data-kind="empty" />;
              const align = cell.align ?? SHEET_ALIGN[cell.kind] ?? 'left';
              return (
                <td
                  key={col}
                  title={`${col}${row}`}
                  data-kind={cell.kind}
                  style={{ textAlign: align === 'centre' ? 'center' : align }}
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
  );
}

/** How many values this card puts on the sheet, for a host that says so. */
export function sheetValueCount(card: FullCard): number {
  return sheetGrid(card).cells.size;
}
