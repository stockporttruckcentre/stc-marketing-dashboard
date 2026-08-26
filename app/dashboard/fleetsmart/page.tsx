import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { FleetSmart, type ContractRow } from '@/components/FleetSmart';
import { capabilitiesFor } from '@/lib/crm/permissions';
import { NotProvisioned, TabShell } from '@/components/kit/primitives';
import type { Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

/* =============================================================
   FleetSmart+.

   Three reads, all row level security scoped, all on the server so the
   list draws once with real rows rather than flashing empty.

   The contracts come back with their `input` and `priced` JSON on them,
   which is what lets a sent contract print exactly as it went out
   without asking the server for it again. That is a few kilobytes a
   row, so the list takes a ceiling: a business that has built four
   hundred maintenance contracts wants a search rather than a longer
   page, and that is a different piece of work.

   Accounts and leads are read narrow, to fill the wizard's customer
   picker. They are the same two tables the CRM tab reads and the
   policies on them decide what comes back, so there is no WHERE clause
   here reimplementing who may see which customer.
   ============================================================= */

/** Postgres and PostgREST for "that table is not here yet". */
function missingTable(error: { code?: string } | null): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

export default async function FleetSmartPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [profileRes, contractRes, accountRes, leadRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('fleetsmart_contracts').select('*').order('updated_at', { ascending: false }).limit(300),
    supabase.from('crm_contacts').select('id, company_name, contact_name, location')
      .order('company_name').limit(2000),
    supabase.from('crm_leads').select('id, contact_id, company_name, requirement')
      .order('created_at', { ascending: false }).limit(2000),
  ]);

  const profile = (profileRes.data as Profile) ?? null;
  const capabilities = [...capabilitiesFor(profile ?? { role: 'viewer' } as Profile)];

  /* Migration 061 is pasted into the database by hand like the rest of
     them. Until that has happened the tab has to say so, rather than
     draw an empty list that reads as "nobody has built a contract",
     which is a different and wrong answer. */
  if (missingTable(contractRes.error as { code?: string } | null)) {
    return (
      <TabShell>
        <NotProvisioned
          what="FleetSmart+ is built, but its table is not in this database yet."
          needs="migration 061 running against it, which is the SQL handed over in chat"
        />
      </TabShell>
    );
  }

  return (
    <FleetSmart
      contracts={(contractRes.data ?? []) as ContractRow[]}
      accounts={(accountRes.data ?? []) as {
        id: string; company_name: string | null; contact_name: string | null; location: string | null;
      }[]}
      leads={(leadRes.data ?? []) as {
        id: string; contact_id: string | null; company_name: string | null; requirement: string | null;
      }[]}
      capabilities={capabilities}
      /* No phone number on a profile, so the wizard's account manager
         block starts with a name and an email and the number is typed.
         A blank field is better than a wrong one on a contract. */
      manager={{
        name: profile?.full_name ?? '',
        email: profile?.email ?? '',
        phone: '',
      }}
    />
  );
}
