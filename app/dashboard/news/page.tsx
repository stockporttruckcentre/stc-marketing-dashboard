import { createClient } from '@/lib/supabase/server';
import { IndustryNews } from '@/components/IndustryNews';
import type { NewsItem, Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function NewsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user!.id).single();
  const { data: items } = await supabase
    .from('news_items').select('*').order('published_date', { ascending: false }).limit(50);
  return <IndustryNews initialItems={(items ?? []) as NewsItem[]} role={(profile as Profile)?.role ?? 'viewer'} />;
}
