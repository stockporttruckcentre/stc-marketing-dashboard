'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { IChevronL, IWarn, ITick, IInfo } from './icons';
import { ConfirmModal, type Toast } from './modals';
import * as api from '@/lib/ratecards/client';
import { POOL_LABELS } from '@/lib/ratecards/kit.generated';
import { money, hours as fmtHours, round2, shortDate } from '@/lib/ratecards/format';
import type { TemplateRead, TemplateRate, ResyncCandidate, TemplateChange } from '@/lib/ratecards/types';

/* =============================================================
   The default rates, and what happens to existing cards when they move.

   From the business:

     a tab in the builder hub allowing you to amend those default rates,
     similar to how the fleetsmart+ one works - when you make changes to
     defaults it should reflect for all future rate cards but it should
     ask if you want to update any that were using just the default
     rates ... and you can update/ignore them 1 by 1 or all at once.

   So changing a default does two separate things, deliberately kept
   apart: it writes the default, which every FUTURE card starts from
   with no further action, and it OFFERS to bring existing cards into
   line. Nothing existing moves until somebody says so, one at a time or
   all at once.

   A card with a rate somebody set for that customer is never offered.
   It is listed with the reason, so the answer to "why is Dole not in
   the list" is on the screen rather than in a function.
   ============================================================= */

export function DefaultRates({ onBack, onToast, caps }: {
  onBack: () => void;
  onToast: (t: Omit<Toast, 'id'>) => void;
  caps: { build: boolean; labour: boolean };
}) {
  const [data, setData] = useState<TemplateRead | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [tab, setTab] = useState<'rates' | 'cards' | 'history'>('rates');
  const [candidates, setCandidates] = useState<ResyncCandidate[]>([]);
  const [log, setLog] = useState<TemplateChange[]>([]);
  const [busy, setBusy] = useState(false);
  const [offer, setOffer] = useState<{ count: number; what: string } | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const load = useCallback(async () => {
    const got = await api.readDefaults();
    if (!got.ok) { setFailed(got.why); return; }
    setFailed(null);
    setData(got.value);
  }, []);

  const loadCandidates = useCallback(async () => {
    const got = await api.resyncCandidates();
    if (got.ok) setCandidates(got.value);
  }, []);

  const loadLog = useCallback(async () => {
    const got = await api.defaultsHistory();
    if (got.ok) setLog(got.value);
  }, []);

  useEffect(() => { void load(); void loadCandidates(); }, [load, loadCandidates]);
  useEffect(() => { if (tab === 'history') void loadLog(); }, [tab, loadLog]);

  const labourFor = useCallback((pool: string | null) => {
    if (!data || !pool) return null;
    const row = data.labour.find((l) => l.pool === pool);
    return row ? Number(row.rate) : null;
  }, [data]);

  const sections = useMemo(() => {
    if (!data) return [];
    const out: { name: string; rows: typeof data.rates }[] = [];
    for (const r of data.rates) {
      if (r.section === 'Parts Rates') continue;
      const last = out[out.length - 1];
      if (last && last.name === r.section) last.rows.push(r);
      else out.push({ name: r.section, rows: [r] });
    }
    return out;
  }, [data]);

  /* Every default change comes back with how many existing cards could
     follow it, which is what raises the offer. */
  const afterChange = async (count: number, what: string) => {
    await load();
    await loadCandidates();
    if (count > 0) setOffer({ count, what });
    else onToast({ tone: 'success', text: `${what} changed. Every new card starts from it.` });
  };

  if (failed) {
    return (
      <div className="rc-6a">
        <div className="rc-6g" style={{ padding: 26 }}>
          <div className="rc-2s"><IWarn size={16} /><span className="rc-2x">{failed}</span></div>
          <button className="rc-27" onClick={onBack} style={{ marginTop: 14 }}>
            <span>Back to the rate cards</span>
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rc-6a">
        <div className="rc-6g" style={{ padding: 26 }}>
          <span className="rc-y">Loading the default rates.</span>
        </div>
      </div>
    );
  }

  const untouched = candidates.filter((c) => c.untouched);
  const touched = candidates.filter((c) => !c.untouched);

  return (
    <div className="rc-6a">
      <div className="rc-6g">
        <div className="rc-6x">
          <div className="rc-3z">
            <button className="rc-2f" onClick={onBack} title="Back to the rate cards"><IChevronL /></button>
            <div className="rc-3e">
              <div className="rc-1h">
                <span className="rc-40">Default rates</span>
                <span className="rc-1g">the template</span>
              </div>
              <span className="rc-2g">
                What every new rate card starts as. Changing one here never changes an existing
                card on its own.
              </span>
            </div>
          </div>

          <div className="rc-42">
            <div className="rc-43">
              <span className="rc-44">Default labour rates</span>
              <span className="rc-2g">
                {data.rates.filter((r) => r.basis === 'derived').length} of the{' '}
                {new Set(data.rates.map((r) => r.rate_id)).size} rates follow these.
              </span>
            </div>
            <div className="rc-45">
              {data.labour.map((l) => (
                <DefaultLabour
                  key={l.pool}
                  label={POOL_LABELS[l.pool] ?? l.label}
                  rate={Number(l.rate)}
                  drives={data.rates.filter((r) => r.basis === 'derived' && r.pool === l.pool).length}
                  editable={caps.labour}
                  onCommit={async (value) => {
                    setBusy(true);
                    const done = await api.setDefaultLabour(l.pool, value);
                    setBusy(false);
                    if (!done.ok) { onToast({ tone: 'error', text: done.why }); return; }
                    await afterChange(done.value, l.label);
                  }}
                />
              ))}
            </div>
          </div>

          <div className="rc-46">
            <button
              className={tab === 'rates' ? 'rc-47' : 'rc-x'}
              aria-current={tab === 'rates' ? 'page' : undefined}
              onClick={() => setTab('rates')}
            >
              Every default rate
            </button>
            <button
              className={tab === 'cards' ? 'rc-47' : 'rc-x'}
              aria-current={tab === 'cards' ? 'page' : undefined}
              onClick={() => setTab('cards')}
            >
              Existing cards
              {untouched.length > 0 && <span className="rc-49">{untouched.length}</span>}
            </button>
            <button
              className={tab === 'history' ? 'rc-47' : 'rc-x'}
              aria-current={tab === 'history' ? 'page' : undefined}
              onClick={() => setTab('history')}
            >
              History
            </button>
          </div>

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
                {sections.map((s) => (
                  <div key={s.name}>
                    <div className="rate-section-bar">
                      <span className="rc-m">{s.name}</span>
                      <span className="rc-i">
                        {new Set(s.rows.map((r) => r.rate_id)).size} items
                      </span>
                      <span className="rc-e" />
                    </div>
                    {Array.from(new Set(s.rows.map((r) => r.rate_id))).map((rateId) => {
                      const cols = s.rows.filter((r) => r.rate_id === rateId);
                      const first = cols[0]!;
                      const axled = cols.some((r) => r.axle > 0);
                      const byAxle = new Map(cols.map((r) => [r.axle, r]));
                      const labour = labourFor(first.pool);
                      return (
                        <div className="rate-row" key={rateId}>
                          <div className="rc-7"><span className="rc-4">{first.item}</span></div>
                          {axled ? [1, 2, 3, 4].map((a) => {
                            const cell = byAxle.get(a);
                            if (!cell) return <div className="rc-5" key={a}><span className="rc-6">–</span></div>;
                            return (
                              <DefaultCell
                                key={a} cell={cell} labour={labour} editable={caps.labour}
                                onSave={async (args) => {
                                  setBusy(true);
                                  const done = await api.setDefaultRate({ rateId, axle: a, ...args });
                                  setBusy(false);
                                  if (!done.ok) { onToast({ tone: 'error', text: done.why }); return; }
                                  await afterChange(done.value, first.item);
                                }}
                              />
                            );
                          }) : (
                            <DefaultCell
                              wide cell={first} labour={labour} editable={caps.labour}
                              onSave={async (args) => {
                                setBusy(true);
                                const done = await api.setDefaultRate({ rateId, axle: first.axle, ...args });
                                setBusy(false);
                                if (!done.ok) { onToast({ tone: 'error', text: done.why }); return; }
                                await afterChange(done.value, first.item);
                              }}
                            />
                          )}
                          <div className="rc-8">
                            {first.basis === 'derived' && first.hours !== null && labour !== null && (
                              <span className="rc-d">{fmtHours(Number(first.hours))} × {money(labour)}</span>
                            )}
                          </div>
                          <div className="rc-9">
                            <span className={
                              first.basis === 'derived' ? 'rc-b'
                              : first.basis === 'labour' ? 'rc-1k'
                              : first.basis === 'statutory' ? 'rc-4i' : 'rc-n'
                            }>
                              {first.basis === 'derived' ? 'Derived'
                                : first.basis === 'labour' ? 'Labour'
                                : first.basis === 'statutory' ? 'Statutory'
                                : first.basis === 'fixed' ? 'Fixed'
                                : first.basis === 'tbc' ? 'TBC' : 'Empty'}
                            </span>
                          </div>
                          <div className="rc-a" />
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}

            {tab === 'cards' && (
              <div className="rc-77">
                <div className="rc-2s">
                  <IInfo size={16} />
                  <span className="rc-2x">
                    {untouched.length} card{untouched.length === 1 ? '' : 's'} can be brought into
                    line with the defaults. {touched.length} {touched.length === 1 ? 'has' : 'have'}{' '}
                    rates somebody set for that customer and{' '}
                    {touched.length === 1 ? 'is' : 'are'} never changed automatically.
                  </span>
                </div>

                {untouched.length > 1 && caps.build && (
                  <div style={{ padding: '0 16px 12px' }}>
                    <button className="rc-16" onClick={() => setConfirmAll(true)} disabled={busy}>
                      <span>Bring all {untouched.length} into line</span>
                    </button>
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {candidates.length === 0 && (
                    <div style={{ padding: '18px 16px' }}>
                      <span className="rc-y">
                        No draft cards, so there is nothing a change to the defaults could affect.
                      </span>
                    </div>
                  )}
                  {candidates.map((c) => (
                    <div
                      key={c.card_id}
                      style={{
                        display: 'grid', gridTemplateColumns: '1fr 120px 130px 1fr 130px',
                        gap: 12, alignItems: 'center', padding: '9px 16px',
                        borderTop: '1px solid var(--border)', fontSize: 13,
                      }}
                    >
                      <span>{c.customer_name}</span>
                      <span style={{ color: 'var(--text-subtle)' }}>{c.card_ref}</span>
                      <span style={{ color: 'var(--text-subtle)' }}>{shortDate(c.effective_from)}</span>
                      <span style={{ color: c.untouched ? 'var(--text-muted)' : 'var(--warning)' }}>
                        {c.untouched ? 'Still purely on the defaults' : c.why_not}
                      </span>
                      {c.untouched && caps.build ? (
                        <button
                          className="rc-27"
                          disabled={busy}
                          onClick={() => { void (async () => {
                            setBusy(true);
                            const done = await api.resyncOne(c.card_id);
                            setBusy(false);
                            if (!done.ok) { onToast({ tone: 'error', text: done.why }); return; }
                            await loadCandidates();
                            onToast({ tone: 'success', text: `${c.customer_name} brought into line.` });
                          })(); }}
                        >
                          <span>Update this one</span>
                        </button>
                      ) : (
                        <button
                          className="rc-27"
                          disabled
                          title={c.untouched
                            ? 'You do not have the right to amend a rate card'
                            : 'This card has rates set for that customer, so it is left alone. Open it and use Reset to default rates if that is really what you want.'}
                        >
                          <span>Left alone</span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'history' && (
              <div className="rc-77">
                <div className="rc-2s">
                  <span className="rc-2t">
                    Every change to the default rates, permanently. Nothing here can be edited or
                    removed by anybody.
                  </span>
                </div>
                {log.length === 0 && (
                  <div style={{ padding: '18px 16px' }}>
                    <span className="rc-y">The defaults have not been changed yet.</span>
                  </div>
                )}
                {log.map((h) => (
                  <div
                    key={h.id}
                    style={{
                      display: 'grid', gridTemplateColumns: '150px 1fr 190px 140px',
                      gap: 12, alignItems: 'baseline', padding: '9px 16px',
                      borderTop: '1px solid var(--border)', fontSize: 13,
                    }}
                  >
                    <span style={{ color: 'var(--text-subtle)', fontSize: 12 }}>
                      {new Date(h.at).toLocaleString('en-GB', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                    <span>
                      {h.what}
                      {h.cards_moved > 0 && <span className="rc-12">{h.cards_moved} card(s) followed</span>}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                      {h.was !== null && h.now_is !== null
                        ? <>{h.was} &rarr; <strong>{h.now_is}</strong></> : h.now_is ?? ''}
                    </span>
                    <span style={{ color: 'var(--text-subtle)' }}>{h.actor_name ?? 'System'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rc-4d">
            <span>{new Set(data.rates.map((r) => r.rate_id)).size} default rates</span>
            <span className="rc-4e">
              {new Set(data.rates.filter((r) => r.basis === 'derived').map((r) => r.rate_id)).size} derived
            </span>
            <span>{data.untouched_cards} card(s) could follow a change</span>
            <span className="rc-3j">{data.touched_cards} set for their customer</span>
          </div>
        </div>
      </div>

      {/* The offer, raised by a change rather than by a button. */}
      {offer && (
        <ConfirmModal
          title={`${offer.what} changed. Bring existing cards into line?`}
          confirm={`Update all ${offer.count}`}
          busy={busy}
          onClose={() => {
            setOffer(null);
            onToast({
              tone: 'info',
              text: 'Left alone. Every new card starts from the new default, and existing cards are on the Existing cards tab whenever you want them.',
            });
          }}
          onConfirm={() => { void (async () => {
            setBusy(true);
            const done = await api.resyncAll();
            setBusy(false);
            setOffer(null);
            if (!done.ok) { onToast({ tone: 'error', text: done.why }); return; }
            await loadCandidates();
            await load();
            onToast({ tone: 'success', text: `${done.value} card(s) brought into line.` });
          })(); }}
          body={
            <>
              Every new rate card already starts from the new default. {offer.count} existing
              card{offer.count === 1 ? '' : 's'} {offer.count === 1 ? 'is' : 'are'} still purely on
              the old one and can follow it. Cards with rates somebody set for that customer are
              never touched. You can also do them one at a time on the Existing cards tab.
            </>
          }
        />
      )}

      {confirmAll && (
        <ConfirmModal
          title={`Bring ${untouched.length} cards into line`}
          confirm={`Update all ${untouched.length}`}
          busy={busy}
          onClose={() => setConfirmAll(false)}
          onConfirm={() => { void (async () => {
            setBusy(true);
            const done = await api.resyncAll();
            setBusy(false);
            setConfirmAll(false);
            if (!done.ok) { onToast({ tone: 'error', text: done.why }); return; }
            await loadCandidates();
            onToast({ tone: 'success', text: `${done.value} card(s) brought into line.` });
          })(); }}
          body={
            <>
              Each one gets the current defaults and a line in its own history saying so. Cards
              with rates set for their customer are not included.
            </>
          }
        />
      )}
    </div>
  );
}

function DefaultLabour({ label, rate, drives, editable, onCommit }: {
  label: string; rate: number; drives: number; editable: boolean;
  onCommit: (value: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState(rate.toFixed(2));
  useEffect(() => { setDraft(rate.toFixed(2)); }, [rate]);

  return (
    <div className="rc-11">
      <div className="rc-r">
        <span className="rc-s">{label}</span>
        <span className="rc-t">drives {drives} rate{drives === 1 ? '' : 's'}</span>
      </div>
      <div className="rc-u">
        <span className="rc-v">&pound;</span>
        {editable ? (
          <input
            className="rc-w" inputMode="decimal" value={draft}
            aria-label={`Default ${label} rate per hour`}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              const v = Number(draft.replace(/[£,\s]/g, ''));
              if (Number.isNaN(v) || v < 0 || Math.abs(v - rate) < 0.005) { setDraft(rate.toFixed(2)); return; }
              void onCommit(round2(v));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setDraft(rate.toFixed(2));
            }}
          />
        ) : <span className="rc-w">{rate.toFixed(2)}</span>}
      </div>
    </div>
  );
}

/** One default rate cell. A derived rate is edited by its hours. */
function DefaultCell({ cell, labour, editable, wide, onSave }: {
  cell: { basis: string; hours: number | null; amount: number | null; text_value: string | null; price: number | null; item: string };
  labour: number | null;
  editable: boolean;
  wide?: boolean;
  onSave: (args: { hours?: number | null; amount?: number | null; text?: string | null }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const start = () => {
    if (!editable) return;
    setDraft(cell.basis === 'derived'
      ? String(cell.price ?? '')
      : cell.amount !== null ? String(cell.amount) : (cell.text_value ?? ''));
    setOpen(true);
  };

  const commit = async () => {
    setOpen(false);
    const text = draft.trim();
    if (text === '') return;
    if (cell.basis === 'derived') {
      const price = Number(text.replace(/[£,\s]/g, ''));
      if (Number.isNaN(price) || labour === null || labour <= 0) return;
      if (cell.price !== null && Math.abs(price - cell.price) < 0.005) return;
      /* Typed as a price because that is what a person knows, stored as
         hours because that is what makes it follow the labour rate. */
      await onSave({ hours: price / labour });
    } else if (cell.basis === 'fixed' || cell.basis === 'statutory' || cell.basis === 'labour') {
      const amount = Number(text.replace(/[£,\s]/g, ''));
      if (Number.isNaN(amount)) return;
      if (cell.amount !== null && Math.abs(amount - cell.amount) < 0.005) return;
      await onSave({ amount });
    } else {
      if (text === (cell.text_value ?? '')) return;
      await onSave({ text });
    }
  };

  const cls = wide ? 'rc-j' : 'rc-3';

  if (open) {
    return (
      <div className={cls}>
        <input
          className="rc-1b" autoFocus value={draft}
          aria-label={`${cell.item} default`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { void commit(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void commit(); }
            if (e.key === 'Escape') setOpen(false);
          }}
          style={{ width: '100%', textAlign: 'right' }}
        />
      </div>
    );
  }

  if (cell.price === null && !cell.text_value) {
    return (
      <div className={editable ? cls : 'rc-5'} onDoubleClick={start} title={editable ? 'Double click to set this default' : undefined}>
        <span className="rc-6">–</span>
      </div>
    );
  }

  return (
    <div className={cls} onDoubleClick={start} title={editable ? 'Double click to set this default' : undefined}>
      <span className="rc-2">
        {cell.price !== null ? money(cell.price) : cell.text_value}
      </span>
    </div>
  );
}
