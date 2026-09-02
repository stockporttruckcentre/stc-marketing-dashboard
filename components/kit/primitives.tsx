/* =============================================================
   STC UI kit primitives.

   Recreated from design-system/reference as React, per CLAUDE.md.
   The reference HTML is a prototype and is never lifted; these are
   built with this codebase's own patterns and semantic tokens only.

   Density is the kit's: 32px controls, 36px rows, 14px base text.
   Radius: 4 default, 6 cards and panels, 8 dialogs.
   Borders carry structure. Elevation is only for things that float.
   ============================================================= */
import type React from 'react';
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

/**
 * A square button where a label would be noise.
 *
 * Inside a table row, where the meaning comes from the column it sits
 * in. Always carries an `aria-label` and a title: an icon on its own is
 * not a name, and a row of unlabelled glyphs is unusable to anybody
 * reading the page rather than looking at it.
 */
export function IconButton({
  label, onClick, danger, disabled, children,
}: {
  label: string; onClick: () => void; danger?: boolean; disabled?: boolean; children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 26, height: 26, borderRadius: 'var(--r-sm)',
        border: '1px solid transparent', background: 'transparent',
        color: disabled ? 'var(--text-subtle)' : danger ? 'var(--danger)' : 'var(--text-muted)',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: `background 120ms ${EASE}, color 120ms ${EASE}`,
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'var(--bg-subtle)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
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

/**
 * The kit's table badge, drawn for a grid cell rather than a page.
 *
 * A cell renderer cannot inherit `Badge`'s sizing without fighting the
 * row's 36px line box, so this is the same vocabulary at the height a
 * row can hold. It lived in CrmWorkspace, where the other two tabs
 * could not reach it, and each grew its own status pill instead.
 */
export function GridBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, height: 20, padding: '0 8px',
      borderRadius: 'var(--r-sm)', color: TONE_FG[tone],
      background: 'color-mix(in srgb, currentColor 13%, transparent)',
      fontSize: 11, fontWeight: 600, letterSpacing: '0.01em',
      textTransform: 'capitalize', whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 'var(--r-full)', background: 'currentColor' }} />
      {children}
    </span>
  );
}

/* ---------- metrics ---------- */

/**
 * Step the number down as it gets longer so a six figure sum still fits
 * on one line. Without this a card sized for "12" wraps on "£124,500".
 */
function numberSize(value: string, base: number): number {
  const n = value.length;
  if (n <= 4) return base;
  if (n <= 6) return base - 3;
  if (n <= 9) return base - 6;
  return base - 9;
}

/**
 * A number with its label. Used inline in the summary strip, where a row
 * of separate cards would just be visual noise.
 */
export function Figure({
  label, value, sub, tone,
}: { label: string; value: string; sub?: string; tone?: Tone }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
      <Label>{label}</Label>
      <span style={{
        fontFamily: 'var(--panton)', fontWeight: 800,
        fontSize: numberSize(value, 24), lineHeight: 1.05, letterSpacing: '-0.03em',
        fontVariantNumeric: 'tabular-nums', color: tone ? TONE_FG[tone] : 'var(--text)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{value}</span>
      {sub && (
        <span style={{
          fontSize: 12, color: 'var(--text-subtle)', lineHeight: 1.35,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{sub}</span>
      )}
    </div>
  );
}

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
        fontFamily: 'var(--panton)', fontWeight: 800,
        fontSize: numberSize(value, 26), lineHeight: 1.05,
        letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums',
        color: tone ? TONE_FG[tone] : 'var(--text)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{value}</span>
      {sub && <span style={{ fontSize: 12, color: 'var(--text-subtle)', lineHeight: 1.4 }}>{sub}</span>}
    </div>
  );
}

/**
 * Proportional bar. Used where a table would otherwise leave a wide empty
 * gutter between a name on the left and figures on the right.
 */
export function Bar({ value, max, tone = 'neutral' }: { value: number; max: number; tone?: Tone }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div style={{
      position: 'relative', height: 6, borderRadius: 'var(--r-full)',
      background: 'var(--bg-subtle)', overflow: 'hidden', width: '100%',
    }}>
      <div style={{
        position: 'absolute', inset: 0, width: `${pct * 100}%`,
        background: TONE_FG[tone], borderRadius: 'var(--r-full)',
        transition: `width 220ms ${EASE}`,
      }} />
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

/**
 * A button on the filled bulk bar.
 *
 * The bar is `--primary`, which the kit inverts between themes: navy in
 * light, white in dark. So everything drawn on it has to invert the
 * other way or the hairlines vanish, which is what `--bar-line` and
 * `--bar-danger` are for. See `.crm-bulk-bar` in kit-tokens.css.
 */
export function InverseButton({ icon, label, onClick, danger }: {
  icon: ReactNode; label: string;
  onClick: (e: React.MouseEvent) => void; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px',
        background: 'transparent', cursor: 'pointer', borderRadius: 'var(--r)',
        color: danger ? 'var(--bar-danger)' : 'inherit',
        border: `1px solid ${danger ? 'var(--bar-danger)' : 'var(--bar-line)'}`,
        fontFamily: 'var(--inter)', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
      }}
    >{icon}{label}</button>
  );
}

/* ---------- the shapes a whole tab is built from ----------

   The CRM pipeline tab had both of these written out inline, and the
   tracker and the stock list had neither. Two tabs asked to look like a
   third is not a styling job if the third one's shape lives in its own
   file: they drift the first time one of them is touched. So the shape
   moves here, once, and all three render the same markup.

   From `reference/06-patterns.html` (record header) and
   `reference/03-data.html` (stat strip). Recreated, not lifted. */

/**
 * The header a whole tab sits under.
 *
 * An icon tile, a Panton title, whatever badges qualify it, one line of
 * context, and the actions that are always available on the right. The
 * icon tile is `--bg-subtle` with an `--accent` glyph: the one place red
 * appears without being a button, because it is identifying the screen
 * rather than asking for anything.
 */
export function RecordHead({
  icon, title, badges, sub, actions,
}: {
  icon: ReactNode;
  title: ReactNode;
  badges?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--r-md)', padding: '14px 16px',
      display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
    }}>
      <span style={{
        width: 40, height: 40, borderRadius: 'var(--r)', flex: 'none',
        background: 'var(--bg-subtle)', color: 'var(--accent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{icon}</span>

      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <h1 style={{
            margin: 0, fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 22,
            letterSpacing: '-0.03em', color: 'var(--text)', lineHeight: 1.2,
          }}>{title}</h1>
          {badges}
        </div>
        {sub && (
          <div style={{ fontSize: 12.5, color: 'var(--text-subtle)', marginTop: 3 }}>{sub}</div>
        )}
      </div>

      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  );
}

/**
 * The numbers across the top, as one card divided by rules.
 *
 * No colour on any value, deliberately. Colouring five numbers five ways
 * breaks rule one twice over and makes a count of zero shout. The label
 * is the kit's label step, the number is Panton at 24 with tabular
 * figures so a column of them lines up, and any qualifier sits beside it
 * as small subtle text rather than under it.
 */
export function StatStrip({
  items,
}: { items: { label: string; value: ReactNode; note?: string }[] }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--r-md)', display: 'flex', flexWrap: 'wrap', overflow: 'hidden',
    }}>
      {items.map((f, i) => (
        <div key={f.label} style={{
          flex: '1 1 140px', minWidth: 0, padding: '13px 18px',
          display: 'flex', flexDirection: 'column', gap: 4,
          borderLeft: i === 0 ? 'none' : '1px solid var(--border)',
        }}>
          <span style={{
            fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 11,
            letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-subtle)',
          }}>{f.label}</span>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
            <span style={{
              fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 24,
              letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums',
              color: 'var(--text)', lineHeight: 1.1,
            }}>{f.value}</span>
            {f.note && (
              <span style={{
                fontSize: 11.5, color: 'var(--text-subtle)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{f.note}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The tab's own scope: one kit surface, full height, nothing else.
 *
 * Fixed height rather than natural flow so the table underneath gets
 * everything left over. 52px top bar, 24px page padding above, 56px
 * below. And exactly one `.kit` per tab: `.kit` paints `var(--bg)`, so a
 * wrapper per cluster lays its own canvas over the page and every seam
 * shows as a band of slightly different dark.
 */
export function TabShell({ children }: { children: ReactNode }) {
  return (
    <div className="kit" style={{
      height: 'calc(100vh - 132px)',
      minHeight: 520,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      background: 'transparent',
    }}>{children}</div>
  );
}

/**
 * The header bar on a panel, as opposed to a heading on a page.
 *
 * `SectionHead` is the page heading: no padding of its own, a bottom
 * margin, and an h2 at the 17px step. Dropped inside `Card padded={false}`
 * it reads as broken, and it was, in six places: the title flush against
 * the left border, the action button against the right, and the margin
 * colliding with the body's own padding underneath.
 *
 * This is the other shape, and the one a bordered panel wants: a 36px
 * bar on `--bg-subtle`, the kit's label step, an optional count, a rule
 * under it, and room for one action on the right.
 */
export function PanelHead({
  title, count, hint, action,
}: { title: string; count?: number; hint?: string; action?: ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      minHeight: 36, padding: '0 14px',
      background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
    }}>
      <Label>{title}</Label>
      {count != null && (
        <span style={{
          fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
          fontVariantNumeric: 'tabular-nums', color: 'var(--text-subtle)',
        }}>{count}</span>
      )}
      {hint && (
        <span style={{
          fontSize: 11.5, color: 'var(--text-subtle)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{hint}</span>
      )}
      <span style={{ flex: 1 }} />
      {action}
    </div>
  );
}

/** The line under a grid saying what the mouse does. */
export function GridHint({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>{children}</div>;
}

/* ---------- controls added for the News surface ---------- */

/**
 * Filter chip with an optional count. Used where a row of toggles filters
 * a list. `empty` dims a chip whose filter would return nothing, so the
 * full set of publications can still be shown.
 */
export function Chip({
  active, count, empty, onClick, title, children,
}: {
  active?: boolean; count?: number; empty?: boolean;
  onClick?: () => void; title?: string; children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        height: 28, padding: '0 11px', borderRadius: 'var(--r)',
        border: `1px solid ${active ? 'var(--border-emphasis)' : 'var(--border)'}`,
        background: active ? 'var(--bg-subtle)' : 'var(--surface)',
        color: active ? 'var(--text)' : 'var(--text-muted)',
        fontFamily: 'var(--inter)', fontSize: 12.5,
        fontWeight: active ? 600 : 500,
        opacity: empty && !active ? 0.5 : 1,
        cursor: 'pointer', whiteSpace: 'nowrap',
        transition: `background 120ms ${EASE}, border-color 120ms ${EASE}`,
      }}
    >
      {children}
      {count != null && (
        <span style={{
          fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
          fontVariantNumeric: 'tabular-nums',
          color: active ? 'var(--accent)' : 'var(--text-subtle)',
        }}>{count}</span>
      )}
    </button>
  );
}

/* `Tabs` lives in `./tabs` now.

   It grew drag to reorder, which needs `useState`, and this file has no
   `use client` on purpose: it is imported by server components for
   Card, Badge, Label and the rest, and marking the whole kit as client
   would drag every one of them into the browser bundle. A component
   that needs state gets its own file with its own boundary, and is
   re-exported here so nothing that imports it has to know. */
export { Tabs } from './tabs';


/** Text input with a leading icon. 32px, per the kit's density. */
export function SearchInput({
  value, onChange, placeholder, icon,
}: { value: string; onChange: (v: string) => void; placeholder?: string; icon?: ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      height: 32, padding: '0 10px', borderRadius: 'var(--r)',
      border: '1px solid var(--border-strong)', background: 'var(--surface)',
      flex: 1, minWidth: 180,
    }}>
      {icon && <span style={{ color: 'var(--text-subtle)', display: 'flex', flexShrink: 0 }}>{icon}</span>}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
          color: 'var(--text)', fontFamily: 'var(--inter)', fontSize: 13,
        }}
      />
    </div>
  );
}

/** Inline notice. Tone carries the meaning; the rule carries the weight. */
export function Alert({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 9,
      padding: '10px 13px', borderRadius: 'var(--r)',
      background: 'var(--surface-sunken)',
      border: '1px solid var(--border)',
      borderLeft: `2px solid ${TONE_FG[tone]}`,
      fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5,
    }}>{children}</div>
  );
}

/** Page heading: eyebrow, Panton title, one line of context. */
export function PageHead({
  eyebrow, title, sub, action,
}: { eyebrow: string; title: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <Label>{eyebrow}</Label>
        <h1 style={{
          margin: '6px 0 0', fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 30,
          lineHeight: 1.15, letterSpacing: '-0.03em', color: 'var(--text)',
          display: 'flex', alignItems: 'center', gap: 9,
        }}>{title}</h1>
        {sub && <div style={{ fontSize: 13, color: 'var(--text-subtle)', marginTop: 5 }}>{sub}</div>}
      </div>
      {action}
    </div>
  );
}
