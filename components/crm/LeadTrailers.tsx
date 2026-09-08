'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader, Package, Plus, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Alert, Badge, Button, Card, IconButton, PanelHead } from '@/components/kit/primitives';
import { StockSearch, describeTrailer, type PickedTrailer } from './StockSearch';

/* =============================================================
   The units a trailer sales lead is actually about.

   ---- Why this panel exists ----

   From the business:

     The trailer sales leads when you create one needs a very custom view
     that links back to the trailer sales tab. If you're quoting certain
     trailers from our stock list it needs reflecting in the system.

   It was not reflected anywhere. `crm_leads.stock_trailer_id` existed,
   the reconciliation screen read it, the sold warning read it, and no
   screen in the application let anybody set it: the tracker had a
   `StockTrailerPicker` component written and never rendered. So a rep
   quoting two units off the yard wrote the stock numbers into the notes
   field, and every question that joins a deal to a unit answered null.

   ---- One panel, both directions ----

   A unit attached here shows on the stock record as "on a quote", and a
   unit attached from the stock page shows here. They are the same rows
   in `crm_lead_trailers`, so neither screen can be the one that is out
   of date. Migration 097.

   Only on trailer sales. A maintenance contract is about a fleet the
   customer already owns and a hire is about a unit that comes back, and
   neither is a thing to pick out of the sales stock list.
   ============================================================= */

/** One attached unit, as this panel lists it. */
type Attached = {
  stock_trailer_id: string;
  position: number;
  note: string | null;
  trailer: PickedTrailer | null;
};

const money = (n: number | null | undefined) =>
  n == null ? null : n.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });

const STATUS_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'info'> = {
  in_stock: 'success', new_build: 'info', sales_order: 'warning',
  sold: 'neutral', rental: 'info', scrap: 'neutral',
};
const STATUS_LABEL: Record<string, string> = {
  new_build: 'New build', in_stock: 'In stock', sales_order: 'On order',
  sold: 'Sold', rental: 'On rental', scrap: 'Scrapped',
};

export function LeadTrailers({ leadId, readOnly = false, onChange }: {
  leadId: string;
  readOnly?: boolean;
  /** So the drawer can show the count without asking again. */
  onChange?: (count: number) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Attached[]>([]);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    /* The join reads the trailer through the foreign key rather than in
       a second round trip, so a quote of four units is one request. */
    const { data, error: err } = await supabase
      .from('crm_lead_trailers')
      .select(`stock_trailer_id, position, note, trailer:stock_trailers (
        id, stc_no, chassis_number, year, make, model, category, status, location,
        colour, axle_type, door_type, new_or_used, nbv, retail_price, description, mot_date
      )`)
      .eq('lead_id', leadId)
      .order('position');
    if (err) { setError(err.message); setLoading(false); return; }
    const list = (data ?? []) as unknown as Attached[];
    setRows(list);
    setLoading(false);
    onChange?.(list.length);
  }, [supabase, leadId, onChange]);

  useEffect(() => { void load(); }, [load]);

  async function attach(t: PickedTrailer) {
    setError(null);
    const { data, error: err } = await supabase.rpc('crm_attach_trailer', {
      p_lead: leadId, p_trailer: t.id, p_note: null,
    });
    if (err) { setError(err.message); return true; }
    const res = data as { ok?: boolean; why?: string } | null;
    if (res && res.ok === false) { setError(res.why ?? 'That did not attach.'); return true; }
    await load();
    /* Kept open. Somebody quoting three units is adding three, and
       reopening the picker between each is the version of this that
       gets used once. */
    return true;
  }

  async function detach(id: string) {
    setError(null);
    const { error: err } = await supabase.rpc('crm_detach_trailer', {
      p_lead: leadId, p_trailer: id,
    });
    if (err) { setError(err.message); return; }
    await load();
  }

  return (
    <Card padded={false}>
      <PanelHead
        title="Units from stock"
        count={rows.length || undefined}
        hint={rows.length === 0 ? 'What they are being quoted' : undefined}
        action={readOnly ? undefined : (
          <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
            <Plus size={12} /> Add a unit
          </Button>
        )}
      />

      <div style={{ padding: '10px 14px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {error && <Alert tone="danger">{error}</Alert>}

        {loading ? (
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', color: 'var(--text-subtle)', fontSize: 12.5 }}>
            <Loader size={12} className="spin" /> Loading
          </div>
        ) : rows.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-subtle)', lineHeight: 1.5 }}>
            No units on this quote yet. Adding them here links the deal to the stock
            record, so the unit shows as quoted on the stock page and the sale can be
            reconciled against it later.
          </div>
        ) : rows.map((r, i) => {
          const t = r.trailer;
          const price = money(t?.retail_price ?? t?.nbv ?? null);
          return (
            <div key={r.stock_trailer_id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 10px', borderRadius: 'var(--r)',
              background: 'var(--surface-sunken)', border: '1px solid var(--border)',
            }}>
              <Package size={15} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                  {t?.stc_no || t?.chassis_number || 'Unit'}
                  {t && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> · {describeTrailer(t)}</span>}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
                  {[
                    /* The first unit is the one every other screen means
                       by "the trailer on this deal", so it says so. */
                    i === 0 && rows.length > 1 ? 'First on the quote' : null,
                    t?.location,
                    price,
                    r.note,
                  ].filter(Boolean).join(' · ') || 'No details on the stock record'}
                </div>
              </div>
              {t && (
                <Badge tone={STATUS_TONE[t.status] ?? 'neutral'}>
                  {STATUS_LABEL[t.status] ?? t.status}
                </Badge>
              )}
              <IconButton label="Open in the stock list"
                onClick={() => window.open(`/dashboard/sales?trailer=${r.stock_trailer_id}`, '_blank', 'noopener')}>
                <ExternalLink size={13} />
              </IconButton>
              {!readOnly && (
                <IconButton label="Take this unit off the quote" danger
                  onClick={() => detach(r.stock_trailer_id)}>
                  <X size={13} />
                </IconButton>
              )}
            </div>
          );
        })}
      </div>

      {picking && (
        <StockSearch
          title="Add a unit to this quote"
          exclude={rows.map((r) => r.stock_trailer_id)}
          onPick={attach}
          onClose={() => setPicking(false)}
        />
      )}
    </Card>
  );
}
