'use client';

import { DrillDown } from '@/components/analytics/DrillDown';
import { Book } from '@/components/analytics/sections';

/* FleetSmart+. The devices are the hub's own, moved rather than rebuilt. */
export function FleetSmartDrillDown({ today }: { today: string }) {
  return (
    <DrillDown title="FleetSmart+" says="The contract book: weekly value, tier mix and retention by start month." today={today}>
      {({ data, f, set }) => (
        <>
          <Book data={data} set={set} />
        </>
      )}
    </DrillDown>
  );
}
