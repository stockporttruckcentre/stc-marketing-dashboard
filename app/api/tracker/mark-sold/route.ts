import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { markSold } from '@/lib/crm/mark-sold';

export const dynamic = 'force-dynamic';

/**
 * Mark a tracker row sold, and carry it through to the stock unit.
 *
 * The operation itself is in `lib/crm/mark-sold.ts`, which calls the
 * `command_mark_sold` function, so the command bar's `deal.markSold`
 * capability runs exactly this and not a second version of it. Two
 * implementations of a sale is how one of them ends up not cascading to
 * the other reps.
 *
 * The three writes are one transaction. This route used to do them as
 * three statements and report a partial failure, which left a deal
 * marked won against a unit still showing as available.
 *
 * The comment this route used to carry said RLS handles ownership, and
 * for the caller's own tracker row it does. It does not cover the two
 * things the operation also does: flipping a stock trailer to sold, and
 * reaching across into every other rep's tracker row for the same unit.
 * Neither of those is a statement about a row somebody owns.
 */
export async function POST(req: NextRequest) {
  const gate = await requireCapability('stock.edit');
  if (!gate.ok) return gate.response;
  const { supabase, user } = gate;

  const body = await req.json().catch(() => ({})) as {
    tracker_id?: string;
    sale_price?: number;
    profit?: number;
    commission?: number;
    dispatch_date?: string;
  };
  if (!body.tracker_id) return NextResponse.json({ error: 'tracker_id required' }, { status: 400 });

  const result = await markSold(supabase, user, {
    trackerId: body.tracker_id,
    salePrice: body.sale_price ?? null,
    profit: body.profit ?? null,
    commission: body.commission ?? null,
    dispatchDate: body.dispatch_date ?? null,
  });

  if (!result.ok) {
    /* No partial status to report. The three writes are one
       transaction, so nothing was changed. */
    return NextResponse.json(
      { error: result.error },
      { status: result.error.includes('not there') ? 404 : 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    commission: result.commission,
    stockUpdated: result.stockUpdated,
    stock_trailer_id: result.stockTrailerId,
    cascadedOthers: result.cascadedOthers,
  });
}
