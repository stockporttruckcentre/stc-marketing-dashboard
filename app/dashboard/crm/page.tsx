import { createClient } from '@/lib/supabase/server';
import { CrmListRestore } from '@/components/CrmListRestore';
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

  /* WHICH COMPANIES ARE ON THIS LIST.

     Through the join table rather than `crm_contacts.list_id`. A company
     belonged to exactly one list while membership was a column, which is
     why the same firm had to exist once per list it appeared on and why
     the pipeline and somebody's tracker held different Dawsons.

     A company on the pipeline and on three trackers is one company now,
     and it shows on all four. */
  let contacts: CRMContact[] = [];
  if (selectedListId) {
    const { data: onList } = await supabase
      .from('crm_list_contacts')
      .select('contact_id')
      .eq('list_id', selectedListId);

    const ids = (onList ?? []).map((r) => (r as { contact_id: string }).contact_id);
    if (ids.length) {
      const { data } = await supabase
        .from('crm_contacts')
        .select('*')
        .in('id', ids)
        .order('updated_at', { ascending: false });
      contacts = (data ?? []) as CRMContact[];
    }
  }

  // Load all profiles for share-with picker
  const { data: allProfiles } = await supabase.from('profiles').select('*');

  // Load members of all lists in one query
  const { data: members } = await supabase.from('crm_list_members').select('*');

  return (
    <>
      <CrmListRestore />
      <CrmWorkspace
      profile={profile as Profile}
      lists={allLists}
      members={(members ?? []) as { list_id: string; user_id: string; can_edit: boolean }[]}
      profiles={(allProfiles ?? []) as Profile[]}
      selectedListId={selectedListId ?? ''}
      initialContacts={contacts}
    />
    </>
  );
}
