'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  NotificationAction, NotificationCounts, NotificationRow,
} from '@/lib/notifications/types';

/* =============================================================
   Reading the bell, from a browser.

   One hook, used by the panel in the top bar and by the full screen,
   so the two cannot disagree about what is unread. They ask the same
   route and hold the same shape.

   ---- Polling, and why it is a minute ----

   There is no realtime channel wired up here and adding one for this
   would be a lot of moving parts for a red dot. A minute is well
   inside the time it takes somebody to notice a meeting invitation,
   and the route is cheap: two function calls, both indexed.

   It stops while the tab is hidden. Somebody with the CRM open in a
   background tab all afternoon should not be a request every minute
   for six hours, and the first thing that happens on coming back is a
   fetch, so nothing is stale by the time they look.
   ============================================================= */

const EVERY = 60_000;

export type Feed = {
  items: NotificationRow[];
  counts: NotificationCounts;
  loading: boolean;
  provisioned: boolean;
  error: string | null;
};

export function useNotifications(audience: 'personal' | 'team' | 'all' = 'personal') {
  const [feed, setFeed] = useState<Feed>({
    items: [], counts: { personal: 0, team: 0, waiting: 0 },
    loading: true, provisioned: true, error: null,
  });
  const live = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/notifications?audience=${audience}&limit=60`, {
        cache: 'no-store',
      });
      const json = await res.json();
      if (!live.current) return;

      if (!json.ok) {
        setFeed((f) => ({ ...f, loading: false, error: json.message ?? 'Could not read them.' }));
        return;
      }
      setFeed({
        items: json.items ?? [],
        counts: json.counts ?? { personal: 0, team: 0, waiting: 0 },
        loading: false,
        provisioned: json.provisioned !== false,
        error: null,
      });
    } catch {
      if (live.current) {
        setFeed((f) => ({ ...f, loading: false, error: 'Could not reach the server.' }));
      }
    }
  }, [audience]);

  useEffect(() => {
    live.current = true;
    refresh();

    const tick = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, EVERY);

    const onShow = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onShow);

    return () => {
      live.current = false;
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [refresh]);

  /* Every write moves the local copy first and then refreshes. Waiting
     for a round trip to cross something off makes the whole panel feel
     like it is thinking about it. */
  const post = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }, []);

  const markRead = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    setFeed((f) => ({
      ...f,
      items: f.items.map((n) => (ids.includes(n.id) && !n.read_at
        ? { ...n, read_at: new Date().toISOString() } : n)),
      counts: countUnread(f.items.map((n) => (ids.includes(n.id) && !n.read_at
        ? { ...n, read_at: new Date().toISOString() } : n))),
    }));
    await post({ do: 'read', ids });
  }, [post]);

  const markAllRead = useCallback(async (which: 'personal' | 'team' | 'all') => {
    const stamp = new Date().toISOString();
    setFeed((f) => {
      const next = f.items.map((n) => (
        (which === 'all' || n.audience === which) && !n.read_at ? { ...n, read_at: stamp } : n
      ));
      return { ...f, items: next, counts: countUnread(next) };
    });
    await post({ do: 'read_all', audience: which });
    refresh();
  }, [post, refresh]);

  const dismiss = useCallback(async (id: string) => {
    setFeed((f) => {
      const next = f.items.filter((n) => n.id !== id);
      return { ...f, items: next, counts: countUnread(next) };
    });
    await post({ do: 'dismiss', ids: [id] });
  }, [post]);

  const acted = useCallback(async (id: string, what: string) => {
    const stamp = new Date().toISOString();
    setFeed((f) => {
      const next = f.items.map((n) => (n.id === id
        ? { ...n, actioned_at: stamp, action_taken: what, read_at: n.read_at ?? stamp } : n));
      return { ...f, items: next, counts: countUnread(next) };
    });
    await post({ do: 'acted', id, what });
  }, [post]);

  /**
   * Answering a meeting invitation without leaving the bell.
   *
   * Two calls, in this order: the invitation first, because that is the
   * one that matters, and the notification only marked answered once
   * the invitation actually went through. A card that says "you said
   * you can make it" over a meeting that never heard is worse than a
   * card that still asks.
   */
  const answerInvite = useCallback(async (
    n: NotificationRow, action: NotificationAction,
  ): Promise<{ ok: boolean; message?: string }> => {
    const inviteId = (n.payload as { inviteId?: unknown } | null)?.inviteId;
    if (typeof inviteId !== 'string') {
      return { ok: false, message: 'This invitation is missing its reference. Open the diary to answer it.' };
    }

    try {
      const res = await fetch('/api/calendar/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: action.key, inviteId }),
      });
      const json = await res.json();
      if (!json.ok) return { ok: false, message: json.message ?? 'That did not go through.' };

      await acted(n.id, action.key);
      return { ok: true };
    } catch {
      return { ok: false, message: 'That did not reach the server.' };
    }
  }, [acted]);

  return { ...feed, refresh, markRead, markAllRead, dismiss, acted, answerInvite };
}

function countUnread(items: NotificationRow[]): NotificationCounts {
  let personal = 0; let team = 0; let waiting = 0;
  for (const n of items) {
    if (n.read_at) continue;
    if (n.audience === 'team') team += 1; else personal += 1;
    if (!n.actioned_at && (n.severity === 'urgent' || n.severity === 'attention')) waiting += 1;
  }
  return { personal, team, waiting };
}
