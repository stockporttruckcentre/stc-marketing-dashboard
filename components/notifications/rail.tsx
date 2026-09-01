'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { useFeed } from '@/components/notifications/provider';
import { NotificationPanel } from '@/components/notifications/panel';

/* =============================================================
   The block at the foot of the sidebar.

   The bell is a good target for somebody already looking for it. This
   is for everybody else: it sits next to the person's own name, it is
   the loudest thing in the sidebar, and it says how much is waiting in
   words rather than making somebody decode a number on an icon in the
   opposite corner.

   ---- Three states, three sentences ----

     nothing         Nothing waiting / Invitations land here
     some, none urgent   4 waiting on you / None of it is urgent
     something urgent    4 waiting on you / 2 need you now

   The empty state teaches what the thing is for, which is the one job
   an empty state has. The middle one tells somebody they can finish
   what they are doing. Only the third gets the dot, because a dot on
   all three is a dot that says nothing.

   ---- Where it sits ----

   Between the foot section and the user footer, on purpose. It is
   shouting at one person and it belongs next to that person's name.

   ---- No backdrop ----

   The panel opens beside the sidebar and the page behind stays visible
   and usable. Closing is a document listener rather than a full screen
   element: nothing is covered, and nothing underneath stops working
   while it is open.
   ============================================================= */

export function NotificationRail() {
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

  const waiting = counts.personal + counts.team;
  const now = counts.waiting;

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <button
        className={`nc-rail${now > 0 ? ' is-now' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={waiting === 0
          ? 'Notifications, nothing waiting'
          : `Notifications, ${waiting} waiting on you`}
      >
        <Bell size={15} />
        <span className="nc-rail__text">
          <span className="nc-rail__n">
            {waiting === 0 ? 'Nothing waiting' : `${waiting} waiting on you`}
          </span>
          <span className="nc-rail__sub">
            {now > 0
              ? `${now} ${now === 1 ? 'needs' : 'need'} you now`
              : waiting > 0 ? 'None of it is urgent' : 'Invitations land here'}
          </span>
        </span>
        {now > 0 && <span className="nc-rail__dot" aria-hidden="true" />}
      </button>

      {open && (
        <NotificationPanel
          onClose={() => setOpen(false)}
          /* Beside the sidebar and pinned to the bottom, so it opens
             upwards into the space above rather than off the foot of
             the window. */
          style={{
            position: 'absolute', bottom: 4, left: 'calc(100% + 8px)', zIndex: 1000,
          }}
        />
      )}
    </div>
  );
}
