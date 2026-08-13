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

  const [{ data: notes }, { data: addresses }, { data: list }, { data: profile }] = await Promise.all([
    supabase.from('contact_notes').select('*').eq('contact_id', contactId).order('created_at', { ascending: false }),
    supabase.from('contact_addresses').select('*').eq('contact_id', contactId).order('is_primary', { ascending: false }),
    supabase.from('crm_lists').select('*').eq('id', (contact as any).list_id ?? '').maybeSingle(),
    supabase.from('profiles').select('full_name').eq('id', user.id).single(),
  ]);

  return buildExportModel(
    contact as CRMContact,
    (notes ?? []) as ContactNote[],
    (addresses ?? []) as ContactAddress[],
    (list ?? undefined) as CrmList | undefined,
    (profile as any)?.full_name ?? user.email ?? 'Unknown',
  );
}
