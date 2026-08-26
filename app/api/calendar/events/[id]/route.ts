import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { inviteToMeeting } from '@/lib/calendar/invitations';
import { readEventBody } from '@/lib/calendar/wire';

export const dynamic = 'force-dynamic';

/* =============================================================
   Changing one, and calling one off.

   ---- Adding somebody to a meeting that already exists ----

   Saving an edit invites anybody on the attendee list who has not been
   asked yet, and does not re-ask anybody who has. That matters:
   `command_meeting_invite` resets an invitation it finds to `pending`,
   so re-sending the whole list every save would wipe out the fact that
   Tom accepted on Tuesday and put the meeting back to waiting on him.

   Taking somebody off the list does not withdraw their invitation. That
   is deliberate. Withdrawing tells them, and it is its own action on
   the meeting rather than a side effect of an edit somebody made for a
   different reason.
   ============================================================= */

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
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
    .update(row)
    .eq('id', params.id)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: 'update_failed', message: error.message }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, error: 'not_found', message: 'That entry is not here, or is not yours to change.' },
      { status: 404 },
    );
  }

  /* Only the people who have not been asked. See the header: re-sending
     an invitation somebody has already accepted puts it back to
     pending, and an edit to the room number would un-accept the room. */
  const { data: already } = await supabase
    .from('calendar_invites').select('user_id').eq('event_id', params.id);
  const asked = new Set(((already ?? []) as { user_id: string }[]).map((i) => i.user_id));
  const fresh = invite.filter((id) => !asked.has(id));

  if (!fresh.length) return NextResponse.json({ ok: true, event: data, invited: 0 });

  const sent = await inviteToMeeting(supabase, {
    eventIds: [params.id], userIds: fresh, note: null,
  });
  if (!sent.ok) {
    return NextResponse.json({
      ok: true, event: data, invited: 0,
      warning: `The changes are saved, but the new invitations did not go out. ${sent.why}`,
    });
  }
  return NextResponse.json({ ok: true, event: data, invited: sent.sent });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireCapability('crm.delegate');
  if (!gate.ok) return gate.response;

  /* The invitations go with it, by the ON DELETE CASCADE in migration
     006. Nobody is told, which is the one thing worth knowing about
     deleting a meeting rather than withdrawing from it. */
  const { error } = await gate.supabase
    .from('calendar_events').delete().eq('id', params.id);

  if (error) {
    return NextResponse.json({ ok: false, error: 'delete_failed', message: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
