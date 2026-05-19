import { NextResponse } from 'next/server';
import { XMLParser } from 'fast-xml-parser';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const FEEDS = [
  { source: 'Commercial Motor', url: 'https://www.commercialmotor.com/news.xml' },
  { source: 'Fleet News',       url: 'https://www.fleetnews.co.uk/rss/news/' },
  { source: 'Transport Engineer', url: 'https://www.transportengineer.org.uk/transport-engineer-news/rss.xml' },
];

function stripHtml(s: string) {
  return s ? s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 500) : '';
}

export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parser = new XMLParser({ ignoreAttributes: false });
  const records: { title: string; source: string; url: string; summary: string | null; published_date: string }[] = [];
  let okFeeds = 0;

  for (const feed of FEEDS) {
    try {
      const res = await fetch(feed.url, { cache: 'no-store', headers: { 'User-Agent': 'STC-Dashboard/1.0' } });
      if (!res.ok) continue;
      const xml = await res.text();
      const json = parser.parse(xml);
      const items: any[] = json?.rss?.channel?.item ?? json?.feed?.entry ?? [];
      const arr = Array.isArray(items) ? items : [items];
      okFeeds++;
      for (const it of arr.slice(0, 15)) {
        const title = String(it.title?.['#text'] ?? it.title ?? '').trim();
        const url   = String(it.link?.['@_href'] ?? it.link ?? it.guid?.['#text'] ?? it.guid ?? '').trim();
        const pub   = it.pubDate ?? it.published ?? it.updated;
        const dateStr = pub ? new Date(pub).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
        const summary = stripHtml(it.description?.['#text'] ?? it.description ?? it.summary?.['#text'] ?? it.summary ?? '');
        if (title && url) records.push({ title, source: feed.source, url, summary: summary || null, published_date: dateStr });
      }
    } catch {
      // skip this feed
    }
  }

  if (!records.length) return NextResponse.json({ added: 0, sources: okFeeds });

  const { error, count } = await supabase
    .from('news_items')
    .upsert(records, { onConflict: 'url', ignoreDuplicates: true, count: 'exact' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ added: count ?? records.length, sources: okFeeds });
}
