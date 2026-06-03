import { createClient } from '@/lib/supabase/server';
import { AnalyticsView } from '@/components/AnalyticsView';
import type { Profile, StockTrailer, CRMContact, CrmList } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();

  // Pull everything in parallel
  const [stockRes, trackerRes, listsRes] = await Promise.all([
    supabase.from('stock_trailers').select('*'),
    supabase.from('crm_contacts').select('*').not('list_id', 'is', null),
    supabase.from('crm_lists').select('*'),
  ]);

  return (
    <AnalyticsView
      currentUser={(profile as Profile) ?? null}
      stock={(stockRes.data ?? []) as StockTrailer[]}
      tracker={(trackerRes.data ?? []) as CRMContact[]}
      lists={(listsRes.data ?? []) as CrmList[]}
    />
  );
}
