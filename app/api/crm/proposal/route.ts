import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { PROPOSAL_KINDS, raiseProposal, toolReadyFor, type ProposalKind } from '@/lib/crm/tracker-operations';

export const dynamic = 'force-dynamic';

/**
 * Raise a proposal against a customer and say where to go next.
 *
 * The operation itself is `command_raise_proposal`, wrapped by
 * `lib/crm/tracker-operations.ts`, which is what the command bar
 * reaches too. Trailer sales and maintenance have a home already;
 * rental and refurb have no dedicated tool yet and land on the same
 * tracker rather than disappearing, and the caller is told which.
 */
export async function POST(req: NextRequest) {
  /* Raising a proposal writes a quoted row onto a tracker. crm.proposal
     existed as a capability and was never consulted. */
  const gate = await requireCapability('crm.proposal');
  if (!gate.ok) return gate.response;
  const { supabase, user } = gate;

  const { contact_id, kind, depots } = await req.json().catch(() => ({})) as {
    contact_id?: string; kind?: string; depots?: string[];
  };
  if (!contact_id || !kind || !PROPOSAL_KINDS.includes(kind as ProposalKind)) {
    return NextResponse.json({ error: 'need a contact and a proposal type' }, { status: 400 });
  }

  const done = await raiseProposal(supabase as never, {
    contactIds: [contact_id],
    kind: kind as ProposalKind,
    ownerId: user.id,
  });
  if (!done.ok) return NextResponse.json({ error: done.why }, { status: 400 });

  /* ---- The depots the work is for ----

     A second call rather than an argument to `command_raise_proposal`,
     because that function raises proposals for a LIST of customers and
     returns one row id. Adding an argument would make it look as though
     it set the depots on all of them.

     A refusal here is reported and the proposal STAYS. It is already
     raised and sitting on a tracker, and throwing it away because the
     depots would not save would lose the pitch to save a filter. The
     caller is told, and the drawer can set them. */
  let depotsSet: string[] = [];
  let depotError: string | null = null;
  if (done.rowId && Array.isArray(depots) && depots.length > 0) {
    const { data, error } = await (supabase as never as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
    }).rpc('lead_depots_set', { p_lead: done.rowId, p_depots: depots });
    if (error) depotError = error.message;
    else depotsSet = ((data ?? []) as { depot_id: string }[]).map((r) => r.depot_id);
  }

  return NextResponse.json({
    depots: depotsSet,
    depotError,
    ok: true,
    href: `/dashboard/leads?contact=${done.rowId}`,
    kind: done.kind,
    toolReady: toolReadyFor(done.kind),
  });
}
