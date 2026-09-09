'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Analytics, Filters } from '@/lib/analytics/types';

/* =============================================================
   The analytics engine, shared by the landing and every drill-down.

   From the business:

     Preserve the existing analytics data engine wherever possible ...
     Landing = decision surface. Drill-down = investigation surface.
     Preserve the engine. Reorganise the experience.

   So this is the hub's own state, moved out of it unchanged rather
   than rewritten: the same filters, the same POST to /api/analytics,
   the same numbered request guard. Six screens now ask the same
   question, and a second implementation of the window would be a
   second answer to it.

   ---- The numbered request ----

   Kept verbatim from the hub. Three chips changed quickly is three
   requests, and without the number the page shows whichever server
   answered last rather than whichever was asked last.
   ============================================================= */

export type AnalyticsState = {
  f: Filters;
  set: (patch: Partial<Filters>) => void;
  data: (Analytics & { bands?: unknown[] }) | null;
  busy: boolean;
  failed: string | null;
  reload: () => void;
};

export function useAnalytics(today: string): AnalyticsState {
  const [f, setF] = useState<Filters>({
    kind: 'month',
    from: `${today.slice(0, 7)}-01`,
    to: today,
    mode: 'previous',
    trim: true,
    divisions: [],
    person: null,
  });

  const [data, setData] = useState<(Analytics & { bands?: unknown[] }) | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const runNo = useRef(0);

  const load = useCallback(async (filters: Filters) => {
    const mine = ++runNo.current;
    setBusy(true);
    setFailed(null);
    try {
      const res = await fetch('/api/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...filters, today }),
      });
      const body = await res.json();
      if (mine !== runNo.current) return;
      if (!res.ok) { setFailed(body?.error ?? 'The figures could not be read.'); setData(null); return; }
      setData(body);
    } catch {
      if (mine !== runNo.current) return;
      setFailed('The figures could not be reached. Check the connection and try again.');
    } finally {
      if (mine === runNo.current) setBusy(false);
    }
  }, [today]);

  useEffect(() => { load(f); }, [f, load]);

  return {
    f,
    set: (patch) => setF((was) => ({ ...was, ...patch })),
    data,
    busy,
    failed,
    reload: () => load(f),
  };
}
