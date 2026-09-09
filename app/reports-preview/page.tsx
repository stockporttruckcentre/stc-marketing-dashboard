'use client';

import { notFound } from 'next/navigation';
import { ReportsHub } from '@/components/ReportsHub';

/* =============================================================
   The Reports landing page, on its own, with nothing behind it.

   The same harness the tracker and the FleetSmart+ contract have, and
   for the reason that got established the hard way earlier: a layout
   measured on a rebuilt copy is a guess dressed as a measurement. This
   mounts the REAL `ReportsHub`, so what is screenshotted is what ships.

   Nothing is fetched. The catalogue is a constant and the landing page
   reads only that, so the screen draws in full with no database, no
   session and no network. The moment a report is opened it would ask
   the API, which is why this harness is only ever used for the landing
   page.

   Never in production.
   ============================================================= */
export default function ReportsPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    /* The same box the dashboard gives a page: `.content__inner` in
       globals.css is 24px 28px of padding inside a 1800px cap. The
       harness has to match it or a layout measured here is a layout
       measured somewhere else, which is how a wrap that does not happen
       gets reported as fact. */
    <div className="kit" style={{ padding: '24px 28px 56px', maxWidth: 1800 }}>
      <ReportsHub people={[]} mayExport />
    </div>
  );
}
