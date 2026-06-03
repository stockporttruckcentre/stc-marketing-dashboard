import { createClient } from '@/lib/supabase/server';
import { AnalyticsView } from '@/components/AnalyticsView';
import type { Profile, StockTrailer, CRMContact, CrmList } from '@/lib/types';
import './analytics.css';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [profileRes, profilesAllRes, stockRes, trackerRes, listsRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('profiles').select('id, email, full_name, role'),
    supabase.from('stock_trailers').select('*'),
    supabase.from('crm_contacts').select('*').not('list_id', 'is', null),
    supabase.from('crm_lists').select('*'),
  ]);

  return (
    <AnalyticsView
      currentUser={(profileRes.data as Profile) ?? null}
      teamProfiles={(profilesAllRes.data ?? []) as Profile[]}
      stock={(stockRes.data ?? []) as StockTrailer[]}
      tracker={(trackerRes.data ?? []) as CRMContact[]}
      lists={(listsRes.data ?? []) as CrmList[]}
    />
  );
}
