import { createClient } from '@/lib/supabase/server';
import { CrmWorkspace } from '@/components/CrmWorkspace';
import type { CRMContact, CrmList, Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function CrmPage({ searchParams }: { searchParams: { list?: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user!.id).single();

  // Load lists the user can see
  const { data: lists } = await supabase.from('crm_lists').select('*').order('is_global', { ascending: false }).order('created_at', { ascending: true });

  // Resolve which list to show: query param, else global
  const allLists = (lists ?? []) as CrmList[];
  const selectedListId =
    searchParams.list && allLists.find((l) => l.id === searchParams.list)
      ? searchParams.list
      : allLists.find((l) => l.is_global)?.id ?? allLists[0]?.id;

  let contacts: CRMContact[] = [];
  if (selectedListId) {
    const { data } = await supabase
      .from('crm_contacts')
      .select('*')
      .eq('list_id', selectedListId)
      .order('updated_at', { ascending: false });
    contacts = (data ?? []) as CRMContact[];
  }

  // Load all profiles for share-with picker
  const { data: allProfiles } = await supabase.from('profiles').select('*');

  // Load members of all lists in one query
  const { data: members } = await supabase.from('crm_list_members').select('*');

  return (
    <CrmWorkspace
      profile={profile as Profile}
      lists={allLists}
      members={(members ?? []) as { list_id: string; user_id: string; can_edit: boolean }[]}
      profiles={(allProfiles ?? []) as Profile[]}
      selectedListId={selectedListId ?? ''}
      initialContacts={contacts}
    />
  );
}
