'use client';

import { useState } from 'react';
import { PersonalAnalytics } from '@/components/analytics/personal/PersonalAnalytics';
import type { Viewable } from '@/lib/analytics/scope';

/* =============================================================
   The Personal portfolio, driven without a database.

   From the business:

     then end to end check the page, and again, and again. I keep
     having to prompt you to fix stuff you're missing as you're not
     checking.

   Entirely fair. Every fault on this page today was found by a person
   looking at it, which is not a way to run a screen a team uses.

   So this mounts the REAL component with the real props, and nothing
   about it is stubbed or branched. It talks to Supabase exactly as it
   does in production, and `scripts/personal-page-check.ts` answers
   those calls in the browser instead, so the page under test is the
   page that ships.

   Run it with `npm run check:personal-page`.

   Never in production.
   ============================================================= */

const DEAN = 'e8529c1f-3351-46e3-b74d-8902bad4a923';

export default function Page() {
  const [asked, setAsked] = useState('2026-09-24');
  const people: Viewable[] = [
    { id: DEAN, full_name: 'Dean Mann' } as Viewable,
  ];
  return (
    <PersonalAnalytics
      person={DEAN}
      people={people}
      selfId={DEAN}
      asked={asked}
      onAsked={setAsked}
      onLeave={() => {}}
      onPerson={() => {}}
    />
  );
}
