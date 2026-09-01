import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { TeamPanel } from '@/components/TeamPanel';

export const dynamic = 'force-dynamic';

/* =============================================================
   The directory. Open to anybody signed in.

   Deliberately not gated. Who works here, what they look after and how
   to reach them is the noticeboard by the kettle, and a phone list
   nobody but an administrator can open is not a phone list.

   `mayManage` is asked so the page can offer a way through to the Admin
   tab, which is where roles and permissions live. Nothing on this
   screen changes anything.
   ============================================================= */
export default async function TeamDirectoryPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: mayManage } = await supabase.rpc('command_may', { p_capability: 'admin.users' });

  return <TeamPanel selfId={user.id} mayManage={mayManage === true} />;
}
