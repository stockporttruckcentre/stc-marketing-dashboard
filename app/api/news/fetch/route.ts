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

// Fetch the article page and extract og:image / twitter:image.
// Strict timeout so a single slow site can't stall the whole refresh.
async function fetchHeroImage(articleUrl: string, timeoutMs = 4000): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(articleUrl, {
      signal: ctrl.signal,
      redirect: 'follow', // Google News URLs redirect to the publisher
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; STC-Dashboard/1.0; +https://stc-marketing-dashboard.vercel.app)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(tid);
    if (!res.ok) return null;
    // Read only the <head> portion - we don't need the whole page body
    const reader = res.body?.getReader();
    let html = '';
    if (reader) {
      const dec = new TextDecoder('utf-8', { fatal: false });
      const headLimit = 200_000; // 200KB is more than enough for <head>
      while (html.length < headLimit) {
        const { done, value } = await reader.read();
        if (done) break;
        html += dec.decode(value, { stream: true });
        if (html.includes('</head>')) break;
      }
      try { await reader.cancel(); } catch {}
    } else {
      html = (await res.text()).slice(0, 200_000);
    }
    // og:image — match either ordering of content/property attrs
    const og = html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i)?.[1]
            || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i)?.[1]
            || html.match(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i)?.[1]
            || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i)?.[1]
            || null;
    if (!og) return null;
    // Resolve relative URLs against the final article URL
    try { return new URL(og, res.url || articleUrl).toString(); } catch { return og; }
  } catch {
    return null;
  }
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
        const image_url: string | null = (
          it['media:thumbnail']?.['@_url'] ??
          it['media:content']?.['@_url'] ??
          it.enclosure?.['@_url'] ??
          it['itunes:image']?.['@_href'] ??
          (rawDesc.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1]) ??
          null
        );
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

  // Fetch hero images in parallel for stories that didn't already have one in the RSS.
  // Per-fetch timeout = 4s, total wall-clock ~= slowest single fetch.
  const heroResults = await Promise.allSettled(
    records.map(r => r.image_url ? Promise.resolve(r.image_url) : fetchHeroImage(r.url))
  );
  let heroCount = 0;
  heroResults.forEach((res, i) => {
    if (res.status === 'fulfilled' && res.value) {
      records[i].image_url = res.value;
      heroCount++;
    }
  });
  // @ts-ignore - augment debug shape
  debug.push({ source: '__og_image__', status: 'ok', itemCount: heroCount });

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
