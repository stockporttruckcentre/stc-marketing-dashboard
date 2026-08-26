import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { priceContract } from '@/lib/fleetsmart/price';
import { readContractBody } from '@/lib/fleetsmart/wire';

export const dynamic = 'force-dynamic';

/* =============================================================
   Building a FleetSmart+ contract.

   ---- The price is worked out here, not sent here ----

   The body carries `input`: the plan, the term, the fleet and the
   discounts. It does not carry a price, and the route would ignore one
   if it did. `priceContract` runs on the server against the same rate
   card the screen ran it against, and what it returns is what gets
   stored and what the document prints.

   That is not belt and braces. The wizard prices as somebody types
   because a salesman needs the number to move while they are talking,
   and a price a browser could post is a price a browser could choose.
   The two engines are the same file, so the figure on screen and the
   figure in the database agree without either trusting the other.

   The manager's discount is the exception that proves it: it is dropped
   unless the person holds `fleetsmart.discount`, so somebody without it
   can type one into a form they have modified and still not get it.
   ============================================================= */

export async function POST(req: NextRequest) {
  const gate = await requireCapability('fleetsmart.build');
  if (!gate.ok) return gate.response;
  const { supabase, user, caps } = gate;

  const body = await req.json().catch(() => ({}));
  const read = readContractBody(body, caps.has('fleetsmart.discount'));
  if ('error' in read) {
    return NextResponse.json({ ok: false, error: 'bad_request', message: read.error }, { status: 400 });
  }

  const { input, extras } = read;
  const priced = priceContract(input);

  const { data, error } = await supabase
    .from('fleetsmart_contracts')
    .insert({
      account_id: body.account_id || null,
      lead_id: body.lead_id || null,
      customer_name: input.customerName,
      plan: input.plan,
      term_months: input.termMonths,
      starts_on: input.startDate || null,
      input, priced, extras,
      owner_id: user.id,
      created_by: user.id,
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: 'create_failed', message: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, contract: data });
}
