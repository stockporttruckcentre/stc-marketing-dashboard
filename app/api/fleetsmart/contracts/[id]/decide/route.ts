import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* What the customer said. Recorded rather than inferred, because a
   contract nobody answers and a contract somebody declined look
   identical from the outside and are worth very different amounts of
   follow-up. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireCapability('fleetsmart.build');
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({}));
  const status = String(body.status ?? '');
  if (!['accepted', 'declined', 'expired'].includes(status)) {
    return NextResponse.json(
      { ok: false, error: 'bad_request', message: 'A contract is accepted, declined or expired.' },
      { status: 400 },
    );
  }

  const { data, error } = await gate.supabase.rpc('fleetsmart_decide', {
    p_contract: params.id,
    p_status: status,
    p_note: body.note?.trim() || null,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, error: 'refused', message: error.message.replace(/^ERROR:\s*/, '') },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, contract: data });
}
