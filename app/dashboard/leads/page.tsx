import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SalesTracker } from '@/components/SalesTracker';
import { capabilitiesFor } from '@/lib/crm/permissions';
import type { LeadWithAccount, Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * A tracker is the leads on it, not a list of companies.
 *
 * It used to be a private `crm_lists` row filtered by `list_id`, which
 * is why the same customer had to be copied onto every tracker that was
 * pitching to them. A tracker now asks the only question that was ever
 * meant: which pitches are whose.
 *
 * ---- Whose, and who decides ----
 *
 * From the business:
 *
 *   Re-enable admin users being able to view other people's sales
 *   trackers, ensure wiring end to end perfect and tested when viewing a
 *   certain tracker and that permissions are correctly wired here.
 *
 * `?owner=<id>` names the tracker to open. Three things have to agree
 * before it opens, and they are deliberately three rather than one:
 *
 *   1. THIS FILE refuses the parameter outright unless the reader holds
 *      `crm.viewOthers`. A rep who types the URL by hand lands on their
 *      own tracker, with a line saying so rather than an empty screen.
 *   2. ROW LEVEL SECURITY decides what actually comes back. `leads_select`
 *      in migration 040 already allows an administrator every lead, so
 *      this file never has to be the only thing standing in the way. If
 *      the capability were granted to somebody the database does not
 *      trust, they would get an empty tracker rather than a colleague's.
 *   3. THE SCREEN says whose tracker is open, in the heading, at all
 *      times. A manager who forgets they are looking at Dean's and edits
 *      a row has done something they cannot see they did.
 *
 * Written out here rather than left to row level security alone,
 * because an administrator can see every lead and would otherwise open
 * their own tracker and find everybody's on it.
 */
export default async function SalesTrackerPage({
  searchParams,
}: { searchParams?: { owner?: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profileRow } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  const profile = profileRow as Profile;
  const caps = capabilitiesFor(profile ?? { role: 'viewer' });
  const mayViewOthers = caps.has('crm.viewOthers');

  /* Who is being looked at. Nobody by default, and nobody at all
     without the capability, whatever the address bar says. */
  const asked = searchParams?.owner?.trim() || null;
  const viewingId = mayViewOthers && asked && asked !== user.id ? asked : null;

  /* The colleagues the picker offers. Only fetched for somebody who can
     use it: a list of names is itself information, and a rep has no
     reason to receive one from this page. */
  const { data: people } = mayViewOthers
    ? await supabase.from('profiles').select('id, full_name, email, role').order('full_name')
    : { data: null };

  /* Named before it is read from, so the heading can say whose tracker
     this is rather than "somebody else's". An id matching nobody, from
     an old link or a colleague who has left, opens your own tracker and
     says why: loading a stranger's leads under a blank name is the one
     outcome worth refusing outright. */
  const viewing = viewingId
    ? ((people ?? []).find((p) => (p as Profile).id === viewingId) as Profile | undefined) ?? null
    : null;
  const unknown = Boolean(viewingId && !viewing);

  const ownerId = viewing?.id ?? user.id;
  const { data: leads } = await supabase
    .from('crm_leads')
    .select(`*, account:crm_contacts (
       id, company_name, contact_name, email, phone, location, relationship
     )`)
    .or(`owner_id.eq.${ownerId},shared_with.cs.{${ownerId}}`)
    .order('last_activity_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  return (
    <SalesTracker
      initialLeads={(leads ?? []) as LeadWithAccount[]}
      profile={profile}
      colleagues={(people ?? []) as Profile[]}
      viewing={viewing}
      /* Two different refusals, said differently. The parameter was
         given and the capability was not, or it names nobody. */
      refused={Boolean(asked && asked !== user.id && !mayViewOthers)}
      unknownOwner={unknown}
      canViewOthers={mayViewOthers}
    />
  );
}
