'use client';

import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { Table2, BarChart3 } from 'lucide-react';
import { Label, compactMoney } from '@/components/kit/primitives';

/* =============================================================
   The panel, and the grid it sits in.

   ---- The complaint this exists to answer ----

   From the business, about the page this replaces:

     It's extremely messy, ui broken on lower section, columns all
     different sized, text formatting not great to understand. It's just
     information overload.

   Every one of those is the same fault. The page was three cards, each
   of which appended however many blocks its division happened to have:
   trailer sales carried deals, sellers, a funnel, a customer list and a
   list of records to create, while rental carried an ageing bar and a
   funnel. Two cards side by side, one twice the height of the other,
   with a form growing out of the bottom of one of them.

   Nothing about that was fixable by tidying. A layout whose height is
   decided by its content will always be ragged, and a card that can
   grow a form is a card that will one day be broken at the bottom.

   ---- So the height is decided by the grid, not the content ----

   `PanelGrid` is twelve columns. A panel declares how many it spans and
   nothing else. Grid rows size to their tallest member and every child
   stretches, so two panels on one row are the same height by
   construction rather than by luck, and no panel can push its
   neighbour out of shape.

   Inside, a panel is head, body, foot. The body is the only part that
   flexes and it scrolls rather than grows, so content that does not fit
   is a scrollbar inside one panel and never a page that has come apart.

   ---- Numbers are one press away, not on the screen ----

   The finance team asked for enough to brief the managing director, and
   then reported the result as information overload. Both are true and
   they are not in conflict: what was wrong was that everything was
   quoted at once, in eight type sizes, whether or not anybody was
   asking.

   So every panel that draws something can also tabulate it, on a
   toggle. The default is the picture. The numbers are one press away,
   in a real table, at one size, which is also the accessible reading of
   any chart on the page.
   ============================================================= */

/** Twelve columns, and every panel on a row the same height. */
export function PanelGrid({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
      /* `stretch` is the default and is stated because it is the whole
         mechanism: it is what makes two panels on one row equal. */
      alignItems: 'stretch',
      gap: 14,
      ...style,
    }}>
      {children}
    </div>
  );
}

export type TableRow = {
  /** The row's first cell, and its accessible name. */
  name: string;
  /** A colour swatch beside the name, where the row is a series. */
  colour?: string;
  cells: (string | number | null)[];
};

export function Panel({
  title, hint, toolbar, span = 4, minBody = 220, table, foot, children, onTitleClick,
}: {
  title: string;
  /** One short line under the title. Never a paragraph. */
  hint?: string;
  /** Controls that change what the body draws. Right of the title. */
  toolbar?: ReactNode;
  /** How many of the twelve columns. */
  span?: number;
  /** The body's smallest height. Panels on a row settle on the tallest. */
  minBody?: number;
  /** The same data as rows. Its presence is what shows the toggle. */
  table?: { columns: string[]; rows: TableRow[] };
  foot?: ReactNode;
  children: ReactNode;
  onTitleClick?: () => void;
}) {
  const [showing, setShowing] = useState<'chart' | 'table'>('chart');
  const bodyId = useId();

  return (
    <section
      style={{
        gridColumn: `span ${span}`,
        minWidth: 0,
        display: 'flex', flexDirection: 'column',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)',
        overflow: 'hidden',
      }}
    >
      <header style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '11px 14px 10px', flex: 'none', minHeight: 44,
        borderBottom: '1px solid var(--border)',
      }}>
        {/* 140px before it gives up and wraps the toolbar underneath.
            A title squeezed to three characters and an ellipsis is
            worse than a toolbar on its own line. */}
        <div style={{ minWidth: 140, flex: 1 }}>
          <h2
            onClick={onTitleClick}
            style={{
              margin: 0,
              fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 13.5,
              letterSpacing: '-0.01em', color: 'var(--text)',
              cursor: onTitleClick ? 'pointer' : undefined,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >{title}</h2>
          {hint && (
            <div style={{
              fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 1,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{hint}</div>
          )}
        </div>

        {showing === 'chart' && toolbar}

        {table && (
          <button
            type="button"
            onClick={() => setShowing((s) => (s === 'chart' ? 'table' : 'chart'))}
            aria-pressed={showing === 'table'}
            aria-controls={bodyId}
            title={showing === 'chart' ? 'Show the numbers' : 'Show the chart'}
            style={{
              flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 5,
              height: 26, padding: '0 8px', cursor: 'pointer',
              borderRadius: 'var(--r)', border: '1px solid var(--border)',
              background: showing === 'table' ? 'var(--bg-subtle)' : 'transparent',
              color: 'var(--text-muted)', fontFamily: 'var(--inter)', fontSize: 11.5,
            }}
          >
            {showing === 'chart' ? <Table2 size={12} /> : <BarChart3 size={12} />}
            {showing === 'chart' ? 'Numbers' : 'Chart'}
          </button>
        )}
      </header>

      <div
        id={bodyId}
        style={{
          flex: 1, minHeight: minBody, minWidth: 0,
          padding: '12px 14px',
          display: 'flex', flexDirection: 'column',
          overflow: 'auto',
        }}
      >
        {showing === 'table' && table ? <Numbers {...table} /> : children}
      </div>

      {foot && (
        <footer style={{
          flex: 'none', padding: '9px 14px', borderTop: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          fontSize: 11.5, color: 'var(--text-muted)', minHeight: 36,
        }}>
          {foot}
        </footer>
      )}
    </section>
  );
}

/**
 * The same data as a table.
 *
 * Not a fallback. It is how somebody quotes a figure into a board pack,
 * and it is the reading of the chart for anybody who cannot use the
 * colours, which is why every panel that draws has one.
 */
function Numbers({ columns, rows }: { columns: string[]; rows: TableRow[] }) {
  if (!rows.length) {
    return (
      <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>Nothing to tabulate.</span>
    );
  }
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th key={c} style={{
              textAlign: i === 0 ? 'left' : 'right',
              padding: '0 0 6px', whiteSpace: 'nowrap',
              borderBottom: '1px solid var(--border)',
              fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
              letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-subtle)',
            }}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <td style={{
              padding: '6px 10px 6px 0', borderBottom: '1px solid var(--border)',
              color: 'var(--text)', maxWidth: 220,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {r.colour && (
                <span style={{
                  display: 'inline-block', width: 8, height: 8, borderRadius: 2,
                  background: r.colour, marginRight: 7,
                }} />
              )}
              {r.name}
            </td>
            {r.cells.map((c, i) => (
              <td key={i} style={{
                padding: '6px 0', textAlign: 'right', whiteSpace: 'nowrap',
                borderBottom: '1px solid var(--border)',
                fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)',
              }}>
                {c == null ? '—' : typeof c === 'number' ? compactMoney(c) : c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * A key, under a chart rather than floating on it.
 *
 * Always drawn where a chart has two or more series. Identity is never
 * carried by colour alone: each entry pairs the swatch with the name,
 * and the charts themselves label directly wherever there is room.
 */
export function Key({ items, onToggle, hidden }: {
  items: { key: string; name: string; colour: string; pattern?: string }[];
  /** Present where the series can be switched off. */
  onToggle?: (key: string) => void;
  hidden?: Set<string>;
}) {
  return (
    <>
      {items.map((s) => {
        const off = hidden?.has(s.key) ?? false;
        const inner = (
          <>
            <span style={{
              width: 10, height: 10, borderRadius: 2, flexShrink: 0,
              background: off ? 'var(--chart-empty)' : s.colour,
              /* The texture the band carries, repeated in the key, so
                 the two are read as the same thing in print and by
                 anybody who cannot separate the hues. */
              backgroundImage: !off && s.pattern ? s.pattern : undefined,
            }} />
            <span style={{
              color: off ? 'var(--text-subtle)' : 'var(--text-muted)',
              textDecoration: off ? 'line-through' : undefined,
            }}>{s.name}</span>
          </>
        );
        return onToggle ? (
          <button
            key={s.key}
            type="button"
            onClick={() => onToggle(s.key)}
            aria-pressed={!off}
            title={off ? `Show ${s.name}` : `Hide ${s.name}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
              font: 'inherit', color: 'inherit',
            }}
          >{inner}</button>
        ) : (
          <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {inner}
          </span>
        );
      })}
    </>
  );
}

/** The heading step inside a panel body, where one body holds two things. */
export function Sub({ children }: { children: ReactNode }) {
  return <div style={{ marginBottom: 7 }}><Label>{children}</Label></div>;
}

/**
 * A small switch between two or three ways of drawing the same panel.
 *
 * The kit's `Segmented` is a FORM control: full width, 30px tall, each
 * option flexed to an equal share of the row. Dropped into a chart
 * toolbar it stretches to fill nothing in particular and the labels run
 * into each other, which is exactly how it looked the first time this
 * page was rendered and looked at.
 *
 * So a toolbar gets a toolbar control: sized to its own words, 26px to
 * match the other buttons on the row, and never wider than what it
 * says.
 */
export function Segments<T extends string>({ value, onChange, options }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div
      role="group"
      style={{
        display: 'inline-flex', alignItems: 'center', flex: 'none',
        height: 26, padding: 2, gap: 2,
        borderRadius: 'var(--r)', border: '1px solid var(--border)',
        background: 'var(--surface-sunken)',
      }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            style={{
              height: 20, padding: '0 9px', border: 0, cursor: 'pointer',
              borderRadius: 'var(--r-sm)',
              background: on ? 'var(--surface)' : 'transparent',
              boxShadow: on ? 'var(--shadow-1)' : undefined,
              color: on ? 'var(--text)' : 'var(--text-subtle)',
              fontFamily: 'var(--inter)', fontSize: 11.5, fontWeight: on ? 600 : 500,
              letterSpacing: '-0.01em', whiteSpace: 'nowrap',
            }}
          >{o.label}</button>
        );
      })}
    </div>
  );
}

/** The same 26px height as the segments, for a lone on and off. */
export function Toggle({ on, onChange, children, title }: {
  on: boolean; onChange: (v: boolean) => void; children: ReactNode; title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={() => onChange(!on)}
      style={{
        height: 26, padding: '0 9px', cursor: 'pointer', flex: 'none',
        borderRadius: 'var(--r)', border: '1px solid var(--border)',
        background: on ? 'var(--bg-subtle)' : 'transparent',
        color: on ? 'var(--text)' : 'var(--text-subtle)',
        fontFamily: 'var(--inter)', fontSize: 11.5, fontWeight: on ? 600 : 500,
        whiteSpace: 'nowrap',
      }}
    >{children}</button>
  );
}
