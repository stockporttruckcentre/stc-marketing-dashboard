import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SalesTracker } from '@/components/SalesTracker';
import type { CRMContact, CrmList, Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function SalesTrackerPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  const p = profile as Profile;
  const firstName = (p?.full_name ?? user.email?.split('@')[0] ?? 'My').split(' ')[0];
  const trackerName = `${firstName}'s Sales tracker`;

  // Auto-create the user's personal sales tracker list if not present
  const { data: existing } = await supabase
    .from('crm_lists').select('*')
    .eq('owner_id', user.id).eq('is_global', false).ilike('name', '%Sales tracker%')
    .limit(1).maybeSingle();
  let list: CrmList = existing as CrmList;
  if (!list) {
    const { data: created } = await supabase.from('crm_lists').insert({
      name: trackerName, owner_id: user.id, is_global: false, color: '#cf2417',
      description: 'Personal sales pipeline - only you see this list',
    }).select('*').single();
    list = created as CrmList;
  }

  const { data: contacts } = await supabase
    .from('crm_contacts').select('*').eq('list_id', list.id)
    .order('date_of_enquiry', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  return (
    <SalesTracker
      list={list}
      initialContacts={(contacts ?? []) as CRMContact[]}
      profile={p}
    />
  );
}
