'use client';

import { useMemo, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  LineChart, Line, PieChart, Pie, Cell,
} from 'recharts';
import { TrendingUp, PoundSterling, Package, Users, Wrench, Award, Filter } from 'lucide-react';
import type { Profile, StockTrailer, CRMContact, CrmList } from '@/lib/types';

const NAVY = '#071458';
const RED = '#cf2417';
const PALETTE = ['#071458', '#cf2417', '#5fb572', '#f7b500', '#7c3aed', '#0ea5e9', '#ec4899', '#84cc16'];

const fmtMoney0 = (v: number | null | undefined) =>
  v == null ? '£0' : `£${Math.round(Number(v)).toLocaleString('en-GB')}`;
const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;
const monthKey = (d: string | null | undefined) => (d ? String(d).slice(0, 7) : '');
const inYTD = (d: string | null | undefined, year: number) => d != null && String(d).slice(0, 4) === String(year);

export function AnalyticsView({
  currentUser, stock, tracker, lists,
}: { currentUser: Profile | null; stock: StockTrailer[]; tracker: CRMContact[]; lists: CrmList[] }) {
  // ===== Rep filter (default: ALL — data is for the whole team) =====
  const reps = useMemo(() => {
    const set = new Set<string>();
    for (const s of stock) if (s.sales_rep) set.add(s.sales_rep);
    for (const t of tracker) {
      // tracker rows belong to a list -> derive owner via lists map
    }
    return Array.from(set).sort();
  }, [stock]);
  const [repFilter, setRepFilter] = useState<string>('ALL');

  const ownerByListId = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of lists) if (l.id && l.owner_id) m.set(l.id, l.owner_id);
    return m;
  }, [lists]);

  // ===== Filter helpers =====
  const stockFiltered = useMemo(() =>
    repFilter === 'ALL' ? stock : stock.filter(s => (s.sales_rep ?? '') === repFilter),
    [stock, repFilter]);

  // ===== Year-to-date / time windows =====
  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonthKey = `${thisYear}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const quarter = Math.floor(now.getMonth() / 3) + 1;

  // ===== Trailer Sales KPIs (from stock_trailers, status=sold, by dispatch month) =====
  const sold = useMemo(() => stockFiltered.filter(s => s.status === 'sold'), [stockFiltered]);
  const soldYTD = useMemo(() => sold.filter(s => inYTD(s.dispatch_date ?? s.order_date, thisYear)), [sold, thisYear]);
  const revYTD = soldYTD.reduce((sum, s) => sum + Number(s.sales_price || 0), 0);
  const profitYTD = soldYTD.reduce((sum, s) => sum + Number(s.profit || 0), 0);
  const dealsYTD = soldYTD.length;
  const avgDeal = dealsYTD ? revYTD / dealsYTD : 0;
  const avgMargin = revYTD ? profitYTD / revYTD : 0;

  const soldThisMonth = soldYTD.filter(s => monthKey(s.dispatch_date ?? s.order_date) === thisMonthKey);
  const revMonth = soldThisMonth.reduce((sum, s) => sum + Number(s.sales_price || 0), 0);
  const profitMonth = soldThisMonth.reduce((sum, s) => sum + Number(s.profit || 0), 0);

  // ===== Commission (from crm_contacts) =====
  const trackerFiltered = useMemo(() => {
    if (repFilter === 'ALL') return tracker;
    // Filter tracker by list owner -> match the rep's UUID. We don't have the rep's
    // UUID via sales_rep text — only the list owner. We'll fall back to including
    // all tracker rows for 'ALL', and only filter stock by rep name.
    return tracker;
  }, [tracker, repFilter]);

  const commissionYTD = trackerFiltered.reduce((sum, c) => {
    if (!inYTD(c.dispatch_date ?? c.order_date, thisYear)) return sum;
    return sum + (Number(c.commission) || 0);
  }, 0);

  // ===== Active customers / pipeline =====
  const activeCustomers = trackerFiltered.filter(c => c.status === 'customer').length;
  const workingLeads = trackerFiltered.filter(c => c.status === 'lead' || c.status === 'contacted' || c.status === 'quoted');
  const pipelineValue = workingLeads.reduce((sum, c) => sum + (Number(c.estimated_value) || 0), 0);

  // ===== Stock counts =====
  const stockCounts = useMemo(() => {
    const out: Record<string, number> = { new_build: 0, in_stock: 0, sales_order: 0, sold: 0, rental: 0, scrap: 0 };
    for (const s of stockFiltered) if (s.status && out[s.status] != null) out[s.status]++;
    return out;
  }, [stockFiltered]);
  const stockNbvAvailable = stockFiltered
    .filter(s => s.status === 'in_stock' || s.status === 'new_build')
    .reduce((sum, s) => sum + (Number(s.total_nbv) || 0), 0);

  // ===== Monthly trend (last 12 months) =====
  const monthly = useMemo(() => {
    const months: { key: string; label: string }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
      });
    }
    const buckets = months.map(m => ({ month: m.label, key: m.key, revenue: 0, profit: 0, deals: 0 }));
    for (const s of stockFiltered.filter(x => x.status === 'sold')) {
      const k = monthKey(s.dispatch_date ?? s.order_date);
      const b = buckets.find(x => x.key === k);
      if (!b) continue;
      b.revenue += Number(s.sales_price || 0);
      b.profit += Number(s.profit || 0);
      b.deals += 1;
    }
    return buckets;
  }, [stockFiltered]);

  // ===== Per-rep performance =====
  const perRep = useMemo(() => {
    const map = new Map<string, { rep: string; revenue: number; profit: number; deals: number }>();
    for (const s of sold) {
      const rep = s.sales_rep || 'Unassigned';
      const e = map.get(rep) ?? { rep, revenue: 0, profit: 0, deals: 0 };
      e.revenue += Number(s.sales_price || 0);
      e.profit += Number(s.profit || 0);
      e.deals += 1;
      map.set(rep, e);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [sold]);

  // ===== Top customers by revenue =====
  const topCustomers = useMemo(() => {
    const map = new Map<string, { customer: string; revenue: number; profit: number; deals: number }>();
    for (const s of sold) {
      const c = s.customer || 'Unknown';
      const e = map.get(c) ?? { customer: c, revenue: 0, profit: 0, deals: 0 };
      e.revenue += Number(s.sales_price || 0);
      e.profit += Number(s.profit || 0);
      e.deals += 1;
      map.set(c, e);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  }, [sold]);

  // ===== Stock by make =====
  const byMake = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of stockFiltered) {
      const m = s.make || 'Unknown';
      map.set(m, (map.get(m) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([make, count]) => ({ make, count }))
      .filter(r => r.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [stockFiltered]);

  // ===== CRM pipeline funnel (status counts on trailer-sales side) =====
  const pipelineCounts = useMemo(() => {
    const sales = trackerFiltered.filter(t => (t.side ?? 'trailer_sales') === 'trailer_sales');
    const out: Record<string, number> = {
      lead: 0, contacted: 0, quoted: 0, won: 0, lost: 0, customer: 0,
    };
    for (const c of sales) if (c.status && out[c.status] != null) out[c.status]++;
    return out;
  }, [trackerFiltered]);

  // ===== Maintenance accounts breakdown =====
  const maintBreakdown = useMemo(() => {
    const maint = trackerFiltered.filter(t => t.side === 'maintenance');
    const out = new Map<string, number>();
    for (const m of maint) {
      const what = m.what || 'Other';
      out.set(what, (out.get(what) ?? 0) + 1);
    }
    return Array.from(out.entries()).map(([what, count]) => ({ what, count })).sort((a, b) => b.count - a.count);
  }, [trackerFiltered]);

  // ===== Stock value by status (donut) =====
  const stockByStatus = useMemo(() => {
    const out = new Map<string, number>();
    for (const s of stockFiltered) {
      const k = (s.status || 'unknown').replace('_', ' ');
      out.set(k, (out.get(k) ?? 0) + 1);
    }
    return Array.from(out.entries()).map(([name, value]) => ({ name, value }));
  }, [stockFiltered]);

  return (
    <div className="space-y-4">
      {/* Page head + Rep filter */}
      <div className="page-head" style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
        <div>
          <div className="page-head__eyebrow">Analytics</div>
          <h1 className="page-head__title">Performance overview</h1>
          <div className="page-head__sub">Live numbers from the stock list and per-rep trackers. Q{quarter} {thisYear}.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Filter size={14} style={{ color: 'var(--fg-3)' }} />
          <select className="input" value={repFilter} onChange={(e) => setRepFilter(e.target.value)} style={{ minWidth: 180 }}>
            <option value="ALL">All sales reps</option>
            {reps.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <KPI icon={<PoundSterling size={16} />} label={`Revenue YTD ${thisYear}`} value={fmtMoney0(revYTD)} accent="#5fb572" sub={`${dealsYTD} deal${dealsYTD === 1 ? '' : 's'}`} />
        <KPI icon={<TrendingUp size={16} />} label="Profit YTD" value={fmtMoney0(profitYTD)} accent="#5fb572" sub={`Margin ${fmtPct(avgMargin)}`} />
        <KPI icon={<Award size={16} />} label="Commission YTD" value={fmtMoney0(commissionYTD)} accent={RED} sub="Paid across team" />
        <KPI icon={<PoundSterling size={16} />} label="Revenue this month" value={fmtMoney0(revMonth)} sub={fmtMoney0(profitMonth) + ' profit'} />
        <KPI icon={<Users size={16} />} label="Active customers" value={String(activeCustomers)} sub={`${workingLeads.length} working leads`} />
        <KPI icon={<Package size={16} />} label="Pipeline value" value={fmtMoney0(pipelineValue)} sub="Open opportunities" />
        <KPI icon={<Package size={16} />} label="Stock available" value={String(stockCounts.in_stock + stockCounts.new_build)} sub={fmtMoney0(stockNbvAvailable) + ' NBV'} />
        <KPI icon={<Package size={16} />} label="Avg deal size" value={fmtMoney0(avgDeal)} sub="YTD per deal" />
      </div>

      {/* Monthly trend */}
      <Card title="Monthly revenue & profit · last 12 months">
        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthly} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--fg-2)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--fg-2)' }} tickFormatter={(v) => fmtMoney0(v)} />
              <Tooltip formatter={(v: any) => fmtMoney0(Number(v))} contentStyle={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="revenue" stroke={NAVY} strokeWidth={2.5} dot={{ r: 3 }} name="Revenue" />
              <Line type="monotone" dataKey="profit"  stroke={RED}  strokeWidth={2.5} dot={{ r: 3 }} name="Profit" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 12 }}>
        {/* Per rep */}
        <Card title="Performance by sales rep">
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={perRep} layout="vertical" margin={{ top: 10, right: 30, left: 30, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--fg-2)' }} tickFormatter={(v) => fmtMoney0(v)} />
                <YAxis type="category" dataKey="rep" tick={{ fontSize: 11, fill: 'var(--fg-2)' }} width={120} />
                <Tooltip formatter={(v: any) => fmtMoney0(Number(v))} contentStyle={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="revenue" fill={NAVY} name="Revenue" radius={[0, 4, 4, 0]} />
                <Bar dataKey="profit"  fill={RED}  name="Profit"  radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table className="table" style={{ width: '100%', marginTop: 12, fontSize: 12 }}>
            <thead><tr style={{ color: 'var(--fg-3)' }}><th align="left">Rep</th><th align="right">Deals</th><th align="right">Revenue</th><th align="right">Profit</th><th align="right">Margin</th></tr></thead>
            <tbody>
              {perRep.map(r => (
                <tr key={r.rep}>
                  <td>{r.rep}</td>
                  <td align="right">{r.deals}</td>
                  <td align="right">{fmtMoney0(r.revenue)}</td>
                  <td align="right">{fmtMoney0(r.profit)}</td>
                  <td align="right">{r.revenue ? fmtPct(r.profit / r.revenue) : '—'}</td>
                </tr>
              ))}
              {perRep.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--fg-3)', padding: 16 }}>No deals recorded yet</td></tr>}
            </tbody>
          </table>
        </Card>

        {/* Stock by status (donut) */}
        <Card title="Stock by status">
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={stockByStatus} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={2}>
                  {stockByStatus.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 12 }}>
        {/* Top customers */}
        <Card title="Top 10 customers by revenue">
          <table className="table" style={{ width: '100%', fontSize: 12 }}>
            <thead><tr style={{ color: 'var(--fg-3)' }}><th align="left">Customer</th><th align="right">Deals</th><th align="right">Revenue</th><th align="right">Profit</th></tr></thead>
            <tbody>
              {topCustomers.map(r => (
                <tr key={r.customer}>
                  <td>{r.customer}</td>
                  <td align="right">{r.deals}</td>
                  <td align="right">{fmtMoney0(r.revenue)}</td>
                  <td align="right">{fmtMoney0(r.profit)}</td>
                </tr>
              ))}
              {topCustomers.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--fg-3)', padding: 16 }}>No closed deals yet</td></tr>}
            </tbody>
          </table>
        </Card>

        {/* Stock by make */}
        <Card title="Stock by make">
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byMake} layout="vertical" margin={{ top: 10, right: 20, left: 30, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--fg-2)' }} />
                <YAxis type="category" dataKey="make" tick={{ fontSize: 11, fill: 'var(--fg-2)' }} width={120} />
                <Tooltip contentStyle={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8 }} />
                <Bar dataKey="count" fill={NAVY} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 12 }}>
        {/* CRM pipeline funnel */}
        <Card title="CRM pipeline (Trailer Sales side)">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {[
              ['Lead',       pipelineCounts.lead,      '#0ea5e9'],
              ['Contacted',  pipelineCounts.contacted, '#7c3aed'],
              ['Quoted',     pipelineCounts.quoted,    '#f7b500'],
              ['Won',        pipelineCounts.won,       '#5fb572'],
              ['Customer',   pipelineCounts.customer,  '#5fb572'],
              ['Lost',       pipelineCounts.lost,      '#888'],
            ].map(([label, n, color]) => (
              <div key={label as string} style={{ background: 'var(--bg-2)', borderLeft: `3px solid ${color}`, padding: '10px 12px', borderRadius: 6 }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--fg-1)' }}>{n}</div>
                <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{label}</div>
              </div>
            ))}
          </div>
        </Card>

        {/* Maintenance accounts breakdown */}
        <Card title={<><Wrench size={14} style={{ verticalAlign: 'middle' }} /> Maintenance accounts</>}>
          {maintBreakdown.length === 0 ? (
            <div style={{ color: 'var(--fg-3)', padding: 20, textAlign: 'center' }}>No maintenance accounts tracked yet</div>
          ) : (
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={maintBreakdown} layout="vertical" margin={{ top: 10, right: 20, left: 60, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--fg-2)' }} />
                  <YAxis type="category" dataKey="what" tick={{ fontSize: 11, fill: 'var(--fg-2)' }} width={140} />
                  <Tooltip contentStyle={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8 }} />
                  <Bar dataKey="count" fill={RED} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function KPI({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 }}>
        <span style={{ color: accent ?? 'var(--fg-3)' }}>{icon}</span>{label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--fg-1)', marginTop: 6 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Card({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-2)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}
