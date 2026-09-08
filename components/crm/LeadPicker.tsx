'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Briefcase, Loader, Search } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Alert, Badge, Button, EmptyState, SearchInput } from '@/components/kit/primitives';
import { Modal } from '@/components/kit/forms';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/crm/status';
import type { ContactStatus } from '@/lib/types';

/* =============================================================
   Putting a unit onto a deal that already exists.

   ---- Why this is not "send to tracker" ----

   From the business:

     move one to an existing lead from the stock page itself

   The stock page has had a Send to tracker button for a long time and it
   does something different: it RAISES a lead, against a customer it has
   to invent, owned by whoever pressed it. That is the right thing when
   somebody walks in off the street about a specific unit, and the wrong
   thing when the deal is already open, because it leaves two deals for
   one conversation and the customer's name on neither of them.

   This attaches the unit to a quote that is already being worked. The
   customer is whoever that quote is with, and the owner does not change:
   adding a second unit to Dean's quote does not make it your deal.

   ---- What is offered ----

   Trailer sales leads that are still open, newest first, searchable by
   customer. Won and lost deals are reachable by searching for them,
   because "which trailer did we sell them" is a real reason to attach
   one after the fact, and a list of finished deals is not what somebody
   quoting a unit today wants to scroll past.
   ============================================================= */

type Row = {
  id: string;
  company_name: string | null;
  status: ContactStatus;
  type: string | null;
  requirement: string | null;
  estimated_value: number | null;
  owner: { full_name: string | null; email: string } | null;
};

const OPEN: ContactStatus[] = ['lead', 'contacted', 'quoted', 'won'];

export function LeadPicker({ trailerLabel, onPick, onClose }: {
  /** What is being attached, so the dialog can say it. */
  trailerLabel: string;
  onPick: (lead: Row) => Promise<string | null>;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('crm_leads')
      .select('id, company_name, status, type, requirement, estimated_value, owner:profiles!crm_leads_owner_id_fkey ( full_name, email )')
      .eq('type', 'trailer_sales');

    const text = query.trim();
    if (text) q = q.ilike('company_name', `%${text}%`);
    else q = q.in('status', OPEN);

    const { data, error: err } = await q
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .limit(30);
    if (err) setError(err.message);
    setRows((data ?? []) as unknown as Row[]);
    setLoading(false);
  }, [supabase, query]);

  useEffect(() => {
    const handle = setTimeout(() => { void load(); }, 220);
    return () => clearTimeout(handle);
  }, [load]);

  return (
    <Modal
      title="Add this unit to a deal"
      description={`${trailerLabel} will show on the deal you pick, and the deal will show on this stock record.`}
      width={620}
      onClose={onClose}
      footer={<Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>}
    >
      {error && <Alert tone="danger">{error}</Alert>}

      <SearchInput value={query} onChange={setQuery}
        placeholder="Search by customer, or leave blank for open deals"
        icon={<Search size={14} />} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto' }}>
        {loading && rows.length === 0 && (
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', padding: '10px 2px', fontSize: 12.5, color: 'var(--text-muted)' }}>
            <Loader size={12} className="spin" /> Looking
          </div>
        )}

        {!loading && rows.length === 0 && (
          <EmptyState
            what={query.trim() ? 'No trailer sales deal for that customer.' : 'No open trailer sales deals.'}
            why="Send to tracker raises a new one against this unit instead."
          />
        )}

        {rows.map((l) => (
          <div key={l.id} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 10px', borderRadius: 'var(--r)',
            background: 'var(--surface-sunken)', border: '1px solid var(--border)',
          }}>
            <Briefcase size={15} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                {l.company_name || 'Unnamed deal'}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
                {[l.owner?.full_name || l.owner?.email, l.requirement].filter(Boolean).join(' · ') || 'No details yet'}
              </div>
            </div>
            <Badge tone={STATUS_TONE[l.status] ?? 'neutral'}>{STATUS_LABEL[l.status] ?? l.status}</Badge>
            <Button size="sm" variant="primary" disabled={busy === l.id}
              onClick={async () => {
                setBusy(l.id); setError(null);
                const why = await onPick(l);
                setBusy(null);
                if (why) { setError(why); return; }
                onClose();
              }}>
              {busy === l.id ? <Loader size={12} className="spin" /> : null} Add to this deal
            </Button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
