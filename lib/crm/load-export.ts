import { createClient } from '@/lib/supabase/server';
import { buildExportModel, type ExportModel } from './export-model';
import type { CRMContact, ContactNote, ContactAddress, CrmList } from '@/lib/types';

/** Everything the export needs, fetched once. Shared by the page and both file routes. */
export async function loadExportModel(contactId: string): Promise<ExportModel | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: contact } = await supabase
    .from('crm_contacts').select('*').eq('id', contactId).single();
  if (!contact) return null;

  /* Which list the export says the company is on.

     Membership is a join table now, so a company can be on more than
     one. The shared pipeline is the one worth printing: a private list
     names somebody who is not reading the export. */
  const [{ data: notes }, { data: addresses }, { data: memberships }, { data: profile }] = await Promise.all([
    supabase.from('contact_notes').select('*').eq('contact_id', contactId).order('created_at', { ascending: false }),
    supabase.from('contact_addresses').select('*').eq('contact_id', contactId).order('is_primary', { ascending: false }),
    supabase.from('crm_list_contacts').select('crm_lists(*)').eq('contact_id', contactId),
    supabase.from('profiles').select('full_name').eq('id', user.id).single(),
  ]);

  const onLists = ((memberships ?? []) as any[])
    .map((r) => r.crm_lists)
    .filter(Boolean) as CrmList[];
  const list = onLists.find((l) => l.is_global) ?? onLists[0];

  return buildExportModel(
    contact as CRMContact,
    (notes ?? []) as ContactNote[],
    (addresses ?? []) as ContactAddress[],
    list,
    (profile as any)?.full_name ?? user.email ?? 'Unknown',
  );
}
