'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Check, RotateCcw, Save } from 'lucide-react';
import {
  ASSET_TYPES, SHIPPED_CARD, cardFrom, whatChanged,
  type AssetClass, type AssetType, type RateCard,
} from '@/lib/fleetsmart/ratecard';
import { priceContract } from '@/lib/fleetsmart/price';
import { blankContract } from '@/lib/fleetsmart/contract';
import { Alert, Badge, Button, Label, PanelHead } from '@/components/kit/primitives';
import { Field, Split, TextInput } from '@/components/kit/forms';

/* =============================================================
   The rate card, edited here rather than in a deploy.

   From the business: "you can update all the default rates that the
   fleetsmart+ builder is using which avoids me having to import a new
   rate card down the line".

   ---- What it is safe to change ----

   Prices. Not the structure.

   The lines, the frequency codes and which plan covers what are not
   edited here, and that is a decision rather than an omission. A
   frequency code is read by the engine, so an invented one prices at
   nothing; a line removed from a plan's inclusion list changes what the
   contract wording claims is covered. Both are code changes with checks
   behind them. What moves in the real world is what a brake test costs,
   and that is every field on this screen.

   ---- Nothing is saved until it is saved ----

   Every edit is local until Save. The figure at the top recomputes on
   every keystroke against a worked example, so the effect of a change is
   visible before it is committed rather than discovered on the next
   contract somebody builds.

   ---- And it never touches a contract already priced ----

   Said on the screen, not only in the migration, because it is the
   question anybody putting prices up will have.
   ============================================================= */

const CLASSES: AssetClass[] = ['Vehicle', 'Trailer', 'Van'];

/** A fleet to price the card against, so a change has a visible effect. */
function worked(card: RateCard) {
  const base = blankContract();
  const input = {
    ...base,
    plan: 'Platinum' as const,
    assets: ASSET_TYPES.map((a, i) => ({
      ...base.assets[0],
      key: `x${i}`,
      reg: `EXAMPLE ${i + 1}`,
      type: a.type,
      age: 4,
      mileagePerYear: 60_000,
    })),
  };
  return priceContract(input, card);
}

const money = (n: number) =>
  n.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 });

export function RateEditor({
  current, versions, may, onSaved,
}: {
  /** What the builder is pricing off right now. */
  current: RateCard;
  /** Every version saved, newest first. Empty on an installation that
      has never edited the shipped card. */
  versions: { version: string; note: string | null; is_current: boolean; created_at: string }[];
  may: (c: string) => boolean;
  onSaved: (message: string) => void;
}) {
  const [card, setCard] = useState<RateCard>(current);
  const [version, setVersion] = useState(() => nextVersionName(current.version));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = may('fleetsmart.discount');
  const changes = useMemo(() => whatChanged(current, card), [current, card]);
  const example = useMemo(() => worked(card), [card]);
  const exampleNow = useMemo(() => worked(current), [current]);
  const difference = example.annual - exampleNow.annual;

  function setRate(cls: AssetClass, line: string, axle: number, value: number) {
    setCard((c) => ({
      ...c,
      rates: c.rates.map((r) => (r.cls === cls && r.line === line
        ? { ...r, axle: r.axle.map((a, i) => (i === axle ? value : a)) as typeof r.axle }
        : r)),
    }));
  }

  async function save() {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/fleetsmart/rate-card', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version, card }),
      });
      const json = await res.json();
      if (!json.ok) { setError(json.message ?? 'That did not save.'); return; }
      onSaved(`Rate card ${version} is now what the builder prices off. `
        + `${changes.length} change${changes.length === 1 ? '' : 's'}.`);
    } catch {
      setError('That did not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function goBackTo(v: string) {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/fleetsmart/rate-card', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: v }),
      });
      const json = await res.json();
      if (!json.ok) { setError(json.message ?? 'That did not go back.'); return; }
      onSaved(`Back on rate card ${v}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div style={{
        border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
        background: 'var(--surface)', overflow: 'hidden',
      }}>
        <PanelHead
          title="Rate editor"
          hint={`pricing off ${current.version}`}
          action={
            <>
              <Badge tone={changes.length ? 'warning' : 'neutral'} dot>
                {changes.length === 0 ? 'No changes' : `${changes.length} unsaved`}
              </Badge>
              {canEdit && changes.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setCard(current)}>
                  <RotateCcw size={13} /> Undo them
                </Button>
              )}
            </>
          }
        />
        <p style={{
          margin: 0, padding: '11px 14px', fontFamily: 'var(--inter)',
          fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-muted)',
        }}>
          Changing a figure here changes what the next contract costs and nothing at all about one
          already sent. Every contract keeps the prices it was built at, because the document in the
          customer&apos;s drawer and the document on the screen have to agree.
        </p>
      </div>

      {!canEdit && (
        <Alert tone="info">
          You can read the rate card but not change it. Setting prices is a separate permission
          from building a contract, so an administrator has to grant it.
        </Alert>
      )}

      {error && <Alert tone="danger"><AlertTriangle size={13} /> {error}</Alert>}

      {/* ---- what the change actually does ---- */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap',
        padding: '13px 15px', background: 'var(--bg-subtle)',
        border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
      }}>
        <div>
          <Label>A worked example</Label>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>
            Platinum, one of each asset type, four years old, 60,000 miles a year
          </div>
        </div>
        <span style={{ flex: 1 }} />
        <Figure label="Now" value={money(exampleNow.annual)} />
        <Figure label="With your changes" value={money(example.annual)} strong />
        <Figure
          label="Difference"
          value={`${difference >= 0 ? '+' : ''}${money(difference)}`}
          tone={difference === 0 ? undefined : difference > 0 ? 'up' : 'down'}
        />
      </div>

      {/* ---- the rates, per class ---- */}
      {CLASSES.map((cls) => (
        <div key={cls}>
          <Label>{cls} rates</Label>
          <div style={{
            overflowX: 'auto', border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)', background: 'var(--surface)',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={TH}>Line</th>
                  <th style={{ ...TH, textAlign: 'right' }}>1 axle</th>
                  <th style={{ ...TH, textAlign: 'right' }}>2 axle</th>
                  <th style={{ ...TH, textAlign: 'right' }}>3 axle</th>
                  <th style={{ ...TH, textAlign: 'right' }}>4 axle</th>
                  <th style={TH}>How often</th>
                </tr>
              </thead>
              <tbody>
                {card.rates.filter((r) => r.cls === cls).map((r) => (
                  <tr key={r.line}>
                    <td style={TD}>{r.line}</td>
                    {r.axle.map((value, i) => (
                      <td key={i} style={{ ...TD, padding: '3px 6px', width: 92 }}>
                        <input
                          type="number"
                          step="0.01"
                          value={value}
                          disabled={!canEdit}
                          onChange={(e) => setRate(cls, r.line, i, Number(e.target.value) || 0)}
                          style={{
                            width: '100%', height: 26, padding: '0 7px', textAlign: 'right',
                            background: value === 0 ? 'var(--bg-subtle)' : 'var(--surface)',
                            color: value === 0 ? 'var(--text-subtle)' : 'var(--text)',
                            border: '1px solid var(--border)', borderRadius: 'var(--r)',
                            fontFamily: 'var(--inter)', fontSize: 12,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        />
                      </td>
                    ))}
                    <td style={{ ...TD, fontSize: 11.5, color: 'var(--text-subtle)' }}>
                      {FREQ_WORDS[r.freq] ?? r.freq}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{
            margin: '5px 0 0', fontFamily: 'var(--inter)', fontSize: 11.5,
            color: 'var(--text-subtle)',
          }}>
            A zero means the line does not apply to that axle count on this class. It is not a
            missing price, and the workbook says the same thing on its own Rates tab.
          </p>
        </div>
      ))}

      {/* ---- the per asset type figures ---- */}
      <Label>Per asset type</Label>
      <div style={{
        overflowX: 'auto', border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)', background: 'var(--surface)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
          <thead>
            <tr>
              <th style={TH}>Asset type</th>
              <th style={{ ...TH, textAlign: 'right' }}>Service kit, per C</th>
              <th style={{ ...TH, textAlign: 'right' }}>Oil, litres per C</th>
              <th style={{ ...TH, textAlign: 'right' }}>Wear and tear base</th>
            </tr>
          </thead>
          <tbody>
            {ASSET_TYPES.map(({ type }) => (
              <tr key={type}>
                <td style={TD}>{type}</td>
                <NumberCell
                  value={card.serviceKit[type as AssetType]}
                  disabled={!canEdit}
                  onChange={(v) => setCard((c) => ({ ...c, serviceKit: { ...c.serviceKit, [type]: v } }))}
                />
                <NumberCell
                  value={card.oilLitres[type as AssetType]}
                  disabled={!canEdit}
                  onChange={(v) => setCard((c) => ({ ...c, oilLitres: { ...c.oilLitres, [type]: v } }))}
                />
                <NumberCell
                  value={card.wearAndTearBase[type as AssetType]}
                  disabled={!canEdit}
                  onChange={(v) => setCard((c) => ({ ...c, wearAndTearBase: { ...c.wearAndTearBase, [type]: v } }))}
                />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---- the engine settings ---- */}
      <Label>Everything else</Label>
      <Split cols={3}>
        <Field label="Engine oil, per litre">
          <TextInput
            type="number" readOnly={!canEdit}
            value={String(card.settings.oilPerLitre)}
            onChange={(v) => setCard((c) => ({ ...c, settings: { ...c.settings, oilPerLitre: Number(v) || 0 } }))}
          />
        </Field>
        <Field label="Silver portal, a year">
          <TextInput
            type="number" readOnly={!canEdit}
            value={String(card.silverPortalPerYear)}
            onChange={(v) => setCard((c) => ({ ...c, silverPortalPerYear: Number(v) || 0 }))}
          />
        </Field>
        <Field label="Out of hours uplift" hint="0.05 is five per cent.">
          <TextInput
            type="number" readOnly={!canEdit}
            value={String(card.settings.outOfHoursUplift)}
            onChange={(v) => setCard((c) => ({ ...c, settings: { ...c.settings, outOfHoursUplift: Number(v) || 0 } }))}
          />
        </Field>
      </Split>
      <Split cols={3}>
        <Field label="Wear and tear uplift, per year" hint="0.03 is three per cent a year over the start age.">
          <TextInput
            type="number" readOnly={!canEdit}
            value={String(card.settings.wearUpliftPerYear)}
            onChange={(v) => setCard((c) => ({ ...c, settings: { ...c.settings, wearUpliftPerYear: Number(v) || 0 } }))}
          />
        </Field>
        <Field label="That uplift starts at" hint="Years.">
          <TextInput
            type="number" readOnly={!canEdit}
            value={String(card.settings.wearUpliftStartYear)}
            onChange={(v) => setCard((c) => ({ ...c, settings: { ...c.settings, wearUpliftStartYear: Number(v) || 0 } }))}
          />
        </Field>
        <Field label="Mileage counting as a year" hint="Miles a year at which one year on the clock counts as one year of ageing.">
          <TextInput
            type="number" readOnly={!canEdit}
            value={String(card.settings.wearMileageBaseline)}
            onChange={(v) => setCard((c) => ({ ...c, settings: { ...c.settings, wearMileageBaseline: Number(v) || 0 } }))}
          />
        </Field>
      </Split>

      <Label>Labour rates a new contract opens with</Label>
      <Split cols={3}>
        <Field label="HGV, per hour">
          <TextInput
            type="number" readOnly={!canEdit}
            value={String(card.defaultLabour.hgv)}
            onChange={(v) => setCard((c) => ({ ...c, defaultLabour: { ...c.defaultLabour, hgv: Number(v) || 0 } }))}
          />
        </Field>
        <Field label="Trailer, per hour">
          <TextInput
            type="number" readOnly={!canEdit}
            value={String(card.defaultLabour.trailer)}
            onChange={(v) => setCard((c) => ({ ...c, defaultLabour: { ...c.defaultLabour, trailer: Number(v) || 0 } }))}
          />
        </Field>
        <Field label="Van, per hour">
          <TextInput
            type="number" readOnly={!canEdit}
            value={String(card.defaultLabour.van)}
            onChange={(v) => setCard((c) => ({ ...c, defaultLabour: { ...c.defaultLabour, van: Number(v) || 0 } }))}
          />
        </Field>
      </Split>

      {/* ---- saving ---- */}
      {canEdit && (
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap',
          padding: '13px 15px', background: 'var(--surface)',
          border: '1px solid var(--border-strong)', borderRadius: 'var(--r-md)',
        }}>
          <div style={{ width: 190 }}>
            <Field label="Call this version" hint="A date is what these are usually called.">
              <TextInput value={version} onChange={setVersion} />
            </Field>
          </div>
          <Button
            size="md" variant="primary"
            disabled={busy || changes.length === 0 || !version.trim()}
            onClick={save}
          >
            <Save size={14} /> {busy ? 'Saving' : `Save ${changes.length} change${changes.length === 1 ? '' : 's'}`}
          </Button>
          <span style={{
            flex: 1, minWidth: 220, fontFamily: 'var(--inter)', fontSize: 11.5,
            color: 'var(--text-subtle)',
          }}>
            {changes.length === 0
              ? 'Change a figure above and this will say what it did.'
              : changes.slice(0, 3).join('. ') + (changes.length > 3 ? `. And ${changes.length - 3} more.` : '.')}
          </span>
        </div>
      )}

      {/* ---- what has been saved before ---- */}
      {versions.length > 0 && (
        <>
          <Label>Every version</Label>
          <div style={{
            border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
            background: 'var(--surface)', overflow: 'hidden',
          }}>
            {versions.map((v) => (
              <div key={v.version} style={{
                display: 'flex', alignItems: 'center', gap: 11,
                padding: '10px 13px', borderBottom: '1px solid var(--border)',
              }}>
                <span style={{
                  fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 13,
                  color: 'var(--text)', width: 96, flex: 'none',
                }}>{v.version}</span>
                {v.is_current
                  ? <Badge tone="success" dot>In use</Badge>
                  : <span style={{ width: 62, flex: 'none' }} />}
                <span style={{
                  flex: 1, minWidth: 0, fontFamily: 'var(--inter)', fontSize: 12,
                  color: 'var(--text-muted)',
                }}>{v.note ?? 'No note.'}</span>
                {!v.is_current && canEdit && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => goBackTo(v.version)}>
                    <Check size={13} /> Use this one
                  </Button>
                )}
              </div>
            ))}
          </div>
          <p style={{
            margin: '5px 0 0', fontFamily: 'var(--inter)', fontSize: 11.5,
            color: 'var(--text-subtle)',
          }}>
            Nothing is edited in place, so what was charged in March can still be read in October.
            Going back to an older card changes what the next contract costs and nothing about one
            already sent.
          </p>
        </>
      )}
    </>
  );
}

/* ---------------- bits ---------------- */

const TH: React.CSSProperties = {
  textAlign: 'left', padding: '0 10px', height: 30,
  background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
  fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
  letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-subtle)',
  whiteSpace: 'nowrap',
};
const TD: React.CSSProperties = {
  padding: '0 10px', height: 34, borderBottom: '1px solid var(--border)',
  fontFamily: 'var(--inter)', fontSize: 12.5, color: 'var(--text-muted)',
};

const FREQ_WORDS: Record<string, string> = {
  '1': 'Once a year',
  T: 'Every inspection',
  A: 'Every A service',
  Bc: 'Never, B is not offered',
  Cc: 'Every C service',
  BK: 'Every brake test',
  LD: 'Every laden RBT',
  '12': 'Monthly',
  BC: 'B and C services',
};

function NumberCell({ value, disabled, onChange }: {
  value: number; disabled: boolean; onChange: (v: number) => void;
}) {
  return (
    <td style={{ ...TD, padding: '3px 6px', width: 130 }}>
      <input
        type="number"
        step="0.01"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        style={{
          width: '100%', height: 26, padding: '0 7px', textAlign: 'right',
          background: value === 0 ? 'var(--bg-subtle)' : 'var(--surface)',
          color: value === 0 ? 'var(--text-subtle)' : 'var(--text)',
          border: '1px solid var(--border)', borderRadius: 'var(--r)',
          fontFamily: 'var(--inter)', fontSize: 12, fontVariantNumeric: 'tabular-nums',
        }}
      />
    </td>
  );
}

function Figure({ label, value, strong, tone }: {
  label: string; value: string; strong?: boolean; tone?: 'up' | 'down';
}) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{
        fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
        letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-subtle)',
      }}>{label}</div>
      <div style={{
        fontFamily: 'var(--panton)', fontWeight: strong ? 800 : 700,
        fontSize: strong ? 18 : 15, letterSpacing: '-0.02em',
        fontVariantNumeric: 'tabular-nums',
        color: tone === 'up' ? 'var(--warning, #B7791F)'
          : tone === 'down' ? 'var(--success, #2F855A)' : 'var(--text)',
      }}>{value}</div>
    </div>
  );
}

/**
 * The name to suggest for the next version.
 *
 * A month on from the one in use where it looks like a date, so the
 * common case is pressing Save. Anything else is left for somebody to
 * type, because guessing at a naming scheme nobody described is how a
 * list of versions stops meaning anything.
 */
function nextVersionName(current: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(current.trim());
  const now = new Date();
  if (!match) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  return `${next.y}-${String(next.m).padStart(2, '0')}`;
}

export { SHIPPED_CARD, cardFrom };
