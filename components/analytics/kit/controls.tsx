'use client';

import type { ReactNode } from 'react';
import { KIT_PARTS } from '@/lib/analytics/kit.generated';
import { parseStyle } from './mirror';

/* =============================================================
   The kit's controls, as components.

   A device is a whole panel and `mirror.tsx` renders one node for
   node. A screen the kit has no panel for still has to be built out of
   something, and the only permitted something is the kit's own
   declarations. `KIT_PARTS` holds them: each one is the style string
   of a named element in `docs/source/STCUIAnalytics.html`, read back
   out of a rendered browser page by `npm run kit:extract`.

   So there is no length, no colour and no weight in this file. There
   is nothing in it to invent.

   ---- The four buttons ----

   The kit draws four and the difference between them is in the file,
   not in a judgement: primary carries `background:var(--primary)`,
   accent is an underlined link in `var(--accent)`, ghost is
   transparent on `--text-muted`, secondary is the bordered default.
   They are extracted from "Apply to page", "Add filter", "Clear" and
   "Save this view".

   ---- Panton and Inter ----

   From the business:

     Ensure tables use inter for labels and figures, not panton.
     Panton is our main accent font for headings and pulling attention
     to things ... Inter is the primary font for analytics.

   The kit's own small caps label is Panton. That instruction is later
   than the kit and it is explicit, so `Label` swaps the family and
   leaves every other declaration the file wrote alone. It is a
   transform of the kit's string, never a replacement for it, which is
   the same rule `mirror.tsx` holds its patches to.
   ============================================================= */

const style = (key: keyof typeof KIT_PARTS) => parseStyle(KIT_PARTS[key].style);

/* The kit writes its own family into the declaration, so switching one
   is a substitution on the string rather than a value being chosen. */
const inInter = (key: keyof typeof KIT_PARTS) =>
  parseStyle(KIT_PARTS[key].style.replace('var(--panton)', 'var(--inter)'));

export type ButtonKind = 'primary' | 'secondary' | 'accent' | 'ghost';

const BUTTON: Record<ButtonKind, keyof typeof KIT_PARTS> = {
  primary: 'buttonPrimary',
  secondary: 'buttonSecondary',
  accent: 'buttonAccent',
  ghost: 'buttonGhost',
};

export function Button({
  kind = 'secondary', onClick, disabled, type = 'button', title, children,
}: {
  kind?: ButtonKind;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      /* Disabled is the kit's own control at reduced opacity rather
         than a second set of colours, because the kit draws no
         disabled state and inventing one is the banned move. */
      style={{ ...style(BUTTON[kind]), opacity: disabled ? 0.55 : 1, cursor: disabled ? 'default' : 'pointer' }}
    >{children}</button>
  );
}

/**
 * The kit's segmented control.
 *
 * Three styles, not one: the file gives the selected segment
 * `--primary` with the left corners rounded, the middles a left border
 * removed, and the last the right corners rounded. Which style a
 * segment gets is its position and whether it is on, both of which are
 * facts about the list rather than choices.
 */
export function Segmented<T extends string>({ options, value, onChange }: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <div style={{ display: 'flex' }}>
      {options.map((o, i) => {
        const on = o.key === value;
        const base = KIT_PARTS[i === 0 ? 'segmentOn' : i === options.length - 1 ? 'segmentEnd' : 'segmentMid'].style;
        /* An unselected first segment and a selected middle one are
           both in the kit, in different buttons. The corners come from
           the position and the colours from the state, so each half is
           taken from the button in the file that has it. */
        const corners = base.match(/border-radius:[^;]*/)?.[0] ?? '';
        /* The kit removes the left border on every segment after the
           first, so the two buttons share one rule rather than drawing
           two. Taken out of the file's own middle segment rather than
           typed, which is the whole rule this file is built on. */
        const seam = KIT_PARTS.segmentMid.style.match(/border-left:[^;]*/)?.[0] ?? '';
        const skin = on ? KIT_PARTS.segmentOn.style : KIT_PARTS.segmentMid.style;
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            aria-pressed={on}
            style={parseStyle(
              `${skin.replace(/border-radius:[^;]*/, corners).replace(/border-left:[^;]*;?/, '')};`
              + `${i === 0 ? '' : `${seam};`}`,
            )}
          >{o.label}</button>
        );
      })}
    </div>
  );
}

/** The kit's field: a bordered shell with a borderless input in it. */
export function Field({
  value, onChange, placeholder, type = 'text', width, align, onBlur, ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'number' | 'month';
  /** Overrides the kit's own 210px, for a field in a table column. */
  width?: number | string;
  align?: 'right';
  onBlur?: () => void;
  ariaLabel?: string;
}) {
  const shell = style('fieldShell');
  return (
    <div style={{ ...shell, ...(width !== undefined ? { width } : null) }}>
      <input
        type={type}
        inputMode={type === 'number' ? 'numeric' : undefined}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        style={{
          ...style('fieldInput'),
          ...(align === 'right' ? { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } : null),
        }}
      />
    </div>
  );
}

/**
 * The kit's small caps label, in Inter.
 *
 * See the note at the top: the family is the one thing the business
 * changed after the kit was written. Everything else, the size, the
 * tracking, the weight and the colour, is the file's.
 */
export function Label({ children, block }: { children: ReactNode; block?: boolean }) {
  return (
    <span style={{
      ...inInter('label'),
      textTransform: 'uppercase',
      ...(block ? { display: 'block' } : null),
    }}>{children}</span>
  );
}

/**
 * The kit's toolbar row.
 *
 * Its own control bar: a flex row with the file's gap, its padding and
 * its rule underneath. A screen the kit has no panel for still gets
 * laid out in the kit's spacing rather than in numbers somebody typed,
 * which is what `npm run check:invention` is there to force.
 */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div style={style('toolbarRow')}>{children}</div>;
}

/**
 * The kit's alert.
 *
 * The file draws one and it is a warning: an amber rule, an amber
 * icon and a wash of amber behind it, for the part month guard.
 *
 * An error is the same object in red. The tone is a substitution on
 * the kit's own string, never a second panel, so the padding, the gap
 * and the radius are the file's. The wash is DROPPED rather than
 * recoloured: the kit writes it as a literal rgba of its own amber,
 * and a red one would have to be mixed, which means choosing a value.
 * A red rule with no wash is the same object with one declaration
 * removed, and removing is always allowed where choosing is not.
 */
export function Alert({ tone = 'warning', children }: {
  tone?: 'warning' | 'danger';
  children: ReactNode;
}) {
  const kit = KIT_PARTS.alert.style;
  const css = tone === 'warning'
    ? kit
    : kit.replace(/background:[^;]+;?/, '').replace(/var\(--warning\)/g, 'var(--danger)');
  return <div style={parseStyle(css)}>{children}</div>;
}
