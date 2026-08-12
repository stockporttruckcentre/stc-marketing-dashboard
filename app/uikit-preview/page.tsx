'use client';

/* =============================================================
   UI preview harness. Development only.

   The CRM cannot be looked at without Supabase credentials, which meant
   UI work was being judged by reading the code. That is how a page ends
   up with three stacked toolbars and a table squeezed into half the
   window: every piece is defensible on its own and the whole is not.

   This renders the real component against fabricated rows, so the layout
   can actually be seen, in both themes, at any window size. It is not a
   mock of the UI. It is the UI.

   Not found in production, so it is never reachable on a deployment.
   ============================================================= */
import { notFound } from 'next/navigation';
import { CrmWorkspace } from '@/components/CrmWorkspace';
import type { CRMContact, CrmList, Profile } from '@/lib/types';

const profile: Profile = { id: 'u1', email: 'alex@stc.co.uk', full_name: 'Alex Ellis', role: 'sales', theme: 'dark', created_at: '' };
const others: Profile[] = [
  profile,
  { id: 'u2', email: 'dave@stc.co.uk', full_name: 'Dave Sherratt', role: 'sales', theme: 'dark', created_at: '' },
  { id: 'u3', email: 'dean@stc.co.uk', full_name: 'Dean Mann', role: 'sales', theme: 'dark', created_at: '' },
];
const lists: CrmList[] = [
  { id: 'l0', name: 'Global CRM', description: null, owner_id: null, is_global: true, color: '#cf2417', created_at: '', updated_at: '' },
  { id: 'l1', name: 'M62 corridor', description: null, owner_id: 'u1', is_global: false, color: '#cf2417', created_at: '', updated_at: '' },
];
const COMPANIES = ['Bredbury Haulage', 'FleetSmart Logistics', 'TIP Trailers UK', 'Dawson Group', 'A&A Scaffolding', 'Wincanton North', 'Marsden Logistics', 'Dane Valley Transport', 'SMH Transport', 'Bishopgate Rentals', 'Walker Transport', 'Hyde Freight'];
const STATUS = ['lead', 'contacted', 'quoted', 'won', 'lost', 'customer'];
const contacts: CRMContact[] = COMPANIES.map((c, i) => ({
  id: `c${i}`, list_id: 'l0', company_name: c,
  contact_name: ['Tom Moore', 'Julie Barnes', 'Rama Patel', 'Gareth Wynn'][i % 4],
  email: i % 5 === 0 ? null : `ops@${c.toLowerCase().replace(/[^a-z]/g, '')}.co.uk`,
  phone: i % 4 === 0 ? null : `0161 4${String(100000 + i * 137).slice(0, 6)}`,
  location: ['Stockport', 'Haydock', 'Bredbury', 'Atherton'][i % 4],
  status: STATUS[i % 6] as any,
  source: 'manual',
  assigned_to: i % 3 === 0 ? 'Alex Ellis' : i % 3 === 1 ? 'Dave Sherratt' : null,
  last_contact: `2026-0${(i % 8) + 1}-1${i % 9}`,
  notes: i % 3 === 0 ? 'Quoted for 3 curtainsiders, chasing Thursday.' : null,
  turnover: 400000 + i * 175000,
  trucks: i * 2, trailers: i * 3, vans: i,
  employee_count: 20 + i * 7,
  fleet_size: null, estimated_value: null, sale_price: null,
  date_of_enquiry: null, links: [], created_at: '', updated_at: '',
} as any));

export default function Preview() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <div className="app" style={{ display: 'flex' }}>
      <div className="main" style={{ flex: 1, width: '100%' }}>
        <main className="page" style={{ maxWidth: 'none' }}>
          <CrmWorkspace
            profile={profile} lists={lists} members={[]} profiles={others}
            selectedListId="l0" initialContacts={contacts}
          />
        </main>
      </div>
    </div>
  );
}
