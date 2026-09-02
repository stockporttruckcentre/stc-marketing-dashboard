'use client';

import { useState } from 'react';

/* =============================================================
   Underline tabs.

   Its own file because it holds state, and `primitives.tsx` must not:
   that file is imported by server components for everything from Card
   to Label, and one `use client` at the top of it would pull the whole
   kit into the browser bundle.
   ============================================================= */

const EASE = 'cubic-bezier(0.2, 0, 0, 1)';

/**
 * Underline tabs, per the kit's navigation page.
 *
 * ---- Reordering ----
 *
 * Pass `onReorder` and the tabs can be dragged into whatever order the
 * person wants. From the business, about the tracker's three divisions:
 * "make it so people can re-order them by drag and it saves forever
 * device-wide."
 *
 * Where they are saved is the caller's business, not this component's.
 * It reports the new order of keys and does nothing else, so the same
 * strip can be remembered on the machine here and on the account
 * somewhere else without either being wired in here.
 *
 * Alt with the arrow keys does the same thing, because a strip that can
 * only be arranged with a mouse cannot be arranged by everybody, and
 * because dragging three tabs on a phone is worse than pressing a key.
 */
export function Tabs<T extends string>({
  value, onChange, tabs, onReorder,
}: {
  value: T; onChange: (v: T) => void;
  tabs: { key: T; label: string; count?: number }[];
  onReorder?: (keys: T[]) => void;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const move = (from: number, to: number) => {
    if (!onReorder || from === to || to < 0 || to >= tabs.length) return;
    const keys = tabs.map((t) => t.key);
    const [lifted] = keys.splice(from, 1);
    if (lifted === undefined) return;
    keys.splice(to, 0, lifted);
    onReorder(keys);
  };

  return (
    <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border)' }}>
      {tabs.map((t, i) => {
        const on = t.key === value;
        /* The drop line goes on the side the tab is coming FROM, so the
           mark sits where the tab will land rather than where the
           pointer happens to be. */
        const landing = onReorder && over === i && dragging !== null && dragging !== i
          ? (dragging < i ? { borderRight: '2px solid var(--accent)' }
            : { borderLeft: '2px solid var(--accent)' })
          : null;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            draggable={!!onReorder}
            onDragStart={(e) => {
              setDragging(i);
              /* Firefox will not start a drag without payload, and the
                 payload has to be something: the key is the honest
                 thing to put there. */
              e.dataTransfer.setData('text/plain', t.key);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => { if (onReorder) { e.preventDefault(); setOver(i); } }}
            onDragEnd={() => { setDragging(null); setOver(null); }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging !== null) move(dragging, i);
              setDragging(null); setOver(null);
            }}
            onKeyDown={(e) => {
              if (!onReorder || !e.altKey) return;
              if (e.key === 'ArrowLeft') { e.preventDefault(); move(i, i - 1); }
              if (e.key === 'ArrowRight') { e.preventDefault(); move(i, i + 1); }
            }}
            title={onReorder ? 'Drag to reorder, or hold Alt and press left or right' : undefined}
            aria-selected={on}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              height: 34, padding: '0 13px', border: 'none', background: 'transparent',
              borderBottom: `2px solid ${on ? 'var(--accent)' : 'transparent'}`,
              color: on ? 'var(--text)' : 'var(--text-muted)',
              fontFamily: 'var(--inter)', fontSize: 13, fontWeight: on ? 600 : 500,
              cursor: 'pointer', marginBottom: -1,
              transition: `color 120ms ${EASE}, border-color 120ms ${EASE}`,
              /* The tab being carried fades; the gap it is heading for
                 gets a rule. Nothing moves under the pointer until the
                 drop, because a strip that reshuffles while you are
                 still deciding is harder to aim at, not easier. */
              opacity: dragging === i ? 0.4 : 1,
              ...landing,
            }}
          >
            {t.label}
            {t.count != null && (
              <span style={{
                fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
                color: on ? 'var(--accent)' : 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums',
              }}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
