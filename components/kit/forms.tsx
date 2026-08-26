'use client';

/* =============================================================
   STC UI kit: forms and dialogs.

   Separate from primitives.tsx because everything here holds focus or
   keyboard state, so the file is a client boundary. primitives.tsx has
   to stay usable from server components and would drag them over the
   line if these lived in it.

   Recreated from reference/02-forms.html and reference/05-feedback.html,
   per CLAUDE.md. The reference HTML is a prototype and is never lifted.
   ============================================================= */
import type React from 'react';
import { useEffect, useState } from 'react';
import type { ReactNode, CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';

const EASE = 'cubic-bezier(0.2, 0, 0, 1)';

type FieldState = 'rest' | 'error';

function shellStyle(state: FieldState, focused: boolean): CSSProperties {
  return {
    display: 'flex', alignItems: 'center',
    background: 'var(--surface)',
    border: `1px solid ${state === 'error' ? 'var(--danger)' : focused ? 'var(--focus)' : 'var(--border-strong)'}`,
    borderRadius: 'var(--r)',
    boxShadow: state === 'error'
      ? '0 0 0 3px rgba(207, 36, 23, 0.14)'
      : focused ? '0 0 0 3px rgba(61, 82, 144, 0.16)' : 'none',
    transition: `border-color 120ms ${EASE}, box-shadow 120ms ${EASE}`,
    minWidth: 0,
  };
}

const CONTROL: CSSProperties = {
  flex: 1, minWidth: 0, height: '100%', padding: '0 10px',
  background: 'transparent', color: 'var(--text)', border: 0, outline: 0,
  fontFamily: 'var(--inter)', fontSize: 13, letterSpacing: '-0.01em',
};

/** The 12px label plus its control. Never Panton: these are read, not scanned. */
export function Field({ label, hint, error, children, style }: {
  label?: string; hint?: ReactNode; error?: string; children: ReactNode; style?: CSSProperties;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, ...style }}>
      {label && (
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
          {label}
        </span>
      )}
      {children}
      {error
        ? <span style={{ fontSize: 11.5, color: 'var(--danger)', lineHeight: 1.45 }}>{error}</span>
        : hint
          ? <span style={{ fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.45 }}>{hint}</span>
          : null}
    </div>
  );
}

type InputProps = {
  value: string;
  onChange?: (v: string) => void;
  /* Written when the field is left, not on every keystroke.

     The kit's inline edit behaviour, and what a drawer over a live
     record needs: typing is local, leaving the field is the save. A
     control with only `onChange` makes every character a round trip. */
  onCommit?: (v: string) => void;
  type?: string;
  placeholder?: string;
  readOnly?: boolean;
  invalid?: boolean;
  list?: string;
  trailing?: ReactNode;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
  style?: CSSProperties;
};

export function TextInput({
  value, onChange, onCommit, type = 'text', placeholder, readOnly, invalid, list, trailing, onKeyDown, style,
}: InputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{
      ...shellStyle(invalid ? 'error' : 'rest', focused),
      height: 32,
      background: readOnly ? 'var(--surface-sunken)' : 'var(--surface)',
      ...style,
    }}>
      <input
        type={type} value={value} placeholder={placeholder} readOnly={readOnly} list={list}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={(e) => { setFocused(false); onCommit?.(e.target.value); }}
        style={{ ...CONTROL, color: readOnly ? 'var(--text-muted)' : 'var(--text)' }}
      />
      {trailing && (
        <span style={{ display: 'flex', alignItems: 'center', paddingRight: 10, color: 'var(--text-subtle)' }}>
          {trailing}
        </span>
      )}
    </div>
  );
}

export function TextArea({ value, onChange, onCommit, placeholder, rows = 3, invalid }: {
  value: string; onChange: (v: string) => void; onCommit?: (v: string) => void;
  placeholder?: string; rows?: number; invalid?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ ...shellStyle(invalid ? 'error' : 'rest', focused), display: 'block' }}>
      <textarea
        value={value} placeholder={placeholder} rows={rows}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => { setFocused(false); onCommit?.(e.target.value); }}
        style={{
          width: '100%', padding: '9px 10px', background: 'transparent', border: 0, outline: 0,
          resize: 'vertical', fontFamily: 'var(--inter)', fontSize: 13, color: 'var(--text)',
          letterSpacing: '-0.01em', lineHeight: 1.5, display: 'block',
        }}
      />
    </div>
  );
}

/** The chevron is drawn here rather than left to the platform, because the native one ignores the theme. */
export function Select({ value, onChange, children, invalid }: {
  value: string; onChange: (v: string) => void; children: ReactNode; invalid?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ ...shellStyle(invalid ? 'error' : 'rest', focused), height: 32, position: 'relative' }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          ...CONTROL, appearance: 'none', paddingRight: 28, cursor: 'pointer',
        }}
      >{children}</select>
      <span style={{
        position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)',
        pointerEvents: 'none', color: 'var(--text-subtle)', fontSize: 10, lineHeight: 1,
      }}>&#9662;</span>
    </div>
  );
}

/**
 * A choice with room to explain itself. Used where the options carry
 * consequences a one word label cannot: who can see a meeting, what
 * happens to an account.
 */
export function OptionCard({ selected, onSelect, icon, title, description }: {
  selected: boolean; onSelect: () => void; icon?: ReactNode; title: string; description?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: 'flex', gap: 11, alignItems: 'flex-start', width: '100%', textAlign: 'left',
        padding: '13px 15px', cursor: 'pointer',
        background: selected ? 'var(--surface-sunken)' : 'var(--surface)',
        border: `${selected ? 1.5 : 1}px solid ${selected ? 'var(--primary)' : 'var(--border-strong)'}`,
        borderRadius: 'var(--r)',
        transition: `border-color 120ms ${EASE}, background 120ms ${EASE}`,
      }}
    >
      {icon && (
        <span style={{ color: selected ? 'var(--primary)' : 'var(--text-subtle)', display: 'flex', marginTop: 1 }}>
          {icon}
        </span>
      )}
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>{title}</span>
        {description && (
          <span style={{ fontSize: 12, color: 'var(--text-subtle)', lineHeight: 1.45 }}>{description}</span>
        )}
      </span>
    </button>
  );
}

/** Two or three mutually exclusive options that fit in a word each. */
export function Segmented<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[];
}) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', width: '100%',
      border: '1px solid var(--border-strong)', borderRadius: 'var(--r)',
      background: 'var(--surface)', overflow: 'hidden',
    }}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value} type="button" onClick={() => onChange(o.value)}
            style={{
              flex: 1, height: 30, border: 'none', cursor: 'pointer',
              borderLeft: i === 0 ? 'none' : '1px solid var(--border)',
              background: on ? 'var(--primary)' : 'transparent',
              color: on ? 'var(--primary-fg)' : 'var(--text-muted)',
              fontFamily: 'var(--inter)', fontSize: 13, fontWeight: on ? 600 : 500,
              letterSpacing: '-0.01em',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              transition: `background 120ms ${EASE}`,
            }}
          >{o.label}</button>
        );
      })}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, hint }: {
  checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode;
}) {
  return (
    <label style={{ display: 'flex', alignItems: hint ? 'flex-start' : 'center', gap: 9, cursor: 'pointer', padding: '5px 0' }}>
      <input
        type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        style={{ width: 15, height: 15, accentColor: 'var(--primary)', cursor: 'pointer', flexShrink: 0, marginTop: hint ? 1 : 0 }}
      />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 13, color: 'var(--text)', letterSpacing: '-0.01em' }}>{label}</span>
        {hint && <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>{hint}</span>}
      </span>
    </label>
  );
}

/**
 * A dialog, for the times somebody genuinely has to decide before
 * carrying on. Anything that does not meet that bar belongs in a drawer
 * or an inline panel, which is the kit's rule and a good one.
 *
 * Escape closes it and the backdrop closes it, because a modal with no
 * visible way out is the single most common way this pattern goes wrong.
 */
export function Modal({ title, description, onClose, footer, width = 520, children }: {
  title: string;
  description?: string;
  onClose?: () => void;
  footer?: ReactNode;
  width?: number;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="kit"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(9, 22, 58, 0.46)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        overflowY: 'auto',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: width, margin: 'auto',
          background: 'var(--surface-raised)', border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-4)', overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: 14, padding: '18px 20px 0',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
            <span style={{
              fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 18,
              letterSpacing: '-0.025em', color: 'var(--text)',
            }}>{title}</span>
            {description && (
              <span style={{ fontSize: 12.5, color: 'var(--text-subtle)', lineHeight: 1.5 }}>{description}</span>
            )}
          </div>
          {onClose && (
            <button onClick={onClose} aria-label="Close" style={{
              border: 'none', background: 'transparent', color: 'var(--text-subtle)',
              cursor: 'pointer', display: 'flex', padding: 2, marginTop: 2,
            }}>
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          )}
        </div>

        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {children}
        </div>

        {footer && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 9,
            padding: '13px 20px', background: 'var(--bg-subtle)', borderTop: '1px solid var(--border)',
            flexWrap: 'wrap',
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* =============================================================
   The right drawer, from `reference/05-feedback.html`.

   The same shape as `Modal` and for the same reason: a record opened
   over a table is one component, not a `.drawer-bg` in one file and a
   `.drawer` in another. Elevation carries it, because a drawer
   genuinely floats, and it still takes a hairline so its edge reads on
   the dark ground.
   ============================================================= */
export function Drawer({
  eyebrow, title, icon, onClose, backdropProps, hint, footer, bodyRef, width = 660, children,
}: {
  eyebrow?: string;
  title: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  /** From `useDismissGuard`, so a clipped click does not lose the record. */
  backdropProps?: Record<string, unknown>;
  hint?: ReactNode;
  footer?: ReactNode;
  /* So a caller can scroll the body to the field somebody right clicked.
     The scrolling element is in here, not in the caller. */
  bodyRef?: React.RefObject<HTMLDivElement>;
  width?: number;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="kit"
      {...backdropProps}
      style={{
        position: 'fixed', inset: 0, zIndex: 900,
        background: 'rgba(5, 13, 38, 0.5)',
        display: 'flex', justifyContent: 'flex-end',
      }}
    >
      {hint}
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: width, height: '100%',
          display: 'flex', flexDirection: 'column',
          background: 'var(--surface)', borderLeft: '1px solid var(--border)',
          boxShadow: 'var(--shadow-4)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 13,
          padding: '14px 18px', borderBottom: '1px solid var(--border)',
          background: 'var(--surface)', flex: 'none',
        }}>
          {icon && (
            <span style={{
              width: 36, height: 36, borderRadius: 'var(--r)', flex: 'none',
              background: 'var(--bg-subtle)', color: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{icon}</span>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            {eyebrow && (
              <div style={{
                fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 11,
                letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-subtle)',
              }}>{eyebrow}</div>
            )}
            <h2 style={{
              margin: eyebrow ? '2px 0 0' : 0, fontFamily: 'var(--panton)', fontWeight: 800,
              fontSize: 18, letterSpacing: '-0.025em', color: 'var(--text)', lineHeight: 1.25,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{title}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            border: 'none', background: 'transparent', color: 'var(--text-subtle)',
            cursor: 'pointer', display: 'flex', padding: 4,
          }}>
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* `kit-drawer-body` stops the panels inside from being shrunk to
            fit. Without it this scrolls in theory and crops in practice.
            See the note above the rule in globals.css. */}
        <div ref={bodyRef} className="kit-drawer-body" style={{
          flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain',
          padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14,
        }}>{children}</div>

        {footer && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap',
            padding: '12px 18px', borderTop: '1px solid var(--border)',
            background: 'var(--bg-subtle)', flex: 'none',
          }}>{footer}</div>
        )}
      </div>
    </div>
  );
}

/** Fields side by side, collapsing to one column when there is no room. */
export function Split({ cols = 2, children }: { cols?: 2 | 3; children: ReactNode }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(auto-fit, minmax(${cols === 3 ? 150 : 190}px, 1fr))`,
      gap: 12,
    }}>{children}</div>
  );
}
