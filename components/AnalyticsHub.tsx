'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Container, KeyRound, RotateCcw, Wrench, X } from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  Alert, Button, Chip, EmptyState, PageHead, compactMoney, money,
} from '@/components/kit/primitives';
import { TextInput } from '@/components/kit/forms';
import { MonthlyStack, type MonthPoint, type Shape } from '@/components/analytics/monthly';
import { Donut } from '@/components/analytics/donut';
import { DivergingBars, RankedBars, type BarRow } from '@/components/analytics/bars';
import {
  Key, Panel, PanelGrid, Segments, Toggle, type TableRow,
} from '@/components/analytics/panel';
import { swatchImage } from '@/components/analytics/texture';
import { Tile } from '@/components/analytics/tiles';
import { NeedsARecord } from '@/components/analytics/sections';
import { readable } from '@/lib/protean/rpc';
import {
  OPEN_STAGES, STAGE_LABEL,
  concentration, customerMovement, openWorkAgeing, pipelineByStage, reconciliation,
  trailerCustomersWaiting,
  type AgeBand, type Concentration, type Mover,
  type Reconciliation, type Stage, type TrailerWaiting,
} from '@/lib/protean/finance';

/* =============================================================
   The company, as a dashboard.

   ---- What was wrong with the version before this ----

   From the business:

     analytics page rebuild won't work. It's extremely messy, ui broken
     on lower section, columns all different sized, text formatting not
     great to understand. It's just information overload. ... Lots of
     visual data, interactivity, ability to drill in deeper, not just
     tons of text and numbers on a page.

   Four complaints and one cause. The page was three cards, and each
   card appended however many blocks its own division happened to have.
   Trailer sales carried deals, sellers, a funnel, a customer list and a
   form for creating records; rental carried an ageing bar and a funnel.
   So the columns were different sizes because their CONTENT decided
   their height, the lower section broke because a card had a form
   growing out of the bottom of it, and it read as overload because
   every figure any division could produce was quoted at once, in eight
   type sizes, whether or not anybody had asked.

   ---- What replaces it ----

   A twelve column grid of panels. A panel says how many columns it
   spans and nothing about its height, so panels on a row are equal by
   construction and no panel can push its neighbour out of shape. That
   is `panel.tsx`, and it is the whole answer to three of the four.

   The fourth is answered by making the page ANSWER a question rather
   than recite everything:

     A CHART CARRIES THE MEANING. Every panel draws. Nothing on this
     page is a list of numbers by default.

     THE NUMBERS ARE ONE PRESS AWAY. Every panel that draws also
     tabulates, on a toggle. The finance team asked for enough to brief
     the managing director and then reported the result as overload;
     both were true, and the fix is that the detail exists without being
     shouted. It is also the accessible reading of every chart here.

     ONE THING DRILLS IN. Pressing a division, on the ring or on a chip,
     scopes the entire page to it: the tiles become that division's
     figures, the chart becomes its line, and every panel below filters.
     One axis, so nobody has to remember what is filtered.
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
  stc: Wrench, trailer: Container, rental: KeyRound,
};

/** Where a division's own screen lives, for the drill in. */
const GOES_TO: Record<string, string> = {
  stc: '/dashboard/revenue/stc',
  rental: '/dashboard/revenue/rental',
  trailer: '/dashboard/sales',
};

const SHAPES: { value: Shape; label: string }[] = [
  { value: 'stack' as const, label: 'Stacked' },
  { value: 'line', label: 'Lines' },
  { value: 'column', label: 'Columns' },
];

type Deep = {
  movers: Mover[];
  conc: Concentration | null;
  bands: AgeBand[];
  recon: Reconciliation[];
  waiting: TrailerWaiting[];
  stages: Stage[];
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

  /* THE ONE DRILL IN. Null is the company; a slug is one division, and
     every panel on the page reads it. */
  const [only, setOnly] = useState<string | null>(null);

  /* How the month chart is drawn, and which divisions are on it. Held
     here rather than in the chart so the key under it and the toolbar
     above it are looking at the same state. */
  const [shape, setShape] = useState<Shape>('stack');
  const [off, setOff] = useState<Set<string>>(new Set());
  const [textured, setTextured] = useState(true);

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

  const loadDeep = useCallback(async () => {
    setDeepFailed(null);
    try {
      const [movers, conc, bands, recon, waiting, stages] = await Promise.all([
        customerMovement(supabase, upto, 14),
        concentration(supabase, null, upto),
        openWorkAgeing(supabase, null, upto),
        reconciliation(supabase, upto),
        trailerCustomersWaiting(supabase, upto),
        pipelineByStage(supabase),
      ]);
      setDeep({ movers, conc, bands, recon, waiting, stages });
    } catch (e) {
      setDeepFailed(e instanceof Error ? e.message : 'The detail would not load.');
    }
  }, [supabase, upto]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setDeep(null); void loadDeep(); }, [loadDeep]);

  /* What the page is currently about: every division, or one of them.
     Every figure below reads `scope`, so there is one place where "is
     this filtered" is decided. */
  const scope = useMemo(
    () => (only ? divisions.filter((d) => d.division === only) : divisions),
    [divisions, only],
  );
  const picked = only ? divisions.find((d) => d.division === only) ?? null : null;

  const sum = useMemo(() => ({
    thisYear: scope.reduce((s, d) => s + Number(d.this_year || 0), 0),
    lastYear: scope.reduce((s, d) => s + Number(d.last_year || 0), 0),
    lastYearFull: scope.reduce((s, d) => s + Number(d.last_year_full || 0), 0),
    outstanding: scope.reduce((s, d) => s + Number(d.outstanding || 0), 0),
    outstandingN: scope.reduce((s, d) => s + Number(d.outstanding_n || 0), 0),
    deals: scope.reduce((s, d) => s + Number(d.deals || 0), 0),
  }), [scope]);

  const yearLabel = divisions[0]?.fy_started
    ? new Date(`${divisions[0].fy_started}T00:00:00`).toLocaleDateString('en-GB', {
      month: 'short', year: 'numeric',
    })
    : null;
  const yearStartMonth = divisions[0]?.fy_started
    ? Number(divisions[0].fy_started.slice(5, 7))
    : undefined;

  /* One point per month carrying every division in scope, which is what
     a stack needs and what a per division filter would have to be
     undone to get. */
  const stack = useMemo<MonthPoint[]>(() => {
    const at = new Map<string, number>();
    for (const m of months) at.set(`${m.month}|${m.division}`, Number(m.net || 0));
    return [...new Set(months.map((m) => m.month))].sort().map((month) => ({
      month,
      values: scope.map((d) => at.get(`${month}|${d.division}`) ?? 0),
    }));
  }, [months, scope]);

  /* The financial year running, for the tile sparklines. A two year
     line inside a 34 pixel box says nothing about either year. */
  const yearRunning = useMemo(() => {
    const at = new Map<string, number>();
    for (const m of months) {
      if (only && m.division !== only) continue;
      at.set(m.month, (at.get(m.month) ?? 0) + Number(m.net || 0));
    }
    const all = [...at.keys()].sort();
    const from = yearStartMonth
      ? [...all].reverse().find((m) => Number(m.slice(5, 7)) === yearStartMonth)
      : undefined;
    return (from ? all.filter((m) => m >= from) : all.slice(-12)).map((m) => at.get(m) ?? 0);
  }, [months, only, yearStartMonth]);

  const series = useMemo(
    () => scope.map((d) => ({
      key: d.division, name: d.name, colour: HUE[d.division] ?? 'var(--chart-company)',
    })),
    [scope],
  );

  /* ---- what each panel below draws ---- */

  const customers = useMemo<BarRow[]>(() => {
    const from = only
      ? (top[only] ?? []).map((c) => ({ ...c, division: only }))
      : Object.entries(top).flatMap(([div, list]) => list.map((c) => ({ ...c, division: div })));
    /* Netted by customer where the page is not scoped, because a
       haulier who buys maintenance and rents is one customer and two
       rows for them is the fault the movers panel already had. */
    const byName = new Map<string, BarRow & { raw: number }>();
    for (const c of from) {
      const key = c.contact_id ?? c.company_name;
      const got = byName.get(key);
      const value = Number(c.this_year || 0);
      if (got) { got.raw += value; got.value = got.raw; continue; }
      byName.set(key, {
        key,
        name: c.company_name,
        value,
        raw: value,
        note: c.placed ? undefined : 'no record',
        href: c.contact_id ? `/dashboard/crm?contact=${c.contact_id}` : undefined,
      });
    }
    return [...byName.values()].sort((a, b) => b.value - a.value).slice(0, 8);
  }, [top, only]);

  const movers = useMemo<BarRow[]>(() => {
    if (!deep) return [];
    /* Trailer purchases are deliberately absent from the underlying
       figure: a customer who bought a trailer last year and not this one
       has a trailer, not a problem. So this panel is hidden entirely
       when the page is scoped to trailer sales rather than drawn empty,
       which would read as "nobody moved". */
    return [...deep.movers]
      .filter((m) => Number(m.change) !== 0)
      .sort((a, b) => Math.abs(Number(b.change)) - Math.abs(Number(a.change)))
      .slice(0, 8)
      .sort((a, b) => Number(b.change) - Number(a.change))
      .map((m) => ({
        key: m.contact_id ?? m.company_name,
        name: m.company_name,
        value: Number(m.change),
        note: compactMoney(Number(m.last_year)),
        href: m.contact_id ? `/dashboard/crm?contact=${m.contact_id}` : undefined,
      }));
  }, [deep]);

  const ageing = useMemo<BarRow[]>(() => {
    if (!deep) return [];
    const mine = deep.bands.filter((b) => (only ? b.division === only : true) && b.jobs > 0);
    const byBand = new Map<string, { at: number; value: number; jobs: number }>();
    for (const b of mine) {
      const got = byBand.get(b.band) ?? { at: b.band_at, value: 0, jobs: 0 };
      got.value += Number(b.value || 0);
      got.jobs += Number(b.jobs || 0);
      byBand.set(b.band, got);
    }
    return [...byBand.entries()]
      .sort((a, b) => a[1].at - b[1].at)
      .map(([band, v]) => ({
        key: band,
        name: band,
        value: v.value,
        note: `${v.jobs} ${v.jobs === 1 ? 'job' : 'jobs'}`,
        /* The oldest band always in red. Anything past ninety days on
           the ramps is the reason this panel exists. */
        colour: v.at === 4 ? 'var(--danger)' : 'var(--chart-company)',
      }));
  }, [deep, only]);

  const funnel = useMemo<BarRow[]>(() => {
    if (!deep) return [];
    const mine = deep.stages
      .filter((s) => (only ? s.division === only : true) && OPEN_STAGES.has(s.stage));
    const byStage = new Map<string, { at: number; leads: number; value: number }>();
    for (const s of mine) {
      const got = byStage.get(s.stage) ?? { at: s.stage_at, leads: 0, value: 0 };
      got.leads += Number(s.leads || 0);
      got.value += Number(s.value || 0);
      byStage.set(s.stage, got);
    }
    return [...byStage.entries()]
      .sort((a, b) => a[1].at - b[1].at)
      .map(([stage, v]) => ({
        key: stage,
        name: STAGE_LABEL[stage] ?? stage,
        value: v.leads,
        note: v.value ? compactMoney(v.value) : undefined,
      }));
  }, [deep, only]);

  const oldest = useMemo(() => {
    if (!deep) return null;
    const mine = deep.bands.filter((b) => (only ? b.division === only : true) && b.band_at === 4);
    const value = mine.reduce((s, b) => s + Number(b.value || 0), 0);
    const jobs = mine.reduce((s, b) => s + Number(b.jobs || 0), 0);
    return { value, jobs };
  }, [deep, only]);

  const gaps = useMemo(() => {
    if (!deep) return 0;
    return deep.recon
      .filter((r) => (only ? r.division === only : true))
      .reduce((s, r) => s + Number(r.unattributed || 0), 0);
  }, [deep, only]);

  if (loading) {
    return (
      <div className="kit" style={PAGE}>
        <PageHead eyebrow="Analytics" title="The company" />
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Reading the figures.</span>
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

  const nothingYet = divisions.every((d) =>
    !Number(d.this_year) && !Number(d.last_year) && !Number(d.outstanding));

  if (nothingYet) {
    return (
      <div className="kit" style={PAGE}>
        <PageHead eyebrow="Analytics" title="The company" />
        <EmptyState
          what="Nothing to measure yet"
          why="No revenue has been imported and no trailers are recorded as sold. Import the Protean and Sage exports under Revenue and this fills in."
          action={
            <Link href="/dashboard/revenue/stc"><Button variant="primary">Go to Revenue</Button></Link>
          }
        />
      </div>
    );
  }

  /* The key repeats whatever the chart is actually drawing, so a
     swatch is never a pattern beside a line that has none. */
  const keyItems = series.map((s, i) => ({
    ...s, pattern: swatchImage(i, textured && shape !== 'line'),
  }));

  return (
    <div className="kit" style={PAGE}>
      {/* ---- the one control bar ----

          Everything that changes what the page is about, on one line:
          which division, and as at when.

          Deliberately NOT sticky. It was, and a sticky header on this
          screen would be the only one in the application: every other
          tab scrolls its head away under the top bar, and a header that
          slides under a fixed bar is the class of fault this rebuild
          exists to remove. What keeps the drill in visible instead is
          the band below, which is drawn whenever the page is scoped. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        padding: '2px 0 12px',
      }}>
        <PageHead
          eyebrow="Analytics"
          title={picked ? picked.name : 'The company'}
          sub={yearLabel
            ? `The year from ${yearLabel}, against the same point in the year before it.`
            : 'Every division, on the company year.'}
        />

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7 }}>
          <Chip active={only == null} onClick={() => setOnly(null)}>Whole company</Chip>
          {divisions.map((d) => {
            const Icon = ICON[d.division] ?? Wrench;
            return (
              <Chip
                key={d.division}
                active={only === d.division}
                onClick={() => setOnly(only === d.division ? null : d.division)}
                title={`Scope every panel to ${d.name}`}
              >
                <Icon size={12} /> {d.name}
              </Chip>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ width: 146 }}>
            <TextInput type="date" value={asked} onChange={setAsked} />
          </div>
          {asked && (
            <Button variant="ghost" size="sm" onClick={() => setAsked('')}>
              <RotateCcw size={12} /> Today
            </Button>
          )}
        </div>
      </div>

      {picked && (
        <div style={{ marginBottom: 12 }}>
          <Alert tone="info">
            <span style={{ flex: 1 }}>
              Every panel is showing {picked.name} only.
            </span>
            <Link href={GOES_TO[picked.division] ?? '/dashboard'} style={{ textDecoration: 'none' }}>
              <Button variant="secondary" size="sm">
                Open {picked.name}
                <ArrowRight size={12} />
              </Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={() => setOnly(null)}>
              <X size={12} /> Whole company
            </Button>
          </Alert>
        </div>
      )}

      {deepFailed && (
        <div style={{ marginBottom: 12 }}>
          <Alert tone="warning">
            <span style={{ flex: 1 }}>{deepFailed}</span>
            <Button variant="ghost" size="sm" onClick={() => void loadDeep()}>Try again</Button>
          </Alert>
        </div>
      )}

      <PanelGrid>
        {/* ---- row 1: four figures, one shape each ---- */}
        <Tile
          label={picked ? `${picked.name} invoiced` : 'Invoiced this year'}
          value={money(sum.thisYear)}
          movement={{ from: sum.lastYear, to: sum.thisYear }}
          note={`${money(sum.lastYearFull)} in all of last year`}
          spark={yearRunning}
          colour={picked ? HUE[picked.division] : 'var(--chart-company)'}
        />
        <Tile
          label="Committed, not billed"
          value={money(sum.outstanding)}
          note={picked
            ? `${sum.outstandingN.toLocaleString('en-GB')} ${picked.outstanding_of}`
            : `${sum.outstandingN.toLocaleString('en-GB')} on the ramps and in stock`}
        />
        <Tile
          label={picked?.division === 'trailer' ? 'Trailers sold' : 'Invoices raised'}
          value={sum.deals.toLocaleString('en-GB')}
          note={sum.deals > 0
            ? `${money(Math.round(sum.thisYear / sum.deals))} each on average`
            : 'nothing yet this year'}
        />
        <Tile
          label="Open over ninety days"
          value={oldest ? money(oldest.value) : '—'}
          tone={oldest && oldest.value > 0 ? 'danger' : 'plain'}
          note={oldest && oldest.jobs > 0
            ? `${oldest.jobs} ${oldest.jobs === 1 ? 'job' : 'jobs'} on the ramps`
            : 'nothing sitting'}
        />

        {/* ---- row 2: the shape of the year, and the mix ---- */}
        <Panel
          span={7}
          title="Invoiced by month"
          hint="Two years, against the same month a year before"
          minBody={300}
          toolbar={
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Segments value={shape} onChange={setShape} options={SHAPES} />
              {/* Nothing is filled in Lines, so a Patterns toggle
                  there is a control that appears to do nothing, which
                  is how people learn to stop trusting a toolbar. */}
              {shape !== 'line' && (
                <Toggle
                  on={textured}
                  onChange={setTextured}
                  title="Fill each division with its own pattern as well as its own colour"
                >Patterns</Toggle>
              )}
            </div>
          }
          table={{
            columns: ['Month', ...series.map((s) => s.name), 'Total'],
            rows: stack.slice(-14).reverse().map<TableRow>((p) => ({
              name: new Date(`${p.month}T00:00:00`)
                .toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
              cells: [
                ...p.values.map((v) => Math.max(0, v)),
                p.values.reduce((s, v) => s + Math.max(0, v), 0),
              ],
            })),
          }}
          foot={
            <>
              <Key
                items={keyItems}
                hidden={off}
                onToggle={(k) => setOff((s) => {
                  const next = new Set(s);
                  /* Never all of them. An empty chart is not a filter,
                     it is a chart that has stopped working. */
                  if (next.has(k)) next.delete(k);
                  else if (next.size < series.length - 1) next.add(k);
                  return next;
                })}
              />
              <span style={{ marginLeft: 'auto', color: 'var(--text-subtle)' }}>
                Hover for the month. Press a division to hide it.
              </span>
            </>
          }
        >
          <MonthlyStack
            points={stack}
            series={series}
            yearStart={yearStartMonth}
            shape={shape}
            hidden={off}
            textured={textured}
            height={300}
          />
        </Panel>

        <Panel
          span={5}
          title="Where it came from"
          hint={only ? 'Press another to move the whole page' : 'Press a division to drill in'}
          minBody={300}
          table={{
            columns: ['Division', 'This year', 'Share'],
            rows: divisions.map<TableRow>((d) => ({
              name: d.name,
              colour: HUE[d.division],
              cells: [
                Number(d.this_year || 0),
                `${(divisions.reduce((s, x) => s + Number(x.this_year || 0), 0) > 0
                  ? (Number(d.this_year || 0) * 100)
                    / divisions.reduce((s, x) => s + Number(x.this_year || 0), 0)
                  : 0).toFixed(1)}%`,
              ],
            })),
          }}
        >
          <Donut
            slices={divisions.map((d) => ({
              key: d.division,
              name: d.name,
              value: Number(d.this_year || 0),
              colour: HUE[d.division] ?? 'var(--chart-company)',
            }))}
            total={divisions.reduce((s, d) => s + Number(d.this_year || 0), 0)}
            caption="invoiced"
            active={only}
            onPick={setOnly}
            textured={textured}
            height={260}
          />
        </Panel>

        {/* ---- row 3: who pays us, and who changed ---- */}
        <Panel
          span={6}
          title="Biggest customers"
          hint={only ? `${picked?.name}, this year` : 'Every division netted, this year'}
          minBody={252}
          table={{
            columns: ['Customer', 'This year'],
            rows: customers.map<TableRow>((c) => ({ name: c.name, cells: [c.value] })),
          }}
          foot={deep?.conc && deep.conc.billed > 0 ? (
            <>
              <span>
                <strong style={{ fontFamily: 'var(--panton)' }}>
                  {deep.conc.customers.toLocaleString('en-GB')}
                </strong>{' '}customers billing
              </span>
              <span>
                Top ten are{' '}
                <strong style={{ fontFamily: 'var(--panton)' }}>
                  {((deep.conc.top_10 / deep.conc.billed) * 100).toFixed(0)}%
                </strong>
              </span>
              <span>
                Middle customer{' '}
                <strong style={{ fontFamily: 'var(--panton)' }}>
                  {compactMoney(Math.round(deep.conc.median))}
                </strong>
              </span>
            </>
          ) : undefined}
        >
          <RankedBars
            rows={customers}
            colour={picked ? HUE[picked.division]! : 'var(--chart-company)'}
            empty="Nothing billed yet in this scope."
          />
        </Panel>

        {only === 'trailer' ? (
          <Panel
            span={6}
            title="Who moved"
            hint="Maintenance and rental only"
            minBody={252}
          >
            <span style={{ fontSize: 12.5, color: 'var(--text-subtle)', lineHeight: 1.6 }}>
              Movement is measured on maintenance and rental, which recur. Trailer purchases are
              left out on purpose: a customer who bought last year and not this one has a
              trailer, not a problem.
              <div style={{ marginTop: 9 }}>
                <Button variant="secondary" size="sm" onClick={() => setOnly(null)}>
                  See it for the whole company
                </Button>
              </div>
            </span>
          </Panel>
        ) : (
          <Panel
            span={6}
            title="Who moved"
            hint="Against the same point last year"
            minBody={252}
            table={{
              columns: ['Customer', 'Last year', 'Change'],
              rows: movers.map<TableRow>((m) => ({
                name: m.name, cells: [m.note ?? null, m.value],
              })),
            }}
          >
            <DivergingBars
              rows={movers}
              empty="Nobody has moved against last year."
              caption="Maintenance and rental netted together. Trailer purchases are left out: a customer who bought last year and not this one has a trailer, not a problem."
            />
          </Panel>
        )}

        {/* ---- row 4: what is stuck, and what is coming ---- */}
        <Panel
          span={6}
          title="How old the open work is"
          hint="From the day the job was raised"
          minBody={214}
          table={{
            columns: ['Age', 'Value', 'Jobs'],
            rows: ageing.map<TableRow>((b) => ({
              name: b.name, colour: b.colour, cells: [b.value, b.note ?? null],
            })),
          }}
          foot={oldest && oldest.jobs > 0 ? (
            <span style={{ color: 'var(--danger)' }}>
              {money(oldest.value)} of it has been open over ninety days.
            </span>
          ) : undefined}
        >
          <RankedBars
            rows={ageing}
            colour="var(--chart-company)"
            empty="No open work on the ramps."
          />
        </Panel>

        <Panel
          span={6}
          title="What is coming"
          hint="Open leads on the tracker, by stage"
          minBody={214}
          table={{
            columns: ['Stage', 'Leads', 'Worth'],
            rows: funnel.map<TableRow>((s) => ({
              name: s.name, cells: [s.value.toString(), s.note ?? null],
            })),
          }}
          foot={
            <>
              <span>
                {pipeline
                  .filter((p) => (only ? p.division === only : true))
                  .reduce((s, p) => s + Number(p.won_this_year || 0), 0)} won this year
              </span>
              <Link href="/dashboard/sales" style={{ textDecoration: 'none', marginLeft: 'auto' }}>
                <Button variant="ghost" size="sm">Open the tracker <ArrowRight size={12} /></Button>
              </Link>
            </>
          }
        >
          <RankedBars
            rows={funnel}
            colour={picked ? HUE[picked.division]! : 'var(--chart-company)'}
            format={(n) => n.toLocaleString('en-GB')}
            empty="Nothing open on the tracker in this scope."
          />
        </Panel>

        {/* ---- row 5: the one thing on this page you DO ----

            Its own panel, full width, because a form that grows is what
            broke the bottom of the last version when it lived inside a
            division card. */}
        {gaps > 0 && (
          <Panel
            span={12}
            title="Billed to a name with no customer record"
            hint="Counted in the totals above, and on nobody's customer page"
            minBody={0}
          >
            <NeedsARecord
              recon={deep?.recon ?? []}
              waiting={deep?.waiting ?? []}
              only={only}
            />
          </Panel>
        )}
      </PanelGrid>
    </div>
  );
}

const PAGE: React.CSSProperties = {
  padding: '18px 24px 40px', maxWidth: 1480, margin: '0 auto',
};
