import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* Taking a contract back to a draft so it can be edited.
 *
 * The permission that sets prices rather than the one that builds a
 * contract, because this is the act of changing a number a customer has
 * already seen. The row records that it happened and what state it came
 * back from, so a price that moved after the customer saw it is a fact
 * anybody can read. See migration 071. */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireCapability('fleetsmart.discount');
  if (!gate.ok) return gate.response;

  const { data, error } = await gate.supabase.rpc('fleetsmart_reopen', {
    p_contract: params.id,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, error: 'refused', message: error.message.replace(/^ERROR:\s*/, '') },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, contract: data });
}
