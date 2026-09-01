import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { priceContract } from '@/lib/fleetsmart/price';
import { readContractBody } from '@/lib/fleetsmart/wire';
import { describeAmendment, nothingChanged } from '@/lib/fleetsmart/amend';
import { cardFrom, SHIPPED_CARD } from '@/lib/fleetsmart/ratecard';

export const dynamic = 'force-dynamic';

/* =============================================================
   Amending a live contract.

   ---- The price is worked out here, same as it always is ----

   The body carries the fleet and the plan as they will be after the
   change. It does not carry a price, and this would ignore one. Both
   versions are priced on the server, out of the same engine, and the
   difference between them is computed rather than accepted.

   That matters more on an amendment than on a new contract. A new
   contract's total is checked by whoever signs it. An amendment moves a
   direct debit that is already running, and nobody re-reads a bill that
   only went up by a little.

   ---- What is stored ----

   The whole contract at the new version, the whole priced snapshot, and
   the summary in sentences. Migration 072 says why all three: a delta
   cannot be printed, and printing what the customer agreed to on a
   given day is what the table exists for.
   ============================================================= */

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireCapability('fleetsmart.build');
  if (!gate.ok) return gate.response;
  const { supabase, caps } = gate;

  const body = await req.json().catch(() => ({}));

  const read = readContractBody(body, caps.has('fleetsmart.discount'));
  if ('error' in read) {
    return bad(read.error);
  }

  const effective = typeof body.effective_on === 'string' ? body.effective_on.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective)) {
    return bad('An amendment needs a date it takes effect from, for the billing run.');
  }

  /* The contract as it stands, which is what the change is measured
     against. Read here rather than sent, because the browser's idea of
     the current version can be a page refresh out of date and an
     amendment computed against a stale baseline describes changes that
     did not happen. */
  const { data: held, error: readErr } = await supabase
    .from('fleetsmart_contracts')
    .select('id, status, input, rate_card_version')
    .eq('id', params.id)
    .single();

  if (readErr || !held) {
    return bad('That contract is not here, or is not one you can see.');
  }
  if (held.status !== 'accepted') {
    return bad(
      `Only a live contract can be amended, and that one is ${held.status}. `
      + 'A draft is edited in the builder.',
    );
  }

  /* The card the contract is on, so an amendment does not silently
     reprice the untouched half of the fleet at this month's rates. */
  const { data: cardRow } = await supabase
    .from('fleetsmart_rate_cards')
    .select('version, card')
    .eq('version', held.rate_card_version)
    .maybeSingle();

  const card = cardRow
    ? cardFrom((cardRow as { card: unknown }).card, (cardRow as { version: string }).version)
    : SHIPPED_CARD;

  const before = held.input as Parameters<typeof priceContract>[0];
  const after = read.input;

  const pricedBefore = priceContract(before, card);
  const pricedAfter = priceContract(after, card);
  const summary = describeAmendment(before, after, pricedBefore, pricedAfter, card);

  if (nothingChanged(summary)) {
    return bad('Nothing on the contract changed, so there is no amendment to record.');
  }

  const { data, error } = await supabase.rpc('fleetsmart_amend', {
    p_contract: params.id,
    p_input: after,
    p_priced: pricedAfter,
    p_summary: summary,
    p_effective_on: effective,
    p_note: typeof body.note === 'string' ? body.note : null,
    p_rate_card: card.version,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, error: 'refused', message: error.message.replace(/^ERROR:\s*/, '') },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, amendment: data, summary });
}

function bad(message: string) {
  return NextResponse.json({ ok: false, error: 'bad_request', message }, { status: 400 });
}
