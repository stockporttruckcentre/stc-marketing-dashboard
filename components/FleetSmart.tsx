'use client';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle, Check, Copy, FileText, Pencil, Plus, Printer, Search, Send,
  ShieldCheck, Square, Trash2, X,
} from 'lucide-react';
import type { Plan } from '@/lib/fleetsmart/ratecard';
import type { ContractInput, PricedContract } from '@/lib/fleetsmart/types';
import { blankContract, blankExtras, type ContractExtras } from '@/lib/fleetsmart/contract';
import type { PickableAccount } from '@/lib/fleetsmart/account';
import type { RateCard } from '@/lib/fleetsmart/ratecard';
import { RateEditor } from '@/components/fleetsmart/rate-editor';
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
  status: 'draft' | 'sent' | 'accepted' | 'declined' | 'expired' | 'ended';
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

type TabKey = 'live' | 'drafts' | 'sent' | 'won' | 'closed' | 'rates';

const STATUS_TONE: Record<ContractRow['status'], Tone> = {
  draft: 'neutral',
  sent: 'info',
  accepted: 'success',
  declined: 'danger',
  expired: 'warning',
  /* Neutral rather than danger. An ended contract was won and was paid;
     it is over, not lost, and colouring it like a refusal would read as
     one everywhere the list is scanned. */
  ended: 'neutral',
};

const STATUS_LABEL: Record<ContractRow['status'], string> = {
  draft: 'Draft',
  sent: 'With customer',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Expired',
  ended: 'Ended',
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
  contracts, accounts, leads, capabilities, manager, card, cardVersions,
}: {
  contracts: ContractRow[];
  accounts: Account[];
  leads: Lead[];
  capabilities: string[];
  /** Whoever is looking, so a new contract carries their name as the account manager. */
  manager: { name: string; email: string; phone: string };
  /** What the builder prices off. The shipped card until somebody edits it. */
  card: RateCard;
  /** Every version saved, newest first. Empty until somebody edits it. */
  cardVersions: { version: string; note: string | null; is_current: boolean; created_at: string }[];
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

  /* An action that needs asking first. One at a time, so the screen can
     never be waiting on two answers. */
  const [asking, setAsking] = useState<
    | { kind: 'delete'; row: ContractRow }
    | { kind: 'end'; row: ContractRow }
    | { kind: 'reopen'; row: ContractRow }
    | null
  >(null);

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
    closed: contracts.filter((c) => c.status === 'declined' || c.status === 'expired'
      || c.status === 'ended').length,
  }), [contracts]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contracts
      .filter((c) => {
        if (tab === 'live') return c.status === 'draft' || c.status === 'sent';
        if (tab === 'drafts') return c.status === 'draft';
        if (tab === 'sent') return c.status === 'sent';
        if (tab === 'won') return c.status === 'accepted';
        return c.status === 'declined' || c.status === 'expired' || c.status === 'ended';
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

  /* Ending a live contract.
   *
   * Its own state rather than declined or expired. Both of those mean a
   * contract that was never won, so folding a completed one into either
   * puts a paying customer in the lost column and takes real revenue out
   * of every figure that reads it. */
  async function end(row: ContractRow, note: string) {
    setAsking(null);
    const ok = await post(`/api/fleetsmart/contracts/${row.id}/end`, { note }, row.id);
    if (ok) setNotice(`${row.ref ?? row.customer_name} is recorded as ended.`);
  }

  /* Taking a contract back so the builder can edit it.
   *
   * A hole in the rule from migration 061 that a sent contract is
   * frozen, opened deliberately and recorded on the row: the state it
   * came back from is kept, so a price that changed after the customer
   * saw it is a fact anybody can read. */
  async function reopen(row: ContractRow) {
    setAsking(null);
    const ok = await post(`/api/fleetsmart/contracts/${row.id}/reopen`, {}, row.id);
    if (ok) {
      setNotice(`${row.ref ?? row.customer_name} is a draft again. Open it to make the change.`);
      setOpen(null);
    }
  }

  async function remove(row: ContractRow) {
    setAsking(null);
    setBusy(row.id); setError(null);
    try {
      const res = await fetch(`/api/fleetsmart/contracts/${row.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.ok) { setError(json.message ?? 'That would not delete.'); return; }

      /* What went, said out loud. A contract whose tracker lead went
         with it means somebody's tracker just got shorter, and finding
         that out later is worse than being told now. */
      const gone = json.gone as { lead_deleted?: boolean } | null;
      setNotice(
        `${row.ref ?? 'That contract'} is gone`
        + (gone?.lead_deleted ? ', and the maintenance lead it made on the tracker with it.' : '.'),
      );
      setOpen(null);
      router.refresh();
    } catch {
      setError('That did not reach the server.');
    } finally {
      setBusy(null);
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
            /* Last, on the far right, because it is not a view of the
               contracts: it is what they are priced off. Reachable by
               anybody who can open the tab, and read only until somebody
               holds the permission that sets prices. */
            { key: 'rates', label: 'Rate editor' },
          ]}
        />
      </div>

      {tab === 'rates' ? (
        <RateEditor
          current={card}
          versions={cardVersions}
          may={may}
          onSaved={(message) => { setNotice(message); setError(null); router.refresh(); }}
        />
      ) : (
      <>
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
                        {c.status === 'accepted' && may('fleetsmart.build') && (
                          <IconButton
                            label="End this contract"
                            disabled={busy === c.id}
                            onClick={() => setAsking({ kind: 'end', row: c })}
                          >
                            <Square size={14} />
                          </IconButton>
                        )}
                        {c.status !== 'draft' && may('fleetsmart.discount') && (
                          <IconButton
                            label="Take it back to edit it"
                            disabled={busy === c.id}
                            onClick={() => setAsking({ kind: 'reopen', row: c })}
                          >
                            <Pencil size={14} />
                          </IconButton>
                        )}
                        {may('fleetsmart.build') && (
                          <IconButton label="Copy into a new contract" onClick={() => copyRow(c)}>
                            <Copy size={14} />
                          </IconButton>
                        )}
                        {/* Delete, on every row rather than only a draft.
                            What it takes with it and who may do it are
                            different for a draft and for something that
                            has been to a customer, and both rules live in
                            `fleetsmart_delete` rather than here. */}
                        {(c.status === 'draft' ? may('fleetsmart.build') : may('fleetsmart.discount')) && (
                          <IconButton
                            label={c.status === 'draft' ? 'Delete this draft' : 'Delete this contract'}
                            danger
                            disabled={busy === c.id}
                            onClick={() => setAsking({ kind: 'delete', row: c })}
                          >
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
      </>
      )}

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

      {asking && (
        <ActionConfirm
          asking={asking}
          busy={busy === asking.row.id}
          onCancel={() => setAsking(null)}
          onEnd={(note) => end(asking.row, note)}
          onReopen={() => reopen(asking.row)}
          onDelete={() => remove(asking.row)}
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
          onEnd={() => setAsking({ kind: 'end', row: open.row })}
          onReopen={() => setAsking({ kind: 'reopen', row: open.row })}
          onDelete={() => setAsking({ kind: 'delete', row: open.row })}
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
  row, busy, may, onClose, onDecide, onCopy, onEnd, onReopen, onDelete,
}: {
  row: ContractRow;
  busy: boolean;
  may: (c: string) => boolean;
  onClose: () => void;
  onDecide: (status: 'accepted' | 'declined') => void;
  onCopy: () => void;
  /* The three that need asking first. The dialog lives on the list
     rather than in here, so a record and a row ask the same question in
     the same words. */
  onEnd: () => void;
  onReopen: () => void;
  onDelete: () => void;
}) {
  /* The snapshot, always, where there is one. A contract that has gone
     out prints the prices it went out at, whatever the rate card says
     today. The fallback is for an old row saved before `priced` was
     stored, and it uses the card STC ships rather than the current one
     for the same reason. */
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
          {row.status === 'accepted' && may('fleetsmart.build') && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={onEnd}>
              <Square size={13} /> End it
            </Button>
          )}
          {row.status !== 'draft' && may('fleetsmart.discount') && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={onReopen}>
              <Pencil size={13} /> Edit
            </Button>
          )}
          {may('fleetsmart.discount') && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={onDelete}>
              <Trash2 size={13} /> Delete
            </Button>
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

/* =============================================================
   Asking before ending, editing or deleting.

   One dialog for the three, so a row and an open record ask the same
   question in the same words. Somebody who learns what Delete does from
   the list should not have to learn it again from the drawer.

   ---- What each one says, and why it says that ----

   Every warning names the specific thing that is about to happen to
   this contract rather than a general caution. "This cannot be undone"
   is true of most buttons and stops nobody; "the maintenance lead on
   Dean's tracker goes with it" is the sentence that makes somebody
   pause, because it names a consequence they had not thought of.

   The destructive action is never the button under the cursor. Cancel
   sits where the eye lands and Delete sits at the far end, in the ghost
   style rather than as a red primary, because rule one of the kit is
   that red points at the most important action on a screen and the most
   important action here is not deleting a signed contract.
   ============================================================= */
function ActionConfirm({
  asking, busy, onCancel, onEnd, onReopen, onDelete,
}: {
  asking:
    | { kind: 'delete'; row: ContractRow }
    | { kind: 'end'; row: ContractRow }
    | { kind: 'reopen'; row: ContractRow };
  busy: boolean;
  onCancel: () => void;
  onEnd: (note: string) => void;
  onReopen: () => void;
  onDelete: () => void;
}) {
  const [note, setNote] = useState('');
  const { row } = asking;
  const named = row.ref ? `${row.ref}, ${row.customer_name}` : row.customer_name || 'this contract';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  const copy = {
    end: {
      title: 'End this contract',
      body: `${named} stops being a live contract from today. It keeps its price, its history and its `
        + 'document, and the customer stays a customer on the tracker: they were won and they paid, '
        + 'so ending the cover does not un-win them.',
      confirm: 'End it',
    },
    reopen: {
      title: 'Take it back to edit it',
      body: `${named} goes back to a draft so the builder can change it. The customer already has `
        + 'the version that went out, so anything changed here will differ from the copy in their '
        + 'inbox. The record keeps the date and the state it came back from, so the difference is '
        + 'explainable later. To change a live contract without doing that, amend it instead.',
      confirm: 'Take it back',
    },
    delete: {
      title: 'Delete this contract',
      body: `${named} is removed from the application entirely, along with every amendment on it and `
        + 'any notification pointing at it. '
        + (row.status === 'draft'
          ? 'It is a draft, so nothing has been to a customer.'
          : 'It has been to a customer, so this removes the record of what was offered and what '
            + 'they agreed to. There is no copy left here.')
        + ' The maintenance lead it created on the tracker goes with it. A pitch somebody opened '
        + 'before the contract existed stays where it is.',
      confirm: 'Delete it',
    },
  }[asking.kind];

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 950,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        background: 'rgba(5, 13, 38, 0.55)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          width: '100%', maxWidth: 460, padding: '20px 22px 18px',
          background: 'var(--surface-raised)', border: '1px solid var(--border-strong)',
          borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-3)',
        }}
      >
        <h3 style={{
          display: 'flex', alignItems: 'center', gap: 8, margin: 0,
          fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 17,
          letterSpacing: '-0.01em', color: 'var(--text)',
        }}>
          {asking.kind === 'delete' && <AlertTriangle size={16} style={{ color: 'var(--accent)' }} />}
          {copy.title}
        </h3>

        <p style={{
          margin: '9px 0 0', fontFamily: 'var(--inter)', fontSize: 13,
          lineHeight: 1.6, color: 'var(--text-muted)',
        }}>{copy.body}</p>

        {asking.kind === 'end' && (
          <div style={{ marginTop: 14 }}>
            <label style={{
              display: 'block', marginBottom: 5,
              fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 11.5,
              letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-subtle)',
            }}>Why, for the record</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Fleet went in house, sold the business, moved supplier"
              style={{
                width: '100%', height: 32, padding: '0 11px',
                background: 'var(--surface)', color: 'var(--text)',
                border: '1px solid var(--border-strong)', borderRadius: 'var(--r)',
                fontFamily: 'var(--inter)', fontSize: 13,
              }}
            />
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 18, alignItems: 'center' }}>
          <Button size="md" variant="secondary" onClick={onCancel}>Keep it</Button>
          <span style={{ flex: 1 }} />
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (asking.kind === 'end') onEnd(note);
              else if (asking.kind === 'reopen') onReopen();
              else onDelete();
            }}
          >
            {busy ? 'Working' : copy.confirm}
          </Button>
        </div>
      </div>
    </div>
  );
}
