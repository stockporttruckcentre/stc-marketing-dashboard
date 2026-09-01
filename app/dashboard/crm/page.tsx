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
  /* AND THE COMPANIES NOBODY FILED ANYWHERE.

     This page used to show only what the join table named, and the CRM
     came out empty on a database whose tracker was full. Every lead
     points at an account, so an account had to exist for each one, and
     none of them could be opened.

     Migration 040 says what a company on no list means, in the policy
     that decides who may read one:

       a contact with no membership rows is visible to everybody,
       exactly as a contact with no list always has been

     Only one thing was filling the join table: the trigger from 040,
     which fires on `crm_contacts.list_id`. Anything creating a company
     without setting that column, which is the import, the FleetSmart+
     builder and the tracker's new lead flow, produced a company the
     policy said everybody could see and this query fetched for nobody.

     So the fix belongs here rather than in the data. Filing them all on
     the shared pipeline was the other option and it is wrong: a company
     put on a private list is filed, and a rule that adds every new
     company to the pipeline as well publishes it. `validate-007.sql`
     says so in five assertions, which is how that version was caught.

     Unfiled companies show on the shared pipeline and only there. A
     private list stays exactly what its owner put on it. */
  let contacts: CRMContact[] = [];
  if (selectedListId) {
    const { data: onList } = await supabase
      .from('crm_list_contacts')
      .select('contact_id')
      .eq('list_id', selectedListId);

    const ids = (onList ?? []).map((r) => (r as { contact_id: string }).contact_id);
    const showingThePipeline = allLists.find((l) => l.id === selectedListId)?.is_global ?? false;

    if (showingThePipeline) {
      /* Everything the caller may read, minus anything filed on a list
         somewhere. Row level security has already decided what comes
         back, so there is no WHERE clause here restating who may see
         which customer. */
      const { data: filed } = await supabase.from('crm_list_contacts').select('contact_id');
      const filedIds = new Set((filed ?? []).map((r) => (r as { contact_id: string }).contact_id));

      const { data } = await supabase
        .from('crm_contacts')
        .select('*')
        .order('updated_at', { ascending: false });

      const onPipeline = new Set(ids);
      contacts = ((data ?? []) as CRMContact[])
        .filter((c) => onPipeline.has(c.id) || !filedIds.has(c.id));
    } else if (ids.length) {
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
