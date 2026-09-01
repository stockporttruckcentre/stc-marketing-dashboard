'use client';

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useNotifications } from '@/lib/notifications/client';

/* =============================================================
   One reading of the bell, shared by everything that shows it.

   There are now two ways in, the icon in the top bar and the block at
   the foot of the sidebar, and both are on screen at once. Each calling
   the hook itself would mean two pollers, two counts, and a window
   where they disagree.

   They must never disagree. The first time somebody sees a three on the
   bell and a two in the sidebar, neither number is believed again, and
   a count nobody believes is worse than no count: it is the same
   ignoring, arrived at by more work.

   So the reading happens once, here, and both draw from it.
   ============================================================= */

type Feed = ReturnType<typeof useNotifications>;

const FeedContext = createContext<Feed | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const feed = useNotifications('all');
  return <FeedContext.Provider value={feed}>{children}</FeedContext.Provider>;
}

/**
 * The shared feed.
 *
 * Throws outside the provider rather than returning something empty. An
 * empty feed looks exactly like a quiet morning, so a component mounted
 * in the wrong place would silently show "Nothing waiting" forever and
 * nobody would find out until they missed something.
 */
export function useFeed(): Feed {
  const feed = useContext(FeedContext);
  if (!feed) {
    throw new Error(
      'Notifications are read once, above the sidebar and the top bar. '
      + 'Wrap this in NotificationsProvider.',
    );
  }
  return feed;
}
