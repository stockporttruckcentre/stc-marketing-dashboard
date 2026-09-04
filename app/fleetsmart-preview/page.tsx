'use client';

/* =============================================================
   The FleetSmart+ contract, in the drawer it prints from. Dev only.

   ---- Why this exists ----

   From the business:

     when you save a PDF either from the builder wizard or the popup
     allowing you to enter email addresses to send it to, there's a
     large white space on the left of the PDF, the actual fleetsmart+
     contract covers 50% of the width of the PDF

   That fault lives entirely in the print stylesheet, and a print
   stylesheet is the one thing in a web application that cannot be
   checked by looking at the screen: the screen is correct, and always
   was. It can only be checked by producing a PDF and looking at that.

   So this mounts the real document inside the real `Drawer`, with the
   real `ContractPrintRules`, against a fabricated contract. Print it,
   or point a headless browser at it, and what comes out is what a
   customer would have received.

   `notFound()` in production, like the two harnesses next door, so it
   is never reachable on a deployment.
   ============================================================= */

import { useState } from 'react';
import { notFound } from 'next/navigation';
import { FileText } from 'lucide-react';
import { Button } from '@/components/kit/primitives';
import { Drawer } from '@/components/kit/forms';
import { ContractDocument, ContractPrintRules } from '@/components/fleetsmart/document';
import { blankContract, blankExtras } from '@/lib/fleetsmart/contract';
import { blankAsset, priceContract } from '@/lib/fleetsmart/price';
import type { AssetType, ContractInput } from '@/lib/fleetsmart/types';

/* A fleet with one of each class on it, so the schedule, the class
   column and the flags that decide the wording all have something real
   to say. Registrations are made up. */
const FLEET: [string, AssetType][] = [
  ['MX21 KJV', '6x2 Truck'],
  ['MX21 KJW', '6x2 Truck'],
  ['YE19 HDO', '2 Axle Rigid'],
  ['C374619', '3 Axle Trailer'],
  ['C374620', '3 Axle Trailer'],
  ['MJ70 ZTH', 'LCV'],
];

const INPUT: ContractInput = {
  ...blankContract(),
  startDate: '2026-04-01',
  customerName: 'Dawson Group Haulage Limited',
  customerAddress: 'Brinksway, Stockport, SK3 0BY',
  customerContact: 'Julie Barnes, Transport Manager',
  assets: FLEET.map(([reg, type], i) => ({
    ...blankAsset(`a${i}`, 'Platinum'),
    reg,
    type,
    age: 3,
    mileagePerYear: 82_000,
  })),
};

const EXTRAS = {
  ...blankExtras(),
  companyNumber: '04728311',
  registeredAddress: 'Brinksway, Stockport, Cheshire, SK3 0BY',
  accountManagerName: 'Dave Sherratt',
  accountManagerPhone: '0161 480 3535',
  accountManagerEmail: 'dave@stockporttruckcentre.co.uk',
};

export default function FleetSmartPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    /* THE SHELL, BECAUSE THE SHELL IS WHERE THE BUG LIVED.

       `.app` is a two column grid with a 248px sidebar and `.main` is
       `position: relative`. Those two rules, and nothing inside the
       drawer, are what put a white band down the left of every printed
       sheet. A harness that renders the drawer on a bare page prints
       perfectly and proves nothing, which is the trap this note exists
       to stop somebody walking into. */
    <div className="app">
      <div className="sidebar" style={{ padding: 16 }}>
        <span style={{ fontSize: 12, opacity: 0.6 }}>Sidebar stand-in, 248px</span>
      </div>
      <div className="main">
        <div className="topbar" />
        <main className="page">
          <Harness />
        </main>
      </div>
    </div>
  );
}

function Harness() {
  const [variant, setVariant] = useState<'contract' | 'proposal'>('contract');
  const priced = priceContract(INPUT);

  return (
    <Drawer
      eyebrow="Preview harness"
      title="FleetSmart+ Platinum"
      icon={<FileText size={17} />}
      onClose={() => {}}
      width={880}
      footer={
        <>
          <Button
            size="sm"
            variant={variant === 'proposal' ? 'primary' : 'secondary'}
            onClick={() => setVariant((v) => (v === 'proposal' ? 'contract' : 'proposal'))}
          >
            {variant === 'proposal' ? 'Showing the proposal' : 'Show the proposal'}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => window.print()}>Print</Button>
          <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
            Print this, or render it headless. The screen was never the problem.
          </span>
        </>
      }
    >
      <div className="fs-doc-frame" style={{
        border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden',
      }}>
        <ContractDocument
          input={INPUT}
          priced={priced}
          extras={EXTRAS}
          reference="FS-2026-0148"
          variant={variant}
        />
      </div>
      <ContractPrintRules />
    </Drawer>
  );
}
