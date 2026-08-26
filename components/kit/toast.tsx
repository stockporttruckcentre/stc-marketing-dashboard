'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, Check, Info, Loader, X } from 'lucide-react';
import type { Tone } from '@/components/kit/primitives';

/* =============================================================
   Toasts.

   Recreated from `design-system/reference/05-feedback.html`, which is
   specific about all three of the things that make them work:

     bottom right, stacked
     gone after five seconds on their own
     never for anything somebody has to act on

   That last one is the rule doing the real work, and it is why a
   notification never becomes a toast. A notification is a thing waiting
   on you and it has to survive being ignored. A toast is the
   application confirming what just happened, and it disappearing is
   correct.

   The one exception the kit names: something destructive that can
   genuinely be undone gets an Undo toast rather than a confirmation
   dialog beforehand. So a toast may carry exactly one action, and it
   holds itself open for longer when it does.
   ============================================================= */

export type ToastTone = Extract<Tone, 'success' | 'danger' | 'warning' | 'info' | 'neutral'>;

export type Toast = {
  id: string;
  tone: ToastTone;
  title: string;
  body?: string;
  /** The Undo case, and the only reason a toast may be interactive. */
  action?: { label: string; onClick: () => void };
  /** Something in flight. Shows a spinner and never self dismisses. */
  pending?: boolean;
  /** Milliseconds. Zero holds it open until somebody closes it. */
  after?: number;
};

const TONE_FG: Record<ToastTone, string> = {
  success: 'var(--success)', danger: 'var(--danger)', warning: 'var(--warning)',
  info: 'var(--info)', neutral: 'var(--text-muted)',
};

const ICON: Record<ToastTone, typeof Check> = {
  success: Check, danger: AlertTriangle, warning: AlertTriangle,
  info: Info, neutral: Info,
};

type Say = (t: Omit<Toast, 'id'>) => string;

const ToastBus = createContext<{ say: Say; hush: (id: string) => void } | null>(null);

/**
 * Wrap once, high up. Everything below can say something without
 * threading a callback through six components.
 */
export function Toasts({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const seq = useRef(0);

  const hush = useCallback((id: string) => {
    setStack((s) => s.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) { clearTimeout(timer); timers.current.delete(id); }
  }, []);

  const say = useCallback<Say>((t) => {
    seq.current += 1;
    const id = `t${seq.current}`;
    setStack((s) => [...s, { ...t, id }]);

    /* Five seconds, or eight when there is something to click, because
       five is not long enough to read a sentence and decide to undo it.
       Nothing at all while something is still in flight. */
    const after = t.pending ? 0 : t.after ?? (t.action ? 8000 : 5000);
    if (after > 0) {
      timers.current.set(id, setTimeout(() => hush(id), after));
    }
    return id;
  }, [hush]);

  useEffect(() => {
    const running = timers.current;
    return () => { running.forEach(clearTimeout); running.clear(); };
  }, []);

  const bus = useMemo(() => ({ say, hush }), [say, hush]);

  return (
    <ToastBus.Provider value={bus}>
      {children}
      <ToastStack stack={stack} onClose={hush} />
    </ToastBus.Provider>
  );
}

/**
 * Say something.
 *
 * Returns a no-op outside a provider rather than throwing. A missing
 * provider should cost a confirmation message, not a white screen.
 */
export function useToast(): { say: Say; hush: (id: string) => void } {
  const bus = useContext(ToastBus);
  return bus ?? { say: () => '', hush: () => {} };
}

function ToastStack({ stack, onClose }: { stack: Toast[]; onClose: (id: string) => void }) {
  if (stack.length === 0) return null;

  return (
    <div
      className="kit"
      aria-live="polite"
      style={{
        position: 'fixed', right: 18, bottom: 18, zIndex: 1200,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10,
        pointerEvents: 'none',
      }}
    >
      {/* Oldest at the top, so a new one appears nearest the corner and
          the ones above it do not jump. */}
      {stack.map((t) => (
        <ToastCard key={t.id} toast={t} onClose={() => onClose(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const Icon = toast.pending ? Loader : ICON[toast.tone];

  return (
    <div
      role="status"
      style={{
        width: 330, maxWidth: 'calc(100vw - 36px)', pointerEvents: 'auto',
        display: 'flex', gap: 11, padding: '12px 13px',
        background: 'var(--surface-raised)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${TONE_FG[toast.tone]}`,
        borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-3)',
      }}
    >
      <span style={{ flex: 'none', color: TONE_FG[toast.tone], marginTop: 1 }}>
        <Icon size={16} className={toast.pending ? 'spin' : undefined} />
      </span>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{toast.title}</span>
        {toast.body && (
          <span style={{ fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.45 }}>
            {toast.body}
          </span>
        )}
        {toast.action && (
          <button
            onClick={() => { toast.action?.onClick(); onClose(); }}
            style={{
              alignSelf: 'flex-start', marginTop: 5, padding: 0, border: 'none',
              background: 'transparent', cursor: 'pointer',
              fontFamily: 'var(--inter)', fontSize: 11.5, fontWeight: 600,
              color: 'var(--accent)',
            }}
          >{toast.action.label}</button>
        )}
      </div>

      <button
        onClick={onClose}
        aria-label="Dismiss"
        style={{
          flex: 'none', border: 'none', background: 'transparent',
          color: 'var(--text-subtle)', cursor: 'pointer', padding: 0, height: 16,
        }}
      ><X size={14} /></button>
    </div>
  );
}
