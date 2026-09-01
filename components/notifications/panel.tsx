'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, Settings2, X } from 'lucide-react';
import type { NotificationAction, NotificationRow } from '@/lib/notifications/types';
import { NotificationCard } from '@/components/notifications/card';
import { KeptExports } from '@/components/notifications/exports';
import { useFeed } from '@/components/notifications/provider';
import { Button, EmptyState, Tabs } from '@/components/kit/primitives';
import { useToast } from '@/components/kit/toast';

/* =============================================================
   What comes out of the bell, and out of the block in the sidebar.

   One panel, two ways in. It used to live inside the bell component,
   which was fine while the bell was the only entrance and wrong the
   moment the sidebar grew one: two copies of this would have drifted
   the first time either grew a tab.

   ---- Where it sits in the kit ----

   The kit's popover: raised surface, one border, r-md, shadow-3, which
   is the one place elevation is allowed because it genuinely floats.
   Nothing else on the top bar or in the sidebar casts a shadow.

   ---- Read on open, after a beat ----

   Opening it marks what is in it read, 1.2 seconds later. Not
   immediately, so opening and closing straight away does not silently
   clear four things nobody looked at. Not on hover, because brushing
   past is not reading.

   What it never does is mark anything answered. Reading an invitation
   is not accepting it, so the buttons stay until they are pressed.
   ============================================================= */

export type PanelTab = 'personal' | 'team' | 'exports';

export function NotificationPanel({
  onClose, style,
}: {
  onClose: () => void;
  /** Where it floats. The bell hangs it under the icon, the rail puts
      it beside the sidebar. Everything else about it is the same. */
  style: React.CSSProperties;
}) {
  const router = useRouter();
  const { say } = useToast();
  const [which, setWhich] = useState<PanelTab>('personal');

  const feed = useFeed();
  const {
    counts, items, loading, provisioned,
    markRead, markAllRead, dismiss, acted, answerInvite,
  } = feed;

  const shown = useMemo(
    () => (which === 'exports' ? [] : items.filter((n) => n.audience === which)),
    [items, which],
  );

  useEffect(() => {
    const unread = shown.filter((n) => !n.read_at).map((n) => n.id);
    if (unread.length === 0) return;
    const t = setTimeout(() => markRead(unread), 1200);
    return () => clearTimeout(t);
  }, [shown, markRead]);

  const go = useCallback((n: NotificationRow) => {
    if (!n.read_at) markRead([n.id]);
    if (n.link_path) { onClose(); router.push(n.link_path); }
  }, [markRead, onClose, router]);

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

  return (
    <div
      className="kit"
      role="dialog"
      aria-label="Notifications"
      onClick={(e) => e.stopPropagation()}
      style={{
        width: 400, maxWidth: 'calc(100vw - 24px)',
        display: 'flex', flexDirection: 'column',
        background: 'var(--surface-raised)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)',
        boxShadow: 'var(--shadow-3)',
        overflow: 'hidden',
        ...style,
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '11px 13px', borderBottom: '1px solid var(--border)', flex: 'none',
      }}>
        <span style={{
          fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 14,
          letterSpacing: '-0.02em', color: 'var(--text)', flex: 1,
        }}>Notifications</span>

        {which !== 'exports' && shown.some((n) => !n.read_at) && (
          <IconLink title="Mark everything read" onClick={() => markAllRead(which)}>
            <CheckCheck size={15} />
          </IconLink>
        )}
        <IconLink
          title="What you get told"
          onClick={() => { onClose(); router.push('/dashboard/settings?tab=notifications'); }}
        ><Settings2 size={15} /></IconLink>
        <IconLink title="Close" onClick={onClose}><X size={15} /></IconLink>
      </div>

      <div style={{ padding: '9px 13px 0', flex: 'none' }}>
        <Tabs
          value={which}
          onChange={setWhich}
          /* Exports get their own tab rather than a card in the list.
             Announced once and then buried under a fortnight of meeting
             invitations, a kept export is one nobody can find again,
             which defeats the point of keeping it. */
          tabs={[
            { key: 'personal' as const, label: 'Yours', count: counts.personal },
            { key: 'team' as const, label: 'The business', count: counts.team },
            { key: 'exports' as const, label: 'Exports' },
          ]}
        />
      </div>

      <div style={{
        /* Tall enough to be worth opening, short enough that it never
           runs off a 1080p screen at 150 percent scaling, where the
           window is about 630 tall. */
        maxHeight: 'min(60vh, 460px)', overflowY: 'auto', overscrollBehavior: 'contain',
        flex: 1, minHeight: 0,
      }}>
        {which === 'exports' ? (
          <KeptExports />
        ) : !provisioned ? (
          <Pad>The notifications tables are not in this database yet.</Pad>
        ) : loading && shown.length === 0 ? (
          <Pad>Looking.</Pad>
        ) : shown.length === 0 ? (
          <div style={{ padding: '16px 13px' }}>
            <EmptyState
              what={which === 'personal' ? 'Nothing waiting on you' : 'Nothing from the business'}
              why={which === 'personal'
                ? 'Meeting invitations, tasks put on you, commission to confirm and contracts coming up for renewal all arrive here.'
                : 'Deals landing, contracts signed and monthly figures. All off by default: turn on what you want under the cog above.'}
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
        display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px', flex: 'none',
        borderTop: '1px solid var(--border)', background: 'var(--bg-subtle)',
      }}>
        <span style={{ fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.45 }}>
          {which === 'exports'
            ? 'Every export you still have a copy of.'
            : 'Answering something here answers it everywhere. Nothing in this list is a copy.'}
        </span>
      </div>
    </div>
  );
}

function IconLink({
  title, onClick, children,
}: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        border: 'none', background: 'transparent', cursor: 'pointer',
        color: 'var(--text-subtle)', display: 'flex', padding: 2,
      }}
    >{children}</button>
  );
}

function Pad({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '22px 16px', fontSize: 12.5, color: 'var(--text-subtle)' }}>
      {children}
    </div>
  );
}

/** The bell's own glyph, so the rail and the bar draw the same one. */
export { Bell as NotificationGlyph };
