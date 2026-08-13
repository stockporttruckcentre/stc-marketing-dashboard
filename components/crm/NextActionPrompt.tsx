'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Phone, StickyNote, FileText, Clock, X } from 'lucide-react';
import { Button, Label } from '@/components/kit/primitives';
import type { CRMContact } from '@/lib/types';

/**
 * Asked straight after a prospect is created.
 *
 * The problem it solves, from the meeting: people add a contact, get
 * dropped into a blank record, and the lead is never touched again. One
 * question with four answers is enough to stop that.
 */
export function NextActionPrompt({
  contact, onClose, onSchedule, onAddNote, onProposal,
}: {
  contact: CRMContact;
  onClose: () => void;
  onSchedule: () => void;
  onAddNote: () => void;
  onProposal: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function followUpIn(days: number) {
    setBusy(true);
    const when = new Date();
    when.setDate(when.getDate() + days);
    when.setHours(9, 0, 0, 0);
    await fetch('/api/crm/follow-up', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_id: contact.id, due_at: when.toISOString() }),
    }).catch(() => {});
    setBusy(false);
    onClose();
    router.refresh();
  }

  const OPTIONS = [
    { icon: Phone, label: 'Schedule a call', sub: 'Puts it in a diary', on: onSchedule },
    { icon: FileText, label: 'Generate a proposal', sub: 'Trailer sales, maintenance, rental or refurb', on: onProposal },
    { icon: StickyNote, label: 'Add a note', sub: 'What was said, what happens next', on: onAddNote },
    { icon: Clock, label: 'Remind me in a week', sub: 'Lands on your dashboard', on: () => followUpIn(7) },
  ];

  return (
    <div className="kit" onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(5,13,38,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 'min(460px, 100%)', background: 'var(--surface-raised)',
        border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
        boxShadow: 'var(--shadow-4)', padding: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <Label>Added {contact.company_name}</Label>
            <h3 style={{
              margin: '6px 0 0', fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 19,
              letterSpacing: '-0.025em', color: 'var(--text)',
            }}>What happens next?</h3>
          </div>
          <button onClick={onClose} aria-label="Skip"
            style={{ border: 'none', background: 'transparent', color: 'var(--text-subtle)', cursor: 'pointer', display: 'flex' }}>
            <X size={17} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 16 }}>
          {OPTIONS.map((o) => {
            const Icon = o.icon;
            return (
              <button
                key={o.label} onClick={o.on} disabled={busy}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
                  padding: '11px 13px', borderRadius: 'var(--r)',
                  border: '1px solid var(--border)', background: 'var(--surface)',
                  cursor: busy ? 'wait' : 'pointer', fontFamily: 'var(--inter)',
                }}
              >
                <Icon size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{o.label}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--text-subtle)' }}>{o.sub}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Not now</Button>
        </div>
      </div>
    </div>
  );
}
