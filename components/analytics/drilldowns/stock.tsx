'use client';

import { DrillDown } from '@/components/analytics/DrillDown';
import { Stock } from '@/components/analytics/sections';

/* Stock. The devices are the hub's own, moved rather than rebuilt. */
export function StockDrillDown({ today }: { today: string }) {
  return (
    <DrillDown title="Stock" says="Age against margin, and what is tied up in units nobody has moved." today={today}>
      {({ data, f, set }) => (
        <>
          <Stock data={data} />
        </>
      )}
    </DrillDown>
  );
}
