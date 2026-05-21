import { createClient } from '@/lib/supabase/server';
import { StockList } from '@/components/StockList';
import type { StockTrailer, Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function StockPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user!.id).single();
  // Sold list is huge (~1300 rows). Cap initial load; client can paginate later if needed.
  const { data: rows } = await supabase
    .from('stock_trailers')
    .select('*')
    .order('status', { ascending: true })
    .order('category', { ascending: true })
    .order('stc_no', { ascending: true })
    .limit(2000);
  return <StockList initialRows={(rows ?? []) as StockTrailer[]} role={(profile as Profile)?.role ?? 'viewer'} />;
}
