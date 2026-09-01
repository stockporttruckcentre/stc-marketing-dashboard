import { createClient } from '@/lib/supabase/server';
import { SettingsPanel } from '@/components/SettingsPanel';
import type { Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user!.id).single();

  /* Notifications opens first, and Profile and password stays where it
     is in the strip. The order in the tab row is what somebody scans;
     which one is open is what they land on, and those are two separate
     decisions. Notifications is the one worth landing on: it is the
     built out half of this screen.

     `?tab=account` still lands on the profile card, which is what the
     cog in the bell and the command bar rely on. */
  const tab = searchParams.tab === 'account' ? 'account' : 'notifications';

  return <SettingsPanel profile={profile as Profile} openTab={tab} />;
}
