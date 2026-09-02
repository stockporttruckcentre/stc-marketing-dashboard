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
   ============================================================= */
export default async function AnalyticsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: mayRead } = await supabase.rpc('command_may', { p_capability: 'crm.view' });
  if (mayRead !== true) redirect('/dashboard');

  return <AnalyticsHub />;
}
