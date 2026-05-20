import { NextResponse } from 'next/server';
import { XMLParser } from 'fast-xml-parser';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Use Google News RSS - reliable, no auth, normalised XML format.
// Each feed is a search either by-site (publisher-scoped) or by-topic.
// All feeds use Google News search RSS with `when:7d` to force last-week freshness.
// Returned in reverse chronological order via the pubDate field on each item.
const FEEDS = [
  { source: 'Commercial Motor', url: 'https://news.google.com/rss/search?q=site:commercialmotor.com+when:7d&hl=en-GB&gl=GB&ceid=GB:en' },
  { source: 'Fleet News',       url: 'https://news.google.com/rss/search?q=site:fleetnews.co.uk+when:7d&hl=en-GB&gl=GB&ceid=GB:en' },
  { source: 'IRTE',             url: 'https://news.google.com/rss/search?q=site:transportengineer.org.uk+when:7d&hl=en-GB&gl=GB&ceid=GB:en' },
  { source: 'Road Transport',   url: 'https://news.google.com/rss/search?q=site:roadtransport.com+when:7d&hl=en-GB&gl=GB&ceid=GB:en' },
  { source: 'Motor Transport',  url: 'https://news.google.com/rss/search?q=site:motortransport.co.uk+when:7d&hl=en-GB&gl=GB&ceid=GB:en' },
  { source: 'Trucking',         url: 'https://news.google.com/rss/search?q=site:truckingmag.co.uk+when:7d&hl=en-GB&gl=GB&ceid=GB:en' },
  { source: 'Logistics UK',     url: 'https://news.google.com/rss/search?q=site:logistics.org.uk+when:7d&hl=en-GB&gl=GB&ceid=GB:en' },
  { source: 'RHA',              url: 'https://news.google.com/rss/search?q=site:rha.uk.net+when:7d&hl=en-GB&gl=GB&ceid=GB:en' },
];

function stripHtml(s: string) {
  return s ? s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500) : '';
}

export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const records: { title: string; source: string; url: string; summary: string | null; published_date: string; image_url: string | null; author: string | null }[] = [];
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
        const rawDesc = String(it.description?.['#text'] ?? it.description ?? it.summary?.['#text'] ?? it.summary ?? '');
        const summary = stripHtml(rawDesc);
        // Try every common RSS image location, then fall back to first <img> in description
        // We no longer use article hero images - the news cards always show the
        // per-source backdrop uploaded by the team. Keep image_url null.
        const image_url: string | null = null;
        const author: string | null = String(
          it['dc:creator']?.['#text'] ?? it['dc:creator'] ??
          it.author?.name ?? it.author?.['#text'] ?? it.author ??
          ''
        ).trim() || null;
        if (title && url) { records.push({ title, source: feed.source, url, summary: summary || null, published_date: dateStr, image_url, author }); count++; }
      }
      debug.push({ source: feed.source, status: 200, itemCount: count });
    } catch (e: any) {
      debug.push({ source: feed.source, status: 'fetch_error', itemCount: 0 });
    }
  }

  if (!records.length) {
    return NextResponse.json({ added: 0, sources: 0, debug }, { status: records.length === 0 ? 502 : 200 });
  }

  // Insert new stories - existing rows (same url) are skipped
  const { error: insErr, count: insCount } = await supabase
    .from('news_items')
    .upsert(records, { onConflict: 'url', ignoreDuplicates: true, count: 'exact' });
  if (insErr) return NextResponse.json({ error: insErr.message, debug }, { status: 500 });

  // Backfill image_url + author on previously-indexed rows that didn't have them
  let backfilled = 0;
  for (const r of records) {
    if (!r.image_url && !r.author) continue;
    const patch: Record<string, any> = {};
    if (r.image_url) patch.image_url = r.image_url;
    if (r.author)    patch.author    = r.author;
    const { error: updErr, count: updCount } = await supabase
      .from('news_items')
      .update(patch, { count: 'exact' })
      .eq('url', r.url)
      .or('image_url.is.null,author.is.null'); // only fill blanks, never overwrite
    if (!updErr && updCount) backfilled += updCount;
  }

  return NextResponse.json({
    added: insCount ?? 0,
    backfilled,
    sources: debug.filter((d) => d.itemCount > 0 && d.source !== '__og_image__').length,
    debug,
  });
}
