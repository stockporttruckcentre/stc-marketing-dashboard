'use client';

/* =============================================================
   Two trackers, switched between, with the real component. Dev only.

   ---- Why this exists ----

   From the business:

     If I set the tracker to STC Admin which has 0 records as I just
     created it, i see all of dean's leads as i'm in dean's account.
     Task failed - i send end to end audit everything and prove it works
     before you reply to me.

   The fault was not in the query. The server read the right leads and
   the screen threw them away, because `SalesTracker` seeds its rows in
   a `useState` initialiser and navigating from /dashboard/leads to
   /dashboard/leads?owner=X keeps the same component mounted. A prop
   changed, the state did not, and every screenshot of the page showed a
   heading and a grid disagreeing about whose tracker it was.

   That is a bug no unit test of the query would ever have caught, and
   no source assertion either: the query was correct in both. It can
   only be caught by mounting the component, handing it one owner's
   leads, then handing it another's, and looking at what is on screen.

   So that is what this is. Two fabricated trackers, one with rows and
   one deliberately empty, exactly the case the business hit: a colleague
   created five minutes ago with nothing on their tracker, which is the
   one where "it still shows Dean's" is invisible unless somebody counts.

   `scripts/tracker-switch-check.ts` drives it and reads the grid back.

   `notFound()` in production, like the harnesses next door.
   ============================================================= */

import { useState } from 'react';
import { notFound } from 'next/navigation';
import { SalesTracker } from '@/components/SalesTracker';
import type { LeadWithAccount, Profile } from '@/lib/types';

const DEAN = {
  id: '00000000-0000-0000-0000-00000000dean',
  full_name: 'Dean Mann', email: 'dean@stockporttruckcentre.co.uk', role: 'sales',
} as unknown as Profile;

const ADMIN = {
  id: '00000000-0000-0000-0000-0000000admin',
  full_name: 'STC Admin', email: 'admin@stockporttruckcentre.co.uk', role: 'admin',
} as unknown as Profile;

/** Dean's tracker: four leads, named so the check can recognise them. */
const DEANS: LeadWithAccount[] = ['Dawson Group', 'Culina Logistics', 'Wincanton', 'Gregory Distribution']
  .map((name, i) => ({
    id: `lead-dean-${i}`,
    contact_id: `acc-${i}`,
    owner_id: DEAN.id,
    shared_with: [],
    type: 'trailer_sales',
    status: i === 3 ? 'customer' : 'quoted',
    what: '4.7m curtainsider',
    requirement: null, new_or_used: 'New', estimated_value: 40000 + i * 1000,
    date_of_enquiry: '2026-08-01', action: null, next_action: null,
    last_activity_at: '2026-09-01T09:00:00Z',
    stock_trailer_id: null, order_date: null, dispatch_date: null,
    sale_price: null, profit: null, profit_pct: null,
    commission: null, commission_rate: null, rep_initials: null,
    notes: null, company_name: name,
    created_by: DEAN.id, created_at: '2026-08-01T09:00:00Z', updated_at: '2026-09-01T09:00:00Z',
    account: { id: `acc-${i}`, company_name: name, contact_name: null, email: null, phone: null, location: null, relationship: 'prospect' },
  } as unknown as LeadWithAccount));

/** The account created five minutes ago. Nothing on it, on purpose. */
const ADMINS: LeadWithAccount[] = [];

export default function TrackerPreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  /* The harness stands in for the router: in the application, switching
     owner is a navigation and the server hands down a different
     `initialLeads`. Here a button does it, which exercises exactly the
     thing that was broken, which is what the component does when its
     props change under it. The key is the same one the page uses. */
  const [owner, setOwner] = useState<'dean' | 'admin'>('dean');
  const viewing = owner === 'admin' ? ADMIN : null;
  const leads = owner === 'admin' ? ADMINS : DEANS;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ padding: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button id="to-dean" onClick={() => setOwner('dean')}>Dean&rsquo;s tracker</button>
        <button id="to-admin" onClick={() => setOwner('admin')}>STC Admin&rsquo;s tracker</button>
        <span id="whose" style={{ fontFamily: 'monospace', fontSize: 12 }}>{owner}</span>
      </div>
      <SalesTracker
        key={viewing?.id ?? DEAN.id}
        initialLeads={leads}
        profile={DEAN}
        colleagues={[DEAN, ADMIN]}
        viewing={viewing}
        canViewOthers
      />
    </div>
  );
}
