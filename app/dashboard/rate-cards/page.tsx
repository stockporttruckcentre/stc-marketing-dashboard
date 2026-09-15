import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { guardRoute } from '@/lib/platform/permissions/route-guard';
import { NoAccess } from '@/components/platform/NoAccess';
import { RateCardsScreen } from '@/components/sales/ratecards/RateCardsScreen';

export const dynamic = 'force-dynamic';

/* =============================================================
   The Rate Card Builder.

   From the business:

     Add a new tab to Sales - Rate Card Builder ... These will
     self-generate when a fleetsmart+ contract is built and can be
     manually created by selecting a customer in the CRM on the Rate
     Card Builder tab.

   The door reads its requirement from `lib/nav.ts`, the same
   declaration the sidebar reads, so the row and the page cannot name
   different capabilities. See `lib/platform/permissions/route-guard.ts`
   for why that is the only shape a guard takes here.

   The four capabilities are read separately and passed down, because
   they decide what is on the screen rather than whether it opens: every
   role holds all four today, and the screen still has to disable a
   control rather than let somebody press it and be refused.
   ============================================================= */
export default async function RateCardsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const verdict = await guardRoute(supabase, '/dashboard/rate-cards');
  if (verdict.state !== 'allowed') {
    return <NoAccess verdict={verdict} page="the Rate Card Builder" />;
  }

  const [{ data: build }, { data: labour }, { data: approve }] = await Promise.all([
    supabase.rpc('command_may', { p_capability: 'ratecard.build' }),
    supabase.rpc('command_may', { p_capability: 'ratecard.labour' }),
    supabase.rpc('command_may', { p_capability: 'ratecard.approve' }),
  ]);

  return (
    /* `useSearchParams` inside the screen reads `?card=`, and Next
       requires a boundary around a client component that does. */
    <Suspense fallback={null}>
      <RateCardsScreen
        caps={{
          view: true,
          build: build === true,
          labour: labour === true,
          approve: approve === true,
        }}
      />
    </Suspense>
  );
}
