'use client';

import { useState, type ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { compactMoney } from '@/components/kit/primitives';

/* =============================================================
   Ranked bars, and bars that go both ways.

   ---- What these replace ----

   Three separate hand rolled row lists, one per block, each with its
   own idea of how wide a label column is and where the number goes.
   Side by side in three cards of different widths, the same figure sat
   at three different distances from the left, which is most of what
   "text formatting not great to understand" was describing.

   One component, one geometry: name, bar, number, always in that order
   and always aligned, whatever panel it is drawn in.

   ---- What a bar has to do beyond being the right length ----

   Be worth pressing. Every row here that stands for a record carries
   the way through to it, because the question after "who is our biggest
   customer" is always "show me them", and a page that answers the first
   and not the second sends somebody to the CRM to search a name they
   are already looking at.
   ============================================================= */

export type BarRow = {
  key: string;
  name: string;
  value: number;
  /** Drawn after the value, small. A count, a share, a caveat. */
  note?: string;
  /** Where pressing the row goes. Absent rows are not pressable. */
  href?: string;
  /** Overrides the series colour for this row alone. Ageing uses it. */
  colour?: string;
};

const NAME_W = 140;
const VALUE_W = 68;

/**
 * Horizontal bars, longest first, against the largest in the set.
 *
 * Scaled to the biggest row rather than to a total: the question is
 * "who is the big one and by how much", and against a total every row
 * in a long tail is a stub of the same length.
 */
export function RankedBars({ rows, colour, max, format = compactMoney, empty, onOpen }: {
  rows: BarRow[];
  colour: string;
  /** Given where several panels have to share one scale. */
  max?: number;
  format?: (n: number) => string;
  empty: string;
  onOpen?: (row: BarRow) => void;
}) {
  const [over, setOver] = useState<string | null>(null);

  if (!rows.length) {
    return <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>{empty}</span>;
  }

  const top = max ?? Math.max(1, ...rows.map((r) => Math.abs(r.value)));

  return (
    /* The rows SPREAD to fill the panel rather than stacking at the top
       of it. Panels on a row are the same height by construction, so a
       four row chart beside an eight row one would otherwise sit above a
       block of nothing, which reads as a panel that failed to load. */
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 2,
      flex: 1, minHeight: 0, justifyContent: 'space-evenly',
    }}>
      {rows.map((r) => {
        const pressable = !!(r.href || onOpen);
        const on = over === r.key;
        return (
          <div
            key={r.key}
            role={pressable ? 'button' : undefined}
            tabIndex={pressable ? 0 : undefined}
            onMouseEnter={() => setOver(r.key)}
            onMouseLeave={() => setOver((o) => (o === r.key ? null : o))}
            onFocus={() => setOver(r.key)}
            onBlur={() => setOver((o) => (o === r.key ? null : o))}
            onClick={() => { if (pressable) go(r, onOpen); }}
            onKeyDown={(e) => {
              if (pressable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(r, onOpen); }
            }}
            title={`${r.name}: ${format(r.value)}${r.note ? `, ${r.note}` : ''}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              /* 28px rows rather than the kit's 36: this is a chart made
                 of rows, not a table of them, and eight of these have to
                 sit inside a panel beside a chart of the same height. */
              minHeight: 28, padding: '0 6px', margin: '0 -6px',
              borderRadius: 'var(--r)', cursor: pressable ? 'pointer' : 'default',
              background: on ? 'var(--bg-subtle)' : 'transparent',
            }}
          >
            <span style={{
              width: NAME_W, flex: 'none', fontSize: 12.5, color: 'var(--text)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{r.name}</span>

            <span style={{
              flex: 1, minWidth: 24, height: 10, position: 'relative',
              background: 'var(--surface-sunken)', borderRadius: 'var(--r-sm)',
            }}>
              <span style={{
                position: 'absolute', inset: '0 auto 0 0',
                width: `${Math.max(1.5, (Math.abs(r.value) / top) * 100)}%`,
                background: r.colour ?? colour,
                /* Rounded at the data end only, so the bar is anchored
                   to its baseline rather than floating. */
                borderRadius: '2px 4px 4px 2px',
                opacity: over && !on ? 0.5 : 1,
                transition: 'opacity var(--dur-fast) var(--ease)',
              }} />
            </span>

            <span style={{
              width: VALUE_W, flex: 'none', textAlign: 'right', fontSize: 12.5,
              fontFamily: 'var(--panton)', fontWeight: 700,
              fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
            }}>{format(r.value)}</span>

            {r.note && (
              <span style={{
                width: 74, flex: 'none', textAlign: 'right', fontSize: 11,
                color: 'var(--text-subtle)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{r.note}</span>
            )}

            <span style={{ width: 12, flex: 'none', color: 'var(--text-subtle)' }}>
              {pressable && on && <ArrowUpRight size={12} />}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function go(r: BarRow, onOpen?: (row: BarRow) => void) {
  if (onOpen) { onOpen(r); return; }
  if (r.href) window.location.assign(r.href);
}

/**
 * Bars from a centre line, gaining to the right and losing to the left.
 *
 * Two lists headed "Growing" and "Spending less" made somebody compare
 * a number on one side of a card with a number on the other, and gave
 * no sense of whether the gains covered the losses. On one axis, that
 * is the shape of the thing.
 */
export function DivergingBars({ rows, empty, onOpen, caption }: {
  rows: BarRow[];
  empty: string;
  onOpen?: (row: BarRow) => void;
  caption?: ReactNode;
}) {
  const [over, setOver] = useState<string | null>(null);

  if (!rows.length) {
    return <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>{empty}</span>;
  }

  const reach = Math.max(1, ...rows.map((r) => Math.abs(r.value)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 2,
        flex: 1, minHeight: 0, justifyContent: 'space-evenly',
      }}>
        {rows.map((r) => {
          const up = r.value >= 0;
          const pressable = !!(r.href || onOpen);
          const on = over === r.key;
          const share = (Math.abs(r.value) / reach) * 50;
          return (
            <div
              key={r.key}
              role={pressable ? 'button' : undefined}
              tabIndex={pressable ? 0 : undefined}
              onMouseEnter={() => setOver(r.key)}
              onMouseLeave={() => setOver((o) => (o === r.key ? null : o))}
              onFocus={() => setOver(r.key)}
              onBlur={() => setOver((o) => (o === r.key ? null : o))}
              onClick={() => { if (pressable) go(r, onOpen); }}
              onKeyDown={(e) => {
                if (pressable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(r, onOpen); }
              }}
              title={`${r.name}: ${up ? 'up' : 'down'} ${compactMoney(Math.abs(r.value))}${r.note ? ` from ${r.note}` : ''}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, minHeight: 28,
                padding: '0 6px', margin: '0 -6px', borderRadius: 'var(--r)',
                cursor: pressable ? 'pointer' : 'default',
                background: on ? 'var(--bg-subtle)' : 'transparent',
              }}
            >
              <span style={{
                width: NAME_W, flex: 'none', fontSize: 12.5, color: 'var(--text)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{r.name}</span>

              <span style={{ flex: 1, minWidth: 40, height: 12, position: 'relative' }}>
                {/* The nought line, which is the whole reference. */}
                <span style={{
                  position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1,
                  background: 'var(--border-strong)',
                }} />
                <span style={{
                  position: 'absolute', top: 1, bottom: 1,
                  left: up ? '50%' : `${50 - share}%`,
                  width: `${Math.max(0.6, share)}%`,
                  background: up ? 'var(--success)' : 'var(--danger)',
                  borderRadius: up ? '2px 4px 4px 2px' : '4px 2px 2px 4px',
                  opacity: over && !on ? 0.5 : 1,
                  transition: 'opacity var(--dur-fast) var(--ease)',
                }} />
              </span>

              <span style={{
                width: 82, flex: 'none', textAlign: 'right', fontSize: 12.5,
                fontFamily: 'var(--panton)', fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                color: up ? 'var(--success)' : 'var(--danger)',
              }}>
                {up ? '+' : '-'}{compactMoney(Math.abs(r.value))}
              </span>
            </div>
          );
        })}
      </div>
      {caption && (
        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 8, lineHeight: 1.5 }}>
          {caption}
        </div>
      )}
    </div>
  );
}
