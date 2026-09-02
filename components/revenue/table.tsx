'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Card, Label } from '@/components/kit/primitives';

/* =============================================================
   One table, one set of columns.

   ---- The bug this exists because of ----

   The header row and the body rows each declared their own widths:

     <Head cells={[...]} />        flex 2.2 then 1 for the rest
     <div style={ROW}>...          flex 1, 2.4, 1.4, 1, 1.2, 1

   On the customers table those happened to agree. On open work they did
   not, so every column heading sat over the wrong column. Nothing was
   wrong with the data and every figure on the screen was mislabelled,
   which is the worst kind of wrong a table can be.

   Two declarations of one thing is one declaration and a bug waiting to
   be noticed. So a column is declared once, and the header and the body
   are both drawn from it. They cannot disagree because there is nothing
   left to disagree about.

   ---- Sorting ----

   A column says what it sorts on, or says nothing and is not sortable.
   Click to sort, click again to reverse. The first click on a number
   sorts DESCENDING, because somebody clicking "this year" wants the
   biggest customer, not the smallest.
   ============================================================= */

export type Col<T> = {
  key: string;
  label: string;
  /** Width relative to the other columns. */
  flex: number;
  minWidth: number;
  align?: 'left' | 'right';
  cell: (row: T) => ReactNode;
  /**
   * What this column sorts on. Omitted means it does not sort, which is
   * honest for a column of buttons and dishonest for a column of
   * numbers.
   */
  sort?: (row: T) => string | number | null;
};

const CELL = (c: Col<unknown>): React.CSSProperties => ({
  flex: c.flex,
  minWidth: c.minWidth,
  padding: '0 14px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textAlign: c.align ?? 'left',
  color: 'var(--text)',
});

export function DataTable<T>({
  columns, rows, rowKey, initial, onRowClick, footer,
}: {
  columns: Col<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Which column to sort by on first paint, and which way. */
  initial?: { key: string; desc?: boolean };
  onRowClick?: (row: T) => void;
  footer?: ReactNode;
}) {
  const [by, setBy] = useState<string | null>(initial?.key ?? null);
  const [desc, setDesc] = useState(initial?.desc ?? true);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === by);
    if (!col?.sort) return rows;
    const get = col.sort;
    return [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      /* Nothing sorts last whichever way round it is. A customer with
         no last billed date is not the oldest, they are unknown. */
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const cmp = typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y));
      return desc ? -cmp : cmp;
    });
  }, [rows, columns, by, desc]);

  const click = (c: Col<T>) => {
    if (!c.sort) return;
    if (by === c.key) { setDesc((d) => !d); return; }
    setBy(c.key);
    /* A number's first click shows the biggest. A name's shows A first. */
    setDesc(c.align === 'right');
  };

  return (
    <Card padded={false}>
      <div style={{
        display: 'flex', alignItems: 'center', minHeight: 32,
        background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
      }}>
        {columns.map((c) => {
          const on = by === c.key;
          return (
            <div
              key={c.key}
              onClick={() => click(c)}
              role={c.sort ? 'button' : undefined}
              tabIndex={c.sort ? 0 : undefined}
              onKeyDown={(e) => { if (c.sort && (e.key === 'Enter' || e.key === ' ')) click(c); }}
              aria-sort={on ? (desc ? 'descending' : 'ascending') : undefined}
              style={{
                ...CELL(c as Col<unknown>),
                display: 'flex', alignItems: 'center', gap: 5,
                justifyContent: (c.align ?? 'left') === 'right' ? 'flex-end' : 'flex-start',
                cursor: c.sort ? 'pointer' : 'default',
                userSelect: 'none',
              }}
            >
              <Label style={on ? { color: 'var(--accent)' } : undefined}>{c.label}</Label>
              {on && (desc
                ? <ArrowDown size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                : <ArrowUp size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} />)}
            </div>
          );
        })}
      </div>

      {sorted.map((r) => (
        <div
          key={rowKey(r)}
          onClick={onRowClick ? () => onRowClick(r) : undefined}
          style={{
            display: 'flex', alignItems: 'center', minHeight: 36,
            borderBottom: '1px solid var(--border)', fontSize: 13,
            cursor: onRowClick ? 'pointer' : 'default',
          }}
        >
          {columns.map((c) => (
            <div key={c.key} style={CELL(c as Col<unknown>)}>{c.cell(r)}</div>
          ))}
        </div>
      ))}

      {footer}
    </Card>
  );
}

/**
 * A count of jobs and what they are worth, told apart.
 *
 * From the business: "the job amount and value of all jobs needs unique
 * formatting so you don't confuse the two". They are two different
 * kinds of number sitting next to each other, and at a glance `3` and
 * `£4,200` in the same weight read as one figure with a separator.
 *
 * So they are two columns rather than one clever cell. A count is a
 * count and money is money, and no formatting trick beats putting them
 * under two headings that each say which is which.
 */
export function Count({ n }: { n: number }) {
  if (!n) return <span style={{ color: 'var(--text-subtle)' }}>—</span>;
  return (
    <span style={{
      fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 13,
      fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
    }}>{n.toLocaleString('en-GB')}</span>
  );
}

/** Money, quiet by default so a count beside it reads as the louder. */
export function Money({ children, quiet }: { children: ReactNode; quiet?: boolean }) {
  return (
    <span style={{
      fontVariantNumeric: 'tabular-nums',
      color: quiet ? 'var(--text-muted)' : 'var(--text)',
    }}>{children}</span>
  );
}
