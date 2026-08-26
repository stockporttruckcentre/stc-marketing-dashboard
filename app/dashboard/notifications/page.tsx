import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { NotificationScreen } from '@/components/notifications/screen';

export const dynamic = 'force-dynamic';

/* =============================================================
   Notifications.

   Everything here is read in the browser rather than on the server,
   which is the opposite of every other screen in this application and
   is deliberate.

   The rest of them draw a table once. This one polls, marks things
   read as somebody looks at them, and answers meeting invitations in
   place, so a server rendered first paint would be a snapshot that is
   wrong within a second of arriving and would then have to be
   reconciled with the live copy. One source, from the route, is
   simpler and cannot disagree with the bell in the top bar, which
   reads the same route.

   This page therefore does one thing the client cannot: it checks
   somebody is signed in before any of it renders.
   ============================================================= */

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const tab = searchParams.tab === 'team' ? 'team'
    : searchParams.tab === 'settings' ? 'settings'
      : 'personal';

  return <NotificationScreen openTab={tab} />;
}
