import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PipelineDrillDown } from '@/components/analytics/drilldowns/pipeline';

export const dynamic = 'force-dynamic';

/* =============================================================
   Sales and pipeline, one of the six drill-downs.

   The landing answers how the company is doing. This answers why.
   Same guard as the landing, same engine, same period controls, and
   the analytical devices moved here rather than rebuilt.
   ============================================================= */
export default async function Page() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: mayRead } = await supabase.rpc('command_may', { p_capability: 'crm.view' });
  if (mayRead !== true) redirect('/dashboard');

  return <PipelineDrillDown today={new Date().toISOString().slice(0, 10)} />;
}
