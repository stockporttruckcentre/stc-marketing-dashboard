'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TrendingUp, TrendingDown, Minus, ArrowRight, Wrench, Container, KeyRound, RotateCcw,
} from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  Alert, Badge, Button, Card, EmptyState, Label, PageHead, SectionHead, Tabs,
  compactMoney, money,
} from '@/components/kit/primitives';
import { TextInput } from '@/components/kit/forms';
import { MonthlyBars, SplitBar, RankRow, type Point } from '@/components/analytics/chart';
import {
  Ageing, Customers, DealsTable, Funnel, MonthTable, PeopleTable, Reconcile,
} from '@/components/analytics/sections';
import { readable } from '@/lib/protean/rpc';
import {
  VIEWS, concentration, customerMovement, openWorkAgeing, pipelineByStage, reconciliation,
  salesByPerson, trailerDeals, viewFrom,
  type AnalyticsView,
  type AgeBand, type Concentration, type Deal, type Mover, type Person,
  type Reconciliation, type Stage,
} from '@/lib/protean/finance';

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

/* Data colours, which are their own axis in the kit and not the action
   colours. A division is the same colour in both themes; `--primary`
   and `--accent` invert between them, because a button has to. */
const HUE: Record<string, string> = {
  stc: 'var(--chart-stc)',
  trailer: 'var(--chart-trailer)',
  rental: 'var(--chart-rental)',
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

/* The drill downs, in the order somebody works through them in a
   meeting: the shape of the year, then the deals inside it, then the
   people, then what is coming, then the customers, then the work that
   is not billed yet, and last the sentence that makes all of it
   defensible. */

/** Everything the drill down tabs read, loaded once each and kept. */
type Deep = {
  deals: Deal[];
  people: Person[];
  stages: Stage[];
  movers: Mover[];
  conc: Concentration | null;
  bands: AgeBand[];
  recon: Reconciliation[];
};

export function AnalyticsHub() {
  const supabase = createClient();
  /* `?view=deals` so the command bar can land on a section rather than
     on the page it happens to sit behind. An action that navigates to
     the right screen and the wrong tab has answered a different
     question from the one somebody typed. */
  const params = useSearchParams();

  const [divisions, setDivisions] = useState<Division[]>([]);
  const [months, setMonths] = useState<MonthRow[]>([]);
  const [pipeline, setPipeline] = useState<Pipeline[]>([]);
  const [top, setTop] = useState<Record<string, TopCustomer[]>>({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);

  const [tab, setTab] = useState<AnalyticsView>(() => viewFrom(params.get('view')));
  const [deep, setDeep] = useState<Deep | null>(null);
  const [deepFailed, setDeepFailed] = useState<string | null>(null);

  /* THE AS AT DATE.

     A board pack is dated, and the figure quoted on Tuesday has to
     still be the figure on Friday. Empty means today, which is what
     somebody wants ninety nine times in a hundred, and the hundredth is
     "read it as it stood at the end of the quarter" and now possible.

     `asked` is what the box holds; `upto` is what goes to the database,
     and only once it is a real date. A half typed 2026-0 must not send
     a query. */
  const [asked, setAsked] = useState('');
  const upto = /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : undefined;

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(null);
    try {
      const [rev, mth, pipe] = await Promise.all([
        supabase.rpc('division_revenue', { p_upto: upto ?? null }),
        supabase.rpc('division_by_month', { p_months: 24, p_upto: upto ?? null }),
        supabase.rpc('division_pipeline'),
      ]);
      /* Through the same translator as everything else, so a database
         that is behind the application says so rather than quoting
         PostgREST's schema cache at somebody. */
      if (rev.error) throw readable(rev.error);
      if (mth.error) throw readable(mth.error);
      if (pipe.error) throw readable(pipe.error);

      const rows = (rev.data ?? []) as Division[];
      setDivisions(rows);
      setMonths((mth.data ?? []) as MonthRow[]);
      setPipeline((pipe.data ?? []) as Pipeline[]);

      const lists = await Promise.all(rows.map(async (d) => {
        const { data } = await supabase.rpc('division_customers', {
          p_division: d.division, p_upto: upto ?? null, p_limit: 8,
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
  }, [supabase, upto]);

  /* The seven drill down reads, in one go rather than one per tab.

     Loading each tab as it is opened would be tidier and is wrong for
     what this screen is for: somebody presenting does not want a pause
     every time they click, and by the time the overview has painted
     they have already decided which tab they are going to. So they all
     arrive together, once, and clicking is instant afterwards. */
  const loadDeep = useCallback(async () => {
    setDeepFailed(null);
    try {
      const [deals, people, stages, movers, conc, bands, recon] = await Promise.all([
        trailerDeals(supabase, upto, 500),
        salesByPerson(supabase, upto),
        pipelineByStage(supabase),
        customerMovement(supabase, upto, 25),
        concentration(supabase, null, upto),
        openWorkAgeing(supabase, null, upto),
        reconciliation(supabase, upto),
      ]);
      setDeep({ deals, people, stages, movers, conc, bands, recon });
    } catch (e) {
      setDeepFailed(e instanceof Error ? e.message : 'The detail would not load.');
    }
  }, [supabase, upto]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setDeep(null); void loadDeep(); }, [loadDeep]);

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
          why={failed}
          action={<Button variant="secondary" onClick={() => void load()}>Try again</Button>}
        />
      </div>
    );
  }

  const nothingYet = company.thisYear === 0 && company.lastYear === 0 && company.outstanding === 0;

  return (
    <div className="kit" style={PAGE}>
      <div style={{
        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
        gap: 20, flexWrap: 'wrap',
      }}>
        <PageHead
          eyebrow="Analytics"
          title="The company"
          sub={yearLabel
            ? `The year from ${yearLabel}, against the same point in the year before it.`
            : 'Every division, on the company year.'}
        />
        <AsAt value={asked} onChange={setAsked} />
      </div>

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

          {/* ---- And then everything underneath it ----

              The three columns answer "how big is each part of it",
              which is the first question in a meeting and never the
              last. Everything below is the questions that follow, and
              they are behind tabs rather than stacked down one page
              because seven sections of table is a document, not a
              screen somebody presents from. */}
          <div style={{ marginBottom: 16 }}>
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={VIEWS.map((t) => ({
                ...t,
                count: t.key === 'deals' ? deep?.deals.length
                  : t.key === 'people' ? deep?.people.length
                    : t.key === 'customers' ? deep?.movers.length
                      : undefined,
              }))}
            />
          </div>

          {deepFailed && tab !== 'overview' ? (
            <EmptyState
              what="The detail could not be read"
              why={deepFailed}
              action={<Button variant="secondary" onClick={() => void loadDeep()}>Try again</Button>}
            />
          ) : null}

          {tab === 'overview' && (
            <>
              <Card style={{ marginBottom: 16 }}>
                <SectionHead
                  title="The company, month by month"
                  hint="Two years. The dashed rule is where a financial year began."
                />
                <MonthlyBars
                  points={allMonths}
                  colour="var(--chart-company)"
                  height={190}
                  yearStart={yearStartMonth}
                />
              </Card>
              <SectionHead
                title="The same thing, as figures"
                hint="Each month of the year running, against the same month a year earlier."
              />
              <MonthTable
                months={months}
                divisions={divisions.map((d) => ({ division: d.division, name: d.name }))}
                yearStart={yearStartMonth}
              />
            </>
          )}

          {!deepFailed && tab !== 'overview' && !deep && (
            <Card>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Reading the detail.</span>
            </Card>
          )}

          {deep && tab === 'deals' && <DealsTable deals={deep.deals} />}
          {deep && tab === 'people' && <PeopleTable people={deep.people} />}
          {deep && tab === 'pipeline' && <Funnel stages={deep.stages} />}
          {deep && tab === 'customers' && <Customers movers={deep.movers} conc={deep.conc} />}
          {deep && tab === 'work' && <Ageing bands={deep.bands} />}
          {deep && tab === 'reconcile' && <Reconcile rows={deep.recon} />}
        </>
      )}
    </div>
  );
}

/**
 * The date every figure on the screen is read to.
 *
 * A board pack is dated. Somebody quoting a number on Tuesday has to be
 * able to produce the same number on Friday, and "the year to date"
 * quietly means something different on each of those days.
 *
 * Empty is today, which is what almost everybody wants almost always,
 * so the control is out of the way rather than a decision to be made
 * before the screen will render anything.
 */
function AsAt({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, paddingBottom: 4 }}>
      <div>
        <Label>Read as at</Label>
        <div style={{ width: 148, marginTop: 5 }}>
          <TextInput type="date" value={value} onChange={onChange} />
        </div>
      </div>
      {value && (
        <Button variant="ghost" size="sm" onClick={() => onChange('')}>
          <RotateCcw size={12} />
          Today
        </Button>
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
