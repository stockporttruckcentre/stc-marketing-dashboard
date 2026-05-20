import { NextResponse } from 'next/server';
import { XMLParser } from 'fast-xml-parser';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Use Google News RSS - reliable, no auth, normalised XML format.
// Each feed is a search either by-site (publisher-scoped) or by-topic.
const FEEDS = [
  { source: 'Commercial Motor',   url: 'https://news.google.com/rss/search?q=site:commercialmotor.com&hl=en-GB&gl=GB&ceid=GB:en' },
  { source: 'Fleet News',         url: 'https://news.google.com/rss/search?q=site:fleetnews.co.uk&hl=en-GB&gl=GB&ceid=GB:en' },
  { source: 'Transport Engineer', url: 'https://news.google.com/rss/search?q=site:transportengineer.org.uk&hl=en-GB&gl=GB&ceid=GB:en' },
  { source: 'UK HGV / haulage',   url: 'https://news.google.com/rss/search?q=%22HGV%22+OR+%22haulage%22+OR+%22DVSA%22+UK&hl=en-GB&gl=GB&ceid=GB:en' },
];

function stripHtml(s: string) {
  return s ? s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500) : '';
}

export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const records: { title: string; source: string; url: string; summary: string | null; published_date: string }[] = [];
  const debug: { source: string; status: number | string; itemCount: number }[] = [];

  for (const feed of FEEDS) {
    try {
      const res = await fetch(feed.url, {
        cache: 'no-store',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; STC-Dashboard/1.0)',
          'Accept': 'application/rss+xml, application/xml, text/xml',
        },
      });
      if (!res.ok) { debug.push({ source: feed.source, status: res.status, itemCount: 0 }); continue; }
      const xml = await res.text();
      const json = parser.parse(xml);
      const itemsRaw = json?.rss?.channel?.item ?? json?.feed?.entry ?? [];
      const items: any[] = Array.isArray(itemsRaw) ? itemsRaw : [itemsRaw];
      let count = 0;
      for (const it of items.slice(0, 15)) {
        const title = String(it.title?.['#text'] ?? it.title ?? '').trim();
        const url   = String(it.link?.['@_href'] ?? it.link ?? it.guid?.['#text'] ?? it.guid ?? '').trim();
        const pub   = it.pubDate ?? it.published ?? it.updated;
        const dateStr = pub ? new Date(pub).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
        const summary = stripHtml(it.description?.['#text'] ?? it.description ?? it.summary?.['#text'] ?? it.summary ?? '');
        if (title && url) { records.push({ title, source: feed.source, url, summary: summary || null, published_date: dateStr }); count++; }
      }
      debug.push({ source: feed.source, status: 200, itemCount: count });
    } catch (e: any) {
      debug.push({ source: feed.source, status: 'fetch_error', itemCount: 0 });
    }
  }

  if (!records.length) {
    return NextResponse.json({ added: 0, sources: 0, debug }, { status: records.length === 0 ? 502 : 200 });
  }

  const { error, count } = await supabase
    .from('news_items')
    .upsert(records, { onConflict: 'url', ignoreDuplicates: true, count: 'exact' });
  if (error) return NextResponse.json({ error: error.message, debug }, { status: 500 });

  return NextResponse.json({ added: count ?? records.length, sources: debug.filter((d) => d.itemCount > 0).length, debug });
}
