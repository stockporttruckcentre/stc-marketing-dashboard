'use client';

import type { ReactNode } from 'react';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { compactMoney } from '@/components/kit/primitives';
import { Sparkline } from './monthly';

/* =============================================================
   The four figures across the top.

   ---- What this replaces ----

   A card holding a 34 pixel number, three more at 16, three labels at
   11, a movement chip and a coloured strip, arranged along a baseline
   they did not share. Eight type sizes in one box. From the business:

     that whole top section looks awful and needs changing

   and then, of the rebuild:

     text formatting not great to understand

   ---- The rule this holds to ----

   A tile is a label, a number, and at most one thing beside the number.
   Every tile on the row is the same shape, so the eye reads across four
   figures rather than parsing four little layouts. Where a tile has a
   history it draws it, small, under the number: the sparkline is the
   only thing on the row allowed to be different, and it is a picture
   rather than more text.
   ============================================================= */

export function Tile({ label, value, tone = 'plain', movement, note, spark, colour, onClick }: {
  label: string;
  value: string;
  tone?: 'plain' | 'warning' | 'danger';
  /** Against the same point last year. Absent where there is nothing to compare. */
  movement?: { from: number; to: number };
  note?: ReactNode;
  spark?: number[];
  colour?: string;
  onClick?: () => void;
}) {
  const ink = tone === 'danger' ? 'var(--danger)'
    : tone === 'warning' ? 'var(--warning)' : 'var(--text)';

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => { if (onClick && (e.key === 'Enter' || e.key === ' ')) onClick(); }}
      style={{
        gridColumn: 'span 3', minWidth: 0,
        display: 'flex', flexDirection: 'column',
        padding: '12px 14px 11px',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)',
        cursor: onClick ? 'pointer' : undefined,
      }}
    >
      <div style={{
        fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
        letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-subtle)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{label}</div>

      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 9, marginTop: 5, flexWrap: 'wrap',
      }}>
        <span style={{
          fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 25, lineHeight: 1.05,
          letterSpacing: '-0.025em', fontVariantNumeric: 'tabular-nums', color: ink,
        }}>{value}</span>
        {movement && <Movement from={movement.from} to={movement.to} />}
      </div>

      {note && (
        <div style={{
          fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{note}</div>
      )}

      {spark && spark.length > 1 && (
        <div style={{ marginTop: 'auto', paddingTop: 8 }}>
          <Sparkline points={spark} colour={colour ?? 'var(--chart-company)'} />
        </div>
      )}
    </div>
  );
}

/**
 * Up, down or level against the same point last year.
 *
 * Red only ever means down. The kit keeps red for the single most
 * important thing on a screen and for destructive intent, and on a
 * board's revenue page a division going backwards is exactly that.
 */
export function Movement({ from, to }: { from: number; to: number }) {
  const diff = to - from;
  const pct = from ? (100 * diff) / from : null;
  const colour = diff > 0 ? 'var(--success)' : diff < 0 ? 'var(--danger)' : 'var(--text-subtle)';
  const Icon = diff > 0 ? TrendingUp : diff < 0 ? TrendingDown : Minus;

  return (
    <span
      title={from === 0
        ? 'Nothing at this point last year'
        : `${compactMoney(from)} at the same point last year`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        color: colour, fontSize: 12, fontVariantNumeric: 'tabular-nums',
        fontFamily: 'var(--panton)', fontWeight: 700,
      }}
    >
      <Icon size={12} style={{ flexShrink: 0 }} />
      {diff === 0 ? 'level'
        : pct != null ? `${Math.abs(pct).toFixed(1)}%`
          : compactMoney(Math.abs(diff))}
    </span>
  );
}
