'use client';

import { useEffect, useMemo, useState } from 'react';
import { ISearch, IArrowUp, IPlus, IChevronR, IWarn } from './icons';
import { NewCardModal, type Toast } from './modals';
import * as api from '@/lib/ratecards/client';
import { initials, shortDate, STATUS_WORDS, money } from '@/lib/ratecards/format';
import type { CardRow } from '@/lib/ratecards/types';
import { readChoice, writeChoice } from '@/lib/ui/remember';

/* =============================================================
   The Rate Cards hub.

   Ported from `rate-hub.html`, minus its navy rail, which the business
   asked for by name:

     Attached is the UI for this rate builder hub - follow it directly,
     do not add in the navy sidebar.

   The application already has a sidebar, and the kit's is a drawing of
   one. So `.rc-6b` is never rendered and `.rc-6g`, the body, fills the
   shell on its own.

   DEVIATION in the last column is computed, per the kit's own note:
   "template" when the override count is nought.
   ============================================================= */

type Chip = 'all' | 'approved' | 'draft' | 'awaiting' | 'expiring' | 'contract' | 'overrides';

const CHIPS = ['all', 'approved', 'draft', 'awaiting', 'expiring', 'contract', 'overrides'] as const;
const SORTS = ['effective', 'customer', 'updated'] as const;

export function RateCardsHub({ onOpen, onToast, caps, onDefaults }: {
  onOpen: (id: string) => void;
  onToast: (t: Omit<Toast, 'id'>) => void;
  caps: { build: boolean; labour: boolean; approve: boolean };
  onDefaults: () => void;
}) {
  const [rows, setRows] = useState<CardRow[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  /* Which filter and which sort somebody left this on, remembered per
     device. From the standing rule: a preference that does not survive
     the morning is not a preference. */
  const [chip, setChipState] = useState<Chip>('all');
  const [query, setQuery] = useState('');
  const [sort, setSortState] = useState<typeof SORTS[number]>('effective');

  useEffect(() => {
    setChipState(readChoice('ratecards.filter', CHIPS) ?? 'all');
    setSortState(readChoice('ratecards.sort', SORTS) ?? 'effective');
  }, []);

  const setChip = (c: Chip) => { setChipState(c); writeChoice('ratecards.filter', c); };
  const setSort = (s: typeof SORTS[number]) => { setSortState(s); writeChoice('ratecards.sort', s); };
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [customers, setCustomers] = useState<{ id: string; company_name: string; contact_name: string | null }[]>([]);

  const load = async () => {
    const got = await api.listCards();
    if (!got.ok) { setFailed(got.why); return; }
    setFailed(null);
    setRows(got.value);
  };

  useEffect(() => { void load(); }, []);

  const counts = useMemo(() => {
    const r = rows ?? [];
    return {
      all: r.length,
      approved: r.filter((x) => x.status === 'approved').length,
      draft: r.filter((x) => x.status === 'draft').length,
      awaiting: r.filter((x) => x.status === 'awaiting').length,
      expiring: r.filter((x) => x.ageing || x.expired).length,
      contract: r.filter((x) => x.on_contract).length,
      overrides: r.filter((x) => x.overrides > 0).length,
    };
  }, [rows]);

  const shown = useMemo(() => {
    let r = rows ?? [];
    if (chip === 'approved') r = r.filter((x) => x.status === 'approved');
    if (chip === 'draft') r = r.filter((x) => x.status === 'draft');
    if (chip === 'awaiting') r = r.filter((x) => x.status === 'awaiting');
    if (chip === 'expiring') r = r.filter((x) => x.ageing || x.expired);
    if (chip === 'contract') r = r.filter((x) => x.on_contract);
    if (chip === 'overrides') r = r.filter((x) => x.overrides > 0);
    const q = query.trim().toLowerCase();
    if (q) r = r.filter((x) => x.customer_name.toLowerCase().includes(q) || x.ref.toLowerCase().includes(q));
    const sorted = [...r];
    if (sort === 'customer') sorted.sort((a, b) => a.customer_name.localeCompare(b.customer_name));
    else if (sort === 'updated') sorted.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    else sorted.sort((a, b) => b.effective_from.localeCompare(a.effective_from));
    return sorted;
  }, [rows, chip, query, sort]);

  const headline = useMemo(() => {
    const parts = [`${counts.all} card${counts.all === 1 ? '' : 's'}`];
    if (counts.awaiting > 0) parts.push(`${counts.awaiting} awaiting approval`);
    if (counts.expiring > 0) parts.push(`${counts.expiring} expiring`);
    return parts.join(' · ');
  }, [counts]);

  return (
    <div className="rc-6a">
      <div className="rc-6g">
        <div className="rc-6h">
          <div className="rc-3e">
            <span className="rc-6i">Rate Card Builder</span>
            <span className="rc-3w">{headline}</span>
          </div>
          <div className="rc-52">
            <div className="rc-6j">
              <span className="rc-3x"><ISearch /></span>
              <input
                placeholder="Search customer"
                className="rc-3y"
                aria-label="Search customer"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <button className="rc-18" onClick={onDefaults} title="Amend the rates every new card starts from">
              <IArrowUp /><span>Default rates</span>
            </button>
            <button
              className="rc-16"
              disabled={!caps.build}
              title={caps.build ? 'Make a rate card for a customer' : 'You do not have the right to build a rate card'}
              onClick={() => { setShowNew(true); void api.customers('').then((r) => { if (r.ok) setCustomers(r.value); }); }}
            >
              <IPlus /><span>New rate card</span>
            </button>
          </div>
        </div>

        <div className="rc-6k">
          {([
            ['all', 'All', counts.all],
            ['approved', 'Live', counts.approved],
            ['draft', 'Draft', counts.draft],
            ['awaiting', 'Awaiting approval', counts.awaiting],
            ['expiring', 'Expiring', counts.expiring],
          ] as [Chip, string, number][]).map(([k, label, n]) => (
            <button key={k} className={chip === k ? 'rc-6l' : 'rc-2d'} onClick={() => setChip(k)}>
              {label}<span className="rc-1w">{n}</span>
            </button>
          ))}
          <span className="rc-6m" />
          {([
            ['contract', 'On FleetSmart+', counts.contract],
            ['overrides', 'Has overrides', counts.overrides],
          ] as [Chip, string, number][]).map(([k, label, n]) => (
            <button key={k} className={chip === k ? 'rc-6l' : 'rc-2d'} onClick={() => setChip(k)}>
              {label}<span className="rc-1w">{n}</span>
            </button>
          ))}
          <span className="rc-6n">
            <span className="rc-i">SORT</span>
            <div className="rc-6o">
              <select
                className="rc-6p"
                aria-label="Sort the rate cards"
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
              >
                <option value="effective">Effective date, newest</option>
                <option value="customer">Customer, A to Z</option>
                <option value="updated">Recently changed</option>
              </select>
            </div>
          </span>
        </div>

        <div className="rc-3f">
          <div className="rc-6q">
            <div className="rc-2e">Customer</div>
            <div className="rc-2e">Main contact</div>
            <div className="rc-2e">Tier</div>
            <div className="rc-2e">Effective</div>
            <div className="rc-2e">Status</div>
            <div className="rc-2e">Ref</div>
            <div className="rc-53">HGV LABOUR</div>
            <div className="rc-53">DEVIATION</div>
            <div />
          </div>

          {failed && (
            <div style={{ padding: '18px 16px' }}>
              <div className="rc-2s">
                <IWarn size={16} />
                <span className="rc-2x">{failed}</span>
              </div>
            </div>
          )}

          {!failed && rows === null && (
            <div style={{ padding: '18px 16px' }}>
              <span className="rc-y">Loading the rate cards.</span>
            </div>
          )}

          {!failed && rows !== null && shown.length === 0 && (
            <div style={{ padding: '26px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className="rc-4n">
                {rows.length === 0 ? 'No rate cards yet' : 'Nothing matches that'}
              </span>
              <span className="rc-y">
                {rows.length === 0
                  ? 'A card is made here by picking a customer, or on its own when a FleetSmart+ contract is built for one.'
                  : 'Try another filter, or clear the search.'}
              </span>
            </div>
          )}

          {shown.map((r) => (
            <button
              key={r.id}
              className={r.expired || r.ageing ? 'rc-6s' : 'rc-6r'}
              onClick={() => onOpen(r.id)}
              style={{ width: '100%', textAlign: 'left' }}
              title={`Open ${r.customer_name}`}
            >
              <div className="rc-1x">
                <span className="rc-1y">{initials(r.customer_name)}</span>
                <span className="rc-1z">{r.customer_name}</span>
              </div>
              <div className="rc-20">{r.manager_names ?? r.owner_name ?? ''}</div>
              <div className="rc-10">
                {r.plan ? <span className="rc-21">{r.plan}</span> : <span className="rc-i">—</span>}
              </div>
              <div className="rc-22">
                {shortDate(r.effective_from)}
                {r.expired && <span className="rc-12">expired</span>}
                {!r.expired && r.ageing && <span className="rc-12">nearly a year</span>}
              </div>
              <div className="rc-10">
                <span className={r.status === 'approved' ? 'rc-2q' : 'rc-1f'}>
                  {STATUS_WORDS[r.status] ?? r.status}
                </span>
              </div>
              <div className="rc-23">{r.ref}</div>
              <div className="rc-24">
                {r.labour_summary ? `£${r.labour_summary.split('/')[0]}` : ''}
              </div>
              <div className="rc-25">
                <span className={r.overrides > 0 ? 'rc-3j' : 'rc-1f'}>
                  {r.overrides === 0 ? 'template' : `${r.overrides} set by hand`}
                </span>
              </div>
              <div className="rc-26"><IChevronR /></div>
            </button>
          ))}
        </div>
      </div>

      {showNew && (
        <NewCardModal
          customers={customers}
          busy={busy}
          onSearch={(q) => { void api.customers(q).then((r) => { if (r.ok) setCustomers(r.value); }); }}
          onClose={() => setShowNew(false)}
          onCheck={async (id) => {
            const got = await api.checkCustomer(id);
            return got.ok ? got.value : null;
          }}
          onCreate={async ({ contactId, effective, supersede }) => {
            setBusy(true);
            const made = await api.createCard({ contactId, effective, supersede });
            setBusy(false);
            if (!made.ok) { onToast({ tone: 'error', text: made.why }); return; }
            setShowNew(false);
            onToast({ tone: 'success', text: 'Rate card created from the current defaults.' });
            onOpen(made.value);
          }}
        />
      )}
    </div>
  );
}
