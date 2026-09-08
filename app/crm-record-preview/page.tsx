'use client';

/* =============================================================
   The real CRM record drawer, so its action row can be measured.
   Dev only.

   ---- Why this exists ----

   From the business, asking for the Reminder button:

     It should fit without pushing the other buttons to a new row by
     default as we have room left.

   "It fits" is a claim about pixels, and pixels cannot be asserted from
   the source: the row is `flexWrap: 'wrap'`, so a row that has become
   too long does not error. It starts a second line, the header grows,
   and everything below it moves down.

   ---- And why it mounts the REAL drawer ----

   The first version of this harness rebuilt the row out of the same
   `Button` components at what the source said the drawer's width was.
   It was wrong by 48px, and it was wrong in the direction that
   mattered: it reported a wrap that does not happen, and DocuSign was
   moved off the row to fix a problem that did not exist. The business
   spotted it from a screenshot, which is the correct outcome and an
   expensive way to find out.

   A rebuilt row is a guess about the real one. So this mounts
   `ContactDrawer` itself, against a fabricated record, and the check
   measures the buttons the application actually draws.

   Its six effects all query Supabase and all fail here, which is fine:
   every one of them sets an empty list on failure, so the drawer
   renders with no notes, no meetings and no leads. The header is what
   is being measured and it comes from the record alone.

   `notFound()` in production, like the harnesses next door, so it is
   never reachable on a deployment.
   ============================================================= */

import { notFound } from 'next/navigation';
import { ContactDrawer } from '@/components/crm/ContactDrawer';
import type { CRMContact, Profile } from '@/lib/types';

/* A record far enough along that every conditional part of the header
   is drawn: quoted is in `SIGNABLE`, so the DocuSign action is live,
   and a named owner and location fill the meta line. */
const CONTACT = {
  id: '00000000-0000-0000-0000-000000000001',
  company_name: 'Dawson Group Haulage Limited',
  contact_name: 'Julie Barnes',
  email: 'julie@dawsongroup.example',
  phone: '0161 480 3535',
  location: 'Warrington',
  assigned_to: 'Dean',
  status: 'quoted',
  relationship: 'prospect',
  estimated_value: 48000,
  trucks: 12, trailers: 30, vans: 4,
  links: [],
} as unknown as CRMContact;

const PROFILE = {
  id: '00000000-0000-0000-0000-0000000000aa',
  full_name: 'Alex Renshaw',
  email: 'alex@stockporttruckcentre.co.uk',
  role: 'admin',
} as unknown as Profile;

export default function CrmRecordPreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <ContactDrawer
        contact={CONTACT}
        profile={PROFILE}
        canEdit
        lists={[]}
        members={[]}
        onClose={() => {}}
        onChange={() => {}}
        onDelete={() => {}}
      />
    </div>
  );
}
