'use client';

import { useMemo, useState } from 'react';
import { Label, compactMoney, money } from '@/components/kit/primitives';

/* =============================================================
   Charts drawn for these figures, rather than configured from a library.

   From the business: "more bespoke charts for our actual data and
   usecase".

   ---- Why by hand ----

   Every chart on this screen is one of two shapes: money over months,
   and three divisions against each other. A charting library is worth
   its weight when the shapes are unknown; here they are known, and what
   was costing us was the library's opinions rather than its power. The
   old page could not put a financial year boundary on an axis, could
   not tell a month with no trading from a month with no data, and drew
   its own tooltip in its own typeface.

   ---- The two things these do that a default chart does not ----

   A MONTH WITH NOTHING IN IT IS DRAWN. A line that skips an empty month
   runs straight across it and reads as steady trading through a month
   where nothing was invoiced. Every series arrives with a point for
   every month, including nought, and the bar for nought is drawn as a
   hairline so it is visibly present rather than absent.

   THE YEAR BOUNDARY IS MARKED. The company's year runs April to April,
   so a twenty four month chart contains a boundary that matters more
   than any gridline on it. It is drawn as a rule with the year named,
   because "are we ahead of where we were" is the question the chart is
   being asked.
   ============================================================= */

export type Point = { month: string; value: number };

/**
 * Money over months, as bars.
 *
 * Bars rather than a line because these are monthly totals: each one is
 * a complete thing that happened, not a sample of something continuous,
 * and a line between them implies a journey that did not occur.
 */
export function MonthlyBars({
  points, colour, height = 150, yearStart, label,
}: {
  points: Point[];
  colour: string;
  height?: number;
  /** The month the financial year begins, 1 to 12, marked on the axis. */
  yearStart?: number;
  label?: string;
}) {
  const [over, setOver] = useState<number | null>(null);

  const max = useMemo(
    () => Math.max(1, ...points.map((p) => Math.abs(p.value))),
    [points],
  );

  if (!points.length) return null;

  const gap = 2;
  const w = 100 / points.length;

  return (
    <div>
      {label && <Label>{label}</Label>}
      <div
        style={{ position: 'relative', height, marginTop: label ? 8 : 0 }}
        onMouseLeave={() => setOver(null)}
      >
        <svg
          viewBox={`0 0 100 ${height}`}
          preserveAspectRatio="none"
          style={{ width: '100%', height, display: 'block', overflow: 'visible' }}
          role="img"
          aria-label={label ?? 'Monthly revenue'}
        >
          {points.map((p, i) => {
            const start = yearStart != null
              && Number(p.month.slice(5, 7)) === yearStart
              && i > 0;
            if (!start) return null;
            return (
              <line
                key={`fy-${p.month}`}
                x1={i * w} x2={i * w} y1={0} y2={height}
                stroke="var(--border-strong)"
                strokeWidth={0.35}
                strokeDasharray="2 2"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}

          {points.map((p, i) => {
            /* A month with nothing in it gets a hairline rather than
               nothing at all, so it reads as a month that happened and
               was quiet, not as a month with no data. */
            const h = p.value === 0 ? 1 : Math.max(1, (Math.abs(p.value) / max) * (height - 6));
            return (
              <rect
                key={p.month}
                x={i * w + gap / 2}
                y={height - h}
                width={Math.max(0.5, w - gap)}
                height={h}
                rx={0.6}
                fill={p.value === 0 ? 'var(--border-strong)' : colour}
                opacity={over == null || over === i ? 1 : 0.4}
                onMouseEnter={() => setOver(i)}
                style={{ transition: 'opacity 90ms' }}
              />
            );
          })}
        </svg>

        {over != null && points[over] && (
          <div style={{
            position: 'absolute', top: -4,
            left: `${Math.min(72, (over / points.length) * 100)}%`,
            background: 'var(--surface)', border: '1px solid var(--border-strong)',
            borderRadius: 'var(--r)', padding: '5px 9px', pointerEvents: 'none',
            boxShadow: '0 2px 8px rgb(0 0 0 / 0.10)', whiteSpace: 'nowrap', zIndex: 2,
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
              {monthName(points[over]!.month)}
            </div>
            <div style={{
              fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 14,
              fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
            }}>{money(points[over]!.value)}</div>
          </div>
        )}
      </div>

      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 10.5, color: 'var(--text-subtle)', marginTop: 5,
      }}>
        <span>{monthName(points[0]!.month)}</span>
        <span>{compactMoney(max)} peak</span>
        <span>{monthName(points[points.length - 1]!.month)}</span>
      </div>
    </div>
  );
}

/**
 * Three divisions against each other, as one bar split three ways.
 *
 * A pie would answer "what share" and lose the size. This keeps both:
 * the bar's segments are the share, and the figures above it are the
 * money, so a quarter where everything shrank does not look identical
 * to one where nothing changed.
 */
export function SplitBar({ parts, height = 10 }: {
  parts: { key: string; name: string; value: number; colour: string }[];
  height?: number;
}) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  if (total <= 0) return null;

  return (
    <div>
      <div style={{
        display: 'flex', height, borderRadius: 'var(--r-full)',
        overflow: 'hidden', background: 'var(--surface-sunken)',
      }}>
        {parts.map((p) => (
          <div
            key={p.key}
            title={`${p.name}: ${money(p.value)}`}
            style={{
              width: `${(Math.max(0, p.value) / total) * 100}%`,
              background: p.colour,
            }}
          />
        ))}
      </div>
      <div style={{
        display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 9,
        fontSize: 12, color: 'var(--text-muted)',
      }}>
        {parts.map((p) => (
          <span key={p.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 8, height: 8, borderRadius: 2, background: p.colour, flexShrink: 0,
            }} />
            {p.name}
            <span style={{ color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums' }}>
              {total ? `${Math.round((Math.max(0, p.value) / total) * 100)}%` : '0%'}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * A row in a ranked list, with its share drawn behind the text.
 *
 * The bar is behind rather than beside so the name stays where the eye
 * expects it down a column of them, and the length is read without
 * anything being measured.
 */
export function RankRow({ name, value, of, colour, note, onClick }: {
  name: string;
  value: number;
  of: number;
  colour: string;
  note?: string;
  onClick?: () => void;
}) {
  const share = of > 0 ? Math.max(0, value) / of : 0;
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => { if (onClick && (e.key === 'Enter' || e.key === ' ')) onClick(); }}
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: 10,
        padding: '7px 9px', borderRadius: 'var(--r)', overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default', fontSize: 12.5,
      }}
    >
      <span style={{
        position: 'absolute', inset: 0, width: `${share * 100}%`,
        background: colour, opacity: 0.13, borderRadius: 'var(--r)',
      }} />
      <span style={{
        position: 'relative', flex: 1, minWidth: 0, color: 'var(--text)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{name}</span>
      {note && (
        <span style={{ position: 'relative', fontSize: 11, color: 'var(--text-subtle)' }}>
          {note}
        </span>
      )}
      <span style={{
        position: 'relative', fontFamily: 'var(--panton)', fontWeight: 700,
        fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
      }}>{compactMoney(value)}</span>
    </div>
  );
}

const monthName = (m: string) =>
  new Date(`${m}T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
