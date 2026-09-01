import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SettingsPanel } from '@/components/SettingsPanel';
import type { Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

const TABS = ['profile', 'password', 'appearance', 'notifications', 'access'] as const;
type Tab = (typeof TABS)[number];

/* =============================================================
   Your own account. Everybody has one, so nothing here is gated.

   `?tab=` is honoured because three other things link straight into a
   tab of this page: the cog in the notification bell, the command bar's
   `me.profile` and `me.access`, and the Team tab's "Edit my details".
   A link that lands on the wrong tab makes somebody hunt for the thing
   they just clicked towards.

   `account` is still accepted and lands on Profile. It was the name of
   this tab before the screen was rebuilt, and anything anybody has
   bookmarked or pasted into a message still says it.
   ============================================================= */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles').select('*').eq('id', user.id).single();

  const asked = searchParams.tab === 'account' ? 'profile' : searchParams.tab;
  const tab: Tab = TABS.includes(asked as Tab) ? (asked as Tab) : 'profile';

  return (
    <SettingsPanel
      profile={profile as Profile & Record<string, unknown>}
      openTab={tab}
    />
  );
}
