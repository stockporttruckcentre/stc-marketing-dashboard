import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* =============================================================
   Putting a contract in front of the customer.

   `fleetsmart_send` in migration 061 does the work, and it is a
   function rather than an update because sending is the moment a price
   stops being a draft: it refuses a second send, refuses a contract
   with no assets on it, and stamps who and when.

   What this does NOT do is deliver an email. There is no outbound mail
   in this application yet, and a button that claimed to send one would
   be a button that quietly did nothing. It records that the contract
   went out, and the screen hands over the document to attach.
   ============================================================= */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireCapability('fleetsmart.send');
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({}));
  const { data, error } = await gate.supabase.rpc('fleetsmart_send', {
    p_contract: params.id,
    p_to: body.to?.trim() || null,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, error: 'refused', message: error.message.replace(/^ERROR:\s*/, '') },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, contract: data });
}
