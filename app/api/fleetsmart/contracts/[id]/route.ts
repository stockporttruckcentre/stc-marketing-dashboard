import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { priceContract } from '@/lib/fleetsmart/price';
import { readContractBody } from '@/lib/fleetsmart/wire';

export const dynamic = 'force-dynamic';

/* =============================================================
   Saving a draft, and throwing one away.

   Repriced on every save, for the same reason the create route prices
   rather than accepts: `priced` is the server's answer to `input`, not
   a value the client gets a say in.

   A contract that has been sent is not editable here. The policy in
   migration 061 says so as well, and this says it in words a person can
   read rather than as an empty result.
   ============================================================= */

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireCapability('fleetsmart.build');
  if (!gate.ok) return gate.response;
  const { supabase, caps } = gate;

  const { data: held } = await supabase
    .from('fleetsmart_contracts').select('status, sent_at').eq('id', params.id).maybeSingle();

  if (!held) {
    return NextResponse.json(
      { ok: false, error: 'not_found', message: 'That contract is not here, or is not yours to open.' },
      { status: 404 },
    );
  }
  if ((held as { status: string }).status !== 'draft') {
    return NextResponse.json(
      {
        ok: false,
        error: 'sent',
        message: 'That contract has already gone to the customer. Copy it to build a new one rather than changing what they were sent.',
      },
      { status: 409 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const read = readContractBody(body, caps.has('fleetsmart.discount'));
  if ('error' in read) {
    return NextResponse.json({ ok: false, error: 'bad_request', message: read.error }, { status: 400 });
  }

  const { input, extras } = read;
  const priced = priceContract(input);

  const { data, error } = await supabase
    .from('fleetsmart_contracts')
    .update({
      account_id: body.account_id || null,
      lead_id: body.lead_id || null,
      customer_name: input.customerName,
      plan: input.plan,
      term_months: input.termMonths,
      starts_on: input.startDate || null,
      input, priced, extras,
    })
    .eq('id', params.id)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: 'update_failed', message: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, contract: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireCapability('fleetsmart.build');
  if (!gate.ok) return gate.response;

  const { error } = await gate.supabase
    .from('fleetsmart_contracts').delete().eq('id', params.id);

  if (error) {
    return NextResponse.json({ ok: false, error: 'delete_failed', message: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
