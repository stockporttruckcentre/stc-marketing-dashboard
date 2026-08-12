'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Container, Wrench, KeyRound, Hammer, ArrowRight, X } from 'lucide-react';
import { Button, Label, SectionHead, Badge } from '@/components/kit/primitives';
import type { CRMContact } from '@/lib/types';

/**
 * Which kind of proposal, then off to the right tool with the customer
 * already filled in.
 *
 * Two of the four destinations do not exist yet: the rental generator and
 * the refurb quote are new builds. Rather than pretend, those options say
 * so and offer the nearest thing, which is raising the proposal on the
 * tracker so the work is not lost.
 */
const KINDS = [
  {
    id: 'trailer_sales', label: 'Trailer sales', icon: Container,
    blurb: 'A unit from stock, or a new build',
    ready: true,
  },
  {
    id: 'maintenance', label: 'Maintenance', icon: Wrench,
    blurb: 'Servicing, inspections, a contract',
    ready: true,
  },
  {
    id: 'rental', label: 'Rental', icon: KeyRound,
    blurb: 'Short or long term hire',
    ready: false,
  },
  {
    id: 'refurb', label: 'Refurb', icon: Hammer,
    blurb: 'Repaint, re-deck, bodywork',
    ready: false,
  },
] as const;

export function GenerateProposalPicker({
  contact, onClose,
}: { contact: CRMContact; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(kind: typeof KINDS[number]) {
    setBusy(kind.id); setError(null);
    const res = await fetch('/api/crm/proposal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_id: contact.id, kind: kind.id }),
    }).then((r) => r.json()).catch((e) => ({ error: e.message }));
    setBusy(null);
    if (res.error) { setError(res.error); return; }
    router.push(res.href);
    onClose();
  }

  return (
    <div className="kit" onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(5,13,38,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 'min(520px, 100%)', background: 'var(--surface-raised)',
        border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
        boxShadow: 'var(--shadow-4)', padding: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 4 }}>
          <div style={{ flex: 1 }}>
            <Label>Proposal for</Label>
            <div style={{
              fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 19,
              letterSpacing: '-0.02em', color: 'var(--text)', marginTop: 4,
            }}>{contact.company_name}</div>
          </div>
          <button onClick={onClose} aria-label="Close"
            style={{ border: 'none', background: 'transparent', color: 'var(--text-subtle)', cursor: 'pointer', display: 'flex' }}>
            <X size={17} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16 }}>
          {KINDS.map((k) => {
            const Icon = k.icon;
            return (
              <button
                key={k.id}
                onClick={() => pick(k)}
                disabled={!!busy}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6,
                  padding: 13, borderRadius: 'var(--r-md)', textAlign: 'left',
                  border: '1px solid var(--border)', background: 'var(--surface)',
                  cursor: busy ? 'wait' : 'pointer', fontFamily: 'var(--inter)',
                  transition: 'border-color 120ms cubic-bezier(0.2,0,0,1)',
                }}
              >
                <Icon size={17} style={{ color: 'var(--accent)' }} />
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{k.label}</span>
                <span style={{ fontSize: 12, color: 'var(--text-subtle)', lineHeight: 1.4 }}>{k.blurb}</span>
                {!k.ready && <Badge tone="warning">Tool not built yet</Badge>}
              </button>
            );
          })}
        </div>

        {error && (
          <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--danger)' }}>{error}</div>
        )}

        <div style={{ marginTop: 14, fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.5 }}>
          Rental and refurb still raise the proposal against this customer on your tracker.
          They just have nowhere specialised to send you yet.
        </div>
      </div>
    </div>
  );
}
