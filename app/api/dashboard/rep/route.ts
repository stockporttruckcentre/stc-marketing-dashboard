import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Everything the sales rep dashboard needs, in one server round trip.
 *
 * Deliberately a server route rather than browser queries. Three reasons,
 * in docs/dashboard-upgrade-plan.md: the platform is moving off Supabase
 * and browser-direct calls have no transport on plain PostgreSQL, the
 * exec view has to aggregate across row-level security anyway, and the
 * planned Outlook add-in will consume the same API.
 *
 * Widgets whose tables do not exist yet return `{ available: false }`
 * rather than failing the whole response, so the dashboard ships now and
 * lights up as migrations land.
 */

type Missing = { available: false; needs: string };
const missing = (needs: string): Missing => ({ available: false, needs });

/** Postgres "relation does not exist" and "column does not exist". */
function isMissingObject(err: any) {
  return err?.code === '42P01' || err?.code === '42703';
}

const DAY = 86_400_000;

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const staleDays = Math.min(14, Math.max(1, Number(req.nextUrl.searchParams.get('staleDays') ?? 7)));

  const { data: profile } = await supabase
    .from('profiles').select('id, full_name, role').eq('id', user.id).single();
  const fullName = (profile as any)?.full_name ?? '';

  // The rep's own tracker list. Found by name, which is the existing
  // contract in app/dashboard/leads/page.tsx. Fragile, and flagged as
  // such in the plan, but changing it is not this build's job.
  const { data: trackerList } = await supabase
    .from('crm_lists').select('id, name')
    .eq('owner_id', user.id).eq('is_global', false)
    .ilike('name', '%Sales tracker%').limit(1).maybeSingle();

  if (!trackerList) {
    return NextResponse.json({
      hasTracker: false,
      profile: { full_name: fullName },
      staleDays,
    });
  }

  const [{ data: rows }, { data: meetings }] = await Promise.all([
    supabase.from('crm_contacts').select('*').eq('list_id', (trackerList as any).id),
    supabase.from('calendar_events')
      .select('id, title, start_at, end_at, contact_id, attendees')
      .gte('start_at', new Date(Date.now() - DAY).toISOString())
      .lte('start_at', new Date(Date.now() + 7 * DAY).toISOString())
      .order('start_at', { ascending: true }),
  ]);

  const deals = (rows ?? []) as any[];
  const trailerDeals = deals.filter((d) => (d.side ?? 'trailer_sales') === 'trailer_sales');

  // Activity signal. `last_activity_at` is the honest column and is added
  // by supabase/migrations/001_dashboard.sql. Until that runs, fall back
  // through the least-dishonest alternatives available.
  const activityOf = (d: any): number => {
    const candidates = [d.last_activity_at, d.last_contact, d.updated_at].filter(Boolean);
    return candidates.length ? Math.max(...candidates.map((c: string) => new Date(c).getTime())) : 0;
  };
  const usingRealActivity = deals.some((d) => d.last_activity_at != null);

  const open = deals.filter((d) => d.status === 'contacted' || d.status === 'quoted');
  const cutoff = Date.now() - staleDays * DAY;

  const stale = open
    .filter((d) => activityOf(d) > 0 && activityOf(d) < cutoff)
    .map((d) => ({
      id: d.id,
      company_name: d.company_name,
      contact_name: d.contact_name,
      phone: d.phone,
      email: d.email,
      status: d.status,
      value: d.estimated_value == null ? null : Number(d.estimated_value),
      daysSince: Math.floor((Date.now() - activityOf(d)) / DAY),
    }))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  // Prospective vs existing. Recommended rule from the plan: existing means
  // this company already has a closed deal or a linked sold trailer.
  const wonCompanies = new Set(
    deals.filter((d) => d.status === 'customer' || d.status === 'won')
         .map((d) => (d.company_name ?? '').trim().toLowerCase())
  );
  const isExisting = (d: any) =>
    wonCompanies.has((d.company_name ?? '').trim().toLowerCase()) || d.stock_trailer_id != null;

  const sumValue = (list: any[]) =>
    list.reduce((s, d) => s + (Number(d.estimated_value) || 0), 0);

  const prospective = open.filter((d) => !isExisting(d));
  const existing = open.filter(isExisting);

  // Derived next actions, until dashboard_actions exists. Meetings today,
  // then the stalest open deals. Honest about being derived.
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday.getTime() + DAY);
  const byId = new Map(deals.map((d) => [d.id, d]));

  const meetingActions = (meetings ?? [])
    .filter((m: any) => {
      const t = new Date(m.start_at).getTime();
      return t >= startOfToday.getTime() && t < endOfToday.getTime();
    })
    .map((m: any) => ({
      kind: 'meeting' as const,
      id: m.id,
      title: m.title,
      subtitle: byId.get(m.contact_id)?.company_name ?? null,
      due: m.start_at,
      contactId: m.contact_id,
    }));

  const followUpActions = stale.slice(0, 5).map((d) => ({
    kind: 'follow_up' as const,
    id: d.id,
    title: `Follow up ${d.company_name}`,
    subtitle: `${d.daysSince} days since last activity`,
    due: null as string | null,
    contactId: d.id,
  }));

  // Portfolio. account_ownership does not exist, so fall back to the free
  // text assigned_to matching this user's name, which is what the CRM grid
  // uses today. Partial by construction, and labelled as such in the UI.
  let portfolio: any = missing('the account_ownership table');
  if (fullName) {
    const { data: owned, error } = await supabase
      .from('crm_contacts')
      .select('id, company_name, status, estimated_value, sale_price')
      .ilike('assigned_to', fullName.split(' ')[0] + '%');
    if (!error) {
      const list = (owned ?? []) as any[];
      portfolio = {
        available: true,
        provisional: true,
        accounts: list.length,
        openProposals: list.filter((d) => d.status === 'contacted' || d.status === 'quoted').length,
        revenue: list.filter((d) => d.status === 'customer')
                     .reduce((s, d) => s + (Number(d.sale_price) || 0), 0),
      };
    }
  }

  // Tables that do not exist yet.
  const { error: notifErr } = await supabase.from('notifications').select('id').limit(1);
  const notifications = notifErr && isMissingObject(notifErr)
    ? missing('the notifications table')
    : await (async () => {
        const { data } = await supabase
          .from('notifications')
          .select('id, kind, title, body, link_path, created_at')
          .eq('user_id', user.id).is('read_at', null).is('dismissed_at', null)
          .order('created_at', { ascending: false }).limit(8);
        return { available: true as const, items: data ?? [] };
      })();

  const { error: targetErr } = await supabase.from('revenue_targets').select('id').limit(1);
  const target = targetErr && isMissingObject(targetErr)
    ? missing('the revenue_targets table and this month\'s figure')
    : await (async () => {
        const month = new Date(); month.setDate(1);
        const { data } = await supabase
          .from('revenue_targets').select('target_amount')
          .eq('user_id', user.id).eq('period_month', month.toISOString().slice(0, 10))
          .maybeSingle();
        return data
          ? { available: true as const, target: Number((data as any).target_amount) }
          : missing('a target for this month');
      })();

  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const revenueMtd = deals
    .filter((d) => d.status === 'customer' && d.order_date && new Date(d.order_date) >= monthStart)
    .reduce((s, d) => s + (Number(d.sale_price) || 0), 0);

  return NextResponse.json({
    hasTracker: true,
    profile: { full_name: fullName },
    staleDays,
    usingRealActivity,
    trackerListId: (trackerList as any).id,
    actions: { available: true, derived: true, items: [...meetingActions, ...followUpActions] },
    stale: { available: true, items: stale },
    topStuck: { available: true, items: stale.slice(0, 5) },
    inFlight: {
      available: true,
      prospective: { count: prospective.length, value: sumValue(prospective) },
      existing: { count: existing.length, value: sumValue(existing) },
    },
    portfolio,
    meetings: { available: true, items: meetings ?? [] },
    notifications,
    target,
    revenueMtd,
    counts: {
      open: open.length,
      customers: deals.filter((d) => d.status === 'customer').length,
      trailerSide: trailerDeals.length,
      maintenanceSide: deals.length - trailerDeals.length,
    },
  });
}
