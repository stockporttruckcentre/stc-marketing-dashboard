'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, Settings2 } from 'lucide-react';
import { useNotifications } from '@/lib/notifications/client';
import type { NotificationAction, NotificationRow } from '@/lib/notifications/types';
import { NotificationCard } from '@/components/notifications/card';
import { Button, EmptyState, Tabs } from '@/components/kit/primitives';
import { useToast } from '@/components/kit/toast';

/* =============================================================
   The bell, and what comes out of it.

   ---- Where this sits in the kit ----

   The panel is the kit's popover: raised surface, one border, r-md,
   shadow-3, which is the one place elevation is allowed because it
   genuinely floats. Nothing else on the top bar casts a shadow.

   The count is the sidebar badge count from 04-navigation, moved onto
   the bell, and it is red only when something is actually waiting on
   somebody. A red dot for "four things happened" and a red dot for
   "two people need an answer from you" cannot be the same red dot, or
   within a week neither means anything.

   ---- Read on open, not on hover ----

   Opening the panel marks what is in it read, after a beat. Not on
   hover, because brushing past the bell is not reading, and not on
   close, because somebody who opens it and immediately opens something
   else should not come back to the same red four.

   What it does NOT do is mark anything answered. Reading an invitation
   is not accepting it, so the buttons stay until they are pressed.
   ============================================================= */

export function NotificationBell() {
  const router = useRouter();
  const { say } = useToast();
  const [open, setOpen] = useState(false);
  const [which, setWhich] = useState<'personal' | 'team'>('personal');
  const wrap = useRef<HTMLDivElement>(null);

  const feed = useNotifications('all');
  const { counts, items, markRead, markAllRead, dismiss, acted, answerInvite, provisioned } = feed;

  const shown = useMemo(
    () => items.filter((n) => n.audience === which),
    [items, which],
  );

  /* Click anywhere else, or press Escape. Both, because a panel that
     only closes on one of them is a panel somebody gets stuck in. */
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

  /* A beat, so opening and closing straight away does not silently
     clear four things somebody has not looked at. */
  useEffect(() => {
    if (!open) return;
    const unread = shown.filter((n) => !n.read_at).map((n) => n.id);
    if (unread.length === 0) return;
    const t = setTimeout(() => markRead(unread), 1200);
    return () => clearTimeout(t);
  }, [open, shown, markRead]);

  const go = useCallback((n: NotificationRow) => {
    if (!n.read_at) markRead([n.id]);
    if (n.link_path) { setOpen(false); router.push(n.link_path); }
  }, [markRead, router]);

  const doAction = useCallback(async (n: NotificationRow, a: NotificationAction) => {
    if (a.does === 'open') { go(n); return; }

    if (a.does === 'done') {
      await acted(n.id, a.key);
      say({ tone: 'success', title: 'Noted', body: n.title });
      return;
    }

    if (a.does === 'download') {
      const url = (n.payload as { fileUrl?: unknown } | null)?.fileUrl;
      if (typeof url === 'string') {
        await acted(n.id, 'download');
        window.location.href = url;
      } else {
        say({ tone: 'warning', title: 'That file has gone', body: 'Run the export again.' });
      }
      return;
    }

    const done = await answerInvite(n, a);
    say(done.ok
      ? {
        tone: 'success',
        title: a.key === 'accept' ? 'You are down as coming' : 'They know you cannot make it',
        body: n.title,
      }
      : { tone: 'danger', title: 'That did not go through', body: done.message });
  }, [acted, answerInvite, go, say]);

  const waiting = counts.waiting;
  const unread = counts.personal + counts.team;

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <button
        className="btn btn--icon"
        title={unread > 0 ? `${unread} unread` : 'Notifications'}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ position: 'relative' }}
      >
        <Bell size={14} />
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -3, right: -3, minWidth: 15, height: 15,
            padding: '0 4px', borderRadius: 'var(--r-full)',
            /* Red only when something is genuinely waiting on you.
               Everything else counts in navy. */
            background: waiting > 0 ? 'var(--stc-red)' : 'var(--stc-navy, #071458)',
            color: '#fff', fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 9.5,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1, border: '1.5px solid var(--bg-2, var(--bg))',
          }}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {open && (
        <div
          className="kit"
          role="dialog"
          aria-label="Notifications"
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 1000,
            width: 400, maxWidth: 'calc(100vw - 24px)',
            display: 'flex', flexDirection: 'column',
            background: 'var(--surface-raised)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            boxShadow: 'var(--shadow-3)',
            overflow: 'hidden',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '11px 13px', borderBottom: '1px solid var(--border)',
            flex: 'none',
          }}>
            <span style={{
              fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 14,
              letterSpacing: '-0.02em', color: 'var(--text)', flex: 1,
            }}>Notifications</span>

            {shown.some((n) => !n.read_at) && (
              <button
                onClick={() => markAllRead(which)}
                title="Mark everything read"
                style={{
                  border: 'none', background: 'transparent', cursor: 'pointer',
                  color: 'var(--text-subtle)', display: 'flex', padding: 2,
                }}
              ><CheckCheck size={15} /></button>
            )}
            <button
              onClick={() => { setOpen(false); router.push('/dashboard/notifications?tab=settings'); }}
              title="What you get told"
              style={{
                border: 'none', background: 'transparent', cursor: 'pointer',
                color: 'var(--text-subtle)', display: 'flex', padding: 2,
              }}
            ><Settings2 size={15} /></button>
          </div>

          <div style={{ padding: '9px 13px 0', flex: 'none' }}>
            <Tabs
              value={which}
              onChange={setWhich}
              tabs={[
                { key: 'personal' as const, label: 'Yours', count: counts.personal },
                { key: 'team' as const, label: 'The business', count: counts.team },
              ]}
            />
          </div>

          <div style={{
            /* Tall enough to be worth opening, short enough that the
               panel never runs off the bottom of a 1080p screen at
               150 percent scaling, where the window is about 630
               tall. 52 for the top bar, 8 for the gap, and room to
               breathe underneath. */
            maxHeight: 'min(60vh, 460px)', overflowY: 'auto', overscrollBehavior: 'contain',
            flex: 1, minHeight: 0,
          }}>
            {!provisioned ? (
              <Pad>The notifications tables are not in this database yet.</Pad>
            ) : feed.loading && shown.length === 0 ? (
              <Pad>Looking.</Pad>
            ) : shown.length === 0 ? (
              <div style={{ padding: '16px 13px' }}>
                <EmptyState
                  what={which === 'personal' ? 'Nothing waiting on you' : 'Nothing from the business'}
                  why={which === 'personal'
                    ? 'Invitations, tasks and anything else that needs you turns up here.'
                    : 'Turn on what you want to hear about under the cog above.'}
                />
              </div>
            ) : (
              shown.map((n) => (
                <NotificationCard
                  key={n.id} n={n} compact
                  onAction={doAction}
                  onOpen={go}
                  onDismiss={(x) => dismiss(x.id)}
                />
              ))
            )}
          </div>

          <div style={{
            display: 'flex', gap: 8, padding: '10px 13px', flex: 'none',
            borderTop: '1px solid var(--border)', background: 'var(--bg-subtle)',
          }}>
            <Button
              size="sm" variant="secondary"
              onClick={() => { setOpen(false); router.push('/dashboard/notifications'); }}
            >Open them all</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Pad({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '22px 16px', fontSize: 12.5, color: 'var(--text-subtle)' }}>
      {children}
    </div>
  );
}
