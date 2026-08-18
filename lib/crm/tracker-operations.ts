/* =============================================================
   Two operations the tracker performs, in one place.

   Sending a stock unit to somebody's tracker, and raising a proposal
   against a customer. Both were route bodies, which meant the command
   bar could only reach them by somebody writing what they do a second
   time, and two implementations of one operation is how one of them
   stops carrying the relationship across or stops filling in the side
   of the business.

   The operations themselves are `command_send_from_stock` and
   `command_raise_proposal` in migration 020. This is the thin wrapper
   the routes use; the command runtime reaches the same functions
   through its capability registry. Neither caller knows what the other
   is doing, and there is one description of the work.

   Nothing here decides permission. Both callers gate first, and the
   functions are SECURITY INVOKER and ask for the capability themselves,
   so this widens nothing.
   ============================================================= */

/** The narrowest slice of the client this needs. */
type Rpc = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export type TrackerOutcome<T> =
  | ({ ok: true } & T)
  | { ok: false; why: string };

const failed = (error: unknown): string =>
  String((error as { message?: string })?.message ?? error);

/**
 * Put stock units on somebody's tracker as leads.
 *
 * Every unit or none. A unit that is not there, or that row level
 * security withholds, takes the whole call with it rather than leaving
 * somebody to work out which of six arrived.
 */
export async function sendFromStock(
  client: Rpc,
  input: { trailerIds: string[]; ownerId?: string | null },
): Promise<TrackerOutcome<{ listId: string; made: number; trackerRowId: string | null }>> {
  const { data, error } = await client.rpc('command_send_from_stock', {
    p_trailers: input.trailerIds,
    p_owner: input.ownerId ?? null,
  });
  if (error) return { ok: false, why: failed(error) };

  const body = (data ?? {}) as { listId?: string; made?: number; trackerRowId?: string };
  return {
    ok: true,
    listId: String(body.listId ?? ''),
    made: body.made ?? 0,
    trackerRowId: body.trackerRowId ?? null,
  };
}

/** What a proposal can be about. The four the business runs. */
export const PROPOSAL_KINDS = ['trailer_sales', 'maintenance', 'rental', 'refurb'] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

/**
 * Raise a proposal against customers.
 *
 * Trailer sales and maintenance have a home already. Rental and refurb
 * have no dedicated tool yet and land on the same tracker rather than
 * disappearing, which is what the screen does and why.
 */
export async function raiseProposal(
  client: Rpc,
  input: { contactIds: string[]; kind: ProposalKind; ownerId?: string | null },
): Promise<TrackerOutcome<{ listId: string; made: number; kind: string; rowId: string | null }>> {
  const { data, error } = await client.rpc('command_raise_proposal', {
    p_contacts: input.contactIds,
    p_kind: input.kind,
    p_owner: input.ownerId ?? null,
  });
  if (error) return { ok: false, why: failed(error) };

  const body = (data ?? {}) as { listId?: string; made?: number; kind?: string; rowId?: string };
  return {
    ok: true,
    listId: String(body.listId ?? ''),
    made: body.made ?? 0,
    kind: String(body.kind ?? input.kind),
    rowId: body.rowId ?? null,
  };
}

/** Whether this application has a screen for that kind of proposal yet. */
export const toolReadyFor = (kind: string): boolean =>
  kind === 'trailer_sales' || kind === 'maintenance';
