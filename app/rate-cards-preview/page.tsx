'use client';

import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { RateCardsScreen } from '@/components/sales/ratecards/RateCardsScreen';

/* =============================================================
   The Rate Card Builder, for driving. Dev only.

   From the standing rule about what finished means:

     It has been driven, not just rendered. Every control is clicked by
     a browser check that asserts what happened. "It compiles" and "it
     renders" are not evidence.

   The screen reads seven tables behind a login, so nothing exercised it
   before it merged. This mounts the REAL screen, with the real client
   and the real data path, and `scripts/rate-cards-drive-check.ts`
   answers its calls in the browser with fixtures that behave the way
   the database behaves.

   Stubbing at the network rather than swapping the data layer is the
   point: the components are not told they are being tested, so what is
   driven is what ships.

   `notFound()` in production, like the harnesses next door.
   ============================================================= */
export default function RateCardsPreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <Suspense fallback={null}>
      <RateCardsScreen caps={{ view: true, build: true, labour: true, approve: true }} />
    </Suspense>
  );
}
