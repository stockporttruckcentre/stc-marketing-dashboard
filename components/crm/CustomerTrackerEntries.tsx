'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Briefcase, Container, FileSignature, Link2Off, RefreshCw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  Badge, Button, EmptyState, GridBadge, SectionHead, money,
} from '@/components/kit/primitives';
import { CustomerValue } from './CustomerValue';
import { STATUS_LABEL, STATUS_TONE, statusOf } from '@/lib/crm/status';
import type { ContactStatus, LeadType } from '@/lib/types';

/* =============================================================
   EVERY TRACKER ENTRY FOR THIS CUSTOMER, AT THE TOP OF THEIR RECORD.

   From the business:

     all tracker entries app-wide should show at the top of a customer's
     CRM tab. Currently it says searching for open work, but it never
     finds any. Not finding leads or contracts or open trailer sales
     stuff, etc.

   The list used to be `crm_leads WHERE contact_id = this`, which is the
   right question for a lead raised ON the record and the wrong one for
   most of what is on the trackers: `contact_id` is nullable, and an
   import, a lead raised before the customer existed, and a lead whose
   customer was merged away all leave it empty or pointing elsewhere.

   `customer_tracker_entries`, migration 147, asks the four ways a deal
   can belong to a company instead, and carries what each deal IS: the
   stock unit on a trailer sale, the FleetSmart+ contract behind a
   maintenance deal, and whose tracker it sits on. Leads, contracts and
   trailer sales are one list here because they are one list to whoever
   is looking at the customer.

   ---- WHO SEES WHAT ----

   From the business, asked directly:

     yes everyone can see open deals but only sales/bd/md/dev roles can
     see the value of those deals at the top of the crm drawer, others
     just see there's a lead and what the lead is for but cannot click
     in to it. Only people with access to click in to that lead are able
     to (so sr sales who can see others' trackers and leads, BD, MD,
     dev, the person who owns the lead)

   All three of those are decided in the database, not here. Every entry
   comes back for anybody who may open the CRM; the figures come back
   NULL without `crm.dealValues`, so a value this screen cannot show is
   a value it never received; and `may_open` says whether to offer the
   way in. This file draws the answer, it does not work it out.
   ============================================================= */

type Entry = {
  id: string;
  company_name: string | null;
  type: LeadType | null;
  status: string;
  what: string | null;
  estimated_value: number | null;
  sale_price: number | null;
  order_date: string | null;
  date_of_enquiry: string | null;
  last_activity_at: string | null;
  owner_id: string | null;
  owner_name: string | null;
  stock_id: string | null;
  stock_no: string | null;
  contract_id: string | null;
  contract_ref: string | null;
  contract_status: string | null;
  matched_by: 'record' | 'name';
  /** Whether this person may go into the deal itself. */
  may_open: boolean;
};

const TYPE_LABEL: Record<string, string> = {
  trailer_sales: 'Trailer sales',
  maintenance:   'Maintenance',
  rental:        'Rental & leasing',
};

/** Still being chased. Won and lost are outcomes. */
const OPEN = (s: ContactStatus) => s !== 'won' && s !== 'lost';

export function CustomerTrackerEntries({ contactId, canEdit, onBound }: {
  contactId: string;
  /** Binding a loose entry to this customer is an edit to that entry. */
  canEdit: boolean;
  /** Told when an entry is bound, so the record can reload its figures. */
  onBound?: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(null);
    const { data, error } = await supabase.rpc('customer_tracker_entries', { p_contact: contactId });
    if (error) {
      /* Said out loud. A list that quietly shows nothing when it could
         not read is indistinguishable from a customer with no work on,
         which is the exact fault this replaced. */
      setFailed(error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as Entry[]);
    }
    setLoading(false);
  }, [supabase, contactId]);

  useEffect(() => { void load(); }, [load]);

  /** Give a loose entry its customer, so it stops being found by name. */
  async function bind(id: string) {
    setBusy(id);
    const { error } = await supabase.from('crm_leads').update({ contact_id: contactId }).eq('id', id);
    setBusy(null);
    if (error) { setFailed(error.message); return; }
    await load();
    onBound?.();
  }

  const open = rows.filter((r) => OPEN(statusOf(r.status)));
  const done = rows.filter((r) => !OPEN(statusOf(r.status)));
  /* Whether any figure came back at all. The database decides this, and
     an entry with a value is proof the capability is held. */
  const values = rows.some((r) => r.estimated_value != null || r.sale_price != null);

  return (
    <section>
      <SectionHead
        title="On the tracker"
        hint={rows.length ? `${open.length} open of ${rows.length}` : undefined}
        action={
          <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={13} /> Refresh
          </Button>
        }
      />

      {failed && (
        <div style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 10 }}>
          Their tracker entries could not be read. {failed}
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-subtle)' }}>Reading every tracker.</div>
      ) : rows.length === 0 ? (
        <EmptyState
          what="Nothing on any tracker for them."
          why="Leads, FleetSmart+ contracts and trailer deals all appear here, from every tracker you are allowed to see. Raise one from the sales tracker, or type &ldquo;put them on my tracker&rdquo;."
        />
      ) : (
        <>
          {/* What they are worth, from the one block both this screen
              and the tracker's own drawer use. Two panels answering
              "what is this customer worth" in two layouts is how they
              end up answering it with two numbers.

              Only where the figures came back at all. Somebody without
              `crm.dealValues` receives every entry with its values
              NULLed, and a value panel drawn from those would read as
              "this customer is worth nothing", which is worse than not
              drawing it. */}
          {values && (
            <div style={{ marginBottom: 12 }}>
              <CustomerValue leads={rows} dense />
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {[...open, ...done].map((r) => {
              const st = statusOf(r.status);
              const live = OPEN(st);
              return (
                <div key={r.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 11px', borderRadius: 'var(--r)',
                  border: '1px solid var(--border)', background: 'var(--surface-sunken)',
                  borderLeft: `2px solid ${live ? 'var(--accent)' : 'var(--border-strong)'}`,
                  opacity: live ? 1 : 0.7,
                }}>
                  <Briefcase size={14} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, color: 'var(--text)', fontWeight: 600,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {r.what || TYPE_LABEL[r.type ?? ''] || 'Deal'}
                    </div>
                    <div style={{
                      fontSize: 11.5, color: 'var(--text-subtle)',
                      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
                    }}>
                      <span>{TYPE_LABEL[r.type ?? ''] ?? 'Sales'}</span>
                      {r.owner_name && <span>· {r.owner_name}</span>}
                      {r.stock_no && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          · <Container size={11} /> {r.stock_no}
                        </span>
                      )}
                      {r.contract_ref && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          · <FileSignature size={11} /> {r.contract_ref}
                          {r.contract_status ? ` (${r.contract_status})` : ''}
                        </span>
                      )}
                    </div>
                  </div>

                  {r.matched_by === 'name' && (
                    <span title="Found by company name. This entry is not attached to this record, so it does not follow them through a merge and does not count towards their value.">
                      <Badge tone="warning">
                        <Link2Off size={11} style={{ marginRight: 3 }} />
                        Not linked
                      </Badge>
                    </span>
                  )}

                  {(r.estimated_value != null || r.sale_price != null) && (
                    <span style={{
                      fontSize: 12.5, color: 'var(--text-muted)',
                      fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                    }}>
                      {money(live ? r.estimated_value : (r.sale_price ?? r.estimated_value))}
                    </span>
                  )}

                  <GridBadge tone={STATUS_TONE[st] ?? 'neutral'}>{STATUS_LABEL[st]}</GridBadge>

                  {r.matched_by === 'name' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!canEdit || busy === r.id}
                      title={canEdit
                        ? 'Attach this entry to this customer, so it follows them and counts towards their value'
                        : 'Attaching an entry to a customer needs permission to edit the CRM'}
                      onClick={() => void bind(r.id)}
                    >
                      {busy === r.id ? 'Attaching' : 'Attach'}
                    </Button>
                  ) : (
                    /* Offered to exactly the people the lead itself would
                       let in, which is what `may_open` carries. Disabled
                       and saying why rather than absent, so the row reads
                       the same for everybody and nobody wonders whether
                       they have missed a button. */
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!r.may_open}
                      title={r.may_open
                        ? 'Open this deal on the tracker'
                        : 'This deal is on somebody else\'s tracker. Opening it needs permission to see a colleague\'s accounts.'}
                      onClick={() => window.location.assign(`/dashboard/leads?lead=${r.id}`)}
                    >
                      Open
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
