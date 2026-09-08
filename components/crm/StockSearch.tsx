'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader, Package, Search } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Badge, Button, EmptyState, SearchInput } from '@/components/kit/primitives';
import { Field, Modal, Select } from '@/components/kit/forms';
import type { StockTrailer } from '@/lib/types';

/* =============================================================
   Finding the unit somebody is quoting.

   ---- What "by different variants" means ----

   From the business:

     You should be able to search for trailers by different variants to
     find the correct one(s) for the lead.

   A rep on the phone does not know the stock number. They know it is a
   4.7m curtainsider, three years old, at Carrington, and that it is one
   of the two that came in from Dawson. So the text box searches every
   field somebody would say out loud, and the three things that narrow a
   yard fastest get controls of their own: what it is, where it is, and
   whether it is actually available.

   ---- Why the search is on the server ----

   Sold stock runs to thousands of rows. The stock page itself loads two
   thousand and filters in the browser, which is right for a screen
   somebody scrolls; it is wrong here, where the answer is one unit out
   of everything the company has ever owned and the person is mid
   sentence. `ilike` across the five identifying columns, capped, and
   the filters go into the query rather than over the results.

   ---- What is offered by default ----

   Stock you could actually sell: in stock, on a sales order, or a new
   build. Sold and scrapped units are reachable by turning the filter
   off, because "which trailer did we sell them last year" is a real
   question, and quoting one by accident is not.
   ============================================================= */

/** The columns a person searches by name. */
const SEARCHABLE = ['stc_no', 'chassis_number', 'make', 'model', 'description'] as const;

/** What the picker needs. Narrow on purpose: the stock row is 60 columns. */
const COLUMNS =
  'id, stc_no, chassis_number, year, make, model, category, status, location, '
  + 'colour, axle_type, door_type, new_or_used, nbv, retail_price, description, mot_date';

export type PickedTrailer = Pick<StockTrailer,
  'id' | 'stc_no' | 'chassis_number' | 'year' | 'make' | 'model' | 'category'
  | 'status' | 'location' | 'colour' | 'axle_type' | 'door_type' | 'new_or_used'
  | 'nbv' | 'retail_price' | 'description' | 'mot_date'>;

const STATUS_LABEL: Record<string, string> = {
  new_build: 'New build', in_stock: 'In stock', sales_order: 'On order',
  sold: 'Sold', rental: 'On rental', scrap: 'Scrapped',
};

/** Statuses you can still sell. */
const SELLABLE = ['in_stock', 'sales_order', 'new_build'];

/** One line describing the unit, the way somebody would say it. */
export function describeTrailer(t: PickedTrailer): string {
  return [t.year, t.make, t.model, t.category].filter(Boolean).join(' ')
    || t.description
    || t.chassis_number
    || 'Unit';
}

export function StockSearch({ title, note, onPick, onClose, exclude = [] }: {
  title: string;
  note?: string;
  /** Returns false to keep the picker open, for adding several. */
  onPick: (t: PickedTrailer) => void | boolean | Promise<void | boolean>;
  onClose: () => void;
  /** Already on the lead, so they are shown as such rather than offered. */
  exclude?: string[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  const [availableOnly, setAvailableOnly] = useState(true);
  const [rows, setRows] = useState<PickedTrailer[]>([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  /* The two lists the yard actually has, read once. Typing a depot name
     into a text box gets "Carrington", "carrington" and "Carr" and finds
     a third of the units each time. */
  const [categories, setCategories] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  useEffect(() => {
    let off = false;
    (async () => {
      const { data } = await supabase.from('stock_trailers')
        .select('category, location').limit(3000);
      if (off) return;
      const cat = new Set<string>();
      const loc = new Set<string>();
      for (const r of (data ?? []) as { category: string | null; location: string | null }[]) {
        if (r.category?.trim()) cat.add(r.category.trim());
        if (r.location?.trim()) loc.add(r.location.trim());
      }
      setCategories([...cat].sort());
      setLocations([...loc].sort());
    })();
    return () => { off = true; };
  }, [supabase]);

  const run = useCallback(async () => {
    setBusy(true);
    let q = supabase.from('stock_trailers').select(COLUMNS);

    const text = query.trim();
    if (text) {
      const like = `%${text}%`;
      q = q.or(SEARCHABLE.map((c) => `${c}.ilike.${like}`).join(','));
    }
    if (category) q = q.eq('category', category);
    if (location) q = q.eq('location', location);
    if (availableOnly) q = q.in('status', SELLABLE);

    const { data } = await q.order('stc_no', { ascending: true }).limit(40);
    setRows((data ?? []) as unknown as PickedTrailer[]);
    setBusy(false);
    setSearched(true);
  }, [supabase, query, category, location, availableOnly]);

  /* Runs on open as well as on every change, so the picker shows the
     yard rather than an empty box asking somebody to think of a word. */
  useEffect(() => {
    const handle = setTimeout(() => { void run(); }, 220);
    return () => clearTimeout(handle);
  }, [run]);

  return (
    <Modal
      title={title}
      description={note ?? 'Search by stock number, chassis, make, model or anything in the description.'}
      width={720}
      onClose={onClose}
      footer={<Button size="sm" variant="ghost" onClick={onClose}>Done</Button>}
    >
      <SearchInput value={query} onChange={setQuery}
        placeholder="STC142345, curtainsider, Schmitz, 4.7m" icon={<Search size={14} />} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <Field label="What it is">
          <Select value={category} onChange={setCategory}>
            <option value="">Any type</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Where it is">
          <Select value={location} onChange={setLocation}>
            <option value="">Anywhere</option>
            {locations.map((l) => <option key={l} value={l}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Availability">
          <Select value={availableOnly ? 'yes' : 'no'} onChange={(v) => setAvailableOnly(v === 'yes')}>
            <option value="yes">Available to sell</option>
            <option value="no">Everything, sold included</option>
          </Select>
        </Field>
      </div>

      <div style={{
        display: 'flex', flexDirection: 'column', gap: 6,
        maxHeight: 330, overflowY: 'auto',
      }}>
        {busy && rows.length === 0 && (
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', padding: '10px 2px', fontSize: 12.5, color: 'var(--text-muted)' }}>
            <Loader size={12} className="spin" /> Looking through stock
          </div>
        )}

        {!busy && searched && rows.length === 0 && (
          <EmptyState
            what="Nothing in stock matches that."
            why="Try fewer words, or turn the availability filter off to include units that have already gone."
          />
        )}

        {rows.map((t) => {
          const already = exclude.includes(t.id);
          return (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 10px', borderRadius: 'var(--r)',
              background: 'var(--surface-sunken)', border: '1px solid var(--border)',
              opacity: already ? 0.6 : 1,
            }}>
              <Package size={15} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                  {t.stc_no || t.chassis_number || 'No stock number'}
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> · {describeTrailer(t)}</span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
                  {[
                    STATUS_LABEL[t.status] ?? t.status,
                    t.location,
                    t.new_or_used,
                    t.colour,
                    t.axle_type,
                  ].filter(Boolean).join(' · ')}
                </div>
              </div>
              {already
                ? <Badge tone="success">On this lead</Badge>
                : (
                  <Button size="sm" variant="secondary" disabled={adding === t.id}
                    onClick={async () => {
                      setAdding(t.id);
                      const keepOpen = await onPick(t);
                      setAdding(null);
                      if (keepOpen === false) onClose();
                    }}>
                    {adding === t.id ? <Loader size={12} className="spin" /> : null} Add
                  </Button>
                )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
