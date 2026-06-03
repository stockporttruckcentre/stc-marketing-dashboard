'use client';

import { useMemo, useState } from 'react';
import {
  ArrowDownRight, ArrowUpRight, PoundSterling, TrendingUp, Award, Users,
  Package, Briefcase, Activity, Sparkles,
} from 'lucide-react';
import { ResponsivePie } from '@nivo/pie';
import { ResponsiveBar } from '@nivo/bar';
import { ResponsiveLine } from '@nivo/line';
import type { Profile, StockTrailer, CRMContact, CrmList } from '@/lib/types';

const STC_RED  = '#cf2417';
const STC_NAVY = '#071458';
const POS = '#20c997';
const VIOLET = '#a78bfa';
const CYAN = '#22d3ee';
const WARN = '#f7b500';

const fmtMoney0 = (v: number | null | undefined) =>
  v == null ? '£0' : `£${Math.round(Number(v)).toLocaleString('en-GB')}`;
const fmtMoneyCompact = (v: number) => {
  const n = Math.round(Number(v) || 0);
  if (Math.abs(n) >= 1_000_000) return '£' + (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (Math.abs(n) >= 1_000)     return '£' + Math.round(n / 1000) + 'k';
  return '£' + n;
};
const fmtPct = (v: number, dp = 1) => `${(v * 100).toFixed(dp)}%`;

// Stable, brand-flavoured colour pairs for avatar/leaderboard gradients
const ACCENTS: Array<[string, string]> = [
  ['#ff3b2d', '#cf2417'],
  ['#4d63ff', '#071458'],
  ['#22d3ee', '#0ea5e9'],
  ['#a78bfa', '#7c3aed'],
  ['#20c997', '#15a085'],
  ['#f7b500', '#d97706'],
  ['#ec4899', '#be185d'],
  ['#84cc16', '#4d7c0f'],
];
function accentFor(name: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return ACCENTS[hash % ACCENTS.length];
}
const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase() ?? '').join('') || '·';

// ===== Period helpers =====
type Period = '30d' | '90d' | 'mtd' | 'qtd' | 'ytd' | 'all';
const PERIOD_LABELS: Record<Period, string> = {
  '30d': '30 days', '90d': '90 days', mtd: 'This month', qtd: 'This quarter', ytd: 'Year to date', all: 'All time',
};
function periodWindow(p: Period, now = new Date()) {
  const end = new Date(now);
  const start = new Date(now);
  if (p === '30d') start.setDate(end.getDate() - 30);
  else if (p === '90d') start.setDate(end.getDate() - 90);
  else if (p === 'mtd') start.setDate(1);
  else if (p === 'qtd') {
    const q = Math.floor(now.getMonth() / 3);
    start.setMonth(q * 3, 1);
  }
  else if (p === 'ytd') start.setMonth(0, 1);
  else if (p === 'all') start.setTime(0);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}
function previousWindow(p: Period, now = new Date()) {
  const { start, end } = periodWindow(p, now);
  const len = end.getTime() - start.getTime();
  return { start: new Date(start.getTime() - len), end: start };
}
function inWindow(dStr: string | null | undefined, start: Date, end: Date) {
  if (!dStr) return false;
  const d = new Date(dStr);
  if (Number.isNaN(d.getTime())) return false;
  return d >= start && d <= end;
}

// ===== Rep name normalisation =====
// Build a set of valid sales-team names + their nicknames/initials,
// derived from the profiles table (excludes Gareth/admins/CEOs unless they're in 'sales').
// Reps who close deals but don't have (or no longer need) a portal login.
// These names still need to count in revenue / leaderboards.
const EXTRA_REPS: { full_name: string; aliases: string[]; hasLogin: boolean }[] = [
  { full_name: 'Lucy',          aliases: ['lucy'],                            hasLogin: false },
  { full_name: 'David Reay',    aliases: ['david', 'dave', 'david reay', 'dr', 'd.reay'], hasLogin: true },
  { full_name: 'Paul Townsend', aliases: ['paul t', 'paul townsend', 'pt'],   hasLogin: false },
];

function buildRepIndex(profiles: Profile[]) {
  // Profile reps = anyone who actually sells. Includes admin (Gareth) + sales + marketer.
  const profileReps = profiles.filter(p => p.role === 'sales' || p.role === 'marketer' || p.role === 'admin');
  const reps: { id: string; full_name: string; email?: string | null; hasLogin: boolean }[] = [];
  const byKey = new Map<string, string>();

  for (const p of profileReps) {
    const full = (p.full_name || p.email?.split('@')[0] || '').trim();
    if (!full) continue;
    reps.push({ id: p.id, full_name: full, email: p.email, hasLogin: true });
    const tokens = full.split(/\s+/);
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    const initial1 = first[0]?.toUpperCase() ?? '';
    const initial2 = last[0]?.toUpperCase() ?? '';
    for (const c of [
      full.toLowerCase(),
      first.toLowerCase(),
      `${first} ${last}`.toLowerCase(),
      `${initial1}${initial2}`.toLowerCase(),
      `${initial1}.${initial2}.`.toLowerCase(),
      `${first[0]}${last}`.toLowerCase(),
    ]) byKey.set(c, full);
  }

  // Extra reps without a portal account (Lucy, ex-staff etc) still appear if not collision
  for (const er of EXTRA_REPS) {
    // Don't double-add if a profile already covers them
    if (Array.from(byKey.values()).some(v => v.toLowerCase() === er.full_name.toLowerCase())) continue;
    reps.push({ id: 'noauth:' + er.full_name, full_name: er.full_name, hasLogin: er.hasLogin });
    byKey.set(er.full_name.toLowerCase(), er.full_name);
    for (const a of er.aliases) byKey.set(a.toLowerCase(), er.full_name);
  }
  return { reps, byKey };
}
const NON_REPS = new Set(['stc', 'stock', 'admin', 'support', 'office', 'workshop', 'house', 'n/a', 'tbd', 'unassigned', '-', '—', '?', '']);
function canonicalRep(raw: string | null | undefined, idx: ReturnType<typeof buildRepIndex>): string | null {
  if (!raw) return null;
  const norm = raw.trim().toLowerCase();
  if (!norm || NON_REPS.has(norm)) return null;
  if (idx.byKey.has(norm)) return idx.byKey.get(norm)!;
  // Loose substring match on first names
  for (const [k, v] of idx.byKey.entries()) {
    if (k.length >= 3 && (norm.includes(k) || k.includes(norm))) return v;
  }
  return null; // unrecognised -> excluded from rep analytics (keeps Gareth & garbage out)
}

// ============================================================
//   MAIN VIEW
// ============================================================
export function AnalyticsView({
  currentUser, teamProfiles, stock, tracker, lists,
}: {
  currentUser: Profile | null;
  teamProfiles: Profile[];
  stock: StockTrailer[];
  tracker: CRMContact[];
  lists: CrmList[];
}) {
  const [period, setPeriod] = useState<Period>('ytd');
  const [repFilter, setRepFilter] = useState<string>('ALL');

  const repIdx = useMemo(() => buildRepIndex(teamProfiles), [teamProfiles]);

  // ===== Filter & enrich stock with canonical rep =====
  const stockEnriched = useMemo(() => stock.map(s => ({
    ...s,
    _repCanonical: canonicalRep(s.sales_rep ?? null, repIdx),
  })), [stock, repIdx]);

  const stockFiltered = useMemo(() =>
    repFilter === 'ALL' ? stockEnriched : stockEnriched.filter(s => s._repCanonical === repFilter),
    [stockEnriched, repFilter]);

  const sold = useMemo(() => stockFiltered.filter(s => s.status === 'sold'), [stockFiltered]);

  // ===== Date windows =====
  const now = new Date();
  const { start: pStart, end: pEnd } = periodWindow(period, now);
  const { start: ppStart, end: ppEnd } = previousWindow(period, now);

  const soldInPeriod = useMemo(() => sold.filter(s => inWindow(s.dispatch_date ?? s.order_date, pStart, pEnd)), [sold, pStart, pEnd]);
  const soldInPrev   = useMemo(() => sold.filter(s => inWindow(s.dispatch_date ?? s.order_date, ppStart, ppEnd)), [sold, ppStart, ppEnd]);

  const sumRev    = (arr: typeof sold) => arr.reduce((s, x) => s + Number(x.sales_price || 0), 0);
  const sumProfit = (arr: typeof sold) => arr.reduce((s, x) => s + Number(x.profit || 0), 0);
  const revP    = sumRev(soldInPeriod);
  const revPrev = sumRev(soldInPrev);
  const profitP    = sumProfit(soldInPeriod);
  const profitPrev = sumProfit(soldInPrev);
  const deltaPct = (curr: number, prev: number) => (prev === 0 ? (curr === 0 ? 0 : 1) : (curr - prev) / Math.abs(prev));

  const dealsP = soldInPeriod.length;
  const dealsPrev = soldInPrev.length;
  const avgDeal = dealsP ? revP / dealsP : 0;
  const margin  = revP ? profitP / revP : 0;

  // Commission from tracker
  const commissionP = tracker.reduce((s, c) =>
    inWindow(c.dispatch_date ?? c.order_date, pStart, pEnd) ? s + (Number(c.commission) || 0) : s, 0);
  const commissionPrev = tracker.reduce((s, c) =>
    inWindow(c.dispatch_date ?? c.order_date, ppStart, ppEnd) ? s + (Number(c.commission) || 0) : s, 0);

  // Pipeline
  const activeCustomers = tracker.filter(c => c.status === 'customer').length;
  const workingLeads = tracker.filter(c => ['lead','contacted','quoted'].includes(c.status));
  const pipelineValue = workingLeads.reduce((s, c) => s + (Number(c.estimated_value) || 0), 0);

  // Stock available + NBV
  const stockAvailable = stockFiltered.filter(s => s.status === 'in_stock' || s.status === 'new_build');
  const stockNbv = stockAvailable.reduce((s, x) => s + (Number(x.total_nbv) || 0), 0);

  // ===== Hero line chart: revenue & profit by month, last 12 months =====
  const monthly = useMemo(() => {
    const months: { key: string; label: string; rev: number; profit: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('en-GB', { month: 'short' }),
        rev: 0, profit: 0,
      });
    }
    for (const s of sold) {
      const k = (s.dispatch_date ?? s.order_date ?? '').slice(0, 7);
      const m = months.find(x => x.key === k);
      if (!m) continue;
      m.rev += Number(s.sales_price || 0);
      m.profit += Number(s.profit || 0);
    }
    return months;
  }, [sold]);

  const allLineData = useMemo(() => [
    { id: 'Revenue', color: STC_NAVY, data: monthly.map(m => ({ x: m.label, y: m.rev })) },
    { id: 'Profit',  color: POS,      data: monthly.map(m => ({ x: m.label, y: m.profit })) },
  ], [monthly]);
  const [visibleSeries, setVisibleSeries] = useState<string[]>(['Revenue', 'Profit']);
  const nivoLineData = useMemo(() => allLineData.filter(s => visibleSeries.includes(s.id)), [allLineData, visibleSeries]);

  // Sparkline helper for KPI: small recent series
  const sparkRev = useMemo(() => monthly.slice(-6).map(m => m.rev), [monthly]);
  const sparkProfit = useMemo(() => monthly.slice(-6).map(m => m.profit), [monthly]);
  const sparkDeals = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of monthly) map.set(m.key, 0);
    for (const s of sold) {
      const k = (s.dispatch_date ?? s.order_date ?? '').slice(0, 7);
      if (map.has(k)) map.set(k, (map.get(k) ?? 0) + 1);
    }
    return Array.from(map.values()).slice(-6);
  }, [sold, monthly]);

  // ===== Sales leaderboard (per canonical rep, in-period) =====
  const leaderboard = useMemo(() => {
    const map = new Map<string, { rep: string; revenue: number; profit: number; deals: number }>();
    // Seed every known rep so people with 0 deals still appear
    for (const p of repIdx.reps) {
      const name = p.full_name;
      if (name) map.set(name, { rep: name, revenue: 0, profit: 0, deals: 0 });
    }
    for (const s of soldInPeriod) {
      const r = s._repCanonical;
      if (!r) continue;
      const e = map.get(r) ?? { rep: r, revenue: 0, profit: 0, deals: 0 };
      e.revenue += Number(s.sales_price || 0);
      e.profit  += Number(s.profit || 0);
      e.deals   += 1;
      map.set(r, e);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [soldInPeriod, repIdx]);
  const teamRevTotal = leaderboard.reduce((s, r) => s + r.revenue, 0);

  // ===== Pipeline funnel data =====
  const funnel = useMemo(() => {
    const sales = tracker.filter(t => (t.side ?? 'trailer_sales') === 'trailer_sales');
    const c = (st: string) => sales.filter(x => x.status === st).length;
    return [
      { key: 'lead',      label: 'Lead',      n: c('lead'),      color: CYAN },
      { key: 'contacted', label: 'Contacted', n: c('contacted'), color: VIOLET },
      { key: 'quoted',    label: 'Quoted',    n: c('quoted'),    color: WARN },
      { key: 'won',       label: 'Won',       n: c('won'),       color: POS },
      { key: 'customer',  label: 'Customer',  n: c('customer'),  color: POS },
      { key: 'lost',      label: 'Lost',      n: c('lost'),      color: '#666' },
    ];
  }, [tracker]);
  const funnelMax = Math.max(1, ...funnel.map(f => f.n));

  // ===== Top customers =====
  const topCustomers = useMemo(() => {
    const map = new Map<string, { customer: string; revenue: number; profit: number; deals: number }>();
    for (const s of soldInPeriod) {
      const k = s.customer || 'Unknown';
      const e = map.get(k) ?? { customer: k, revenue: 0, profit: 0, deals: 0 };
      e.revenue += Number(s.sales_price || 0);
      e.profit  += Number(s.profit || 0);
      e.deals   += 1;
      map.set(k, e);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  }, [soldInPeriod]);

  // ===== Stock pie =====
  const stockPie = useMemo(() => {
    const out = new Map<string, number>();
    for (const s of stockFiltered) {
      const k = (s.status || 'unknown').replace('_', ' ');
      out.set(k, (out.get(k) ?? 0) + 1);
    }
    const colors: Record<string, string> = {
      'in stock': STC_NAVY,
      'new build': VIOLET,
      'sales order': WARN,
      'sold': POS,
      'rental': CYAN,
      'scrap': '#666',
    };
    const arr = Array.from(out.entries()).map(([id, value]) => ({
      id, label: id, value, color: colors[id] || '#888',
    }));
    return arr;
  }, [stockFiltered]);
  const totalStock = stockPie.reduce((s, x) => s + x.value, 0);

  // ===== Stock by make =====
  const byMake = useMemo(() => {
    const normMake = (raw: string | null | undefined) => {
      const t = (raw || '').trim();
      if (!t) return 'Unknown';
      // Title-case each word so 'Don bur' and 'DON BUR' both -> 'Don Bur'
      return t.toLowerCase().replace(/\b\w/g, ch => ch.toUpperCase());
    };
    const map = new Map<string, number>();
    for (const s of stockFiltered) {
      const m = normMake(s.make);
      if (m === 'Unknown' && !s.make) continue;
      map.set(m, (map.get(m) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([make, count]) => ({ make, count }))
      .filter(r => r.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [stockFiltered]);

  // ===== Render =====
  return (
    <div className="an-hub">
      {/* Hero */}
      <div className="an-hero">
        <div className="an-hero__left">
          <div className="an-hero__eyebrow">
            <Sparkles size={11} /> Analytics hub
          </div>
          <h1>Performance overview</h1>
          <div className="an-hero__sub">
            Live business signal · {PERIOD_LABELS[period]} {repFilter !== 'ALL' && <>· {repFilter}</>} ·{' '}
            <span style={{ color: 'var(--an-text-3)' }}>{new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>

        <div className="an-controls">
          <div className="an-seg" role="tablist" aria-label="Period">
            {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
              <button key={p} className={`an-seg__btn ${period === p ? 'is-active' : ''}`} onClick={() => setPeriod(p)}>
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          <select className="an-select" value={repFilter} onChange={(e) => setRepFilter(e.target.value)}>
            <option value="ALL">Whole team</option>
            {repIdx.reps.map(p => (
              <option key={p.id} value={p.full_name}>{p.full_name}{p.hasLogin ? '' : ' (no login)'}</option>
            ))}
          </select>
        </div>
      </div>

      {/* KPI grid */}
      <div className="an-kpis">
        <Kpi className="an-kpi--accent an-kpi--rev"    label="Revenue"        accent={STC_NAVY}
             value={fmtMoneyCompact(revP)} delta={deltaPct(revP, revPrev)} sub={`vs prev ${PERIOD_LABELS[period].toLowerCase()}`} spark={sparkRev} accentColor={STC_NAVY} />
        <Kpi className="an-kpi--accent an-kpi--profit" label="Profit"         accent={POS}
             value={fmtMoneyCompact(profitP)} delta={deltaPct(profitP, profitPrev)} sub={`Margin ${fmtPct(margin)}`} spark={sparkProfit} accentColor={POS} />
        <Kpi className="an-kpi--accent an-kpi--comm"   label="Commission paid" accent={STC_RED}
             value={fmtMoneyCompact(commissionP)} delta={deltaPct(commissionP, commissionPrev)} sub="To sales team" spark={sparkProfit} accentColor={STC_RED} />
        <Kpi className="an-kpi--accent an-kpi--avg"    label="Average deal"   accent={STC_RED}
             value={fmtMoneyCompact(avgDeal)} delta={deltaPct(dealsP, dealsPrev)} sub={`${dealsP} deal${dealsP === 1 ? '' : 's'}`} spark={sparkDeals.map(n => n * 1000)} accentColor={STC_RED} />
        <Kpi className="an-kpi--accent an-kpi--cust"   label="Active customers" accent={VIOLET}
             value={String(activeCustomers)} sub={`${workingLeads.length} live opportunities`} icon={<Users size={11} />} />
        <Kpi className="an-kpi--accent an-kpi--pipe"   label="Pipeline value"  accent={WARN}
             value={fmtMoneyCompact(pipelineValue)} sub={`${workingLeads.length} working leads`} icon={<Briefcase size={11} />} />
        <Kpi className="an-kpi--accent an-kpi--stock"  label="Stock available" accent={STC_NAVY}
             value={String(stockAvailable.length)} sub={`${fmtMoneyCompact(stockNbv)} NBV`} icon={<Package size={11} />} />
        <Kpi className="an-kpi--accent an-kpi--month"  label="Conversion"      accent={CYAN}
             value={fmtPct(workingLeads.length ? activeCustomers / (activeCustomers + workingLeads.length) : 0, 0)}
             sub="Open → customer" icon={<Activity size={11} />} />
      </div>

      {/* Hero line chart + Stock donut */}
      <div className="an-grid">
        <div className="an-card" style={{ minHeight: 380 }}>
          <div className="an-card__head">
            <div className="an-card__title">
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 50, background: STC_NAVY, boxShadow: `0 0 0 3px ${STC_NAVY}22` }} />
              Revenue &amp; profit · monthly trend
            </div>
            <div className="an-card__sub">Last 12 months · whole stock list</div>
          </div>
          {/* Click the Revenue / Profit chips to toggle each line on/off */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginBottom: 6 }}>
            {[
              { id: 'Revenue', color: STC_NAVY },
              { id: 'Profit',  color: POS },
            ].map(s => {
              const on = visibleSeries.includes(s.id);
              return (
                <button key={s.id}
                  onClick={() => setVisibleSeries(prev => on ? prev.filter(k => k !== s.id) : [...prev, s.id])}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    fontSize: 11, fontWeight: 600,
                    padding: '4px 10px', borderRadius: 7,
                    background: on ? 'rgba(255,255,255,0.04)' : 'transparent',
                    border: `1px solid ${on ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.1)'}`,
                    color: on ? 'var(--an-text-0)' : 'var(--an-text-3)',
                    cursor: 'pointer', transition: 'all .12s',
                    textDecoration: on ? 'none' : 'line-through',
                  }}>
                  <span style={{
                    width: 10, height: 10, borderRadius: 50,
                    background: on ? s.color : 'transparent',
                    border: on ? 'none' : `1.5px solid ${s.color}`,
                  }} />
                  {s.id}
                </button>
              );
            })}
          </div>
          <div style={{ height: 290 }}>
            <ResponsiveLine
              data={nivoLineData}
              margin={{ top: 12, right: 30, bottom: 36, left: 64 }}
              xScale={{ type: 'point' }}
              yScale={{ type: 'linear', min: 0, max: 'auto', stacked: false }}
              curve="catmullRom"
              enablePoints={true}
              pointSize={6}
              pointBorderWidth={2}
              pointBorderColor={{ from: 'serieColor' }}
              pointColor={{ theme: 'background' }}
              enableArea={true}
              areaOpacity={0.08}
              colors={(s: any) => s.color}
              lineWidth={2.5}
              theme={nivoTheme()}
              axisLeft={{ tickSize: 0, tickPadding: 10, format: (v: number) => fmtMoneyCompact(v) }}
              axisBottom={{ tickSize: 0, tickPadding: 10 }}
              enableSlices="x"
              sliceTooltip={({ slice }: any) => (
                <div className="an-tt">
                  <div className="an-tt__title">{slice.points[0]?.data.xFormatted}</div>
                  {slice.points.map((p: any) => (
                    <div className="an-tt__row" key={p.id}>
                      <span className="an-tt__dot" style={{ background: p.serieColor }} />
                      <span className="an-tt__label">{p.serieId}</span>
                      <span className="an-tt__val">{fmtMoney0(Number(p.data.y))}</span>
                    </div>
                  ))}
                </div>
              )}
              animate={true}
              motionConfig="gentle"
            />
          </div>
        </div>

        <div className="an-card">
          <div className="an-card__head">
            <div className="an-card__title">
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 50, background: VIOLET, boxShadow: `0 0 0 3px ${VIOLET}22` }} />
              Stock distribution
            </div>
            <div className="an-card__sub">{totalStock} trailers</div>
          </div>
          <div style={{ position: 'relative', height: 220 }}>
            <ResponsivePie
              data={stockPie}
              margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
              innerRadius={0.66}
              padAngle={1.4}
              cornerRadius={3}
              colors={(d: any) => d.data.color}
              borderWidth={0}
              enableArcLabels={false}
              enableArcLinkLabels={false}
              theme={nivoTheme()}
              tooltip={({ datum }: any) => (
                <div className="an-tt">
                  <div className="an-tt__row">
                    <span className="an-tt__dot" style={{ background: datum.color }} />
                    <span className="an-tt__label" style={{ textTransform: 'capitalize' }}>{datum.label}</span>
                    <span className="an-tt__val">{datum.value}</span>
                  </div>
                </div>
              )}
              animate={true}
              motionConfig="gentle"
            />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', pointerEvents: 'none' }}>
              <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>{totalStock}</div>
              <div style={{ fontSize: 11, color: 'var(--an-text-2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Trailers</div>
            </div>
          </div>
          <div style={{ marginTop: 6 }}>
            {stockPie.map(s => (
              <div className="an-stock-row" key={s.id}>
                <span className="an-stock-row__dot" style={{ background: s.color }} />
                <span className="an-stock-row__name">{s.label}</span>
                <span className="an-stock-row__n">{s.value}</span>
                <span className="an-stock-row__pct">{totalStock ? fmtPct(s.value / totalStock, 0) : '—'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Leaderboard + Funnel */}
      <div className="an-grid an-grid--equal">
        <div className="an-card">
          <div className="an-card__head">
            <div className="an-card__title">
              <Award size={14} style={{ color: STC_RED }} /> Sales leaderboard
            </div>
            <div className="an-card__sub">By revenue · {PERIOD_LABELS[period]}</div>
          </div>
          <div className="an-board">
            {leaderboard.length === 0 ? (
              <div style={{ color: 'var(--an-text-3)', padding: '24px 12px', textAlign: 'center', fontSize: 13 }}>No deals closed in this period.</div>
            ) : leaderboard.map((r, i) => {
              const [a, b] = accentFor(r.rep);
              const pct = teamRevTotal ? r.revenue / teamRevTotal : 0;
              return (
                <div key={r.rep} className="an-board__row" style={{ '--ax': a, '--ay': b } as any}
                     onClick={() => setRepFilter(r.rep === repFilter ? 'ALL' : r.rep)}
                     title={`Click to filter to ${r.rep}`}>
                  <div className="an-board__rank">#{i + 1}</div>
                  <div>
                    <div className="an-board__name">
                      <span className="an-board__avatar" style={{ '--ax': a, '--ay': b } as any}>{initials(r.rep)}</span>
                      <span>{r.rep}</span>
                    </div>
                    <div className="an-board__bar">
                      <span style={{ width: `${Math.max(2, pct * 100)}%`, '--ax': a, '--ay': b } as any} />
                    </div>
                  </div>
                  <div className="an-board__val">
                    {r.deals}<small>deal{r.deals === 1 ? '' : 's'}</small>
                  </div>
                  <div className="an-board__val">
                    {fmtMoneyCompact(r.revenue)}<small>{fmtMoneyCompact(r.profit)} profit</small>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="an-card">
          <div className="an-card__head">
            <div className="an-card__title">
              <Activity size={14} style={{ color: WARN }} /> Pipeline funnel
            </div>
            <div className="an-card__sub">All sides · current state</div>
          </div>
          <div className="an-funnel">
            {funnel.map(f => (
              <div key={f.key} className="an-funnel__row" style={{ '--c': f.color } as any}>
                <span className="an-funnel__fill" style={{ width: `${Math.round((f.n / funnelMax) * 100)}%`, animationDelay: '.05s' }} />
                <span className="an-funnel__label">
                  <span className="an-funnel__dot" />
                  {f.label}
                </span>
                <span className="an-funnel__n">{f.n}<small>{funnelMax ? fmtPct(f.n / funnelMax, 0) : '—'}</small></span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top customers + Stock by make */}
      <div className="an-grid an-grid--equal">
        <div className="an-card">
          <div className="an-card__head">
            <div className="an-card__title">
              <Users size={14} style={{ color: VIOLET }} /> Top customers
            </div>
            <div className="an-card__sub">By revenue · {PERIOD_LABELS[period]}</div>
          </div>
          <div className="an-list">
            {topCustomers.length === 0 ? (
              <div style={{ color: 'var(--an-text-3)', padding: '24px 12px', textAlign: 'center', fontSize: 13 }}>No customers in this period.</div>
            ) : topCustomers.map((c, i) => (
              <div className="an-list__row" key={c.customer}>
                <div className="an-list__rank">#{i + 1}</div>
                <div>
                  <div className="an-list__name">{c.customer}</div>
                  <div className="an-list__sub">{c.deals} deal{c.deals === 1 ? '' : 's'} · {fmtMoneyCompact(c.profit)} profit</div>
                </div>
                <div className="an-list__val">{fmtMoneyCompact(c.revenue)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="an-card">
          <div className="an-card__head">
            <div className="an-card__title">
              <Package size={14} style={{ color: STC_NAVY }} /> Stock by manufacturer
            </div>
            <div className="an-card__sub">{byMake.length} makes in stock</div>
          </div>
          <div style={{ height: Math.max(220, byMake.length * 34) }}>
            <ResponsiveBar
              data={byMake}
              indexBy="make"
              keys={['count']}
              layout="horizontal"
              margin={{ top: 6, right: 30, bottom: 28, left: 110 }}
              padding={0.35}
              colors={[STC_NAVY]}
              borderRadius={4}
              theme={nivoTheme()}
              axisLeft={{ tickSize: 0, tickPadding: 10 }}
              axisBottom={{ tickSize: 0, tickPadding: 10, tickValues: 4 }}
              enableLabel={true}
              labelTextColor={'#fff'}
              tooltip={({ value, indexValue, color }: any) => (
                <div className="an-tt">
                  <div className="an-tt__row">
                    <span className="an-tt__dot" style={{ background: color }} />
                    <span className="an-tt__label">{indexValue}</span>
                    <span className="an-tt__val">{value} trailers</span>
                  </div>
                </div>
              )}
              animate={true}
              motionConfig="gentle"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
//   KPI + Spark + Theme
// ============================================================
function Kpi({
  label, value, sub, delta, spark, accentColor, className, accent, icon,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number;
  spark?: number[];
  accentColor?: string;
  className?: string;
  accent?: string;
  icon?: React.ReactNode;
}) {
  const arrow = delta == null ? null : delta >= 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />;
  const sign  = delta == null ? '' : (delta >= 0 ? '+' : '');
  const cls   = delta == null ? 'is-neutral' : (delta >= 0 ? 'is-pos' : 'is-neg');
  return (
    <div className={`an-kpi ${className ?? ''}`} style={{ '--accent': accent ?? STC_NAVY } as any}>
      <div className="an-kpi__label">
        {icon}{label}
      </div>
      <div className="an-kpi__value">{value}</div>
      <div className="an-kpi__row">
        {delta != null && (
          <span className={`an-kpi__delta ${cls}`}>
            {arrow}{sign}{(delta * 100).toFixed(0)}%
          </span>
        )}
        {sub && <span className="an-kpi__sub">{sub}</span>}
      </div>
      {spark && spark.length > 1 && <Spark data={spark} color={accentColor || STC_NAVY} />}
    </div>
  );
}

// Tiny standalone SVG sparkline
function Spark({ data, color }: { data: number[]; color: string }) {
  const w = 96, h = 32, pad = 2;
  const max = Math.max(1, ...data), min = Math.min(0, ...data);
  const range = max - min || 1;
  const step = (w - pad * 2) / (data.length - 1);
  const pts = data.map((d, i) => [pad + i * step, h - pad - ((d - min) / range) * (h - pad * 2)]);
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${path} L ${pts[pts.length - 1][0].toFixed(1)} ${h - pad} L ${pad} ${h - pad} Z`;
  return (
    <svg className="an-kpi__spark" viewBox={`0 0 ${w} ${h}`}>
      <defs>
        <linearGradient id={`g-${color.replace('#', '')}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#g-${color.replace('#', '')})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function nivoTheme() {
  return {
    background: 'transparent',
    text: { fill: 'rgba(255,255,255,0.5)', fontSize: 11 },
    axis: {
      domain: { line: { stroke: 'transparent' } },
      ticks: { line: { stroke: 'transparent' }, text: { fill: 'rgba(255,255,255,0.5)', fontSize: 11 } },
      legend: { text: { fill: 'rgba(255,255,255,0.6)', fontSize: 11 } },
    },
    grid: { line: { stroke: 'rgba(255,255,255,0.05)', strokeDasharray: '3 3' } },
    legends: { text: { fill: 'rgba(255,255,255,0.6)', fontSize: 11 } },
    tooltip: { container: { background: 'transparent', boxShadow: 'none' } },
    crosshair: { line: { stroke: 'rgba(255,255,255,0.2)', strokeDasharray: '3 3' } },
  };
}
