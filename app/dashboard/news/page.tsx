import { createClient } from '@/lib/supabase/server';
import { IndustryNews } from '@/components/IndustryNews';
import type { NewsItem, NewsSource, Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function NewsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user!.id).single();
  const [{ data: items }, { data: sources }] = await Promise.all([
    supabase.from('news_items').select('*').order('published_date', { ascending: false }).limit(80),
    supabase.from('news_sources').select('*').order('name'),
  ]);
  return (
    <IndustryNews
      initialItems={(items ?? []) as NewsItem[]}
      initialSources={(sources ?? []) as NewsSource[]}
      role={(profile as Profile)?.role ?? 'viewer'}
    />
  );
}
