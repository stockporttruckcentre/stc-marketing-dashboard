'use client';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Check, Copy, FileText, Plus, Printer, Search, Send, ShieldCheck, Trash2, X,
} from 'lucide-react';
import type { Plan } from '@/lib/fleetsmart/ratecard';
import type { ContractInput, PricedContract } from '@/lib/fleetsmart/types';
import { blankContract, blankExtras, type ContractExtras } from '@/lib/fleetsmart/contract';
import type { PickableAccount } from '@/lib/fleetsmart/account';
import { priceContract } from '@/lib/fleetsmart/price';
import { ContractDocument, ContractPrintRules } from '@/components/fleetsmart/document';
import { ContractWizard } from '@/components/fleetsmart/wizard';
import { Drawer } from '@/components/kit/forms';
import {
  Alert, Badge, Button, EmptyState, GridHint, IconButton, Label, PanelHead,
  RecordHead, SearchInput, StatStrip, TabShell, Tabs, type Tone,
} from '@/components/kit/primitives';

/* =============================================================
   FleetSmart+.

   The tab is a list of contracts and one button. Everything that makes
   a contract happens in the wizard, and everything that happens to one
   afterwards happens from a row: send it, record what the customer
   said, copy it for the next customer, throw the draft away.

   ---- Why a draft reopens in the wizard and a sent one does not ----

   A sent contract is a price somebody is holding STC to. Reopening it
   in an editor invites a quiet change to a figure that is already in a
   customer's inbox, so a sent contract opens as the document instead:
   read it, print it, record the answer. Building a different price
   means copying it, which produces a new draft with a new reference and
   leaves the sent one exactly as it went out.

   The database enforces the same thing rather than trusting this file.
   The update policy in migration 061 only lets a draft through unless
   the person also holds `fleetsmart.send`.

   ---- The numbers on the strip ----

   Everything on the strip counts contracts that are live rather than
   everything ever built: a declined contract from March is not pipeline
   and a draft nobody sent is not revenue. Accepted monthly value is the
   figure worth reading in a management meeting, so it is the one that
   gets the pound sign.
   ============================================================= */

export type ContractRow = {
  id: string;
  ref: string | null;
  account_id: string | null;
  lead_id: string | null;
  customer_name: string;
  plan: Plan;
  term_months: number;
  starts_on: string | null;
  status: 'draft' | 'sent' | 'accepted' | 'declined' | 'expired';
  input: ContractInput;
  priced: PricedContract;
  extras: ContractExtras;
  annual_total: number;
  monthly_total: number;
  asset_count: number;
  sent_at: string | null;
  sent_to: string | null;
  decided_at: string | null;
  decision_note: string | null;
  owner_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/* Everything the CRM holds that the builder can fill a contract from.
   See `lib/fleetsmart/account.ts`: the address in particular is three
   possible columns and picking between them is not a thing to do twice. */
type Account = PickableAccount;
type Lead = {
  id: string; contact_id: string | null; company_name: string | null; requirement: string | null;
};

type TabKey = 'live' | 'drafts' | 'sent' | 'won' | 'closed';

const STATUS_TONE: Record<ContractRow['status'], Tone> = {
  draft: 'neutral',
  sent: 'info',
  accepted: 'success',
  declined: 'danger',
  expired: 'warning',
};

const STATUS_LABEL: Record<ContractRow['status'], string> = {
  draft: 'Draft',
  sent: 'With customer',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Expired',
};

const money = (n: number) =>
  n.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });

const money2 = (n: number) =>
  n.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 });

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';

const TH: CSSProperties = {
  textAlign: 'left', padding: '0 12px', height: 32, position: 'sticky', top: 0,
  background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
  fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
  letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-subtle)',
  whiteSpace: 'nowrap', zIndex: 1,
};
const TD: CSSProperties = {
  padding: '0 12px', height: 36, borderBottom: '1px solid var(--border)',
  fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap',
};
const NUM: CSSProperties = { ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

export function FleetSmart({
  contracts, accounts, leads, capabilities, manager,
}: {
  contracts: ContractRow[];
  accounts: Account[];
  leads: Lead[];
  capabilities: string[];
  /** Whoever is looking, so a new contract carries their name as the account manager. */
  manager: { name: string; email: string; phone: string };
}) {
  const router = useRouter();
  const params = useSearchParams();
  const caps = useMemo(() => new Set(capabilities), [capabilities]);
  const may = useCallback((c: string) => caps.has(c), [caps]);

  const [tab, setTab] = useState<TabKey>('live');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /* One of the two things that can be open over the list: the wizard on
     a draft, or the document on a contract that has gone out. Never
     both, so they are one piece of state rather than two booleans that
     can disagree. */
  const [open, setOpen] = useState<
    | { kind: 'wizard'; row: ContractRow | null; seed: ContractInput; extras: ContractExtras }
    | { kind: 'document'; row: ContractRow }
    | null
  >(null);

  const counts = useMemo(() => ({
    live: contracts.filter((c) => c.status === 'draft' || c.status === 'sent').length,
    drafts: contracts.filter((c) => c.status === 'draft').length,
    sent: contracts.filter((c) => c.status === 'sent').length,
    won: contracts.filter((c) => c.status === 'accepted').length,
    closed: contracts.filter((c) => c.status === 'declined' || c.status === 'expired').length,
  }), [contracts]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contracts
      .filter((c) => {
        if (tab === 'live') return c.status === 'draft' || c.status === 'sent';
        if (tab === 'drafts') return c.status === 'draft';
        if (tab === 'sent') return c.status === 'sent';
        if (tab === 'won') return c.status === 'accepted';
        return c.status === 'declined' || c.status === 'expired';
      })
      .filter((c) => !q || `${c.ref ?? ''} ${c.customer_name} ${c.plan}`.toLowerCase().includes(q));
  }, [contracts, tab, query]);

  const accepted = contracts.filter((c) => c.status === 'accepted');
  const withCustomer = contracts.filter((c) => c.status === 'sent');

  const acceptedMonthly = accepted.reduce((t, c) => t + Number(c.monthly_total || 0), 0);
  const pipelineMonthly = withCustomer.reduce((t, c) => t + Number(c.monthly_total || 0), 0);
  const assetsCovered = accepted.reduce((t, c) => t + (c.asset_count || 0), 0);

  /* Decided contracts only, because a rate of "won out of everything
     ever typed" counts drafts nobody finished as losses. */
  const decided = contracts.filter((c) => c.status === 'accepted' || c.status === 'declined');
  const winRate = decided.length ? Math.round((accepted.length / decided.length) * 100) : null;

  /* Arriving from the tracker's New lead dialog with FleetSmart+
     picked. The builder opens straight away rather than landing
     somebody on a list and asking them to press New again, and the
     parameter is cleared so a refresh does not reopen it over work they
     have already saved. */
  useEffect(() => {
    if (params.get('new') !== '1') return;
    if (!may('fleetsmart.build')) return;
    startNew();
    router.replace('/dashboard/fleetsmart');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startNew() {
    setError(null); setNotice(null);
    setOpen({
      kind: 'wizard',
      row: null,
      seed: blankContract(),
      extras: {
        ...blankExtras(),
        accountManagerName: manager.name,
        accountManagerEmail: manager.email,
        accountManagerPhone: manager.phone,
      },
    });
  }

  function openRow(row: ContractRow) {
    setError(null); setNotice(null);
    if (row.status === 'draft' && may('fleetsmart.build')) {
      setOpen({ kind: 'wizard', row, seed: row.input, extras: { ...blankExtras(), ...row.extras } });
    } else {
      setOpen({ kind: 'document', row });
    }
  }

  /* Copying is deliberately a new draft in the wizard rather than a row
     written straight to the database. Nobody copies a contract without
     changing something, and a saved copy nobody edits is a second
     reference against the same customer for no reason. */
  function copyRow(row: ContractRow) {
    setError(null);
    setNotice(null);
    setOpen({
      kind: 'wizard',
      row: null,
      seed: { ...row.input, assets: row.input.assets.map((a, i) => ({ ...a, key: `a${i}` })) },
      extras: { ...blankExtras(), ...row.extras },
    });
  }

  async function post(url: string, body: unknown, id: string): Promise<boolean> {
    setBusy(id); setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) { setError(json.message ?? 'That did not go through.'); return false; }
      router.refresh();
      return true;
    } catch {
      setError('That did not reach the server. Try again.');
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function decide(row: ContractRow, status: 'accepted' | 'declined') {
    const ok = await post(`/api/fleetsmart/contracts/${row.id}/decide`, { status }, row.id);
    if (ok) {
      setNotice(status === 'accepted'
        ? `${row.ref ?? row.customer_name} is recorded as accepted.`
        : `${row.ref ?? row.customer_name} is recorded as declined.`);
      setOpen(null);
    }
  }

  async function send(row: ContractRow) {
    /* Who it went to. The customer's email where the builder filled one
       off the CRM record, and their contact's name where it did not.
       This used to be the contact name in every case, so a record of
       where a price was sent said "Kieren Richards" and not an address
       anybody could check. */
    const to = row.extras?.customerEmail?.trim() || row.input.customerContact;
    const ok = await post(
      `/api/fleetsmart/contracts/${row.id}/send`,
      { to },
      row.id,
    );
    if (ok) {
      setNotice(`${row.ref ?? row.customer_name} is marked as sent. Print the document and attach it.`);
    }
  }

  async function discard(row: ContractRow) {
    setBusy(row.id); setError(null);
    try {
      const res = await fetch(`/api/fleetsmart/contracts/${row.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.ok) { setError(json.message ?? 'That draft would not delete.'); return; }
      setNotice(`${row.ref ?? 'That draft'} is gone.`);
      router.refresh();
    } catch {
      setError('That did not reach the server. Try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <TabShell>
      <RecordHead
        icon={<ShieldCheck size={19} />}
        title="FleetSmart+"
        badges={<Badge tone="neutral">Contract Builder</Badge>}
        sub="Fixed price maintenance contracts, priced off the STC rate card as you build them. Contracts built here will show on your sales tracker and update in unison."
        actions={
          may('fleetsmart.build')
            ? <Button variant="accent" onClick={startNew}><Plus size={14} /> New contract</Button>
            : undefined
        }
      />

      <StatStrip items={[
        { label: 'Drafts', value: counts.drafts, note: counts.drafts === 1 ? 'in progress' : 'in progress' },
        {
          label: 'With customers',
          value: withCustomer.length,
          note: pipelineMonthly > 0 ? `${money(pipelineMonthly)} a month` : undefined,
        },
        { label: 'Accepted', value: accepted.length, note: winRate == null ? undefined : `${winRate}% of decided` },
        { label: 'Contracted', value: money(acceptedMonthly), note: 'a month' },
        { label: 'Assets covered', value: assetsCovered, note: 'on accepted contracts' },
      ]} />

      {error && <Alert tone="danger">{error}</Alert>}
      {notice && !error && <Alert tone="success">{notice}</Alert>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'live', label: 'Live', count: counts.live },
            { key: 'drafts', label: 'Drafts', count: counts.drafts },
            { key: 'sent', label: 'With customers', count: counts.sent },
            { key: 'won', label: 'Accepted', count: counts.won },
            { key: 'closed', label: 'Closed', count: counts.closed },
          ]}
        />
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Reference, customer or plan"
          icon={<Search size={14} />}
        />
      </div>

      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)', overflow: 'hidden', flex: 1,
        display: 'flex', flexDirection: 'column', minHeight: 0,
      }}>
        <PanelHead
          title="Contracts"
          count={shown.length}
          hint={query.trim() ? `matching "${query.trim()}"` : undefined}
        />

        {shown.length === 0 ? (
          <div style={{ padding: 28 }}>
            <EmptyState
              what={contracts.length === 0 ? 'No contracts yet' : 'Nothing on this tab'}
              why={
                contracts.length === 0
                  ? 'Build one and the price moves as you fill it in. A reg and an asset type is enough to start.'
                  : 'Nothing on this tab matches. Try another tab or clear the search.'
              }
              action={
                contracts.length === 0 && may('fleetsmart.build')
                  ? <Button variant="accent" onClick={startNew}><Plus size={14} /> New contract</Button>
                  : undefined
              }
            />
          </div>
        ) : (
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={TH}>Ref</th>
                  <th style={TH}>Customer</th>
                  <th style={TH}>Plan</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Term</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Assets</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Monthly</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Annual</th>
                  <th style={TH}>Status</th>
                  <th style={TH}>Updated</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => openRow(c)}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-subtle)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <td style={{ ...TD, fontFamily: 'var(--panton)', fontWeight: 700, color: 'var(--text)' }}>
                      {c.ref ?? '—'}
                    </td>
                    <td style={{ ...TD, color: 'var(--text)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.customer_name || '—'}
                    </td>
                    <td style={TD}>{c.plan}</td>
                    <td style={NUM}>{c.term_months} mo</td>
                    <td style={NUM}>{c.asset_count}</td>
                    <td style={{ ...NUM, color: 'var(--text)', fontWeight: 600 }}>
                      {money2(Number(c.monthly_total || 0))}
                    </td>
                    <td style={NUM}>{money(Number(c.annual_total || 0))}</td>
                    <td style={TD}>
                      <Badge tone={STATUS_TONE[c.status]} dot>{STATUS_LABEL[c.status]}</Badge>
                    </td>
                    <td style={TD}>{when(c.updated_at)}</td>
                    <td style={{ ...TD, textAlign: 'right' }}>
                      <span
                        onClick={(e) => e.stopPropagation()}
                        style={{ display: 'inline-flex', gap: 2, justifyContent: 'flex-end' }}
                      >
                        {c.status === 'draft' && may('fleetsmart.send') && (
                          <IconButton
                            label="Mark as sent"
                            disabled={busy === c.id || c.asset_count === 0}
                            onClick={() => send(c)}
                          >
                            <Send size={14} />
                          </IconButton>
                        )}
                        {c.status === 'sent' && may('fleetsmart.build') && (
                          <>
                            <IconButton label="Customer accepted" disabled={busy === c.id} onClick={() => decide(c, 'accepted')}>
                              <Check size={14} />
                            </IconButton>
                            <IconButton label="Customer declined" disabled={busy === c.id} onClick={() => decide(c, 'declined')}>
                              <X size={14} />
                            </IconButton>
                          </>
                        )}
                        {may('fleetsmart.build') && (
                          <IconButton label="Copy into a new contract" onClick={() => copyRow(c)}>
                            <Copy size={14} />
                          </IconButton>
                        )}
                        {c.status === 'draft' && may('fleetsmart.build') && (
                          <IconButton label="Delete this draft" danger disabled={busy === c.id} onClick={() => discard(c)}>
                            <Trash2 size={14} />
                          </IconButton>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <GridHint>
        A draft opens in the builder. A contract that has gone out opens as the document the customer
        got, because changing a price somebody is already holding you to is not an edit.
      </GridHint>

      {open?.kind === 'wizard' && (
        <ContractWizard
          accounts={accounts}
          leads={leads}
          initial={{
            input: open.seed,
            extras: open.extras,
            accountId: open.row?.account_id ?? null,
            leadId: open.row?.lead_id ?? null,
          }}
          contractId={open.row?.id ?? null}
          reference={open.row?.ref ?? null}
          may={may}
          onClose={() => setOpen(null)}
          onSaved={({ ref, sent }) => {
            setNotice(sent
              ? `${ref ?? 'The contract'} is saved and marked as sent. Print the document and attach it.`
              : `${ref ?? 'The contract'} is saved as a draft.`);
            setOpen(null);
            router.refresh();
          }}
        />
      )}

      {open?.kind === 'document' && (
        <ContractDocumentDrawer
          row={open.row}
          busy={busy === open.row.id}
          may={may}
          onClose={() => setOpen(null)}
          onDecide={(status) => decide(open.row, status)}
          onCopy={() => copyRow(open.row)}
        />
      )}
    </TabShell>
  );
}

/* =============================================================
   A contract that has gone out, as the customer has it.

   The price is not recomputed here. `priced` was written by the server
   the moment the contract was saved, and reading it back is the whole
   point: if the rate card changes next year, a contract signed this
   year still prints the figures it was signed on. The fallback to the
   engine covers a row written before the column existed, which is a
   development case rather than a live one.
   ============================================================= */
function ContractDocumentDrawer({
  row, busy, may, onClose, onDecide, onCopy,
}: {
  row: ContractRow;
  busy: boolean;
  may: (c: string) => boolean;
  onClose: () => void;
  onDecide: (status: 'accepted' | 'declined') => void;
  onCopy: () => void;
}) {
  const priced = row.priced?.assets ? row.priced : priceContract(row.input);

  return (
    <Drawer
      eyebrow={`FleetSmart+ · ${STATUS_LABEL[row.status]}`}
      title={row.customer_name || row.ref || 'Contract'}
      icon={<FileText size={18} />}
      onClose={onClose}
      width={1000}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
            {row.sent_at ? `Sent ${when(row.sent_at)}${row.sent_to ? ` to ${row.sent_to}` : ''}` : 'Not sent'}
          </span>
          <span style={{
            fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 17,
            letterSpacing: '-0.02em', color: 'var(--text)', fontVariantNumeric: 'tabular-nums',
          }}>
            {money2(Number(row.monthly_total || 0))}
            <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--text-subtle)' }}> / month</span>
          </span>
          {may('fleetsmart.build') && (
            <Button size="sm" variant="secondary" onClick={onCopy}>
              <Copy size={13} /> Copy
            </Button>
          )}
          {row.status === 'sent' && may('fleetsmart.build') && (
            <>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => onDecide('declined')}>
                <X size={13} /> Declined
              </Button>
              <Button size="sm" variant="primary" disabled={busy} onClick={() => onDecide('accepted')}>
                <Check size={13} /> Accepted
              </Button>
            </>
          )}
          <Button size="sm" variant="secondary" onClick={() => window.print()}>
            <Printer size={13} /> Print
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <Label>The contract</Label>
        <Badge tone={STATUS_TONE[row.status]} dot>{STATUS_LABEL[row.status]}</Badge>
        <span style={{ fontSize: 12, color: 'var(--text-subtle)', flex: 1 }}>
          Exactly as it was priced when it went out.
        </span>
      </div>

      {row.decision_note && <Alert tone="info">{row.decision_note}</Alert>}

      <div className="fs-doc-frame" style={{
        border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden',
      }}>
        <ContractDocument
          input={row.input}
          priced={priced}
          extras={{ ...blankExtras(), ...row.extras }}
          reference={row.ref}
        />
      </div>

      <ContractPrintRules />
    </Drawer>
  );
}
