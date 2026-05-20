import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { MaintAccounts } from '@/components/MaintAccounts';
import type { MaintAccount, Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function MaintenancePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  const { data: rows } = await supabase
    .from('maint_accounts').select('*')
    .order('category', { ascending: true, nullsFirst: false })
    .order('company_name', { ascending: true });
  return <MaintAccounts profile={profile as Profile} initialRows={(rows ?? []) as MaintAccount[]} />;
}
