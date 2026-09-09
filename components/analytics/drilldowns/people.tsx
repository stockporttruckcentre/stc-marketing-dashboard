'use client';

import { DrillDown } from '@/components/analytics/DrillDown';
import { People } from '@/components/analytics/sections';

/* People. The devices are the hub's own, moved rather than rebuilt. */
export function PeopleDrillDown({ today }: { today: string }) {
  return (
    <DrillDown title="People" says="Who brought business in, and how they convert against the group rate." today={today}>
      {({ data, f, set }) => (
        <>
          <People data={data} f={f} set={set} />
        </>
      )}
    </DrillDown>
  );
}
