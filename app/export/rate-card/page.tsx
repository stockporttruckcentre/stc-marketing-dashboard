import { redirect } from 'next/navigation';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

/* =============================================================
   The print view, which is now the PDF.

   From the business:

     I specifically wrote that currently you are generating a PDF that
     has a design that differs from the xlsx version and to mirror the
     xlsx version [...] it HAS to mirror it as compliance have signed
     off.

   This page used to draw the card in HTML and open the browser's print
   dialogue. That was a second design: the same figures in a layout
   nobody had signed off, and whichever route a salesman took decided
   which document a customer received.

   There is one now. `/api/rate-cards/[id]/export?format=pdf` builds the
   workbook and converts it, so the PDF is the spreadsheet. This page
   sends anybody who arrives here to that, including anything bookmarked
   from before.
   ============================================================= */
export default function RateCardPrintPage({
  searchParams,
}: { searchParams?: { card?: string } }) {
  const id = searchParams?.card;
  if (!id) notFound();
  redirect(`/api/rate-cards/${encodeURIComponent(id)}/export?format=pdf`);
}
