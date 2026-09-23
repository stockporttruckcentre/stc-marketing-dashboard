'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Loader, MapPin, Pencil, Phone, Plus, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Alert, Badge, Button, IconButton } from '@/components/kit/primitives';
import { Field, Modal, Select, Split, TextArea, TextInput } from '@/components/kit/forms';
import { vendorAddress } from '@/lib/crm/hire';
import type { ThirdPartyVendor } from '@/lib/types';

/* =============================================================
   The third party vendor on a deal.

   From the business, listing what a trailer deal has to hold:

     Option to add a 3rd party Vendor if customer is out of STC
     coverage; All info regarding contact, location etc; What
     maintenance rate is set with that vendor

   ---- Why picking and adding are one control ----

   The moment somebody needs this is the moment they are on the phone
   agreeing a rate with a garage in Aberdeen that is not in the list
   yet. Sending them to a settings screen to add it first means the rate
   goes in the notes field, which is where it went before this existed.

   So the picker offers what is there, and Add opens the same form that
   Edit opens. One form, because a vendor half entered from a deal and
   then completed from a list is two ways for the address to be wrong.

   ---- Two rates, and why ----

   The vendor carries what they charge as a rule. The DEAL carries what
   was agreed for this job. The order form quotes the deal's, falling
   back to the vendor's, and says which. Keeping only one would mean
   either correcting the vendor's standard rate every time a job is
   agreed cheaper, or losing the agreed figure entirely.
   ============================================================= */

const EMPTY = {
  id: null as string | null,
  name: '', contact_name: '', phone: '', email: '',
  address_line1: '', address_line2: '', city: '', postcode: '',
  maintenance_rate: '', covers: '', notes: '',
};

type Draft = typeof EMPTY;

function draftOf(v: ThirdPartyVendor): Draft {
  return {
    id: v.id,
    name: v.name ?? '',
    contact_name: v.contact_name ?? '',
    phone: v.phone ?? '',
    email: v.email ?? '',
    address_line1: v.address_line1 ?? '',
    address_line2: v.address_line2 ?? '',
    city: v.city ?? '',
    postcode: v.postcode ?? '',
    maintenance_rate: v.maintenance_rate == null ? '' : String(v.maintenance_rate),
    covers: v.covers ?? '',
    notes: v.notes ?? '',
  };
}

export function VendorPicker({
  vendorId, dealRate, readOnly = false, onPick, onRate,
}: {
  vendorId: string | null;
  /** The rate agreed on THIS deal, which wins over the vendor's own. */
  dealRate: number | null;
  readOnly?: boolean;
  onPick: (id: string | null) => void;
  onRate: (rate: number | null) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [list, setList] = useState<ThirdPartyVendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from('third_party_vendors')
      .select('*')
      .is('deleted_at', null)
      .order('name');
    if (err) setError(err.message); else setError(null);
    setList((data ?? []) as ThirdPartyVendor[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  const picked = list.find((v) => v.id === vendorId) ?? null;

  async function save() {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) { setError('A vendor needs a name.'); return; }
    const rate = draft.maintenance_rate.trim() === '' ? null : Number(draft.maintenance_rate);
    if (rate != null && !Number.isFinite(rate)) { setError('That rate is not a number.'); return; }

    setSaving(true);
    const { data, error: err } = await supabase.rpc('vendor_save', {
      p_id: draft.id,
      p_name: name,
      p_contact_name: draft.contact_name.trim() || null,
      p_phone: draft.phone.trim() || null,
      p_email: draft.email.trim() || null,
      p_line1: draft.address_line1.trim() || null,
      p_line2: draft.address_line2.trim() || null,
      p_city: draft.city.trim() || null,
      p_postcode: draft.postcode.trim() || null,
      p_rate: rate,
      p_covers: draft.covers.trim() || null,
      p_notes: draft.notes.trim() || null,
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    setError(null);
    setDraft(null);
    await load();
    const made = data as ThirdPartyVendor | null;
    if (made?.id && made.id !== vendorId) onPick(made.id);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {error && <Alert tone="danger">{error}</Alert>}

      <Split>
        <Field
          label="Third party vendor"
          hint="Where the customer sits outside our own coverage."
        >
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Select
                value={vendorId ?? ''}
                disabled={readOnly || loading}
                title={readOnly ? 'Somebody else’s lead. Open it from the customer’s CRM record to work on it.'
                  : loading ? 'Still loading the vendor list.' : undefined}
                onChange={(v) => onPick(v || null)}
              >
                <option value="">Ours, no third party</option>
                {list.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </Select>
            </div>
            <IconButton
              /* `label` is this kit's title AND its aria-label, so a
                 disabled control says why in the one place it has. */
              label={readOnly
                ? 'Somebody else’s lead, so a vendor cannot be added from here'
                : 'Add a vendor'}
              disabled={readOnly}
              onClick={() => { setDraft({ ...EMPTY }); }}
            >
              <Plus size={15} />
            </IconButton>
            {picked && (
              <IconButton
                label={readOnly
                  ? 'Somebody else’s lead, so this vendor cannot be edited from here'
                  : `Edit ${picked.name}`}
                disabled={readOnly}
                onClick={() => setDraft(draftOf(picked))}
              >
                <Pencil size={14} />
              </IconButton>
            )}
          </div>
        </Field>

        <Field
          label="Maintenance rate with them (£)"
          hint={picked
            ? (dealRate == null && picked.maintenance_rate != null
              ? `Blank uses their standard ${picked.maintenance_rate}, which is what the order form will say.`
              : 'What was agreed for this job, which is what goes on the order form.')
            : 'Pick a vendor first.'}
        >
          <TextInput
            type="number"
            readOnly={readOnly || !picked}
            value={dealRate == null ? '' : String(dealRate)}
            onChange={(v) => onRate(v.trim() === '' ? null : Number(v))}
            onCommit={(v) => onRate(v.trim() === '' ? null : Number(v))}
            placeholder={picked?.maintenance_rate != null ? String(picked.maintenance_rate) : ''}
          />
        </Field>
      </Split>

      {/* Everything about them, once they are picked. "All info
          regarding contact, location etc": shown rather than made into
          six more boxes on the deal, because it belongs to the vendor
          and not to this job. */}
      {picked && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '6px 16px', alignItems: 'center',
          padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 'var(--r)',
          background: 'var(--surface-sunken)',
          fontFamily: 'var(--inter)', fontSize: 12, color: 'var(--text-muted)',
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, color: 'var(--text)' }}>
            <Building2 size={13} /> {picked.name}
          </span>
          {picked.contact_name && <span>{picked.contact_name}</span>}
          {picked.phone && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Phone size={12} /> {picked.phone}
            </span>
          )}
          {picked.email && <span>{picked.email}</span>}
          {vendorAddress(picked) && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <MapPin size={12} /> {vendorAddress(picked)}
            </span>
          )}
          {picked.covers && <Badge tone="info">Covers {picked.covers}</Badge>}
          {picked.maintenance_rate != null && (
            <Badge tone={dealRate == null ? 'accent' : 'neutral'}>
              {dealRate == null ? 'Using their' : 'Their'} standard £{picked.maintenance_rate}
            </Badge>
          )}
        </div>
      )}

      {draft && (
        <Modal
          title={draft.id ? `Edit ${draft.name || 'vendor'}` : 'Add a vendor'}
          onClose={() => setDraft(null)}
          footer={<>
            <span style={{ flex: 1 }} />
            {saving && <Loader size={14} className="spin" />}
            <Button size="sm" variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
            <Button
              size="sm"
              disabled={saving || !draft.name.trim()}
              title={!draft.name.trim() ? 'A vendor needs a name.' : undefined}
              onClick={() => void save()}
            >
              {draft.id ? 'Save' : 'Add vendor'}
            </Button>
          </>}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Split>
              <Field label="Name">
                <TextInput value={draft.name} onChange={(v) => setDraft(d => d && ({ ...d, name: v }))} autoFocus />
              </Field>
              <Field label="Their standard rate (£)" hint="What they charge as a rule.">
                <TextInput type="number" value={draft.maintenance_rate}
                  onChange={(v) => setDraft(d => d && ({ ...d, maintenance_rate: v }))} />
              </Field>
            </Split>
            <Split>
              <Field label="Contact">
                <TextInput value={draft.contact_name} onChange={(v) => setDraft(d => d && ({ ...d, contact_name: v }))} />
              </Field>
              <Field label="Phone">
                <TextInput value={draft.phone} onChange={(v) => setDraft(d => d && ({ ...d, phone: v }))} />
              </Field>
            </Split>
            <Field label="Email">
              <TextInput value={draft.email} onChange={(v) => setDraft(d => d && ({ ...d, email: v }))} />
            </Field>
            <Split>
              <Field label="Address">
                <TextInput value={draft.address_line1} placeholder="Street"
                  onChange={(v) => setDraft(d => d && ({ ...d, address_line1: v }))} />
              </Field>
              <Field label="&nbsp;">
                <TextInput value={draft.address_line2} placeholder="Line two"
                  onChange={(v) => setDraft(d => d && ({ ...d, address_line2: v }))} />
              </Field>
            </Split>
            <Split>
              <Field label="Town">
                <TextInput value={draft.city} onChange={(v) => setDraft(d => d && ({ ...d, city: v }))} />
              </Field>
              <Field label="Postcode">
                <TextInput value={draft.postcode} onChange={(v) => setDraft(d => d && ({ ...d, postcode: v }))} />
              </Field>
            </Split>
            <Field
              label="Where they cover"
              hint="In your own words. A postcode list that is wrong is worse than a sentence that is right."
            >
              <TextInput value={draft.covers} placeholder="Aberdeen and the north east"
                onChange={(v) => setDraft(d => d && ({ ...d, covers: v }))} />
            </Field>
            <Field label="Notes">
              <TextArea value={draft.notes} rows={3}
                onChange={(v) => setDraft(d => d && ({ ...d, notes: v }))} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
