/* =============================================================
   Refreshing the industry news, in one place.

   Fetching fourteen RSS feeds and then writing what came back was the
   body of `app/api/news/fetch`, which meant the command bar could reach
   it only by somebody writing the feed list and the cutoff rule a second
   time. The list IS the operation: which publications count, how old a
   story may be, and which legacy source names get renamed.

   TWO HALVES, AND THEY ARE DIFFERENT KINDS OF THING.

     fetch    fourteen HTTP calls to somebody else's servers, each with
              its own timeout, none of which can be rolled back and none
              of which costs anything
     write    ordinary rows: sweep the stale ones, insert the new ones

   The fetch happens first and produces records. Nothing is written until
   it has, so a feed that hangs leaves the news exactly as it was.
   Unlike a Lusha lookup this costs nothing, so a failed write is
   recovered by asking again rather than by a ledger.

   Nothing here decides permission. Both callers gate on `marketing.edit`
   first, which is what the refresh button gates on: this deletes rows.
   ============================================================= */
import { XMLParser } from 'fast-xml-parser';

/**
 * Where the news comes from.
 *
 * Google News RSS: reliable, no key, normalised XML. Two queries per
 * publication, one scoped to the site and one topical, so coverage of a
 * publication elsewhere is caught as well as its own articles.
 */
export const FEEDS = [
  { source: 'Commercial Motor', url: 'https://news.google.com/rss/search?q=site:commercialmotor.com&hl=en-GB&gl=GB&ceid=GB:en' },
  { source: 'Commercial Motor', url: 'https://news.google.com/rss/search?q=%22Commercial+Motor%22+truck+UK&hl=en-GB&gl=GB&ceid=GB:en' },
  { source: 'Fleet News',       url: 'https://news.google.com/rss/search?q=site:fleetnews.co.uk&hl=en-GB&gl=GB&ceid=GB:en' },
  { source: 'Fleet News',       url: 'https://news.google.com/rss/search?q=%22Fleet+News%22+UK+fleet&hl=en-GB&gl=GB&ceid=GB:en' },
  { source: 'IRTE',             url: 'https://news.google.com/rss/search?q=site:transportengineer.org.uk&hl=en-GB&gl=GB&ceid=GB:en' },
  { source: 'IRTE',             url: 'https://news.google.com/rss/search?q=%22IRTE%22+OR+%22Transport+Engineer%22+UK&hl=en-GB&gl=GB&ceid=GB:en' },
  { source: 'Motor Transport',  url: 'https://news.google.com/rss/search?q=site:motortransport.co.uk&hl=en-GB&gl=GB&ceid=GB:en' },
  { source: 'Motor Transport',  url: 'https://news.google.com/rss/search?q=%22Motor+Transport%22+UK+logistics&hl=en-GB&gl=GB&ceid=GB:en' },
  { source: 'Trucking',         url: 'https://news.google.com/rss/search?q=site:truckingmag.co.uk&hl=en-GB&gl=GB&ceid=GB:en' },
  { source: 'Trucking',         url: 'https://news.google.com/rss/search?q=%22Trucking+magazine%22+UK&hl=en-GB&gl=GB&ceid=GB:en' },
  { source: 'Logistics UK',     url: 'https://news.google.com/rss/search?q=site:logistics.org.uk&hl=en-GB&gl=GB&ceid=GB:en' },
  { source: 'Logistics UK',     url: 'https://news.google.com/rss/search?q=%22Logistics+UK%22+OR+%22FTA%22+haulage&hl=en-GB&gl=GB&ceid=GB:en' },
  { source: 'RHA',              url: 'https://news.google.com/rss/search?q=site:rha.uk.net&hl=en-GB&gl=GB&ceid=GB:en' },
  { source: 'RHA',              url: 'https://news.google.com/rss/search?q=%22Road+Haulage+Association%22+UK&hl=en-GB&gl=GB&ceid=GB:en' },
];

/** How old a story may be and still be on the site. */
export const MAX_AGE_DAYS = 14;

export type NewsItem = {
  title: string;
  source: string;
  url: string;
  summary: string | null;
  published_date: string;
};

export type FeedReport = { source: string; status: number | string; itemCount: number };

function stripHtml(s: string) {
  return s ? s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500) : '';
}

/**
 * Everything the feeds are carrying right now.
 *
 * Each feed has its own six second ceiling and they run together, so one
 * slow publication cannot stall the batch. A feed that fails is reported
 * by name rather than dropped.
 */
export async function fetchNews(now = Date.now()): Promise<{
  records: NewsItem[]; report: FeedReport[];
}> {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const report: FeedReport[] = [];

  const fetchFeed = async (feed: { source: string; url: string }): Promise<NewsItem[]> => {
    const out: NewsItem[] = [];
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(feed.url, {
        signal: ctrl.signal,
        cache: 'no-store',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; STC-Dashboard/1.0)',
          Accept: 'application/rss+xml, application/xml, text/xml',
        },
      });
      clearTimeout(tid);
      if (!res.ok) { report.push({ source: feed.source, status: res.status, itemCount: 0 }); return out; }

      const json = parser.parse(await res.text());
      const itemsRaw = json?.rss?.channel?.item ?? json?.feed?.entry ?? [];
      const items: any[] = Array.isArray(itemsRaw) ? itemsRaw : [itemsRaw];
      let count = 0;

      for (const it of items.slice(0, 50)) {
        const title = String(it.title?.['#text'] ?? it.title ?? '').trim();
        const url = String(it.link?.['@_href'] ?? it.link ?? it.guid?.['#text'] ?? it.guid ?? '').trim();
        const pub = it.pubDate ?? it.published ?? it.updated;
        const dateObj = pub ? new Date(pub) : null;
        if (!dateObj || Number.isNaN(+dateObj)) continue;
        // A hard cutoff regardless of what the feed returned.
        if ((now - +dateObj) / 86_400_000 > MAX_AGE_DAYS) continue;

        const summary = stripHtml(String(
          it.description?.['#text'] ?? it.description ?? it.summary?.['#text'] ?? it.summary ?? '',
        ));
        if (title && url) {
          out.push({
            title, source: feed.source, url,
            summary: summary || null,
            published_date: dateObj.toISOString().slice(0, 10),
          });
          count += 1;
        }
      }
      report.push({ source: feed.source, status: 200, itemCount: count });
    } catch (e: any) {
      clearTimeout(tid);
      report.push({
        source: feed.source,
        status: e?.name === 'AbortError' ? 'timeout' : 'fetch_error',
        itemCount: 0,
      });
    }
    return out;
  };

  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  return {
    records: results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])),
    report,
  };
}

/** The narrowest slice of the client the write needs. */
type Rpc = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * What comes back, written down, in one transaction.
 *
 * `command_refresh_news` in migration 030, which the command runtime
 * reaches through its capability registry. The rename, the sweep and the
 * insert used to be four separate calls, so a failure between them could
 * leave the site with the stale stories gone and the new ones missing.
 */
export async function storeNews(
  client: Rpc, records: NewsItem[],
): Promise<{ ok: true; added: number; purged: number } | { ok: false; why: string }> {
  const { data, error } = await client.rpc('command_refresh_news', {
    p_items: records,
    p_max_age: MAX_AGE_DAYS,
  });
  if (error) return { ok: false, why: String((error as { message?: string })?.message ?? error) };

  const body = (data ?? {}) as { added?: number; purged?: number };
  return { ok: true, added: body.added ?? 0, purged: body.purged ?? 0 };
}
