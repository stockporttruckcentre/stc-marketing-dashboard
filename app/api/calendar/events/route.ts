import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { inviteToMeeting } from '@/lib/calendar/invitations';
import { readEventBody } from '@/lib/calendar/wire';

export const dynamic = 'force-dynamic';

/* =============================================================
   Booking something into the diary.

   ---- Why this is a route and not an insert from the browser ----

   The calendar has always inserted straight into `calendar_events` from
   the client, and so has the CRM's schedule button. That works, because
   row level security scopes it. What it cannot do is the second half of
   booking a meeting: asking the people on it.

   Attendees were a JSONB list of names. Nobody was told, nobody could
   accept, nobody could say Thursday would be better. Migration 006 has
   had the invitation tables since it went in, and migration 021 has had
   `command_meeting_invite`, and neither had a screen.

   So the event and the invitations are written together, here, in that
   order, because an invitation to a meeting that does not exist yet is
   an invitation to nothing.

   ---- What happens when the invitations fail ----

   The event stays. It is a real booking whether or not the asking
   worked, and deleting it would take somebody's meeting away because a
   colleague's account was in a bad state. The response says plainly
   that the meeting is in and the invitations are not, which is the
   thing somebody can act on.
   ============================================================= */

export async function POST(req: NextRequest) {
  const gate = await requireCapability('crm.delegate');
  if (!gate.ok) return gate.response;
  const { supabase, user } = gate;

  const read = readEventBody(await req.json().catch(() => ({})), user.id);
  if ('error' in read) {
    return NextResponse.json({ ok: false, error: 'bad_request', message: read.error }, { status: 400 });
  }
  const { row, invite } = read;

  const { data, error } = await supabase
    .from('calendar_events')
    .insert({ ...row, created_by: user.id })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: 'create_failed', message: error.message }, { status: 400 });
  }

  const event = data as { id: string; title: string };
  if (!invite.length) {
    return NextResponse.json({ ok: true, event, invited: 0 });
  }

  const sent = await inviteToMeeting(supabase, {
    eventIds: [event.id],
    userIds: invite,
    note: row.description ?? null,
  });

  if (!sent.ok) {
    return NextResponse.json({
      ok: true,
      event,
      invited: 0,
      warning: `${event.title} is in the diary, but the invitations did not go out. ${sent.why}`,
    });
  }

  return NextResponse.json({ ok: true, event, invited: sent.sent });
}
