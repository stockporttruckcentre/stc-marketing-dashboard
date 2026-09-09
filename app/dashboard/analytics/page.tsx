import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AnalyticsHub } from '@/components/AnalyticsHub';

export const dynamic = 'force-dynamic';

/* =============================================================
   Analytics.

   The screen reads its own figures rather than being handed them, which
   is a change from the old page. That one loaded every stock trailer
   and every lead into the browser and totalled them there, which was
   why it could only ever answer questions about trailer sales: the
   Protean invoices are twenty thousand rows and were never going to
   travel.

   Now the database answers, one row per division, and the page draws
   it. The same functions the Revenue screens call, so the two cannot
   disagree about what a division billed.

   ---- Today is passed in ----

   Every period on this page is worked out from one date, and that date
   comes from the server rather than from the browser. A machine with
   its clock a day out would otherwise show a different month from the
   person sitting next to it, and neither of them would know.

   The previous version of this screen is kept and reachable at
   `/dashboard/analytics/previous`. See
   `components/analytics/legacy/README.md`.
   ============================================================= */
export default async function AnalyticsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: mayRead } = await supabase.rpc('command_may', { p_capability: 'crm.view' });
  if (mayRead !== true) redirect('/dashboard');

  /* Whether the notch can be moved, asked of the same resolver every
     route and the command bar ask. A target is the line the business is
     judged against, so reading it and setting it are separate rights. */
  const { data: maySetTargets } = await supabase
    .rpc('command_may', { p_capability: 'analytics.targets' });

  return (
    <AnalyticsHub
      today={new Date().toISOString().slice(0, 10)}
      maySetTargets={maySetTargets === true}
    />
  );
}
