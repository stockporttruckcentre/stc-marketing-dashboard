import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { sendFromStock } from '@/lib/crm/tracker-operations';

export const dynamic = 'force-dynamic';

/**
 * Send a stock trailer to the caller's own sales tracker.
 *
 * The operation itself is `command_send_from_stock`, wrapped by
 * `lib/crm/tracker-operations.ts`, which is what the command bar
 * reaches too. This route is the button; it decides nothing the
 * sentence path decides differently.
 *
 * The list is made on first use rather than refused. "You have no sales
 * tracker yet, open the tracker once to make one" was an error message
 * about the application's own bookkeeping.
 */
export async function POST(req: NextRequest) {
  /* This inserts a lead. A viewer could create one. */
  const gate = await requireCapability('crm.create');
  if (!gate.ok) return gate.response;
  const { supabase, user } = gate;

  const body = await req.json().catch(() => ({})) as { stock_trailer_id?: string };
  if (!body.stock_trailer_id) {
    return NextResponse.json({ error: 'stock_trailer_id required' }, { status: 400 });
  }

  const done = await sendFromStock(supabase as never, {
    trailerIds: [body.stock_trailer_id],
    ownerId: user.id,
  });
  if (!done.ok) return NextResponse.json({ error: done.why }, { status: 400 });

  return NextResponse.json({ ok: true, tracker_row_id: done.trackerRowId });
}
