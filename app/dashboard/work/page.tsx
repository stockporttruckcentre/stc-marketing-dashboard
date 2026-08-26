import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { WorkHub } from '@/components/WorkHub';
import { capabilitiesFor } from '@/lib/crm/permissions';
import { NotProvisioned, TabShell } from '@/components/kit/primitives';
import type {
  Task, TaskView, Person, Entity, DelegationRequest,
} from '@/lib/work/types';
import type { CalendarEvent, Profile } from '@/lib/types';
import type { DiaryInvite, DiaryPerson } from '@/lib/calendar/diary';

export const dynamic = 'force-dynamic';

/* =============================================================
   Work.

   Everything is read here on the server and handed down, so the screen
   draws once with real rows rather than flashing empty and filling in.

   Every read is row level security scoped. `can_reach_task` in
   migration 056, replaced by migration 057 once the company split
   existed, decides what comes back, and this file never second guesses
   it: there is no WHERE clause here reimplementing who may see what.

   The exception is the two lookup lists at the bottom. `crm_contacts`
   and `stock_trailers` are read only to fill the "what is this about"
   pickers, so they take a narrow projection and a ceiling rather than
   the whole table.
   ============================================================= */

/** Postgres and PostgREST for "that table is not here yet". */
function missingTable(error: { code?: string } | null): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

export default async function WorkPage({
  searchParams,
}: {
  searchParams: { view?: string; tab?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [
    profileRes, tasksRes, viewsRes, peopleRes, deptRes,
    entityRes, projectRes, requestRes, membershipRes, teamRes,
    customerRes, trailerRes,
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('tasks').select('*').order('board_position', { ascending: true }).limit(2000),
    supabase.from('task_views').select('*').order('position', { ascending: true }),
    supabase.from('assignable_people').select('*').order('full_name'),
    supabase.from('departments').select('id, name').order('name'),
    supabase.from('entities').select('id, code, name, ticker').eq('is_active', true).order('sort_order'),
    supabase.from('projects').select('id, name').order('name'),
    supabase.from('task_delegation_requests').select('*').eq('state', 'open'),
    supabase.from('profile_entities').select('entity_id, is_primary').eq('user_id', user.id),
    supabase.from('team_members').select('team_id').eq('user_id', user.id),
    supabase.from('crm_contacts').select('id, company_name').order('company_name').limit(2000),
    supabase.from('stock_trailers').select('id, stc_no').order('stc_no').limit(2000),
  ]);

  /* The other half of "what is on me". Read here rather than fetched by
     the diary panel once it is opened, because a tab that says five
     meetings and then takes a second to show them is a tab somebody
     clicks twice.

     The window is a month back and four months on, the same as the
     diary screen's, so the two never disagree about what exists.
     Everything is row level security scoped: `calendar_events` shows
     what somebody may see and `calendar_invites` shows only the ones
     they are on either side of. */
  const now = new Date();
  const [diaryRes, inviteRes, peopleRes2] = await Promise.all([
    supabase.from('calendar_events').select('*')
      .gte('start_at', new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString())
      .lt('start_at', new Date(now.getFullYear(), now.getMonth() + 4, 1).toISOString())
      .order('start_at').limit(1000),
    supabase.from('calendar_invites')
      .select('id, event_id, user_id, invited_by, status, proposed_start_at, proposed_end_at, awaiting, rounds, note, responded_at'),
    supabase.from('profiles').select('id, full_name, email').limit(200),
  ]);

  const profile = (profileRes.data as Profile) ?? null;

  /* The Work tables arrive in migrations 046 to 059, which are pasted
     into the database by hand. Until that has happened the tab has to
     say so rather than draw an empty board that reads as "there is no
     work", which is a different and wrong answer. */
  if (missingTable(tasksRes.error as { code?: string } | null)) {
    return (
      <TabShell>
        <NotProvisioned
          what="Work is built, but its tables are not in this database yet."
          needs="migrations 046 to 059 running against it, which is the SQL handed over in chat"
        />
      </TabShell>
    );
  }

  /* Which tasks have an open request pointed at this person. The filter
     evaluator needs it to answer `release_asked_of is @me`, which is
     what makes the "Waiting for me" view include work somebody is
     asking to be let off as well as work waiting to be reviewed. */
  const askedOfMe = (requestRes.data ?? [])
    .filter((r: DelegationRequest) => r.asked_of === user.id)
    .map((r: DelegationRequest) => r.task_id);

  const membership = (membershipRes.data ?? []) as { entity_id: string; is_primary: boolean }[];
  const entityIds = membership.length
    ? membership.map((m) => m.entity_id)
    : (profile?.entity_id ? [profile.entity_id] : []);

  return (
    <WorkHub
      initialTasks={(tasksRes.data ?? []) as Task[]}
      views={(viewsRes.data ?? []) as TaskView[]}
      people={(peopleRes.data ?? []) as Person[]}
      departments={(deptRes.data ?? []) as { id: string; name: string }[]}
      entities={(entityRes.data ?? []) as Entity[]}
      projects={(projectRes.data ?? []) as { id: string; name: string }[]}
      customers={(customerRes.data ?? []) as { id: string; company_name: string | null }[]}
      trailers={(trailerRes.data ?? []) as { id: string; stc_no: string | null }[]}
      requests={(requestRes.data ?? []) as DelegationRequest[]}
      viewer={{
        userId: user.id,
        departmentId: profile?.department_id ?? null,
        teamIds: (teamRes.data ?? []).map((t: { team_id: string }) => t.team_id),
        entityIds,
        releaseAskedOfMe: askedOfMe,
      }}
      capabilities={[...capabilitiesFor(profile ?? { role: 'viewer' } as Profile)]}
      /* Only somebody on both companies is offered the switcher. */
      multiEntity={entityIds.length > 1}
      openView={searchParams?.view ?? null}
      openTab={searchParams?.tab === 'diary' ? 'diary' : 'tasks'}
      diaryEvents={(diaryRes.data ?? []) as CalendarEvent[]}
      diaryInvites={(inviteRes.data ?? []) as DiaryInvite[]}
      diaryPeople={(peopleRes2.data ?? []) as DiaryPerson[]}
    />
  );
}
