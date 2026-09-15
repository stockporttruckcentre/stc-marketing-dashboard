'use client';

import { useEffect, useRef, useState } from 'react';
import { IEdit, ITick } from './icons';
import { money, workings } from '@/lib/ratecards/format';
import type { Rate } from '@/lib/ratecards/types';

/* =============================================================
   One rate, across its priced columns.

   Ported from `rate-row-bases.html` and `rate-row-states.html`: every
   wrapper, every class and the nesting order are the kit's. What is
   added is the behaviour those two files document but cannot perform.

   ---- The five bases, and which cell they fill ----

     derived    hours x labour, and the workings say so
     labour     the driver, and the one somebody actually decides
     fixed      STC's own flat charge
     statutory  a DVSA fee, skipped by uplifts BY TYPE
     tbc/blank  exportable on purpose; the master ships with TBCs

   ---- Why each axle column is its own editor ----

   From the handoff: "Axle columns are independent. A rate can be
   derived on one column and overridden on another; the row badge shows
   the strongest state present." So the badge is computed across the
   row's columns and the editor is opened per column.
   ============================================================= */

/** The chip and the tooltip the kit gives each basis. */
const CHIP: Record<string, { cls: string; label: string; title: string }> = {
  derived:   { cls: 'rc-b',  label: 'Derived',   title: 'hours × labour' },
  labour:    { cls: 'rc-1k', label: 'Labour',    title: 'the driver' },
  fixed:     { cls: 'rc-n',  label: 'Fixed',     title: 'flat charge' },
  statutory: { cls: 'rc-4i', label: 'Statutory', title: 'DVSA, never derives' },
  tbc:       { cls: 'rc-n',  label: 'TBC',       title: 'not yet priced' },
  blank:     { cls: 'rc-n',  label: 'Empty',     title: 'no rate set' },
};

const OVERRIDE_CHIP = {
  cls: 'rc-4h', label: 'OVERRIDE',
  title: 'Overridden, no longer follows the labour rate',
};

export type RowGroup = {
  rateId: string;
  section: string;
  item: string;
  basis: string;
  /** One entry per priced column, in axle order. Axle 0 means one price. */
  columns: Rate[];
};

export function RateRow({
  row, labourFor, editable, changed, onCommit, onRevert, onOpenEditor, editing,
}: {
  row: RowGroup;
  labourFor: (pool: string | null) => number | null;
  editable: boolean;
  /** True just after a labour change moved this row, for the flash. */
  changed: boolean;
  onCommit: (rate: Rate, value: number | null) => Promise<void>;
  onRevert: (rate: Rate) => Promise<void>;
  onOpenEditor: (rate: Rate | null) => void;
  editing: { rateId: string; axle: number } | null;
}) {
  const [hover, setHover] = useState(false);

  const isEditingRow = editing?.rateId === row.rateId;
  const anyOverride = row.columns.some((c) => c.override_value !== null);
  const chip = anyOverride ? OVERRIDE_CHIP : (CHIP[row.basis] ?? CHIP.blank!);

  /* The kit uses a different wrapper class per state rather than a
     modifier, so the state is the class. */
  const wrapper = isEditingRow ? 'rc-57'
    : changed ? 'rc-2i'
    : hover ? 'rc-55'
    : 'rate-row';

  /* A rate with axle columns fills four cells; one without fills a
     single wide cell, which is the kit's `rc-j`. */
  const axled = row.columns.some((c) => c.axle > 0);
  const byAxle = new Map(row.columns.map((c) => [c.axle, c]));

  const first = row.columns[0]!;
  const labour = labourFor(first.pool);

  return (
    <div
      className={wrapper}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-rate={row.rateId}
    >
      <div className="rc-7">
        <span className="rc-4">{row.item}</span>
      </div>

      {axled
        ? [1, 2, 3, 4].map((axle) => {
          const cell = byAxle.get(axle);
          /* A column this rate is not priced on renders hatched, which
             means "not priced on this axle" and is different from zero. */
          if (!cell) {
            return (
              <div className="rc-5" key={axle}>
                <span className="rc-6">–</span>
              </div>
            );
          }
          return (
            <PriceCell
              key={axle} cell={cell} editable={editable}
              open={editing?.rateId === row.rateId && editing.axle === axle}
              onOpen={() => onOpenEditor(cell)}
              onClose={() => onOpenEditor(null)}
              onCommit={onCommit}
            />
          );
        })
        : (
          <PriceCell
            wide cell={first} editable={editable}
            open={editing?.rateId === row.rateId && editing.axle === first.axle}
            onOpen={() => onOpenEditor(first)}
            onClose={() => onOpenEditor(null)}
            onCommit={onCommit}
          />
        )}

      <div className="rc-8">
        {row.basis === 'derived' && first.hours !== null && labour !== null && (
          <span className="rc-d">{workings(first.hours, labour)}</span>
        )}
        {anyOverride && first.would_be !== null && (
          <span className="rc-d" title="What this would be without the override">
            was {money(first.would_be)}
          </span>
        )}
      </div>

      <div className="rc-9">
        <span title={chip.title} className={chip.cls}>{chip.label}</span>
        {row.columns.some((c) => c.over_cap) && (
          <span
            className="rc-3j"
            title={`Over the ${first.cap_by ?? 'statutory'} cap of ${money(first.cap)}. Saved anyway: caps change.`}
          >
            over cap
          </span>
        )}
      </div>

      <div className="rc-a">
        {anyOverride && editable ? (
          <button
            className="rc-3i"
            title="Put this rate back on the template"
            onClick={() => { void onRevert(row.columns.find((c) => c.override_value !== null)!); }}
          >
            <ITick size={13} />
          </button>
        ) : hover && editable ? (
          <button
            className="rc-3i"
            title={`Set ${row.item} by hand`}
            onClick={() => onOpenEditor(first)}
          >
            <IEdit size={13} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------
   One price cell, which is also the inline editor.

   From the handoff: "Autosave on blur, debounced 400ms ... A save
   button must never be the only way to persist." So committing is what
   blur does, and Escape abandons.
   ------------------------------------------------------------- */
function PriceCell({
  cell, wide, editable, open, onOpen, onClose, onCommit,
}: {
  cell: Rate;
  wide?: boolean;
  editable: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onCommit: (rate: Rate, value: number | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(cell.price === null ? '' : String(cell.price));
    /* Focus after the frame that rendered the input, and select it all,
       because the commonest edit is replacing the number rather than
       amending it. */
    const id = window.requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, cell.price]);

  const commit = async () => {
    const text = draft.trim();
    if (text === '') { onClose(); return; }
    const value = Number(text.replace(/[£,\s]/g, ''));
    if (Number.isNaN(value)) { onClose(); return; }
    if (cell.price !== null && Math.abs(value - cell.price) < 0.005) { onClose(); return; }
    await onCommit(cell, value);
    onClose();
  };

  const cls = wide ? 'rc-j' : 'rc-3';

  if (open) {
    return (
      <div className={cls}>
        <input
          ref={input}
          className="rc-1b"
          inputMode="decimal"
          aria-label={`${cell.item} price`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { void commit(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void commit(); }
            if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          }}
          style={{ width: '100%', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
        />
      </div>
    );
  }

  /* Not priced, and saying so in the words the master workbook uses
     rather than as a zero. */
  if (cell.price === null) {
    const words = cell.text_value ?? (cell.basis === 'tbc' ? 'TBC' : '');
    return (
      <div className={words ? cls : 'rc-5'}>
        {words
          ? <span className="rc-2" style={{ color: 'var(--text-subtle)' }}>{words}</span>
          : <span className="rc-6">–</span>}
      </div>
    );
  }

  return (
    <div
      className={cls}
      onDoubleClick={editable ? onOpen : undefined}
      title={editable ? 'Double click to set this by hand' : undefined}
    >
      <span className="rc-2">{money(cell.price)}</span>
      {cell.price_stc !== null && (
        <span className="rc-12" title="Billed to STC as a contract inclusive item">
          {money(cell.price_stc)} to STC
        </span>
      )}
    </div>
  );
}
