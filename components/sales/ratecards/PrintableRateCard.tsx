'use client';

import { useEffect } from 'react';
import { SheetGridTable } from './SheetGridTable';
import type { FullCard } from '@/lib/ratecards/types';

/* =============================================================
   The rate card, laid out for paper.

   From the agreed development scope, Task 6:

     There is one Rate Card design. [...] There must not remain two
     independently authored layouts that can drift.

   This used to be one of the two. It read the same values out of
   `sheetWrites` and then rebuilt the card as sections and tables of its
   own: a banded rates table with an Item column and five axle columns,
   a second table for the inclusions, and a definition list for the
   contact block. Same figures, different document. A customer holding
   the spreadsheet and the PDF was holding two layouts of one card, and
   nothing stopped them drifting apart.

   It draws the sheet now, through `SheetGridTable`, which is the same
   grid `lib/ratecards/export-pdf.ts` draws on a page and the same one
   the in-app preview draws in a dialog. `lib/ratecards/sheet.ts` says
   what is on it and where. Nothing here decides anything except ink.
   ============================================================= */
export function PrintableRateCard({ card }: { card: FullCard }) {
  /* Opening the print dialogue is what somebody came here to do. Done
     after paint so the dialogue is never over a half-drawn page. */
  useEffect(() => {
    const id = window.setTimeout(() => window.print(), 350);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <main className="sheet">
      <style>{`
        @page { size: A4 landscape; margin: 10mm; }
        body { margin: 0; }
        .sheet {
          font-family: Calibri, system-ui, sans-serif;
          color: #000; padding: 8mm;
        }
        .sheet h1 { font-size: 16pt; margin: 0 0 3mm; font-weight: 700; }
        .rc-sheet { table-layout: fixed; }
        .rc-sheet td {
          border: 0.4pt solid #B9BDC6;
          padding: 0.6mm 1mm;
          height: 4.6mm;
          vertical-align: middle;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-size: 6pt;
        }
        .rc-sheet td[data-kind="label"] { font-weight: 700; }
        .rc-sheet td[data-kind="money"] { font-variant-numeric: tabular-nums; }
        .rc-sheet td[data-kind="words"] { color: #4A4F58; }
        @media print { .noprint { display: none; } }
      `}</style>

      <div className="noprint" style={{ marginBottom: 12, fontSize: 13 }}>
        Printing {card.card.ref}. Choose &ldquo;Save as PDF&rdquo; as the destination, or download
        the PDF from the rate card itself, which is built by the server and is the same sheet.
        {' '}
        <button onClick={() => window.print()} style={{ marginLeft: 8 }}>Print again</button>
      </div>

      <h1>{card.card.customer_name}</h1>
      <SheetGridTable card={card} />
    </main>
  );
}
