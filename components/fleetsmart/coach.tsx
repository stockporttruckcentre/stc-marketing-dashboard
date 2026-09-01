'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';

/* =============================================================
   The message that arrives with each step.

   From the business:

     I'd like a lenis smooth animation style popup when you first begin
     creating a new fleetsmart+ contract that shows a central message
     saying select your customer and enter their details, then you click
     next and the central animation message comes up telling you to now
     select which plan they are on.

   ---- What "lenis smooth" means here, and what it does not ----

   Lenis is a scroll library and there is no scrolling to smooth in a
   drawer. What it is known for is the feel: a long, heavily eased
   settle rather than a bounce, and nothing arriving at a constant
   speed. That is the part worth copying, and it is one cubic bezier and
   two transforms.

   No library. Lenis is 30KB to animate one card that appears six times,
   and the CSS that does this is fourteen lines.

   ---- It never blocks the work ----

   The card sits over the step, fades its own backdrop in, and goes on
   the first click, on Escape, or after eight seconds. It is a signpost,
   not a dialog: somebody on their fortieth contract clicks straight
   through and never reads one, and that has to cost them nothing.

   Once per step per contract. Coming back to Fleet to add a trailer
   does not replay the message about adding a fleet.

   ---- prefers-reduced-motion ----

   Honoured, and honoured properly: the card still appears and still
   says the same thing, it simply arrives without the travel. Somebody
   who turns motion off is asking for less movement, not less help.
   ============================================================= */

/** Lenis's own default easing, which is what gives it the long settle. */
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

const HOLD_MS = 8000;

export function StepCoach({
  step,
  title,
  body,
  missing,
  onNext,
  onDismiss,
}: {
  /** Changing this is what replays the card. */
  step: string;
  title: string;
  body: string;
  /** What still has to be done before Next will work, if anything. */
  missing: string | null;
  /** Null on the last step, where there is nowhere to go next. */
  onNext: (() => void) | null;
  onDismiss: () => void;
}) {
  /* Mounted, then shown one frame later, so the browser has a start
     state to animate away from. Setting both in one pass gives no
     transition at all, which is the commonest way this effect silently
     does nothing. */
  const [shown, setShown] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    timer.current = setTimeout(() => close(), HOLD_MS);
    return () => {
      cancelAnimationFrame(frame);
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    };
    /* Capture, so this runs before the Drawer's own Escape handler and
       closing the card does not close the whole builder. */
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function close() {
    if (timer.current) clearTimeout(timer.current);
    setLeaving(true);
    /* Let it play out. Matches the transition below, so the card is
       gone from the tree only once it has finished leaving. */
    setTimeout(onDismiss, 260);
  }

  const visible = shown && !leaving;

  return (
    <div
      onClick={close}
      style={{
        position: 'absolute', inset: 0, zIndex: 40,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
        background: visible ? 'rgba(5, 13, 38, 0.42)' : 'rgba(5, 13, 38, 0)',
        backdropFilter: visible ? 'blur(2px)' : 'blur(0px)',
        transition: `background 420ms ${EASE}, backdrop-filter 420ms ${EASE}`,
        cursor: 'pointer',
      }}
    >
      <div
        className="fs-coach"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 460,
          background: 'var(--surface-raised)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--r-md)',
          boxShadow: 'var(--shadow-3)',
          padding: '22px 24px 20px',
          cursor: 'default',
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0) scale(1)' : 'translateY(18px) scale(0.985)',
          transition: `opacity 460ms ${EASE}, transform 620ms ${EASE}`,
        }}
      >
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 11,
          letterSpacing: '0.12em', textTransform: 'uppercase',
          color: 'var(--text-subtle)',
        }}>
          FleetSmart+
        </span>

        <h3 style={{
          margin: '8px 0 0', fontFamily: 'var(--panton)', fontWeight: 800,
          fontSize: 21, lineHeight: 1.2, letterSpacing: '-0.015em',
          color: 'var(--text)', textWrap: 'balance',
        }}>{title}</h3>

        <p style={{
          margin: '9px 0 0', fontFamily: 'var(--inter)', fontSize: 13,
          lineHeight: 1.55, color: 'var(--text-muted)',
        }}>{body}</p>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginTop: 18,
        }}>
          <button
            onClick={close}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              height: 34, padding: '0 16px', border: 0, cursor: 'pointer',
              borderRadius: 'var(--r)', background: 'var(--accent)', color: '#fff',
              fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 13,
            }}
          >
            <Check size={14} /> Got it
          </button>

          {onNext && !missing && (
            <button
              onClick={() => { close(); setTimeout(onNext, 60); }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                height: 34, padding: '0 13px', cursor: 'pointer',
                borderRadius: 'var(--r)', background: 'transparent',
                border: '1px solid var(--border-strong)', color: 'var(--text-muted)',
                fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 13,
              }}
            >
              Skip ahead <ArrowRight size={13} />
            </button>
          )}

          <span style={{ flex: 1 }} />

          {missing && (
            <span style={{
              fontFamily: 'var(--inter)', fontSize: 11.5, color: 'var(--text-subtle)',
              textAlign: 'right', maxWidth: 190,
            }}>{missing}</span>
          )}
        </div>
      </div>

      <style>{`
        @media (prefers-reduced-motion: reduce) {
          .fs-coach { transition: opacity 120ms linear !important; transform: none !important; }
        }
      `}</style>
    </div>
  );
}
