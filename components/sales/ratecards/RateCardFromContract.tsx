'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileSpreadsheet, ExternalLink } from 'lucide-react';
import { Alert, Button, Label } from '@/components/kit/primitives';
import { createClient } from '@/lib/supabase/client';

/* =============================================================
   The rate card that came with this contract, offered beside it.

   From the business:

     Ensure in the fs+ builder when presented with options to download
     the contract you can generate/download the rate card.

   It never creates one. Migration 113 makes the card the moment the
   contract row lands, so by the time somebody reaches the review step
   there is one to find. If there is not, that is worth saying rather
   than hiding: a contract whose account is not a CRM customer has
   nobody to make a rate card for.
   ============================================================= */
export function RateCardFromContract({ contractId, customer }: {
  contractId: string | null;
  customer: string;
}) {
  const [card, setCard] = useState<{ card_id: string; card_ref: string; card_status: string } | null>(null);
  const [state, setState] = useState<'idle' | 'looking' | 'none' | 'refused'>('idle');
  const [why, setWhy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!contractId) { setState('idle'); return; }
    let alive = true;
    setState('looking');
    void createClient()
      .rpc('rate_card_of_contract', { p_contract: contractId })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) { setState('refused'); setWhy(error.message); return; }
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) { setState('none'); return; }
        setCard(row);
        setState('idle');
      });
    return () => { alive = false; };
  }, [contractId]);

  const download = async () => {
    if (!card) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/rate-cards/${card.card_id}/export?format=xlsx`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'The rate card could not be built.' }));
        setWhy(body.error ?? 'The rate card could not be built.');
        return;
      }
      const name = res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]
        ?? `${customer} - Customer Rates.xlsx`;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
      <Label>Their rate card</Label>
      <span style={{ fontSize: 12, color: 'var(--text-subtle)', flex: 1, minWidth: 220 }}>
        {!contractId
          ? 'Made automatically once this contract is saved, with the inclusions read from it.'
          : state === 'looking' ? 'Looking for it.'
          : state === 'none' ? 'None yet. A rate card needs the contract to name a CRM customer.'
          : state === 'refused' ? (why ?? 'It could not be read.')
          : `${card?.card_ref}, ${card?.card_status}. What they are charged per hour and per job, outside the contract.`}
      </span>

      <Button
        size="sm" variant="secondary"
        disabled={!card || busy}
        title={!contractId ? 'Save the contract first'
          : !card ? 'There is no rate card for this contract yet'
          : 'Download the rate card as the customer’s workbook'}
        onClick={() => { void download(); }}
      >
        <FileSpreadsheet size={13} /> {busy ? 'Building' : 'Download rate card'}
      </Button>

      {card && (
        <Link href={`/dashboard/rate-cards?card=${card.card_id}`} target="_blank">
          <Button size="sm" variant="secondary">
            <ExternalLink size={13} /> Open it
          </Button>
        </Link>
      )}
    </div>
  );
}
