'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ExternalLink, Loader, Package, Plus, PoundSterling, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Alert, Badge, Button, Card, IconButton, PanelHead } from '@/components/kit/primitives';
import { Field, Split, TextInput } from '@/components/kit/forms';
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
  /** What this unit is priced at ON THIS DEAL, which is not the stock
      record's retail price. Migration 153. */
  rate: number | null;
  quantity: number;
  trailer: PickedTrailer | null;
};

/** One line of what `lead_price_across` is about to do. */
type Preview = {
  stock_trailer_id: string;
  stc_no: string | null;
  rate_before: number | null;
  rate_after: number | null;
  quantity_before: number | null;
  quantity_after: number | null;
  changed: boolean;
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

  /* ---- ONE PRICE ACROSS THE LIST ----

     From the business: "add in 1 price, set quantity, have a button
     that allows you to set that same price across all trailers on your
     list (or choose specific ones to apply it to)".

     `picked` empty means all of them, which is what the button says it
     will do. Nothing is written on the first press: `preview` holds
     what the database says is about to change, with the value before
     and the value after per unit, and a second press applies it. The
     same rule the command bar works to, for the same reason. */
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Preview[] | null>(null);
  const [pricing, setPricing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    /* The join reads the trailer through the foreign key rather than in
       a second round trip, so a quote of four units is one request. */
    const { data, error: err } = await supabase
      .from('crm_lead_trailers')
      .select(`stock_trailer_id, position, note, rate, quantity, trailer:stock_trailers (
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

  /** What `lead_price_across` would do, or what it did. */
  async function priceAcross(apply: boolean) {
    setError(null);
    const rate = Number(price);
    if (price.trim() === '' || !Number.isFinite(rate)) {
      setError('Type the price first.'); return;
    }
    const quantity = qty.trim() === '' ? null : Number(qty);
    if (quantity != null && (!Number.isInteger(quantity) || quantity < 1)) {
      setError('A quantity is a whole number, one or more.'); return;
    }

    setPricing(true);
    const { data, error: err } = await supabase.rpc('lead_price_across', {
      p_lead: leadId,
      p_rate: rate,
      p_quantity: quantity,
      p_only: picked.size ? [...picked] : null,
      p_dry_run: !apply,
    });
    setPricing(false);
    if (err) { setError(err.message); setPreview(null); return; }

    if (!apply) { setPreview((data ?? []) as Preview[]); return; }

    setPreview(null);
    setPicked(new Set());
    await load();
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
          const listed = money(t?.retail_price ?? t?.nbv ?? null);
          const soon = preview?.find((p) => p.stock_trailer_id === r.stock_trailer_id);
          const chosen = picked.has(r.stock_trailer_id);
          return (
            <div key={r.stock_trailer_id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 10px', borderRadius: 'var(--r)',
              background: 'var(--surface-sunken)',
              border: `1px solid ${soon?.changed ? 'var(--primary)' : 'var(--border)'}`,
            }}>
              {/* Which units a price applies to. Nothing ticked means
                  all of them, which is what the button says, so the
                  ticks are how you narrow it rather than how you start.
                  Bound with htmlFor so the label is the hit area. */}
              {!readOnly && rows.length > 1 && (
                <>
                  <input
                    id={`price-${r.stock_trailer_id}`}
                    type="checkbox"
                    checked={chosen}
                    onChange={() => {
                      setPreview(null);
                      setPicked((s2) => {
                        const next = new Set(s2);
                        if (next.has(r.stock_trailer_id)) next.delete(r.stock_trailer_id);
                        else next.add(r.stock_trailer_id);
                        return next;
                      });
                    }}
                    style={{ accentColor: 'var(--primary)', flexShrink: 0, margin: 0 }}
                  />
                  <label htmlFor={`price-${r.stock_trailer_id}`} style={{ display: 'contents' }} />
                </>
              )}
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
                    listed ? `Listed ${listed}` : null,
                    r.note,
                  ].filter(Boolean).join(' · ') || 'No details on the stock record'}
                </div>
              </div>

              {/* What this unit is priced at ON THIS DEAL, which is not
                  the stock record's retail price and is what prints in
                  the order form's Net Price Per Trailer column. */}
              <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 96 }}>
                <div style={{
                  fontFamily: 'var(--panton)', fontSize: 13, fontWeight: 700,
                  color: soon?.changed ? 'var(--primary)' : r.rate == null ? 'var(--text-subtle)' : 'var(--text)',
                }} className="tnum">
                  {soon?.changed
                    ? money(soon.rate_after) ?? '—'
                    : r.rate == null ? 'Not priced' : money(r.rate)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)' }} className="tnum">
                  {soon?.changed && soon.rate_before != null && soon.rate_before !== soon.rate_after
                    ? `was ${money(soon.rate_before)}`
                    : `× ${soon?.changed ? soon.quantity_after : r.quantity}`}
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

        {/* ---- One price, a quantity, and the button ---- */}
        {!readOnly && rows.length > 0 && (
          <div style={{
            marginTop: 4, paddingTop: 10, borderTop: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <Split>
              <Field label="Price each (£)" hint="What one of these is being quoted at.">
                <TextInput
                  type="number" value={price}
                  onChange={(v) => { setPrice(v); setPreview(null); }}
                />
              </Field>
              <Field label="Quantity" hint="Leave blank to keep the counts as they are.">
                <TextInput
                  type="number" value={qty}
                  onChange={(v) => { setQty(v); setPreview(null); }}
                />
              </Field>
            </Split>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Button
                size="sm"
                variant={preview ? 'primary' : 'secondary'}
                disabled={pricing || price.trim() === ''}
                title={price.trim() === '' ? 'Type the price first.' : undefined}
                onClick={() => void priceAcross(Boolean(preview))}
              >
                {pricing ? <Loader size={13} className="spin" />
                  : preview ? <Check size={13} /> : <PoundSterling size={13} />}
                {preview
                  ? `Apply to ${preview.filter((p) => p.changed).length} of ${preview.length}`
                  : picked.size
                    ? `Price the ${picked.size} ticked`
                    : `Price all ${rows.length}`}
              </Button>

              {preview && (
                <Button size="sm" variant="secondary" onClick={() => setPreview(null)}>
                  Cancel
                </Button>
              )}

              <span style={{ fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.45 }}>
                {preview
                  ? preview.some((p) => p.changed)
                    ? 'Nothing is written yet. The prices above show what it will be.'
                    : 'Every one of them is already at that price.'
                  : picked.size
                    ? 'Only the ticked ones.'
                    : 'Tick units above to price some of them instead.'}
              </span>
            </div>
          </div>
        )}
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
