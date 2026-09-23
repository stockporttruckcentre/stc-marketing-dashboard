'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Container, FileSignature } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Badge, Button, EmptyState, GridBadge, money } from '@/components/kit/primitives';
import { Drawer } from '@/components/kit/forms';
import { STATUS_LABEL, STATUS_TONE, statusOf } from '@/lib/crm/status';

/* =============================================================
   THE RECORDS BEHIND A PILL.

   From the business:

     on personal portfolio, in 'across the three' make it so you can
     click 'open' or 'won' or 'lost' pills and see a list of those
     records

   The pill says 12 and the drawer lists twelve. That is not a comment,
   it is the thing `scripts/sql/personal-portfolio-check.sql` asserts:
   `personal_deals` filters on exactly the same three conditions
   `personal_pipeline` counts on, including the financial year and the
   order date, so the two cannot drift apart.

   Which is why the undated wins are NOT here. A deal marked won with no
   agreed date is counted in `won_undated` and said out loud on the
   panel; putting it in this list would make the list longer than the
   number that opened it.
   ============================================================= */

export type DealState = 'open' | 'won' | 'lost';

type Deal = {
  id: string;
  contact_id: string | null;
  company_name: string | null;
  what: string | null;
  status: string;
  worth: number | null;
  order_date: string | null;
  date_of_enquiry: string | null;
  last_activity_at: string | null;
  stock_no: string | null;
  contract_ref: string | null;
};

const STATE_WORDS: Record<DealState, { title: string; hint: string }> = {
  open:  { title: 'Open', hint: 'Still being chased: lead, contacted or quoted' },
  won:   { title: 'Won',  hint: 'Closed, with an agreed date inside this financial year' },
  lost:  { title: 'Lost', hint: 'Chased and missed' },
};

const ukDate = (v: string | null) => {
  if (!v) return null;
  try {
    return new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
  } catch { return v; }
};

export function PortfolioDeals({ person, type, typeLabel, state, upto, onClose }: {
  person: string;
  /** The tracker's own word for the division, or null for all three. */
  type: string | null;
  typeLabel: string;
  state: DealState;
  upto?: string;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(null);
    const { data, error } = await supabase.rpc('personal_deals', {
      p_person: person, p_type: type, p_state: state, p_when: upto ?? null,
    });
    if (error) setFailed(error.message);
    setRows((data ?? []) as Deal[]);
    setLoading(false);
  }, [supabase, person, type, state, upto]);

  useEffect(() => { void load(); }, [load]);

  const total = rows.reduce((s, r) => s + (Number(r.worth) || 0), 0);
  const words = STATE_WORDS[state];

  return (
    <Drawer
      eyebrow={typeLabel}
      title={`${words.title}: ${rows.length} ${rows.length === 1 ? 'deal' : 'deals'}`}
      hint={words.hint}
      onClose={onClose}
      width={720}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Worth <strong style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
              {money(total)}
            </strong> between them
          </span>
          <Button size="sm" style={{ marginLeft: 'auto' }} onClick={onClose}>Close</Button>
        </div>
      }
    >
      {failed && (
        <div style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 10 }}>
          These would not load. {failed}
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-subtle)' }}>Reading the tracker.</div>
      ) : rows.length === 0 ? (
        <EmptyState
          what={`Nothing ${words.title.toLowerCase()} on ${typeLabel.toLowerCase()}.`}
          why={words.hint}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {rows.map((d) => {
            const st = statusOf(d.status);
            return (
              <div key={d.id} style={{
                display: 'flex', alignItems: 'center', gap: 11,
                padding: '10px 12px', borderRadius: 'var(--r)',
                border: '1px solid var(--border)', background: 'var(--surface-sunken)',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13.5, fontWeight: 600, color: 'var(--text)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {d.company_name ?? 'No customer on this deal'}
                  </div>
                  <div style={{
                    fontSize: 11.5, color: 'var(--text-subtle)',
                    display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center',
                  }}>
                    {d.what && <span>{d.what}</span>}
                    {d.stock_no && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        · <Container size={11} /> {d.stock_no}
                      </span>
                    )}
                    {d.contract_ref && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        · <FileSignature size={11} /> {d.contract_ref}
                      </span>
                    )}
                    {ukDate(d.order_date ?? d.date_of_enquiry) && (
                      <span>· {ukDate(d.order_date ?? d.date_of_enquiry)}</span>
                    )}
                  </div>
                </div>

                <span style={{
                  fontSize: 12.5, color: 'var(--text-muted)',
                  fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                }}>
                  {d.worth == null ? 'Not priced' : money(Number(d.worth))}
                </span>

                <GridBadge tone={STATUS_TONE[st] ?? 'neutral'}>{STATUS_LABEL[st]}</GridBadge>

                <Button size="sm" variant="ghost"
                  onClick={() => window.location.assign(`/dashboard/leads?lead=${d.id}`)}>
                  Open
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </Drawer>
  );
}

/** The pill itself, so the three of them cannot be styled three ways. */
export function DealPill({ count, label, onOpen, disabled }: {
  count: number; label: string; onOpen: () => void; disabled?: boolean;
}) {
  if (disabled) return <Badge tone="neutral">{count} {label}</Badge>;
  return (
    <button
      onClick={onOpen}
      title={`See the ${count} ${label} ${count === 1 ? 'deal' : 'deals'}`}
      style={{
        border: 0, background: 'transparent', padding: 0, cursor: 'pointer',
        font: 'inherit', borderRadius: 999,
      }}
    >
      <Badge tone="neutral">{count} {label}</Badge>
    </button>
  );
}
