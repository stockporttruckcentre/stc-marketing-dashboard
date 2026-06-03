import { NextResponse } from 'next/server';
import { XMLParser } from 'fast-xml-parser';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;
export const revalidate = 600; // 10 min cache

/**
 * Breaking business activity feed.
 * Pulls UK insolvency / administration / winding-up notices from The Gazette
 * (official statutory publication for UK insolvency notices).
 *
 * Then cross-matches each notice's subject company against:
 *   - Customer names on the user's CRM contacts
 *   - Sold-to customer names on stock_trailers
 *
 * Notices that match are flagged as 'urgent' so the dashboard can surface
 * them prominently.
 */

// The Gazette Atom feed: insolvency notices, all areas.
// Categories: 24=Insolvency, sub-categories include administration/CVL/winding up.
const GAZETTE_FEED = 'https://www.thegazette.co.uk/insolvency/notice/data.feed?results-page-size=50';

type Notice = {
  id: string;
  title: string;
  company: string | null;
  noticeType: string | null;
  publishedDate: string;
  url: string;
  summary: string;
};

function stripHtml(s: string) {
  return s ? s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() : '';
}

// Pull the company name from a notice title like "JANE LIMITED" or "RE: ACME LTD (in administration)"
function extractCompany(title: string): string | null {
  if (!title) return null;
  let s = title.toUpperCase();
  s = s.replace(/^RE:\s*/i, '');
  // Strip trailing parentheticals like "(IN ADMINISTRATION)"
  s = s.replace(/\([^)]*\)\s*$/g, '').trim();
  // Strip noise words
  s = s.replace(/\b(LIMITED|LTD|PLC|LLP|GROUP|HOLDINGS|UK)\b\.?/g, '').replace(/[,\.]/g, ' ').replace(/\s+/g, ' ').trim();
  return s || null;
}

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let xml = '';
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 9000);
    const res = await fetch(GAZETTE_FEED, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'STC Marketing Dashboard/1.0 (business activity monitor)' },
      next: { revalidate: 600 },
    });
    clearTimeout(tid);
    if (!res.ok) {
      return NextResponse.json({ notices: [], error: `Gazette fetch failed: ${res.status}` });
    }
    xml = await res.text();
  } catch (e: any) {
    return NextResponse.json({ notices: [], error: e?.message ?? 'fetch error' });
  }

  // Parse Atom feed
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  let parsed: any;
  try {
    parsed = parser.parse(xml);
  } catch (e: any) {
    return NextResponse.json({ notices: [], error: 'parse error: ' + e?.message });
  }

  const entries: any[] = parsed?.feed?.entry ? (Array.isArray(parsed.feed.entry) ? parsed.feed.entry : [parsed.feed.entry]) : [];

  const notices: Notice[] = entries.map((e: any) => {
    const titleRaw = typeof e.title === 'string' ? e.title : (e.title?.['#text'] ?? '');
    const summary = stripHtml(typeof e.summary === 'string' ? e.summary : (e.summary?.['#text'] ?? e.content?.['#text'] ?? ''));
    const link = e.link?.['@_href'] ?? (Array.isArray(e.link) ? e.link[0]?.['@_href'] : e.link) ?? '';
    const id = e.id ?? link ?? titleRaw;
    const published = e.published ?? e.updated ?? new Date().toISOString();
    const category = Array.isArray(e.category) ? e.category[0] : e.category;
    const noticeType = category?.['@_label'] ?? category?.['@_term'] ?? null;
    return {
      id: String(id),
      title: stripHtml(titleRaw),
      company: extractCompany(stripHtml(titleRaw)),
      noticeType,
      publishedDate: String(published),
      url: String(link),
      summary: summary.slice(0, 280),
    };
  }).filter(n => n.title && n.url);

  // Cross-match against customer names (CRM + sold stock)
  const [{ data: contacts }, { data: stockCustomers }] = await Promise.all([
    supabase.from('crm_contacts').select('company_name'),
    supabase.from('stock_trailers').select('customer').not('customer', 'is', null),
  ]);

  const ourCustomers = new Set<string>();
  for (const c of contacts ?? []) {
    const n = (c as any).company_name?.toUpperCase().replace(/\b(LIMITED|LTD|PLC|LLP|GROUP|HOLDINGS|UK)\b\.?/g, '').replace(/[,\.]/g, ' ').replace(/\s+/g, ' ').trim();
    if (n) ourCustomers.add(n);
  }
  for (const s of stockCustomers ?? []) {
    const n = (s as any).customer?.toUpperCase().replace(/\b(LIMITED|LTD|PLC|LLP|GROUP|HOLDINGS|UK)\b\.?/g, '').replace(/[,\.]/g, ' ').replace(/\s+/g, ' ').trim();
    if (n) ourCustomers.add(n);
  }

  const flagged = notices.map(n => {
    if (!n.company) return { ...n, isCustomer: false };
    // Match if our customer name appears in the notice company or vice versa (loose)
    const upper = n.company;
    let match = false;
    for (const c of ourCustomers) {
      if (c.length >= 4 && (upper.includes(c) || c.includes(upper))) { match = true; break; }
    }
    return { ...n, isCustomer: match };
  });

  // Customer matches first, then by date desc
  flagged.sort((a, b) => {
    if (a.isCustomer !== b.isCustomer) return a.isCustomer ? -1 : 1;
    return b.publishedDate.localeCompare(a.publishedDate);
  });

  return NextResponse.json({
    notices: flagged.slice(0, 25),
    matchedCount: flagged.filter(n => n.isCustomer).length,
    totalCount: flagged.length,
    fetchedAt: new Date().toISOString(),
  });
}
