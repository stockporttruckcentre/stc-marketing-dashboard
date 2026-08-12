/* =============================================================
   STC UI kit primitives.

   Recreated from design-system/reference as React, per CLAUDE.md.
   The reference HTML is a prototype and is never lifted; these are
   built with this codebase's own patterns and semantic tokens only.

   Density is the kit's: 32px controls, 36px rows, 14px base text.
   Radius: 4 default, 6 cards and panels, 8 dialogs.
   Borders carry structure. Elevation is only for things that float.
   ============================================================= */
import type { ReactNode, CSSProperties, ButtonHTMLAttributes } from 'react';

const EASE = 'cubic-bezier(0.2, 0, 0, 1)';

/* ---------- type helpers ---------- */

/** Panton, 11px, uppercase, wide tracking. The kit's label step. */
export function Label({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span style={{
      fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 11, lineHeight: 1,
      letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-subtle)', ...style,
    }}>{children}</span>
  );
}

/** Section heading. Panton 700 at the h3 step. */
export function SectionHead({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
      <h2 style={{
        margin: 0, fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 17,
        lineHeight: 1.3, letterSpacing: '-0.02em', color: 'var(--text)',
      }}>{title}</h2>
      {hint && <span style={{ fontSize: 12.5, color: 'var(--text-subtle)', flex: 1 }}>{hint}</span>}
      {action && <div style={{ marginLeft: 'auto' }}>{action}</div>}
    </div>
  );
}

/* ---------- surfaces ---------- */

export function Card({ children, padded = true, style }: { children: ReactNode; padded?: boolean; style?: CSSProperties }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-md)',
      padding: padded ? 16 : 0,
      ...style,
    }}>{children}</div>
  );
}

/* ---------- controls ---------- */

type Variant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, CSSProperties> = {
  primary:   { background: 'var(--primary)', color: 'var(--primary-fg)', border: '1px solid var(--primary)' },
  accent:    { background: 'var(--accent)',  color: 'var(--accent-fg)',  border: '1px solid var(--accent)' },
  secondary: { background: 'var(--surface)', color: 'var(--text)',       border: '1px solid var(--border-strong)' },
  ghost:     { background: 'transparent',    color: 'var(--text-muted)', border: '1px solid transparent' },
  danger:    { background: 'var(--danger)',  color: '#FFFFFF',           border: '1px solid var(--danger)' },
};

export function Button({
  variant = 'secondary', size = 'md', children, style, ...rest
}: { variant?: Variant; size?: 'sm' | 'md' } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        height: size === 'sm' ? 28 : 32,
        padding: size === 'sm' ? '0 10px' : '0 14px',
        borderRadius: 'var(--r)',
        fontFamily: 'var(--inter)',
        fontSize: size === 'sm' ? 12.5 : 13,
        fontWeight: 600,
        cursor: rest.disabled ? 'not-allowed' : 'pointer',
        opacity: rest.disabled ? 0.5 : 1,
        whiteSpace: 'nowrap',
        transition: `background 120ms ${EASE}, border-color 120ms ${EASE}`,
        ...VARIANTS[variant],
        ...style,
      }}
    >{children}</button>
  );
}

/* ---------- status vocabulary ---------- */

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';
const TONE_FG: Record<Tone, string> = {
  neutral: 'var(--text-muted)', info: 'var(--info)', success: 'var(--success)',
  warning: 'var(--warning)', danger: 'var(--danger)', accent: 'var(--accent)',
};
/** Tints are derived per theme in kit-tokens; these stay low-alpha so they read on both grounds. */
const TONE_BG: Record<Tone, string> = {
  neutral: 'color-mix(in srgb, var(--text-muted) 10%, transparent)',
  info:    'color-mix(in srgb, var(--info) 12%, transparent)',
  success: 'color-mix(in srgb, var(--success) 14%, transparent)',
  warning: 'color-mix(in srgb, var(--warning) 16%, transparent)',
  danger:  'color-mix(in srgb, var(--danger) 14%, transparent)',
  accent:  'color-mix(in srgb, var(--accent) 12%, transparent)',
};

export function Badge({ tone = 'neutral', dot, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      height: 20, padding: '0 7px', borderRadius: 'var(--r)',
      fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap',
      color: TONE_FG[tone], background: TONE_BG[tone],
    }}>
      {dot && <span style={{ width: 5, height: 5, borderRadius: 'var(--r-full)', background: 'currentColor' }} />}
      {children}
    </span>
  );
}

/* ---------- metrics ---------- */

/**
 * KPI card. Numbers are Panton and tabular so columns of them line up.
 * `emphasis` is the kit's "red points" rule: at most one per screen.
 */
export function Kpi({
  label, value, sub, emphasis, tone,
}: { label: string; value: string; sub?: string; emphasis?: boolean; tone?: Tone }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderLeft: `2px solid ${emphasis ? 'var(--accent)' : 'var(--border-emphasis)'}`,
      borderRadius: 'var(--r-md)',
      padding: '13px 15px',
      display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0,
    }}>
      <Label>{label}</Label>
      <span style={{
        fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 26, lineHeight: 1.05,
        letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums',
        color: tone ? TONE_FG[tone] : 'var(--text)',
      }}>{value}</span>
      {sub && <span style={{ fontSize: 12, color: 'var(--text-subtle)', lineHeight: 1.4 }}>{sub}</span>}
    </div>
  );
}

/* ---------- empty and loading ---------- */

/**
 * The kit's rule: say what the thing is, why it is empty, and the one
 * action that fills it. Never just "No results".
 */
export function EmptyState({
  what, why, action,
}: { what: string; why: string; action?: ReactNode }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 7,
      padding: '20px 16px',
      background: 'var(--surface-sunken)',
      border: '1px dashed var(--border-strong)',
      borderRadius: 'var(--r)',
    }}>
      <span style={{ fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 13.5, color: 'var(--text)' }}>{what}</span>
      <span style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5, maxWidth: '62ch' }}>{why}</span>
      {action && <div style={{ marginTop: 3 }}>{action}</div>}
    </div>
  );
}

/**
 * Shown when a widget's table has not been created yet. Distinct from an
 * empty state: the feature is not wired, rather than having no rows.
 */
export function NotProvisioned({ what, needs }: { what: string; needs: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 6,
      padding: '14px 15px',
      background: 'var(--surface-sunken)',
      border: '1px solid var(--border)',
      borderLeft: '2px solid var(--warning)',
      borderRadius: 'var(--r)',
    }}>
      <Label style={{ color: 'var(--warning)' }}>Not wired up yet</Label>
      <span style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        {what} <span style={{ color: 'var(--text-subtle)' }}>Needs {needs}.</span>
      </span>
    </div>
  );
}

export function Skeleton({ height = 14, width = '100%' }: { height?: number; width?: number | string }) {
  return (
    <div style={{
      height, width, borderRadius: 'var(--r)',
      background: 'var(--bg-subtle)',
    }} />
  );
}

/* ---------- rows ---------- */

/** 36px list row, the kit's default density. 44px when it holds an avatar. */
export function Row({ children, onClick, style }: { children: ReactNode; onClick?: () => void; style?: CSSProperties }) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        minHeight: 36, padding: '7px 0',
        borderBottom: '1px solid var(--border)',
        cursor: onClick ? 'pointer' : 'default',
        ...style,
      }}
    >{children}</div>
  );
}

export const money = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('en-GB', {
    style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
  }).format(Number(n));

export const compactMoney = (n: number) => {
  const v = Math.round(Number(n) || 0);
  if (Math.abs(v) >= 1_000_000) return '£' + (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'm';
  if (Math.abs(v) >= 1_000) return '£' + Math.round(v / 1_000) + 'k';
  return '£' + v;
};
