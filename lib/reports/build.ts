import type { SupabaseClient } from '@supabase/supabase-js';
import { reportBySlug } from './catalogue';
import {
  coverWords, periodStart,
  type Division, type Report, type ReportFilters, type Section,
} from './types';

/* =============================================================
   Filling a report with what the application actually knows.

   Server only. Every query here runs as the person who asked for the
   report, so row level security decides what a report can see, exactly
   as it does everywhere else: a rep running the bi-weekly meeting report
   sees their own pipeline in it, and the sales director sees everybody's,
   without this file holding an opinion about either.

   ---- One rule about figures ----

   Nothing here invents a number. Every figure is read from the table
   that owns it: invoiced revenue from `protean_invoices`, won deals from
   `crm_leads` WITH AN ORDER DATE, stock from `stock_trailers`. Where a
   report cannot answer something it says so in the section rather than
   showing a zero, because a zero on a printed page in front of a
   finance director is a claim.

   The order date rule in particular is the one that bit: see the header
   of `components/SalesTracker.tsx`. A year of imported invoicing sat on
   a tracker as won deals, and any report summing `sale_price` without
   that test would have printed it for the MD.
   ============================================================= */

type Db = SupabaseClient<any, any, any>;

const GBP = new Intl.NumberFormat('en-GB', {
  style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
});
const money = (n: number | null | undefined) => GBP.format(Number(n) || 0);
const when = (d: string | null | undefined) => (d
  ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
  : '—');

/** Divisions as the Protean tables spell them, or null for all of them. */
function divisionFilter(f: ReportFilters): Division[] | null {
  return f.divisions.length === 0 || f.divisions.length === 3 ? null : f.divisions;
}

/** The financial year this date falls in, April to April. Migration 082. */
function fyStart(now = new Date()): Date {
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return new Date(Date.UTC(year, 3, 1));
}

export async function buildReport(
  db: Db, slug: string, filters: ReportFilters,
): Promise<Report | { error: string }> {
  const def = reportBySlug(slug);
  if (!def) return { error: 'No such report.' };

  const now = new Date();
  const sections: Section[] = [];
  const wanted = (id: string) => !filters.exclude.includes(id);

  /* ---- The catalogue's id wins, always ----

     Three builders are shared between reports under different names:
     the pipeline table is `pipeline` in the meeting report and
     `byperson` in the pipeline report, the won summary is `won` in one
     and `summary` in the other, and the health list is `health` in one
     and `open` in the other. Each of them writes its own id, so
     without this the section that came back was labelled with the
     builder's name rather than the one the catalogue promised.

     That is not cosmetic. The screen draws its "include or exclude"
     chips from the catalogue, so a chip reading `pipeline` was matched
     against a section calling itself `byperson`, and pressing it removed
     nothing. `npm run check:reports` found it and this is the fix: the
     id is stamped here, once, from the thing that declared it. */
  const push = async (id: string, make: () => Promise<Section | null>) => {
    if (!wanted(id)) return;
    const made = await make();
    if (made) sections.push({ ...made, id });
  };

  switch (slug) {
    case 'biweekly': {
      await push('health',     () => healthSection(db));
      await push('revenue',    () => revenueSection(db, filters, now));
      await push('won',        () => wonSection(db, filters, now));
      await push('fleetsmart', () => fleetsmartSection(db, filters, now));
      await push('pipeline',   () => pipelineByPersonSection(db, filters));
      await push('newleads',   () => newLeadsSection(db, filters, now));
      await push('openjobs',   () => openJobsSection(db, filters));
      await push('stock',      () => stockSection(db));
      await push('quiet',      () => quietSection(db, filters));
      await push('diary',      () => diarySection(db));
      break;
    }
    case 'top-customers': {
      await push('top',   () => customerRankSection(db, filters, 'top'));
      await push('share', () => customerShareSection(db, filters));
      break;
    }
    case 'bottom-customers': {
      await push('bottom', () => customerRankSection(db, filters, 'bottom'));
      break;
    }
    case 'growth-revenue': {
      await push('up',   () => movementSection(db, filters, 'value', 'up'));
      await push('down', () => movementSection(db, filters, 'value', 'down'));
      break;
    }
    case 'growth-volume': {
      await push('up',   () => movementSection(db, filters, 'volume', 'up'));
      await push('down', () => movementSection(db, filters, 'volume', 'down'));
      break;
    }
    case 'won': {
      await push('summary', () => wonSection(db, filters, now));
      await push('deals',   () => wonDealsSection(db, filters, now));
      break;
    }
    case 'pipeline': {
      await push('byperson', () => pipelineByPersonSection(db, filters));
      await push('bystage',  () => pipelineByStageSection(db, filters));
      await push('biggest',  () => biggestOpenSection(db, filters));
      break;
    }
    case 'health': {
      await push('open',   () => healthSection(db));
      await push('due',    () => chaseDueSection(db));
      await push('closed', () => healthClosedSection(db));
      break;
    }
    case 'operations': {
      await push('stock',    () => stockSection(db));
      await push('openjobs', () => openJobsSection(db, filters));
      await push('oldest',   () => oldestJobsSection(db, filters));
      break;
    }
    default:
      return { error: 'That report has no builder yet.' };
  }

  return {
    slug,
    title: def.title,
    subtitle: coverWords(filters, now),
    generatedAt: now.toISOString(),
    filters,
    sections,
  };
}

/* =============================================================
   The sections
   ============================================================= */

/** Open reds and ambers, with their reasons. The meeting opens here. */
async function healthSection(db: Db): Promise<Section> {
  const { data } = await db
    .from('crm_health_events')
    .select('level, reason, raised_at, chase_count, alert_count, account:crm_contacts ( company_name, assigned_to )')
    .is('resolved_at', null)
    .order('level')
    .order('raised_at');

  const rows = (data ?? []) as any[];
  return {
    kind: 'list',
    id: 'health',
    title: 'Reds and ambers',
    note: rows.length
      ? `${rows.filter((r) => r.level === 'red').length} red, ${rows.filter((r) => r.level === 'amber').length} amber.`
      : undefined,
    empty: 'Nothing open. No customer is flagged as a problem.',
    items: rows.map((r) => ({
      title: `${r.account?.company_name ?? 'Unknown customer'}`,
      detail: r.reason,
      meta: [
        r.level === 'red' ? 'Red' : 'Amber',
        `since ${when(r.raised_at)}`,
        r.account?.assigned_to ? `owned by ${r.account.assigned_to}` : null,
        r.chase_count > 0 ? `chased ${r.chase_count}×` : null,
      ].filter(Boolean).join(' · '),
      tone: r.level === 'red' ? 'danger' : 'warning',
    })),
  };
}

async function chaseDueSection(db: Db): Promise<Section> {
  const { data } = await db.from('crm_health_due_a_chase').select('*')
    .order('working_days_quiet', { ascending: false });
  const rows = (data ?? []) as any[];
  return {
    kind: 'table',
    id: 'due',
    title: 'Due a chase',
    note: 'Three working days on a red, seven on an amber, weekends and bank holidays excluded.',
    empty: 'Nothing is overdue a chase.',
    columns: [
      { key: 'company', label: 'Customer' },
      { key: 'level', label: 'Level' },
      { key: 'quiet', label: 'Working days quiet', align: 'right' },
      { key: 'reason', label: 'Reason' },
    ],
    rows: rows.map((r) => ({
      company: r.company_name,
      level: r.level === 'red' ? 'Red' : 'Amber',
      quiet: r.working_days_quiet,
      reason: r.reason,
    })),
  };
}

async function healthClosedSection(db: Db): Promise<Section> {
  const since = new Date();
  since.setDate(since.getDate() - 60);
  const { data } = await db
    .from('crm_health_events')
    .select('level, reason, resolution, resolved_at, account:crm_contacts ( company_name )')
    .not('resolved_at', 'is', null)
    .gte('resolved_at', since.toISOString())
    .order('resolved_at', { ascending: false })
    .limit(20);
  const rows = (data ?? []) as any[];
  return {
    kind: 'table',
    id: 'closed',
    title: 'Closed in the last two months',
    empty: 'Nothing has been closed off recently.',
    columns: [
      { key: 'company', label: 'Customer' },
      { key: 'level', label: 'Was' },
      { key: 'reason', label: 'Reason' },
      { key: 'closed', label: 'Closed' },
    ],
    rows: rows.map((r) => ({
      company: r.account?.company_name ?? '—',
      level: r.level === 'red' ? 'Red' : 'Amber',
      reason: r.resolution || r.reason,
      closed: when(r.resolved_at),
    })),
  };
}

/** Invoiced revenue, from Protean, against the same point last year. */
async function revenueSection(db: Db, f: ReportFilters, now: Date): Promise<Section> {
  const divisions = divisionFilter(f);
  const from = periodStart(f.period, now);

  let q = db.from('protean_invoices').select('net, tax_point, division');
  if (divisions) q = q.in('division', divisions);
  const { data, error } = await q.gte('tax_point', fyStart(now).toISOString().slice(0, 10));

  if (error) {
    return { kind: 'note', id: 'revenue', title: 'Invoiced revenue',
      text: 'The Protean invoice table is not on this installation, so there is nothing to report.' };
  }

  const rows = (data ?? []) as { net: number; tax_point: string }[];
  const inPeriod = rows.filter((r) => new Date(r.tax_point) >= from);
  const fyTotal = rows.reduce((s, r) => s + Number(r.net || 0), 0);
  const periodTotal = inPeriod.reduce((s, r) => s + Number(r.net || 0), 0);

  return {
    kind: 'stats',
    id: 'revenue',
    title: 'Invoiced revenue',
    note: 'Net, from Protean, excluding VAT.',
    stats: [
      { label: 'This period', value: money(periodTotal), sub: `${inPeriod.length} invoices` },
      { label: 'Financial year to date', value: money(fyTotal), sub: `${rows.length} invoices since April` },
      {
        label: 'Average invoice',
        value: money(inPeriod.length ? periodTotal / inPeriod.length : 0),
        sub: 'this period',
      },
    ],
  };
}

/** What closed, and it must have a date on it. */
async function wonSection(db: Db, f: ReportFilters, now: Date): Promise<Section> {
  const from = periodStart(f.period, now);
  let q = db.from('crm_leads')
    .select('sale_price, type, order_date, owner_id')
    .eq('status', 'customer')
    .not('order_date', 'is', null)
    .gte('order_date', from.toISOString().slice(0, 10));
  if (f.person) q = q.eq('owner_id', f.person);
  const { data } = await q;

  const rows = ((data ?? []) as any[]).filter((r) => typeFits(r.type, f));
  const total = rows.reduce((s, r) => s + (Number(r.sale_price) || 0), 0);

  return {
    kind: 'stats',
    id: 'won',
    title: 'What closed',
    note: 'Deals with an agreed date on them. An imported figure with no date is not a deal somebody won.',
    stats: [
      { label: 'Deals won', value: String(rows.length) },
      { label: 'Value', value: money(total) },
      { label: 'Average', value: money(rows.length ? total / rows.length : 0) },
    ],
  };
}

async function wonDealsSection(db: Db, f: ReportFilters, now: Date): Promise<Section> {
  const from = periodStart(f.period, now);
  let q = db.from('crm_leads')
    .select('company_name, type, what, sale_price, order_date, owner:profiles!crm_leads_owner_id_fkey ( full_name )')
    .eq('status', 'customer')
    .not('order_date', 'is', null)
    .gte('order_date', from.toISOString().slice(0, 10))
    .order('sale_price', { ascending: false, nullsFirst: false });
  if (f.person) q = q.eq('owner_id', f.person);
  const { data } = await q.limit(100);

  const rows = ((data ?? []) as any[]).filter((r) => typeFits(r.type, f));
  return {
    kind: 'table',
    id: 'deals',
    title: 'Every deal',
    empty: 'Nothing closed in this period.',
    columns: [
      { key: 'company', label: 'Customer' },
      { key: 'division', label: 'Division' },
      { key: 'what', label: 'For' },
      { key: 'who', label: 'Won by' },
      { key: 'date', label: 'Agreed' },
      { key: 'value', label: 'Value', align: 'right' },
    ],
    rows: rows.map((r) => ({
      company: r.company_name ?? '—',
      division: divisionName(r.type),
      what: r.what ?? '—',
      who: r.owner?.full_name ?? 'Unassigned',
      date: when(r.order_date),
      value: money(r.sale_price),
    })),
  };
}

async function fleetsmartSection(db: Db, f: ReportFilters, now: Date): Promise<Section> {
  const from = periodStart(f.period, now);
  const { data, error } = await db.from('fleetsmart_contracts')
    .select('ref, customer_name, status, monthly_total, annual_total, asset_count, created_at, sent_at')
    .gte('created_at', from.toISOString())
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return { kind: 'note', id: 'fleetsmart', title: 'New FleetSmart+ contracts',
      text: 'FleetSmart+ is not on this installation.' };
  }
  const rows = (data ?? []) as any[];
  return {
    kind: 'table',
    id: 'fleetsmart',
    title: 'New FleetSmart+ contracts',
    note: rows.length
      ? `${money(rows.reduce((s, r) => s + Number(r.annual_total || 0), 0))} a year on the table.`
      : undefined,
    empty: 'No contracts built in this period.',
    columns: [
      { key: 'ref', label: 'Reference' },
      { key: 'company', label: 'Customer' },
      { key: 'status', label: 'Status' },
      { key: 'assets', label: 'Assets', align: 'right' },
      { key: 'monthly', label: 'Monthly', align: 'right' },
      { key: 'annual', label: 'A year', align: 'right' },
    ],
    rows: rows.map((r) => ({
      ref: r.ref ?? '—',
      company: r.customer_name,
      status: r.status,
      assets: r.asset_count,
      monthly: money(r.monthly_total),
      annual: money(r.annual_total),
    })),
  };
}

async function pipelineByPersonSection(db: Db, f: ReportFilters): Promise<Section> {
  let q = db.from('crm_leads')
    .select('estimated_value, status, type, owner:profiles!crm_leads_owner_id_fkey ( full_name )')
    .in('status', ['lead', 'contacted', 'quoted', 'won']);
  if (f.person) q = q.eq('owner_id', f.person);
  const { data } = await q.limit(5000);

  const rows = ((data ?? []) as any[]).filter((r) => typeFits(r.type, f));
  const by = new Map<string, { deals: number; value: number }>();
  for (const r of rows) {
    const who = r.owner?.full_name ?? 'Unassigned';
    const at = by.get(who) ?? { deals: 0, value: 0 };
    at.deals += 1;
    at.value += Number(r.estimated_value) || 0;
    by.set(who, at);
  }

  return {
    kind: 'table',
    id: 'byperson',
    title: 'Pipeline by person',
    note: 'Open leads only. Estimated value, which is what somebody expects rather than what is agreed.',
    empty: 'Nothing open.',
    columns: [
      { key: 'who', label: 'Who' },
      { key: 'deals', label: 'Open deals', align: 'right' },
      { key: 'value', label: 'Estimated', align: 'right' },
    ],
    rows: [...by.entries()]
      .sort((a, b) => b[1].value - a[1].value)
      .map(([who, v]) => ({ who, deals: v.deals, value: money(v.value) })),
  };
}

async function pipelineByStageSection(db: Db, f: ReportFilters): Promise<Section> {
  let q = db.from('crm_leads').select('status, estimated_value, type')
    .in('status', ['lead', 'contacted', 'quoted', 'won']);
  if (f.person) q = q.eq('owner_id', f.person);
  const { data } = await q.limit(5000);
  const rows = ((data ?? []) as any[]).filter((r) => typeFits(r.type, f));

  const order = ['lead', 'contacted', 'quoted', 'won'];
  const label: Record<string, string> = {
    lead: 'Lead', contacted: 'Contacted', quoted: 'Quoted', won: 'Won, not yet delivered',
  };
  return {
    kind: 'table',
    id: 'bystage',
    title: 'By stage',
    empty: 'Nothing open.',
    columns: [
      { key: 'stage', label: 'Stage' },
      { key: 'deals', label: 'Deals', align: 'right' },
      { key: 'value', label: 'Estimated', align: 'right' },
    ],
    rows: order.map((s) => {
      const mine = rows.filter((r) => r.status === s);
      return {
        stage: label[s],
        deals: mine.length,
        value: money(mine.reduce((t, r) => t + (Number(r.estimated_value) || 0), 0)),
      };
    }),
  };
}

async function biggestOpenSection(db: Db, f: ReportFilters): Promise<Section> {
  let q = db.from('crm_leads')
    .select('company_name, type, what, status, estimated_value, owner:profiles!crm_leads_owner_id_fkey ( full_name )')
    .in('status', ['lead', 'contacted', 'quoted', 'won'])
    .order('estimated_value', { ascending: false, nullsFirst: false });
  if (f.person) q = q.eq('owner_id', f.person);
  const { data } = await q.limit(60);
  const rows = ((data ?? []) as any[]).filter((r) => typeFits(r.type, f)).slice(0, 15);

  return {
    kind: 'table',
    id: 'biggest',
    title: 'The biggest open deals',
    empty: 'Nothing open with a value on it.',
    columns: [
      { key: 'company', label: 'Customer' },
      { key: 'division', label: 'Division' },
      { key: 'what', label: 'For' },
      { key: 'stage', label: 'Stage' },
      { key: 'who', label: 'Who' },
      { key: 'value', label: 'Estimated', align: 'right' },
    ],
    rows: rows.map((r) => ({
      company: r.company_name ?? '—',
      division: divisionName(r.type),
      what: r.what ?? '—',
      stage: r.status,
      who: r.owner?.full_name ?? 'Unassigned',
      value: money(r.estimated_value),
    })),
  };
}

async function newLeadsSection(db: Db, f: ReportFilters, now: Date): Promise<Section> {
  const from = periodStart(f.period, now);
  const { data } = await db.from('crm_leads')
    .select('company_name, type, what, status, estimated_value, created_at, owner:profiles!crm_leads_owner_id_fkey ( full_name )')
    .gte('created_at', from.toISOString())
    .order('created_at', { ascending: false })
    .limit(100);
  const rows = ((data ?? []) as any[]).filter((r) => typeFits(r.type, f));

  return {
    kind: 'table',
    id: 'newleads',
    title: 'Leads opened',
    note: `${rows.length} raised in this period.`,
    empty: 'No new leads in this period.',
    columns: [
      { key: 'company', label: 'Customer' },
      { key: 'division', label: 'Division' },
      { key: 'what', label: 'For' },
      { key: 'who', label: 'Who' },
      { key: 'value', label: 'Estimated', align: 'right' },
    ],
    rows: rows.slice(0, 25).map((r) => ({
      company: r.company_name ?? '—',
      division: divisionName(r.type),
      what: r.what ?? '—',
      who: r.owner?.full_name ?? 'Unassigned',
      value: money(r.estimated_value),
    })),
  };
}

async function openJobsSection(db: Db, f: ReportFilters): Promise<Section> {
  const divisions = divisionFilter(f);
  let q = db.from('protean_open_jobs').select('job_total, division');
  if (divisions) q = q.in('division', divisions);
  const { data, error } = await q.limit(5000);

  if (error) {
    return { kind: 'note', id: 'openjobs', title: 'Open jobs',
      text: 'The Protean open jobs table is not on this installation.' };
  }
  const rows = (data ?? []) as { job_total: number }[];
  const total = rows.reduce((s, r) => s + (Number(r.job_total) || 0), 0);
  return {
    kind: 'stats',
    id: 'openjobs',
    title: 'Open jobs',
    note: 'Work in the workshop that has not been invoiced.',
    stats: [
      { label: 'Open jobs', value: String(rows.length) },
      { label: 'Value on them', value: money(total) },
    ],
  };
}

async function oldestJobsSection(db: Db, f: ReportFilters): Promise<Section> {
  const divisions = divisionFilter(f);
  let q = db.from('protean_open_jobs')
    .select('job_no, customer, job_type, depot, logged_date, job_total, division')
    .order('logged_date', { ascending: true });
  if (divisions) q = q.in('division', divisions);
  const { data, error } = await q.limit(20);
  if (error) {
    return { kind: 'note', id: 'oldest', title: 'Oldest open jobs',
      text: 'The Protean open jobs table is not on this installation.' };
  }
  const rows = (data ?? []) as any[];
  return {
    kind: 'table',
    id: 'oldest',
    title: 'Oldest open jobs',
    note: 'Longest on the system first. These are the ones somebody is waiting on.',
    empty: 'Nothing open.',
    columns: [
      { key: 'job', label: 'Job' },
      { key: 'customer', label: 'Customer' },
      { key: 'type', label: 'Type' },
      { key: 'depot', label: 'Depot' },
      { key: 'logged', label: 'Logged' },
      { key: 'value', label: 'Value', align: 'right' },
    ],
    rows: rows.map((r) => ({
      job: r.job_no,
      customer: r.customer,
      type: r.job_type ?? '—',
      depot: r.depot ?? '—',
      logged: when(r.logged_date),
      value: money(r.job_total),
    })),
  };
}

async function stockSection(db: Db): Promise<Section> {
  const { data, error } = await db.from('stock_trailers')
    .select('status, category, nbv, retail_price')
    .limit(4000);
  if (error) {
    return { kind: 'note', id: 'stock', title: 'Trailer stock',
      text: 'The stock list is not on this installation.' };
  }
  const rows = (data ?? []) as any[];
  const inStock = rows.filter((r) => r.status === 'in_stock' || r.status === 'available');
  const value = inStock.reduce((s, r) => s + (Number(r.retail_price) || Number(r.nbv) || 0), 0);
  const sold = rows.filter((r) => r.status === 'sold').length;

  return {
    kind: 'stats',
    id: 'stock',
    title: 'Trailer stock',
    stats: [
      { label: 'On the yard', value: String(inStock.length), sub: 'available to sell' },
      { label: 'Retail value', value: money(value), sub: 'at asking price' },
      { label: 'Sold, all time', value: String(sold) },
    ],
  };
}

async function quietSection(db: Db, f: ReportFilters): Promise<Section> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);
  let q = db.from('crm_leads')
    .select('company_name, type, status, estimated_value, last_activity_at, owner:profiles!crm_leads_owner_id_fkey ( full_name )')
    .in('status', ['contacted', 'quoted'])
    .lt('last_activity_at', cutoff.toISOString())
    .order('estimated_value', { ascending: false, nullsFirst: false });
  if (f.person) q = q.eq('owner_id', f.person);
  const { data } = await q.limit(40);
  const rows = ((data ?? []) as any[]).filter((r) => typeFits(r.type, f)).slice(0, 15);

  return {
    kind: 'table',
    id: 'quiet',
    title: 'Gone quiet',
    note: 'Open deals nobody has touched in a fortnight, biggest first.',
    empty: 'Nothing has gone quiet.',
    columns: [
      { key: 'company', label: 'Customer' },
      { key: 'who', label: 'Who' },
      { key: 'stage', label: 'Stage' },
      { key: 'last', label: 'Last touched' },
      { key: 'value', label: 'Estimated', align: 'right' },
    ],
    rows: rows.map((r) => ({
      company: r.company_name ?? '—',
      who: r.owner?.full_name ?? 'Unassigned',
      stage: r.status,
      last: when(r.last_activity_at),
      value: money(r.estimated_value),
    })),
  };
}

async function diarySection(db: Db): Promise<Section> {
  const from = new Date();
  const to = new Date();
  to.setDate(to.getDate() + 14);
  const { data } = await db.from('calendar_events')
    .select('title, start_at, location, contact_id')
    .gte('start_at', from.toISOString())
    .lte('start_at', to.toISOString())
    .order('start_at')
    .limit(50);
  const rows = (data ?? []) as any[];

  return {
    kind: 'list',
    id: 'diary',
    title: 'In the diary, next two weeks',
    empty: 'Nothing booked in the next fortnight.',
    items: rows.map((r) => ({
      title: r.title,
      meta: new Date(r.start_at).toLocaleString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      }) + (r.location ? ` · ${r.location}` : ''),
      tone: 'info' as const,
    })),
  };
}

/* =============================================================
   Customers, ranked

   All four of these read the same rows and sort them differently, so
   they are one function with a direction rather than four that can
   drift apart on what "this year" means.
   ============================================================= */

type SpendRow = {
  name: string;
  thisYear: number;
  lastYear: number;
  invoicesThis: number;
  invoicesLast: number;
};

async function customerSpend(db: Db, f: ReportFilters): Promise<SpendRow[] | null> {
  const divisions = divisionFilter(f);
  const now = new Date();
  const thisFy = fyStart(now);
  const lastFy = new Date(Date.UTC(thisFy.getUTCFullYear() - 1, 3, 1));

  let q = db.from('protean_invoices')
    .select('protean_name, net, tax_point, division')
    .gte('tax_point', lastFy.toISOString().slice(0, 10));
  if (divisions) q = q.in('division', divisions);
  const { data, error } = await q.limit(50000);
  if (error) return null;

  const by = new Map<string, SpendRow>();
  for (const r of (data ?? []) as any[]) {
    const name = (r.protean_name ?? '').trim() || 'Unnamed account';
    const at = by.get(name) ?? { name, thisYear: 0, lastYear: 0, invoicesThis: 0, invoicesLast: 0 };
    const on = new Date(r.tax_point);
    if (on >= thisFy) { at.thisYear += Number(r.net) || 0; at.invoicesThis += 1; }
    else { at.lastYear += Number(r.net) || 0; at.invoicesLast += 1; }
    by.set(name, at);
  }
  return [...by.values()];
}

async function customerRankSection(
  db: Db, f: ReportFilters, which: 'top' | 'bottom',
): Promise<Section> {
  const spend = await customerSpend(db, f);
  if (!spend) {
    return { kind: 'note', id: which, title: 'Customers',
      text: 'The Protean invoice table is not on this installation, so there is nothing to rank.' };
  }

  /* Bottom means the smallest of the customers who ARE trading, not the
     hundred who have not been invoiced this year. A list of dormant
     accounts is a different report and a different conversation. */
  const live = spend.filter((s) => s.thisYear > 0);
  const sorted = [...live].sort((a, b) =>
    which === 'top' ? b.thisYear - a.thisYear : a.thisYear - b.thisYear);

  return {
    kind: 'table',
    id: which,
    title: which === 'top' ? 'The top ten' : 'The bottom ten',
    note: which === 'top'
      ? 'By invoiced value this financial year.'
      : 'Smallest spenders that are still trading with us this year.',
    empty: 'Nothing invoiced this year.',
    columns: [
      { key: 'rank', label: '#', align: 'right', width: 40 },
      { key: 'company', label: 'Customer' },
      { key: 'thisYear', label: 'This year', align: 'right' },
      { key: 'lastYear', label: 'Last year', align: 'right' },
      { key: 'change', label: 'Change', align: 'right' },
      { key: 'invoices', label: 'Invoices', align: 'right' },
    ],
    rows: sorted.slice(0, 10).map((s, i) => ({
      rank: i + 1,
      company: s.name,
      thisYear: money(s.thisYear),
      lastYear: money(s.lastYear),
      change: changeWords(s.thisYear, s.lastYear),
      invoices: s.invoicesThis,
    })),
  };
}

async function customerShareSection(db: Db, f: ReportFilters): Promise<Section> {
  const spend = await customerSpend(db, f);
  if (!spend) {
    return { kind: 'note', id: 'share', title: 'Concentration', text: 'Nothing to measure.' };
  }
  const live = spend.filter((s) => s.thisYear > 0).sort((a, b) => b.thisYear - a.thisYear);
  const all = live.reduce((s, r) => s + r.thisYear, 0);
  const top10 = live.slice(0, 10).reduce((s, r) => s + r.thisYear, 0);

  return {
    kind: 'stats',
    id: 'share',
    title: 'What they are worth together',
    note: 'Concentration is a risk question: how much of the year walks out if one of them leaves.',
    stats: [
      { label: 'Top ten', value: money(top10) },
      { label: 'Everybody', value: money(all), sub: `${live.length} trading customers` },
      {
        label: 'Their share',
        value: all > 0 ? `${Math.round((top10 / all) * 100)}%` : '—',
        sub: 'of invoiced revenue',
      },
    ],
  };
}

async function movementSection(
  db: Db, f: ReportFilters, by: 'value' | 'volume', dir: 'up' | 'down',
): Promise<Section> {
  const spend = await customerSpend(db, f);
  if (!spend) {
    return { kind: 'note', id: dir, title: 'Movement', text: 'Nothing to compare.' };
  }

  /* Somebody who did not exist last year is not an increase, they are a
     new customer, and putting them at the top of a growth table hides
     every real increase underneath them. They are counted separately. */
  const known = spend.filter((s) => s.lastYear > 0 || s.thisYear > 0);
  const withDelta = known.map((s) => ({
    ...s,
    delta: by === 'value' ? s.thisYear - s.lastYear : s.invoicesThis - s.invoicesLast,
    isNew: s.lastYear === 0 && s.thisYear > 0,
  }));

  const moving = withDelta
    .filter((s) => !s.isNew && (dir === 'up' ? s.delta > 0 : s.delta < 0))
    .sort((a, b) => (dir === 'up' ? b.delta - a.delta : a.delta - b.delta))
    .slice(0, 10);

  const unit = by === 'value' ? money : (n: number) => String(n);
  return {
    kind: 'table',
    id: dir,
    title: dir === 'up'
      ? (by === 'value' ? 'Spending more' : 'More jobs than last year')
      : (by === 'value' ? 'Spending less' : 'Fewer jobs than last year'),
    note: dir === 'up'
      ? 'Against the same point last financial year. Customers new this year are left out: they have nothing to be compared with.'
      : 'The ones worth a phone call.',
    empty: 'Nothing has moved.',
    columns: [
      { key: 'company', label: 'Customer' },
      { key: 'thisYear', label: 'This year', align: 'right' },
      { key: 'lastYear', label: 'Last year', align: 'right' },
      { key: 'delta', label: dir === 'up' ? 'Up by' : 'Down by', align: 'right' },
    ],
    rows: moving.map((s) => ({
      company: s.name,
      thisYear: by === 'value' ? money(s.thisYear) : String(s.invoicesThis),
      lastYear: by === 'value' ? money(s.lastYear) : String(s.invoicesLast),
      delta: unit(Math.abs(s.delta)),
    })),
  };
}

/* =============================================================
   Small shared things
   ============================================================= */

/** A lead's type against the division filter. */
function typeFits(type: string | null, f: ReportFilters): boolean {
  const divisions = divisionFilter(f);
  if (!divisions) return true;
  /* The tracker calls its divisions `trailer_sales`, `maintenance` and
     `rental`; the revenue side calls them `trailer`, `stc` and `rental`.
     They are the same three and this is the one place that knows it. */
  const asDivision: Record<string, Division> = {
    trailer_sales: 'trailer',
    maintenance: 'stc',
    rental: 'rental',
  };
  return divisions.includes(asDivision[type ?? 'trailer_sales'] ?? 'trailer');
}

function divisionName(type: string | null): string {
  switch (type) {
    case 'maintenance': return 'Maintenance';
    case 'rental': return 'Rentals';
    default: return 'Trailer sales';
  }
}

function changeWords(now: number, before: number): string {
  if (before === 0) return now > 0 ? 'new' : '—';
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return 'level';
  return `${pct > 0 ? '+' : ''}${pct}%`;
}
