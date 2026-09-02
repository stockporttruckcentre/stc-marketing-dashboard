'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, TrendingDown, TrendingUp } from 'lucide-react';
import {
  Alert, Badge, Card, EmptyState, Label, SectionHead, compactMoney, money,
} from '@/components/kit/primitives';
import { DataTable, Count, Money, type Col } from '@/components/revenue/table';
import { RankRow } from '@/components/analytics/chart';
import {
  OPEN_STAGES, STAGE_LABEL, monthsOfTheYear, sameMonthLastYear,
  type AgeBand, type Concentration, type Deal, type Mover, type Person,
  type Reconciliation, type Stage,
} from '@/lib/protean/finance';

/* =============================================================
   The drill downs.

   Everything a finance team is asked for once the headline number is on
   the screen. Each section answers one question somebody says out loud,
   and each is a table rather than a picture wherever the answer is a
   figure somebody will read out: a bar chart of eleven customers is a
   nice shape and useless for saying "Bigfoot are down forty one grand".

   Sorted by clicking a heading, because the order finance wants is not
   the order any of us would guess. Somebody chasing lost revenue sorts
   by change ascending; somebody writing a commission run sorts by
   margin. Both are the same table.
   ============================================================= */

const HUE: Record<string, string> = {
  stc: 'var(--chart-stc)',
  trailer: 'var(--chart-trailer)',
  rental: 'var(--chart-rental)',
};

const nowt = <span style={{ color: 'var(--text-subtle)' }}>—</span>;

const pct = (n: number | null | undefined) =>
  n == null ? null : `${n > 0 ? '+' : ''}${Number(n).toFixed(1)}%`;

/** Up in green, down in red, and nothing at all where it did not move. */
function Move({ n, showPct }: { n: number; showPct?: number | null }) {
  if (!n) return nowt;
  const up = n > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end',
      color: up ? 'var(--success)' : 'var(--danger)', fontVariantNumeric: 'tabular-nums',
    }}>
      <Icon size={12} style={{ flexShrink: 0 }} />
      <span style={{ fontFamily: 'var(--panton)', fontWeight: 700 }}>
        {up ? '+' : '-'}{compactMoney(Math.abs(n))}
      </span>
      {showPct != null && (
        <span style={{ opacity: 0.8, fontSize: 11.5 }}>{pct(showPct)}</span>
      )}
    </span>
  );
}

/* -------------------------------------------------------------
   Month by month, as a table.

   The chart above it says the shape. This says the numbers, because
   "which month was that dip" is answered by a chart and "how much were
   we down in June" is not.
   ------------------------------------------------------------- */
export type MonthRow = { month: string; division: string; name: string; net: number; deals: number };

export function MonthTable({ months, divisions, yearStart }: {
  months: MonthRow[];
  divisions: { division: string; name: string }[];
  yearStart?: number;
}) {
  const table = useMemo(() => {
    const keys = [...new Set(months.map((m) => m.month))].sort();
    const at = new Map<string, number>();
    for (const m of months) at.set(`${m.month}|${m.division}`, Number(m.net || 0));

    return monthsOfTheYear(keys, yearStart).map((month) => {
      const per = divisions.map((d) => at.get(`${month}|${d.division}`) ?? 0);
      const total = per.reduce((s, n) => s + n, 0);
      /* The same month a year earlier, which is the only honest
         comparison for a business with a seasonal shape. */
      const before = sameMonthLastYear(month);
      const last = divisions
        .map((d) => at.get(`${before}|${d.division}`) ?? 0)
        .reduce((s, n) => s + n, 0);
      return { month, per, total, last, change: total - last };
    });
  }, [months, divisions, yearStart]);

  if (!table.length) return null;

  const label = (m: string) =>
    new Date(`${m}T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  type Row = (typeof table)[number];
  const cols: Col<Row>[] = [
    {
      key: 'month', label: 'Month', flex: 1.4, minWidth: 120,
      cell: (r) => <span>{label(r.month)}</span>,
      sort: (r) => r.month,
    },
    ...divisions.map((d, i): Col<Row> => ({
      key: d.division, label: d.name, flex: 1, minWidth: 92, align: 'right',
      cell: (r) => (r.per[i] ? <Money quiet>{money(r.per[i]!)}</Money> : nowt),
      sort: (r) => r.per[i] ?? 0,
    })),
    {
      key: 'total', label: 'Total', flex: 1, minWidth: 96, align: 'right',
      cell: (r) => <Money>{money(r.total)}</Money>,
      sort: (r) => r.total,
    },
    {
      key: 'last', label: 'Same month last year', flex: 1.1, minWidth: 120, align: 'right',
      cell: (r) => (r.last ? <Money quiet>{money(r.last)}</Money> : nowt),
      sort: (r) => r.last,
    },
    {
      key: 'change', label: 'Variance', flex: 1, minWidth: 110, align: 'right',
      cell: (r) => <Move n={r.change} showPct={r.last ? (100 * r.change) / r.last : null} />,
      sort: (r) => r.change,
    },
  ];

  const sum = (pick: (r: Row) => number) => table.reduce((s, r) => s + pick(r), 0);

  return (
    <DataTable
      columns={cols}
      rows={table}
      rowKey={(r) => r.month}
      initial={{ key: 'month', desc: true }}
      footer={
        <div style={{
          display: 'flex', alignItems: 'center', minHeight: 38,
          background: 'var(--bg-subtle)', fontSize: 13,
        }}>
          <div style={{ flex: 1.4, minWidth: 120, padding: '0 14px' }}>
            <Label>Year to date</Label>
          </div>
          {divisions.map((d, i) => (
            <div key={d.division} style={{
              flex: 1, minWidth: 92, padding: '0 14px', textAlign: 'right',
              fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)',
            }}>{money(sum((r) => r.per[i] ?? 0))}</div>
          ))}
          <div style={{
            flex: 1, minWidth: 96, padding: '0 14px', textAlign: 'right',
            fontFamily: 'var(--panton)', fontWeight: 800, fontVariantNumeric: 'tabular-nums',
          }}>{money(sum((r) => r.total))}</div>
          <div style={{
            flex: 1.1, minWidth: 120, padding: '0 14px', textAlign: 'right',
            fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)',
          }}>{money(sum((r) => r.last))}</div>
          <div style={{ flex: 1, minWidth: 110, padding: '0 14px', textAlign: 'right' }}>
            <Move n={sum((r) => r.change)} />
          </div>
        </div>
      }
    />
  );
}

/* -------------------------------------------------------------
   The individual trailer sales.
   ------------------------------------------------------------- */
export function DealsTable({ deals }: { deals: Deal[] }) {
  if (!deals.length) {
    return (
      <EmptyState
        what="No trailers sold in this year yet"
        why="A trailer counts on the day it left the yard, so one ordered but not dispatched is still stock."
      />
    );
  }

  const cols: Col<Deal>[] = [
    {
      key: 'stc_no', label: 'STC no', flex: 0.7, minWidth: 78,
      cell: (d) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{d.stc_no ?? '—'}</span>,
      sort: (d) => d.stc_no,
    },
    {
      key: 'what', label: 'Trailer', flex: 1.5, minWidth: 150,
      cell: (d) => <span>{d.what || '—'}</span>,
      sort: (d) => d.what,
    },
    {
      key: 'customer', label: 'Customer', flex: 1.7, minWidth: 160,
      /* A name with a CRM record behind it goes through to it. One
         without cannot, and says so rather than looking clickable and
         doing nothing. */
      cell: (d) => (d.contact_id
        ? (
          <Link
            href={`/dashboard/crm?contact=${d.contact_id}`}
            style={{ color: 'var(--text)', textDecoration: 'none' }}
          >{d.customer}</Link>
        )
        : (
          <span style={{ color: 'var(--text-muted)' }}>
            {d.customer || '—'}
            {d.customer && <span style={{ color: 'var(--text-subtle)', fontSize: 11 }}> no record</span>}
          </span>
        )),
      sort: (d) => d.customer,
    },
    {
      key: 'sales_rep', label: 'Sold by', flex: 1, minWidth: 100,
      cell: (d) => <span style={{ color: 'var(--text-muted)' }}>{d.sales_rep ?? '—'}</span>,
      sort: (d) => d.sales_rep,
    },
    {
      key: 'sold', label: 'Dispatched', flex: 0.9, minWidth: 96,
      cell: (d) => (
        <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {d.sold
            ? new Date(`${d.sold}T00:00:00`).toLocaleDateString('en-GB',
              { day: '2-digit', month: 'short', year: '2-digit' })
            : '—'}
        </span>
      ),
      sort: (d) => d.sold,
    },
    {
      key: 'sales_price', label: 'Sold for', flex: 1, minWidth: 96, align: 'right',
      cell: (d) => (d.sales_price != null ? <Money>{money(d.sales_price)}</Money> : nowt),
      sort: (d) => Number(d.sales_price ?? 0),
    },
    {
      key: 'cost', label: 'Cost', flex: 1, minWidth: 92, align: 'right',
      cell: (d) => (d.cost != null ? <Money quiet>{money(d.cost)}</Money> : nowt),
      sort: (d) => Number(d.cost ?? 0),
    },
    {
      key: 'profit', label: 'Margin', flex: 1, minWidth: 100, align: 'right',
      cell: (d) => {
        if (d.profit == null) return nowt;
        const thin = d.profit_pct != null && d.profit_pct < 5;
        return (
          <span style={{
            fontFamily: 'var(--panton)', fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            /* Red on a thin one, because on a deal review that is the
               only row anybody wants to talk about. */
            color: d.profit < 0 || thin ? 'var(--danger)' : 'var(--text)',
          }}>
            {money(d.profit)}
            {d.profit_pct != null && (
              <span style={{ opacity: 0.7, fontWeight: 500, fontSize: 11.5 }}>
                {' '}{Number(d.profit_pct).toFixed(1)}%
              </span>
            )}
          </span>
        );
      },
      sort: (d) => Number(d.profit ?? 0),
    },
  ];

  const total = deals.reduce((s, d) => s + Number(d.sales_price ?? 0), 0);
  const margin = deals.reduce((s, d) => s + Number(d.profit ?? 0), 0);

  return (
    <>
      <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', marginBottom: 14 }}>
        <Stat label="Trailers sold" value={deals.length.toLocaleString('en-GB')} />
        <Stat label="Sold for" value={money(total)} />
        <Stat label="Margin" value={money(margin)}
          note={total ? `${((margin / total) * 100).toFixed(1)}% of the sale value` : undefined} />
        <Stat label="Average deal"
          value={deals.length ? money(Math.round(total / deals.length)) : '—'} />
      </div>
      <DataTable
        columns={cols}
        rows={deals}
        rowKey={(d) => d.id}
        initial={{ key: 'sold', desc: true }}
      />
    </>
  );
}

/* -------------------------------------------------------------
   Who is selling.
   ------------------------------------------------------------- */
export function PeopleTable({ people }: { people: Person[] }) {
  if (!people.length) {
    return <EmptyState what="Nobody has a sale or a lead against them" why="Trailer sales carry the name typed on the stock list, and leads carry their owner." />;
  }

  const orphans = people.filter((p) => !p.has_login).length;

  const cols: Col<Person>[] = [
    {
      key: 'person', label: 'Person', flex: 1.6, minWidth: 150,
      cell: (p) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          {p.person}
          {!p.has_login && (
            <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>no login</span>
          )}
        </span>
      ),
      sort: (p) => p.person,
    },
    {
      key: 'trailers', label: 'Trailers', flex: 0.7, minWidth: 78, align: 'right',
      cell: (p) => <Count n={p.trailers} />,
      sort: (p) => p.trailers,
    },
    {
      key: 'trailer_value', label: 'Sold for', flex: 1.1, minWidth: 100, align: 'right',
      cell: (p) => (p.trailer_value ? <Money>{money(p.trailer_value)}</Money> : nowt),
      sort: (p) => Number(p.trailer_value),
    },
    {
      key: 'trailer_margin', label: 'Margin', flex: 1, minWidth: 96, align: 'right',
      cell: (p) => (p.trailer_margin ? <Money quiet>{money(p.trailer_margin)}</Money> : nowt),
      sort: (p) => Number(p.trailer_margin),
    },
    {
      key: 'leads_open', label: 'Leads open', flex: 0.8, minWidth: 88, align: 'right',
      cell: (p) => <Count n={p.leads_open} />,
      sort: (p) => p.leads_open,
    },
    {
      key: 'pipeline_value', label: 'Pipeline', flex: 1.1, minWidth: 100, align: 'right',
      cell: (p) => (p.pipeline_value ? <Money quiet>{money(p.pipeline_value)}</Money> : nowt),
      sort: (p) => Number(p.pipeline_value),
    },
    {
      key: 'commission', label: 'Commission', flex: 1, minWidth: 100, align: 'right',
      cell: (p) => (p.commission ? <Money quiet>{money(p.commission)}</Money> : nowt),
      sort: (p) => Number(p.commission),
    },
  ];

  const paid = people.reduce((s, p) => s + Number(p.commission || 0), 0);

  return (
    <>
      <DataTable
        columns={cols}
        rows={people}
        rowKey={(p) => p.person}
        initial={{ key: 'trailer_value', desc: true }}
      />
      {/* The caveat sits under the table rather than in somebody's head.
          Two columns from two sources that do not join is a thing to
          say out loud, not a thing to leave somebody to work out when
          the numbers do not add up. */}
      <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-subtle)', lineHeight: 1.55 }}>
        Trailers come off the stock list and leads come off the CRM. They are shown side by
        side and never added: a trailer sale often has a lead against it too, and adding them
        would count that deal twice.
        {orphans > 0 && (
          <>
            {' '}
            {orphans} {orphans === 1 ? 'name matches' : 'names match'} nobody who can sign in.
            That is somebody who has left, or a name typed differently on the stock list, and
            it is shown rather than quietly merged into the nearest match.
          </>
        )}
        {paid === 0 && (
          <>
            {' '}
            No commission is recorded against any lead. The old screen showed a figure here
            worked out in the browser as ten per cent of the profit on every trailer. That rate
            was not held anywhere in the data, so this column now shows what has actually been
            filled in on a lead and nothing else.
          </>
        )}
      </div>
    </>
  );
}

/* -------------------------------------------------------------
   What is coming.
   ------------------------------------------------------------- */
export function Funnel({ stages }: { stages: Stage[] }) {
  const divisions = useMemo(() => {
    const seen = new Map<string, { division: string; name: string; sort_order: number }>();
    for (const s of stages) {
      if (!seen.has(s.division)) {
        seen.set(s.division, { division: s.division, name: s.name, sort_order: s.sort_order });
      }
    }
    return [...seen.values()].sort((a, b) => a.sort_order - b.sort_order);
  }, [stages]);

  const open = stages.filter((s) => OPEN_STAGES.has(s.stage));
  const worth = open.reduce((s, r) => s + Number(r.value || 0), 0);
  const count = open.reduce((s, r) => s + r.leads, 0);

  if (!stages.length) {
    return <EmptyState what="Nothing in the pipeline" why="A lead raised on the tracker appears here under its own division." />;
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', marginBottom: 16 }}>
        <Stat label="Open leads" value={count.toLocaleString('en-GB')} />
        <Stat label="Worth" value={money(worth)}
          note="Lead, contacted, quoted and won. A lead marked customer is already in the revenue above" />
      </div>

      <div style={{
        display: 'grid', gap: 14,
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
      }}>
        {divisions.map((d) => {
          const mine = stages.filter((s) => s.division === d.division)
            .sort((a, b) => a.stage_at - b.stage_at);
          const widest = Math.max(1, ...mine.map((s) => s.leads));
          return (
            <Card key={d.division}>
              <div style={{
                fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 14,
                marginBottom: 12, color: 'var(--text)',
              }}>{d.name}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {mine.map((s) => (
                  <RankRow
                    key={s.stage}
                    name={STAGE_LABEL[s.stage] ?? s.stage}
                    value={s.leads}
                    of={widest}
                    colour={s.stage === 'lost'
                      ? 'var(--text-subtle)'
                      : HUE[d.division] ?? 'var(--chart-company)'}
                    note={s.value ? compactMoney(Number(s.value)) : undefined}
                  />
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

/* -------------------------------------------------------------
   Who is growing, who is going, and how exposed we are.
   ------------------------------------------------------------- */
export function Customers({ movers, conc }: { movers: Mover[]; conc: Concentration | null }) {
  const cols: Col<Mover>[] = [
    {
      key: 'company_name', label: 'Customer', flex: 2, minWidth: 180,
      cell: (m) => (m.contact_id
        ? (
          <Link href={`/dashboard/crm?contact=${m.contact_id}`}
            style={{ color: 'var(--text)', textDecoration: 'none' }}>{m.company_name}</Link>
        )
        : <span>{m.company_name}</span>),
      sort: (m) => m.company_name,
    },
    {
      key: 'divisions', label: 'Buys', flex: 1.2, minWidth: 130,
      cell: (m) => <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{m.divisions ?? '—'}</span>,
      sort: (m) => m.divisions,
    },
    {
      key: 'last_year', label: 'Same point last year', flex: 1.2, minWidth: 130, align: 'right',
      cell: (m) => (Number(m.last_year) ? <Money quiet>{money(m.last_year)}</Money> : nowt),
      sort: (m) => Number(m.last_year),
    },
    {
      key: 'this_year', label: 'This year', flex: 1.1, minWidth: 108, align: 'right',
      cell: (m) => (Number(m.this_year) ? <Money>{money(m.this_year)}</Money> : nowt),
      sort: (m) => Number(m.this_year),
    },
    {
      key: 'change', label: 'Change', flex: 1.2, minWidth: 130, align: 'right',
      cell: (m) => <Move n={Number(m.change)} showPct={m.change_pct} />,
      sort: (m) => Number(m.change),
    },
  ];

  const fallers = movers.filter((m) => Number(m.change) < 0);

  return (
    <>
      {conc && conc.billed > 0 && (
        <Card style={{ marginBottom: 16 }}>
          <SectionHead
            title="How much of it is how few"
            hint="Measured over customers with a CRM record. Unplaced and set aside accounts are under Reconciliation."
          />
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginTop: 4 }}>
            <Stat label="Customers billing" value={conc.customers.toLocaleString('en-GB')} />
            <Stat
              label="Biggest customer"
              value={`${((conc.top_1 / conc.billed) * 100).toFixed(1)}%`}
              note={conc.biggest ? `${conc.biggest}, ${compactMoney(conc.top_1)}` : undefined}
            />
            <Stat label="Top five" value={`${((conc.top_5 / conc.billed) * 100).toFixed(1)}%`}
              note={compactMoney(conc.top_5)} />
            <Stat label="Top ten" value={`${((conc.top_10 / conc.billed) * 100).toFixed(1)}%`}
              note={compactMoney(conc.top_10)} />
            <Stat label="Average customer" value={money(Math.round(conc.average))} />
            <Stat label="Middle customer" value={money(Math.round(conc.median))}
              note="Half spend more than this, half less" />
          </div>
          {conc.top_10 / conc.billed > 0.5 && (
            <div style={{ marginTop: 14 }}>
              <Alert tone="warning">
                Ten customers are more than half the income. That is the number to have an
                answer ready for.
              </Alert>
            </div>
          )}
        </Card>
      )}

      <SectionHead
        title="Who has moved"
        hint="Maintenance and rental netted together. Trailer purchases are left out: a customer who bought last year and not this one has a trailer, not a problem."
      />
      {movers.length === 0 ? (
        <EmptyState what="Nobody has moved" why="Either trading is level or there is only one year of figures to compare." />
      ) : (
        <>
          <DataTable
            columns={cols}
            rows={movers}
            rowKey={(m) => m.contact_id ?? m.company_name}
            initial={{ key: 'change', desc: true }}
          />
          {fallers.length > 0 && (
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-subtle)' }}>
              {fallers.length} of these are spending less than at this point last year. Sort by
              Change to put them at the top: that is the call list.
            </div>
          )}
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------
   How old the open work is.
   ------------------------------------------------------------- */
export function Ageing({ bands }: { bands: AgeBand[] }) {
  const divisions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const b of bands) if (!seen.has(b.division)) seen.set(b.division, b.name);
    return [...seen.entries()];
  }, [bands]);

  const total = bands.reduce((s, b) => s + Number(b.value || 0), 0);
  const jobs = bands.reduce((s, b) => s + b.jobs, 0);
  const old = bands.filter((b) => b.band_at === 4);
  const oldValue = old.reduce((s, b) => s + Number(b.value || 0), 0);
  const oldJobs = old.reduce((s, b) => s + b.jobs, 0);

  if (!jobs) {
    return <EmptyState what="No work open" why="Import the open jobs export under Revenue and this fills in." />;
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', marginBottom: 16 }}>
        <Stat label="Open on the system" value={money(total)}
          note={`${jobs.toLocaleString('en-GB')} jobs`} />
        <Stat label="Over 90 days" value={money(oldValue)}
          note={`${oldJobs.toLocaleString('en-GB')} jobs`} />
        <Stat label="Share of it over 90 days"
          value={total ? `${((oldValue / total) * 100).toFixed(1)}%` : '—'} />
      </div>

      <div style={{
        display: 'grid', gap: 14,
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
      }}>
        {divisions.map(([slug, name]) => {
          const mine = bands.filter((b) => b.division === slug)
            .sort((a, b) => a.band_at - b.band_at);
          const most = Math.max(1, ...mine.map((b) => Number(b.value || 0)));
          const mineTotal = mine.reduce((s, b) => s + Number(b.value || 0), 0);
          return (
            <Card key={slug}>
              <div style={{
                display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12,
              }}>
                <span style={{
                  fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 14, color: 'var(--text)',
                }}>{name}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{money(mineTotal)}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {mine.map((b) => (
                  <RankRow
                    key={b.band}
                    name={b.band}
                    value={Number(b.value || 0)}
                    of={most}
                    /* The oldest band always in red. Anything sitting on
                       the ramps past ninety days is the reason this
                       section exists. */
                    colour={b.band_at === 4 ? 'var(--danger)' : HUE[slug] ?? 'var(--chart-company)'}
                    note={b.jobs ? `${b.jobs} ${b.jobs === 1 ? 'job' : 'jobs'}` : undefined}
                  />
                ))}
              </div>
            </Card>
          );
        })}
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-subtle)', lineHeight: 1.55 }}>
        Aged on the day the job was raised on Protean, not on the day we imported it. A job with
        no date on the export is its own band rather than being counted as new.
      </div>
    </>
  );
}

/* -------------------------------------------------------------
   Why the customers do not add up to the total.
   ------------------------------------------------------------- */
export function Reconcile({ rows }: { rows: Reconciliation[] }) {
  if (!rows.length) {
    return <EmptyState what="Nothing to reconcile" why="No Protean invoices have been imported for this year." />;
  }

  const gap = rows.reduce((s, r) => s + Number(r.unattributed || 0), 0);
  const aside = rows.reduce((s, r) => s + Number(r.set_aside || 0), 0);
  const unplaced = rows.reduce((s, r) => s + r.unattributed_n, 0);

  const cols: Col<Reconciliation>[] = [
    {
      key: 'name', label: 'Division', flex: 1.4, minWidth: 130,
      cell: (r) => <span>{r.name}</span>,
      sort: (r) => r.sort_order,
    },
    {
      key: 'billed', label: 'Invoiced', flex: 1.2, minWidth: 110, align: 'right',
      cell: (r) => <Money>{money(r.billed)}</Money>,
      sort: (r) => Number(r.billed),
    },
    {
      key: 'on_customers', label: 'On a customer record', flex: 1.4, minWidth: 140, align: 'right',
      cell: (r) => <Money quiet>{money(r.on_customers)}</Money>,
      sort: (r) => Number(r.on_customers),
    },
    {
      key: 'unattributed', label: 'Not placed yet', flex: 1.3, minWidth: 130, align: 'right',
      cell: (r) => (Number(r.unattributed)
        ? (
          <span style={{ color: 'var(--warning)', fontVariantNumeric: 'tabular-nums' }}>
            {money(r.unattributed)}
            <span style={{ color: 'var(--text-subtle)', fontSize: 11 }}>
              {' '}{r.unattributed_n} {r.unattributed_n === 1 ? 'account' : 'accounts'}
            </span>
          </span>
        )
        : nowt),
      sort: (r) => Number(r.unattributed),
    },
    {
      key: 'set_aside', label: 'Set aside', flex: 1.2, minWidth: 120, align: 'right',
      cell: (r) => (Number(r.set_aside)
        ? (
          <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {money(r.set_aside)}
            <span style={{ color: 'var(--text-subtle)', fontSize: 11 }}>
              {' '}{r.set_aside_n} {r.set_aside_n === 1 ? 'account' : 'accounts'}
            </span>
          </span>
        )
        : nowt),
      sort: (r) => Number(r.set_aside),
    },
  ];

  return (
    <>
      <SectionHead
        title="Where every pound of it sits"
        hint="The three columns on the right add to Invoiced exactly. Trailer sales are not here: a trailer is sold to a named customer or it is not sold."
      />
      <DataTable columns={cols} rows={rows} rowKey={(r) => r.division} initial={{ key: 'name' }} />

      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {gap > 0 && (
          <Alert tone="warning">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={13} style={{ flexShrink: 0 }} />
              <span>
                {money(gap)} across {unplaced} {unplaced === 1 ? 'account' : 'accounts'} is in
                the company total and on nobody&apos;s customer record, because nobody has said
                who those Protean accounts are yet. Until they are placed, a per customer report
                will be short by that much.
              </span>
            </span>
            <div style={{ marginTop: 8 }}>
              <Link href="/dashboard/revenue/stc" style={{ textDecoration: 'none' }}>
                <Badge tone="warning">
                  Place them under Revenue, Accounts <ArrowRight size={11} />
                </Badge>
              </Link>
            </div>
          </Alert>
        )}
        {aside > 0 && (
          <div style={{ fontSize: 12.5, color: 'var(--text-subtle)', lineHeight: 1.55 }}>
            {money(aside)} is on accounts deliberately set aside as not customers: cash sales,
            and the group&apos;s own leasing company. It is real revenue and it is in the
            company total, and it is nobody&apos;s portfolio, so it is in no salesperson&apos;s
            figures either.
          </div>
        )}
      </div>
    </>
  );
}

/* ---------- shared ---------- */

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div style={{ minWidth: 120 }}>
      <Label>{label}</Label>
      <div style={{
        fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 22, marginTop: 5,
        fontVariantNumeric: 'tabular-nums', color: 'var(--text)', letterSpacing: '-0.02em',
      }}>{value}</div>
      {note && (
        <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 3, maxWidth: 260 }}>
          {note}
        </div>
      )}
    </div>
  );
}
