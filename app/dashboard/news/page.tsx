import { createClient } from '@/lib/supabase/server';
import { requirePage } from '@/lib/platform/permissions/page';
import { IndustryNews } from '@/components/IndustryNews';
import type { NewsItem, NewsSource, Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function NewsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user!.id).single();
  await requirePage(supabase, 'news.view', profile as { role?: string | null } | null);
  const [{ data: items }, { data: sources }] = await Promise.all([
    supabase
      .from('news_items')
      .select('*')
      .gte('published_date', new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10))
      .order('published_date', { ascending: false })
      .limit(120),
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
