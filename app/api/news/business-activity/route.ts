import { NextResponse } from 'next/server';
import { XMLParser } from 'fast-xml-parser';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 25;

/**
 * Company Updates — direct fetch from The Gazette (official UK statutory
 * publication for insolvency / administration / winding-up notices).
 *
 * The Gazette publishes Atom feeds at /all-notices/notice/data.feed.
 *  - categorycode-all=24  : insolvency umbrella (covers all sub-types)
 *  - results-page-size    : up to 100
 *  - order-by=publish-date-desc
 *
 * Optional transport relevance keywords boost transport / haulage notices
 * to the top, then customer matches go above those.
 */
const GAZETTE_BASE = 'https://www.thegazette.co.uk/all-notices/notice/data.feed';
const FEEDS = [
  `${GAZETTE_BASE}?categorycode-all=24&results-page-size=80&order-by=publish-date-desc`,
];

const TRANSPORT_KEYWORDS = [
  'transport', 'haulage', 'logistics', 'freight', 'trucking', 'haulier',
  'trailers', 'distribution', 'courier', 'parcels', 'fleet', 'lorry', 'lorries',
];

type Notice = {
  id: string;
  title: string;
  company: string | null;
  noticeType: string | null;
  publishedDate: string;
  url: string;
  summary: string;
  isCustomer: boolean;
  isTransport: boolean;
};

const NOISE = /\b(LIMITED|LTD|PLC|LLP|LP|GROUP|HOLDINGS|UK|COMPANY|COMPANIES|INC|CORP)\b\.?/g;
function normCo(s: string) {
  return (s || '')
    .toUpperCase()
    .replace(/^RE:\s*/i, '')
    .replace(/\([^)]*\)\s*$/g, '')
    .replace(/\bIN\s+(?:ADMINISTRATION|LIQUIDATION|RECEIVERSHIP)\b/gi, '')
    .replace(NOISE, '')
    .replace(/[,\.\(\)]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function stripHtml(s: string) {
  return (s || '').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}
function extractLink(linkField: any): string {
  if (!linkField) return '';
  const arr = Array.isArray(linkField) ? linkField : [linkField];
  for (const l of arr) {
    if (typeof l === 'string') return l;
    if (l?.['@_rel'] && l['@_rel'] !== 'alternate') continue;
    if (l?.['@_href']) return l['@_href'];
  }
  for (const l of arr) {
    if (l?.['@_href']) return l['@_href'];
    if (typeof l === 'string') return l;
  }
  return '';
}
function noticeTypeFromTitle(t: string): string | null {
  const u = (t || '').toLowerCase();
  if (u.includes('administration')) return 'Administration';
  if (u.includes('liquidat')) return 'Liquidation';
  if (u.includes('winding up') || u.includes('winding-up')) return 'Winding up';
  if (u.includes('insolven')) return 'Insolvency';
  if (u.includes('receivership')) return 'Receivership';
  if (u.includes('voluntary arrangement') || u.includes('cva')) return 'CVA';
  if (u.includes('strike off') || u.includes('struck off')) return 'Strike off';
  return null;
}

type FetchDiag = { url: string; status: number | string; bytes: number; sample: string; error?: string };
const diagnostics: FetchDiag[] = [];

async function fetchGazetteFeed(url: string, parser: XMLParser): Promise<Omit<Notice, 'isCustomer' | 'isTransport'>[]> {
  const diag: FetchDiag = { url, status: 'pending', bytes: 0, sample: '' };
  diagnostics.push(diag);
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/atom+xml, application/xml, text/xml, */*',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
      cache: 'no-store',
    });
    clearTimeout(tid);
    diag.status = res.status;
    const xml = await res.text();
    diag.bytes = xml.length;
    diag.sample = xml.slice(0, 300);
    if (!res.ok) return [];
    if (!xml || xml.length < 100) return [];

    const parsed = parser.parse(xml);
    const feed = parsed?.feed ?? parsed?.['atom:feed'] ?? parsed;
    const entryRaw = feed?.entry ?? feed?.['atom:entry'] ?? [];
    const entries: any[] = Array.isArray(entryRaw) ? entryRaw : (entryRaw ? [entryRaw] : []);

    return entries.map((e: any, i: number) => {
      const title = stripHtml(typeof e.title === 'string' ? e.title : (e.title?.['#text'] ?? ''));
      const summary = stripHtml(typeof e.summary === 'string' ? e.summary : (e.summary?.['#text'] ?? e.content?.['#text'] ?? ''));
      const link = extractLink(e.link);
      const id = String(e.id ?? link ?? `${i}`);
      const published = String(e.published ?? e.updated ?? new Date().toISOString());
      let noticeType: string | null = null;
      const cat = e.category;
      if (cat) {
        const c = Array.isArray(cat) ? cat[0] : cat;
        noticeType = c?.['@_label'] ?? c?.['@_term'] ?? null;
      }
      if (!noticeType) noticeType = noticeTypeFromTitle(title);
      return {
        id,
        title: title || 'Notice',
        company: title ? normCo(title) || null : null,
        noticeType,
        publishedDate: new Date(published).toISOString(),
        url: link.startsWith('http') ? link : (link ? `https://www.thegazette.co.uk${link}` : 'https://www.thegazette.co.uk/'),
        summary: (summary || '').slice(0, 300),
      };
    }).filter(n => n.title && n.url);
  } catch (e: any) {
    diag.status = 'error';
    diag.error = e?.message ?? String(e);
    return [];
  }
}

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  diagnostics.length = 0;
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true });
  const merged = (await Promise.all(FEEDS.map(u => fetchGazetteFeed(u, parser)))).flat();

  // Dedupe by URL
  const seen = new Set<string>();
  const uniq: typeof merged = [];
  for (const n of merged) {
    if (seen.has(n.url)) continue;
    seen.add(n.url);
    uniq.push(n);
  }

  // Customer cross-match
  const [{ data: contacts }, { data: stockCustomers }] = await Promise.all([
    supabase.from('crm_contacts').select('company_name'),
    supabase.from('stock_trailers').select('customer').not('customer', 'is', null),
  ]);
  const ourCustomers = new Set<string>();
  for (const c of contacts ?? []) {
    const n = normCo(String((c as any).company_name ?? ''));
    if (n.length >= 4) ourCustomers.add(n);
  }
  for (const s of stockCustomers ?? []) {
    const n = normCo(String((s as any).customer ?? ''));
    if (n.length >= 4) ourCustomers.add(n);
  }

  const flagged: Notice[] = uniq.map(n => {
    let isCustomer = false;
    if (n.company && n.company.length >= 4) {
      for (const c of ourCustomers) {
        if (c.length >= 4 && (n.company.includes(c) || c.includes(n.company))) { isCustomer = true; break; }
      }
    }
    const blob = `${n.title} ${n.summary}`.toLowerCase();
    const isTransport = TRANSPORT_KEYWORDS.some(k => blob.includes(k));
    return { ...n, isCustomer, isTransport };
  });

  // Customer matches first, then transport-relevant, then date desc
  flagged.sort((a, b) => {
    if (a.isCustomer !== b.isCustomer) return a.isCustomer ? -1 : 1;
    if (a.isTransport !== b.isTransport) return a.isTransport ? -1 : 1;
    return b.publishedDate.localeCompare(a.publishedDate);
  });

  return NextResponse.json({
    notices: flagged.slice(0, 60),
    matchedCount: flagged.filter(n => n.isCustomer).length,
    transportCount: flagged.filter(n => n.isTransport).length,
    totalCount: flagged.length,
    fetchedAt: new Date().toISOString(),
    source: 'thegazette.co.uk',
    diagnostics,
  });
}
