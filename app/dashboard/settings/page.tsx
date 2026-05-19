import { createClient } from '@/lib/supabase/server';
import { SettingsPanel } from '@/components/SettingsPanel';
import type { Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user!.id).single();
  return <SettingsPanel profile={profile as Profile} />;
}
