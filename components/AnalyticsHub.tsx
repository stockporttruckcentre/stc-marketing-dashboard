'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, Container, KeyRound, Minus, RotateCcw, TrendingDown, TrendingUp, Wrench,
} from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  Alert, Badge, Button, Card, EmptyState, Label, PageHead, compactMoney, money,
} from '@/components/kit/primitives';
import { TextInput } from '@/components/kit/forms';
import { MonthlyStack, Sparkline, type MonthPoint } from '@/components/analytics/monthly';
import { RankRow } from '@/components/analytics/chart';
import { DivisionDetail, WaitingOnARecord } from '@/components/analytics/sections';
import { readable } from '@/lib/protean/rpc';
import {
  concentration, customerMovement, openWorkAgeing, pipelineByStage, reconciliation,
  salesByPerson, trailerCustomersWaiting, trailerDeals,
  type AgeBand, type Concentration, type Deal, type Mover, type Person,
  type Reconciliation, type Stage, type TrailerWaiting,
} from '@/lib/protean/finance';

/* =============================================================
   The company, three divisions wide.

   ---- Why three columns and not tabs ----

   Because the question is comparative. "How is rental doing" is nearly
   always "how is rental doing compared with the rest of it", and tabs
   make somebody hold one number in their head while they go and find
   the other.

   That applied to the drill downs too, and I built them as tabs anyway.
   From the business:

     Not keen on tabs here, people miss tabs. I'm sure you could fit it
     in the columns still.

   Right on both counts. Everything that was behind a tab is now in the
   column it belongs to, because every one of those questions was about
   a division: which deals, who is selling, what is coming, how old the
   open work is, and what is not on a customer record.

   ---- And what was dropped rather than moved ----

     Tabulating all the deals/who is selling etc - not keen on these
     tabulated lists. We have this data in the crm already, it's more
     duplication than quick summary for the finance team

   So the tables went. A hundred row list of every trailer sold is the
   trailer sales screen's job and it does it better. What a column
   carries instead is the shape of it: how many, worth how much, at what
   margin, and the biggest few, each of which goes through to the
   record. Everything else is one click away on the screen that owns it.
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

/** Everything the columns read beyond the headline figures. */
type Deep = {
  deals: Deal[];
  people: Person[];
  stages: Stage[];
  movers: Mover[];
  conc: Concentration | null;
  bands: AgeBand[];
  recon: Reconciliation[];
  waiting: TrailerWaiting[];
};

export function AnalyticsHub() {
  const supabase = createClient();

  const [divisions, setDivisions] = useState<Division[]>([]);
  const [months, setMonths] = useState<MonthRow[]>([]);
  const [pipeline, setPipeline] = useState<Pipeline[]>([]);
  const [top, setTop] = useState<Record<string, TopCustomer[]>>({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);

  const [deep, setDeep] = useState<Deep | null>(null);
  const [deepFailed, setDeepFailed] = useState<string | null>(null);

  /* THE AS AT DATE.

     A board pack is dated, and the figure quoted on Tuesday has to
     still be the figure on Friday. Empty means today, which is what
     somebody wants ninety nine times in a hundred.

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
          p_division: d.division, p_upto: upto ?? null, p_limit: 5,
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

  const loadDeep = useCallback(async () => {
    setDeepFailed(null);
    try {
      const [deals, people, stages, movers, conc, bands, recon, waiting] = await Promise.all([
        trailerDeals(supabase, upto, 500),
        salesByPerson(supabase, upto),
        pipelineByStage(supabase),
        customerMovement(supabase, upto, 8),
        concentration(supabase, null, upto),
        openWorkAgeing(supabase, null, upto),
        reconciliation(supabase, upto),
        trailerCustomersWaiting(supabase, upto),
      ]);
      setDeep({ deals, people, stages, movers, conc, bands, recon, waiting });
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

  /* One point per month carrying every division's figure, which is what
     the stack needs and what a per division filter would have to be
     undone to get. */
  const stack = useMemo<MonthPoint[]>(() => {
    const at = new Map<string, number>();
    for (const m of months) at.set(`${m.month}|${m.division}`, Number(m.net || 0));
    return [...new Set(months.map((m) => m.month))].sort().map((month) => ({
      month,
      values: divisions.map((d) => at.get(`${month}|${d.division}`) ?? 0),
    }));
  }, [months, divisions]);

  const seriesOf = useCallback((slug: string): number[] => {
    const mine = months.filter((m) => m.division === slug)
      .sort((a, b) => a.month.localeCompare(b.month));
    /* The year running only. The column is about this year, and a two
       year sparkline in a 46 pixel box says nothing about either. */
    const from = yearStartMonth
      ? [...mine].reverse().find((m) => Number(m.month.slice(5, 7)) === yearStartMonth)?.month
      : undefined;
    return (from ? mine.filter((m) => m.month >= from) : mine.slice(-12))
      .map((m) => Number(m.net || 0));
  }, [months, yearStartMonth]);

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
          {/* ---- The company, in one line ----

              This was a card with a 38px number and four figures
              stacked under their own labels, and it was reported as
              looking awful. It was: four columns of Panton at four
              sizes, arranged by accident, taking a third of the fold to
              say one thing.

              One number is the headline. Everything else is a
              supporting figure at one size on one baseline, and the
              division split is a strip on the same card rather than a
              separate block with a legend under it. */}
          <Card style={{ marginBottom: 14 }}>
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 18, flexWrap: 'wrap',
            }}>
              <div style={{
                fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 34, lineHeight: 1,
                letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums',
                color: 'var(--text)',
              }}>{money(company.thisYear)}</div>
              <Movement from={company.lastYear} to={company.thisYear} big />
              <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>
                invoiced{yearLabel ? ` since ${yearLabel}` : ' this year'}
              </span>

              <div style={{
                marginLeft: 'auto', display: 'flex', gap: 22, flexWrap: 'wrap',
                alignItems: 'baseline',
              }}>
                <Beside label="Same point last year" value={money(company.lastYear)} />
                <Beside label="All of last year" value={money(company.lastYearFull)} />
                <Beside
                  label="Committed, not billed"
                  value={money(company.outstanding)}
                  note="On the ramps, plus stock"
                />
              </div>
            </div>

            <div style={{ display: 'flex', height: 26, marginTop: 14, gap: 2 }}>
              {divisions.map((d) => {
                const share = company.thisYear > 0
                  ? Math.max(0, Number(d.this_year)) / company.thisYear : 0;
                return (
                  <div
                    key={d.division}
                    title={`${d.name}: ${money(d.this_year)}`}
                    style={{
                      width: `${Math.max(share * 100, 6)}%`,
                      background: HUE[d.division] ?? 'var(--chart-company)',
                      borderRadius: 'var(--r-sm)',
                      display: 'flex', alignItems: 'center', paddingLeft: 8,
                      overflow: 'hidden', whiteSpace: 'nowrap',
                      color: '#fff', fontSize: 11.5, fontWeight: 600,
                    }}
                  >
                    {share > 0.1 && `${d.name} ${Math.round(share * 100)}%`}
                  </div>
                );
              })}
            </div>
          </Card>

          {/* ---- Month by month, drawn in real pixels ---- */}
          <Card style={{ marginBottom: 16 }}>
            <div style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
              gap: 12, marginBottom: 10, flexWrap: 'wrap',
            }}>
              <Label>Invoiced by month</Label>
              <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                Two years. The top of the stack is the company.
              </span>
            </div>
            <MonthlyStack
              points={stack}
              series={divisions.map((d) => ({
                key: d.division,
                name: d.name,
                colour: HUE[d.division] ?? 'var(--chart-company)',
              }))}
              yearStart={yearStartMonth}
            />
          </Card>

          {deepFailed && (
            <div style={{ marginBottom: 14 }}>
              <Alert tone="warning">
                {deepFailed}
                <Button variant="ghost" size="sm" onClick={() => void loadDeep()}>Try again</Button>
              </Alert>
            </div>
          )}

          {/* ---- The three columns, carrying everything ---- */}
          <div style={{
            display: 'grid', gap: 16, alignItems: 'start',
            gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))',
          }}>
            {divisions.map((d) => (
              <DivisionColumn
                key={d.division}
                d={d}
                spark={seriesOf(d.division)}
                pipeline={pipeline.find((p) => p.division === d.division)}
                customers={top[d.division] ?? []}
                deep={deep}
              />
            ))}
          </div>

          {/* ---- The one thing that is not per division ----

              A customer who has moved their maintenance elsewhere and
              started renting from us is not a riser in one column and a
              faller in another, they are one haulier who changed what
              they buy. Netted, on one list, which is why it sits below
              the three rather than inside one of them. */}
          {deep && deep.movers.length > 0 && (
            <Card style={{ marginTop: 16 }}>
              <div style={{
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                gap: 12, marginBottom: 10, flexWrap: 'wrap',
              }}>
                <Label>Who has moved</Label>
                <span style={{ fontSize: 12, color: 'var(--text-subtle)', maxWidth: 620 }}>
                  Maintenance and rental netted together, against the same point last year.
                  Trailer purchases are left out: a customer who bought last year and not this
                  one has a trailer, not a problem.
                </span>
              </div>
              <div style={{
                display: 'grid', gap: 18,
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              }}>
                <Movers title="Growing" rows={deep.movers.filter((m) => Number(m.change) > 0)} up />
                <Movers title="Spending less" rows={deep.movers.filter((m) => Number(m.change) < 0)} />
              </div>
              {deep.conc && deep.conc.billed > 0 && (
                <div style={{
                  marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)',
                  display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'baseline',
                }}>
                  <Beside label="Customers billing" value={deep.conc.customers.toLocaleString('en-GB')} />
                  <Beside
                    label="Biggest is"
                    value={`${((deep.conc.top_1 / deep.conc.billed) * 100).toFixed(1)}%`}
                    note={deep.conc.biggest ?? undefined}
                  />
                  <Beside label="Top ten are"
                    value={`${((deep.conc.top_10 / deep.conc.billed) * 100).toFixed(1)}%`}
                    note={compactMoney(deep.conc.top_10)} />
                  <Beside label="Middle customer" value={money(Math.round(deep.conc.median))}
                    note="Half spend more, half less" />
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------
   One division, and everything about it.
   ------------------------------------------------------------- */
function DivisionColumn({ d, spark, pipeline, customers, deep }: {
  d: Division;
  spark: number[];
  pipeline?: Pipeline;
  customers: TopCustomer[];
  deep: Deep | null;
}) {
  const colour = HUE[d.division] ?? 'var(--chart-company)';
  const Icon = ICON[d.division] ?? Wrench;
  const recon = deep?.recon.find((r) => r.division === d.division);

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
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

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div style={{
          fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 26, lineHeight: 1,
          letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
        }}>{money(d.this_year)}</div>
        <Movement from={Number(d.last_year || 0)} to={Number(d.this_year || 0)} />
      </div>

      <div style={{ marginTop: 10 }}>
        <Sparkline points={spark} colour={colour} />
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12,
        paddingTop: 12, borderTop: '1px solid var(--border)',
      }}>
        <Small label="All of last year" value={money(d.last_year_full)} />
        <Small
          label={d.division === 'trailer' ? 'Trailers sold' : 'Invoices'}
          value={Number(d.deals || 0).toLocaleString('en-GB')}
          note={Number(d.deals) > 0
            ? `${money(Math.round(Number(d.this_year) / Number(d.deals)))} each on average`
            : undefined}
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
              ? `${((Number(d.margin) / Number(d.this_year)) * 100).toFixed(1)}% of the sale value`
              : undefined}
          />
        ) : (
          <Small label="Margin" value="Not recorded" quiet note="No cost is held for this work" />
        )}
      </div>

      {/* Everything that used to be a tab, for this division only. */}
      <DivisionDetail division={d.division} name={d.name} colour={colour} deep={deep} />

      {pipeline && (pipeline.leads > 0 || pipeline.won_this_year > 0) && (
        <div style={{
          marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <Label>Won this year</Label>
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            {pipeline.won_this_year > 0
              ? `${pipeline.won_this_year} ${pipeline.won_this_year === 1 ? 'lead' : 'leads'}`
              : 'none yet'}
          </span>
          {pipeline.won_this_year > 0 && <Badge tone="success">closed</Badge>}
        </div>
      )}

      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
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
      </div>

      {/* WHAT IS NOT ON A CUSTOMER RECORD, and what to do about it.

          The old alert said this money was "waiting under Revenue,
          Accounts". For trailer sales that screen is empty and always
          will be: trailer customers do not come from Protean and have
          no account code. From the business: "nothing is under accounts
          so this is broken hardcoded code." */}
      {recon && <WaitingOnARecord division={d.division} recon={recon} waiting={deep?.waiting ?? []} />}
    </Card>
  );
}

/* -------------------------------------------------------------
   Risers and fallers, half a card each.
   ------------------------------------------------------------- */
function Movers({ title, rows, up }: { title: string; rows: Mover[]; up?: boolean }) {
  const open = (id: string | null) => {
    if (id) window.location.assign(`/dashboard/crm?contact=${id}`);
  };
  return (
    <div>
      <Label>{title}</Label>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {rows.length === 0 && (
          <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>
            {up ? 'Nobody is spending more than last year.' : 'Nobody is spending less.'}
          </span>
        )}
        {rows.slice(0, 6).map((m) => (
          <div
            key={m.contact_id ?? m.company_name}
            onClick={() => open(m.contact_id)}
            role={m.contact_id ? 'button' : undefined}
            tabIndex={m.contact_id ? 0 : undefined}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') open(m.contact_id); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5,
              padding: '5px 0', cursor: m.contact_id ? 'pointer' : 'default',
            }}
          >
            <span style={{
              flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', color: 'var(--text)',
            }}>{m.company_name}</span>
            <span style={{
              color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums', fontSize: 11.5,
            }}>{compactMoney(Number(m.last_year))}</span>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 76,
              justifyContent: 'flex-end',
              color: up ? 'var(--success)' : 'var(--danger)',
              fontFamily: 'var(--panton)', fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
              {compactMoney(Math.abs(Number(m.change)))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- the small shared pieces ---------- */

const PAGE: React.CSSProperties = {
  padding: '22px 24px 40px', maxWidth: 1480, margin: '0 auto',
};

/** A figure that sits beside another on one baseline. */
function Beside({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <div style={{
        fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 16, marginTop: 3,
        fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
      }}>{value}</div>
      {note && (
        <div style={{
          fontSize: 11, color: 'var(--text-subtle)', marginTop: 2,
          maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{note}</div>
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
      <Icon size={big ? 15 : 13} style={{ flexShrink: 0 }} />
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

/**
 * The date every figure on the screen is read to.
 *
 * A board pack is dated. Somebody quoting a number on Tuesday has to be
 * able to produce the same number on Friday, and "the year to date"
 * quietly means something different on each of those days.
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
