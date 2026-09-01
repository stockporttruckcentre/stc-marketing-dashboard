import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { FleetSmart, type ContractRow } from '@/components/FleetSmart';
import { capabilitiesFor } from '@/lib/crm/permissions';
import { ACCOUNT_COLUMNS, type PickableAccount } from '@/lib/fleetsmart/account';
import { SHIPPED_CARD, cardFrom } from '@/lib/fleetsmart/ratecard';
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

  const [profileRes, contractRes, accountRes, addressRes, leadRes, cardRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('fleetsmart_contracts').select('*').order('updated_at', { ascending: false }).limit(300),
    supabase.from('crm_contacts').select(ACCOUNT_COLUMNS).order('company_name').limit(2000),
    /* The primary address per account, read alongside rather than
       embedded, because PostgREST would give one nested array per
       account and the builder wants one line. Ordered so the primary
       comes first and the merge below takes it. */
    supabase.from('contact_addresses').select('contact_id, address, city, is_primary')
      .is('deleted_at', null)
      .order('is_primary', { ascending: false })
      .limit(4000),
    supabase.from('crm_leads').select('id, contact_id, company_name, requirement')
      .order('created_at', { ascending: false }).limit(2000),
    /* Every rate card ever saved, newest first. No rows is a working
       installation, not a missing one: the builder then prices off the
       card the application ships with, which is the workbook's. */
    supabase.from('fleetsmart_rate_cards')
      .select('version, card, note, is_current, created_at')
      .order('created_at', { ascending: false }).limit(50),
  ]);

  /* One address per account, the primary where there is one. The table
     may not be in an older database, in which case there is simply no
     structured address and `addressOf` falls back to the account's own
     column. */
  const bestAddress = new Map<string, { address: string | null; city: string | null }>();
  for (const row of (addressRes.data ?? []) as {
    contact_id: string | null; address: string | null; city: string | null;
  }[]) {
    if (!row.contact_id || bestAddress.has(row.contact_id)) continue;
    bestAddress.set(row.contact_id, { address: row.address, city: row.city });
  }

  const accounts: PickableAccount[] = ((accountRes.data ?? []) as Omit<
    PickableAccount, 'primary_address' | 'primary_city'
  >[]).map((a) => ({
    ...a,
    primary_address: bestAddress.get(a.id)?.address ?? null,
    primary_city: bestAddress.get(a.id)?.city ?? null,
  }));

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

  const savedCards = (cardRes.data ?? []) as {
    version: string; card: unknown; note: string | null;
    is_current: boolean; created_at: string;
  }[];
  const inUse = savedCards.find((c) => c.is_current);
  const card = inUse ? cardFrom(inUse.card, inUse.version) : SHIPPED_CARD;

  return (
    <FleetSmart
      card={card}
      cardVersions={savedCards.map(({ version, note, is_current, created_at }) =>
        ({ version, note, is_current, created_at }))}
      contracts={(contractRes.data ?? []) as ContractRow[]}
      accounts={accounts}
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
