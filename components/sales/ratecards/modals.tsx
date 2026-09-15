'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IClose, ITick, IWarn, IInfo } from './icons';
import { money, shortDate } from '@/lib/ratecards/format';
import type { DuplicateVerdict } from '@/lib/ratecards/types';

/* =============================================================
   The dialogs, ported from the pack's nine modal files.

   One scrim component, because every one of them sits in the same
   place, closes on Escape and on the backdrop, and traps focus. The
   pack draws them flat on its reference page, which has nowhere to
   float them to; `port.css` is where they are given somewhere.
   ============================================================= */

export function Scrim({ onClose, children, label }: {
  onClose: () => void; children: React.ReactNode; label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  /* Rendered into the body rather than into the page.

     `.main` is a stacking context at z-index 1 and the sidebar is its
     sibling at 2, so a dialog rendered inside the page cannot rise
     above the sidebar however high its own z-index. The same portal
     `components/crm/AddressMap.tsx` uses, for the same reason. */
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  /* ---- Focus is taken once, and never taken again ----

     From the business:

       when i type a letter in the rate card creator wizard, the cursor
       disappears after typing one letter - if you type another letter
       it closes the wizard.

     Two faults in four lines. The effect listed `onClose` in its
     dependencies, and every caller passes an inline arrow, so a new one
     arrives on every render: typing a letter re-rendered the dialog,
     which re-ran the effect, which moved focus. And what it moved focus
     TO was `querySelector('input, button')`, which returns the first
     match in DOCUMENT order rather than the first listed: the close
     button in the header sits above the field, so focus landed on it
     and the next key press closed the dialog.

     So the effect runs once, on mount, and `onClose` is read through a
     ref rather than watched. Focus goes to the first field, and only to
     a button when there is no field. */
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close.current(); }
      if (e.key !== 'Tab') return;
      /* Focus stays inside a dialog. Without this, tabbing walks into
         the page behind it, which for a modal over a rate table means
         editing a rate you cannot see. */
      const focusable = box.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    const id = window.requestAnimationFrame(() => {
      const field = box.current?.querySelector<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
      (field ?? box.current?.querySelector<HTMLElement>('button:not([disabled])'))?.focus();
    });
    return () => {
      document.removeEventListener('keydown', onKey, true);
      window.cancelAnimationFrame(id);
    };
    /* Deliberately empty: taking focus is something a dialog does when
       it opens, not something it does again because it re-rendered. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      className="rc-scrim rc-tokens"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      /* Only a press that BEGINS on the backdrop closes it. A drag that
         starts on the dialog and releases outside it is somebody
         selecting text, not somebody dismissing the dialog. */
      onMouseDown={(e) => { if (e.target === e.currentTarget) close.current(); }}
    >
      <div ref={box}>{children}</div>
    </div>,
    document.body,
  );
}

/* -------------------------------------------------------------
   New rate card. Ported from `modal-new-card.html`.

   From the business:

     When creating one in the rate card builder and you select a
     customer, have it tell you if one exists and ask if you want to
     proceed.

   The warning has four states rather than two, because a card from
   three years ago is not a reason to stop. See `rate_card_for_customer`
   in migration 110 for why each one says what it says.
   ------------------------------------------------------------- */
export function NewCardModal({
  customers, sources, onSearch, onClose, onCheck, onCreate, busy,
}: {
  customers: { id: string; company_name: string; contact_name: string | null }[];
  /** Cards this one could be copied from, that customer's own first. */
  sources: {
    card_id: string; card_ref: string; customer_name: string;
    effective_from: string; overrides: number; same_customer: boolean;
  }[];
  onSearch: (q: string) => void;
  onClose: () => void;
  onCheck: (contactId: string) => Promise<DuplicateVerdict | null>;
  onCreate: (args: {
    contactId: string; effective: string; supersede: boolean; copyFrom: string | null;
  }) => Promise<void>;
  busy: boolean;
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<{ id: string; company_name: string } | null>(null);
  const [verdict, setVerdict] = useState<DuplicateVerdict | null>(null);
  const [effective, setEffective] = useState(() => new Date().toISOString().slice(0, 10));
  const [checking, setChecking] = useState(false);
  const [copyFrom, setCopyFrom] = useState<string | null>(null);

  const pick = async (c: { id: string; company_name: string }) => {
    setPicked(c);
    setChecking(true);
    setVerdict(await onCheck(c.id));
    setChecking(false);
  };

  /* Only a card that is still current is a reason to stop and ask. */
  const blocking = verdict?.verdict === 'live' || verdict?.verdict === 'ageing';

  return (
    <Scrim onClose={onClose} label="New rate card">
      <div className="rc-4m">
        <div className="rc-1n">
          <div className="rc-1o">
            <span className="rc-1p">New rate card</span>
            <span className="rc-1q">
              Pick the customer. Everything else is filled from the template and their contract.
            </span>
          </div>
          <button className="rc-1r" onClick={onClose} title="Close without creating anything">
            <IClose />
          </button>
        </div>

        <div className="rc-1s">
          <div className="rc-3o">
            <div className="rc-28">
              <span className="rc-z">
                Customer <span className="rc-3j">*</span>
              </span>
              <div className="rc-29">
                <input
                  className="rc-1b"
                  placeholder="Start typing a customer name"
                  value={picked ? picked.company_name : query}
                  onChange={(e) => {
                    setPicked(null); setVerdict(null);
                    setQuery(e.target.value); onSearch(e.target.value);
                  }}
                  aria-label="Customer"
                />
              </div>
              <span className="rc-y">
                Contacts, address and accounts details come across automatically.
              </span>

              {!picked && query.trim() !== '' && (
                <div style={{
                  border: '1px solid var(--border)', borderRadius: 'var(--r)',
                  maxHeight: 190, overflowY: 'auto', marginTop: 2,
                }}>
                  {customers.length === 0 ? (
                    <div className="rc-y" style={{ padding: '10px 12px' }}>
                      No customer of that name. They have to be in the CRM first.
                    </div>
                  ) : customers.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => { void pick(c); }}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '8px 12px', fontSize: 13,
                        borderBottom: '1px solid var(--border)',
                      }}
                    >
                      {c.company_name}
                      {c.contact_name && (
                        <span style={{ color: 'var(--text-subtle)', marginLeft: 8 }}>{c.contact_name}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {checking && <span className="rc-y">Checking whether they already have one.</span>}

            {verdict && verdict.verdict !== 'none' && (
              <div className="rc-2s">
                <IWarn size={16} />
                <div className="rc-1o">
                  <span className="rc-4n">
                    {verdict.verdict === 'live' && `${picked?.company_name} already has a current rate card`}
                    {verdict.verdict === 'ageing' && `${picked?.company_name}'s rate card is nearly a year old`}
                    {verdict.verdict === 'expired' && `${picked?.company_name}'s last rate card has expired`}
                  </span>
                  <span className="rc-2x">
                    {verdict.card_ref}, effective {shortDate(verdict.effective_from)}
                    {verdict.owner_name ? `, owned by ${verdict.owner_name}` : ''}.
                    {verdict.verdict === 'live' && ' Creating a new one replaces it, and the old one is kept as superseded.'}
                    {verdict.verdict === 'ageing' && ' A replacement is expected about now.'}
                    {verdict.verdict === 'expired' && ' It is past its year, so it is not a reason to stop.'}
                  </span>
                </div>
              </div>
            )}

            <div className="rc-5q">
              <div className="rc-28">
                <span className="rc-z">Effective from</span>
                <div className="rc-29">
                  <input
                    className="rc-1b" type="date" value={effective}
                    onChange={(e) => setEffective(e.target.value)}
                    aria-label="Effective from"
                  />
                </div>
                <span className="rc-y">Rates are good for a year from this date.</span>
              </div>
              {/* START FROM.

                  The kit's own dialog has this field and the line
                  "Or copy an existing card" under it. The first build
                  only offered the defaults and disabled the field, which
                  the business queried: "in the creation wizard it says
                  start from and the only option is The current default
                  rates - is that correct?" It was not. */}
              <div className="rc-28">
                <span className="rc-z">Start from</span>
                <div className="rc-29">
                  <select
                    className="rc-1b"
                    aria-label="Start from"
                    value={copyFrom ?? ''}
                    style={{ width: '100%' }}
                    onChange={(e) => setCopyFrom(e.target.value || null)}
                  >
                    <option value="">The current default rates</option>
                    {sources.length > 0 && (
                      <optgroup label="Or copy an existing card">
                        {sources.map((c) => (
                          <option key={c.card_id} value={c.card_id}>
                            {c.customer_name}
                            {' '}({c.card_ref}, {shortDate(c.effective_from)}
                            {c.overrides > 0 ? `, ${c.overrides} set by hand` : ''})
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
                <span className="rc-y">
                  {copyFrom
                    ? 'Its rates, its labour band and anything set by hand on it come across. The customer, the dates and its history do not.'
                    : 'Change the defaults on the Default rates tab, and every new card starts from them.'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="rc-1t">
          <button className="rc-27" onClick={onClose}>
            <span>Cancel</span>
          </button>
          <button
            className="rc-16"
            disabled={!picked || busy}
            title={!picked ? 'Pick a customer first' : undefined}
            onClick={() => {
              if (!picked) return;
              void onCreate({ contactId: picked.id, effective, supersede: !!blocking, copyFrom });
            }}
          >
            <span>
              {busy ? 'Creating' : blocking ? 'Replace it and open' : 'Create and open'}
            </span>
          </button>
        </div>
      </div>
    </Scrim>
  );
}

/* -------------------------------------------------------------
   Review a staged labour change. Ported from `modal-review-changes.html`.

   From the handoff: "A labour change is staged; everything else commits
   immediately. A labour edit moves many rows, so it needs review."
   ------------------------------------------------------------- */
export function ReviewChangesModal({
  pool, from, to, rows, onClose, onConfirm, busy,
}: {
  pool: string;
  from: number;
  to: number;
  rows: { item: string; axle: number; before: number | null; after: number | null }[];
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  return (
    <Scrim onClose={onClose} label="Review the change">
      <div className="rc-4m">
        <div className="rc-1n">
          <div className="rc-1o">
            <span className="rc-1p">{rows.length} rate{rows.length === 1 ? '' : 's'} will move</span>
            <span className="rc-1q">
              {pool} goes from {money(from)} to {money(to)}. Nothing is written until you accept.
            </span>
          </div>
          <button className="rc-1r" onClick={onClose} title="Leave the labour rate as it was">
            <IClose />
          </button>
        </div>

        <div className="rc-1s">
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {rows.map((r, i) => (
              <div
                key={`${r.item}-${r.axle}-${i}`}
                style={{
                  display: 'grid', gridTemplateColumns: '1fr 90px 20px 90px',
                  gap: 8, alignItems: 'center', padding: '7px 0',
                  borderTop: i === 0 ? 0 : '1px solid var(--border)', fontSize: 13,
                }}
              >
                <span>
                  {r.item}
                  {r.axle > 0 && <span className="rc-12"> {r.axle}-axle</span>}
                </span>
                <span style={{ textAlign: 'right', color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums' }}>
                  {money(r.before)}
                </span>
                <span style={{ textAlign: 'center', color: 'var(--text-subtle)' }}>&rarr;</span>
                <span style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {money(r.after)}
                </span>
              </div>
            ))}
            {rows.length === 0 && (
              <span className="rc-y">
                Nothing derives from this labour rate on this card, so only the rate itself moves.
              </span>
            )}
          </div>
        </div>

        <div className="rc-1t">
          <button className="rc-27" onClick={onClose}><span>Cancel</span></button>
          <button className="rc-16" onClick={onConfirm} disabled={busy}>
            <span>{busy ? 'Applying' : `Apply to ${rows.length} rate${rows.length === 1 ? '' : 's'}`}</span>
          </button>
        </div>
      </div>
    </Scrim>
  );
}

/* -------------------------------------------------------------
   A plain confirmation, used by hide FleetSmart+, reset, withdraw and
   send for approval. Ported from `modal-hide-fs.html`, which is the
   shape all four share.
   ------------------------------------------------------------- */
export function ConfirmModal({
  title, body, confirm, tone = 'primary', onClose, onConfirm, busy,
}: {
  title: string;
  body: React.ReactNode;
  confirm: string;
  tone?: 'primary' | 'danger';
  onClose: () => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  return (
    <Scrim onClose={onClose} label={title}>
      <div className="rc-4m">
        <div className="rc-1n">
          <div className="rc-1o">
            <span className="rc-1p">{title}</span>
          </div>
          <button className="rc-1r" onClick={onClose} title="Close"><IClose /></button>
        </div>
        <div className="rc-1s">
          <div className="rc-2s">
            <IInfo size={16} />
            <span className="rc-2x">{body}</span>
          </div>
        </div>
        <div className="rc-1t">
          <button className="rc-27" onClick={onClose}><span>Cancel</span></button>
          <button
            className={tone === 'danger' ? 'rc-17' : 'rc-16'}
            onClick={onConfirm}
            disabled={busy}
          >
            <span>{busy ? 'Working' : confirm}</span>
          </button>
        </div>
      </div>
    </Scrim>
  );
}

/* -------------------------------------------------------------
   Bulk uplift. Ported from `modal-bulk-uplift.html`.

   The DVSA fees are skipped by type rather than by a checkbox somebody
   has to remember to untick, and the dialog says so rather than
   offering the choice.
   ------------------------------------------------------------- */
export function UpliftModal({ onClose, onApply, busy }: {
  onClose: () => void; onApply: (percent: number) => void; busy: boolean;
}) {
  const [percent, setPercent] = useState('3');
  const value = Number(percent);
  const valid = !Number.isNaN(value) && percent.trim() !== '';

  return (
    <Scrim onClose={onClose} label="Bulk uplift">
      <div className="rc-4m">
        <div className="rc-1n">
          <div className="rc-1o">
            <span className="rc-1p">Uplift every rate</span>
            <span className="rc-1q">The yearly rise, applied in one go.</span>
          </div>
          <button className="rc-1r" onClick={onClose} title="Close"><IClose /></button>
        </div>
        <div className="rc-1s">
          <div className="rc-3o">
            <div className="rc-28">
              <span className="rc-z">Percentage</span>
              <div className="rc-29">
                <input
                  className="rc-1b" inputMode="decimal" value={percent}
                  onChange={(e) => setPercent(e.target.value)} aria-label="Uplift percentage"
                />
              </div>
              <span className="rc-y">
                The five labour rates move, which carries the 19 derived rates with them, and
                STC&rsquo;s own flat charges move. The six DVSA fees do not: they are what the
                government charges and are skipped by type, not by a box you have to remember to untick.
              </span>
            </div>
          </div>
        </div>
        <div className="rc-1t">
          <button className="rc-27" onClick={onClose}><span>Cancel</span></button>
          <button
            className="rc-16" disabled={!valid || busy}
            title={!valid ? 'Type a percentage first' : undefined}
            onClick={() => onApply(value)}
          >
            <span>{busy ? 'Applying' : `Uplift by ${percent}%`}</span>
          </button>
        </div>
      </div>
    </Scrim>
  );
}

/* -------------------------------------------------------------
   Export. Ported from `modal-export.html`.
   ------------------------------------------------------------- */
export function ExportModal({ onClose, onExport, busy, cardRef }: {
  onClose: () => void;
  onExport: (kind: 'xlsx' | 'pdf') => void;
  busy: boolean;
  cardRef: string;
}) {
  return (
    <Scrim onClose={onClose} label="Export the rate card">
      <div className="rc-4m">
        <div className="rc-1n">
          <div className="rc-1o">
            <span className="rc-1p">Export {cardRef}</span>
            <span className="rc-1q">
              The workbook is built from the master, so it opens looking exactly like last year&rsquo;s.
            </span>
          </div>
          <button className="rc-1r" onClick={onClose} title="Close"><IClose /></button>
        </div>
        <div className="rc-1s">
          <div className="rc-3o">
            <button className="rc-7k" onClick={() => onExport('xlsx')} disabled={busy}>
              <span className="rc-4n">Excel workbook</span>
              <span className="rc-2x">
                Values written into a copy of the master, so the styling, the merges, the column
                widths and the logo are the customer&rsquo;s own file rather than a rebuild of it.
              </span>
            </button>
            <button className="rc-7k" onClick={() => onExport('pdf')} disabled={busy}>
              <span className="rc-4n">PDF</span>
              <span className="rc-2x">
                The same figures, laid out for paper. It opens the print view, where the
                destination is Save as PDF. There is no PDF renderer on the server, so this is the
                browser&rsquo;s own, which writes a better one anyway.
              </span>
            </button>
          </div>
        </div>
        <div className="rc-1t">
          <button className="rc-27" onClick={onClose}><span>Close</span></button>
        </div>
      </div>
    </Scrim>
  );
}

/* -------------------------------------------------------------
   A custom labour rate. The non-inclusive one, which is the part of
   this screen most likely to be misunderstood, so the dialog explains
   it in the business's own terms rather than labelling a field.
   ------------------------------------------------------------- */
export function CustomLabourModal({ onClose, onAdd, busy }: {
  onClose: () => void;
  onAdd: (args: { pool: string; label: string; rate: number; chargeTo: 'stc' | 'customer'; note: string }) => void;
  busy: boolean;
}) {
  const [label, setLabel] = useState('');
  const [rate, setRate] = useState('');
  const [chargeTo, setChargeTo] = useState<'stc' | 'customer'>('customer');
  const [note, setNote] = useState('');

  const value = Number(rate);
  const valid = label.trim() !== '' && rate.trim() !== '' && !Number.isNaN(value) && value >= 0;

  return (
    <Scrim onClose={onClose} label="Add a labour rate">
      <div className="rc-4m">
        <div className="rc-1n">
          <div className="rc-1o">
            <span className="rc-1p">Add a labour rate</span>
            <span className="rc-1q">
              For work charged at a different hourly rate from the standard one.
            </span>
          </div>
          <button className="rc-1r" onClick={onClose} title="Close"><IClose /></button>
        </div>

        <div className="rc-1s">
          <div className="rc-3o">
            <div className="rc-2s">
              <IInfo size={16} />
              <span className="rc-2x">
                A customer on Gold has their A services billed internally to STC, because they
                already paid for them in the monthly contract. Brake work is not in Gold, so it is
                billed to the customer&rsquo;s own account and can be a different rate. Setting both
                here is what lets the admin team read one sheet and know which to raise.
              </span>
            </div>

            <div className="rc-28">
              <span className="rc-z">What this rate is for <span className="rc-3j">*</span></span>
              <div className="rc-29">
                <input
                  className="rc-1b" value={label} onChange={(e) => setLabel(e.target.value)}
                  placeholder="HGV, work not included in the contract" aria-label="What this rate is for"
                />
              </div>
              <span className="rc-y">This is what prints on the card, so write it for the reader.</span>
            </div>

            <div className="rc-5q">
              <div className="rc-28">
                <span className="rc-z">Rate per hour <span className="rc-3j">*</span></span>
                <div className="rc-29">
                  <input
                    className="rc-1b" inputMode="decimal" value={rate}
                    onChange={(e) => setRate(e.target.value)} placeholder="90.00" aria-label="Rate per hour"
                  />
                </div>
              </div>
              <div className="rc-28">
                <span className="rc-z">Who is billed</span>
                <div className="rc-29">
                  <select
                    className="rc-1b" value={chargeTo} aria-label="Who is billed"
                    onChange={(e) => setChargeTo(e.target.value as 'stc' | 'customer')}
                    style={{ width: '100%' }}
                  >
                    <option value="customer">The customer&rsquo;s account</option>
                    <option value="stc">STC internally, contract inclusive</option>
                  </select>
                </div>
                <span className="rc-y">
                  {chargeTo === 'stc'
                    ? 'Work the contract already covers. The customer has paid for it monthly.'
                    : 'Work outside the contract. It goes on the customer’s account.'}
                </span>
              </div>
            </div>

            <div className="rc-28">
              <span className="rc-z">Note</span>
              <div className="rc-29">
                <input
                  className="rc-1b" value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional, for whoever reads this in six months" aria-label="Note"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="rc-1t">
          <button className="rc-27" onClick={onClose}><span>Cancel</span></button>
          <button
            className="rc-16" disabled={!valid || busy}
            title={!valid ? 'A name and a rate are both needed' : undefined}
            onClick={() => onAdd({
              pool: `custom-${label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}`,
              label: label.trim(), rate: value, chargeTo, note: note.trim(),
            })}
          >
            <span>{busy ? 'Adding' : 'Add this rate'}</span>
          </button>
        </div>
      </div>
    </Scrim>
  );
}

/* -------------------------------------------------------------
   Toasts. Ported from `toasts.html`.

   From the handoff: "Bulk and destructive actions are undoable for 10
   seconds, not confirmed twice."
   ------------------------------------------------------------- */
export type Toast = {
  id: number;
  tone: 'success' | 'info' | 'error';
  text: string;
  undo?: () => void;
};

export function Toasts({ toasts, onDismiss }: {
  toasts: Toast[]; onDismiss: (id: number) => void;
}) {
  /* Into the body, for the reason the scrim is: nothing inside `.main`
     can rise above the sidebar. This is the one the business saw. */
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!mounted || toasts.length === 0) return null;
  const cls = { success: 'rc-8l', info: 'rc-8n', error: 'rc-8p' } as const;
  return createPortal(
    <div className="rc-toasts rc-tokens" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cls[t.tone]}>
          {t.tone === 'success' ? <ITick size={15} /> : <IWarn size={15} />}
          <span style={{ flex: 1, fontSize: 13 }}>{t.text}</span>
          {t.undo && (
            <button
              onClick={() => { t.undo?.(); onDismiss(t.id); }}
              style={{ color: 'inherit', textDecoration: 'underline', fontSize: 12.5, fontWeight: 600 }}
            >
              Undo
            </button>
          )}
          <button onClick={() => onDismiss(t.id)} title="Dismiss" style={{ color: 'inherit', opacity: .7 }}>
            <IClose size={13} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
