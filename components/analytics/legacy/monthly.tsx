'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { compactMoney, money } from '@/components/kit/primitives';
import { Textures, patternId } from './texture';

/* =============================================================
   The company, month by month.

   From the business, on the version before this one:

     The huge month by month bar chart still doesn't work, a huge
     horizontal bar chart on desktop never looks good. It needs to be a
     proper ... setup with bespoke lines, labels, interactivity - not a
     chart template from a library.

   ---- Why the original could not be made to look right ----

   It was drawn into `viewBox="0 0 100 190"` with
   `preserveAspectRatio="none"`, stretched across whatever width the
   card was. At 1200px wide every unit of the viewBox became twelve, so
   a stroke meant to be one pixel became four in one direction and one
   in the other, and text could not be drawn at all because it would
   have stretched with everything else.

   So this measures the element and draws in real pixels. One unit is
   one pixel, strokes are the width they say they are, text is the size
   it says it is.

   ---- Three shapes, because there are three questions ----

   And on the rebuild:

     Lots of visual data, interactivity, ability to drill in deeper.

   One arrangement cannot answer everything a chart of three divisions
   over two years is asked, so the chart says which question it is
   answering and the toolbar switches it:

     Stacked   how big is the company and what is it made of
     Lines     is this division up or down, on its own scale
     Columns   what did each month bill, month against month

   Stacked is the default because the top edge is the company, which is
   the sentence a board meeting opens with. Lines exist because
   maintenance bills roughly six times what trailer sales does, so on a
   stack the small division is a sliver: unstacked, each one is read
   against itself. Columns exist because a month is a discrete thing and
   an area chart quietly implies that the fifteenth of the month is
   halfway between two invoicing totals, which it is not.

   ---- What it draws that a default chart does not ----

   THE YEAR BOUNDARY, named. The company's year runs April to April, so
   a two year chart contains one rule that matters more than any
   gridline on it.

   LAST YEAR, UNDER THIS YEAR. A faint line twelve months behind the
   total, so "ahead or behind" is a shape rather than a subtraction
   somebody does in their head.

   A MONTH WITH NOTHING IN IT, marked. A line running across an empty
   month reads as steady trading through a month where nothing was
   invoiced.

   THE BANDS, NAMED ON THEMSELVES. Two of the three division colours are
   too close to separate in dark mode, so the chart never asks anybody
   to do it: each band carries its own name where it is thick enough,
   its own fill, and its entry in the key.
   ============================================================= */

export type MonthPoint = {
  month: string;
  /** One number per series, in the order the series are declared. */
  values: number[];
};

export type Series = { key: string; name: string; colour: string };
export type Shape = 'stack' | 'line' | 'column';

/* `top` clears the financial year label, which is drawn above the
   plot rather than in it. */
const PAD = { top: 22, right: 16, bottom: 26, left: 58 };

/** Three or four gridlines at round numbers, never at 3.7 million. */
export function niceTicks(max: number, want = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / want;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(v);
  return out;
}

const monthShort = (m: string) =>
  new Date(`${m}T00:00:00`).toLocaleDateString('en-GB', { month: 'short' });
const monthLong = (m: string) =>
  new Date(`${m}T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

export function MonthlyStack({
  points, series, yearStart, height = 268, shape = 'stack', hidden, textured = true,
}: {
  points: MonthPoint[];
  series: Series[];
  /** The month a financial year begins, 1 to 12. Marked and named. */
  yearStart?: number;
  height?: number;
  shape?: Shape;
  /** Series switched off in the key. Drawn as absent, not as nought. */
  hidden?: Set<string>;
  textured?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [tall, setTall] = useState(0);
  const [over, setOver] = useState<number | null>(null);

  /* BOTH DIMENSIONS, MEASURED.

     Width because everything below is in pixels and a chart drawn at
     the wrong width is the bug this replaces.

     Height because panels on a grid row are the same height as each
     other, and that height is decided by the tallest panel rather than
     by this chart. Drawn at a fixed height inside a taller panel, the
     plot sat in the top two thirds with a band of nothing under it,
     which reads as a panel that failed rather than one that fits.

     `ResizeObserver` rather than a window listener: the panel changes
     size when the grid reflows and the window does not. */
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const seen = new ResizeObserver(([entry]) => {
      setWidth(Math.max(0, Math.round(entry?.contentRect.width ?? 0)));
      setTall(Math.max(0, Math.round(entry?.contentRect.height ?? 0)));
    });
    seen.observe(el);
    const r = el.getBoundingClientRect();
    setWidth(Math.max(0, Math.round(r.width)));
    setTall(Math.max(0, Math.round(r.height)));
    return () => seen.disconnect();
  }, []);

  /** The height it is actually drawn at. `height` is the floor. */
  const H = Math.max(height, tall);

  /* Which series are actually drawn. Their index in the ORIGINAL list is
     carried, because that is what picks the colour and the fill: hiding
     maintenance must not repaint rental. */
  const shown = useMemo(
    () => series.map((s, i) => ({ ...s, i })).filter((s) => !hidden?.has(s.key)),
    [series, hidden],
  );

  const totals = useMemo(
    () => points.map((p) => shown.reduce((s, x) => s + Math.max(0, p.values[x.i] ?? 0), 0)),
    [points, shown],
  );

  /* A stack is read against the company, a set of lines against the
     biggest single division. Using the stack's ceiling for lines would
     press every line into the bottom third, which is the fault that
     made three lines unreadable in the first place. */
  const max = useMemo(() => (shape === 'line'
    ? Math.max(1, ...points.flatMap((p) => shown.map((x) => Math.max(0, p.values[x.i] ?? 0))))
    : Math.max(1, ...totals)), [shape, points, shown, totals]);

  const ticks = useMemo(() => niceTicks(max), [max]);
  const top = ticks[ticks.length - 1] ?? max;

  const inner = {
    w: Math.max(0, width - PAD.left - PAD.right),
    h: Math.max(0, H - PAD.top - PAD.bottom),
  };

  const x = useCallback((i: number) => (points.length <= 1
    ? PAD.left + inner.w / 2
    : PAD.left + (i * inner.w) / (points.length - 1)), [points.length, inner.w]);
  const y = useCallback((v: number) => PAD.top + inner.h - (v / top) * inner.h,
    [inner.h, top]);

  /* The stack, bottom up: each band's upper edge is everything below it
     plus itself. Computed once rather than per path, so neighbouring
     bands share an edge exactly and no hairline of panel shows between
     them. */
  const edges = useMemo(() => {
    const out: number[][] = [];
    let running = points.map(() => 0);
    out.push([...running]);
    for (const s of shown) {
      running = running.map((acc, i) => acc + Math.max(0, points[i]?.values[s.i] ?? 0));
      out.push([...running]);
    }
    return out;
  }, [points, shown]);

  /* Last year's total, twelve months back. Null where there is no month
     twelve back to compare with, so the line starts where the
     comparison starts rather than at nought. */
  const lastYear = useMemo(
    () => totals.map((_, i) => (i >= 12 ? totals[i - 12]! : null)),
    [totals],
  );

  const boundaries = useMemo(() => (yearStart
    ? points.map((p, i) => ((Number(p.month.slice(5, 7)) === yearStart && i > 0) ? i : -1))
      .filter((i) => i >= 0)
    : []), [points, yearStart]);

  /* Every month where they fit, every other one where they would
     collide. Measured against the real width rather than guessed. */
  const labelEvery = Math.max(1, Math.ceil((points.length * 30) / Math.max(1, inner.w)));
  const colW = points.length > 1
    ? Math.max(2, Math.min(22, (inner.w / (points.length - 1)) * 0.62))
    : 22;

  /* WHERE EACH BAND IS THICK ENOUGH TO CARRY ITS OWN NAME.

     The one piece of secondary encoding that costs nothing and works
     everywhere: a band that says "Maintenance" across itself does not
     need anybody to match a colour to a key. Only drawn where the band
     is taller than the text and wide enough for the word. */
  const bandLabels = useMemo(() => {
    if (shape !== 'stack' || !inner.w || points.length < 2) return [];
    return shown.map((s, si) => {
      const lower = edges[si]!;
      const upper = edges[si + 1]!;
      let bestAt = -1;
      let best = 0;
      for (let i = 0; i < points.length; i += 1) {
        const thick = y(lower[i]!) - y(upper[i]!);
        if (thick > best) { best = thick; bestAt = i; }
      }
      if (bestAt < 0 || best < 19) return null;
      /* Kept off both ends, where the label would run out of the plot. */
      const at = Math.min(points.length - 2, Math.max(1, bestAt));
      return {
        key: s.key, name: s.name,
        x: x(at),
        y: (y(lower[at]!) + y(upper[at]!)) / 2,
      };
    }).filter((v): v is { key: string; name: string; x: number; y: number } => v != null);
  }, [shape, shown, edges, points.length, inner.w, x, y]);

  const pick = (clientX: number) => {
    const el = box.current;
    if (!el || points.length === 0) return;
    const at = clientX - el.getBoundingClientRect().left;
    const t = (at - PAD.left) / Math.max(1, inner.w);
    setOver(Math.max(0, Math.min(points.length - 1, Math.round(t * (points.length - 1)))));
  };

  if (!points.length) return null;

  const seen = over != null ? points[over] : null;
  const seenTotal = over != null ? totals[over]! : 0;
  const seenBefore = over != null ? lastYear[over] : null;
  const colours = series.map((s) => s.colour);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
      {/* THE BOX IS SIZED BY THE FLEX ROW, NEVER BY ITS OWN CONTENT.

          `overflow: hidden` with the drawing taken out of flow is what
          stops a loop that is easy to write and obvious once seen: the
          svg is drawn at the measured height, an in flow svg makes the
          box at least that tall, the observer reports the new height,
          and the chart grows again. It settles somewhere around three
          times the intended size, which is exactly what it did. */}
      <div
        ref={box}
        style={{
          position: 'relative', flex: '1 1 0', minHeight: height, width: '100%',
          overflow: 'hidden', touchAction: 'pan-y',
        }}
        onMouseMove={(e) => pick(e.clientX)}
        onMouseLeave={() => setOver(null)}
        onTouchStart={(e) => { const t = e.touches[0]; if (t) pick(t.clientX); }}
        onTouchMove={(e) => { const t = e.touches[0]; if (t) pick(t.clientX); }}
      >
        {width > 0 && (
          <svg
            width={width} height={H}
            style={{ display: 'block', position: 'absolute', left: 0, top: 0 }}
            role="img"
            aria-label={`Invoiced by month, ${monthLong(points[0]!.month)} to ${monthLong(points[points.length - 1]!.month)}`}
          >
            <Textures scope="monthly" colours={colours} on={textured} />

            {/* ---- the money axis ---- */}
            {ticks.map((v) => (
              <g key={v}>
                <line
                  x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)}
                  stroke="var(--border)" strokeWidth={1} shapeRendering="crispEdges"
                />
                <text
                  x={PAD.left - 8} y={y(v) + 3.5} textAnchor="end"
                  fontSize={10.5} fill="var(--text-subtle)"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >{v === 0 ? '0' : compactMoney(v)}</text>
              </g>
            ))}

            {/* ---- where a financial year began ----

                The label sits ABOVE the plot rather than inside it. In
                the plot it landed on whatever band happened to be tall
                that month, and on a full chart that is always the
                biggest one. It also flips to the left of its own rule
                near the right hand edge, where it would otherwise run
                off the panel. */}
            {boundaries.map((i) => {
              const near = x(i) > width - PAD.right - 72;
              return (
                <g key={`fy-${i}`}>
                  <line
                    x1={x(i)} x2={x(i)} y1={PAD.top} y2={PAD.top + inner.h}
                    stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="3 3"
                    shapeRendering="crispEdges"
                  />
                  <text
                    x={near ? x(i) - 5 : x(i) + 5} y={PAD.top - 5}
                    textAnchor={near ? 'end' : 'start'}
                    fontSize={10} fill="var(--text-subtle)"
                  >{points[i]!.month.slice(0, 4)} year</text>
                </g>
              );
            })}

            {/* ---- stacked areas ---- */}
            {shape === 'stack' && shown.map((s, si) => {
              const lower = edges[si]!;
              const upper = edges[si + 1]!;
              const path = [
                `M ${x(0)} ${y(upper[0]!)}`,
                ...upper.slice(1).map((v, i) => `L ${x(i + 1)} ${y(v)}`),
                ...[...lower].reverse().map((v, i) => `L ${x(points.length - 1 - i)} ${y(v)}`),
                'Z',
              ].join(' ');
              return (
                <g key={s.key}>
                  <path d={path} fill={`url(#${patternId('monthly', s.i)})`} opacity={0.9} />
                  {/* The band's own top edge, solid, so three fills of
                      similar weight still read as three things. */}
                  <path
                    d={[`M ${x(0)} ${y(upper[0]!)}`,
                      ...upper.slice(1).map((v, i) => `L ${x(i + 1)} ${y(v)}`)].join(' ')}
                    fill="none" stroke={s.colour} strokeWidth={1.75}
                    strokeLinejoin="round" strokeLinecap="round"
                  />
                </g>
              );
            })}

            {/* ---- stacked columns ---- */}
            {shape === 'column' && points.map((p, i) => (
              <g key={`col-${p.month}`}>
                {shown.map((s, si) => {
                  const lower = edges[si]![i]!;
                  const upper = edges[si + 1]![i]!;
                  const h = y(lower) - y(upper);
                  if (h <= 0.4) return null;
                  return (
                    <rect
                      key={s.key}
                      x={x(i) - colW / 2} y={y(upper)}
                      width={colW}
                      /* 2px of surface between segments, which is what
                         keeps a stack from reading as one solid block. */
                      height={Math.max(1, h - 2)}
                      rx={2}
                      fill={`url(#${patternId('monthly', s.i)})`}
                      opacity={over == null || over === i ? 1 : 0.55}
                    />
                  );
                })}
              </g>
            ))}

            {/* ---- one line per division ---- */}
            {shape === 'line' && shown.map((s) => {
              const vals = points.map((p) => Math.max(0, p.values[s.i] ?? 0));
              return (
                <g key={s.key}>
                  <path
                    d={vals.map((v, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(v)}`).join(' ')}
                    fill="none" stroke={s.colour} strokeWidth={2}
                    strokeLinejoin="round" strokeLinecap="round"
                    opacity={over == null ? 1 : 0.85}
                  />
                  {/* The last point, marked and named, so a line is
                      identified without going to the key. */}
                  {vals.length > 0 && (
                    <>
                      <circle
                        cx={x(vals.length - 1)} cy={y(vals[vals.length - 1]!)} r={3}
                        fill="var(--surface)" stroke={s.colour} strokeWidth={2}
                      />
                      {over != null && (
                        <circle cx={x(over)} cy={y(vals[over]!)} r={3.5}
                          fill={s.colour} stroke="var(--surface)" strokeWidth={1.5} />
                      )}
                    </>
                  )}
                </g>
              );
            })}

            {/* ---- the same months a year ago ---- */}
            {shape !== 'line' && lastYear.some((v) => v != null) && (
              <path
                d={lastYear.reduce<string[]>((acc, v, i) => (v == null ? acc
                  : [...acc, `${acc.length ? 'L' : 'M'} ${x(i)} ${y(v)}`]), []).join(' ')}
                fill="none" stroke="var(--text-subtle)" strokeWidth={1.25}
                strokeDasharray="4 3" opacity={0.85}
              />
            )}

            {/* ---- a month with nothing in it ---- */}
            {totals.map((v, i) => (v === 0 ? (
              <circle key={`nowt-${i}`} cx={x(i)} cy={y(0)} r={2} fill="var(--chart-empty)" />
            ) : null))}

            {/* ---- the bands, named on themselves ---- */}
            {bandLabels.map((l) => (
              <text
                key={`band-${l.key}`} x={l.x} y={l.y + 3.5} textAnchor="middle"
                fontFamily="var(--panton)" fontWeight={700} fontSize={11}
                fill="var(--surface)"
                stroke="none"
                style={{ paintOrder: 'stroke', pointerEvents: 'none' }}
              >{l.name}</text>
            ))}

            {/* ---- what the pointer is on ---- */}
            {over != null && (
              <g>
                <line
                  x1={x(over)} x2={x(over)} y1={PAD.top} y2={PAD.top + inner.h}
                  stroke="var(--text-subtle)" strokeWidth={1} shapeRendering="crispEdges"
                />
                {shape !== 'line' && (
                  <circle cx={x(over)} cy={y(seenTotal)} r={3.5}
                    fill="var(--surface)" stroke="var(--text)" strokeWidth={1.5} />
                )}
              </g>
            )}

            {/* ---- the months ---- */}
            {points.map((p, i) => (i % labelEvery === 0 ? (
              <text
                key={`m-${p.month}`} x={x(i)} y={H - 8} textAnchor="middle"
                fontSize={10.5}
                fill={over === i ? 'var(--text)' : 'var(--text-subtle)'}
              >{monthShort(p.month)}</text>
            ) : null))}
          </svg>
        )}

        {/* The readout, on the side the pointer is NOT on, so it never
            covers the month being read. */}
        {over != null && seen && width > 0 && (
          <div style={{
            position: 'absolute', top: 8,
            left: x(over) > width / 2 ? undefined : Math.min(width - 190, x(over) + 14),
            right: x(over) > width / 2 ? Math.min(width - 190, width - x(over) + 14) : undefined,
            width: 178, pointerEvents: 'none',
            background: 'var(--surface)', border: '1px solid var(--border-strong)',
            borderRadius: 'var(--r-md)', padding: '9px 11px',
            boxShadow: 'var(--shadow-3)', zIndex: 2,
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{monthLong(seen.month)}</div>
            <div style={{
              fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 17, marginTop: 2,
              fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
            }}>{money(seenTotal)}</div>
            {shape !== 'line' && seenBefore != null && (
              <div style={{ fontSize: 11.5, marginTop: 3, color: 'var(--text-muted)' }}>
                {seenBefore === 0 ? 'nothing a year before' : (
                  <>
                    {seenTotal >= seenBefore ? 'up ' : 'down '}
                    {compactMoney(Math.abs(seenTotal - seenBefore))} on {monthShort(seen.month)} last year
                  </>
                )}
              </div>
            )}
            <div style={{
              marginTop: 7, paddingTop: 7, borderTop: '1px solid var(--border)',
              display: 'flex', flexDirection: 'column', gap: 3,
            }}>
              {shown.map((s) => (
                <div key={s.key} style={{
                  display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
                }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: 2, background: s.colour, flexShrink: 0,
                  }} />
                  <span style={{ flex: 1, color: 'var(--text-muted)' }}>{s.name}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>
                    {compactMoney(Math.max(0, seen.values[s.i] ?? 0))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The small chart inside a tile.
 *
 * One series, no axis, no labels. It answers "what shape has this year
 * been" at a glance and nothing else, because the figure above it
 * carries everything a label would have said.
 */
export function Sparkline({ points, colour, height = 34 }: {
  points: number[]; colour: string; height?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const seen = new ResizeObserver(([e]) => setWidth(Math.round(e?.contentRect.width ?? 0)));
    seen.observe(el);
    setWidth(Math.round(el.getBoundingClientRect().width));
    return () => seen.disconnect();
  }, []);

  const max = Math.max(1, ...points.map((v) => Math.abs(v)));
  const x = (i: number) => (points.length <= 1 ? width / 2 : (i * width) / (points.length - 1));
  const y = (v: number) => height - 3 - (Math.max(0, v) / max) * (height - 6);

  return (
    <div ref={box} style={{ width: '100%', height }}>
      {width > 0 && points.length > 0 && (
        <svg width={width} height={height} style={{ display: 'block' }} aria-hidden>
          <path
            d={[
              `M ${x(0)} ${height}`,
              ...points.map((v, i) => `L ${x(i)} ${y(v)}`),
              `L ${x(points.length - 1)} ${height}`, 'Z',
            ].join(' ')}
            fill={colour} opacity={0.2}
          />
          <path
            d={points.map((v, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(v)}`).join(' ')}
            fill="none" stroke={colour} strokeWidth={2}
            strokeLinejoin="round" strokeLinecap="round"
          />
          {/* Where a series ends is the only point on a sparkline
              anybody looks for, so it is the only one marked. */}
          <circle cx={x(points.length - 1)} cy={y(points[points.length - 1]!)} r={2.5}
            fill={colour} />
        </svg>
      )}
    </div>
  );
}
