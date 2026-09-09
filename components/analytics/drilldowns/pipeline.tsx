'use client';

import { DrillDown } from '@/components/analytics/DrillDown';
import { Sources } from '@/components/analytics/sections';

/* Sales and pipeline. The devices are the hub's own, moved rather than rebuilt. */
export function PipelineDrillDown({ today }: { today: string }) {
  return (
    <DrillDown title="Sales and pipeline" says="Where business came from and what became of it." today={today}>
      {({ data }) => (
        <>
          <Sources data={data} />
        </>
      )}
    </DrillDown>
  );
}
