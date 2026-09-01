'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { useFeed } from '@/components/notifications/provider';
import { NotificationPanel } from '@/components/notifications/panel';

/* =============================================================
   The bell in the top bar.

   Nothing but the button and the count. The panel it opens is shared
   with the block at the foot of the sidebar, and the number on it comes
   from the same reading, so the two cannot say different things.

   ---- The count, not a plain dot ----

   Three things and forty things are different mornings and a dot says
   neither. The badge takes the red only when something is actually
   waiting on somebody: an invitation nobody has answered, a commission
   nobody has confirmed. Everything else counts in navy.

   A red dot for "four things happened" and a red dot for "two people
   need an answer from you" cannot be the same red dot, or within a week
   neither means anything.

   ---- No backdrop ----

   The panel floats and the page behind it stays visible and usable.
   Closing is a document listener rather than a full screen element, so
   nothing is covered and nothing underneath stops working while it is
   open.
   ============================================================= */

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const { counts } = useFeed();

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const waiting = counts.waiting;
  const unread = counts.personal + counts.team;

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <button
        className="btn btn--icon nc-bell"
        title={unread === 0 ? 'Nothing waiting' : `${unread} unread`}
        aria-label={unread === 0 ? 'Notifications, nothing waiting' : `Notifications, ${unread} unread`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={14} />
        {unread > 0 && (
          <span className={`nc-bell__n${waiting > 0 ? ' is-now' : ''}`}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <NotificationPanel
          onClose={() => setOpen(false)}
          style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 1000 }}
        />
      )}
    </div>
  );
}
