import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Meeting invitations, and the back and forth that follows one.
 *
 * Five things can happen to an invitation, and they are all the same
 * shape: somebody acts, the invite's standing changes, a line goes into
 * the history, and the other side gets told.
 *
 *   invite    the organiser asks somebody
 *   accept    it goes in their diary and the organiser is told
 *   decline   they are not coming, with a reason if they gave one
 *   propose   they want a different time, and now the organiser answers
 *   withdraw  the organiser takes the invitation back
 *
 * Accepting a proposal is not a separate verb. The organiser accepts,
 * and because the proposed time is the one on the table, the event moves
 * to it and everybody already on the meeting is told it has moved. That
 * is what makes it a conversation rather than a form: either side can
 * accept, either side can counter, and it ends when somebody says yes.
 *
 * `awaiting` is the whole trick. It records whose answer the meeting is
 * waiting on, so neither person has to work it out from the history, and
 * so the calendar can say "waiting on Tom" rather than "pending".
 */

type Action = 'invite' | 'accept' | 'decline' | 'propose' | 'withdraw';

type Body = {
  action?: Action;
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

const KIND = {
  invited: 'meeting_invited',
  accepted: 'meeting_accepted',
  declined: 'meeting_declined',
  proposed: 'meeting_proposed',
  moved: 'meeting_moved',
  cancelled: 'meeting_cancelled',
} as const;

function whenLabel(iso: string | null | undefined): string {
  if (!iso) return 'the time on the invitation';
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

async function notify(
  supabase: any,
  userId: string | null | undefined,
  kind: string,
  title: string,
  body: string,
  eventId: string,
) {
  if (!userId) return;
  // Best effort. A notification that cannot be written must never stop a
  // meeting from being answered, and migration 001 may not have been run.
  await supabase.from('notifications').insert({
    user_id: userId, kind, title, body,
    link_path: `/dashboard/calendar?event=${eventId}`,
  }).then(() => undefined, () => undefined);
}

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, message: 'Not signed in.' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const action = body.action;
  if (!action) return NextResponse.json({ ok: false, message: 'No action given.' });

  const { data: me } = await supabase
    .from('profiles').select('full_name, email').eq('id', user.id).single();
  const myName = (me as any)?.full_name ?? (me as any)?.email ?? 'Somebody';

  /* ---- the organiser asks somebody ---------------------------------- */
  if (action === 'invite') {
    if (!body.eventId || !body.userId) {
      return NextResponse.json({ ok: false, message: 'I need the meeting and who to invite.' });
    }

    const { data: event } = await supabase
      .from('calendar_events').select('id, title, start_at, end_at, created_by')
      .eq('id', body.eventId).single();
    if (!event) return NextResponse.json({ ok: false, message: 'I could not find that meeting.' });

    // Inviting somebody to a meeting is the organiser's call.
    if ((event as any).created_by !== user.id) {
      return NextResponse.json({ ok: false, message: 'Only whoever booked the meeting can invite people to it.' });
    }

    const { data: invite, error } = await supabase
      .from('calendar_invites')
      .upsert({
        event_id: body.eventId,
        user_id: body.userId,
        invited_by: user.id,
        status: 'pending',
        awaiting: body.userId,
        note: body.note ?? null,
        proposed_start_at: null,
        proposed_end_at: null,
      }, { onConflict: 'event_id,user_id' })
      .select('id')
      .single();
    if (error) return NextResponse.json({ ok: false, message: error.message });

    await supabase.from('calendar_invite_messages').insert({
      invite_id: (invite as any).id, actor_id: user.id, action: 'invited',
      start_at: (event as any).start_at, end_at: (event as any).end_at, note: body.note ?? null,
    });

    await notify(supabase, body.userId, KIND.invited,
      `${myName} invited you to ${(event as any).title}`,
      `${whenLabel((event as any).start_at)}. Accept, decline, or suggest another time.`,
      (event as any).id);

    return NextResponse.json({
      ok: true,
      message: `Invitation sent. It is with them now.`,
      inviteId: (invite as any).id,
      link: { href: `/dashboard/calendar?event=${(event as any).id}`, label: 'Open the meeting' },
    });
  }

  /* ---- everything else answers an existing invitation ---------------- */
  if (!body.inviteId) return NextResponse.json({ ok: false, message: 'Which invitation?' });

  const { data: invite } = await supabase
    .from('calendar_invites')
    .select('id, event_id, user_id, invited_by, status, rounds, proposed_start_at, proposed_end_at')
    .eq('id', body.inviteId).single();
  if (!invite) return NextResponse.json({ ok: false, message: 'I could not find that invitation.' });

  const inv = invite as any;
  const { data: event } = await supabase
    .from('calendar_events').select('id, title, start_at, end_at, created_by')
    .eq('id', inv.event_id).single();
  const ev = event as any;

  const isInvitee = inv.user_id === user.id;
  const isOrganiser = inv.invited_by === user.id;
  if (!isInvitee && !isOrganiser) {
    return NextResponse.json({ ok: false, message: 'That invitation is not yours to answer.' });
  }
  const otherSide = isInvitee ? inv.invited_by : inv.user_id;

  /* ---- withdraw ------------------------------------------------------ */
  if (action === 'withdraw') {
    if (!isOrganiser) return NextResponse.json({ ok: false, message: 'Only the organiser can take an invitation back.' });
    await supabase.from('calendar_invite_messages').insert({
      invite_id: inv.id, actor_id: user.id, action: 'withdrawn', note: body.note ?? null,
    });
    await supabase.from('calendar_invites').delete().eq('id', inv.id);
    await notify(supabase, inv.user_id, KIND.cancelled,
      `${myName} withdrew the invitation to ${ev?.title ?? 'a meeting'}`,
      body.note ?? 'No longer needed.', inv.event_id);
    return NextResponse.json({ ok: true, message: 'Invitation withdrawn.' });
  }

  /* ---- accept -------------------------------------------------------- */
  if (action === 'accept') {
    /* Whoever accepts is accepting whatever time is currently on the
       table. If that is a proposal, the meeting moves to it, which is
       what makes this a conversation rather than two separate forms. */
    const movingTo = inv.proposed_start_at as string | null;

    if (movingTo && isOrganiser) {
      await supabase.from('calendar_events').update({
        start_at: movingTo,
        end_at: inv.proposed_end_at ?? null,
      }).eq('id', inv.event_id);

      // Everybody else on the meeting is told it moved, because their
      // diary just changed and nobody asked them.
      const { data: others } = await supabase
        .from('calendar_invites').select('user_id')
        .eq('event_id', inv.event_id).neq('user_id', inv.user_id);
      for (const o of ((others ?? []) as any[])) {
        await notify(supabase, o.user_id, KIND.moved,
          `${ev?.title ?? 'A meeting'} moved`,
          `Now ${whenLabel(movingTo)}.`, inv.event_id);
      }
    }

    await supabase.from('calendar_invites').update({
      status: 'accepted',
      awaiting: null,
      proposed_start_at: null,
      proposed_end_at: null,
      responded_at: new Date().toISOString(),
      note: body.note ?? null,
    }).eq('id', inv.id);

    await supabase.from('calendar_invite_messages').insert({
      invite_id: inv.id, actor_id: user.id, action: 'accepted',
      start_at: movingTo ?? ev?.start_at ?? null, note: body.note ?? null,
    });

    await notify(supabase, otherSide, KIND.accepted,
      `${myName} accepted ${ev?.title ?? 'the meeting'}`,
      movingTo ? `Moved to ${whenLabel(movingTo)}.` : whenLabel(ev?.start_at),
      inv.event_id);

    return NextResponse.json({
      ok: true,
      message: movingTo && isOrganiser
        ? `Agreed. The meeting has moved to ${whenLabel(movingTo)}.`
        : 'Accepted. It is in your diary.',
      link: { href: `/dashboard/calendar?event=${inv.event_id}`, label: 'Open the meeting' },
    });
  }

  /* ---- decline -------------------------------------------------------- */
  if (action === 'decline') {
    await supabase.from('calendar_invites').update({
      status: 'declined',
      awaiting: null,
      responded_at: new Date().toISOString(),
      note: body.note ?? null,
    }).eq('id', inv.id);

    await supabase.from('calendar_invite_messages').insert({
      invite_id: inv.id, actor_id: user.id, action: 'declined', note: body.note ?? null,
    });

    await notify(supabase, otherSide, KIND.declined,
      `${myName} cannot make ${ev?.title ?? 'the meeting'}`,
      body.note ?? 'No reason given.', inv.event_id);

    return NextResponse.json({
      ok: true,
      message: 'Declined. They can see it on the meeting.',
      link: { href: `/dashboard/calendar?event=${inv.event_id}`, label: 'Open the meeting' },
    });
  }

  /* ---- propose a different time --------------------------------------- */
  if (action === 'propose') {
    if (!body.startAt) return NextResponse.json({ ok: false, message: 'What time are you suggesting?' });

    /* The ball changes hands. Either side can propose, so this is the
       same code for the invitee countering the invitation and for the
       organiser countering the counter, which is what lets it go back and
       forth for as long as it needs to. */
    await supabase.from('calendar_invites').update({
      status: 'proposed',
      proposed_start_at: body.startAt,
      proposed_end_at: body.endAt ?? null,
      awaiting: otherSide,
      rounds: (inv.rounds ?? 0) + 1,
      responded_at: new Date().toISOString(),
      note: body.note ?? null,
    }).eq('id', inv.id);

    await supabase.from('calendar_invite_messages').insert({
      invite_id: inv.id, actor_id: user.id, action: 'proposed',
      start_at: body.startAt, end_at: body.endAt ?? null, note: body.note ?? null,
    });

    await notify(supabase, otherSide, KIND.proposed,
      `${myName} suggested a different time for ${ev?.title ?? 'a meeting'}`,
      `${whenLabel(body.startAt)}. Accept it, decline it, or suggest another.`,
      inv.event_id);

    return NextResponse.json({
      ok: true,
      message: `Suggested ${whenLabel(body.startAt)}. It is with them now.`,
      link: { href: `/dashboard/calendar?event=${inv.event_id}`, label: 'Open the meeting' },
    });
  }

  return NextResponse.json({ ok: false, message: 'I did not understand that.' });
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
