import { createClient } from '@/lib/supabase/server';
import { AnalyticsView } from '@/components/AnalyticsView';
import type { Profile, StockTrailer, CRMContact } from '@/lib/types';
import './analytics.css';

export const dynamic = 'force-dynamic';

async function fetchAll<T = any>(supabase: any, table: string, columns = '*'): Promise<T[]> {
  const out: T[] = [];
  const CHUNK = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + CHUNK - 1);
    if (error || !data || data.length === 0) break;
    out.push(...data);
    if (data.length < CHUNK) break;
    from += CHUNK;
    if (from > 50000) break; // safety
  }
  return out;
}


export default async function AnalyticsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  /* Protean's figures are read here rather than in the view, so the
     screen paints once with everything on it. They are also allowed to
     fail: the workshop revenue is newer than this page, and a database
     without the revenue migrations on it should still draw the trailer
     sales analytics rather than a blank screen. */
  const revenue = async () => {
    try {
      const [company, months, byCustomer] = await Promise.all([
        supabase.rpc('protean_company', { p_upto: null }),
        supabase.rpc('protean_by_month', { p_months: 24, p_upto: null }),
        supabase.rpc('protean_year_on_year', { p_upto: null }),
      ]);
      if (company.error || months.error || byCustomer.error) return null;
      return {
        company: ((company.data ?? []) as any[])[0] ?? null,
        months: (months.data ?? []) as any[],
        customers: (byCustomer.data ?? []) as any[],
      };
    } catch {
      return null;
    }
  };

  const [profileRes, profilesAllRes, stockAll, leadsAll, protean] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('profiles').select('id, email, full_name, role'),
    fetchAll(supabase, 'stock_trailers'),
    /* THE PIPELINE IS THE LEADS, NOT THE COMPANIES.

       This used to read every company and keep the ones carrying a
       `list_id`, on the reasoning that a company on somebody's tracker
       list was a deal. A deal is its own record now, so the funnel
       counts pitches rather than firms: two quotes to one haulier are
       two things in the pipeline, which is what a rep would say. */
    fetchAll(supabase, 'crm_leads', 'id, contact_id, owner_id, type, status, estimated_value, company_name'),
    revenue(),
  ]);

  const tracker = (leadsAll as any[]).map((l) => ({
    ...l,
    // `side` is what the funnel and the sales split read. It moved onto
    // the lead as `type` when rental became a third kind of work.
    side: l.type,
  })) as unknown as CRMContact[];

  return (
    <AnalyticsView
      currentUser={(profileRes.data as Profile) ?? null}
      teamProfiles={(profilesAllRes.data ?? []) as Profile[]}
      stock={stockAll as StockTrailer[]}
      tracker={tracker}
      protean={protean}
    />
  );
}
