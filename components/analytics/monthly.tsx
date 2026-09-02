'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Label, compactMoney, money } from '@/components/kit/primitives';

/* =============================================================
   The company, month by month.

   From the business:

     The huge month by month bar chart still doesn't work, a huge
     horizontal bar chart on desktop never looks good. It needs to be a
     proper ... setup with bespoke lines, labels, interactivity - not a
     chart template from a library. analytic page data capture points
     like this have to be extremely bespoke.

   ---- Why the old one could not be made to look right ----

   It was drawn into `viewBox="0 0 100 190"` with
   `preserveAspectRatio="none"`, stretched across whatever width the
   card was. That is not a chart, it is a picture of a chart being
   pulled sideways. At 1200px wide every unit of the viewBox became
   twelve, so a bar meant to be a thin column became a slab, a 0.35
   stroke became four pixels in one direction and one in the other, and
   nothing could carry a label at all because text would have stretched
   with it. Twenty four of those is the wall of colour that was
   reported.

   So this measures the element and draws in real pixels. One unit is
   one pixel, strokes are the width they say they are, and text is the
   size it says it is.

   ---- Stacked, not three lines ----

   Maintenance bills roughly six times what trailer sales does. Three
   lines on one axis means two of them are a flat scribble along the
   bottom and the question "how is rental doing" cannot be read off it
   at all.

   Stacked, the top edge is the company and each band is a division, so
   the size and the mix are one shape. It also makes the honest
   comparison the easy one: the question in a board meeting is never
   "is rental bigger than maintenance", it is "is the company ahead of
   last year and which part moved".

   ---- What it draws that a default chart does not ----

   THE YEAR BOUNDARY. The company's year runs April to April, so a two
   year chart contains one rule that matters more than any gridline on
   it, and it is named.

   LAST YEAR, UNDER THIS YEAR. A faint line twelve months behind the
   total, so "ahead or behind" is a shape rather than a sum somebody
   does in their head.

   A MONTH WITH NOTHING IN IT. Drawn at nought and marked, rather than
   skipped. A line that runs across an empty month reads as steady
   trading through a month where nothing was invoiced.
   ============================================================= */

export type MonthPoint = {
  month: string;
  /** One number per series, in the order the series are declared. */
  values: number[];
};

export type Series = { key: string; name: string; colour: string };

const PAD = { top: 14, right: 14, bottom: 26, left: 58 };

/** Three or four gridlines at round numbers, never at 3.7 million. */
function niceTicks(max: number, want = 4): number[] {
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
  points, series, yearStart, height = 260,
}: {
  points: MonthPoint[];
  series: Series[];
  /** The month a financial year begins, 1 to 12. Marked and named. */
  yearStart?: number;
  height?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [over, setOver] = useState<number | null>(null);

  /* Measured rather than assumed, because everything below is in
     pixels and a chart drawn at the wrong width is the bug this
     replaces. `ResizeObserver` rather than a window listener: the card
     changes width when a sibling column wraps, and the window does
     not. */
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const seen = new ResizeObserver(([entry]) => {
      setWidth(Math.max(0, Math.round(entry?.contentRect.width ?? 0)));
    });
    seen.observe(el);
    setWidth(Math.max(0, Math.round(el.getBoundingClientRect().width)));
    return () => seen.disconnect();
  }, []);

  const totals = useMemo(
    () => points.map((p) => p.values.reduce((s, n) => s + Math.max(0, n), 0)),
    [points],
  );

  const max = useMemo(() => Math.max(1, ...totals), [totals]);
  const ticks = useMemo(() => niceTicks(max), [max]);
  const top = ticks[ticks.length - 1] ?? max;

  const inner = {
    w: Math.max(0, width - PAD.left - PAD.right),
    h: Math.max(0, height - PAD.top - PAD.bottom),
  };

  const x = useCallback((i: number) => (points.length <= 1
    ? PAD.left + inner.w / 2
    : PAD.left + (i * inner.w) / (points.length - 1)), [points.length, inner.w]);
  const y = useCallback((v: number) => PAD.top + inner.h - (v / top) * inner.h,
    [inner.h, top]);

  /* The stack, bottom up: each band's upper edge is everything below it
     plus itself. Computed once rather than per path, so the bands share
     an edge exactly and no hairline of card shows between them. */
  const edges = useMemo(() => {
    const out: number[][] = [];
    let running = points.map(() => 0);
    out.push([...running]);
    for (let s = 0; s < series.length; s += 1) {
      running = running.map((acc, i) => acc + Math.max(0, points[i]?.values[s] ?? 0));
      out.push([...running]);
    }
    return out;
  }, [points, series.length]);

  /* Last year's total, twelve months back, for the faint line. Null
     where there is no month twelve back to compare with, so the line
     starts where the comparison starts rather than at nought. */
  const lastYear = useMemo(
    () => totals.map((_, i) => (i >= 12 ? totals[i - 12]! : null)),
    [totals],
  );

  const boundaries = useMemo(() => (yearStart
    ? points.map((p, i) => ((Number(p.month.slice(5, 7)) === yearStart && i > 0) ? i : -1))
      .filter((i) => i >= 0)
    : []), [points, yearStart]);

  /* Every other month where they would collide, all of them where they
     would not. Measured against the actual width rather than a
     guess. */
  const labelEvery = Math.max(1, Math.ceil((points.length * 30) / Math.max(1, inner.w)));

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

  return (
    <div>
      <div
        ref={box}
        style={{ position: 'relative', height, width: '100%', touchAction: 'pan-y' }}
        onMouseMove={(e) => pick(e.clientX)}
        onMouseLeave={() => setOver(null)}
        onTouchStart={(e) => { const t = e.touches[0]; if (t) pick(t.clientX); }}
        onTouchMove={(e) => { const t = e.touches[0]; if (t) pick(t.clientX); }}
      >
        {width > 0 && (
          <svg
            width={width} height={height} style={{ display: 'block' }}
            role="img"
            aria-label={`Invoiced by month, ${monthLong(points[0]!.month)} to ${monthLong(points[points.length - 1]!.month)}`}
          >
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

            {/* ---- where a financial year began ---- */}
            {boundaries.map((i) => (
              <g key={`fy-${i}`}>
                <line
                  x1={x(i)} x2={x(i)} y1={PAD.top - 4} y2={PAD.top + inner.h}
                  stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="3 3"
                  shapeRendering="crispEdges"
                />
                <text
                  x={x(i) + 4} y={PAD.top + 4}
                  fontSize={10} fill="var(--text-subtle)"
                >{points[i]!.month.slice(0, 4)} year</text>
              </g>
            ))}

            {/* ---- the bands ---- */}
            {series.map((s, si) => {
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
                  <path d={path} fill={s.colour} opacity={0.82} />
                  {/* The band's own top edge, drawn solid, so three
                      translucent fills still read as three things. */}
                  <path
                    d={[`M ${x(0)} ${y(upper[0]!)}`,
                      ...upper.slice(1).map((v, i) => `L ${x(i + 1)} ${y(v)}`)].join(' ')}
                    fill="none" stroke={s.colour} strokeWidth={1.5}
                    strokeLinejoin="round" strokeLinecap="round"
                  />
                </g>
              );
            })}

            {/* ---- the same months a year ago ---- */}
            {lastYear.some((v) => v != null) && (
              <path
                d={lastYear.reduce<string[]>((acc, v, i) => {
                  if (v == null) return acc;
                  return [...acc, `${acc.length ? 'L' : 'M'} ${x(i)} ${y(v)}`];
                }, []).join(' ')}
                fill="none" stroke="var(--text-subtle)" strokeWidth={1.25}
                strokeDasharray="4 3" opacity={0.8}
              />
            )}

            {/* ---- a month with nothing in it ---- */}
            {totals.map((v, i) => (v === 0 ? (
              <circle key={`nowt-${i}`} cx={x(i)} cy={y(0)} r={2}
                fill="var(--chart-empty)" />
            ) : null))}

            {/* ---- what the pointer is on ---- */}
            {over != null && (
              <g>
                <line
                  x1={x(over)} x2={x(over)} y1={PAD.top} y2={PAD.top + inner.h}
                  stroke="var(--text-subtle)" strokeWidth={1} shapeRendering="crispEdges"
                />
                <circle cx={x(over)} cy={y(seenTotal)} r={3.5}
                  fill="var(--surface)" stroke="var(--text)" strokeWidth={1.5} />
              </g>
            )}

            {/* ---- the months ---- */}
            {points.map((p, i) => (i % labelEvery === 0 ? (
              <text
                key={`m-${p.month}`} x={x(i)} y={height - 8} textAnchor="middle"
                fontSize={10.5}
                fill={over === i ? 'var(--text)' : 'var(--text-subtle)'}
              >{monthShort(p.month)}</text>
            ) : null))}
          </svg>
        )}

        {/* The readout. Positioned to the side the pointer is NOT on, so
            it never covers the month being read. */}
        {over != null && seen && width > 0 && (
          <div style={{
            position: 'absolute', top: 8,
            left: x(over) > width / 2 ? undefined : Math.min(width - 190, x(over) + 14),
            right: x(over) > width / 2 ? Math.min(width - 190, width - x(over) + 14) : undefined,
            width: 176, pointerEvents: 'none',
            background: 'var(--surface)', border: '1px solid var(--border-strong)',
            borderRadius: 'var(--r-md)', padding: '9px 11px',
            boxShadow: 'var(--shadow-3)', zIndex: 2,
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{monthLong(seen.month)}</div>
            <div style={{
              fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 17, marginTop: 2,
              fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
            }}>{money(seenTotal)}</div>
            {seenBefore != null && (
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
              {series.map((s, si) => (
                <div key={s.key} style={{
                  display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
                }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: 2, background: s.colour, flexShrink: 0,
                  }} />
                  <span style={{ flex: 1, color: 'var(--text-muted)' }}>{s.name}</span>
                  <span style={{
                    fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
                  }}>{compactMoney(Math.max(0, seen.values[si] ?? 0))}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* The key, and what the dashed line is. Under the chart rather
          than floating on it, because a legend inside the plot covers
          the data at exactly the width where the data is busiest. */}
      <div style={{
        display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10,
        fontSize: 12, color: 'var(--text-muted)', alignItems: 'center',
      }}>
        {series.map((s) => (
          <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: s.colour }} />
            {s.name}
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <svg width={18} height={9} aria-hidden>
            <line x1={0} y1={4.5} x2={18} y2={4.5} stroke="var(--text-subtle)"
              strokeWidth={1.25} strokeDasharray="4 3" />
          </svg>
          The same months a year earlier
        </span>
        <span style={{ marginLeft: 'auto', color: 'var(--text-subtle)', fontSize: 11.5 }}>
          Hover for the month
        </span>
      </div>
    </div>
  );
}

/**
 * The small chart inside a division column.
 *
 * One series, no axis, no labels. It answers "what shape has this year
 * been" at a glance and nothing else, because the column beneath it
 * carries every figure it could otherwise have annotated.
 */
export function Sparkline({ points, colour, height = 46 }: {
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
            fill={colour} opacity={0.14}
          />
          <path
            d={points.map((v, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(v)}`).join(' ')}
            fill="none" stroke={colour} strokeWidth={1.5}
            strokeLinejoin="round" strokeLinecap="round"
          />
          {/* The month it ends on, marked. Where a series ends is the
              only point on a sparkline anybody looks for. */}
          {points.length > 0 && (
            <circle cx={x(points.length - 1)} cy={y(points[points.length - 1]!)} r={2.5}
              fill={colour} />
          )}
        </svg>
      )}
    </div>
  );
}

export { niceTicks };
export const CHART_LABEL = Label;
