import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { TeamCalendar } from '@/components/TeamCalendar';
import { capabilitiesFor } from '@/lib/crm/permissions';
import type { CalendarEvent, Profile } from '@/lib/types';
import type { DiaryGuest, DiaryInvite } from '@/lib/calendar/diary';
import type { Company, Person } from '@/components/calendar/drawer';

export const dynamic = 'force-dynamic';

/* =============================================================
   The diary.

   Four reads, all row level security scoped, all on the server.

   The window is deliberately wide: a month back and four months on.
   The old page read the visible month only, which is why the seven day
   strip at the bottom of it went empty on the 28th, and why an
   invitation link to something in November opened an empty October.

   The invitations come back unfiltered by event, because the policy on
   `calendar_invites` already limits them to the ones somebody is on
   either side of, and matching them to events in the browser is
   cheaper than a join per event.
   ============================================================= */

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: { event?: string; view?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const to = new Date(now.getFullYear(), now.getMonth() + 4, 1).toISOString();

  const [profileRes, eventsRes, inviteRes, guestRes, peopleRes, companyRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('calendar_events').select('*')
      .gte('start_at', from).lt('start_at', to).order('start_at').limit(1000),
    supabase.from('calendar_invites')
      .select('id, event_id, user_id, invited_by, status, proposed_start_at, proposed_end_at, awaiting, rounds, note, responded_at'),
    /* Guests, from migration 062. Scoped by their own policy to
       meetings this person can see, which is what makes somebody the
       customer's transport manager was added to visible to every
       colleague on the meeting rather than only to whoever asked. */
    supabase.from('calendar_guests').select('id, event_id, email, name, status, proposed_start_at, proposed_end_at, rounds, note, responded_at, seen_at, invited_by'),
    supabase.from('profiles').select('id, full_name, email').order('full_name').limit(200),
    supabase.from('crm_contacts').select('id, company_name').order('company_name').limit(2000),
  ]);

  const profile = (profileRes.data as Profile) ?? null;

  return (
    <TeamCalendar
      initialEvents={(eventsRes.data ?? []) as CalendarEvent[]}
      /* Missing until migration 006 has run, which is the difference
         between "nobody has been invited" and "invitations do not exist
         here yet". Either way an empty list draws the diary correctly
         and every entry reads as one nobody was asked to. */
      initialInvites={(inviteRes.data ?? []) as DiaryInvite[]}
      initialGuests={(guestRes.data ?? []) as DiaryGuest[]}
      people={(peopleRes.data ?? []) as Person[]}
      companies={(companyRes.data ?? []) as Company[]}
      userId={user.id}
      myName={profile?.full_name ?? user.email?.split('@')[0] ?? 'Me'}
      capabilities={[...capabilitiesFor(profile ?? { role: 'viewer' } as Profile)]}
      openEventId={searchParams?.event ?? null}
      /* So the command bar can land on the view a sentence asked for:
         "what is on this week" is the week, "what have I got on" is
         the list of what is next. */
      openView={
        searchParams?.view === 'week' ? 'week'
        : searchParams?.view === 'agenda' ? 'agenda'
        : 'month'
      }
    />
  );
}
