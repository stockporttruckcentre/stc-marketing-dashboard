import { createClient } from '@/lib/supabase/server';
import { CrmGrid } from '@/components/CrmGrid';
import type { CRMContact, Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function CrmPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: contacts } = await supabase
    .from('crm_contacts')
    .select('*')
    .order('updated_at', { ascending: false });
  const { data: profile } = await supabase
    .from('profiles').select('*').eq('id', user!.id).single();

  return (
    <CrmGrid
      initialContacts={(contacts ?? []) as CRMContact[]}
      role={(profile as Profile)?.role ?? 'viewer'}
    />
  );
}
