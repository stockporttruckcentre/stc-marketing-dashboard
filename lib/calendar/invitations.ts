/* =============================================================
   Meeting invitations, in one place.

   Five things happen to an invitation and they are all the same shape:
   somebody acts, the standing changes, a line goes into the history, and
   the other side gets told.

     invite    the organiser asks somebody
     accept    it goes in their diary and the organiser is told
     decline   they are not coming, with a reason if they gave one
     propose   they want a different time, and now the organiser answers
     withdraw  the organiser takes the invitation back

   All of it was the body of `app/api/calendar/invite`, which meant the
   command bar could reach none of it without somebody writing the same
   sequence a second time.

   The operations themselves are `command_meeting_invite`,
   `command_meeting_answer` and `command_reschedule_meeting` in migration
   021. This is the thin wrapper the route uses; the command bar reaches
   the same functions through its capability registry. There is one
   description of the work and neither caller knows about the other.

   Nothing here decides permission. The functions are SECURITY INVOKER,
   they ask for `crm.delegate` themselves, and row level security still
   decides who may see and change a meeting.
   ============================================================= */

/** The narrowest slice of the client this needs. */
type Rpc = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export type InvitationOutcome<T> = ({ ok: true } & T) | { ok: false; why: string };

const failed = (error: unknown): string =>
  String((error as { message?: string })?.message ?? error);

/** What somebody can do to an invitation once it exists. */
export const INVITE_ACTIONS = ['accept', 'decline', 'propose', 'withdraw'] as const;
export type InviteAction = (typeof INVITE_ACTIONS)[number];

/**
 * Ask people to a meeting.
 *
 * Every person or none. Somebody who cannot be invited takes the whole
 * call with it rather than leaving the organiser to work out which two
 * of five were asked.
 */
export async function inviteToMeeting(
  client: Rpc,
  input: { eventIds: string[]; userIds: string[]; note?: string | null },
): Promise<InvitationOutcome<{ sent: number; inviteId: string | null }>> {
  const { data, error } = await client.rpc('command_meeting_invite', {
    p_events: input.eventIds,
    p_users: input.userIds,
    p_note: input.note ?? null,
  });
  if (error) return { ok: false, why: failed(error) };

  const body = (data ?? {}) as { sent?: number; inviteId?: string };
  return { ok: true, sent: body.sent ?? 0, inviteId: body.inviteId ?? null };
}

/**
 * Answer one.
 *
 * Accepting a proposal is not a separate verb: whoever accepts is
 * accepting whatever time is on the table, and if that is a proposal the
 * meeting moves to it and everybody on it is told.
 */
export async function answerInvitation(
  client: Rpc,
  input: {
    inviteId: string;
    action: InviteAction;
    startAt?: string | null;
    endAt?: string | null;
    note?: string | null;
  },
): Promise<InvitationOutcome<{ said: string; movedTo: string | null }>> {
  const { data, error } = await client.rpc('command_meeting_answer', {
    p_invite: input.inviteId,
    p_action: input.action,
    p_start: input.startAt ?? null,
    p_end: input.endAt ?? null,
    p_note: input.note ?? null,
  });
  if (error) return { ok: false, why: failed(error) };

  const body = (data ?? {}) as { said?: string; movedTo?: string };
  return { ok: true, said: body.said ?? 'Done.', movedTo: body.movedTo ?? null };
}

/**
 * Move a meeting, keeping its length.
 *
 * What somebody dragging the block across the calendar gets. Writing the
 * start alone would leave a meeting that finishes before it begins.
 */
export async function rescheduleMeeting(
  client: Rpc,
  input: { eventIds: string[]; startAt: string },
): Promise<InvitationOutcome<{ moved: { name: string; was: string; now: string }[] }>> {
  const { data, error } = await client.rpc('command_reschedule_meeting', {
    p_events: input.eventIds,
    p_start: input.startAt,
  });
  if (error) return { ok: false, why: failed(error) };

  return {
    ok: true,
    moved: (Array.isArray(data) ? data : []) as { name: string; was: string; now: string }[],
  };
}
