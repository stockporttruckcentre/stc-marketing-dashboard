'use client';

import { useState } from 'react';
import { Minus, Plus, RotateCcw, Truck } from 'lucide-react';
import {
  ASSET_TYPES, PLANS, PMI_INTERVALS, TACHO_CHOICES, WORK_PATTERNS,
  type AssetType, type Plan, type RateCard,
} from '@/lib/fleetsmart/ratecard';
import { blankAsset, priceAsset } from '@/lib/fleetsmart/price';
import type { ContractInput, FleetAsset } from '@/lib/fleetsmart/types';
import { Checkbox, Field, Select, Split, TextInput } from '@/components/kit/forms';
import { Badge, Button, Label } from '@/components/kit/primitives';

/* =============================================================
   The fleet, edited as an amendment rather than as a form.

   The builder's fleet step is for a contract nobody has agreed to yet,
   so every row there looks the same. On an amendment they do not: an
   asset that was on the contract yesterday, one being added today and
   one being taken off are three different things, and a screen that
   draws them identically makes somebody count rows to find out what
   they just did.

   So each row says which it is, and a row taken off stays visible with
   a line through it until the amendment is applied. Removing something
   by making it disappear is how people delete the wrong trailer.

   ---- Only what changes on a live contract ----

   The per asset detail here is deliberately shorter than the builder's.
   What a customer rings up about mid contract is an asset on, an asset
   off, a plan move, a wear and tear figure, a tail lift, collection and
   delivery, telematics, or the inspection interval. The rest is set
   when the contract is written and almost never moves, and a form that
   offers everything makes the eight things that matter harder to find.
   Anything not here is still changed by taking the contract back and
   editing it, which is the other verb and is recorded differently.
   ============================================================= */

const money = (n: number) =>
  n.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 });

function key(a: FleetAsset): string {
  return a.reg.trim().toLowerCase();
}

export function AmendFleet({
  input, before, onChange, card,
}: {
  input: ContractInput;
  /** The contract as it stands, so a row can say whether it is new. */
  before: ContractInput;
  onChange: (next: ContractInput) => void;
  card: RateCard;
}) {
  const [open, setOpen] = useState<string | null>(null);

  const wasOn = new Set(
    before.assets.filter((a) => a.reg.trim() && a.type).map(key),
  );
  /* Assets on the contract that are no longer in the list. Kept in view
     rather than vanishing, because a removal somebody cannot see is a
     removal they cannot check. */
  const stillHere = new Set(input.assets.map(key));
  const removed = before.assets.filter(
    (a) => a.reg.trim() && a.type && !stillHere.has(key(a)),
  );

  function setAsset(k: string, patch: Partial<FleetAsset>) {
    onChange({
      ...input,
      assets: input.assets.map((a) => (a.key === k ? { ...a, ...patch } : a)),
    });
  }

  function add() {
    const k = `n${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
    onChange({ ...input, assets: [...input.assets, blankAsset(k, input.plan)] });
    setOpen(k);
  }

  function take(k: string) {
    onChange({ ...input, assets: input.assets.filter((a) => a.key !== k) });
    if (open === k) setOpen(null);
  }

  function putBack(a: FleetAsset) {
    onChange({ ...input, assets: [...input.assets, a] });
  }

  return (
    <>
      {/* ---- the plan, which moves everything ---- */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        padding: '11px 14px', background: 'var(--bg-subtle)',
        border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
      }}>
        <div style={{ width: 150 }}>
          <Field label="Plan">
            <Select
              value={input.plan}
              onChange={(v) => {
                const plan = v as Plan;
                /* Moving to Platinum turns the tail lift on for every
                   asset that has not been told otherwise, the same way
                   a new contract does, because Platinum carries the
                   LOLER test. Moving off it does not turn anything off:
                   somebody who is paying for tail lift cover keeps it
                   until they say otherwise. */
                onChange({
                  ...input,
                  plan,
                  assets: plan === 'Platinum'
                    ? input.assets.map((a) => ({ ...a, tailLift: true }))
                    : input.assets,
                });
              }}
            >
              {PLANS.map((p) => <option key={p} value={p}>FleetSmart+ {p}</option>)}
            </Select>
          </Field>
        </div>
        {input.plan !== before.plan && (
          <Badge tone="warning" dot>
            Moving from {before.plan} to {input.plan}
          </Badge>
        )}
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="secondary" onClick={add}>
          <Plus size={13} /> Add an asset
        </Button>
      </div>

      {/* ---- the assets ---- */}
      <div style={{
        border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
        background: 'var(--surface)', overflow: 'hidden',
      }}>
        {input.assets.length === 0 && (
          <div style={{ padding: 16, fontSize: 12.5, color: 'var(--text-subtle)' }}>
            Every asset has been taken off. A contract cannot cover nothing, so put one back or end
            the contract instead.
          </div>
        )}

        {input.assets.map((a) => {
          const fresh = a.reg.trim() !== '' && !wasOn.has(key(a));
          const priced = a.reg.trim() && a.type ? priceAsset(a, input, card) : null;
          const showing = open === a.key;

          return (
            <div key={a.key} style={{ borderBottom: '1px solid var(--border)' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 11, padding: '9px 14px',
                background: fresh ? 'var(--bg-subtle)' : 'transparent',
              }}>
                <Truck size={14} style={{ flex: 'none', color: 'var(--text-subtle)' }} />
                <div style={{ width: 150 }}>
                  <TextInput
                    value={a.reg}
                    placeholder="Registration"
                    onChange={(v) => setAsset(a.key, { reg: v })}
                  />
                </div>
                <div style={{ width: 168 }}>
                  <Select value={a.type} onChange={(v) => setAsset(a.key, { type: v as AssetType })}>
                    <option value="">Pick an asset type</option>
                    {ASSET_TYPES.map((t) => <option key={t.type} value={t.type}>{t.type}</option>)}
                  </Select>
                </div>

                {fresh && <Badge tone="success" dot>Being added</Badge>}

                <span style={{ flex: 1 }} />

                <span style={{
                  fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 13,
                  fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)',
                  whiteSpace: 'nowrap',
                }}>
                  {priced ? `${money(priced.annual)} a year` : 'not priced yet'}
                </span>

                <Button size="sm" variant="ghost" onClick={() => setOpen(showing ? null : a.key)}>
                  {showing ? 'Done' : 'Detail'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => take(a.key)}>
                  <Minus size={13} /> Take off
                </Button>
              </div>

              {showing && (
                <div style={{ padding: '4px 14px 14px', display: 'grid', gap: 10 }}>
                  <Split cols={3}>
                    <Field label="Inspections" hint="Weeks between them.">
                      <Select
                        value={a.pmiWeeks == null ? '' : String(a.pmiWeeks)}
                        onChange={(v) => setAsset(a.key, { pmiWeeks: v === '' ? null : Number(v) })}
                      >
                        <option value="">The standard for this class</option>
                        {PMI_INTERVALS.map((w) => <option key={w} value={w}>Every {w} weeks</option>)}
                      </Select>
                    </Field>
                    <Field label="Work pattern">
                      <Select
                        value={a.workPattern}
                        onChange={(v) => setAsset(a.key, { workPattern: v as FleetAsset['workPattern'] })}
                      >
                        {WORK_PATTERNS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                      </Select>
                    </Field>
                    <Field label="Tacho">
                      <Select
                        value={a.tacho}
                        onChange={(v) => setAsset(a.key, { tacho: v as FleetAsset['tacho'] })}
                      >
                        {TACHO_CHOICES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </Select>
                    </Field>
                  </Split>

                  <Split cols={3}>
                    <Field
                      label="Wear and tear, a year"
                      hint={input.plan === 'Platinum'
                        ? 'Blank uses the automatic figure for its age and mileage.'
                        : 'Not part of this plan. A figure here adds it.'}
                    >
                      <TextInput
                        type="number"
                        value={a.wearAndTear == null ? '' : String(a.wearAndTear)}
                        placeholder={input.plan === 'Platinum' ? 'Automatic' : 'None'}
                        onChange={(v) => setAsset(a.key, { wearAndTear: v === '' ? null : Number(v) })}
                      />
                    </Field>
                    <Field label="Telematics, a year">
                      <TextInput
                        type="number"
                        value={a.telematicsPerYear == null ? '' : String(a.telematicsPerYear)}
                        placeholder="None"
                        onChange={(v) => setAsset(a.key, { telematicsPerYear: v === '' ? null : Number(v) })}
                      />
                    </Field>
                    <Field label="Anything else agreed, a year">
                      <TextInput
                        type="number"
                        value={a.misc == null ? '' : String(a.misc)}
                        placeholder="None"
                        onChange={(v) => setAsset(a.key, { misc: v === '' ? null : Number(v) })}
                      />
                    </Field>
                  </Split>

                  <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                    <Checkbox
                      checked={a.tailLift}
                      onChange={(v) => setAsset(a.key, { tailLift: v })}
                      label="Tail lift"
                      hint={input.plan === 'Platinum'
                        ? 'Part of Platinum. Turn off if it has no tail lift.'
                        : 'An optional extra on this plan.'}
                    />
                    <Checkbox
                      checked={a.collectionAndDelivery}
                      onChange={(v) => setAsset(a.key, { collectionAndDelivery: v })}
                      label="Collection and delivery"
                      hint="An hour of labour per visit."
                    />
                    <Checkbox
                      checked={a.outOfHours}
                      onChange={(v) => setAsset(a.key, { outOfHours: v })}
                      label="Out of hours"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ---- what is coming off ---- */}
      {removed.length > 0 && (
        <>
          <Label>Coming off the contract</Label>
          <div style={{
            border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
            background: 'var(--surface)', overflow: 'hidden',
          }}>
            {removed.map((a) => (
              <div key={a.key} style={{
                display: 'flex', alignItems: 'center', gap: 11, padding: '9px 14px',
                borderBottom: '1px solid var(--border)',
              }}>
                <Minus size={14} style={{ flex: 'none', color: 'var(--text-subtle)' }} />
                <span style={{
                  fontFamily: 'var(--inter)', fontSize: 13, color: 'var(--text-muted)',
                  textDecoration: 'line-through',
                }}>
                  {a.type} {a.reg.trim()}
                </span>
                <span style={{ flex: 1 }} />
                <span style={{
                  fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 13,
                  fontVariantNumeric: 'tabular-nums', color: 'var(--text-subtle)',
                }}>
                  {money(-priceAsset(a, before, card).annual)} a year
                </span>
                <Button size="sm" variant="ghost" onClick={() => putBack(a)}>
                  <RotateCcw size={13} /> Put it back
                </Button>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
