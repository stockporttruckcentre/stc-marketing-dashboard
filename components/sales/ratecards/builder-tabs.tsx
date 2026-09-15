'use client';

import { useEffect, useState } from 'react';
import { IWarn, ITick, IPlus, IClose } from './icons';
import * as api from '@/lib/ratecards/client';
import { money, shortDate, ago, MISSING_WORDS } from '@/lib/ratecards/format';
import type { FullCard, Rate, ChangeRow } from '@/lib/ratecards/types';

/* =============================================================
   The four tabs beside Rates and FleetSmart+.

   Header and contacts is the one with work in it: it is where the CRM
   pull-through lands, and where anything the CRM could not supply is
   marked required rather than left as a blank line on the customer's
   sheet.
   ============================================================= */

/* -------------------------------------------------------------
   Header and contacts.

   From the business:

     Pull in things like addresses, contacts, phone, email etc where it
     has it in the CRM, if not flag that it's required.

   `rate_card_create` does the pulling. This tab shows what came across,
   lets it be corrected, and marks what is still empty. A field is
   marked required because it prints on the sheet, not because the form
   refuses to save without it: a card is often built before the customer
   has sent their accounts contact over.
   ------------------------------------------------------------- */
const FIELDS: { key: string; label: string; hint: string; wide?: boolean }[] = [
  { key: 'main_contact', label: 'Main contact', hint: 'Who the rates were agreed with.' },
  { key: 'telephone', label: 'Telephone', hint: 'The number on the sheet.' },
  { key: 'email', label: 'Email', hint: 'Where the card is sent.' },
  { key: 'address', label: 'Address', hint: 'From the customer’s primary address in the CRM.', wide: true },
  { key: 'other_detail', label: 'Other', hint: 'Anything else that prints in the header block.', wide: true },
  { key: 'accounts_detail', label: 'Accounts details', hint: 'Who invoices go to, if it is not the main contact.', wide: true },
];

export function HeaderTab({ card, editable, onSave, onManagers }: {
  card: FullCard;
  editable: boolean;
  onSave: (field: string, value: string) => Promise<void>;
  onManagers: (ids: string[]) => Promise<void>;
}) {
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void api.people().then((r) => { if (r.ok) setPeople(r.value); });
  }, []);

  const managers = card.managers;
  const missing = new Set(card.missing);

  return (
    <div className="rc-77">
      {card.missing.length > 0 && (
        <div className="rc-2s">
          <IWarn size={16} />
          <span className="rc-2x">
            {card.missing.map((m) => MISSING_WORDS[m] ?? m).join(', ')}{' '}
            {card.missing.length === 1 ? 'is' : 'are'} empty. The CRM had nothing to fill
            {card.missing.length === 1 ? ' it' : ' them'} in with, and
            {card.missing.length === 1 ? ' it prints' : ' they print'} blank on the customer&rsquo;s sheet.
          </span>
        </div>
      )}

      <div className="rc-3o" style={{ padding: '14px 16px' }}>
        <div className="rc-5q">
          {FIELDS.filter((f) => !f.wide).map((f) => (
            <DetailField
              key={f.key} field={f} editable={editable}
              value={(card.card as unknown as Record<string, string | null>)[f.key] ?? ''}
              required={missing.has(f.key as never)}
              onSave={onSave}
            />
          ))}
        </div>
        {FIELDS.filter((f) => f.wide).map((f) => (
          <DetailField
            key={f.key} field={f} editable={editable}
            value={(card.card as unknown as Record<string, string | null>)[f.key] ?? ''}
            required={missing.has(f.key as never)}
            onSave={onSave}
          />
        ))}

        {/* ---- Account manager ----

            From the business: "this should auto populate based on the
            account owner in the crm but let the user override this or
            add additional." So the one that came from the CRM says so,
            and more can be added beside it. */}
        <div className="rc-28">
          <span className="rc-z">
            Account manager
            {missing.has('account_manager' as never) && <span className="rc-3j"> *</span>}
          </span>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>
            {managers.length === 0 && (
              <span className="rc-y">
                Nobody yet. The CRM had no account owner for this customer that matches a person here.
              </span>
            )}
            {managers.map((m) => (
              <span key={m.user_id} className="rc-1g">
                {m.name}
                {m.from_crm && <span className="rc-12" title="Filled in from the CRM account owner">from the CRM</span>}
                {editable && (
                  <button
                    title={`Remove ${m.name}`}
                    onClick={() => { void onManagers(managers.filter((x) => x.user_id !== m.user_id).map((x) => x.user_id)); }}
                    style={{ marginLeft: 6, display: 'inline-flex' }}
                  >
                    <IClose size={11} />
                  </button>
                )}
              </span>
            ))}
            {editable && !adding && (
              <button className="rc-3h" onClick={() => setAdding(true)} title="Add another account manager">
                <IPlus /><span>Add</span>
              </button>
            )}
          </div>

          {adding && (
            <div className="rc-29" style={{ maxWidth: 320 }}>
              <select
                className="rc-1b"
                aria-label="Add an account manager"
                defaultValue=""
                style={{ width: '100%' }}
                onChange={(e) => {
                  const id = e.target.value;
                  setAdding(false);
                  if (!id) return;
                  void onManagers([...managers.map((m) => m.user_id), id]);
                }}
              >
                <option value="">Pick somebody</option>
                {people
                  .filter((p) => !managers.some((m) => m.user_id === p.id))
                  .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          <span className="rc-y">
            Whoever is here is told when this card is eleven months old and wants looking at.
          </span>
        </div>
      </div>
    </div>
  );
}

function DetailField({ field, value, editable, required, onSave }: {
  field: { key: string; label: string; hint: string; wide?: boolean };
  value: string;
  editable: boolean;
  required: boolean;
  onSave: (field: string, value: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setDraft(value); }, [value]);

  /* Autosave on blur, per the pack. A save button is never the only way
     to persist, and here there is no save button at all. */
  const commit = async () => {
    if (draft.trim() === (value ?? '').trim()) return;
    await onSave(field.key, draft);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };

  return (
    <div className="rc-28">
      <span className="rc-z">
        {field.label}
        {required && <span className="rc-3j"> *</span>}
        {saved && <span className="rc-12"><ITick size={11} /> saved</span>}
      </span>
      <div className="rc-29">
        <input
          className="rc-1b"
          value={draft}
          disabled={!editable}
          aria-label={field.label}
          placeholder={required ? 'Required, and empty' : ''}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { void commit(); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
      </div>
      <span className="rc-y">{field.hint}</span>
    </div>
  );
}

/* -------------------------------------------------------------
   Parts and markup. Three rows, and both columns are a percentage or a
   pound plus a percentage rather than a price, which is why they are
   their own tab rather than rows in the rate table.
   ------------------------------------------------------------- */
export function PartsTab({ parts }: { parts: Rate[] }) {
  return (
    <div className="rc-77">
      <div className="rc-2s">
        <span className="rc-2t">
          Parts are marked up rather than priced, so these print as the words the master workbook
          uses. The percentage itself is agreed per customer and typed here.
        </span>
      </div>
      <div className="rc-2u">
        <div className="rc-5g">
          <div className="rc-5h">PARTS</div>
          <div className="rc-3l">SUPPLIED BY CUSTOMER</div>
          <div className="rc-5i">SUPPLIED BY STC</div>
        </div>
        {parts.length === 0 && (
          <div style={{ padding: '18px 14px' }}>
            <span className="rc-y">No parts rows on this card.</span>
          </div>
        )}
        {parts.map((p) => (
          <div className="rc-5j" key={`${p.rate_id}-${p.axle}`}>
            <div className="rc-13">{p.item}</div>
            <div className="rc-k"><span className="rc-2">{p.text_value ?? money(p.price) ?? '%'}</span></div>
            <div className="rc-14"><span className="rc-2">{p.text_value ?? '£ + %'}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------
   Invoicing and authority, which is the block at the foot of the
   master workbook and prints on every card.
   ------------------------------------------------------------- */
export function InstructionsTab({ card }: { card: FullCard }) {
  return (
    <div className="rc-77">
      <div className="rc-3o" style={{ padding: '14px 16px' }}>
        <div className="rc-1m">
          <span className="rc-17">INVOICING &amp; AUTHORITY INSTRUCTION AND CONTACT</span>
          <span className="rc-2k">
            {card.card.accounts_detail || 'Nothing set, so this prints blank.'}
          </span>
        </div>
        <div className="rc-2s">
          <span className="rc-2t">
            All work MUST be authorised prior to commencement.
          </span>
        </div>
        <span className="rc-y">
          This line is on the master workbook and prints on every card. It is not editable here
          because it is a standing instruction rather than something agreed per customer.
        </span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------
   History. Ported from `rate-history.html`.

   Every row on this screen came out of `rate_card_changes`, which
   nothing can edit and nothing can delete. That is the point of it.
   ------------------------------------------------------------- */
export function HistoryTab({ changes }: { changes: ChangeRow[] }) {
  return (
    <div className="rc-77">
      <div className="rc-2s">
        <span className="rc-2t">
          Every change to this card, permanently. Nothing on this list can be edited or removed by
          anybody, including whoever made it.
        </span>
      </div>

      {changes.length === 0 && (
        <div style={{ padding: '18px 16px' }}>
          <span className="rc-y">Nothing has happened to this card yet.</span>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {changes.map((ch) => (
          <div
            key={ch.id}
            style={{
              display: 'grid', gridTemplateColumns: '150px 1fr 200px 150px',
              gap: 12, alignItems: 'baseline', padding: '9px 16px',
              borderTop: '1px solid var(--border)', fontSize: 13,
            }}
          >
            <span style={{ color: 'var(--text-subtle)', fontSize: 12 }}>
              {new Date(ch.at).toLocaleString('en-GB', {
                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
              })}
            </span>
            <span>
              {ch.what}
              {ch.rows_moved > 1 && (
                <span className="rc-12">{ch.rows_moved} rows moved</span>
              )}
            </span>
            <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
              {ch.was !== null && ch.now_is !== null
                ? <>{ch.was} &rarr; <strong>{ch.now_is}</strong></>
                : ch.now_is ?? ch.was ?? ''}
            </span>
            <span style={{ color: 'var(--text-subtle)' }}>
              {ch.actor_name ?? 'System'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
