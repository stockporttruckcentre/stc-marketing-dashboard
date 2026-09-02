'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TrendingUp, TrendingDown, Minus, ArrowRight, Wrench, Container, KeyRound,
} from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  Alert, Badge, Button, Card, EmptyState, Label, PageHead, SectionHead,
  compactMoney, money,
} from '@/components/kit/primitives';
import { useToast } from '@/components/kit/toast';
import { MonthlyBars, SplitBar, RankRow, type Point } from '@/components/analytics/chart';

/* =============================================================
   The company, three divisions wide.

   From the business:

     the analytics page he wants splitting in to 3 divisions (vertical
     columns) - STC - Trailer Sales - Rental ... Has to be robust and
     well connected to present the data to our finance teams who'll want
     to drill into things.

   ---- Why three columns and not three tabs ----

   Because the question is comparative. "How is rental doing" is nearly
   always "how is rental doing compared with the rest of it", and tabs
   make somebody hold one number in their head while they go and find
   the other. Side by side, the comparison is the layout.

   That only works if the columns really are comparable, which is the
   whole job of `division_revenue`: one year, one like for like cut, one
   shape of answer, across three sources that have nothing else in
   common.

   ---- What is deliberately not the same in all three ----

   Only trailer sales record a cost, so only trailer sales show a
   margin. The other two say nothing rather than nought, because nought
   reads as "we made nothing on it".

   Outstanding means different things too: work on the ramps for the two
   Protean divisions, stock on the yard for the third. Both are money
   committed and not yet billed, and each column says which it means
   rather than sharing one heading that is true of neither.

   ---- Colour ----

   The kit's rule is that navy acts and red points. Neither is a data
   colour, so the three divisions get three quiet hues from the kit's
   own palette and red stays free to mean "this one is down", which is
   the only thing on this screen worth pointing at.
   ============================================================= */

type Division = {
  division: 'stc' | 'trailer' | 'rental';
  name: string;
  sort_order: number;
  this_year: number;
  last_year: number;
  last_year_full: number;
  change: number;
  deals: number;
  customers: number;
  margin: number | null;
  outstanding: number;
  outstanding_n: number;
  outstanding_of: string;
  fy_started: string;
  last_activity: string | null;
};

type MonthRow = { month: string; division: string; name: string; net: number; deals: number };
type Pipeline = { division: string; name: string; leads: number; value: number; won_this_year: number };
type TopCustomer = {
  contact_id: string | null;
  company_name: string;
  this_year: number;
  last_year: number;
  change: number;
  deals: number;
  placed: boolean;
};

const HUE: Record<string, string> = {
  stc: 'var(--info)',
  trailer: 'var(--accent-2, #2F6F5E)',
  rental: 'var(--warning)',
};

const ICON: Record<string, typeof Wrench> = {
  stc: Wrench,
  trailer: Container,
  rental: KeyRound,
};

/** Where a division's own screen lives, for the drill in. */
const GOES_TO: Record<string, string> = {
  stc: '/dashboard/revenue/stc',
  rental: '/dashboard/revenue/rental',
  trailer: '/dashboard/sales',
};

export function AnalyticsHub() {
  const supabase = createClient();
  const { say } = useToast();

  const [divisions, setDivisions] = useState<Division[]>([]);
  const [months, setMonths] = useState<MonthRow[]>([]);
  const [pipeline, setPipeline] = useState<Pipeline[]>([]);
  const [top, setTop] = useState<Record<string, TopCustomer[]>>({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(null);
    try {
      const [rev, mth, pipe] = await Promise.all([
        supabase.rpc('division_revenue', { p_upto: null }),
        supabase.rpc('division_by_month', { p_months: 24, p_upto: null }),
        supabase.rpc('division_pipeline'),
      ]);
      if (rev.error) throw new Error(rev.error.message);

      const rows = (rev.data ?? []) as Division[];
      setDivisions(rows);
      setMonths((mth.data ?? []) as MonthRow[]);
      setPipeline((pipe.data ?? []) as Pipeline[]);

      const lists = await Promise.all(rows.map(async (d) => {
        const { data } = await supabase.rpc('division_customers', {
          p_division: d.division, p_upto: null, p_limit: 8,
        });
        return [d.division, (data ?? []) as TopCustomer[]] as const;
      }));
      setTop(Object.fromEntries(lists));
    } catch (e) {
      /* Said out loud. A revenue screen that renders zeroes when it
         could not read is indistinguishable from a company that has
         stopped trading. */
      setFailed(e instanceof Error ? e.message : 'The figures would not load.');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  const company = useMemo(() => ({
    thisYear: divisions.reduce((s, d) => s + Number(d.this_year || 0), 0),
    lastYear: divisions.reduce((s, d) => s + Number(d.last_year || 0), 0),
    lastYearFull: divisions.reduce((s, d) => s + Number(d.last_year_full || 0), 0),
    outstanding: divisions.reduce((s, d) => s + Number(d.outstanding || 0), 0),
  }), [divisions]);

  const yearLabel = divisions[0]?.fy_started
    ? new Date(`${divisions[0].fy_started}T00:00:00`).toLocaleDateString('en-GB', {
      month: 'short', year: 'numeric',
    })
    : null;
  const yearStartMonth = divisions[0]?.fy_started
    ? Number(divisions[0].fy_started.slice(5, 7))
    : undefined;

  const seriesFor = useCallback((slug: string): Point[] =>
    months.filter((m) => m.division === slug)
      .map((m) => ({ month: m.month, value: Number(m.net || 0) })),
  [months]);

  const allMonths = useMemo<Point[]>(() => {
    const byMonth = new Map<string, number>();
    for (const m of months) {
      byMonth.set(m.month, (byMonth.get(m.month) ?? 0) + Number(m.net || 0));
    }
    return [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, value]) => ({ month, value }));
  }, [months]);

  if (loading) {
    return (
      <div className="kit" style={PAGE}>
        <PageHead eyebrow="Analytics" title="The company" />
        <Card><span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Reading the figures.</span></Card>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="kit" style={PAGE}>
        <PageHead eyebrow="Analytics" title="The company" />
        <EmptyState
          what="The figures could not be read"
          why={failed.includes('does not exist')
            ? 'The division migrations are not on this database yet. Run them and this fills in.'
            : failed}
          action={<Button variant="secondary" onClick={() => void load()}>Try again</Button>}
        />
      </div>
    );
  }

  const nothingYet = company.thisYear === 0 && company.lastYear === 0 && company.outstanding === 0;

  return (
    <div className="kit" style={PAGE}>
      <PageHead
        eyebrow="Analytics"
        title="The company"
        sub={yearLabel
          ? `The year from ${yearLabel}, against the same point in the year before it.`
          : 'Every division, on the company year.'}
      />

      {nothingYet ? (
        <EmptyState
          what="Nothing to measure yet"
          why="No revenue has been imported and no trailers are recorded as sold. Import the Protean exports under Revenue and this fills in."
          action={
            <Link href="/dashboard/revenue/stc">
              <Button variant="primary">Go to Revenue</Button>
            </Link>
          }
        />
      ) : (
        <>
          {/* ---- The company, before the parts of it ---- */}
          <Card style={{ marginBottom: 18 }}>
            <div style={{
              display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-end',
              marginBottom: 18,
            }}>
              <div style={{ minWidth: 200 }}>
                <Label>{yearLabel ? `Invoiced since ${yearLabel}` : 'Invoiced this year'}</Label>
                <div style={{
                  fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 38, lineHeight: 1.05,
                  letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums',
                  color: 'var(--text)', marginTop: 6,
                }}>{money(company.thisYear)}</div>
                <div style={{ marginTop: 6 }}>
                  <Movement from={company.lastYear} to={company.thisYear} big />
                </div>
              </div>

              <Figure label="Same point last year" value={money(company.lastYear)} quiet />
              <Figure label="Whole of last year" value={money(company.lastYearFull)} quiet />
              <Figure
                label="Committed, not yet billed"
                value={money(company.outstanding)}
                note="Work on the ramps, plus stock on the yard"
              />
            </div>

            <SplitBar
              parts={divisions.map((d) => ({
                key: d.division,
                name: d.name,
                value: Number(d.this_year || 0),
                colour: HUE[d.division] ?? 'var(--text-subtle)',
              }))}
            />
          </Card>

          {/* ---- The three columns ---- */}
          <div style={{
            display: 'grid', gap: 16, marginBottom: 18, alignItems: 'start',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          }}>
            {divisions.map((d) => (
              <DivisionColumn
                key={d.division}
                d={d}
                series={seriesFor(d.division)}
                yearStart={yearStartMonth}
                pipeline={pipeline.find((p) => p.division === d.division)}
                customers={top[d.division] ?? []}
              />
            ))}
          </div>

          {/* ---- Everything, over two years ---- */}
          <Card>
            <SectionHead
              title="The company, month by month"
              hint="Two years. The dashed rule is where a financial year began."
            />
            <MonthlyBars
              points={allMonths}
              colour="var(--primary)"
              height={190}
              yearStart={yearStartMonth}
            />
          </Card>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------
   One division.
   ------------------------------------------------------------- */
function DivisionColumn({ d, series, yearStart, pipeline, customers }: {
  d: Division;
  series: Point[];
  yearStart?: number;
  pipeline?: Pipeline;
  customers: TopCustomer[];
}) {
  const colour = HUE[d.division] ?? 'var(--text-subtle)';
  const Icon = ICON[d.division] ?? Wrench;
  const unplaced = customers.filter((c) => !c.placed).length;

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
        <span style={{
          width: 26, height: 26, borderRadius: 'var(--r)', flexShrink: 0,
          background: colour, opacity: 0.16,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={14} style={{ color: colour, opacity: 1 }} />
        </span>
        <span style={{
          fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 16,
          letterSpacing: '-0.01em', color: 'var(--text)', flex: 1,
        }}>{d.name}</span>
        <Link href={GOES_TO[d.division] ?? '/dashboard'}>
          <Button variant="ghost" size="sm">
            Open
            <ArrowRight size={12} />
          </Button>
        </Link>
      </div>

      <div style={{
        fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 28, lineHeight: 1.1,
        letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
      }}>{money(d.this_year)}</div>
      <div style={{ marginTop: 5 }}>
        <Movement from={Number(d.last_year || 0)} to={Number(d.this_year || 0)} />
      </div>

      <div style={{ marginTop: 14 }}>
        <MonthlyBars points={series} colour={colour} height={92} yearStart={yearStart} />
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16,
        paddingTop: 14, borderTop: '1px solid var(--border)',
      }}>
        <Small label="Whole of last year" value={money(d.last_year_full)} />
        <Small
          label={d.division === 'trailer' ? 'Trailers sold' : 'Invoices'}
          value={Number(d.deals || 0).toLocaleString('en-GB')}
        />
        <Small
          label={d.outstanding_of === 'in stock' ? 'Stock on the yard' : 'Open on the system'}
          value={money(d.outstanding)}
          note={`${Number(d.outstanding_n || 0).toLocaleString('en-GB')} ${d.outstanding_of}`}
        />
        {/* Margin only where a cost is recorded. Nought would read as
            "we made nothing on it", which is a different sentence. */}
        {d.margin != null ? (
          <Small
            label="Margin"
            value={money(d.margin)}
            note={Number(d.this_year)
              ? `${((Number(d.margin) / Number(d.this_year)) * 100).toFixed(1)}%`
              : undefined}
          />
        ) : (
          <Small label="Margin" value="Not recorded" quiet note="No cost is held for this work" />
        )}
      </div>

      {pipeline && (pipeline.leads > 0 || pipeline.won_this_year > 0) && (
        <div style={{
          marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <Label>Pipeline</Label>
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            {pipeline.leads} open, worth {compactMoney(Number(pipeline.value || 0))}
          </span>
          {pipeline.won_this_year > 0 && (
            <Badge tone="success">{pipeline.won_this_year} won this year</Badge>
          )}
        </div>
      )}

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <Label>Biggest this year</Label>
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {customers.length === 0 && (
            <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>
              Nothing billed in this division yet.
            </span>
          )}
          {customers.map((c) => (
            <RankRow
              key={`${c.contact_id ?? c.company_name}`}
              name={c.company_name}
              value={Number(c.this_year || 0)}
              of={Number(d.this_year || 0)}
              colour={colour}
              note={c.placed ? undefined : 'no record'}
              onClick={c.contact_id
                ? () => window.location.assign(`/dashboard/crm?contact=${c.contact_id}`)
                : undefined}
            />
          ))}
        </div>
        {unplaced > 0 && (
          <div style={{ marginTop: 10 }}>
            <Alert tone="warning">
              {unplaced} of these {unplaced === 1 ? 'is' : 'are'} on an account with no CRM
              record, so {unplaced === 1 ? 'it is' : 'they are'} in this column and on nobody&apos;s
              customer page. They are waiting under Revenue, Accounts.
            </Alert>
          </div>
        )}
      </div>
    </Card>
  );
}

/* ---------- the small shared pieces ---------- */

const PAGE: React.CSSProperties = {
  padding: '22px 24px 40px', maxWidth: 1420, margin: '0 auto',
};

function Figure({ label, value, note, quiet }: {
  label: string; value: string; note?: string; quiet?: boolean;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div style={{
        fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 21, marginTop: 5,
        fontVariantNumeric: 'tabular-nums',
        color: quiet ? 'var(--text-muted)' : 'var(--text)',
      }}>{value}</div>
      {note && (
        <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 3 }}>{note}</div>
      )}
    </div>
  );
}

function Small({ label, value, note, quiet }: {
  label: string; value: string; note?: string; quiet?: boolean;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div style={{
        fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 15, marginTop: 4,
        fontVariantNumeric: 'tabular-nums',
        color: quiet ? 'var(--text-subtle)' : 'var(--text)',
      }}>{value}</div>
      {note && (
        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>{note}</div>
      )}
    </div>
  );
}

/**
 * Up, down or level against the same point last year.
 *
 * Red only ever means down here. The kit keeps red for the single most
 * important thing on a screen and for destructive intent, and on a
 * board's revenue page a division going backwards is exactly that.
 */
function Movement({ from, to, big }: { from: number; to: number; big?: boolean }) {
  const diff = to - from;
  const pct = from ? (100 * diff) / from : null;
  const colour = diff > 0 ? 'var(--success)' : diff < 0 ? 'var(--danger)' : 'var(--text-subtle)';
  const Icon = diff > 0 ? TrendingUp : diff < 0 ? TrendingDown : Minus;

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      color: colour, fontSize: big ? 14 : 12.5,
      fontVariantNumeric: 'tabular-nums',
    }}>
      <Icon size={big ? 16 : 13} style={{ flexShrink: 0 }} />
      <span style={{ fontFamily: 'var(--panton)', fontWeight: 700 }}>
        {diff === 0 ? 'level with last year' : `${diff > 0 ? '+' : '-'}${compactMoney(Math.abs(diff))}`}
      </span>
      {pct != null && diff !== 0 && (
        <span style={{ opacity: 0.85 }}>{Math.abs(pct).toFixed(1)}%</span>
      )}
      {from === 0 && diff !== 0 && (
        <span style={{ color: 'var(--text-subtle)', fontSize: 11.5 }}>nothing last year</span>
      )}
    </span>
  );
}
