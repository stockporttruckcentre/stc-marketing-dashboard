'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';
import {
  AlertTriangle, Check, ChevronLeft, ChevronRight, Copy, FileText, Plus,
  Printer, Search, Send, Trash2, Truck,
} from 'lucide-react';
import {
  ASSET_TYPES, PMI_INTERVALS, PLANS, TACHO_CHOICES, TERM_MONTHS, WORK_PATTERNS,
  type AssetType, type Plan,
} from '@/lib/fleetsmart/ratecard';
import {
  autoWearAndTear, blankAsset, defaultBrakeTests, defaultCServices, defaultLadenRbt,
  defaultPmiWeeks, describe, priceContract,
} from '@/lib/fleetsmart/price';
import {
  WORDING_LABEL, autoWording, blankExtras,
  type ContractExtras, type WordingKey,
} from '@/lib/fleetsmart/contract';
import type { ContractInput, FleetAsset, PricedAsset } from '@/lib/fleetsmart/types';
import { ContractDocument, ContractPrintRules } from './document';
import {
  Alert, Badge, Button, Chip, EmptyState, IconButton, Label, SearchInput,
} from '@/components/kit/primitives';
import {
  Checkbox, Drawer, Field, OptionCard, Select, Split, TextArea, TextInput,
} from '@/components/kit/forms';

/* =============================================================
   The FleetSmart+ contract wizard.

   The workbook streamlined this from a rate card and a calculator into
   one sheet where a reg and an asset type is enough. This streamlines
   it again: the same six decisions, in the order somebody actually
   makes them, with the price moving as they go and the document at the
   end rather than on another tab.

   ---- What each step is for ----

   Customer   who it is for, off the CRM rather than typed twice
   Plan       Silver, Gold or Platinum, the term and the labour rates
   Fleet      one row per asset. Reg and type is enough
   Money      the discounts, and every line that makes up the price
   Wording    the eight blocks, each with its automatic text
   Review     the contract as the customer will get it

   Nothing is gated behind a step: the rail moves in both directions and
   the price is live from the moment there is one asset, because a
   salesman on the phone needs the monthly figure before they have
   finished filling in the address.

   ---- Defaults, and typing over them ----

   Every field on an asset row except the reg and the type has a
   default, which is what the plan and the class say it should be. The
   input shows that default as its placeholder rather than its value, so
   the difference between "this is the standard four laden RBTs" and
   "somebody chose four" stays visible, and clearing an override puts
   the default back. That is the workbook's own behaviour and the reason
   its blank cells are not missing data.
   ============================================================= */

const STEPS = ['Customer', 'Plan', 'Fleet', 'Money', 'Wording', 'Review'] as const;
type Step = (typeof STEPS)[number];

const PANEL: CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 'var(--r-md)', overflow: 'hidden',
};
const TH: CSSProperties = {
  textAlign: 'left', padding: '0 10px', height: 32,
  background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
  fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
  letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-subtle)',
  whiteSpace: 'nowrap',
};
const TD: CSSProperties = {
  padding: '0 10px', height: 34, borderBottom: '1px solid var(--border)',
  fontSize: 12.5, color: 'var(--text-muted)',
};

const money = (n: number) =>
  n.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 });

/** What each plan is, in the words a salesman uses in the room. */
const PLAN_BLURB: Record<Plan, string> = {
  Silver: 'Compliance. One DVSA inspection taken at MOT, the full MOT bundle, laden RBTs, tacho, sundries, direct debit and document storage.',
  Gold: 'Silver plus an A service at every inspection, the C major service, service kit, engine oil, bulbs, and compliance portal access in place of document storage.',
  Platinum: 'Gold plus a wear and tear allowance that reflects age and mileage, and the tail lift LOLER and weight test.',
};

export type SaveResult = { ok: true; id: string; ref: string | null } | { ok: false; message: string };

export function ContractWizard({
  accounts, leads, initial, contractId, reference, may, onClose, onSaved,
}: {
  accounts: { id: string; company_name: string | null; contact_name: string | null; location: string | null }[];
  leads: { id: string; contact_id: string | null; company_name: string | null; requirement: string | null }[];
  initial: { input: ContractInput; extras: ContractExtras; accountId: string | null; leadId: string | null };
  /** Set when reopening a draft, so saving updates rather than duplicates. */
  contractId: string | null;
  reference: string | null;
  may: (c: string) => boolean;
  onClose: () => void;
  onSaved: (result: { id: string; ref: string | null; sent: boolean }) => void;
}) {
  const [step, setStep] = useState<Step>('Customer');
  const [input, setInput] = useState<ContractInput>(initial.input);
  const [extras, setExtras] = useState<ContractExtras>(initial.extras);
  const [accountId, setAccountId] = useState<string | null>(initial.accountId);
  const [leadId, setLeadId] = useState<string | null>(initial.leadId);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(contractId);

  const set = useCallback(<K extends keyof ContractInput>(k: K, v: ContractInput[K]) => {
    setInput((s) => ({ ...s, [k]: v }));
  }, []);

  /* The price, recomputed on every keystroke. It is a few hundred
     multiplications over at most a couple of dozen assets, so there is
     nothing to memoise around and a stale figure would be worse than a
     wasted one. */
  const priced = useMemo(() => priceContract(input), [input]);
  const realAssets = input.assets.filter((a) => a.reg.trim());

  const setAsset = useCallback((key: string, patch: Partial<FleetAsset>) => {
    setInput((s) => ({ ...s, assets: s.assets.map((a) => (a.key === key ? { ...a, ...patch } : a)) }));
  }, []);

  const addAsset = useCallback(() => {
    const key = `a${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
    setInput((s) => ({ ...s, assets: [...s.assets, blankAsset(key, s.plan)] }));
    setOpenRow(key);
  }, []);

  const duplicateAsset = useCallback((key: string) => {
    setInput((s) => {
      const found = s.assets.find((a) => a.key === key);
      if (!found) return s;
      const copy = {
        ...found,
        key: `a${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`,
        /* Everything except the reg, which is the one thing that cannot
           be the same. A fleet of eight identical trailers is the case
           this exists for. */
        reg: '',
      };
      const at = s.assets.findIndex((a) => a.key === key);
      const next = [...s.assets];
      next.splice(at + 1, 0, copy);
      return { ...s, assets: next };
    });
  }, []);

  const removeAsset = useCallback((key: string) => {
    setInput((s) => ({ ...s, assets: s.assets.filter((a) => a.key !== key) }));
  }, []);

  /* Changing the plan changes what a tail lift means: Platinum carries
     the LOLER test, the other two sell cover as an extra. The workbook
     resets the column, so this does too, and says so on the step. */
  const setPlan = useCallback((plan: Plan) => {
    setInput((s) => ({
      ...s,
      plan,
      assets: s.assets.map((a) => ({ ...a, tailLift: plan === 'Platinum' ? true : a.tailLift })),
    }));
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts.slice(0, 8);
    return accounts
      .filter((a) => `${a.company_name ?? ''} ${a.contact_name ?? ''}`.toLowerCase().includes(q))
      .slice(0, 12);
  }, [accounts, query]);

  const theirLeads = useMemo(
    () => leads.filter((l) => l.contact_id && l.contact_id === accountId),
    [leads, accountId],
  );

  async function save(then: 'draft' | 'send'): Promise<void> {
    setBusy(true); setError(null);
    try {
      const body = { input, extras, account_id: accountId, lead_id: leadId };
      const res = await fetch(
        savedId ? `/api/fleetsmart/contracts/${savedId}` : '/api/fleetsmart/contracts',
        {
          method: savedId ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const json = await res.json();
      if (!json.ok) { setError(json.message ?? 'That did not save.'); return; }

      const contract = json.contract as { id: string; ref: string | null };
      setSavedId(contract.id);

      if (then === 'draft') {
        onSaved({ id: contract.id, ref: contract.ref, sent: false });
        return;
      }

      const sent = await (await fetch(`/api/fleetsmart/contracts/${contract.id}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: input.customerContact }),
      })).json();

      if (!sent.ok) { setError(sent.message ?? 'It saved, but it could not be marked as sent.'); return; }
      onSaved({ id: contract.id, ref: contract.ref, sent: true });
    } catch {
      setError('That did not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const at = STEPS.indexOf(step);
  const ready = input.customerName.trim() !== '' && realAssets.length > 0;

  return (
    <Drawer
      eyebrow={reference ? `FleetSmart+ · ${reference}` : 'FleetSmart+'}
      title={input.customerName.trim() || 'New contract'}
      icon={<FileText size={18} />}
      onClose={onClose}
      width={1180}
      footer={
        <>
          <Button
            size="sm" variant="ghost" disabled={at === 0}
            onClick={() => setStep(STEPS[Math.max(0, at - 1)])}
          >
            <ChevronLeft size={13} /> Back
          </Button>
          <Button
            size="sm" variant="secondary" disabled={at === STEPS.length - 1}
            onClick={() => setStep(STEPS[Math.min(STEPS.length - 1, at + 1)])}
          >
            Next <ChevronRight size={13} />
          </Button>

          <span style={{ flex: 1 }} />

          <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
            {realAssets.length} asset{realAssets.length === 1 ? '' : 's'}
          </span>
          <span style={{
            fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 17,
            letterSpacing: '-0.02em', color: 'var(--text)', fontVariantNumeric: 'tabular-nums',
          }}>
            {money(priced.monthly)}
            <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--text-subtle)' }}> / month</span>
          </span>

          {may('fleetsmart.build') && (
            <Button size="sm" variant="secondary" disabled={busy || !ready} onClick={() => save('draft')}>
              {busy ? 'Saving' : 'Save draft'}
            </Button>
          )}
          {may('fleetsmart.send') && (
            <Button size="sm" variant="primary" disabled={busy || !ready} onClick={() => save('send')}>
              <Send size={13} /> Save and send
            </Button>
          )}
        </>
      }
    >
      {/* ---- the rail ---- */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {STEPS.map((s, i) => (
          <Chip key={s} active={s === step} onClick={() => setStep(s)}>
            <span style={{
              fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10,
              color: s === step ? 'var(--accent)' : 'var(--text-subtle)',
            }}>{i + 1}</span>
            {s}
          </Chip>
        ))}
      </div>

      {error && <Alert tone="danger"><AlertTriangle size={13} /> {error}</Alert>}

      {step === 'Customer' && (
        <CustomerStep
          accounts={matches} query={query} onQuery={setQuery}
          accountId={accountId} leads={theirLeads} leadId={leadId}
          input={input} set={set}
          onPick={(a) => {
            setAccountId(a.id);
            setLeadId(null);
            setInput((s) => ({
              ...s,
              customerName: a.company_name ?? s.customerName,
              customerContact: a.contact_name ?? s.customerContact,
              customerAddress: a.location ?? s.customerAddress,
            }));
          }}
          onLead={setLeadId}
          onClear={() => { setAccountId(null); setLeadId(null); }}
          extras={extras} setExtras={setExtras}
        />
      )}

      {step === 'Plan' && (
        <PlanStep input={input} set={set} setPlan={setPlan} />
      )}

      {step === 'Fleet' && (
        <FleetStep
          input={input} priced={priced.assets} openRow={openRow} onOpenRow={setOpenRow}
          onAsset={setAsset} onAdd={addAsset} onDuplicate={duplicateAsset} onRemove={removeAsset}
        />
      )}

      {step === 'Money' && (
        <MoneyStep input={input} set={set} priced={priced} may={may} />
      )}

      {step === 'Wording' && (
        <WordingStep input={input} priced={priced} extras={extras} setExtras={setExtras} />
      )}

      {step === 'Review' && (
        <ReviewStep input={input} priced={priced} extras={extras} reference={reference} />
      )}
    </Drawer>
  );
}

/* ---------------- 1. customer ---------------- */

function CustomerStep({
  accounts, query, onQuery, accountId, leads, leadId, input, set,
  onPick, onLead, onClear, extras, setExtras,
}: {
  accounts: { id: string; company_name: string | null; contact_name: string | null; location: string | null }[];
  query: string;
  onQuery: (v: string) => void;
  accountId: string | null;
  leads: { id: string; company_name: string | null; requirement: string | null }[];
  leadId: string | null;
  input: ContractInput;
  set: <K extends keyof ContractInput>(k: K, v: ContractInput[K]) => void;
  onPick: (a: { id: string; company_name: string | null; contact_name: string | null; location: string | null }) => void;
  onLead: (id: string | null) => void;
  onClear: () => void;
  extras: ContractExtras;
  setExtras: (e: ContractExtras) => void;
}) {
  return (
    <>
      <Field
        label="Who is this for"
        hint="Search the CRM. Picking an account fills the name, the contact and the address, and links the contract to them."
      >
        <SearchInput value={query} onChange={onQuery} placeholder="Search customers" icon={<Search size={14} />} />
      </Field>

      <div style={{ ...PANEL, maxHeight: 200, overflowY: 'auto' }}>
        {accounts.length === 0 ? (
          <div style={{ padding: 12, fontSize: 12.5, color: 'var(--text-subtle)' }}>
            Nothing in the CRM matches that. Type the name below and the contract still works: it
            just will not be attached to an account.
          </div>
        ) : accounts.map((a) => (
          <button
            key={a.id}
            onClick={() => onPick(a)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
              padding: '9px 12px', cursor: 'pointer', background: 'transparent', border: 0,
              borderBottom: '1px solid var(--border)',
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                {a.company_name ?? 'Unnamed account'}
              </span>
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-subtle)' }}>
                {[a.contact_name, a.location].filter(Boolean).join(' · ') || 'No contact on file'}
              </span>
            </span>
            {accountId === a.id
              ? <Badge tone="success" dot>On this contract</Badge>
              : <span style={{ fontSize: 11.5, color: 'var(--accent)' }}>Use</span>}
          </button>
        ))}
      </div>

      {accountId && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <Badge tone="neutral" dot>Attached to a CRM account</Badge>
          <Button size="sm" variant="ghost" onClick={onClear}>Detach</Button>
          {leads.length > 0 && (
            <div style={{ width: 300 }}>
              <Field label="Against which pitch" hint="Optional. Links the contract to the lead it came out of.">
                <Select value={leadId ?? ''} onChange={(v) => onLead(v || null)}>
                  <option value="">Not against a particular lead</option>
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.requirement?.slice(0, 60) || l.company_name || 'A lead'}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
        </div>
      )}

      <Split>
        <Field label="Customer name" hint="What prints on the contract.">
          <TextInput value={input.customerName} onChange={(v) => set('customerName', v)} />
        </Field>
        <Field label="Contact">
          <TextInput value={input.customerContact} onChange={(v) => set('customerContact', v)} />
        </Field>
        <Field label="Company number" hint="Optional.">
          <TextInput
            value={extras.companyNumber}
            onChange={(v) => setExtras({ ...extras, companyNumber: v })}
          />
        </Field>
        <Field label="Maximum mileage a year">
          <TextInput
            type="number"
            value={extras.maximumMileage == null ? '' : String(extras.maximumMileage)}
            onChange={(v) => setExtras({ ...extras, maximumMileage: v === '' ? null : Number(v) })}
          />
        </Field>
      </Split>

      <Field label="Address">
        <TextArea rows={2} value={input.customerAddress} onChange={(v) => set('customerAddress', v)} />
      </Field>

      <Field
        label="Registered address"
        hint="Only if it differs from the address above. Blank uses that one."
      >
        <TextInput
          value={extras.registeredAddress}
          onChange={(v) => setExtras({ ...extras, registeredAddress: v })}
        />
      </Field>

      <Split cols={3}>
        <Field label="Account manager">
          <TextInput
            value={extras.accountManagerName}
            onChange={(v) => setExtras({ ...extras, accountManagerName: v })}
          />
        </Field>
        <Field label="Their phone">
          <TextInput
            value={extras.accountManagerPhone}
            onChange={(v) => setExtras({ ...extras, accountManagerPhone: v })}
          />
        </Field>
        <Field label="Their email">
          <TextInput
            value={extras.accountManagerEmail}
            onChange={(v) => setExtras({ ...extras, accountManagerEmail: v })}
          />
        </Field>
      </Split>
    </>
  );
}

/* ---------------- 2. plan ---------------- */

function PlanStep({
  input, set, setPlan,
}: {
  input: ContractInput;
  set: <K extends keyof ContractInput>(k: K, v: ContractInput[K]) => void;
  setPlan: (p: Plan) => void;
}) {
  return (
    <>
      <Label>The plan</Label>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        {PLANS.map((p) => (
          <OptionCard
            key={p}
            selected={input.plan === p}
            onSelect={() => setPlan(p)}
            icon={<Truck size={16} />}
            title={`FleetSmart+ ${p}`}
            description={PLAN_BLURB[p]}
          />
        ))}
      </div>

      {input.plan === 'Platinum' && (
        <Alert tone="info">
          Platinum carries the tail lift LOLER and weight test, so every asset starts with the tail
          lift box ticked. Turn it off on anything that has no tail lift.
        </Alert>
      )}
      {input.plan !== 'Platinum' && (
        <Alert tone="info">
          On this plan a tail lift is an optional extra rather than part of the cover, and wear and
          tear is not included. Both can still be added to an individual asset on the fleet step.
        </Alert>
      )}

      <Split>
        <Field label="Term">
          <Select value={String(input.termMonths)} onChange={(v) => set('termMonths', Number(v))}>
            {TERM_MONTHS.map((m) => <option key={m} value={m}>{m} months</option>)}
          </Select>
        </Field>
        <Field label="Start date">
          <TextInput type="date" value={input.startDate} onChange={(v) => set('startDate', v)} />
        </Field>
      </Split>

      <Label>Labour rates</Label>
      <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: -4 }}>
        These price collection and delivery, and the HGV rate prints in the Charges block as the
        rate for non-contract repairs.
      </div>
      <Split cols={3}>
        <Field label="HGV, per hour">
          <TextInput type="number" value={String(input.labourHgv)} onChange={(v) => set('labourHgv', Number(v) || 0)} />
        </Field>
        <Field label="Trailer, per hour">
          <TextInput type="number" value={String(input.labourTrailer)} onChange={(v) => set('labourTrailer', Number(v) || 0)} />
        </Field>
        <Field label="Van, per hour">
          <TextInput type="number" value={String(input.labourVan)} onChange={(v) => set('labourVan', Number(v) || 0)} />
        </Field>
      </Split>
    </>
  );
}

/* ---------------- 3. fleet ---------------- */

function FleetStep({
  input, priced, openRow, onOpenRow, onAsset, onAdd, onDuplicate, onRemove,
}: {
  input: ContractInput;
  priced: PricedAsset[];
  openRow: string | null;
  onOpenRow: (k: string | null) => void;
  onAsset: (key: string, patch: Partial<FleetAsset>) => void;
  onAdd: () => void;
  onDuplicate: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  const byKey = new Map(priced.map((p) => [p.key, p]));

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <Label>The fleet</Label>
        <span style={{ fontSize: 12, color: 'var(--text-subtle)', flex: 1 }}>
          A reg and an asset type is enough. Everything else fills itself in from the plan and the
          class, and anything you type over the top wins.
        </span>
        <Button size="sm" variant="primary" onClick={onAdd}><Plus size={13} /> Add an asset</Button>
      </div>

      {input.assets.length === 0 && (
        <EmptyState
          what="No assets yet"
          why="Add the first vehicle or trailer and the price starts working. One row per asset, and a row can be duplicated for a fleet of the same thing."
          action={<Button size="sm" variant="primary" onClick={onAdd}><Plus size={13} /> Add an asset</Button>}
        />
      )}

      {input.assets.map((a) => {
        const p = byKey.get(a.key);
        const { cls } = describe(a.type);
        const open = openRow === a.key;
        return (
          <div key={a.key} style={PANEL}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap',
              padding: '10px 12px', borderBottom: open ? '1px solid var(--border)' : 'none',
            }}>
              <div style={{ width: 150 }}>
                <TextInput
                  value={a.reg}
                  onChange={(v) => onAsset(a.key, { reg: v.toUpperCase() })}
                  placeholder="Reg or asset ref"
                />
              </div>
              <div style={{ width: 170 }}>
                <Select value={a.type} onChange={(v) => onAsset(a.key, { type: v as AssetType })}>
                  <option value="">Pick an asset type</option>
                  {ASSET_TYPES.map((t) => <option key={t.type} value={t.type}>{t.type}</option>)}
                </Select>
              </div>
              {cls && <Badge tone="neutral">{cls}</Badge>}
              {p && p.warnings.length > 0 && (
                <span title={`${p.warnings.length} thing(s) to check`}>
                  <Badge tone="warning"><AlertTriangle size={10} /> {p.warnings.length}</Badge>
                </span>
              )}

              <span style={{ flex: 1 }} />

              <span style={{
                fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 14,
                fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
              }}>
                {p ? money(p.monthly) : money(0)}
                <span style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--text-subtle)' }}> /mo</span>
              </span>

              <Button size="sm" variant="secondary" onClick={() => onOpenRow(open ? null : a.key)}>
                {open ? 'Done' : 'Options'}
              </Button>
              <IconButton label="Duplicate this asset" onClick={() => onDuplicate(a.key)}>
                <Copy size={13} />
              </IconButton>
              <IconButton label="Remove this asset" danger onClick={() => onRemove(a.key)}>
                <Trash2 size={13} />
              </IconButton>
            </div>

            {open && (
              <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Split cols={3}>
                  <Field label="Age, years" hint={input.plan === 'Platinum' ? 'Drives wear and tear.' : 'Not used on this plan.'}>
                    <TextInput
                      type="number" value={a.age == null ? '' : String(a.age)}
                      onChange={(v) => onAsset(a.key, { age: v === '' ? null : Number(v) })}
                    />
                  </Field>
                  <Field label="Miles a year" hint={input.plan === 'Platinum' ? '60,000 counts as a year of ageing.' : 'Not used on this plan.'}>
                    <TextInput
                      type="number" value={a.mileagePerYear == null ? '' : String(a.mileagePerYear)}
                      onChange={(v) => onAsset(a.key, { mileagePerYear: v === '' ? null : Number(v) })}
                    />
                  </Field>
                  <Field label="Inspection every">
                    <Select
                      value={a.pmiWeeks == null ? '' : String(a.pmiWeeks)}
                      onChange={(v) => onAsset(a.key, { pmiWeeks: v === '' ? null : Number(v) })}
                    >
                      <option value="">{defaultPmiWeeks(cls)} weeks (standard)</option>
                      {PMI_INTERVALS.map((w) => <option key={w} value={w}>{w} weeks</option>)}
                    </Select>
                  </Field>
                </Split>

                <Split cols={3}>
                  <Field label="C services a year">
                    <TextInput
                      type="number"
                      value={a.cServicesPerYear == null ? '' : String(a.cServicesPerYear)}
                      placeholder={`${defaultCServices(cls)} (standard)`}
                      onChange={(v) => onAsset(a.key, { cServicesPerYear: v === '' ? null : Number(v) })}
                    />
                  </Field>
                  <Field label="Brake tests a year">
                    <TextInput
                      type="number"
                      value={a.brakeTestsPerYear == null ? '' : String(a.brakeTestsPerYear)}
                      placeholder={`${defaultBrakeTests(cls)} (standard)`}
                      onChange={(v) => onAsset(a.key, { brakeTestsPerYear: v === '' ? null : Number(v) })}
                    />
                  </Field>
                  <Field
                    label="Laden RBTs a year"
                    hint={cls === 'Trailer' ? 'One is taken at MOT. Type the total for the year, not the extras.' : undefined}
                  >
                    <TextInput
                      type="number"
                      value={a.ladenRbtPerYear == null ? '' : String(a.ladenRbtPerYear)}
                      placeholder={`${defaultLadenRbt(cls)} (standard)`}
                      onChange={(v) => onAsset(a.key, { ladenRbtPerYear: v === '' ? null : Number(v) })}
                    />
                  </Field>
                </Split>

                <Split cols={3}>
                  <Field label="Work pattern">
                    <Select value={a.workPattern} onChange={(v) => onAsset(a.key, { workPattern: v as FleetAsset['workPattern'] })}>
                      {WORK_PATTERNS.map((w) => (
                        <option key={w.value} value={w.value}>
                          {w.label}{w.multiplier !== 1 ? ` (+${Math.round((w.multiplier - 1) * 100)}%)` : ''}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Tachograph">
                    <Select value={a.tacho} onChange={(v) => onAsset(a.key, { tacho: v as FleetAsset['tacho'] })}>
                      {TACHO_CHOICES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </Select>
                  </Field>
                  <Field label="Telematics, £ a year" hint="Brake performance monitoring, priced per asset.">
                    <TextInput
                      type="number"
                      value={a.telematicsPerYear == null ? '' : String(a.telematicsPerYear)}
                      placeholder="None"
                      onChange={(v) => onAsset(a.key, { telematicsPerYear: v === '' ? null : Number(v) })}
                    />
                  </Field>
                </Split>

                <Split cols={2}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <Checkbox
                      checked={a.outOfHours}
                      onChange={(v) => onAsset(a.key, { outOfHours: v })}
                      label="Worked out of hours"
                      hint="Adds 5% to every labour line."
                    />
                    <Checkbox
                      checked={a.tailLift}
                      onChange={(v) => onAsset(a.key, { tailLift: v })}
                      label="Has a tail lift"
                      hint={input.plan === 'Platinum'
                        ? 'Platinum carries the LOLER and weight test.'
                        : 'Adds tail lift cover as an optional extra.'}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <Checkbox
                      checked={a.collectionAndDelivery}
                      onChange={(v) => onAsset(a.key, { collectionAndDelivery: v })}
                      label="Collection and delivery"
                      hint="One hour of labour per visit."
                    />
                    {input.plan === 'Silver' ? (
                      <Checkbox
                        checked={a.portalAddOn}
                        onChange={(v) => onAsset(a.key, { portalAddOn: v })}
                        label="Compliance portal add-on"
                        hint="£100 a year. On Gold and Platinum the portal is already in the plan."
                      />
                    ) : (
                      <div style={{ padding: '5px 0', fontSize: 12.5, color: 'var(--text-subtle)' }}>
                        Compliance portal access is part of {input.plan} and cannot be removed.
                      </div>
                    )}
                  </div>
                </Split>

                <Split>
                  <Field
                    label="Wear and tear, £ a year"
                    hint={input.plan === 'Platinum'
                      ? `Automatic figure is ${money(autoWearAndTear(a.type, a.age, a.mileagePerYear))}. Type over it to set your own.`
                      : 'Not part of this plan. Type a figure to add one anyway.'}
                  >
                    <TextInput
                      type="number"
                      value={a.wearAndTear == null ? '' : String(a.wearAndTear)}
                      placeholder={input.plan === 'Platinum'
                        ? String(autoWearAndTear(a.type, a.age, a.mileagePerYear))
                        : 'Not in plan'}
                      onChange={(v) => onAsset(a.key, { wearAndTear: v === '' ? null : Number(v) })}
                    />
                  </Field>
                  <Field
                    label="Miscellaneous, £ a year"
                    hint="Anything agreed that the plan does not cover: wheels painted monthly, a one-off allowance, a bespoke consumable."
                  >
                    <TextInput
                      type="number"
                      value={a.misc == null ? '' : String(a.misc)}
                      placeholder="None"
                      onChange={(v) => onAsset(a.key, { misc: v === '' ? null : Number(v) })}
                    />
                  </Field>
                </Split>

                <Field label="Note" hint="Why this asset is set up the way it is. Never printed on the contract.">
                  <TextInput value={a.note} onChange={(v) => onAsset(a.key, { note: v })} />
                </Field>

                {p && p.warnings.length > 0 && (
                  <Alert tone="warning">
                    <span>
                      <span style={{ display: 'block', fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>
                        Worth checking before this goes out
                      </span>
                      {p.warnings.map((w, i) => <span key={i} style={{ display: 'block' }}>{w}</span>)}
                    </span>
                  </Alert>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/* ---------------- 4. money ---------------- */

function MoneyStep({
  input, set, priced, may,
}: {
  input: ContractInput;
  set: <K extends keyof ContractInput>(k: K, v: ContractInput[K]) => void;
  priced: ReturnType<typeof priceContract>;
  may: (c: string) => boolean;
}) {
  const [showing, setShowing] = useState<string | null>(priced.assets[0]?.key ?? null);
  const open = priced.assets.find((a) => a.key === showing);

  return (
    <>
      <Split>
        {may('fleetsmart.discount') ? (
          <Field
            label="Manager's discount"
            hint="A percentage off the whole contract, taken before the promotional discount."
          >
            <TextInput
              type="number"
              value={String(Math.round(input.managerDiscount * 1000) / 10)}
              trailing={<span style={{ fontSize: 12 }}>%</span>}
              onChange={(v) => set('managerDiscount', (Number(v) || 0) / 100)}
            />
          </Field>
        ) : (
          <Field label="Manager's discount" hint="Ask an administrator. This one is not yours to set.">
            <TextInput value="None" readOnly />
          </Field>
        )}
        <Field
          label="Promotional discount"
          hint="Under 1 is read as a percentage, so 0.1 is ten percent. Anything else is pounds. Capped at the contract total."
        >
          <TextInput
            type="number"
            value={input.promoDiscount ? String(input.promoDiscount) : ''}
            placeholder="None"
            onChange={(v) => set('promoDiscount', Number(v) || 0)}
          />
        </Field>
      </Split>

      <Checkbox
        checked={input.promoOnContract}
        onChange={(v) => set('promoOnContract', v)}
        label="Show the promotional discount on the contract"
        hint="Off keeps it internal: the customer sees only the lower monthly figure, and the per asset prices stay at full price either way."
      />

      {/* ---- what it comes to ---- */}
      <div style={PANEL}>
        <div style={{
          display: 'flex', alignItems: 'center', height: 34, padding: '0 14px',
          background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
        }}>
          <Label>What it comes to</Label>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {[
              ['Contract total, a year', priced.subtotal, false],
              ...(priced.managerDiscount ? [["Less manager's discount", priced.managerDiscount, false] as const] : []),
              ...(priced.promoDiscount ? [['Less promotional discount', priced.promoDiscount, false] as const] : []),
              ['Contract, a year', priced.annual, true],
            ].map(([label, value, strong], i) => (
              <tr key={i}>
                <td style={{ ...TD, color: strong ? 'var(--text)' : 'var(--text-muted)', fontWeight: strong ? 600 : 400 }}>
                  {label as string}
                </td>
                <td style={{
                  ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                  fontWeight: strong ? 700 : 400,
                  color: (value as number) < 0 ? 'var(--accent)' : 'var(--text)',
                }}>{money(value as number)}</td>
              </tr>
            ))}
            <tr>
              <td style={{ ...TD, fontWeight: 600, color: 'var(--text)' }}>A month</td>
              <td style={{
                ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 15, color: 'var(--text)',
              }}>{money(priced.monthly)}</td>
            </tr>
            <tr>
              <td style={{ ...TD, borderBottom: 'none', color: 'var(--text-subtle)' }}>A week</td>
              <td style={{
                ...TD, borderBottom: 'none', textAlign: 'right',
                fontVariantNumeric: 'tabular-nums', color: 'var(--text-subtle)',
              }}>{money(priced.weekly)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ---- every line, per asset ---- */}
      <Label>Every line</Label>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {priced.assets.filter((a) => a.reg.trim()).map((a) => (
          <Chip key={a.key} active={showing === a.key} onClick={() => setShowing(a.key)}>
            {a.reg}
          </Chip>
        ))}
      </div>

      {open ? (
        <div style={{ ...PANEL, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH}>Line</th>
                <th style={{ ...TH, textAlign: 'right' }}>Price</th>
                <th style={{ ...TH, textAlign: 'right' }}>A year</th>
                <th style={{ ...TH, textAlign: 'right' }}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {open.lines.map((l, i) => (
                <tr key={i} style={{ opacity: l.included ? 1 : 0.45 }}>
                  <td style={{ ...TD, color: l.included ? 'var(--text)' : 'var(--text-subtle)' }}>
                    {l.line}
                    {l.labour && l.included && (
                      <span style={{ color: 'var(--text-subtle)', fontSize: 11 }}> · labour</span>
                    )}
                    {!l.included && (
                      <span style={{ color: 'var(--text-subtle)', fontSize: 11 }}> · not in this plan</span>
                    )}
                  </td>
                  <td style={{ ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {l.price ? money(l.price) : '—'}
                  </td>
                  <td style={{ ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {l.frequency || '—'}
                  </td>
                  <td style={{
                    ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                    fontWeight: l.cost ? 600 : 400, color: l.cost ? 'var(--text)' : 'var(--text-subtle)',
                  }}>{l.cost ? money(l.cost) : '—'}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} style={{ ...TD, textAlign: 'right', fontWeight: 600, color: 'var(--text)' }}>
                  {open.reg}, a year
                </td>
                <td style={{
                  ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                  fontWeight: 800, fontFamily: 'var(--panton)', color: 'var(--text)',
                }}>{money(open.annual)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState what="No assets yet" why="Add one on the fleet step and every line it is charged appears here." />
      )}
    </>
  );
}

/* ---------------- 5. wording ---------------- */

const WORDING_ORDER: WordingKey[] = [
  'planTitle', 'term', 'services', 'exclusions', 'additional', 'charges', 'collection', 'payment',
];

function WordingStep({
  input, priced, extras, setExtras,
}: {
  input: ContractInput;
  priced: ReturnType<typeof priceContract>;
  extras: ContractExtras;
  setExtras: (e: ContractExtras) => void;
}) {
  return (
    <>
      <Alert tone="info">
        Every block writes itself from the plan and the fleet, so the contract can never promise
        something the customer is not being charged for. Type into one to override it for this
        customer; clear it and the automatic text comes back.
      </Alert>

      {WORDING_ORDER.map((key) => {
        const auto = autoWording(key, input, priced);
        const own = extras.overrides[key] ?? '';
        return (
          <div key={key} style={PANEL}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 9, height: 34, padding: '0 14px',
              background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
            }}>
              <Label>{WORDING_LABEL[key]}</Label>
              <span style={{ flex: 1 }} />
              {own
                ? <Badge tone="warning">Your version</Badge>
                : <Badge tone="neutral">Automatic</Badge>}
              {own && (
                <Button
                  size="sm" variant="ghost"
                  onClick={() => {
                    const next = { ...extras.overrides };
                    delete next[key];
                    setExtras({ ...extras, overrides: next });
                  }}
                >Put the automatic text back</Button>
              )}
            </div>
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{
                fontSize: 12, lineHeight: 1.55, color: 'var(--text-muted)',
                whiteSpace: 'pre-wrap', padding: '9px 11px',
                background: 'var(--surface-sunken)', border: '1px solid var(--border)',
                borderRadius: 'var(--r)',
              }}>{auto}</div>
              <Field label="Your version" hint="Leave blank to use the text above.">
                <TextArea
                  rows={3}
                  value={own}
                  placeholder="Only if this customer needs different wording."
                  onChange={(v) => setExtras({ ...extras, overrides: { ...extras.overrides, [key]: v } })}
                />
              </Field>
            </div>
          </div>
        );
      })}
    </>
  );
}

/* ---------------- 6. review ---------------- */

function ReviewStep({
  input, priced, extras, reference,
}: {
  input: ContractInput;
  priced: ReturnType<typeof priceContract>;
  extras: ContractExtras;
  reference: string | null;
}) {
  const warnings = priced.assets.flatMap((a) => a.warnings.map((w) => `${a.reg}: ${w}`));

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <Label>The contract</Label>
        <span style={{ fontSize: 12, color: 'var(--text-subtle)', flex: 1 }}>
          This is what the customer receives. Print it to PDF and attach it, or send the link.
        </span>
        <Button size="sm" variant="secondary" onClick={() => window.print()}>
          <Printer size={13} /> Print or save as PDF
        </Button>
      </div>

      {warnings.length > 0 && (
        <Alert tone="warning">
          <span>
            <span style={{ display: 'block', fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>
              {warnings.length} thing{warnings.length === 1 ? '' : 's'} worth checking first
            </span>
            {warnings.slice(0, 8).map((w, i) => <span key={i} style={{ display: 'block' }}>{w}</span>)}
            {warnings.length > 8 && (
              <span style={{ display: 'block' }}>and {warnings.length - 8} more on the fleet step.</span>
            )}
          </span>
        </Alert>
      )}

      <div className="fs-doc-frame" style={{
        border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden',
      }}>
        <ContractDocument input={input} priced={priced} extras={extras} reference={reference} />
      </div>

      <ContractPrintRules />
    </>
  );
}
