'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/* =============================================================
   Click again to close.

   A record drawer covers most of the screen, and the shaded area beside
   it is a very easy thing to hit on the way to something else. Closing
   on the first click means a stray one throws away where you were, and
   on a half filled note it throws away the note.

   So the first click on the shade arms it and says so at the cursor. The
   second closes. Escape still closes on the first press, because that is
   a deliberate keystroke rather than a slip.

   The prompt appears where the pointer is rather than in a corner,
   because the whole point is that the eye is already there. It follows
   the pointer while armed, so it cannot be lost behind the cursor.

   Disarms after a few seconds, and on leaving the shaded area, so a
   drawer never sits in a state where one unrelated click later would
   shut it.
   ============================================================= */

const ARMED_FOR = 2600;

export function useDismissGuard(onClose: () => void, enabled = true) {
  const [armed, setArmed] = useState(false);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const disarm = useCallback(() => {
    setArmed(false);
    setAt(null);
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Escape is deliberate, so it closes straight away.
  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      disarm();
      onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, onClose, disarm]);

  const onBackdropClick = useCallback((e: React.MouseEvent) => {
    // Only the shade itself. Relying on every panel inside to stop
    // propagation works until one of them forgets, and then a click on a
    // field closes the record.
    if (e.target !== e.currentTarget) return;
    if (!enabled) { onClose(); return; }
    if (armed) { disarm(); onClose(); return; }
    setArmed(true);
    setAt({ x: e.clientX, y: e.clientY });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { setArmed(false); setAt(null); }, ARMED_FOR);
  }, [enabled, armed, onClose, disarm]);

  const onBackdropMove = useCallback((e: React.MouseEvent) => {
    // Same rule, or the prompt follows the pointer up onto the drawer it
    // is offering to close.
    if (e.target !== e.currentTarget) return;
    if (armed) setAt({ x: e.clientX, y: e.clientY });
  }, [armed]);

  /** Spread onto the shaded element. */
  const backdropProps = {
    onClick: onBackdropClick,
    onMouseMove: onBackdropMove,
    onMouseLeave: disarm,
  };

  /** Render inside the backdrop. Nothing while unarmed. */
  const hint = armed && at ? <DismissHint x={at.x} y={at.y} /> : null;

  return { backdropProps, hint, armed, disarm };
}

function DismissHint({ x, y }: { x: number; y: number }) {
  return (
    <div
      aria-live="polite"
      style={{
        position: 'fixed',
        // Below and right of the pointer, which is where a cursor label
        // sits everywhere else. Flipped near an edge so it stays on
        // screen rather than being clipped.
        left: Math.min(x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 170),
        top: Math.min(y + 16, (typeof window !== 'undefined' ? window.innerHeight : 800) - 44),
        zIndex: 2000,
        pointerEvents: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        height: 28,
        padding: '0 11px',
        borderRadius: 'var(--r)',
        background: 'var(--surface-raised, #1E2F63)',
        border: '1px solid var(--border-strong, #2B3F78)',
        boxShadow: 'var(--shadow-3, 0 8px 20px rgba(0,0,0,.45))',
        color: 'var(--text, #fff)',
        fontFamily: 'var(--inter)',
        fontSize: 12.5,
        fontWeight: 600,
        letterSpacing: '-0.01em',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: 999,
        background: 'var(--accent, #E03B2E)', flexShrink: 0,
      }} />
      Click again to close
    </div>
  );
}
