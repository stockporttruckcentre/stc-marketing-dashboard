import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PrintableRateCard } from '@/components/sales/ratecards/PrintableRateCard';
import type { FullCard } from '@/lib/ratecards/types';

export const dynamic = 'force-dynamic';

/* =============================================================
   The printable rate card, which is how a PDF is made here.

   The same pattern the reports use, and for the same reason: there is
   no PDF renderer in this installation, and the browser's own print
   dialogue writes a better one than a library would.

   Built on the server rather than fetched by the browser, so the page
   arrives complete. A print dialogue opened over a page still waiting
   for its data prints the spinner.
   ============================================================= */
export default async function RateCardPrintPage({
  searchParams,
}: { searchParams?: { card?: string } }) {
  const id = searchParams?.card;
  if (!id) notFound();

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  /* `rate_card_read` checks `ratecard.view` inside the database, so
     this page cannot be out of step with the screen about who may see
     a card. A refusal comes back as an error, not as an empty page. */
  const { data, error } = await supabase.rpc('rate_card_read', { p_card: id });
  if (error) {
    return (
      <main style={{ padding: 40, fontFamily: 'system-ui', maxWidth: 640 }}>
        <h1 style={{ fontSize: 18 }}>This rate card will not open</h1>
        <p style={{ fontSize: 14, lineHeight: 1.6 }}>{error.message}</p>
      </main>
    );
  }
  if (!data) notFound();

  return <PrintableRateCard card={data as FullCard} />;
}
