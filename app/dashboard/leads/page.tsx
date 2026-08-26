import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SalesTracker } from '@/components/SalesTracker';
import type { LeadWithAccount, Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * A tracker is the leads on it, not a list of companies.
 *
 * It used to be a private `crm_lists` row filtered by `list_id`, which
 * is why the same customer had to be copied onto every tracker that was
 * pitching to them. A tracker now asks the only question that was ever
 * meant: which pitches are mine.
 *
 * Mine means I own it or somebody shared it with me. Deliberately
 * spelled out rather than left to row level security, because an admin
 * can see every tracker and would otherwise open their own and find
 * everybody's.
 */
export default async function SalesTrackerPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();

  const { data: leads } = await supabase
    .from('crm_leads')
    .select(`*, account:crm_contacts (
       id, company_name, contact_name, email, phone, location, relationship
     )`)
    .or(`owner_id.eq.${user.id},shared_with.cs.{${user.id}}`)
    .order('date_of_enquiry', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  return (
    <SalesTracker
      initialLeads={(leads ?? []) as LeadWithAccount[]}
      profile={profile as Profile}
    />
  );
}
