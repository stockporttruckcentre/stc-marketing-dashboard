import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* A live contract that has finished.
 *
 * Its own state rather than declined or expired: both of those mean a
 * contract that was never won, and folding a completed one into either
 * puts a paying customer in the lost column and takes real revenue out
 * of every figure that reads it. See migration 071. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireCapability('fleetsmart.build');
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({}));
  const { data, error } = await gate.supabase.rpc('fleetsmart_end', {
    p_contract: params.id,
    p_note: typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, error: 'refused', message: error.message.replace(/^ERROR:\s*/, '') },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, contract: data });
}
