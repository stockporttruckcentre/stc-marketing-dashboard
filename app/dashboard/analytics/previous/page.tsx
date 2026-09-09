import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AnalyticsHub } from '@/components/analytics/legacy/AnalyticsHub';

export const dynamic = 'force-dynamic';

/* =============================================================
   The Analytics page as it stood before the rebuild.

   Kept reachable rather than only kept in git, because the business
   asked for a backup and a backup nobody can open is a diff. This is
   the old screen, running, so it can be put beside the new one.

   Not in the sidebar and not in the command bar: it is a reference, not
   a feature, and two Analytics rows would be a question rather than a
   convenience. `components/analytics/legacy/README.md` says how to make
   it the live page again if the new one turns out to be worse.

   Same capability as the real page. A screen that is off the sidebar is
   still a screen, and the figures on it are the same figures.
   ============================================================= */
export default async function PreviousAnalyticsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: mayRead } = await supabase.rpc('command_may', { p_capability: 'crm.view' });
  if (mayRead !== true) redirect('/dashboard');

  return <AnalyticsHub />;
}
