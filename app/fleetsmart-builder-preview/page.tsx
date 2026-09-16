'use client';

import { notFound } from 'next/navigation';
import { ContractWizard } from '@/components/fleetsmart/wizard';
import { SHIPPED_CARD, cardFrom } from '@/lib/fleetsmart/ratecard';
import { blankAsset } from '@/lib/fleetsmart/price';
import { blankContract, blankExtras } from '@/lib/fleetsmart/contract';

/* =============================================================
   The FleetSmart+ builder, for driving. Dev only.

   From the sales team, and confirmed by the business:

     check tacho graph in fleetsmart+, adding one to an asset doesnt
     update the cost?

   The arithmetic behind that is held by `check:fleetsmart-ratecard`.
   This is the other half: the SCREEN. The fault was only ever visible
   as a number that did not move when a control did, and the only way
   to see that is to move the control and read the number.

   ---- The card this mounts with ----

   Not the shipped one. A card with van tachograph rates on it, which is
   what the business has just put into the rate editor, because the
   whole fault was that the builder read the shipped card whatever the
   editor said. A harness that mounted the shipped card would pass with
   the bug still in.

   `?card=shipped` mounts the shipped one instead, so the check can
   assert the other side of it: on a card with no van rate, the control
   is disabled and says why rather than moving and doing nothing.

   `notFound()` in production, like the harnesses next door.
   ============================================================= */

/** The card the business has typed van rates into. */
const WITH_VAN_RATES = cardFrom({
  ...SHIPPED_CARD,
  rates: SHIPPED_CARD.rates.map((r) =>
    (r.cls === 'Van' && /Tacho|DTCO/.test(r.line) ? { ...r, axle: [95, 95, 95, 95] } : r)),
}, 'test-van-tacho');

export default function BuilderPreview({
  searchParams,
}: {
  searchParams: { card?: string };
}) {
  if (process.env.NODE_ENV === 'production') notFound();

  const card = searchParams.card === 'shipped' ? SHIPPED_CARD : WITH_VAN_RATES;

  /* One van and one truck, both already registered and typed, so the
     screen opens on a fleet that prices rather than on an empty row. */
  const base = blankContract();
  const input = {
    ...base,
    plan: 'Gold' as const,
    customerName: 'A Haulier Limited',
    customerAddress: 'Brinksway, Stockport',
    customerContact: 'Julie Barnes',
    startDate: '2026-10-01',
    assets: [
      { ...blankAsset('van1', 'Gold'), reg: 'VAN 1', type: 'LCV' as const, tacho: 'none' as const },
      { ...blankAsset('hgv1', 'Gold'), reg: 'HGV 1', type: '6x2 Truck' as const, tacho: '2yr' as const },
    ],
  };

  return (
    <ContractWizard
      accounts={[]}
      leads={[]}
      initial={{ input, extras: blankExtras(), accountId: null, leadId: null }}
      contractId={null}
      reference={null}
      may={() => true}
      card={card}
      onClose={() => {}}
      onSaved={() => {}}
    />
  );
}
