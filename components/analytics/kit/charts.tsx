'use client';

import { useMemo, useRef, useState } from 'react';
import { Readout, money, pct, shortMoney, useReadout } from './frame';

/* =============================================================
   The charts, recreated from `STCUIAnalytics.html`.

   Hand built SVG rather than a charting library, for the same reason
   the month by month chart on the old page was: every one of these is a
   bespoke device the design asks for by name, and none of them is a
   default any library ships. A bullet row with a target notch, a
   waterfall, a nested progression bar, a source-to-outcome flow, a
   quadrant scatter with a decision corner, a cohort grid. Bending a
   library into each of those costs more than drawing them, and leaves
   six configurations nobody can read instead of six shapes anybody can.

   ---- What every chart here has ----

   1. A hover readout carrying the figure, the comparison and what the
      figure is made of, from `Readout` so all six behave identically.
   2. Colour that is never the only carrier. Every series has a legend,
      every axis is labelled, and every alarm state also says a word.
   3. Data colours from `--chart-*`, which are the kit's own data axis
      and are separate from the action colours: `--primary` and
      `--accent` invert between light and dark because a button has to,
      and a division must not.
   ============================================================= */

export const HUE = {
  stc: 'var(--chart-stc)',
  trailer: 'var(--chart-trailer)',
  rental: 'var(--chart-rental)',
} as const;

const GRID = 'var(--border)';
const AXIS = 'var(--text-subtle)';

/* -------------------------------------------------------------
   1. Revenue against target

   From the design: "A bar per division with the target as a red notch,
   so hitting or missing is a position rather than a sum to work out."
   The notch is the only red on the chart, which is what makes a miss
   read instantly.
   ------------------------------------------------------------- */
export function BulletRows({ rows, onPick }: {
  rows: { key: string; name: string; value: number; target: number | null; colour: string }[];
  onPick?: (key: string) => void;
}) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.value, r.target ?? 0])) * 1.12;
  const { at, setAt, clear } = useReadout();
  const box = useRef<HTMLDivElement>(null);

  return (
    <div ref={box} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 9 }}>
      {rows.map((r) => {
        const over = r.target != null && r.value >= r.target;
        return (
          <div
            key={r.key}
            onClick={() => onPick?.(r.key)}
            onMouseMove={(e) => {
              const b = box.current?.getBoundingClientRect();
              if (!b) return;
              setAt({
                x: e.clientX - b.left, y: e.clientY - b.top - 8,
                title: r.name, value: shortMoney(r.value),
                delta: r.target
                  ? { pct: ((r.value - r.target) / r.target) * 100, against: 'against target' }
                  : null,
                made: r.target != null ? `Target ${shortMoney(r.target)}` : 'No target set',
              });
            }}
            onMouseLeave={clear}
            style={{
              display: 'grid', gridTemplateColumns: '140px 1fr 92px 74px',
              gap: 12, alignItems: 'center', cursor: onPick ? 'pointer' : 'default',
            }}
          >
            <span style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 500 }}>{r.name}</span>

            <div style={{ position: 'relative', height: 22, background: 'var(--bg-subtle)', borderRadius: 2 }}>
              <div style={{
                position: 'absolute', inset: 0, width: `${Math.max(0, (r.value / max) * 100)}%`,
                background: r.colour, borderRadius: 2,
              }} />
              {r.target != null && r.target > 0 && (
                <span
                  title={`Target ${shortMoney(r.target)}`}
                  style={{
                    position: 'absolute', top: -3, bottom: -3,
                    left: `${(r.target / max) * 100}%`, width: 2,
                    background: 'var(--danger)',
                  }}
                />
              )}
            </div>

            <span style={{
              fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 13,
              textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
            }}>{shortMoney(r.value)}</span>

            <span style={{
              fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
              color: r.target == null ? 'var(--text-subtle)' : over ? 'var(--success)' : 'var(--danger)',
            }}>
              {r.target == null ? 'no target'
                : `${r.value >= r.target ? '+' : ''}${shortMoney(r.value - r.target)}`}
            </span>
          </div>
        );
      })}
      {at && <Readout {...at} />}
    </div>
  );
}

/* -------------------------------------------------------------
   2. Indexed division trend

   Every division starts at 100, so a line above the middle rule means
   growth regardless of what that division actually sells. Indexing
   hides size deliberately: a good month for rentals is a rounding error
   against STC revenue, and the two cannot otherwise share an axis.
   ------------------------------------------------------------- */
export function IndexedLines({ points, height = 190 }: {
  points: { month: string; stc: number; trailer: number; rental: number }[];
  height?: number;
}) {
  const W = 1000;
  const H = height;
  const pad = { l: 8, r: 8, t: 12, b: 22 };
  const { at, setAt, clear } = useReadout();
  const box = useRef<HTMLDivElement>(null);

  const all = points.flatMap((p) => [p.stc, p.trailer, p.rental]);
  const lo = Math.min(80, ...all);
  const hi = Math.max(120, ...all);
  const x = (i: number) => pad.l + (i / Math.max(1, points.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - pad.t - pad.b);

  const path = (key: 'stc' | 'trailer' | 'rental') => points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(' ');

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height, display: 'block' }} role="img"
        aria-label="Each division indexed to 100 at the start of the period">
        {[lo, (lo + hi) / 2, hi].map((v) => (
          <line key={v} x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)}
            stroke={GRID} strokeDasharray="3 4" />
        ))}
        {/* 100 is the only solid rule: it is the line that means "no
            change", and everything about this chart is read against it. */}
        <line x1={pad.l} x2={W - pad.r} y1={y(100)} y2={y(100)} stroke="var(--border-strong)" />
        <text x={pad.l + 4} y={y(100) - 6} fontSize={10} fill={AXIS}>100 = where each division started</text>

        {(['rental', 'trailer', 'stc'] as const).map((k) => (
          <path key={k} d={path(k)} fill="none" stroke={HUE[k]} strokeWidth={2.2}
            strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {points.map((p, i) => (
          <rect
            key={p.month}
            x={x(i) - (W / points.length) / 2} y={0}
            width={W / points.length} height={H - pad.b}
            fill="transparent"
            onMouseEnter={(e) => {
              const b = box.current?.getBoundingClientRect();
              const r = (e.target as SVGRectElement).getBoundingClientRect();
              if (!b) return;
              setAt({
                x: r.left - b.left + r.width / 2, y: 10,
                title: monthName(p.month),
                value: `STC ${Math.round(p.stc)}`,
                made: `Trailer ${Math.round(p.trailer)} · Rentals ${Math.round(p.rental)}`,
              });
            }}
            onMouseLeave={clear}
          />
        ))}

        {points.map((p, i) => (
          i % Math.max(1, Math.round(points.length / 12)) === 0 ? (
            <text key={p.month} x={x(i)} y={H - 6} fontSize={10} fill={AXIS} textAnchor="middle">
              {monthName(p.month).slice(0, 1)}
            </text>
          ) : null
        ))}
      </svg>
      {at && <Readout {...at} />}
    </div>
  );
}

function monthName(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`)
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/* -------------------------------------------------------------
   3. Waterfall

   From the design: "A waterfall, not a pie. It answers what changed
   rather than what is the split."
   ------------------------------------------------------------- */
export function Waterfall({ start, steps, end }: {
  start: { label: string; value: number };
  steps: { label: string; delta: number; colour: string }[];
  end: { label: string; value: number };
}) {
  const H = 220;
  const cols = steps.length + 2;
  const top = Math.max(start.value, end.value,
    ...steps.map((_, i) => start.value + steps.slice(0, i + 1).reduce((a, s) => a + s.delta, 0)));
  const scale = (v: number) => (v / Math.max(1, top * 1.1)) * (H - 40);
  const { at, setAt, clear } = useReadout();
  const box = useRef<HTMLDivElement>(null);

  let running = start.value;
  const bars = steps.map((s) => {
    const from = running;
    running += s.delta;
    return { ...s, from, to: running };
  });

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 10,
        alignItems: 'end', height: H,
      }}>
        {/* The two ends are DATA, so they take a data colour and not
            `--primary`. `--primary` inverts between the themes because a
            button has to, so a bar painted with it is navy in light and
            white in dark, which is the bug migration-era note 47 in this
            repository already recorded once. `--chart-company` is the
            token for "the whole group" and holds still. */}
        <Column label={start.label} value={shortMoney(start.value)}
          bar={<div style={{ height: scale(start.value), background: 'var(--chart-company)', borderRadius: 2 }} />} />

        {bars.map((b) => {
          const up = b.delta >= 0;
          const height = Math.max(3, scale(Math.abs(b.delta)));
          const bottom = scale(Math.min(b.from, b.to));
          return (
            <div key={b.label} style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'flex-end' }}>
              <div style={{ position: 'relative', height: H - 40 }}>
                <div
                  onMouseEnter={(e) => {
                    const p = box.current?.getBoundingClientRect();
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    if (!p) return;
                    setAt({
                      x: r.left - p.left + r.width / 2, y: r.top - p.top,
                      title: b.label,
                      value: `${b.delta >= 0 ? '+' : ''}${shortMoney(b.delta)}`,
                      made: `${shortMoney(b.from)} to ${shortMoney(b.to)}`,
                    });
                  }}
                  onMouseLeave={clear}
                  style={{
                    position: 'absolute', left: 0, right: 0,
                    bottom, height,
                    background: up ? b.colour : 'var(--danger)', borderRadius: 2,
                  }}
                />
              </div>
              <Foot label={b.label} value={`${b.delta >= 0 ? '+' : ''}${shortMoney(b.delta)}`}
                tone={up ? 'up' : 'down'} />
            </div>
          );
        })}

        <Column label={end.label} value={shortMoney(end.value)}
          bar={<div style={{ height: scale(end.value), background: 'var(--chart-company)', borderRadius: 2 }} />} />
      </div>
      {at && <Readout {...at} />}
    </div>
  );
}

function Column({ label, value, bar }: { label: string; value: string; bar: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'flex-end' }}>
      <div style={{ height: 180, display: 'flex', alignItems: 'flex-end' }}>
        <div style={{ width: '100%' }}>{bar}</div>
      </div>
      <Foot label={label} value={value} />
    </div>
  );
}

function Foot({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div style={{ textAlign: 'center', marginTop: 8 }}>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div style={{
        fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 12.5, marginTop: 1,
        fontVariantNumeric: 'tabular-nums',
        color: tone === 'up' ? 'var(--success)' : tone === 'down' ? 'var(--danger)' : 'var(--text)',
      }}>{value}</div>
    </div>
  );
}

/* -------------------------------------------------------------
   4. The leaderboard's nested progression bar

   From the design: "The bar is three nested segments: leads, of which
   quoted, of which won. A wide pale bar with a narrow dark tip is
   somebody generating interest but not closing."

   One bar per person on a SHARED scale, so rows compare without reading
   the numbers.
   ------------------------------------------------------------- */
/* One hue at three strengths, not three division colours.

   Leads, quoted and won are a PROGRESSION: each is a subset of the one
   before it. Three separate hues say "three categories", and worse, the
   three that were here are the division colours, so a leads segment was
   drawn in the orange that means Rentals everywhere else on this page.

   Strength carries the progression instead, which is also what makes
   the reference's own reading work: a wide pale bar with a narrow dark
   tip is somebody generating interest and not closing. */
export const PROGRESSION = {
  leads: 'color-mix(in srgb, var(--chart-stc) 26%, var(--surface))',
  quoted: 'color-mix(in srgb, var(--chart-stc) 58%, var(--surface))',
  won: 'var(--chart-stc)',
} as const;

export function Progression({ leads, quoted, won, max }: {
  leads: number; quoted: number; won: number; max: number;
}) {
  const w = (n: number) => `${Math.max(0, (n / Math.max(1, max)) * 100)}%`;
  return (
    <div style={{ position: 'relative', height: 18, background: 'var(--bg-subtle)', borderRadius: 2 }}>
      <div style={{ position: 'absolute', inset: 0, width: w(leads), background: PROGRESSION.leads, borderRadius: 2 }} />
      <div style={{ position: 'absolute', inset: 0, width: w(quoted), background: PROGRESSION.quoted, borderRadius: 2 }} />
      <div style={{ position: 'absolute', inset: 0, width: w(won), background: PROGRESSION.won, borderRadius: 2 }} />
    </div>
  );
}

/* -------------------------------------------------------------
   5. Conversion against the group rate

   A dot per person against the group average. Above the line is closing
   better than average, and dot size is how much they closed, so a small
   dot high up is a good rate on a small book. Both matter, and neither
   alone tells you who to back.
   ------------------------------------------------------------- */
export function DotPlot({ people, groupRate }: {
  people: { id: string; initials: string; name: string; rate: number; value: number }[];
  groupRate: number;
}) {
  const H = 190;
  const pad = { t: 16, b: 44 };
  const rates = people.map((p) => p.rate);
  const hi = Math.max(groupRate * 1.6, ...rates, 0.1);
  const y = (r: number) => pad.t + (1 - r / hi) * (H - pad.t - pad.b);
  const biggest = Math.max(1, ...people.map((p) => p.value));
  const { at, setAt, clear } = useReadout();
  const box = useRef<HTMLDivElement>(null);

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <svg viewBox={`0 0 1000 ${H}`} style={{ width: '100%', height: H, display: 'block' }} role="img"
        aria-label="Lead to won conversion for each person against the group rate">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={1000} y1={pad.t + f * (H - pad.t - pad.b)} y2={pad.t + f * (H - pad.t - pad.b)}
            stroke={GRID} strokeDasharray="3 4" />
        ))}
        <line x1={0} x2={940} y1={y(groupRate)} y2={y(groupRate)} stroke="var(--danger)" strokeWidth={1.5} />
        <text x={946} y={y(groupRate) + 4} fontSize={11} fill="var(--danger)" fontWeight={600}>
          group {Math.round(groupRate * 100)}%
        </text>

        {people.map((p, i) => {
          const cx = ((i + 0.5) / Math.max(1, people.length)) * 940;
          const r = 6 + (p.value / biggest) * 14;
          return (
            <g key={p.id}>
              <ellipse
                cx={cx} cy={y(p.rate)} rx={r} ry={r * 0.68}
                fill={p.rate >= groupRate ? HUE.stc : HUE.rental}
                stroke="var(--surface)" strokeWidth={1.5}
                onMouseEnter={(e) => {
                  const b = box.current?.getBoundingClientRect();
                  const t = (e.target as SVGElement).getBoundingClientRect();
                  if (!b) return;
                  setAt({
                    x: t.left - b.left + t.width / 2, y: t.top - b.top,
                    title: p.name,
                    value: `${Math.round(p.rate * 100)}% closed`,
                    made: `${shortMoney(p.value)} won. Dot size is what they closed.`,
                  });
                }}
                onMouseLeave={clear}
              />
              <text x={cx} y={H - 24} fontSize={11} fill="var(--text)" textAnchor="middle" fontWeight={600}>
                {p.initials}
              </text>
              <text x={cx} y={H - 9} fontSize={11} fill={AXIS} textAnchor="middle">
                {Math.round(p.rate * 100)}%
              </text>
            </g>
          );
        })}
      </svg>
      {at && <Readout {...at} />}
    </div>
  );
}

/* -------------------------------------------------------------
   6. Where leads came from, and what became of them

   From the design: "The pale band is what did not close. Drawing it at
   full width is the point: 82 of 142 leads went nowhere, and outbound
   accounts for most of the waste."

   A funnel would hide which source the losses came from. Keeping source
   and outcome on one picture is what makes it actionable.
   ------------------------------------------------------------- */
export function SourceFlowChart({ rows, height = 260 }: {
  rows: { source: string; leads: number; won: Record<string, number>; lost: number; open: number }[];
  height?: number;
}) {
  const total = Math.max(1, rows.reduce((a, r) => a + r.leads, 0));
  const H = height;
  const gap = 6;
  const usable = H - gap * Math.max(0, rows.length - 1);
  const { at, setAt, clear } = useReadout();
  const box = useRef<HTMLDivElement>(null);

  const outcomes = [
    { key: 'stc', label: 'Won, STC', colour: HUE.stc },
    { key: 'trailer', label: 'Won, Trailer', colour: HUE.trailer },
    { key: 'rental', label: 'Won, Rentals', colour: HUE.rental },
    { key: 'open', label: 'Still open', colour: 'var(--border-strong)' },
    { key: 'lost', label: 'Lost', colour: 'var(--bg-subtle)' },
  ];

  const totals: Record<string, number> = { stc: 0, trailer: 0, rental: 0, open: 0, lost: 0 };
  for (const r of rows) {
    totals.stc! += r.won.stc ?? 0;
    totals.trailer! += r.won.trailer ?? 0;
    totals.rental! += r.won.rental ?? 0;
    totals.open! += r.open;
    totals.lost! += r.lost;
  }

  let leftY = 0;
  const left = rows.map((r) => {
    const h = (r.leads / total) * usable;
    const y = leftY;
    leftY += h + gap;
    return { ...r, y, h };
  });

  let rightY = 0;
  const right = outcomes.map((o) => {
    const h = ((totals[o.key] ?? 0) / total) * usable;
    const y = rightY;
    rightY += h + gap;
    return { ...o, y, h, value: totals[o.key] ?? 0 };
  });

  /* The bands. Each source splits into its outcomes, and each outcome
     receives from each source, so the two ends are walked in step and
     a ribbon is drawn per pair that has anything in it. */
  const ribbons: { d: string; colour: string; from: string; to: string; n: number }[] = [];
  const takenLeft = new Map<string, number>();
  const takenRight = new Map<string, number>();
  for (const o of right) {
    for (const s of left) {
      const n = o.key === 'open' ? s.open : o.key === 'lost' ? s.lost : (s.won[o.key] ?? 0);
      if (n <= 0) continue;
      const h = (n / total) * usable;
      const ly = s.y + (takenLeft.get(s.source) ?? 0);
      const ry = o.y + (takenRight.get(o.key) ?? 0);
      takenLeft.set(s.source, (takenLeft.get(s.source) ?? 0) + h);
      takenRight.set(o.key, (takenRight.get(o.key) ?? 0) + h);
      ribbons.push({
        d: `M 0 ${ly} C 300 ${ly}, 300 ${ry}, 600 ${ry} L 600 ${ry + h} C 300 ${ry + h}, 300 ${ly + h}, 0 ${ly + h} Z`,
        colour: o.colour, from: s.source, to: o.label, n,
      });
    }
  }

  return (
    <div ref={box} style={{ position: 'relative', display: 'flex', gap: 14, alignItems: 'stretch' }}>
      <div style={{ width: 150, flex: 'none', position: 'relative' }}>
        {left.map((s) => (
          <div key={s.source} style={{
            position: 'absolute', right: 0, top: s.y, height: s.h,
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
            fontSize: 12, color: 'var(--text)', whiteSpace: 'nowrap',
          }}>
            {s.source}
            <span style={{ color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums' }}>{s.leads}</span>
          </div>
        ))}
      </div>

      <svg viewBox={`0 0 600 ${H}`} preserveAspectRatio="none"
        style={{ flex: 1, minWidth: 0, height: H }} role="img"
        aria-label="Leads by source, splitting into won by division, still open and lost">
        {ribbons.map((r, i) => (
          <path
            key={i} d={r.d} fill={r.colour} opacity={0.42}
            onMouseEnter={(e) => {
              const b = box.current?.getBoundingClientRect();
              const t = (e.target as SVGPathElement).getBoundingClientRect();
              if (!b) return;
              (e.target as SVGPathElement).setAttribute('opacity', '0.8');
              setAt({
                x: t.left - b.left + t.width / 2, y: t.top - b.top + 20,
                title: r.from, value: `${r.n} ${r.n === 1 ? 'lead' : 'leads'}`, made: r.to,
              });
            }}
            onMouseLeave={(e) => { (e.target as SVGPathElement).setAttribute('opacity', '0.42'); clear(); }}
          />
        ))}
      </svg>

      <div style={{ width: 150, flex: 'none', position: 'relative' }}>
        {right.filter((o) => o.value > 0).map((o) => (
          <div key={o.key} style={{
            position: 'absolute', left: 0, top: o.y, height: o.h,
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 12, color: 'var(--text)', whiteSpace: 'nowrap',
          }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: o.colour, flex: 'none' }} />
            {o.label}
            <span style={{ color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums' }}>{o.value}</span>
          </div>
        ))}
      </div>
      {at && <Readout {...at} />}
    </div>
  );
}

/* -------------------------------------------------------------
   7. Stock age against margin

   Every dot is a trailer. Right means it has been here too long, low
   means there is little margin left to give away. The bottom right
   corner is the problem corner, and it is shaded so the decision is
   visible without reading forty rows.
   ------------------------------------------------------------- */
export function StockScatter({ units, ageLimit = 120, thinMargin = 8, onPick }: {
  units: { id: string; ref: string; what: string; days: number; marginPct: number | null; price: number }[];
  ageLimit?: number;
  thinMargin?: number;
  onPick?: (id: string) => void;
}) {
  const H = 260;
  const pad = { l: 34, r: 12, t: 14, b: 40 };
  const W = 1000;
  const withMargin = units.filter((u) => u.marginPct != null);
  const maxDays = Math.max(180, ...units.map((u) => u.days));
  const maxMargin = Math.max(30, ...withMargin.map((u) => u.marginPct!));
  const biggest = Math.max(1, ...units.map((u) => u.price));

  const x = (d: number) => pad.l + (d / maxDays) * (W - pad.l - pad.r);
  const y = (m: number) => pad.t + (1 - m / maxMargin) * (H - pad.t - pad.b);
  const { at, setAt, clear } = useReadout();
  const box = useRef<HTMLDivElement>(null);

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }} role="img"
        aria-label="Every trailer in stock, days in stock against margin remaining">
        {/* The problem corner, named as well as shaded. */}
        <rect x={x(ageLimit)} y={y(thinMargin)} width={W - pad.r - x(ageLimit)}
          height={(H - pad.b) - y(thinMargin)}
          fill="var(--danger)" opacity={0.07} />
        <line x1={x(ageLimit)} x2={x(ageLimit)} y1={pad.t} y2={H - pad.b}
          stroke="var(--danger)" strokeDasharray="4 4" />
        <text x={x(ageLimit) + 6} y={H - pad.b - 6} fontSize={11} fill="var(--danger)" fontWeight={600}>
          {ageLimit} days
        </text>
        <text x={W - pad.r} y={pad.t + 10} fontSize={10.5} fill={AXIS} textAnchor="end"
          letterSpacing="0.1em">DISCOUNT TO MOVE</text>
        <text x={pad.l} y={pad.t + 10} fontSize={10.5} fill={AXIS} letterSpacing="0.1em">HOLD FOR PRICE</text>

        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={pad.l} x2={W - pad.r}
            y1={pad.t + f * (H - pad.t - pad.b)} y2={pad.t + f * (H - pad.t - pad.b)}
            stroke={GRID} strokeDasharray="3 4" />
        ))}

        {withMargin.map((u) => {
          const bad = u.days > ageLimit && (u.marginPct ?? 0) < thinMargin;
          return (
            <circle
              key={u.id}
              cx={x(u.days)} cy={y(u.marginPct!)}
              r={5 + (u.price / biggest) * 8}
              fill={bad ? 'var(--danger)' : HUE.trailer}
              stroke="var(--surface)" strokeWidth={1.4}
              style={{ cursor: onPick ? 'pointer' : 'default' }}
              onClick={() => onPick?.(u.id)}
              onMouseEnter={(e) => {
                const b = box.current?.getBoundingClientRect();
                const t = (e.target as SVGCircleElement).getBoundingClientRect();
                if (!b) return;
                setAt({
                  x: t.left - b.left + t.width / 2, y: t.top - b.top,
                  title: u.ref, value: money(u.price),
                  made: `${u.what} · ${u.days} days · ${u.marginPct!.toFixed(1)}% margin left`,
                });
              }}
              onMouseLeave={clear}
            />
          );
        })}

        {[0, 30, 60, 90, 120, 150, 180].filter((d) => d <= maxDays).map((d) => (
          <text key={d} x={x(d)} y={H - 20} fontSize={10.5} fill={AXIS} textAnchor="middle">{d}</text>
        ))}
        <text x={pad.l} y={H - 5} fontSize={11} fill={AXIS}>Days in stock →</text>
        <text x={W - pad.r} y={H - 5} fontSize={11} fill={AXIS} textAnchor="end">↑ Margin remaining, %</text>
      </svg>
      {at && <Readout {...at} />}
    </div>
  );
}

/* -------------------------------------------------------------
   8. Ageing bands

   How the stock breaks down and what each band is worth. The band, not
   the average, is what tells you whether stock is turning.
   ------------------------------------------------------------- */
export function BandStrip({ bands }: {
  bands: { label: string; units: number; value: number; reading: string }[];
}) {
  const shades = [HUE.stc, 'var(--chart-trailer)', HUE.trailer, HUE.rental, 'var(--danger)'];
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${bands.length}, 1fr)`, gap: 1 }}>
        {bands.map((b, i) => (
          <div key={b.label} style={{
            background: shades[i] ?? HUE.rental, color: 'var(--accent-fg)',
            padding: '7px 0', textAlign: 'center',
            fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 15,
            fontVariantNumeric: 'tabular-nums',
          }}>{b.units}</div>
        ))}
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: `repeat(${bands.length}, 1fr)`,
        border: '1px solid var(--border)', borderTop: 0,
      }}>
        {bands.map((b, i) => (
          <div key={b.label} style={{
            padding: '9px 11px 11px',
            borderLeft: i === 0 ? 'none' : '1px solid var(--border)',
          }}>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{b.label}</div>
            <div style={{
              fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 17, marginTop: 2,
              color: 'var(--text)', fontVariantNumeric: 'tabular-nums',
            }}>{shortMoney(b.value)}</div>
            <div style={{
              fontSize: 11.5, marginTop: 2,
              color: b.reading === 'Act now' ? 'var(--danger)'
                : b.reading === 'Watch' ? 'var(--warning)' : 'var(--text-subtle)',
            }}>{b.reading}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------
   9. Stacked bars, with a brush

   The contract book by tier, and the device the design uses for
   brushing: "Dragging on any time chart sets the period for the whole
   page, which is faster than going back to the date picker."
   ------------------------------------------------------------- */
export function StackedMonths({ months, series, height = 200, onBrush }: {
  months: { month: string } & Record<string, string | number>;
  series: never;
  height?: number;
  onBrush?: never;
} | {
  months: ({ month: string } & Record<string, number | string>)[];
  series: { key: string; name: string; colour: string }[];
  height?: number;
  onBrush?: (from: string, to: string) => void;
}) {
  const rows = (Array.isArray(months) ? months : []) as ({ month: string } & Record<string, number | string>)[];
  const keys = (series ?? []) as { key: string; name: string; colour: string }[];
  const H = height;
  const { at, setAt, clear } = useReadout();
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);

  const totalOf = (r: typeof rows[number]) => keys.reduce((a, k) => a + Number(r[k.key] ?? 0), 0);
  const top = Math.max(1, ...rows.map(totalOf)) * 1.12;

  const selection = drag
    ? { lo: Math.min(drag.a, drag.b), hi: Math.max(drag.a, drag.b) }
    : null;

  return (
    <div ref={box} style={{ position: 'relative', userSelect: 'none' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, rows.length)}, 1fr)`,
        gap: 8, alignItems: 'end', height: H,
      }}>
        {rows.map((r, i) => {
          const total = totalOf(r);
          const inSelection = selection && i >= selection.lo && i <= selection.hi;
          return (
            <div
              key={r.month}
              onMouseDown={() => onBrush && setDrag({ a: i, b: i })}
              onMouseEnter={(e) => {
                if (drag && onBrush) setDrag({ ...drag, b: i });
                const b = box.current?.getBoundingClientRect();
                const t = (e.currentTarget as HTMLElement).getBoundingClientRect();
                if (!b) return;
                setAt({
                  x: t.left - b.left + t.width / 2, y: t.top - b.top,
                  title: monthName(r.month), value: shortMoney(total),
                  made: keys.map((k) => `${k.name} ${shortMoney(Number(r[k.key] ?? 0))}`).join(' · '),
                });
              }}
              onMouseUp={() => {
                if (!drag || !onBrush) return;
                const lo = Math.min(drag.a, drag.b);
                const hi = Math.max(drag.a, drag.b);
                setDrag(null);
                if (hi > lo) onBrush(rows[lo]!.month, rows[hi]!.month);
              }}
              onMouseLeave={clear}
              style={{
                display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
                height: '100%', cursor: onBrush ? 'ew-resize' : 'default',
                background: inSelection ? 'color-mix(in srgb, var(--danger) 8%, transparent)' : 'transparent',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column-reverse', height: (total / top) * (H - 34) }}>
                {keys.map((k) => (
                  <div key={k.key} style={{
                    height: `${total > 0 ? (Number(r[k.key] ?? 0) / total) * 100 : 0}%`,
                    background: k.colour,
                  }} />
                ))}
              </div>
              <div style={{ textAlign: 'center', marginTop: 7 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {monthName(r.month).slice(0, 3)}
                </div>
                <div style={{
                  fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 11.5,
                  color: 'var(--text)', fontVariantNumeric: 'tabular-nums',
                }}>{shortMoney(total)}</div>
              </div>
            </div>
          );
        })}
      </div>
      {at && <Readout {...at} />}
    </div>
  );
}

/* -------------------------------------------------------------
   10. The renewal cohort grid

   Every row is the month a contract started. Reading across shows how
   many were still live after one month, two, three. A single retention
   percentage averages away the cohort that is actually churning.
   ------------------------------------------------------------- */
export function CohortGrid({ cohorts }: {
  cohorts: { month: string; signed: number; live: (number | null)[] }[];
}) {
  const steps = Math.max(0, ...cohorts.map((c) => c.live.length));
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 2, minWidth: 620 }}>
        <thead>
          <tr>
            <th style={head}>Started</th>
            <th style={{ ...head, textAlign: 'right' }}>Signed</th>
            {Array.from({ length: steps }, (_, i) => (
              <th key={i} style={{ ...head, textAlign: 'center' }}>M{i}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c.month}>
              <td style={{ ...cell, color: 'var(--text)' }}>{monthName(c.month).replace(/ \d{4}$/, '')}</td>
              <td style={{ ...cell, textAlign: 'right', background: 'var(--bg-subtle)', fontVariantNumeric: 'tabular-nums' }}>
                {c.signed}
              </td>
              {c.live.map((v, i) => (
                <td key={i} style={{
                  ...cell, textAlign: 'center', fontVariantNumeric: 'tabular-nums',
                  /* A cell for a month that has not happened yet is
                     dashed, not empty and not zero. Those are three
                     different facts and only one of them is true. */
                  background: v == null ? 'var(--bg-subtle)'
                    : `color-mix(in srgb, ${HUE.stc} ${Math.max(12, v)}%, var(--surface))`,
                  color: v == null ? 'var(--text-subtle)' : v > 55 ? 'var(--accent-fg)' : 'var(--text)',
                  border: v == null ? '1px dashed var(--border)' : '1px solid transparent',
                }}>{v == null ? '' : v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const head: React.CSSProperties = {
  fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10,
  letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-subtle)',
  padding: '0 6px 6px', textAlign: 'left', whiteSpace: 'nowrap',
};

const cell: React.CSSProperties = {
  padding: '6px 8px', fontSize: 11.5, borderRadius: 2, whiteSpace: 'nowrap',
  color: 'var(--text-muted)',
};

/* -------------------------------------------------------------
   11. A share bar, for the tier mix
   ------------------------------------------------------------- */
export function ShareRows({ rows, unit = 'money' }: {
  rows: { name: string; count: number; value: number; colour: string }[];
  unit?: 'money' | 'count';
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {rows.map((r) => (
        <div key={r.name}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 5 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', flex: 1 }}>{r.name}</span>
            <span style={{ fontSize: 12, color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums' }}>
              {r.count} · {unit === 'money' ? `${money(r.value)}/wk` : r.value}
            </span>
          </div>
          <div style={{ height: 12, background: 'var(--bg-subtle)', borderRadius: 2 }}>
            <div style={{ height: 12, width: `${(r.value / max) * 100}%`, background: r.colour, borderRadius: 2 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
