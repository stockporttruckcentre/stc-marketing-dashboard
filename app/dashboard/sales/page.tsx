import { createClient } from '@/lib/supabase/server';
import { TrailerSales } from '@/components/TrailerSales';
import type { Trailer, Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function SalesPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user!.id).single();
  const { data: trailers } = await supabase
    .from('trailer_sales').select('*').order('updated_at', { ascending: false });
  return <TrailerSales initialTrailers={(trailers ?? []) as Trailer[]} role={(profile as Profile)?.role ?? 'viewer'} />;
}
