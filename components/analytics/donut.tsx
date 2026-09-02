'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { compactMoney, money } from '@/components/kit/primitives';
import { Textures, patternId } from './texture';

/* =============================================================
   The split, and the way into a division.

   ---- What this replaces ----

   A 26 pixel bar across the top of the page, divided into three, with
   the division name written inside its own segment where it happened to
   fit. It answered "which is biggest" and nothing else: the segments
   carried no value, the small one carried no label at all because there
   was no room, and there was nothing to press.

   ---- Why a ring and not a bar ----

   Because the middle of a ring is the one place on a chart where a
   total can sit without competing with anything. The company's number
   and the mix that makes it up become one object rather than a headline
   and a legend eighteen pixels apart.

   And because the segments are big enough to aim at. This is the drill
   in: pressing a segment scopes the whole page to that division, which
   is what turns a picture into a control.

   ---- Leader lines, and why they are worth the arithmetic ----

   A value written inside a segment fits until it does not, and the
   segment it stops fitting in is always the small one, which is the one
   somebody is squinting at. Leading the label out to the side means
   every division is labelled at the same size in the same place
   whatever its share, and the labels are then stacked to keep them off
   each other.
   ============================================================= */

export type Slice = {
  key: string;
  name: string;
  value: number;
  colour: string;
};

const TAU = Math.PI * 2;

/** Where the arc for one slice starts and ends, clockwise from twelve. */
function arcs(values: number[]) {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  let at = -Math.PI / 2;
  return values.map((v) => {
    const span = total > 0 ? (Math.max(0, v) / total) * TAU : 0;
    const seg = { from: at, to: at + span, mid: at + span / 2, share: total > 0 ? Math.max(0, v) / total : 0 };
    at += span;
    return seg;
  });
}

function ring(cx: number, cy: number, rOuter: number, rInner: number, from: number, to: number) {
  /* A full circle cannot be drawn as one arc: the start and end points
     are the same and the path collapses. One slice at a hundred percent
     is the ordinary case for a company with one division trading. */
  if (to - from >= TAU - 0.0001) {
    return `M ${cx} ${cy - rOuter} A ${rOuter} ${rOuter} 0 1 1 ${cx - 0.01} ${cy - rOuter} Z`
      + ` M ${cx} ${cy - rInner} A ${rInner} ${rInner} 0 1 0 ${cx - 0.01} ${cy - rInner} Z`;
  }
  const big = to - from > Math.PI ? 1 : 0;
  const p = (r: number, a: number) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
  return [
    `M ${p(rOuter, from)}`,
    `A ${rOuter} ${rOuter} 0 ${big} 1 ${p(rOuter, to)}`,
    `L ${p(rInner, to)}`,
    `A ${rInner} ${rInner} 0 ${big} 0 ${p(rInner, from)}`,
    'Z',
  ].join(' ');
}

export function Donut({
  slices, total, caption, active, onPick, textured = true, height = 236,
}: {
  slices: Slice[];
  /** The number in the middle. Passed rather than summed: the page's
      total and this total have to be the same figure by construction. */
  total: number;
  caption: string;
  /** The division the page is scoped to, drawn as the selected segment. */
  active?: string | null;
  onPick?: (key: string | null) => void;
  textured?: boolean;
  height?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [tall, setTall] = useState(0);
  const [over, setOver] = useState<string | null>(null);

  /* Both dimensions, for the reason `monthly.tsx` gives: the panel's
     height is decided by whatever else is on its grid row, and a ring
     drawn at a fixed height inside a taller panel floats above a band
     of nothing. */
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const seen = new ResizeObserver(([e]) => {
      setWidth(Math.round(e?.contentRect.width ?? 0));
      setTall(Math.round(e?.contentRect.height ?? 0));
    });
    seen.observe(el);
    const r = el.getBoundingClientRect();
    setWidth(Math.round(r.width));
    setTall(Math.round(r.height));
    return () => seen.disconnect();
  }, []);

  /** Drawn at whatever the panel gives it, never under `height`. */
  const H = Math.max(height, tall);

  const segs = useMemo(() => arcs(slices.map((s) => s.value)), [slices]);

  /* The label column takes a fixed bite out of each side, so the ring
     is whatever is left. Below the width where two label columns and a
     usable ring do not fit, the labels go under the chart instead. */
  const roomy = width >= 356;
  const gutter = roomy ? 112 : 0;
  const cx = width / 2;
  const cy = H / 2;
  const rOuter = Math.max(38, Math.min((H - 26) / 2, (width - gutter * 2 - 22) / 2));
  const rInner = rOuter * 0.64;

  /* Labels, stacked so they cannot sit on each other. Each wants to be
     level with its own slice; where two want the same line the lower
     one is pushed down, then the whole column is nudged back inside the
     box. */
  const labels = useMemo(() => {
    if (!roomy || !width) return [];
    const want = slices.map((s, i) => {
      const seg = segs[i]!;
      const right = Math.cos(seg.mid) >= 0;
      return {
        i,
        key: s.key,
        right,
        y: cy + (rOuter + 16) * Math.sin(seg.mid),
        anchor: {
          x: cx + (rOuter + 6) * Math.cos(seg.mid),
          y: cy + (rOuter + 6) * Math.sin(seg.mid),
        },
      };
    });
    const MIN = 40;
    for (const side of [true, false]) {
      const mine = want.filter((l) => l.right === side).sort((a, b) => a.y - b.y);
      for (let k = 1; k < mine.length; k += 1) {
        const prev = mine[k - 1]!;
        const cur = mine[k]!;
        if (cur.y - prev.y < MIN) cur.y = prev.y + MIN;
      }
      const last = mine[mine.length - 1];
      if (last && last.y > H - 16) {
        const shift = last.y - (H - 16);
        for (const l of mine) l.y -= shift;
      }
      const first = mine[0];
      if (first && first.y < 16) {
        const shift = 16 - first.y;
        for (const l of mine) l.y += shift;
      }
    }
    return want;
  }, [slices, segs, roomy, width, cx, cy, rOuter, H]);

  const lifted = over ?? active ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
      {/* THE BOX IS SIZED BY THE FLEX ROW, NEVER BY ITS OWN CONTENT.

          `overflow: hidden` with the drawing taken out of flow is what
          stops a loop that is easy to write and obvious once seen: the
          svg is drawn at the measured height, an in flow svg makes the
          box at least that tall, the observer reports the new height,
          and the chart grows again. It settles somewhere around three
          times the intended size, which is exactly what it did. */}
      <div ref={box} style={{
        position: 'relative', width: '100%', flex: '1 1 0', minHeight: height,
        overflow: 'hidden',
      }}>
        {width > 0 && (
          <svg width={width} height={H}
            style={{ display: 'block', position: 'absolute', left: 0, top: 0 }}
            role="img" aria-label={`${caption}. ${slices.map((s, i) =>
              `${s.name} ${money(s.value)}, ${Math.round(segs[i]!.share * 100)} percent`).join('. ')}`}>
            <Textures scope="donut" colours={slices.map((s) => s.colour)} on={textured} />

            {slices.map((s, i) => {
              const seg = segs[i]!;
              if (seg.to - seg.from < 0.0005) return null;
              const on = lifted === s.key;
              const dim = lifted != null && !on;
              /* Lifted out by two pixels rather than scaled, so the ring
                 keeps one outer edge and the eye is not asked to compare
                 two radii. */
              const push = on ? 3 : 0;
              const ox = push * Math.cos(seg.mid);
              const oy = push * Math.sin(seg.mid);
              return (
                <g
                  key={s.key}
                  transform={`translate(${ox} ${oy})`}
                  onMouseEnter={() => setOver(s.key)}
                  onMouseLeave={() => setOver((o) => (o === s.key ? null : o))}
                  onClick={() => onPick?.(active === s.key ? null : s.key)}
                  style={{ cursor: onPick ? 'pointer' : 'default' }}
                >
                  <path
                    d={ring(cx, cy, rOuter, rInner, seg.from, seg.to)}
                    fill={`url(#${patternId('donut', i)})`}
                    opacity={dim ? 0.42 : 1}
                  />
                  {/* The 2px gap between neighbouring fills the kit asks
                      for, painted in the surface rather than left as a
                      hairline of whatever is behind. */}
                  <path
                    d={ring(cx, cy, rOuter, rInner, seg.from, seg.to)}
                    fill="none" stroke="var(--surface)" strokeWidth={2}
                  />
                  {on && (
                    <path
                      d={ring(cx, cy, rOuter + 1, rInner - 1, seg.from, seg.to)}
                      fill="none" stroke={s.colour} strokeWidth={1.5} opacity={0.9}
                    />
                  )}
                </g>
              );
            })}

            {/* ---- the leaders ---- */}
            {labels.map((l) => {
              const s = slices[l.i]!;
              const seg = segs[l.i]!;
              if (seg.share < 0.001) return null;
              const endX = l.right ? width - gutter + 6 : gutter - 6;
              const kneeX = l.right ? endX - 16 : endX + 16;
              const on = lifted === s.key;
              return (
                <g key={`lead-${s.key}`} opacity={lifted != null && !on ? 0.45 : 1}>
                  <path
                    d={`M ${l.anchor.x} ${l.anchor.y} L ${kneeX} ${l.y} L ${endX} ${l.y}`}
                    fill="none" stroke="var(--border-strong)" strokeWidth={1}
                  />
                  <circle cx={l.anchor.x} cy={l.anchor.y} r={1.75} fill={s.colour} />
                </g>
              );
            })}

            {/* ---- the total, in the hole ---- */}
            <text
              x={cx} y={cy - 2} textAnchor="middle"
              fontFamily="var(--panton)" fontWeight={800} fontSize={rOuter > 68 ? 21 : 17}
              fill="var(--text)" style={{ fontVariantNumeric: 'tabular-nums' }}
            >{compactMoney(total)}</text>
            <text
              x={cx} y={cy + 14} textAnchor="middle"
              fontSize={10.5} fill="var(--text-subtle)"
            >{caption}</text>
          </svg>
        )}

        {/* The label text as HTML rather than SVG, so a long haulier name
            can be trimmed with an ellipsis and stay on one line. */}
        {labels.map((l) => {
          const s = slices[l.i]!;
          const seg = segs[l.i]!;
          if (seg.share < 0.001) return null;
          const on = lifted === s.key;
          return (
            <button
              key={`lab-${s.key}`}
              type="button"
              onMouseEnter={() => setOver(s.key)}
              onMouseLeave={() => setOver((o) => (o === s.key ? null : o))}
              onClick={() => onPick?.(active === s.key ? null : s.key)}
              style={{
                position: 'absolute', top: l.y - 17, width: gutter - 4,
                left: l.right ? width - gutter + 10 : 0,
                textAlign: l.right ? 'left' : 'right',
                background: 'transparent', border: 0, padding: 0,
                cursor: onPick ? 'pointer' : 'default',
                opacity: lifted != null && !on ? 0.5 : 1,
              }}
            >
              <span style={{
                display: 'block', fontSize: 11.5, color: 'var(--text-muted)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{s.name}</span>
              <span style={{
                display: 'block', marginTop: 1,
                fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 13,
                fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
              }}>
                {compactMoney(s.value)}
                <span style={{
                  color: 'var(--text-subtle)', fontWeight: 500, fontSize: 11.5,
                }}>{' '}{(seg.share * 100).toFixed(1)}%</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Narrow enough that leaders would cross the ring. The same
          figures, stacked under it. */}
      {!roomy && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 10 }}>
          {slices.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => onPick?.(active === s.key ? null : s.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                background: 'transparent', border: 0, padding: 0,
                cursor: onPick ? 'pointer' : 'default', fontSize: 12.5,
                color: 'var(--text-muted)', textAlign: 'left',
              }}
            >
              <span style={{
                width: 9, height: 9, borderRadius: 2, background: s.colour, flexShrink: 0,
              }} />
              <span style={{
                flex: 1, minWidth: 0, overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{s.name}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>
                {compactMoney(s.value)}
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 42, textAlign: 'right' }}>
                {(segs[i]!.share * 100).toFixed(1)}%
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
