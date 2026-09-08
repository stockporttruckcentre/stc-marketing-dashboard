import { revenueScreen } from '@/app/dashboard/revenue/screen';

export const dynamic = 'force-dynamic';

/* =============================================================
   Trailer sales revenue.

   From the business:

     Split rental from S&L tab on Revenue tab ... tabs should be STC,
     Trailer Sales, Rentals. Rename S&L to Trailer Sales. Add Rentals.

   The division has existed in `divisions` since migration 083 and was
   the case migration 093 said would come:

     There may be a third row for trailer sales later, which is a row
     and a page and nothing here has to move for it.

   This is that page. The screen is the same one both other divisions
   use, so nothing about how revenue is read had to change: it takes a
   slug and a name and asks the same questions of the same tables.
   ============================================================= */
export default function TrailerRevenuePage() {
  return revenueScreen('trailer', 'Trailer Sales');
}
