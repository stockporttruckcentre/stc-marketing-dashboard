import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  answerInvitation, inviteToMeeting, INVITE_ACTIONS, type InviteAction,
} from '@/lib/calendar/invitations';

export const dynamic = 'force-dynamic';

/**
 * Meeting invitations, and the back and forth that follows one.
 *
 * The work itself is `lib/calendar/invitations.ts` over migration 021,
 * which the command bar's `meeting.invite` capability reaches too. Five
 * actions, each of them several writes that have to happen together: a
 * second copy of that sequence would drift the first time one of them
 * grew a step.
 *
 * This route is the buttons on the calendar. It reads the body, calls
 * the operation, and says what happened.
 */

type Body = {
  action?: 'invite' | InviteAction;
  eventId?: string;
  /** Who to ask. Only for invite. */
  userId?: string;
  /** Which invitation is being answered. */
  inviteId?: string;
  /** For propose, and for an organiser countering a counter. */
  startAt?: string;
  endAt?: string;
  note?: string;
};

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, message: 'Not signed in.' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const action = body.action;
  if (!action) return NextResponse.json({ ok: false, message: 'No action given.' });

  if (action === 'invite') {
    if (!body.eventId || !body.userId) {
      return NextResponse.json({ ok: false, message: 'I need the meeting and who to invite.' });
    }
    const done = await inviteToMeeting(supabase, {
      eventIds: [body.eventId], userIds: [body.userId], note: body.note ?? null,
    });
    if (!done.ok) return NextResponse.json({ ok: false, message: done.why });

    return NextResponse.json({
      ok: true,
      message: 'Invitation sent. It is with them now.',
      inviteId: done.inviteId,
      link: { href: `/dashboard/calendar?event=${body.eventId}`, label: 'Open the meeting' },
    });
  }

  if (!INVITE_ACTIONS.includes(action)) {
    return NextResponse.json({ ok: false, message: 'I did not understand that.' });
  }
  if (!body.inviteId) return NextResponse.json({ ok: false, message: 'Which invitation?' });

  const done = await answerInvitation(supabase, {
    inviteId: body.inviteId,
    action,
    startAt: body.startAt ?? null,
    endAt: body.endAt ?? null,
    note: body.note ?? null,
  });
  if (!done.ok) return NextResponse.json({ ok: false, message: done.why });

  /* Withdrawing takes the invitation away, so there is nothing left to
     open. Everything else leaves the meeting to look at. */
  const { data: invite } = action === 'withdraw'
    ? { data: null }
    : await supabase.from('calendar_invites').select('event_id').eq('id', body.inviteId).single();

  const eventId = (invite as { event_id?: string } | null)?.event_id;
  return NextResponse.json({
    ok: true,
    message: done.said,
    ...(eventId
      ? { link: { href: `/dashboard/calendar?event=${eventId}`, label: 'Open the meeting' } }
      : {}),
  });
}

/**
 * Where every invitation on a meeting stands, with the whole exchange.
 *
 * The calendar entry shows this rather than a list of names, because
 * "Tom declined, Dave suggested Thursday" is the useful thing and
 * "Tom, Dave" is not.
 */
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const eventId = req.nextUrl.searchParams.get('eventId');
  const mine = req.nextUrl.searchParams.get('mine');

  if (mine) {
    // Everything waiting on me, for the bell and for "what have I not
    // answered".
    const { data } = await supabase
      .from('calendar_invites')
      .select('id, event_id, status, proposed_start_at, note, rounds, calendar_events(title, start_at)')
      .eq('awaiting', user.id)
      .in('status', ['pending', 'proposed'])
      .order('created_at', { ascending: false });
    return NextResponse.json({ ok: true, invites: data ?? [] });
  }

  if (!eventId) return NextResponse.json({ ok: false, message: 'Which meeting?' });

  const { data: invites } = await supabase
    .from('calendar_invites')
    .select('id, user_id, invited_by, status, proposed_start_at, proposed_end_at, awaiting, rounds, note, responded_at')
    .eq('event_id', eventId);

  const ids = ((invites ?? []) as any[]).map((i) => i.id);
  const { data: messages } = ids.length
    ? await supabase
        .from('calendar_invite_messages')
        .select('id, invite_id, actor_id, action, start_at, end_at, note, created_at')
        .in('invite_id', ids)
        .order('created_at', { ascending: true })
    : { data: [] };

  // Names, so the calendar does not have to render a UUID at somebody.
  const userIds = [...new Set(((invites ?? []) as any[]).flatMap((i) => [i.user_id, i.invited_by]).filter(Boolean))];
  const { data: people } = userIds.length
    ? await supabase.from('profiles').select('id, full_name, email').in('id', userIds)
    : { data: [] };

  return NextResponse.json({
    ok: true,
    invites: invites ?? [],
    messages: messages ?? [],
    people: people ?? [],
  });
}
