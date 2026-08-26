'use client';

/* =============================================================
   Floating menus, from `design-system/reference/04-navigation.html`.

   One shell for every one of them, so a right click on a CRM row, a
   tracker row and a stock row produce the same object rather than three
   near misses. They lived inside CrmWorkspace, which meant the other
   two tabs each grew their own, and the three drifted the moment any
   one of them was touched.

   The kit's own rule applies: a 1px border and a real elevation,
   because a menu is a thing that genuinely floats.
   ============================================================= */
import { useEffect, useRef, useState } from 'react';

// Viewport-aware positioning hook for floating menus. Returns a ref to attach to the menu.
// After mount, measures the menu and pushes it up/left if it would overflow the viewport.
export function useEdgeAwarePosition(x: number, y: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let nextLeft = x;
    let nextTop = y;
    if (x + rect.width + margin > window.innerWidth) {
      nextLeft = Math.max(margin, x - rect.width);
    }
    if (y + rect.height + margin > window.innerHeight) {
      nextTop = Math.max(margin, y - rect.height);
    }
    if (nextLeft !== pos.left || nextTop !== pos.top) {
      setPos({ left: nextLeft, top: nextTop });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);
  return { ref, pos };
}


/* =============================================================
   Floating menus.

   One shell for all of them, so a right click on a row and a right click
   on empty space produce the same object rather than two near misses.
   The kit's own rule applies: a 1px border and a real elevation, because
   this is a thing that genuinely floats.
   ============================================================= */
export function EdgeAwareCtxMenu({ x, y, width = 220, children }: {
  x: number; y: number; width?: number; children: React.ReactNode;
}) {
  const { ref, pos } = useEdgeAwarePosition(x, y);
  return (
    <div
      ref={ref}
      className="kit"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', left: pos.left, top: pos.top, zIndex: 70, width,
        background: 'var(--surface-raised)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-3)', padding: 5,
      }}
    >
      {children}
    </div>
  );
}

export function MenuHead({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '7px 9px 8px', fontFamily: 'var(--panton)', fontWeight: 700,
      fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase',
      color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>{children}</div>
  );
}

export function MenuItem({ icon, label, onClick, disabled, danger, title }: {
  icon?: React.ReactNode; label: React.ReactNode; onClick: () => void;
  disabled?: boolean; danger?: boolean; title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
        border: 'none', background: 'transparent', padding: '7px 9px',
        borderRadius: 'var(--r-sm)', fontFamily: 'var(--inter)', fontSize: 13,
        letterSpacing: '-0.01em',
        color: disabled ? 'var(--text-subtle)' : danger ? 'var(--danger)' : 'var(--text)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'var(--surface-sunken)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {icon && <span style={{ display: 'flex', flexShrink: 0, color: 'currentColor', opacity: 0.75 }}>{icon}</span>}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </button>
  );
}

export function MenuRule() {
  return <div style={{ height: 1, background: 'var(--border)', margin: '5px 0' }} />;
}
