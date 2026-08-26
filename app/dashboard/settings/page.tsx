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

  /* `?tab=notifications`, so the cog in the bell and the command bar
     can land on the toggles rather than on the profile card. */
  const tab = searchParams.tab === 'notifications' ? 'notifications' : 'account';

  return <SettingsPanel profile={profile as Profile} openTab={tab} />;
}
