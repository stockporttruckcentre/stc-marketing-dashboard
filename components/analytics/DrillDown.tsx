'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { ControlBar, Waiting } from '@/components/AnalyticsHub';
import { useAnalytics } from '@/lib/analytics/use-analytics';
import type { Analytics, Filters } from '@/lib/analytics/types';

/* =============================================================
   The shell every drill-down wears.

   From the business:

     Landing = decision surface. Drill-down = investigation surface.
     ...
     Each drill-down must provide a clear route back to Analytics.

   One shell, so six investigation screens share the period controls,
   the part-period guard and the way back. The controls are the hub's
   own, not a second copy: a drill-down showing a different September
   from the landing is the fault this whole restructure is meant to
   avoid.

   The page fetches on mount like the landing does, so a drill-down
   opened directly from the command bar is a complete screen rather
   than an empty one waiting for a parent.
   ============================================================= */
export function DrillDown({ title, says, today, children }: {
  title: string;
  /** One line saying what this screen is for. */
  says: string;
  today: string;
  children: (state: {
    data: Analytics & { bands?: unknown[] };
    f: Filters;
    set: (p: Partial<Filters>) => void;
  }) => ReactNode;
}) {
  const { f, set, data, busy, failed, reload } = useAnalytics(today);

  return (
    <div className="kit kit-page" style={{
      display: 'flex', flexDirection: 'column', gap: 26,
      maxWidth: 1126, margin: '0 auto', width: '100%',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <Link
          href="/dashboard/analytics"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textDecoration: 'none',
          }}
        >
          <ArrowLeft size={13} /> Analytics
        </Link>
        <h1 style={{
          margin: 0, fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 24,
          letterSpacing: '-0.03em', color: 'var(--text)',
        }}>{title}</h1>
        <span style={{ fontSize: 13, color: 'var(--text-subtle)', flex: 1, minWidth: 240 }}>
          {says}
        </span>
      </div>

      <ControlBar
        f={f}
        set={set}
        busy={busy}
        onRefresh={reload}
        data={data}
        person={f.person ? (data?.people ?? []).find((p) => p.id === f.person)?.name ?? null : null}
      />

      {failed && (
        <div style={{
          border: '1px solid var(--danger)', borderRadius: 'var(--r-md)',
          background: 'var(--surface)', padding: '14px 16px', fontSize: 13, color: 'var(--text)',
        }}>{failed}</div>
      )}

      {!data && !failed && <Waiting />}

      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
          {children({ data, f, set })}
        </div>
      )}
    </div>
  );
}
