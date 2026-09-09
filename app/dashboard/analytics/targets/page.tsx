import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { TargetsBoard } from '@/components/analytics/TargetsBoard';

export const dynamic = 'force-dynamic';

/* =============================================================
   Targets.

   Its own screen rather than a fold on the hub, and its own capability
   rather than `crm.view`, because reading a target and setting one are
   different rights: an MD who can see he is behind should not be able
   to move the line.

   `today` comes from the server for the same reason it does on the
   hub. The financial year a target belongs to is worked out from it,
   and a machine with its clock a day out on 1 April would otherwise
   write a whole year into the wrong one.
   ============================================================= */
export default async function TargetsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: maySet } = await supabase
    .rpc('command_may', { p_capability: 'analytics.targets' });
  if (maySet !== true) redirect('/dashboard/analytics');

  return <TargetsBoard today={new Date().toISOString().slice(0, 10)} />;
}
