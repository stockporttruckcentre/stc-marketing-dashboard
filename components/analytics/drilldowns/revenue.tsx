'use client';

import { DrillDown } from '@/components/analytics/DrillDown';
import { Divisions } from '@/components/analytics/sections';

/* Revenue. The devices are the hub's own, moved rather than rebuilt. */
export function RevenueDrillDown({ today }: { today: string }) {
  return (
    <DrillDown title="Revenue" says="How the group number moved, indexed division trend, and the target position behind it." today={today}>
      {({ data, f, set }) => (
        <>
          <Divisions data={data} f={f} set={set} />
        </>
      )}
    </DrillDown>
  );
}
