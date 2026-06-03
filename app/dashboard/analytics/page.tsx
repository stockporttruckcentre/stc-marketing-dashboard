import { createClient } from '@/lib/supabase/server';
import { AnalyticsView } from '@/components/AnalyticsView';
import type { Profile, StockTrailer, CRMContact, CrmList } from '@/lib/types';
import './analytics.css';

export const dynamic = 'force-dynamic';

async function fetchAll<T = any>(supabase: any, table: string, columns = '*'): Promise<T[]> {
  const out: T[] = [];
  const CHUNK = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + CHUNK - 1);
    if (error || !data || data.length === 0) break;
    out.push(...data);
    if (data.length < CHUNK) break;
    from += CHUNK;
    if (from > 50000) break; // safety
  }
  return out;
}


export default async function AnalyticsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [profileRes, profilesAllRes, stockAll, trackerAll, listsRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('profiles').select('id, email, full_name, role'),
    fetchAll(supabase, 'stock_trailers'),
    fetchAll(supabase, 'crm_contacts'),
    supabase.from('crm_lists').select('*'),
  ]);

  return (
    <AnalyticsView
      currentUser={(profileRes.data as Profile) ?? null}
      teamProfiles={(profilesAllRes.data ?? []) as Profile[]}
      stock={stockAll as StockTrailer[]}
      tracker={(trackerAll as CRMContact[]).filter(c => c.list_id)}
      lists={(listsRes.data ?? []) as CrmList[]}
    />
  );
}
