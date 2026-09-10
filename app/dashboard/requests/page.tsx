import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AccessRequests } from '@/components/permissions/requests';

export const dynamic = 'force-dynamic';

/* =============================================================
   Access requests.

   Deliberately not gated on a capability. Everybody who can ask for
   something can see what they have asked for, and asking is
   `access.request`, which every one of the eleven roles holds.

   Deciding is the part that is gated, and it is gated inside the
   database: `decide_capability_request` refuses anybody who does not
   hold `access.decide` and does not run the department the person
   asking works in. `mayDecide` below only decides whether to draw the
   panel.

   ---- Why this is not part of the Admin screen ----

   Sr Sales decides for their own salespeople and holds no
   administrative capability at all, which is right: running a
   department is not the same as being able to edit accounts. The Admin
   tab is gated on `admin.users` and would refuse them, so a
   notification pointing there would point somewhere the recipient
   cannot open.
   ============================================================= */
export default async function RequestsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: mayDecide } = await supabase.rpc('command_may', { p_capability: 'access.decide' });

  return <AccessRequests selfId={user.id} mayDecide={mayDecide === true} />;
}
