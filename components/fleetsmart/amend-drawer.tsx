'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowRight, FileText, Plus, Minus, TrendingDown, TrendingUp,
} from 'lucide-react';
import type { ContractInput } from '@/lib/fleetsmart/types';
import { priceContract } from '@/lib/fleetsmart/price';
import { describeAmendment, nothingChanged, type Change } from '@/lib/fleetsmart/amend';
import type { RateCard } from '@/lib/fleetsmart/ratecard';
import { Drawer, Field, Split, TextArea } from '@/components/kit/forms';
import { DatePicker } from './date-picker';
import { AmendFleet } from './amend-fleet';
import { Alert, Badge, Button, Label } from '@/components/kit/primitives';

/* =============================================================
   Changing a live contract, and seeing exactly what that does.

   From the business: "The logic all needs to be bulletproof and
   well-presented for understanding." Migration 072 is the bulletproof
   half. This is the understanding.

   ---- What somebody has to be able to see before they commit ----

   Three things, in this order, because that is the order the questions
   arrive in:

     What am I changing        the fleet, edited in place
     What does that change     every difference, in sentences
     What does it cost now     before, after, and the difference

   The last one is the one that gets read out loud on the phone, so it
   is the biggest thing on the screen and it moves as somebody types.

   ---- Why the money is per line where it can be, and blank where it
        cannot ----

   Adding a trailer has a price of its own and saying so saves an
   argument. Moving from Silver to Gold changes what every line on every
   asset costs, and splitting that across the fleet would be inventing a
   number. So those lines carry no figure and the total at the bottom
   carries it, which is honest and is also how anybody would explain it
   in a room.

   ---- The effective date ----

   Asked for, never guessed, and never used to prorate anything. What
   the billing run needs is the date. What this can state with certainty
   is the annual figure from that date. Anything in between depends on
   the direct debit cycle and what was actually invoiced, neither of
   which this application holds.
   ============================================================= */

const money = (n: number) =>
  n.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 });

const KIND_ICON: Record<Change['kind'], typeof Plus> = {
  'plan': ArrowRight,
  'term': ArrowRight,
  'asset-added': Plus,
  'asset-removed': Minus,
  'asset-changed': ArrowRight,
  'money': ArrowRight,
  'other': ArrowRight,
};

export function AmendDrawer({
  contract, card, onClose, onApplied,
}: {
  contract: {
    id: string;
    ref: string | null;
    customer_name: string;
    starts_on: string | null;
    input: ContractInput;
  };
  card: RateCard;
  onClose: () => void;
  onApplied: (message: string) => void;
}) {
  /* The contract as it stands, kept untouched, because every figure on
     this screen is the difference between it and what somebody is
     typing. */
  const before = contract.input;
  const [after, setAfter] = useState<ContractInput>(() => structuredClone(contract.input));
  const [effective, setEffective] = useState(() => todayIso());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pricedBefore = useMemo(() => priceContract(before, card), [before, card]);
  const pricedAfter = useMemo(() => priceContract(after, card), [after, card]);
  const summary = useMemo(
    () => describeAmendment(before, after, pricedBefore, pricedAfter, card),
    [before, after, pricedBefore, pricedAfter, card],
  );

  const empty = nothingChanged(summary);
  const monthlyBefore = pricedBefore.monthly;
  const monthlyAfter = pricedAfter.monthly;

  async function apply() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/fleetsmart/contracts/${contract.id}/amend`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: after, effective_on: effective, note }),
      });
      const json = await res.json();
      if (!json.ok) { setError(json.message ?? 'That amendment would not apply.'); return; }
      onApplied(
        `${contract.ref ?? 'The contract'} is amended from ${effective}. `
        + `${money(pricedAfter.annual)} a year, ${summary.difference >= 0 ? 'up' : 'down'} `
        + `${money(Math.abs(summary.difference))}.`,
      );
    } catch {
      setError('That did not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      eyebrow={contract.ref ? `Amending ${contract.ref}` : 'Amending a contract'}
      title={contract.customer_name || 'This contract'}
      icon={<FileText size={18} />}
      onClose={onClose}
      width={1000}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <span style={{ flex: 1 }} />
          <span style={{
            fontFamily: 'var(--inter)', fontSize: 12, color: 'var(--text-subtle)',
          }}>
            {empty ? 'Nothing has changed yet' : `${summary.changes.length} change${summary.changes.length === 1 ? '' : 's'}`}
          </span>
          <Button
            size="md" variant="primary"
            disabled={busy || empty || !effective}
            onClick={apply}
          >
            {busy ? 'Applying' : 'Apply the amendment'}
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger"><AlertTriangle size={13} /> {error}</Alert>}

      {/* ---- what it costs, before and after ---- */}
      <div style={{
        display: 'flex', alignItems: 'stretch', gap: 0, flexWrap: 'wrap',
        border: '1px solid var(--border-strong)', borderRadius: 'var(--r-md)',
        background: 'var(--surface)', overflow: 'hidden',
      }}>
        <Money label="Now" annual={pricedBefore.annual} monthly={monthlyBefore} />
        <span style={{
          display: 'flex', alignItems: 'center', padding: '0 6px',
          color: 'var(--text-subtle)', borderLeft: '1px solid var(--border)',
          borderRight: '1px solid var(--border)', background: 'var(--bg-subtle)',
        }}><ArrowRight size={18} /></span>
        <Money label="After this amendment" annual={pricedAfter.annual} monthly={monthlyAfter} strong />
        <div style={{
          flex: 1, minWidth: 190, padding: '13px 16px',
          borderLeft: '1px solid var(--border)', background: 'var(--bg-subtle)',
        }}>
          <Label>The difference</Label>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7, marginTop: 4,
            fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 20,
            letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums',
            color: summary.difference === 0 ? 'var(--text-subtle)' : 'var(--text)',
          }}>
            {summary.difference !== 0 && (
              summary.difference > 0
                ? <TrendingUp size={16} style={{ color: 'var(--text-muted)' }} />
                : <TrendingDown size={16} style={{ color: 'var(--text-muted)' }} />
            )}
            {summary.difference === 0 ? 'No change'
              : `${summary.difference > 0 ? '+' : ''}${money(summary.difference)}`}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 2 }}>
            {summary.difference === 0 ? 'to the yearly figure'
              : `a year, which is ${money(Math.abs(monthlyAfter - monthlyBefore))} a month`}
          </div>
        </div>
      </div>

      {/* ---- what changed, in sentences ---- */}
      <Label>What this amendment does</Label>
      {empty ? (
        <Alert tone="info">
          Nothing on the contract has changed yet. Edit the fleet below: add an asset, take one off,
          move the plan, or put a wear and tear figure on an asset that has none.
        </Alert>
      ) : (
        <div style={{
          border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
          background: 'var(--surface)', overflow: 'hidden',
        }}>
          {summary.changes.map((c, i) => {
            const Icon = KIND_ICON[c.kind];
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 11,
                padding: '10px 14px',
                borderBottom: i === summary.changes.length - 1 ? 0 : '1px solid var(--border)',
              }}>
                <Icon size={14} style={{ flex: 'none', color: 'var(--text-subtle)' }} />
                <span style={{
                  flex: 1, minWidth: 0, fontFamily: 'var(--inter)', fontSize: 13,
                  color: 'var(--text)',
                }}>{c.what}</span>
                <span style={{
                  fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 13,
                  fontVariantNumeric: 'tabular-nums',
                  color: c.delta == null ? 'var(--text-subtle)' : 'var(--text-muted)',
                  whiteSpace: 'nowrap',
                }}>
                  {c.delta == null
                    ? 'in the total'
                    : `${c.delta > 0 ? '+' : ''}${money(c.delta)} a year`}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {summary.changes.some((c) => c.delta == null) && !empty && (
        <p style={{
          margin: '-2px 0 0', fontFamily: 'var(--inter)', fontSize: 11.5,
          lineHeight: 1.5, color: 'var(--text-subtle)',
        }}>
          A change marked &quot;in the total&quot; has no price of its own. Moving between plans changes
          what every line on every asset costs, so splitting it across the fleet would be inventing a
          number. The difference above carries it.
        </p>
      )}

      {/* ---- when, and why ---- */}
      <Split>
        <DatePicker
          label="Takes effect from"
          value={effective}
          onChange={setEffective}
        />
        <Field label="Why, for the record" hint="Optional, and never derived. What changed is worked out above.">
          <TextArea rows={2} value={note} onChange={setNote}
            placeholder="They took on two more trailers at Carrington" />
        </Field>
      </Split>

      <Alert tone="info">
        The date is recorded for the billing run and nothing here prorates a part month. What
        happens between billing dates depends on the direct debit cycle and what was actually
        invoiced, and this does not hold either. What it can state is the yearly figure from that
        date, which is what is above.
      </Alert>

      {/* ---- the fleet, edited in place ---- */}
      <Label>The fleet, as it will be</Label>
      <AmendFleet input={after} before={before} onChange={setAfter} card={card} />
    </Drawer>
  );
}

/* ---------------- the money block ---------------- */

function Money({ label, annual, monthly, strong }: {
  label: string; annual: number; monthly: number; strong?: boolean;
}) {
  return (
    <div style={{ padding: '13px 16px', minWidth: 168 }}>
      <Label>{label}</Label>
      <div style={{
        marginTop: 4, fontFamily: 'var(--panton)', fontWeight: strong ? 800 : 700,
        fontSize: strong ? 20 : 18, letterSpacing: '-0.02em',
        fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
      }}>{money(annual)}</div>
      <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 2 }}>
        a year, {money(monthly)} a month
      </div>
    </div>
  );
}

function todayIso(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}
