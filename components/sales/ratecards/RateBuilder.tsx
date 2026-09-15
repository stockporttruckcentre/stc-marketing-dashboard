'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IChevronL, IChevronD, IChevronR, IEye, IDownload, IMore, IReset, IPlus, IClose,
} from './icons';
import { RateRow, type RowGroup } from './RateRow';
import {
  ReviewChangesModal, ConfirmModal, UpliftModal, ExportModal, CustomLabourModal,
  type Toast,
} from './modals';
import { FleetsmartPanel } from './FleetsmartPanel';
import { HeaderTab, PartsTab, InstructionsTab, HistoryTab } from './builder-tabs';
import { SheetPreview } from './SheetPreview';
import * as api from '@/lib/ratecards/client';
import { POOL_LABELS } from '@/lib/ratecards/kit.generated';
import { money, ago, round2, STATUS_WORDS, MISSING_WORDS, shortDate } from '@/lib/ratecards/format';
import type { FullCard, Rate, ChangeRow } from '@/lib/ratecards/types';

/* =============================================================
   The builder.

   Ported from `rate-builder.html`, `rate-builder-editing.html` and
   `rate-builder-ripple.html`. The toolbar, the labour band, the tabs
   and the status bar are fixed; the rate table is the only thing that
   scrolls, which the pack states twice and `port.css` enforces.

   ---- What commits when ----

   From the handoff:

     A labour change is staged; everything else commits immediately. A
     labour edit moves many rows, so it needs review. A single rate edit
     does not.

   So a rate edit writes on blur and a labour edit opens the review
   dialog first. Both then reload the card from the database rather than
   patching the copy in the browser, because the price of a derived rate
   is computed in SQL and a second implementation here would be a second
   answer.
   ============================================================= */

type Tab = 'rates' | 'fleetsmart' | 'header' | 'parts' | 'instructions' | 'history';
type Filter = 'all' | 'derived' | 'overridden' | 'empty';

export function RateBuilder({
  cardId, onBack, onToast, caps,
}: {
  cardId: string;
  onBack: () => void;
  onToast: (t: Omit<Toast, 'id'>) => void;
  caps: { build: boolean; labour: boolean; approve: boolean };
}) {
  const [card, setCard] = useState<FullCard | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('rates');
  const [filter, setFilter] = useState<Filter>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ rateId: string; axle: number } | null>(null);
  const [moved, setMoved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [changes, setChanges] = useState<ChangeRow[]>([]);
  const [menu, setMenu] = useState(false);

  /* The dialogs, one at a time. */
  const [staged, setStaged] = useState<{ pool: string; label: string; from: number; to: number } | null>(null);
  const [showUplift, setShowUplift] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [confirmHideFs, setConfirmHideFs] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState<null | 'awaiting' | 'approved' | 'withdrawn'>(null);

  const load = useCallback(async () => {
    const got = await api.readCard(cardId);
    if (!got.ok) { setFailed(got.why); return; }
    setFailed(null);
    setCard(got.value);
    setSavedAt(got.value.card.updated_at);
  }, [cardId]);

  useEffect(() => { void load(); }, [load]);

  /* The card menu closes on a click anywhere else, and on Escape. */
  useEffect(() => {
    if (!menu) return;
    const shut = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      setMenu(false);
    };
    /* Deferred a frame, or the click that opened it closes it again. */
    const id = window.requestAnimationFrame(() => {
      document.addEventListener('mousedown', shut);
      document.addEventListener('keydown', shut);
    });
    return () => {
      window.cancelAnimationFrame(id);
      document.removeEventListener('mousedown', shut);
      document.removeEventListener('keydown', shut);
    };
  }, [menu]);

  const loadHistory = useCallback(async () => {
    const got = await api.history(cardId);
    if (got.ok) setChanges(got.value);
  }, [cardId]);

  useEffect(() => { if (tab === 'history') void loadHistory(); }, [tab, loadHistory]);

  /* ---- The labour band ----

     Each pool card says how many rates follow it, which is the number
     that makes a salesman confident enough to change one. */
  const labourFor = useCallback((pool: string | null) => {
    if (!card || !pool) return null;
    const row = card.labour.find((l) => l.pool === pool && l.charge_to === 'customer');
    return row ? Number(row.rate) : null;
  }, [card]);

  const drives = useCallback((pool: string) =>
    (card?.rates ?? []).filter((r) => r.basis === 'derived' && r.pool === pool).length,
  [card]);

  /* ---- Rates, grouped into rows and sections ---- */
  const sections = useMemo(() => {
    if (!card) return [];
    const wanted = card.rates.filter((r) => {
      if (r.section === 'Parts Rates') return false;
      if (filter === 'derived') return r.basis === 'derived';
      if (filter === 'overridden') return r.override_value !== null;
      if (filter === 'empty') return r.basis === 'tbc' || r.basis === 'blank';
      return true;
    });

    const byRate = new Map<string, RowGroup>();
    for (const r of wanted) {
      const row = byRate.get(r.rate_id) ?? {
        rateId: r.rate_id, section: r.section, item: r.item, basis: r.basis, columns: [],
      };
      row.columns.push(r);
      byRate.set(r.rate_id, row);
    }
    for (const row of byRate.values()) row.columns.sort((a, b) => a.axle - b.axle);

    const out: { name: string; rows: RowGroup[] }[] = [];
    for (const row of byRate.values()) {
      const last = out[out.length - 1];
      if (last && last.name === row.section) last.rows.push(row);
      else out.push({ name: row.section, rows: [row] });
    }
    return out;
  }, [card, filter]);

  const stats = useMemo(() => {
    const rates = card?.rates ?? [];
    const uniq = new Set(rates.map((r) => r.rate_id));
    const count = (p: (r: Rate) => boolean) => new Set(rates.filter(p).map((r) => r.rate_id)).size;
    return {
      total: uniq.size,
      derived: count((r) => r.basis === 'derived'),
      overridden: count((r) => r.override_value !== null),
      statutory: count((r) => r.basis === 'statutory'),
      tbc: count((r) => r.basis === 'tbc' || r.basis === 'blank'),
    };
  }, [card]);

  /* ---- Writing ---- */

  const after = async (why: string, undo?: () => void) => {
    await load();
    setSavedAt(new Date().toISOString());
    onToast({ tone: 'success', text: why, undo });
  };

  const commitRate = async (rate: Rate, value: number | null) => {
    setBusy(true);
    const done = await api.setRate(cardId, rate.rate_id, rate.axle, value);
    setBusy(false);
    if (!done.ok) { onToast({ tone: 'error', text: done.why }); return; }

    if (done.value.over_cap) {
      onToast({
        tone: 'info',
        text: `Saved. That is over the ${done.value.cap_by ?? 'statutory'} cap of ${money(done.value.cap)}, which is allowed: caps change.`,
      });
      await load();
      return;
    }
    await after(`${rate.item} set to ${money(value)}`, () => { void revert(rate); });
  };

  const revert = async (rate: Rate) => {
    const done = await api.setRate(cardId, rate.rate_id, rate.axle, null);
    if (!done.ok) { onToast({ tone: 'error', text: done.why }); return; }
    await after(`${rate.item} back on the template`);
  };

  /* A labour edit is staged rather than written, and the review dialog
     works out what would move from the card in the browser. The numbers
     it shows are the same arithmetic the database does, and the reload
     afterwards is what makes them true rather than believed. */
  const stageLabour = (pool: string, label: string, from: number, to: number) => {
    if (round2(from) === round2(to)) return;
    setStaged({ pool, label, from, to });
  };

  const stagedRows = useMemo(() => {
    if (!staged || !card) return [];
    return card.rates
      .filter((r) => r.basis === 'derived' && r.pool === staged.pool && r.override_value === null)
      .map((r) => ({
        item: r.item, axle: r.axle,
        before: r.price,
        after: r.hours === null ? null : round2(r.hours * staged.to),
      }));
  }, [staged, card]);

  const applyLabour = async () => {
    if (!staged) return;
    setBusy(true);
    const done = await api.setLabour(cardId, staged.pool, staged.to);
    setBusy(false);
    if (!done.ok) { onToast({ tone: 'error', text: done.why }); setStaged(null); return; }

    /* Flash the rows that moved. Colour and opacity only, per the pack:
       nothing in the rate table animates position. */
    const ids = new Set(stagedRows.map((r) => r.item));
    setMoved(new Set(
      (card?.rates ?? [])
        .filter((r) => r.basis === 'derived' && r.pool === staged.pool && ids.has(r.item))
        .map((r) => r.rate_id),
    ));
    window.setTimeout(() => setMoved(new Set()), 1400);

    const was = staged.from;
    const pool = staged.pool;
    setStaged(null);
    await after(
      `${done.value} rate${done.value === 1 ? '' : 's'} moved with the labour rate`,
      () => { void (async () => {
        const back = await api.setLabour(cardId, pool, was);
        if (back.ok) await load();
      })(); },
    );
  };

  const doReset = async () => {
    setBusy(true);
    const done = await api.resetToDefaults(cardId);
    setBusy(false);
    setShowReset(false);
    if (!done.ok) { onToast({ tone: 'error', text: done.why }); return; }
    await after(
      done.value.overrides_cleared > 0
        ? `Back on the default rates. ${done.value.overrides_cleared} rate${done.value.overrides_cleared === 1 ? '' : 's'} set by hand ${done.value.overrides_cleared === 1 ? 'was' : 'were'} cleared.`
        : 'Back on the default rates.',
    );
  };

  const doUplift = async (percent: number) => {
    setBusy(true);
    const done = await api.uplift(cardId, percent);
    setBusy(false);
    setShowUplift(false);
    if (!done.ok) { onToast({ tone: 'error', text: done.why }); return; }
    await after(`${done.value} figure${done.value === 1 ? '' : 's'} uplifted by ${percent}%. The DVSA fees were left alone.`);
  };

  const doStatus = async (status: 'awaiting' | 'approved' | 'withdrawn') => {
    setBusy(true);
    const done = await api.setStatus(cardId, status);
    setBusy(false);
    setConfirmStatus(null);
    if (!done.ok) { onToast({ tone: 'error', text: done.why }); return; }
    await after(
      status === 'approved' ? 'Approved. This is the live card for this customer now.'
      : status === 'awaiting' ? 'Sent for approval.'
      : 'Withdrawn. Its history is kept.',
    );
  };

  const doExport = async (kind: 'xlsx' | 'pdf') => {
    /* The PDF is the print view rather than a file built on the server,
       because there is no PDF renderer in this installation. The dialog
       says so rather than offering a button that downloads nothing. */
    if (kind === 'pdf') {
      window.open(`/export/rate-card?card=${cardId}`, '_blank', 'noopener');
      setShowExport(false);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/rate-cards/${cardId}/export?format=${kind}`);
      if (!res.ok) {
        const why = await res.json().catch(() => ({ error: 'The export failed.' }));
        onToast({ tone: 'error', text: why.error ?? 'The export failed.' });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      /* The server names the file, so the workbook a customer files
         beside last year's is named the way last year's was. */
      const named = res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1];
      a.download = named ?? `${card?.card.customer_name ?? 'Rate card'} - Customer Rates.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setShowExport(false);
      onToast({ tone: 'success', text: `${kind.toUpperCase()} downloaded.` });
    } finally { setBusy(false); }
  };

  if (failed) {
    return (
      <div className="rc-6a">
        <div className="rc-6g" style={{ padding: 28 }}>
          <div className="rc-2s">
            <span className="rc-2x">{failed}</span>
          </div>
          <button className="rc-27" onClick={onBack} style={{ marginTop: 14 }}>
            <span>Back to the rate cards</span>
          </button>
        </div>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="rc-6a">
        <div className="rc-6g" style={{ padding: 28 }}>
          <span className="rc-y">Loading the rate card.</span>
        </div>
      </div>
    );
  }

  const c = card.card;
  const editable = c.editable && caps.build;
  const plan = card.fleetsmart.contract?.plan ?? null;

  return (
    <div className="rc-6a">
      <div className="rc-6g">
        <div className="rc-6x">
          {/* ---- Toolbar ---- */}
          <div className="rc-3z">
            <button className="rc-2f" onClick={onBack} title="Back to the rate cards">
              <IChevronL />
            </button>
            <div className="rc-3e">
              <div className="rc-1h">
                <span className="rc-40">{c.customer_name}</span>
                <span className="rc-1g">{STATUS_WORDS[c.status] ?? c.status}</span>
                {plan && <span className="rc-21">{plan}</span>}
                <span className="rc-i">saved {ago(savedAt)}</span>
              </div>
              <span className="rc-2g">
                Effective from {shortDate(c.effective_from)}
                {c.expired ? ', past its year'
                  : c.ageing ? ', nearly a year old'
                  : `, good until ${shortDate(c.good_until)}`}
              </span>
            </div>
            <div className="rc-41">
              <button className="rc-1i" onClick={() => setShowPreview(true)} title="See the sheet as Excel will draw it">
                <IEye /><span>Preview</span>
              </button>
              <button className="rc-18" onClick={() => setShowExport(true)} title="Download this card">
                <IDownload /><span>Export</span>
              </button>
              {c.status === 'draft' && caps.build && (
                <button className="rc-16" onClick={() => setConfirmStatus('awaiting')}>
                  <span>Send for approval</span>
                </button>
              )}
              {c.status === 'awaiting' && caps.approve && (
                <button className="rc-16" onClick={() => setConfirmStatus('approved')}>
                  <span>Approve</span>
                </button>
              )}
              {c.status === 'approved' && (
                <button className="rc-6y" disabled title="An approved card is what the admin team bills against, so it does not change. Copy it to amend.">
                  <span>Live</span>
                </button>
              )}
              <div style={{ position: 'relative' }}>
                <button className="rc-2f" onClick={() => setMenu((v) => !v)} title="More actions">
                  <IMore />
                </button>
                {menu && (
                  <>
                    {/* No scrim. A full screen catcher rendered inside
                        `.main` cannot cover the sidebar, and one
                        portalled to the body would cover the menu it is
                        meant to sit behind. A document listener closes
                        on a click anywhere, including the sidebar, and
                        has neither problem. */}
                    <div className="rc-7w rc-pop" style={{ right: 0, top: 30, minWidth: 210 }}>
                      <button
                        className="rc-7x"
                        disabled={!editable}
                        title={editable ? undefined : 'An approved card does not change'}
                        onClick={() => { setMenu(false); setShowUplift(true); }}
                      >
                        <span>Uplift every rate</span>
                      </button>
                      <button
                        className="rc-7x"
                        disabled={!editable}
                        title={editable ? undefined : 'An approved card does not change'}
                        onClick={() => { setMenu(false); setShowReset(true); }}
                      >
                        <span>Reset to default rates</span>
                      </button>
                      <button
                        className="rc-7x"
                        disabled={c.status === 'withdrawn' || !caps.build}
                        title={c.status === 'withdrawn' ? 'Already withdrawn' : undefined}
                        onClick={() => { setMenu(false); setConfirmStatus('withdrawn'); }}
                      >
                        <span>Withdraw this card</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ---- Labour band. Never scrolls away. ---- */}
          <div className="rc-42">
            <div className="rc-43">
              <span className="rc-44">Labour rates</span>
              <span className="rc-2g">
                Set these and {stats.derived} of {stats.total} rates recalculate.
                Everything else is a flat charge or a DVSA fee.
              </span>
              <span className="rc-e">
                {caps.labour && (
                  <button
                    className="rc-3h"
                    onClick={() => setShowCustom(true)}
                    disabled={!editable}
                    title={editable ? 'Add a rate for work charged differently' : 'An approved card does not change'}
                  >
                    <IPlus /><span>Add a rate</span>
                  </button>
                )}
                <button
                  className="rc-3h"
                  onClick={() => setShowReset(true)}
                  disabled={!editable}
                  title={editable ? 'Put every rate back on the current defaults' : 'An approved card does not change'}
                >
                  <IReset /><span>Reset to default rates</span>
                </button>
              </span>
            </div>
            <div className="rc-45">
              {card.labour.map((l) => (
                <LabourCard
                  key={l.id}
                  /* The kit's own short label for a pool it ships, and
                     whatever somebody typed for a custom one. The
                     template's long label is what prints on the
                     customer's sheet, not what fits on this card. */
                  label={POOL_LABELS[l.pool] ?? l.label}
                  chargeTo={l.charge_to}
                  drives={drives(l.pool)}
                  rate={Number(l.rate)}
                  editable={editable && caps.labour}
                  isCustom={l.is_custom}
                  note={l.note}
                  onCommit={(v) => stageLabour(l.pool, l.label, Number(l.rate), v)}
                  onRemove={l.is_custom ? async () => {
                    const done = await api.removeLabour(cardId, l.id);
                    if (!done.ok) { onToast({ tone: 'error', text: done.why }); return; }
                    await after(`${l.label} removed`);
                  } : undefined}
                />
              ))}
            </div>
          </div>

          {/* ---- Tabs ---- */}
          <div className="rc-46">
            {([
              ['rates', 'Rates', null],
              ['fleetsmart', 'FleetSmart+ inclusions', card.fleetsmart.contract ? 'LIVE' : null],
              ['header', 'Header & contacts', card.missing.length > 0 ? String(card.missing.length) : null],
              ['parts', 'Parts & markup', null],
              ['instructions', 'Instructions', null],
              ['history', 'History', changes.length > 0 ? String(changes.length) : null],
            ] as [Tab, string, string | null][]).map(([key, label, badge]) => (
              <button
                key={key}
                className={tab === key ? 'rc-47' : 'rc-x'}
                onClick={() => setTab(key)}
                aria-current={tab === key ? 'page' : undefined}
              >
                {label}
                {badge && <span className={key === 'fleetsmart' ? 'rc-48' : 'rc-49'}>{badge}</span>}
              </button>
            ))}
            {tab === 'rates' && (
              <span className="rc-4a">
                <span className="rc-4b">SHOW</span>
                {(['all', 'derived', 'overridden', 'empty'] as Filter[]).map((f) => (
                  <button
                    key={f}
                    className={filter === f ? 'rc-4c' : 'rc-19'}
                    onClick={() => setFilter(f)}
                  >
                    {f === 'all' ? 'All' : f === 'derived' ? 'Derived'
                      : f === 'overridden' ? 'Overridden' : 'Empty'}
                  </button>
                ))}
              </span>
            )}
          </div>

          {/* ---- The one scroller ---- */}
          <div className="rc-3f">
            {tab === 'rates' && (
              <div>
                <div className="rate-thead">
                  <div className="rc-1j">Item</div>
                  <div className="rc-o">1-axle</div>
                  <div className="rc-o">2-axle</div>
                  <div className="rc-o">3-axle</div>
                  <div className="rc-o">4-axle</div>
                  <div className="rc-o">Workings</div>
                  <div className="rc-1j">Basis</div>
                  <div />
                </div>

                {sections.length === 0 && (
                  <div style={{ padding: '22px 16px' }}>
                    <span className="rc-y">Nothing on this card matches that filter.</span>
                  </div>
                )}

                {sections.map((s) => {
                  const shut = collapsed.has(s.name);
                  const derivedHere = s.rows.filter((r) => r.basis === 'derived').length;
                  return (
                    <div key={s.name}>
                      <button
                        className="rate-section-bar"
                        onClick={() => setCollapsed((prev) => {
                          const next = new Set(prev);
                          if (next.has(s.name)) next.delete(s.name); else next.add(s.name);
                          return next;
                        })}
                        aria-expanded={!shut}
                        style={{ width: '100%', textAlign: 'left' }}
                      >
                        <span className="rc-l">{shut ? <IChevronR /> : <IChevronD />}</span>
                        <span className="rc-m">{s.name}</span>
                        <span className="rc-i">{s.rows.length} item{s.rows.length === 1 ? '' : 's'}</span>
                        <span className="rc-e">
                          {derivedHere > 0 && (
                            <>
                              <span title="hours × labour" className="rc-b">Derived</span>
                              <span className="rc-1a">{derivedHere} derived</span>
                            </>
                          )}
                        </span>
                      </button>
                      {!shut && s.rows.map((row) => (
                        <RateRow
                          key={row.rateId}
                          row={row}
                          labourFor={labourFor}
                          editable={editable}
                          changed={moved.has(row.rateId)}
                          editing={editing}
                          onOpenEditor={(r) => setEditing(r ? { rateId: r.rate_id, axle: r.axle } : null)}
                          onCommit={commitRate}
                          onRevert={revert}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            )}

            {tab === 'fleetsmart' && (
              <FleetsmartPanel
                side={card.fleetsmart}
                editable={editable}
                onToggle={() => {
                  if (card.fleetsmart.shown) setConfirmHideFs(true);
                  else void (async () => {
                    const done = await api.showFleetsmart(cardId, true);
                    if (!done.ok) { onToast({ tone: 'error', text: done.why }); return; }
                    await after('The FleetSmart+ section will print on this card.');
                  })();
                }}
              />
            )}

            {tab === 'header' && (
              <HeaderTab
                card={card}
                editable={editable}
                onSave={async (field, value) => {
                  const done = await api.setDetail(cardId, field, value);
                  if (!done.ok) { onToast({ tone: 'error', text: done.why }); return; }
                  await after('Saved.');
                }}
                onManagers={async (ids) => {
                  const done = await api.setManagers(cardId, ids);
                  if (!done.ok) { onToast({ tone: 'error', text: done.why }); return; }
                  await after('Account manager saved.');
                }}
              />
            )}

            {tab === 'parts' && <PartsTab parts={card.parts} />}
            {tab === 'instructions' && <InstructionsTab card={card} />}
            {tab === 'history' && <HistoryTab changes={changes} />}
          </div>

          {/* ---- Status bar ---- */}
          <div className="rc-4d">
            <span>{stats.total} rates</span>
            <span className="rc-4e">{stats.derived} derived</span>
            {stats.overridden > 0 && <span className="rc-3j">{stats.overridden} overridden</span>}
            <span className="rc-4f">{stats.statutory} DVSA</span>
            <span>{stats.tbc} TBC</span>
            {card.missing.length > 0 && (
              <span className="rc-3j" title="These print blank on the sheet until they are filled in">
                {card.missing.map((m) => MISSING_WORDS[m] ?? m).join(', ')} missing
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ---- The dialogs ---- */}
      {staged && (
        <ReviewChangesModal
          pool={staged.label} from={staged.from} to={staged.to} rows={stagedRows}
          onClose={() => setStaged(null)} onConfirm={() => { void applyLabour(); }} busy={busy}
        />
      )}
      {showUplift && (
        <UpliftModal onClose={() => setShowUplift(false)} onApply={(p) => { void doUplift(p); }} busy={busy} />
      )}
      {showExport && (
        <ExportModal
          cardRef={c.ref} onClose={() => setShowExport(false)}
          onExport={(k) => { void doExport(k); }} busy={busy}
        />
      )}
      {showPreview && (
        <SheetPreview card={card} onClose={() => setShowPreview(false)} />
      )}
      {showCustom && (
        <CustomLabourModal
          busy={busy}
          onClose={() => setShowCustom(false)}
          onAdd={(args) => { void (async () => {
            setBusy(true);
            const done = await api.addLabour({ card: cardId, ...args });
            setBusy(false);
            setShowCustom(false);
            if (!done.ok) { onToast({ tone: 'error', text: done.why }); return; }
            await after(`${args.label} added.`);
          })(); }}
        />
      )}
      {showReset && (
        <ConfirmModal
          title="Reset to the default rates"
          confirm="Reset this card"
          busy={busy}
          onClose={() => setShowReset(false)}
          onConfirm={() => { void doReset(); }}
          body={
            <>
              Every rate on this card goes back to the current defaults, and
              {stats.overridden > 0
                ? ` the ${stats.overridden} rate${stats.overridden === 1 ? '' : 's'} set by hand for this customer will be cleared.`
                : ' nothing has been set by hand on it, so nothing is lost.'}
              {' '}The change is written to this card&rsquo;s history either way.
            </>
          }
        />
      )}
      {confirmHideFs && (
        <ConfirmModal
          title="Hide the FleetSmart+ section"
          confirm="Hide it on the printed card"
          busy={busy}
          onClose={() => setConfirmHideFs(false)}
          onConfirm={() => { void (async () => {
            const done = await api.showFleetsmart(cardId, false);
            setConfirmHideFs(false);
            if (!done.ok) { onToast({ tone: 'error', text: done.why }); return; }
            await after('The FleetSmart+ section will not print on this card.');
          })(); }}
          body={
            <>
              This only changes what prints. The contract stays linked, so the inclusions carry on
              tracking it and turning the section back on shows them up to date rather than stale.
            </>
          }
        />
      )}
      {confirmStatus && (
        <ConfirmModal
          title={
            confirmStatus === 'approved' ? 'Approve this rate card'
            : confirmStatus === 'awaiting' ? 'Send for approval'
            : 'Withdraw this rate card'
          }
          confirm={
            confirmStatus === 'approved' ? 'Approve it'
            : confirmStatus === 'awaiting' ? 'Send it' : 'Withdraw it'
          }
          tone={confirmStatus === 'withdrawn' ? 'danger' : 'primary'}
          busy={busy}
          onClose={() => setConfirmStatus(null)}
          onConfirm={() => { void doStatus(confirmStatus); }}
          body={
            confirmStatus === 'approved' ? (
              <>
                This becomes the live card for {c.customer_name}, and anything they had before it is
                marked superseded. A snapshot is taken so this year&rsquo;s sheet can be reproduced
                exactly when they compare it against next year&rsquo;s.
                {card.missing.length > 0 && (
                  <>
                    {' '}
                    <strong>
                      {card.missing.map((m) => MISSING_WORDS[m] ?? m).join(', ')} still
                      {card.missing.length === 1 ? ' has' : ' have'} nothing in
                      {card.missing.length === 1 ? ' it' : ' them'}, and will print blank.
                    </strong>
                  </>
                )}
              </>
            ) : confirmStatus === 'awaiting' ? (
              <>It stops being editable and goes to whoever approves rate cards.</>
            ) : (
              <>
                The card stops being used. It is not deleted and neither is its history: a rate card
                records what a customer was charged, so it is kept.
              </>
            )
          }
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------
   One labour pool. The only real decision on the card.
   ------------------------------------------------------------- */
function LabourCard({
  label, rate, drives, editable, chargeTo, isCustom, note, onCommit, onRemove,
}: {
  label: string;
  rate: number;
  drives: number;
  editable: boolean;
  chargeTo: 'stc' | 'customer';
  isCustom: boolean;
  note: string | null;
  onCommit: (value: number) => void;
  onRemove?: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(rate.toFixed(2));
  const dirty = useRef(false);

  useEffect(() => { if (!dirty.current) setDraft(rate.toFixed(2)); }, [rate]);

  const commit = () => {
    dirty.current = false;
    const value = Number(draft.replace(/[£,\s]/g, ''));
    if (Number.isNaN(value) || value < 0) { setDraft(rate.toFixed(2)); return; }
    if (Math.abs(value - rate) < 0.005) { setDraft(rate.toFixed(2)); return; }
    onCommit(round2(value));
  };

  return (
    <div className="rc-11">
      <div className="rc-r">
        <span className="rc-s">{label}</span>
        <span className="rc-t">
          {chargeTo === 'stc' ? 'billed to STC' : `drives ${drives} rate${drives === 1 ? '' : 's'}`}
        </span>
      </div>
      <div className="rc-u">
        <span className="rc-v">&pound;</span>
        {editable ? (
          <input
            className="rc-w"
            inputMode="decimal"
            aria-label={`${label} rate per hour`}
            value={draft}
            onChange={(e) => { dirty.current = true; setDraft(e.target.value); }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
              if (e.key === 'Escape') { dirty.current = false; setDraft(rate.toFixed(2)); }
            }}
          />
        ) : (
          <span className="rc-w">{rate.toFixed(2)}</span>
        )}
        {isCustom && onRemove && editable && (
          <button
            className="rc-2f"
            title={`Remove ${label}`}
            onClick={() => { void onRemove(); }}
          >
            <IClose size={13} />
          </button>
        )}
      </div>
      {note && <span className="rc-t">{note}</span>}
    </div>
  );
}
