'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Download, Loader, RefreshCw, SlidersHorizontal, X,
} from 'lucide-react';
import {
  BandStrip, BulletRows, DotPlot, HUE, IndexedLines, PROGRESSION, TIER,
  Progression, ShareRows, SourceFlowChart, StackedMonths, StockScatter, Waterfall,
} from '@/components/analytics/kit/charts';
import { monthLabel } from '@/components/analytics/sections';
import {
  DivisionTable, DrillDowns, Executive, NeedsAttention, WhatsComing,
} from '@/components/analytics/landing';
import {
  Chart, DeviceLabel, Explain, Kpi, Legend, NotWiredPanel, Pair, Section, SectionHead,
  Verdict, money, pct, shortMoney,
} from '@/components/analytics/kit/frame';
import { indexed } from '@/lib/analytics/shape';
import {
  compareWords, iso, periodWords, startOfQuarter, trimWords, windowWords,
  type CompareMode, type PeriodKind,
} from '@/lib/analytics/period';
import type { Analytics, DivisionSlug, Figure, Filters } from '@/lib/analytics/types';

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

/* `Filters` moved to lib/analytics/types.ts when the hub was split
   into a landing and six drill-downs, so all seven share one shape. */

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
  /* Quarterly, not monthly.

     From the business: "Always default to quarterly analytics, not
     monthly." A month to date on the ninth is nine days of trading,
     which is too little to say anything about a division, and it is
     what made the period control read as broken. A quarter carries
     enough weeks to have a shape. */
  const [f, setF] = useState<Filters>({
    kind: 'quarter',
    from: startOfQuarter(today),
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
          {/* Five questions, in the order a management meeting asks
              them: how are we doing, are we ahead or behind, which
              division explains it, what needs attention, what is
              coming next. Nothing else.

              The waterfall, the indexed trend, the scatter, the source
              flow, the dot plot, the cohort grid and the tier stack
              are all still built and all still reachable. They are one
              click away, on their own screens, where somebody who has
              half an hour can use them. */}
          <Executive data={data} onExplain={setExplain} maySetTargets={maySetTargets} />

          <DivisionTable data={data} />

          <Pair>
            <NeedsAttention data={data} />
            <WhatsComing data={data} />
          </Pair>

          <DrillDowns />
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

export function Waiting() {
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
export function ControlBar({ f, set, busy, onRefresh, data, person }: {
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

  /* No `overflow: hidden`, which is what put the comparison menu
     under the rest of the page.

     From the business: "check z indexes, stuff overlaps, the 'against'
     menu loads under all the other content."

     It was not a z-index. The bar clipped its own children so that the
     rounded corners cut the rows inside it, and a popover positioned
     below the button falls outside those bounds, so it was cut off
     rather than covered. Raising the z-index on it could never have
     worked: the menu was not behind anything, it was not being drawn.

     So the clip goes, and the corner it existed for is put on the row
     that is actually last instead. */
  const lastRow = data && trimWords(data.period) ? 'trim' : 'chips';
  const bottomCorners = { borderRadius: '0 0 var(--r-md) var(--r-md)' } as const;

  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 20,
      border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
      background: 'var(--surface)',
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
        ...(lastRow === 'chips' ? bottomCorners : null),
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
          fontSize: 11.5, color: 'var(--text)', ...bottomCorners,
        }}>{trimWords(data.period)}</div>
      )}
    </div>
  );
}

export function DateBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
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
   The glance, and the target form, have gone from this file.

   The glance was the hub's first screen before the restructure. Its
   job is now `Executive`, `DivisionTable`, `NeedsAttention` and
   `WhatsComing` in `components/analytics/landing.tsx`, which is what
   this file renders above.

   The target form was a fold inside the glance, so when the glance
   went it stopped rendering while `Executive` went on linking to
   `/dashboard/analytics/targets`. That link now has a screen behind
   it: `components/analytics/TargetsBoard.tsx`, on its own route,
   guarded on `analytics.targets`, and editing a financial year at a
   time rather than whichever month the page happened to be showing.
   ============================================================= */
