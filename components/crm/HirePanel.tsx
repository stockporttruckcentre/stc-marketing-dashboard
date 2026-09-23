'use client';

import { useMemo, useState } from 'react';
import { Download, FileText, Loader } from 'lucide-react';
import { Alert, Badge, Button, PanelHead } from '@/components/kit/primitives';
import { Field, Select, Split, TextInput } from '@/components/kit/forms';
import {
  COVER_HINT, COVER_LABEL, MAINTENANCE_COVERS, SERVICE_CYCLES, termFromDates, termLabel,
} from '@/lib/crm/hire';
import { VendorPicker } from './VendorPicker';
import type { MaintenanceCover } from '@/lib/types';

/* =============================================================
   The hire a trailer deal is, on the drawer.

   From the business, in the message that also asked for the order form:

     click into a trailer lead with the following updates to the drawer
     when clicking a trailer deal (details below to be generated on
     order form if populated): Date the equipment went on hire &
     estimated Off hire date; Term length; Rate £; Service cycle; Option
     to add a 3rd party Vendor if customer is out of STC coverage; All
     info regarding contact, location etc; What maintenance rate is set
     with that vendor; Equipment on hire - STC number; NET/NET / R&M /
     Full R&M + Tyres as a drop down box

   "details below to be generated on order form if populated" is the
   rule that decides the layout: every one of these reaches the document
   next to it, so they sit above the order form buttons rather than
   somewhere else on the drawer, and the buttons say what is still
   blank before anybody presses one.

   The two fields not here are the STC numbers and the prices, which
   belong to the units and live on `LeadTrailers`.
   ============================================================= */

export type HireFields = {
  on_hire_date: string | null;
  off_hire_estimate: string | null;
  term_months: number | null;
  hire_rate: number | null;
  service_cycle: string | null;
  maintenance_cover: MaintenanceCover | null;
  vendor_id: string | null;
  vendor_rate: number | null;
};

const CYCLE_LIST = 'stc-service-cycles';

export function HirePanel({
  leadId, value, readOnly = false, trailers, onSave,
}: {
  leadId: string;
  value: HireFields;
  readOnly?: boolean;
  /** How many units are attached, which the order form needs. */
  trailers: number;
  onSave: <K extends keyof HireFields>(field: K, v: HireFields[K]) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'order' | 'proposal'>(null);

  /* The term the dates imply, offered and never written. A term of
     eleven months because the off hire estimate is three days early is
     the kind of quiet wrong number that ends up on an order form. */
  const implied = useMemo(
    () => termFromDates(value.on_hire_date, value.off_hire_estimate),
    [value.on_hire_date, value.off_hire_estimate],
  );

  const datesWrongWayRound = Boolean(
    value.on_hire_date && value.off_hire_estimate
    && value.off_hire_estimate < value.on_hire_date,
  );

  async function download(variant: 'order' | 'proposal') {
    setBusy(variant);
    setError(null);
    try {
      const res = await fetch(`/api/trailer-order?lead=${encodeURIComponent(leadId)}&variant=${variant}`);
      if (!res.ok) {
        const said = await res.json().catch(() => ({ error: `The server said ${res.status}.` }));
        setError(said.error ?? `The server said ${res.status}.`);
        return;
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1]
        ?? `${variant}.docx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The download did not start.');
    } finally {
      setBusy(null);
    }
  }

  const ro = readOnly
    ? 'Somebody else’s lead. Open it from the customer’s CRM record to work on it.'
    : undefined;

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <PanelHead
        title="The hire"
        hint="Everything here prints on the order form, where it is filled in."
      />

      {error && <Alert tone="danger">{error}</Alert>}

      <Split>
        <Field label="On hire from" hint="The date the equipment actually went on hire.">
          <TextInput
            type="date" readOnly={readOnly} value={value.on_hire_date ?? ''}
            onChange={(v) => onSave('on_hire_date', v || null)}
            onCommit={(v) => onSave('on_hire_date', v || null)}
          />
        </Field>
        <Field
          label="Off hire estimate"
          error={datesWrongWayRound ? 'That is before the on hire date.' : undefined}
          hint={datesWrongWayRound ? undefined : 'When it is expected back.'}
        >
          <TextInput
            type="date" readOnly={readOnly} invalid={datesWrongWayRound}
            value={value.off_hire_estimate ?? ''}
            onChange={(v) => onSave('off_hire_estimate', v || null)}
            onCommit={(v) => onSave('off_hire_estimate', v || null)}
          />
        </Field>
      </Split>

      <Split>
        <Field
          label="Term (months)"
          hint={
            value.term_months != null ? termLabel(value.term_months)
              : implied != null ? <>The dates come to {termLabel(implied)}. Type it if that is the term.</>
                : 'How long it is agreed for.'
          }
        >
          <TextInput
            type="number" readOnly={readOnly}
            value={value.term_months == null ? '' : String(value.term_months)}
            onChange={(v) => onSave('term_months', v.trim() === '' ? null : Number(v))}
            onCommit={(v) => onSave('term_months', v.trim() === '' ? null : Number(v))}
          />
        </Field>
        <Field label="Rate (£)" hint="The periodic rate, as opposed to what the whole deal is worth.">
          <TextInput
            type="number" readOnly={readOnly}
            value={value.hire_rate == null ? '' : String(value.hire_rate)}
            onChange={(v) => onSave('hire_rate', v.trim() === '' ? null : Number(v))}
            onCommit={(v) => onSave('hire_rate', v.trim() === '' ? null : Number(v))}
          />
        </Field>
      </Split>

      <Split>
        <Field
          label="Service cycle"
          hint="The interval agreed with them. Type anything: the list is the common ones, not the only ones."
        >
          <TextInput
            readOnly={readOnly} list={CYCLE_LIST}
            value={value.service_cycle ?? ''}
            placeholder="13 weekly"
            onChange={(v) => onSave('service_cycle', v || null)}
            onCommit={(v) => onSave('service_cycle', v.trim() || null)}
          />
          <datalist id={CYCLE_LIST}>
            {SERVICE_CYCLES.map((c) => <option key={c} value={c} />)}
          </datalist>
        </Field>
        <Field
          label="Cover"
          hint={value.maintenance_cover
            ? COVER_HINT[value.maintenance_cover]
            : 'Nobody has been asked yet, which is not the same as NET/NET.'}
        >
          <Select
            value={value.maintenance_cover ?? ''}
            disabled={readOnly}
            title={ro}
            onChange={(v) => onSave('maintenance_cover', (v || null) as MaintenanceCover | null)}
          >
            <option value="">Not set yet</option>
            {MAINTENANCE_COVERS.map((c) => (
              <option key={c} value={c}>{COVER_LABEL[c]}</option>
            ))}
          </Select>
        </Field>
      </Split>

      <VendorPicker
        vendorId={value.vendor_id}
        dealRate={value.vendor_rate}
        readOnly={readOnly}
        onPick={(id) => {
          onSave('vendor_id', id);
          /* Taking the vendor off takes the rate agreed with them off
             too. A rate with nobody attached to it is a number that
             prints on an order form beside a blank. */
          if (!id) onSave('vendor_rate', null);
        }}
        onRate={(r) => onSave('vendor_rate', r)}
      />

      {/* ---- The order form ----

          Downloadable at any point, which is what was asked for:
          "downloading of an order form works like fleetsmart+, it's
          dynamic and can be downloaded at any point."

          So neither button is ever disabled for being incomplete. What
          is missing is said beside them instead, because a rep printing
          a half filled order form to walk into a meeting with is a
          thing people do on purpose. */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
        paddingTop: 10, borderTop: '1px solid var(--border)',
      }}>
        <Button
          size="sm" variant="secondary"
          disabled={busy !== null}
          title={busy !== null ? 'A document is already being built.' : 'The proposal: no signing page, no terms'}
          onClick={() => void download('proposal')}
        >
          {busy === 'proposal' ? <Loader size={14} className="spin" /> : <FileText size={14} />}
          Proposal
        </Button>
        <Button
          size="sm"
          disabled={busy !== null}
          title={busy !== null ? 'A document is already being built.' : 'The order form, with the terms and the signing page'}
          onClick={() => void download('order')}
        >
          {busy === 'order' ? <Loader size={14} className="spin" /> : <Download size={14} />}
          Order form
        </Button>

        <span style={{
          flex: 1, minWidth: 180, textAlign: 'right',
          fontFamily: 'var(--inter)', fontSize: 11.5, color: 'var(--text-subtle)',
        }}>
          {trailers === 0
            ? 'No units on this deal yet, so the schedule prints blank.'
            : <>{trailers} unit{trailers === 1 ? '' : 's'} on the schedule.</>}
        </span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {[
          ['On hire date', value.on_hire_date],
          ['Off hire estimate', value.off_hire_estimate],
          ['Term', value.term_months],
          ['Rate', value.hire_rate],
          ['Service cycle', value.service_cycle],
          ['Cover', value.maintenance_cover],
        ].filter(([, v]) => v == null || v === '').map(([label]) => (
          <Badge key={String(label)} tone="neutral">{String(label)} blank</Badge>
        ))}
      </div>
    </section>
  );
}
