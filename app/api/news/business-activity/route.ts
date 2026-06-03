import { NextResponse } from 'next/server';
import { XMLParser } from 'fast-xml-parser';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;
export const revalidate = 600;

/**
 * The Gazette - Atom feed for insolvency notices.
 * Documented URL pattern: /all-notices/notice/data.feed
 * Category codes (categorycode-all):
 *   24    Insolvency (covers admin / CVL / winding-up / receivers etc)
 *   2402  Companies winding-up
 *   2410  Companies administrations
 * Pass results-page-size and order-by=publish-date-desc.
 *
 * We use the umbrella category (24) so the team sees ALL insolvency activity,
 * then we surface notices matching our customers at the top.
 */
const GAZETTE_FEED_URL =
  'https://www.thegazette.co.uk/all-notices/notice/data.feed' +
  '?categorycode-all=24' +
  '&results-page-size=40' +
  '&order-by=publish-date-desc';

type Notice = {
  id: string;
  title: string;
  company: string | null;
  noticeType: string | null;
  publishedDate: string;
  url: string;
  summary: string;
  isCustomer: boolean;
};

const NOISE_WORDS_RE = /\b(LIMITED|LTD|PLC|LLP|LP|GROUP|HOLDINGS|UK|COMPANY|COMPANIES|INC|CORP)\b\.?/g;
function normaliseCo(s: string): string {
  return s
    .toUpperCase()
    .replace(/^RE:\s*/i, '')
    .replace(/\([^)]*\)\s*$/g, '')
    .replace(/\bIN\s+(?:ADMINISTRATION|LIQUIDATION|RECEIVERSHIP)\b/gi, '')
    .replace(NOISE_WORDS_RE, '')
    .replace(/[,\.\(\)]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtml(s: string) {
  return s ? s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim() : '';
}

// Atom link can be a single object, array, or string. Find the canonical web link.
function extractLink(linkField: any): string {
  if (!linkField) return '';
  const arr = Array.isArray(linkField) ? linkField : [linkField];
  // Prefer rel="alternate" or no rel; fall back to first href
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

function extractText(field: any): string {
  if (!field) return '';
  if (typeof field === 'string') return field;
  if (typeof field === 'object') {
    return field['#text'] ?? field['_'] ?? '';
  }
  return String(field);
}

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let xml = '';
  let fetchStatus: number = 0;
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 9000);
    const res = await fetch(GAZETTE_FEED_URL, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'STC Marketing Dashboard',
        'Accept': 'application/atom+xml, application/xml, text/xml, */*',
      },
      next: { revalidate: 600 },
    });
    clearTimeout(tid);
    fetchStatus = res.status;
    if (!res.ok) {
      return NextResponse.json({ notices: [], matchedCount: 0, totalCount: 0, error: `Gazette HTTP ${res.status}` });
    }
    xml = await res.text();
  } catch (e: any) {
    return NextResponse.json({ notices: [], matchedCount: 0, totalCount: 0, error: e?.message ?? 'fetch error' });
  }

  if (!xml || xml.length < 50) {
    return NextResponse.json({ notices: [], matchedCount: 0, totalCount: 0, error: 'empty feed', fetchStatus });
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: false,
    trimValues: true,
  });
  let parsed: any;
  try {
    parsed = parser.parse(xml);
  } catch (e: any) {
    return NextResponse.json({ notices: [], error: 'XML parse failed: ' + (e?.message ?? ''), fetchStatus });
  }

  const feed = parsed?.feed ?? parsed?.['atom:feed'] ?? parsed;
  const entryRaw = feed?.entry ?? feed?.['atom:entry'] ?? [];
  const entries: any[] = Array.isArray(entryRaw) ? entryRaw : (entryRaw ? [entryRaw] : []);

  const notices: Omit<Notice, 'isCustomer'>[] = entries.map((e: any, i: number) => {
    const titleRaw = stripHtml(extractText(e.title));
    const summary = stripHtml(extractText(e.summary) || extractText(e.content));
    const link = extractLink(e.link) || '';
    // Many Gazette IDs are URNs like urn:uuid:... — fall back to link
    const id = String(extractText(e.id) || link || `entry-${i}`);
    const published = extractText(e.published) || extractText(e.updated) || extractText(e['atom:published']) || new Date().toISOString();
    // Notice type can be in <category term="..." label="...">
    let noticeType: string | null = null;
    const cat = e.category;
    if (cat) {
      const c = Array.isArray(cat) ? cat[0] : cat;
      noticeType = c?.['@_label'] ?? c?.['@_term'] ?? null;
    }
    return {
      id,
      title: titleRaw || 'Notice',
      company: titleRaw ? normaliseCo(titleRaw) || null : null,
      noticeType,
      publishedDate: published,
      url: link.startsWith('http') ? link : (link ? `https://www.thegazette.co.uk${link}` : 'https://www.thegazette.co.uk/'),
      summary: (summary || '').slice(0, 280),
    };
  }).filter(n => n.title && n.url);

  // Cross-match against our customers
  const [{ data: contacts }, { data: stockCustomers }] = await Promise.all([
    supabase.from('crm_contacts').select('company_name'),
    supabase.from('stock_trailers').select('customer').not('customer', 'is', null),
  ]);

  const ourCustomers = new Set<string>();
  for (const c of contacts ?? []) {
    const n = normaliseCo(String((c as any).company_name ?? ''));
    if (n.length >= 4) ourCustomers.add(n);
  }
  for (const s of stockCustomers ?? []) {
    const n = normaliseCo(String((s as any).customer ?? ''));
    if (n.length >= 4) ourCustomers.add(n);
  }

  const flagged: Notice[] = notices.map(n => {
    if (!n.company || n.company.length < 4) return { ...n, isCustomer: false };
    let match = false;
    for (const c of ourCustomers) {
      if (c.length >= 4 && (n.company.includes(c) || c.includes(n.company))) { match = true; break; }
    }
    return { ...n, isCustomer: match };
  });

  flagged.sort((a, b) => {
    if (a.isCustomer !== b.isCustomer) return a.isCustomer ? -1 : 1;
    return b.publishedDate.localeCompare(a.publishedDate);
  });

  return NextResponse.json({
    notices: flagged.slice(0, 30),
    matchedCount: flagged.filter(n => n.isCustomer).length,
    totalCount: flagged.length,
    fetchedAt: new Date().toISOString(),
  });
}
