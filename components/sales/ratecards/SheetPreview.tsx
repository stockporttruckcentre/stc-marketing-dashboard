'use client';

import { Scrim } from './modals';
import { IClose } from './icons';
import { SheetGridTable, sheetValueCount } from './SheetGridTable';
import type { FullCard } from '@/lib/ratecards/types';

/* =============================================================
   The sheet, as Excel will draw it, without leaving the application.

   From the business:

     Ensure we have a preview of the rate card - how it looks in excel -
     within the app.

   It draws `SheetGridTable`, which is the same grid the exported PDF is
   drawn from and the same one the print view draws. It used to carry
   its own copy of the master's column widths and its own list of
   columns, which is how two layouts of one card start.

   What it cannot show is the master's own styling, because that lives
   in the customer's file rather than in this repository. So it draws
   the grid, the addresses and the values, and says plainly that the
   borders, fonts and the logo come from the master.
   ============================================================= */

export function SheetPreview({ card, onClose }: { card: FullCard; onClose: () => void }) {
  const values = sheetValueCount(card);

  return (
    <Scrim onClose={onClose} label="Preview of the rate card">
      <div className="rc-4m" style={{ width: 'min(1180px, 94vw)' }}>
        <div className="rc-1n">
          <div className="rc-1o">
            <span className="rc-1p">{card.card.customer_name}, as the workbook</span>
            <span className="rc-1q">
              Every value here is the one the export writes, from the same grid the PDF is drawn
              from. The borders, fonts, merges and the logo come from the master workbook and are
              not redrawn.
            </span>
          </div>
          <button className="rc-1r" onClick={onClose} title="Close the preview"><IClose /></button>
        </div>

        <div className="rc-1s" style={{ overflow: 'auto', maxHeight: '70vh' }}>
          <SheetGridTable card={card} className="rc-sheet rc-sheet--screen" fontSize={11} />
        </div>

        <div className="rc-1t">
          <span className="rc-y" style={{ marginRight: 'auto' }}>
            {values} value{values === 1 ? '' : 's'} on the sheet.
            {!card.fleetsmart.shown && ' The FleetSmart+ section is hidden on this card, so its cells are left empty.'}
          </span>
          <button className="rc-27" onClick={onClose}><span>Close</span></button>
        </div>
      </div>
    </Scrim>
  );
}
