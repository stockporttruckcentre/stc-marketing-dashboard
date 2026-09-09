'use client';

import { DrillDown } from '@/components/analytics/DrillDown';
import { Customers } from '@/components/analytics/sections';

/* Customers. The devices are the hub's own, moved rather than rebuilt. */
export function CustomersDrillDown({ today }: { today: string }) {
  return (
    <DrillDown title="Customers" says="Who is spending, measured against the same window as everything else." today={today}>
      {({ data, f, set }) => (
        <>
          <Customers data={data} />
        </>
      )}
    </DrillDown>
  );
}
