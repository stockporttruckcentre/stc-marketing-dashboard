'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Download, Loader, RefreshCw, SlidersHorizontal, X,
} from 'lucide-react';
import {
  BandStrip, BulletRows, DotPlot, HUE, IndexedLines, PROGRESSION, TIER,
  Progression, ShareRows, SourceFlowChart, StackedMonths, StockScatter, Waterfall,
} from '@/components/analytics/kit/charts';
import { CohortGrid } from '@/components/analytics/kit/cohort';
import {
  Chart, DeviceLabel, Explain, Kpi, Legend, NotWiredPanel, Pair, Section, SectionHead,
  Verdict, money, pct, shortMoney,
} from '@/components/analytics/kit/frame';
import { indexed } from '@/lib/analytics/shape';
import {
  compareWords, iso, periodWords, trimWords, windowWords,
  type CompareMode, type PeriodKind,
} from '@/lib/analytics/period';
import type { Analytics, DivisionSlug, Figure } from '@/lib/analytics/types';

/* =============================================================
   The Analytics hub.

   Built from `STCUIAnalytics.html`, which the business supplied as the
   component library for this screen, and from what it said about the
   old one:

     Currently it's a little all over the place and it doesn't offer
     enough insight to an accounts department of what they need to see
     at a glance in the morning, or spend 30 minutes delving in to ... I
     need to be able to quickly view analytics for certain divisions or
     contracts or people and get very granular without it being
     overwhelming to our non-techy MD.

   Two audiences, one page, and the tension between them is the whole
   design problem. It is resolved the way the reference resolves it:

     THE GLANCE IS THE FIRST SCREEN and it never moves. A sentence, a
     shortlist of decisions, four figures, and revenue against target.
     Somebody who reads only that has read something true.

     THE THIRTY MINUTES IS BELOW IT, in sections that fold. Every one is
     shut until it is opened, so the page is short until somebody wants
     it long. Nothing is hidden behind a tab, because a tab is a thing
     you have to know exists.

   ---- One control bar drives everything ----

   From the reference: "the commonest mistake on an analytics screen is
   reading a number from the wrong period". So there is exactly one
   period, one comparison and one filter set, they live in a bar that
   sticks to the top of the page, and every figure below is fetched for
   them together in a single request. No chart has its own date picker.

   ---- Every number can be interrogated ----

   Each headline figure carries an info button that opens what it counts,
   what it excludes, where it comes from and who can change it. That is
   the reference's own rule and it is the difference between an MD
   trusting this page and asking somebody to check it in a spreadsheet.
   ============================================================= */

type Filters = {
  kind: PeriodKind;
  from: string;
  to: string;
  mode: CompareMode;
  trim: boolean;
  divisions: DivisionSlug[];
  person: string | null;
};

const DIVISION_NAME: Record<DivisionSlug, string> = {
  stc: 'STC', trailer: 'Trailer Sales', rental: 'Rentals',
};

const PERIODS: { key: PeriodKind; label: string }[] = [
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'year', label: 'Year' },
  { key: 'custom', label: 'Custom' },
];

const MODES: { key: CompareMode; label: string; blurb: string }[] = [
  { key: 'previous', label: 'Previous period', blurb: 'Like for like on days elapsed.' },
  { key: 'lastyear', label: 'Same period last year', blurb: 'The same dates, twelve months back.' },
  { key: 'target', label: 'Target', blurb: 'Shows the notch on every chart instead of a second series.' },
];

export function AnalyticsHub({ today, maySetTargets = false }: {
  today: string;
  /** `analytics.targets`. Without it the notches are read only. */
  maySetTargets?: boolean;
}) {
  const [f, setF] = useState<Filters>({
    kind: 'month',
    from: `${today.slice(0, 7)}-01`,
    to: today,
    mode: 'previous',
    trim: true,
    divisions: [],
    person: null,
  });

  const [data, setData] = useState<Analytics & { bands?: any[] } | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [explain, setExplain] = useState<Figure | null>(null);

  /* Numbered, so a slow request that lands after a fast one cannot
     overwrite it. Three chips changed quickly is three requests, and
     without this the page shows whichever server answered last rather
     than whichever was asked last. */
  const runNo = useRef(0);

  const load = useCallback(async (filters: Filters) => {
    const mine = ++runNo.current;
    setBusy(true);
    setFailed(null);
    try {
      const res = await fetch('/api/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...filters, today }),
      });
      const body = await res.json();
      if (mine !== runNo.current) return;
      if (!res.ok) { setFailed(body?.error ?? 'The figures could not be read.'); setData(null); return; }
      setData(body);
    } catch {
      if (mine !== runNo.current) return;
      setFailed('The figures could not be reached. Check the connection and try again.');
    } finally {
      if (mine === runNo.current) setBusy(false);
    }
  }, [today]);

  useEffect(() => { load(f); }, [f, load]);

  const set = (patch: Partial<Filters>) => setF((was) => ({ ...was, ...patch }));

  const people = data?.people ?? [];
  const person = f.person ? people.find((p) => p.id === f.person) ?? null : null;

  return (
    /* The kit's own column width.

       Measured off the file rather than chosen. Its shell is
       max-width 1440 with padding 40px 40px 80px and a 44px gap, and
       inside that a <main> 1126 wide beside a 190px rail carrying its
       "ON THIS PAGE" list. Every device in the kit is drawn against
       that 1126, so at 1440 the cohort grid came out 314px wider than
       the design and every column in it stretched with it.

       The rail is not ported yet, so the column is set to 1126 and
       centred rather than the full shell being faked around it. When
       the rail arrives this becomes the shell and the number moves
       back to 1440.

       `npm run check:kit-diff` compares this width against the kit's
       and fails when they disagree. */
    <div className="kit kit-page" style={{
      display: 'flex', flexDirection: 'column', gap: 26,
      maxWidth: 1126, margin: '0 auto', width: '100%',
    }}>
      <ControlBar
        f={f}
        set={set}
        busy={busy}
        onRefresh={() => load(f)}
        data={data}
        person={person?.name ?? null}
      />

      {failed && (
        <div style={{
          display: 'flex', gap: 10, alignItems: 'flex-start',
          padding: '12px 14px', borderRadius: 'var(--r-md)',
          border: '1px solid var(--danger)', background: 'var(--surface)',
          fontSize: 13, color: 'var(--text)',
        }}>
          <AlertTriangle size={16} style={{ color: 'var(--danger)', flex: 'none', marginTop: 1 }} />
          <span>{failed}</span>
        </div>
      )}

      {!data && busy && <Waiting />}

      {data && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 34,
          opacity: busy ? 0.6 : 1, transition: 'opacity 140ms ease',
        }}>
          <Glance data={data} f={f} set={set} onExplain={setExplain}
            maySetTargets={maySetTargets} onSaved={() => load(f)} />

          {/* Sections, all of them open.

              These were collapsible, and five of the six defaulted
              closed, which turned the bottom of the page into a stack
              of grey rows with a chevron on the end: an FAQ, not an
              analytics hub. Nothing in the design asked for an
              accordion. It was invented to keep the page short, and it
              bought that by hiding the work.

              A section is a heading and its cards, and the cards are
              already the thing that makes the page readable: each one
              carries its own title, what it says, and a footer with its
              provenance. */}
          <Section
            id="divisions"
            title="Three divisions, one page"
            sub="STC bills jobs, trailer sales moves units, rentals invoices hire. These devices exist so those three can share an axis."
          >
            <Divisions data={data} f={f} set={set} />
          </Section>

          <Section
            id="people"
            title="People and where work comes from"
            sub="Who brought business in, and what happened to it. One bar per person on a shared scale, so rows compare without reading the numbers."
          >
            <People data={data} f={f} set={set} />
          </Section>

          <Section
            id="stock"
            title="Trailer sales"
            sub="Stock is money sitting still. These two devices are about what to price down and what to hold."
          >
            <Stock data={data} />
          </Section>

          <Section
            id="book"
            title="FleetSmart+ contract book"
            sub="Contracts recur, so the useful number is not what was signed this month but what the book is now worth every week."
          >
            <Book data={data} set={set} />
          </Section>

          <Section
            id="customers"
            title="Customers"
            sub="Who is spending, measured against the same window as everything above."
          >
            <Customers data={data} />
          </Section>

          <Section
            id="gaps"
            title="What this page cannot answer yet"
            sub="Named rather than drawn as zeroes. A zero on this page is a claim about the business."
          >
            {data.notWired.map((n) => <NotWiredPanel key={n.what} {...n} />)}
          </Section>
        </div>
      )}

      {explain && data && (
        <Explain
          figure={explain}
          when={windowWords(data.period.window)}
          onClose={() => setExplain(null)}
        />
      )}
    </div>
  );
}

function Waiting() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '40px 0', color: 'var(--text-muted)', fontSize: 13,
    }}>
      <Loader size={15} className="spin" /> Reading every division.
    </div>
  );
}

/* =============================================================
   The control bar

   Sticky, because it governs every figure below it and a reader who has
   scrolled to the cohort grid still needs to see which period they are
   in. Active filters sit on a second row rather than inside a panel, so
   what has been cut out of the numbers is always visible.
   ============================================================= */
function ControlBar({ f, set, busy, onRefresh, data, person }: {
  f: Filters;
  set: (p: Partial<Filters>) => void;
  busy: boolean;
  onRefresh: () => void;
  data: Analytics | null;
  person: string | null;
}) {
  const [showModes, setShowModes] = useState(false);
  const chips: { key: string; label: string; clear: () => void }[] = [
    ...f.divisions.map((d) => ({
      key: d, label: DIVISION_NAME[d],
      clear: () => set({ divisions: f.divisions.filter((x) => x !== d) }),
    })),
    ...(person ? [{ key: 'person', label: person, clear: () => set({ person: null }) }] : []),
    ...(f.trim ? [] : [{ key: 'trim', label: 'Comparison not trimmed', clear: () => set({ trim: true }) }]),
  ];

  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 20,
      border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
      background: 'var(--surface)', overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '10px 12px',
      }}>
        <div style={{ display: 'flex', border: '1px solid var(--border-strong)', borderRadius: 'var(--r)', overflow: 'hidden' }}>
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => set({ kind: p.key })}
              aria-pressed={f.kind === p.key}
              style={{
                height: 30, padding: '0 13px', border: 0, cursor: 'pointer',
                background: f.kind === p.key ? 'var(--primary)' : 'transparent',
                color: f.kind === p.key ? 'var(--primary-fg)' : 'var(--text-muted)',
                fontFamily: 'var(--inter)', fontSize: 12.5,
                fontWeight: f.kind === p.key ? 700 : 500,
              }}
            >{p.label}</button>
          ))}
        </div>

        {f.kind === 'custom' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <DateBox value={f.from} onChange={(v) => set({ from: v })} label="From" />
            <span style={{ color: 'var(--text-subtle)', fontSize: 12 }}>to</span>
            <DateBox value={f.to} onChange={(v) => set({ to: v })} label="To" />
          </div>
        ) : (
          <span style={{
            height: 30, display: 'inline-flex', alignItems: 'center', padding: '0 11px',
            border: '1px solid var(--border)', borderRadius: 'var(--r)',
            fontSize: 12.5, color: 'var(--text)', background: 'var(--bg-subtle)',
          }}>
            {/* The name of the window and then the dates, because
                either alone is what made this read as broken: "Month"
                over nine days, or nine days with nothing saying they
                are a month so far. */}
            {data ? (
              <>
                <span style={{ fontWeight: 600 }}>{periodWords(data.period)}</span>
                <span style={{ color: 'var(--text-subtle)', marginLeft: 7 }}>
                  {windowWords(data.period.window)}
                </span>
              </>
            ) : '…'}
          </span>
        )}

        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowModes((s) => !s)}
            style={{
              height: 30, padding: '0 11px', display: 'inline-flex', alignItems: 'center', gap: 8,
              border: '1px solid var(--border-strong)', borderRadius: 'var(--r)',
              background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer',
              fontFamily: 'var(--inter)', fontSize: 12.5, fontWeight: 600,
            }}
          >
            <SlidersHorizontal size={13} />
            {data ? compareWords(data.period) : 'Comparison'}
          </button>
          {showModes && (
            <div style={{
              position: 'absolute', top: 36, left: 0, zIndex: 30, width: 300,
              border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
              background: 'var(--surface)', boxShadow: 'var(--shadow-3)', padding: 6,
            }}>
              {MODES.map((m) => (
                <button
                  key={m.key}
                  onClick={() => { set({ mode: m.key }); setShowModes(false); }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px',
                    border: 0, borderRadius: 'var(--r)', cursor: 'pointer',
                    background: f.mode === m.key ? 'var(--bg-subtle)' : 'transparent',
                    fontFamily: 'var(--inter)',
                  }}
                >
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{m.label}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 1 }}>{m.blurb}</span>
                </button>
              ))}
              <label style={{
                display: 'flex', gap: 9, alignItems: 'flex-start', padding: '9px 10px',
                borderTop: '1px solid var(--border)', marginTop: 4, cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={f.trim}
                  onChange={(e) => set({ trim: e.target.checked })}
                  style={{ marginTop: 2 }}
                />
                <span>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>
                    Trim the comparison to days elapsed
                  </span>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 1, lineHeight: 1.45 }}>
                    On by default. Off compares a part month against a whole one, which is the
                    easiest way to misread this page.
                  </span>
                </span>
              </label>
            </div>
          )}
        </div>

        <span style={{ flex: 1 }} />

        <button
          onClick={onRefresh}
          disabled={busy}
          style={{
            height: 30, padding: '0 11px', display: 'inline-flex', alignItems: 'center', gap: 7,
            border: '1px solid var(--border-strong)', borderRadius: 'var(--r)',
            background: 'var(--surface)', color: 'var(--text)',
            cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
            fontFamily: 'var(--inter)', fontSize: 12.5, fontWeight: 600,
          }}
        >
          {busy ? <Loader size={13} className="spin" /> : <RefreshCw size={13} />} Refresh
        </button>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap',
        padding: '8px 12px', borderTop: '1px solid var(--border)', background: 'var(--bg-subtle)',
      }}>
        <span style={{
          fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 9.5,
          letterSpacing: '0.18em', color: 'var(--text-subtle)',
        }}>SHOWING</span>

        {chips.length === 0 ? (
          <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
            Everything. Click a division or a person below to narrow the whole page.
          </span>
        ) : chips.map((c) => (
          <button
            key={c.key}
            onClick={c.clear}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, height: 26,
              padding: '0 9px', border: '1px solid var(--border-strong)',
              borderRadius: 'var(--r)', background: 'var(--surface)', color: 'var(--text)',
              cursor: 'pointer', fontFamily: 'var(--inter)', fontSize: 12, fontWeight: 600,
            }}
          >{c.label}<X size={12} style={{ color: 'var(--text-subtle)' }} /></button>
        ))}

        {chips.length > 0 && (
          <button
            onClick={() => set({ divisions: [], person: null, trim: true })}
            style={{
              border: 0, background: 'transparent', color: 'var(--accent)', cursor: 'pointer',
              fontFamily: 'var(--inter)', fontSize: 12, fontWeight: 600,
              textDecoration: 'underline', textUnderlineOffset: 3, marginLeft: 'auto',
            }}
          >Clear all</button>
        )}
      </div>

      {data && trimWords(data.period) && (
        <div style={{
          padding: '7px 12px', borderTop: '1px solid var(--border)',
          background: 'color-mix(in srgb, var(--warning) 10%, transparent)',
          fontSize: 11.5, color: 'var(--text)',
        }}>{trimWords(data.period)}</div>
      )}
    </div>
  );
}

function DateBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <input
      type="date"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        height: 30, padding: '0 8px', border: '1px solid var(--border-strong)',
        borderRadius: 'var(--r)', background: 'var(--surface)', color: 'var(--text)',
        fontFamily: 'var(--inter)', fontSize: 12.5,
      }}
    />
  );
}

/* =============================================================
   The glance

   The first screen, and the only part that is never folded away.
   ============================================================= */
function Glance({ data, f, set, onExplain, maySetTargets, onSaved }: {
  data: Analytics; f: Filters; set: (p: Partial<Filters>) => void;
  onExplain: (fig: Figure) => void;
  maySetTargets: boolean;
  onSaved: () => void;
}) {
  const chips = data.divisions.map((d) => ({
    name: d.name,
    delta: d.was > 0 ? ((d.revenue - d.was) / d.was) * 100 : null,
    colour: HUE[d.division],
  }));

  const bullets = data.divisions.map((d) => ({
    key: d.division, name: d.name, value: d.revenue, target: d.target, colour: HUE[d.division],
  }));

  const total = data.divisions.reduce((a, d) => a + d.revenue, 0);
  const targetSum = data.divisions.reduce((a, d) => a + (d.target ?? 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <SectionHead
        id="glance"
        title="The whole business, one screen"
        sub="Every device states its conclusion in words before it shows you a shape."
      />

      <Verdict sentence={data.verdict} chips={chips} decisions={data.decisions} />

      <div style={{
        display: 'grid', gap: 10,
        gridTemplateColumns: 'repeat(auto-fit, minmax(228px, 1fr))',
      }}>
        {data.headline.map((fig, at) => (
          <Kpi key={fig.label} figure={fig} lead={at === 0} onExplain={() => onExplain(fig)} />
        ))}
      </div>

      <Chart
        title="Revenue against target, by division"
        says={targetSum > 0
          ? `${shortMoney(total)} against ${shortMoney(targetSum)} promised. ${total >= targetSum ? 'Ahead.' : `${shortMoney(targetSum - total)} short.`}`
          : 'No targets are set for this period, so the bars show revenue with nothing to hit.'}
        foot={(
          <>
            <span style={{ flex: 1, minWidth: 200 }}>
              The notch is the only red on the chart, which is what makes a miss read instantly.
              Click a division to narrow the whole page to it.
            </span>
            {maySetTargets && <Targets divisions={data.divisions} month={data.period.window.from} onSaved={onSaved} />}
          </>
        )}
      >
        <BulletRows
          rows={bullets}
          onPick={(key) => set({
            divisions: f.divisions.includes(key as DivisionSlug)
              ? f.divisions.filter((d) => d !== key)
              : [...f.divisions, key as DivisionSlug],
          })}
        />
      </Chart>
    </div>
  );
}

/* =============================================================
   Setting the notch

   A target that can only be written with SQL is a target nobody sets,
   and a bullet chart with no notch on it is a bar. So the one screen
   that reads targets is the screen that writes them, for whoever holds
   `analytics.targets`, which is administrators.

   Per month and per division, because that is the grain the table
   holds and the grain a window sums over. Nought clears it rather than
   storing a target of nothing: a target of nought and no target at all
   look identical on a chart and only one of them is a statement
   somebody made.
   ============================================================= */
function Targets({ divisions, month, onSaved }: {
  divisions: Analytics['divisions'];
  month: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  async function save(division: DivisionSlug) {
    setBusy(division);
    setFailed(null);
    const res = await fetch('/api/analytics/target', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        month: `${month.slice(0, 7)}-01`,
        division,
        amount: Number(draft[division] ?? 0),
      }),
    });
    setBusy(null);
    if (!res.ok) { setFailed((await res.json())?.error ?? 'Not saved.'); return; }
    onSaved();
  }

  if (!open) {
    return (
      <button
        onClick={() => {
          setDraft(Object.fromEntries(divisions.map((d) => [d.division, String(d.target ?? '')])));
          setOpen(true);
        }}
        style={{
          border: '1px solid var(--border-strong)', borderRadius: 'var(--r)',
          background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer',
          height: 26, padding: '0 10px', fontFamily: 'var(--inter)', fontSize: 12, fontWeight: 600,
          whiteSpace: 'nowrap', flex: 'none',
        }}
      >Set targets</button>
    );
  }

  return (
    <div style={{
      width: '100%', marginTop: 8, padding: '11px 12px',
      border: '1px solid var(--border)', borderRadius: 'var(--r)', background: 'var(--bg-subtle)',
      display: 'flex', flexDirection: 'column', gap: 9,
    }}>
      <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>
        Monthly target for {monthLabel(month)}. Nought clears it.
      </div>
      {divisions.map((d) => (
        <div key={d.division} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ width: 130, fontSize: 12.5, color: 'var(--text-muted)' }}>{d.name}</span>
          <input
            type="number"
            inputMode="numeric"
            value={draft[d.division] ?? ''}
            onChange={(e) => setDraft((was) => ({ ...was, [d.division]: e.target.value }))}
            placeholder="No target"
            style={{
              width: 140, height: 28, padding: '0 9px',
              border: '1px solid var(--border-strong)', borderRadius: 'var(--r)',
              background: 'var(--surface)', color: 'var(--text)',
              fontFamily: 'var(--inter)', fontSize: 12.5, fontVariantNumeric: 'tabular-nums',
            }}
          />
          <button
            onClick={() => save(d.division)}
            disabled={busy === d.division}
            style={{
              height: 28, padding: '0 11px', border: '1px solid var(--border-strong)',
              borderRadius: 'var(--r)', background: 'var(--surface)', color: 'var(--text)',
              cursor: 'pointer', fontFamily: 'var(--inter)', fontSize: 12, fontWeight: 600,
            }}
          >{busy === d.division ? 'Saving' : 'Save'}</button>
        </div>
      ))}
      {failed && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{failed}</div>}
      <button
        onClick={() => setOpen(false)}
        style={{
          alignSelf: 'flex-start', border: 0, background: 'transparent', color: 'var(--accent)',
          cursor: 'pointer', fontFamily: 'var(--inter)', fontSize: 12, fontWeight: 600,
          textDecoration: 'underline', textUnderlineOffset: 3, padding: 0,
        }}
      >Done</button>
    </div>
  );
}

/* =============================================================
   Three divisions
   ============================================================= */
function Divisions({ data, f, set }: {
  data: Analytics; f: Filters; set: (p: Partial<Filters>) => void;
}) {
  const points = useMemo(() => indexed(data.months), [data.months]);

  return (
    <>
      {/* Two to a row, which is the kit's layout for every device it
          draws. The waterfall in particular has five bars: given a
          whole 1440 row it stops being a shape. */}
      <Pair>
      <div>
        <DeviceLabel
          title="Indexed division trend"
          sub="Every division starts at 100, so a line above the middle rule means growth regardless of what that division actually sells."
        />
        <Chart
          title={`${data.months.length} months, indexed`}
          says={growthWords(points)}
          legend={<Legend items={[
            { name: 'STC', colour: HUE.stc },
            { name: 'Trailer sales', colour: HUE.trailer },
            { name: 'Rentals', colour: HUE.rental },
          ]} />}
          foot={<span>Indexing hides the size of each division on purpose. Use it for direction, and the revenue bars above for weight.</span>}
        >
          <IndexedLines points={points} />
        </Chart>
      </div>

      {data.period.compare && (
        <div>
          <DeviceLabel
            title="How the group number moved"
            sub="A waterfall, not a pie. It answers what changed rather than what is the split."
          />
          {/* The SAME two windows the rest of the page uses, not the last
              two months. A waterfall on its own comparison is how a page
              ends up saying the group is up in one panel and down in the
              next, and a reader is right not to trust either. */}
          <Chart
            title={`${windowWords(data.period.compare)} to ${windowWords(data.period.window)}`}
            says={movedWords(data.divisions)}
            foot={<span>Each middle bar is one division&rsquo;s contribution to the change, not its size. The two ends are the same figures as the sentence at the top of the page.</span>}
          >
            <Waterfall
              start={{
                label: 'Before',
                value: data.divisions.reduce((a, d) => a + d.was, 0),
              }}
              steps={data.divisions.map((d) => ({
                label: d.name, delta: d.revenue - d.was, colour: HUE[d.division],
              }))}
              end={{
                label: 'This period',
                value: data.divisions.reduce((a, d) => a + d.revenue, 0),
              }}
            />
          </Chart>
        </div>
      )}
      </Pair>

      <div>
        <DeviceLabel
          title="Division scorecards"
          sub="Same shape each time, different unit. The unit is part of the number so nothing has to be inferred."
        />
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {data.divisions.map((d) => {
            const behind = d.target != null && d.target > 0 && d.revenue < d.target * 0.95;
            const on = f.divisions.includes(d.division);
            return (
              <button
                key={d.division}
                onClick={() => set({
                  divisions: on ? f.divisions.filter((x) => x !== d.division) : [...f.divisions, d.division],
                })}
                style={{
                  textAlign: 'left', cursor: 'pointer', padding: 0,
                  border: `1px solid ${behind ? 'var(--danger)' : on ? 'var(--primary)' : 'var(--border)'}`,
                  borderTop: `2px solid ${behind ? 'var(--danger)' : HUE[d.division]}`,
                  borderRadius: 'var(--r-md)', background: 'var(--surface)',
                  fontFamily: 'var(--inter)',
                }}
              >
                <div style={{ padding: '13px 15px 11px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, height: 20, padding: '0 8px',
                      border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
                      fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                      textTransform: 'uppercase', color: 'var(--text-muted)',
                    }}>
                      <span style={{ width: 7, height: 7, borderRadius: 2, background: HUE[d.division] }} />
                      {d.name}
                    </span>
                    {behind && (
                      <span style={{
                        fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                        color: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 12%, transparent)',
                        padding: '2px 6px', borderRadius: 'var(--r-sm)',
                      }}>Behind</span>
                    )}
                  </div>
                  <div style={{
                    fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 26, marginTop: 8,
                    letterSpacing: '-0.03em', color: 'var(--text)', fontVariantNumeric: 'tabular-nums',
                  }}>{shortMoney(d.revenue)}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 1 }}>
                    {d.division === 'trailer' ? `sold, ${d.deals} trailers` : `invoiced, ${d.deals} invoices`}
                  </div>
                </div>
                <div style={{ borderTop: '1px solid var(--border)' }}>
                  {d.detail.map((row) => (
                    <div key={row.label} style={{
                      display: 'flex', justifyContent: 'space-between', gap: 12,
                      padding: '7px 15px', fontSize: 12.5,
                      borderTop: '1px solid var(--border)',
                    }}>
                      <span style={{ color: 'var(--text-muted)' }}>{row.label}</span>
                      <span style={{
                        color: row.bad ? 'var(--danger)' : 'var(--text)', fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums',
                      }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

function growthWords(points: { stc: number; trailer: number; rental: number }[]): string {
  const last = points[points.length - 1];
  if (!last) return 'Not enough months to draw a trend yet.';
  const say = (name: string, v: number) => {
    const d = v - 100;
    if (Math.abs(d) < 3) return `${name} is level`;
    return `${name} is ${d > 0 ? 'up' : 'down'} ${Math.abs(d).toFixed(0)}%`;
  };
  return `${say('STC', last.stc)}, ${say('trailer sales', last.trailer)}, ${say('rentals', last.rental)} against where each started.`;
}

function movedWords(divisions: Analytics['divisions']): string {
  const delta = divisions.reduce((a, d) => a + (d.revenue - d.was), 0);
  const biggest = [...divisions]
    .map((d) => ({ name: d.name, d: d.revenue - d.was }))
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))[0];
  if (!biggest) return 'Nothing to compare.';
  return `${delta >= 0 ? 'Up' : 'Down'} ${shortMoney(Math.abs(delta))}. `
    + `${biggest.name} ${biggest.d >= 0 ? 'added' : 'gave back'} ${shortMoney(Math.abs(biggest.d))} of that.`;
}

function monthLabel(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`)
    .toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/* =============================================================
   People
   ============================================================= */
function People({ data, f, set }: {
  data: Analytics; f: Filters; set: (p: Partial<Filters>) => void;
}) {
  const people = data.people;
  const max = Math.max(1, ...people.map((p) => p.leads));
  const totalLeads = people.reduce((a, p) => a + p.leads, 0);
  const totalWon = people.reduce((a, p) => a + p.won, 0);
  const groupRate = totalLeads > 0 ? totalWon / totalLeads : 0;

  if (people.length === 0) {
    return (
      <Chart title="New business by person" says="Nobody raised a lead in this window."
        foot={<span>Leads count against the window they were raised in, wins against the window they were agreed in.</span>}>
        <div style={{ padding: '24px 0', fontSize: 13, color: 'var(--text-subtle)' }}>
          Nothing to rank. Widen the period or clear a filter.
        </div>
      </Chart>
    );
  }

  return (
    <>
      {/* Two to a row. */}
      <Pair>
      <div>
        <DeviceLabel
          title="Leaderboard with progression"
          sub="The bar is three nested segments: leads, of which quoted, of which won. A wide pale bar with a narrow dark tip is somebody generating interest but not closing."
        />
        <Chart
          title="New business by person"
          says={leaderWords(people)}
          legend={<Legend items={[
            { name: 'Leads', colour: PROGRESSION.leads },
            { name: 'Quoted', colour: PROGRESSION.quoted },
            { name: 'Won', colour: PROGRESSION.won },
          ]} />}
          foot={<span>Click a row to narrow the page to that person. Revenue stays group wide: a Protean invoice does not carry a salesperson.</span>}
        >
          <div>
            {people.map((p, at) => (
              <button
                key={p.id}
                onClick={() => set({ person: f.person === p.id ? null : p.id })}
                style={{
                  display: 'grid', width: '100%', textAlign: 'left', cursor: 'pointer',
                  gridTemplateColumns: '26px 176px 1fr 108px 96px',
                  gap: 12, alignItems: 'center', padding: '9px 4px',
                  border: 0, borderTop: at === 0 ? 'none' : '1px solid var(--border)',
                  background: f.person === p.id ? 'var(--bg-subtle)' : 'transparent',
                  fontFamily: 'var(--inter)',
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums' }}>
                  {at + 1}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{p.name}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-subtle)' }}>
                    {p.division ? DIVISION_NAME[p.division] : 'No division'}
                  </span>
                </span>
                <Progression leads={p.leads} quoted={p.quoted} won={p.won} max={max} />
                <span style={{
                  fontSize: 12, color: 'var(--text-muted)', textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                }}>{p.leads} · {p.quoted} · <strong style={{ color: 'var(--text)' }}>{p.won}</strong></span>
                <span style={{
                  fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 13, textAlign: 'right',
                  color: 'var(--text)', fontVariantNumeric: 'tabular-nums',
                }}>{shortMoney(p.wonValue)}</span>
              </button>
            ))}
          </div>
        </Chart>
      </div>

      <div>
        <DeviceLabel
          title="Conversion against the group rate"
          sub="A dot per person against the group average. Above the line is closing better than average, and dot size is how much they closed."
        />
        <Chart
          title="Lead to won conversion"
          says={`Group average is ${Math.round(groupRate * 100)}%.`}
          foot={<span>Dot size is won value, so a small dot high up is a good rate on a small book. Both matter, and neither alone tells you who to back.</span>}
        >
          <DotPlot
            groupRate={groupRate}
            people={people.map((p) => ({
              id: p.id, initials: p.initials, name: p.name, rate: p.conversion, value: p.wonValue,
            }))}
          />
        </Chart>
      </div>
      </Pair>

      {data.sources.length > 0 && (
        <div>
          <DeviceLabel
            title="Where work came from, and what became of it"
            sub="Bands from each source splitting into won by division, still open, and lost. The loss is drawn at full width rather than left as the gap."
          />
          <Chart
            title={`${data.sources.reduce((a, s) => a + s.leads, 0)} leads raised in this window`}
            says={sourceWords(data.sources)}
            foot={(
              <span>
                The source is recorded on the CUSTOMER rather than on the lead, so this reads as
                &ldquo;what work from this kind of customer turned into&rdquo;. Close to per lead
                attribution and not identical to it.
              </span>
            )}
          >
            <SourceFlowChart rows={data.sources} />
          </Chart>
        </div>
      )}
    </>
  );
}

function leaderWords(people: Analytics['people']): string {
  if (people.length < 2) return `${people[0]?.name ?? 'Nobody'} is the only person with anything in this window.`;
  const byValue = people[0]!;
  const byLeads = [...people].sort((a, b) => b.leads - a.leads)[0]!;
  if (byValue.id === byLeads.id) {
    return `${byValue.name} leads on both volume and value.`;
  }
  return `${byLeads.name} generates the most leads but ${byValue.name} converts more value. `
    + 'Two different conversations, in the same row.';
}

function sourceWords(sources: Analytics['sources']): string {
  const best = [...sources]
    .filter((s) => s.leads >= 3)
    .sort((a, b) => rate(b) - rate(a))[0];
  const worst = [...sources]
    .filter((s) => s.leads >= 3)
    .sort((a, b) => rate(a) - rate(b))[0];
  if (!best || !worst || best === worst) return 'Not enough leads yet to compare sources.';
  return `${best.source} converts best at ${Math.round(rate(best) * 100)}%. `
    + `${worst.source} brought ${worst.leads} and closed ${won(worst)}.`;
}

const won = (s: Analytics['sources'][number]) => s.won.stc + s.won.trailer + s.won.rental;
const rate = (s: Analytics['sources'][number]) => (s.leads > 0 ? won(s) / s.leads : 0);

/* =============================================================
   Trailer sales
   ============================================================= */
function Stock({ data }: { data: Analytics & { bands?: any[] } }) {
  const units = data.stock;
  const old = units.filter((u) => u.days > 120);
  const thin = old.filter((u) => u.marginPct != null && u.marginPct < 8);
  const noCost = units.filter((u) => u.marginPct == null);

  if (units.length === 0) {
    return (
      <Chart title="Stock" says="Nothing is showing as in stock."
        foot={<span>Reads the stock list, counting anything marked in stock or available.</span>}>
        <div style={{ padding: '24px 0', fontSize: 13, color: 'var(--text-subtle)' }}>
          No units to plot.
        </div>
      </Chart>
    );
  }

  return (
    <>
      <Pair>
      <div>
        <DeviceLabel
          title="Stock age against margin"
          sub="Every dot is a trailer. Right means it has been here too long, low means there is little margin left to give away. The bottom right corner is the problem corner."
        />
        <Chart
          title={`${units.length} trailers in stock`}
          says={`${old.length} are past 120 days. ${thin.length} of those have under 8% margin left to discount.`}
          action={<span style={{
            fontSize: 11, color: 'var(--text-muted)', padding: '4px 8px',
            border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', whiteSpace: 'nowrap',
          }}>Dot size = asking price</span>}
          foot={(
            <span>
              Days are counted from the day the unit was added to the stock list, which is the
              earliest date this application holds for it.
              {noCost.length > 0 && ` ${noCost.length} units have no cost recorded and are not plotted: a margin cannot be worked out for them.`}
            </span>
          )}
        >
          <StockScatter units={units} />
        </Chart>
      </div>

      {data.bands && (
        <div>
          <DeviceLabel
            title="Stock ageing bands"
            sub="How the units break down, and what each band is worth. The band, not the average, is what tells you whether stock is turning."
          />
          <Chart
            title="What is tied up, by age"
            says={bandWords(data.bands)}
            foot={<span>Value is the asking price, not what a unit would fetch after a discount.</span>}
          >
            <BandStrip bands={data.bands} />
          </Chart>
        </div>
      )}
      </Pair>
    </>
  );
}

function bandWords(bands: { label: string; units: number; value: number; reading: string }[]): string {
  const bad = bands[bands.length - 1];
  if (!bad || bad.units === 0) return 'Nothing is older than four months. Stock is turning.';
  return `${shortMoney(bad.value)} is tied up in stock older than four months, across ${bad.units} units.`;
}

/* =============================================================
   FleetSmart+
   ============================================================= */
function Book({ data, set }: { data: Analytics; set: (p: Partial<Filters>) => void }) {
  const book = data.book;
  if (!book) {
    return (
      <Chart title="The contract book" says="No FleetSmart+ contracts have been accepted yet."
        foot={<span>Counts accepted contracts only. Drafts and contracts sent and not signed are not a book.</span>}>
        <div style={{ padding: '24px 0', fontSize: 13, color: 'var(--text-subtle)' }}>
          Nothing to draw. The book appears the first time a contract is accepted.
        </div>
      </Chart>
    );
  }

  const first = book.months[0];
  const last = book.months[book.months.length - 1];
  const grew = first && last
    ? ((total(last) - total(first)) / Math.max(1, total(first))) * 100
    : 0;

  return (
    <>
      <div>
        <DeviceLabel
          title="The book, built by tier"
          sub="Stacked weekly value by month. The height is the whole book, and the segments show which tier is actually growing."
        />
        <Chart
          title="Weekly contracted value"
          says={first && last
            ? `The book is ${grew >= 0 ? 'up' : 'down'} ${Math.abs(grew).toFixed(0)}% over these months.`
            : 'Not enough months to show a trend yet.'}
          legend={<Legend items={[
            { name: 'Silver', colour: TIER.silver },
            { name: 'Gold', colour: TIER.gold },
            { name: 'Platinum', colour: TIER.platinum },
          ]} />}
          foot={<span>Drag across the bars to set the period for the whole page.</span>}
        >
          <StackedMonths
            months={book.months as any}
            series={[
              { key: 'silver', name: 'Silver', colour: TIER.silver },
              { key: 'gold', name: 'Gold', colour: TIER.gold },
              { key: 'platinum', name: 'Platinum', colour: TIER.platinum },
            ]}
            onBrush={(from, to) => set({
              kind: 'custom',
              from,
              to: endOfMonthIso(to),
            })}
          />
        </Chart>

        <div style={{
          display: 'grid', gap: 1, marginTop: 12, background: 'var(--border)',
          border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
        }}>
          {[
            ['This week', money(book.thisWeek), `across ${book.contracts} contracts`],
            ['Annualised', shortMoney(book.annualised), 'if nothing changes'],
            ['Added this period', money(book.addedThisPeriod), 'weekly value of new contracts'],
            ['Average', money(book.contracts ? book.thisWeek / book.contracts : 0), 'per contract per week'],
          ].map(([label, value, sub]) => (
            <div key={label} style={{ background: 'var(--surface)', padding: '11px 13px' }}>
              <div style={{
                fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10,
                letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-subtle)',
              }}>{label}</div>
              <div style={{
                fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 21, marginTop: 3,
                color: 'var(--text)', fontVariantNumeric: 'tabular-nums',
              }}>{value}</div>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 1 }}>{sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* The mix sits on its own row. The cohort grid follows it at full
          width, because that is how wide the kit draws it: 1126 inside
          a 1440 page. Putting it in a two column grid halved it, which
          is a layout the file does not have. */}
      <div>
        <Chart
          title={`Mix today, ${book.contracts} contracts`}
          says={mixWords(book)}
          foot={<span>Contracts on the left of each row, weekly value on the right. They rank differently, which is the point.</span>}
        >
          <ShareRows rows={book.mix.map((m) => ({
            name: m.tier, count: m.contracts, value: m.weekly,
            colour: m.tier === 'Platinum' ? TIER.platinum : m.tier === 'Gold' ? TIER.gold : TIER.silver,
          }))} />
        </Chart>

        {/* No Chart wrapper. The kit's cohort device is the whole
            panel: its own border, title, sentence, grid, footnote and
            scale. Wrapping it in ours would draw the panel twice and
            the title twice, which is what happens when a device is
            treated as a chart rather than as the design. */}
        <CohortGrid cohorts={book.cohorts} says={retentionWords(book)} />
      </div>
    </>
  );
}

const total = (m: { silver: number; gold: number; platinum: number }) => m.silver + m.gold + m.platinum;

function mixWords(book: NonNullable<Analytics['book']>): string {
  const weekly = book.mix.reduce((a, m) => a + m.weekly, 0);
  const biggest = [...book.mix].sort((a, b) => b.weekly - a.weekly)[0];
  if (!biggest || weekly === 0) return 'No live contracts to break down.';
  return `${biggest.tier} is ${Math.round((biggest.weekly / weekly) * 100)}% of the weekly value `
    + `from ${biggest.contracts} of ${book.contracts} contracts.`;
}

function retentionWords(book: NonNullable<Analytics['book']>): string {
  const withData = book.cohorts.filter((c) => c.signed > 0);
  if (withData.length === 0) return 'No contracts have started in these months.';
  const worst = [...withData].sort((a, b) => {
    const la = a.live.filter((v) => v != null).pop() ?? 100;
    const lb = b.live.filter((v) => v != null).pop() ?? 100;
    return la - lb;
  })[0]!;
  const kept = worst.live.filter((v) => v != null).pop() ?? 100;
  if (kept === 100) return 'Every contract signed in these months is still live.';
  return `The ${monthLabel(worst.month)} cohort has kept ${kept}% of what it signed, the lowest of any month here.`;
}

function endOfMonthIso(month: string): string {
  const d = new Date(`${month.slice(0, 10)}T00:00:00Z`);
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

/* =============================================================
   Customers
   ============================================================= */
function Customers({ data }: { data: Analytics }) {
  if (data.customers.length === 0) {
    return (
      <Chart title="Top customers" says="Nothing invoiced in this window."
        foot={<span>Reads Protean and Sage invoices by tax point.</span>}>
        <div style={{ padding: '24px 0', fontSize: 13, color: 'var(--text-subtle)' }}>
          No customers to rank.
        </div>
      </Chart>
    );
  }
  const top = data.customers;
  const all = top.reduce((a, c) => a + c.revenue, 0);

  return (
    <Chart
      title={`Top ${top.length} customers`}
      says={`These ${top.length} account for ${shortMoney(all)} of invoicing in this window.`}
      foot={<span>Protean and Sage account names, so a customer not yet matched to a CRM record still appears. Trailer sales are not invoiced through either and are not in this table.</span>}
    >
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr>
              {['Customer', 'Division', 'This window', 'Comparison', 'Change'].map((h, i) => (
                <th key={h} style={{
                  textAlign: i >= 2 ? 'right' : 'left', padding: '0 10px 7px',
                  fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10,
                  letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-subtle)',
                  borderBottom: '1px solid var(--border-strong)', whiteSpace: 'nowrap',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {top.map((c) => {
              const change = c.was > 0 ? ((c.revenue - c.was) / c.was) * 100 : null;
              return (
                <tr key={`${c.division}-${c.name}`}>
                  <td style={{ ...cellStyle, color: 'var(--text)', fontWeight: 500 }}>{c.name}</td>
                  <td style={{ ...cellStyle, color: 'var(--text-subtle)' }}>{DIVISION_NAME[c.division]}</td>
                  <td style={{ ...cellStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>
                    {money(c.revenue)}
                  </td>
                  <td style={{ ...cellStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-subtle)' }}>
                    {c.was > 0 ? money(c.was) : '—'}
                  </td>
                  <td style={{
                    ...cellStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                    color: change == null ? 'var(--text-subtle)' : change >= 0 ? 'var(--success)' : 'var(--danger)',
                  }}>
                    {change == null ? 'new' : `${change >= 0 ? '+' : ''}${change.toFixed(0)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Chart>
  );
}

const cellStyle: React.CSSProperties = {
  padding: '8px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
};
