'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BellRing, Check, Loader, ShieldAlert } from 'lucide-react';
import { Alert, Badge, Button, Card, Label, PanelHead } from '@/components/kit/primitives';
import { Field, Modal, TextArea } from '@/components/kit/forms';
import {
  HEALTH_BLURB, HEALTH_LABEL, HEALTH_TONE, chaseWords, type Health,
} from '@/lib/crm/health';
import type { CRMContact } from '@/lib/types';

/* =============================================================
   Red, amber, green on a customer record.

   From the business:

     Red Amber Green system needs adding to CRM drawer to add
     complaints/slowness. When marked Amber - potential issue,
     slowness/etc. Add a button to alert the account manager(s) manually
     with the reason. Red would alert them automatically.

   ---- Why amber asks and red tells ----

   Because that is the difference between the two, and it is the whole
   design. Amber is somebody noticing something: often the person
   noticing is the person who will deal with it, and a notification to
   the account manager every time a rep thinks a job is running slow is
   a notification people learn to ignore within a fortnight. So amber
   opens the record and waits for a button.

   Red is a complaint. Nobody sits on a complaint, and the person who
   takes the call is frequently not the person who owns the
   relationship. It goes out the moment it is set.

   ---- Why the reason is required ----

   "Amber" on its own is a colour. On the Monday meeting screen it reads
   as a row somebody has to go and ask about, which is the meeting this
   was supposed to shorten. The database refuses a level without one,
   and so does this, so the refusal arrives before the press rather than
   after it.
   ============================================================= */

type Event = {
  id: string;
  level: 'amber' | 'red';
  reason: string;
  raised_at: string;
  alerted_at: string | null;
  alert_count: number;
  chased_at: string | null;
  chase_count: number;
  resolved_at: string | null;
};

export function HealthPanel({ contact, canFlag, onChanged }: {
  contact: CRMContact;
  /** `crm.health`. Everything here is read only without it. */
  canFlag: boolean;
  /** So the record above can redraw its badge without a reload. */
  onChanged: (level: Health, reason: string | null) => void;
}) {
  const level = ((contact as unknown as { health?: Health }).health ?? 'green') as Health;
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  /* The one modal this panel opens: picking a level needs a reason, and
     alerting needs an optional note. One shape, two purposes, so the
     screen is never waiting on two answers. */
  const [asking, setAsking] = useState<null | { kind: 'set'; level: Health } | { kind: 'alert' }>(null);
  const [text, setText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/crm/health?contact=${contact.id}`, { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    setEvents((json.events ?? []) as Event[]);
    setLoading(false);
  }, [contact.id]);
  useEffect(() => { void load(); }, [load]);

  const open = events.find((e) => !e.resolved_at) ?? null;
  const history = events.filter((e) => e.resolved_at);

  async function send(body: Record<string, unknown>, done: string) {
    setBusy(true); setError(null); setSaid(null);
    const res = await fetch('/api/crm/health', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contact_id: contact.id, ...body }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(json.error ?? 'That did not go through.'); return false; }
    setSaid(typeof json.told === 'number'
      ? `${done} ${json.told === 0 ? 'Nobody else looks after this account, so nobody was told.'
        : `${json.told} ${json.told === 1 ? 'person' : 'people'} told.`}`
      : done);
    await load();
    return true;
  }

  async function choose(next: Health) {
    if (next === 'green') {
      /* Going green does not need a reason. It needs one LESS than the
         others: the reason it was amber is already on the record and
         closing it is the good news. A note is welcome and optional. */
      setAsking({ kind: 'set', level: 'green' });
      setText('');
      return;
    }
    setAsking({ kind: 'set', level: next });
    setText(open?.reason ?? '');
  }

  return (
    <>
      <Card padded={false}>
        <PanelHead
          title="Where this account stands"
          hint={open ? undefined : 'Nothing outstanding'}
          action={open && canFlag ? (
            <Button size="sm" variant={open.level === 'red' ? 'primary' : 'secondary'}
              disabled={busy}
              onClick={() => { setAsking({ kind: 'alert' }); setText(''); }}>
              <BellRing size={12} /> Alert the account manager
            </Button>
          ) : undefined}
        />

        <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && <Alert tone="danger">{error}</Alert>}
          {said && <Alert tone="success">{said}</Alert>}

          {/* THE THREE, AS BUTTONS RATHER THAN A DROPDOWN.

              A dropdown hides two of the three, and the choice is a
              four second judgement made while somebody is on the phone.
              Each carries the definition under it, because the
              difference between amber and red is the only thing anybody
              ever gets wrong and a help page is not where they will
              read it. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {(['green', 'amber', 'red'] as Health[]).map((l) => {
              const on = level === l;
              return (
                <button
                  key={l}
                  type="button"
                  disabled={!canFlag || busy}
                  onClick={() => choose(l)}
                  aria-pressed={on}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4,
                    padding: '9px 10px', borderRadius: 'var(--r)', textAlign: 'left',
                    border: `1px solid ${on ? `var(--${HEALTH_TONE[l]})` : 'var(--border)'}`,
                    background: on
                      ? `color-mix(in srgb, var(--${HEALTH_TONE[l]}) 12%, transparent)`
                      : 'var(--surface)',
                    cursor: canFlag && !busy ? 'pointer' : 'default',
                    opacity: canFlag ? 1 : 0.7,
                    fontFamily: 'var(--inter)',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      width: 9, height: 9, borderRadius: 'var(--r-full)',
                      background: `var(--${HEALTH_TONE[l]})`,
                    }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                      {HEALTH_LABEL[l]}
                    </span>
                  </span>
                  <span style={{ fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.35 }}>
                    {HEALTH_BLURB[l]}
                  </span>
                </button>
              );
            })}
          </div>

          {!canFlag && (
            <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
              You can see where this account stands. Flagging one needs the customer health
              permission, which an administrator grants.
            </div>
          )}

          {loading ? (
            <div style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5, color: 'var(--text-subtle)' }}>
              <Loader size={12} className="spin" /> Loading
            </div>
          ) : open ? (
            <div style={{
              padding: '10px 12px', borderRadius: 'var(--r)',
              background: 'var(--surface-sunken)', border: '1px solid var(--border)',
              borderLeft: `2px solid var(--${HEALTH_TONE[open.level]})`,
              display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {open.level === 'red'
                  ? <ShieldAlert size={14} style={{ color: 'var(--danger)' }} />
                  : <AlertTriangle size={14} style={{ color: 'var(--warning)' }} />}
                <Badge tone={HEALTH_TONE[open.level]} dot>{HEALTH_LABEL[open.level]}</Badge>
                <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                  since {new Date(open.raised_at).toLocaleDateString('en-GB', {
                    day: 'numeric', month: 'short', year: '2-digit',
                  })}
                </span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>{open.reason}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.5 }}>
                {open.alert_count === 0
                  ? 'Nobody has been alerted yet.'
                  : `Alerted ${open.alert_count} time${open.alert_count === 1 ? '' : 's'}.`}
                {open.chase_count > 0 && ` Chased ${open.chase_count} time${open.chase_count === 1 ? '' : 's'}.`}
                {' '}
                {chaseWords(open.level, workingDaysApprox(open.chased_at ?? open.raised_at))}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>
              Nothing open on this account.
              {history.length > 0 && ` ${history.length} closed before.`}
            </div>
          )}

          {/* What has happened before. Short: the meeting cares about
              what is open, and the history is here for the question
              "has this happened with them before", which is a yes or no
              and a date. */}
          {history.length > 0 && (
            <div>
              <Label>Previously</Label>
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {history.slice(0, 4).map((e) => (
                  <div key={e.id} style={{
                    display: 'flex', alignItems: 'baseline', gap: 8,
                    fontSize: 12, color: 'var(--text-subtle)',
                  }}>
                    <Check size={11} style={{ color: 'var(--success)', flex: 'none' }} />
                    <span style={{ color: 'var(--text-muted)' }}>{HEALTH_LABEL[e.level]}</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.reason}
                    </span>
                    <span>{new Date(e.resolved_at!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {asking && (
        <Modal
          width={480}
          title={asking.kind === 'alert'
            ? 'Alert the account manager'
            : asking.level === 'green'
              ? 'Close this off'
              : `Mark ${contact.company_name} ${HEALTH_LABEL[asking.level].toLowerCase()}`}
          description={asking.kind === 'alert'
            ? 'They get a notification with the reason. Add anything they should know first.'
            : asking.level === 'red'
              ? 'Whoever looks after this account is told straight away.'
              : asking.level === 'amber'
                ? 'Nobody is told yet. Use Alert when you want them to know.'
                : 'The reason stays on the record as history.'}
          onClose={() => setAsking(null)}
          footer={<>
            <Button size="sm" variant="ghost" onClick={() => setAsking(null)}>Cancel</Button>
            <Button
              size="sm"
              variant={asking.kind === 'set' && asking.level === 'red' ? 'primary' : 'primary'}
              disabled={busy || (asking.kind === 'set' && asking.level !== 'green' && !text.trim())}
              onClick={async () => {
                const ok = asking.kind === 'alert'
                  ? await send({ alert: true, note: text.trim() || null }, 'Alert sent.')
                  : await send(
                    { level: asking.level, reason: text.trim() || null },
                    asking.level === 'green' ? 'Closed off.' : `Marked ${HEALTH_LABEL[asking.level].toLowerCase()}.`,
                  );
                if (ok) {
                  setAsking(null);
                  if (asking.kind === 'set') {
                    onChanged(asking.level, asking.level === 'green' ? null : text.trim());
                  }
                }
              }}
            >
              {busy ? <Loader size={13} className="spin" /> : <BellRing size={13} />}
              {asking.kind === 'alert' ? 'Send the alert' : 'Save'}
            </Button>
          </>}
        >
          <Field
            label={asking.kind === 'alert' ? 'Anything to add' : 'What is the problem?'}
            hint={asking.kind === 'set' && asking.level !== 'green'
              ? 'Required. A colour with no reason tells the next person nothing.'
              : 'Optional.'}
          >
            <TextArea rows={3} value={text} onChange={setText}
              placeholder={asking.kind === 'alert'
                ? 'Rang again this morning, still no date for the parts'
                : 'Two services missed, transport manager has complained twice'} />
          </Field>
        </Modal>
      )}
    </>
  );
}

/**
 * Roughly how many working days it has been, for the line that says
 * when a chase is due.
 *
 * Roughly on purpose. The database decides whether a chase actually
 * goes out, using the bank holiday table; this is a sentence on a
 * drawer telling somebody what is about to happen, and shipping the
 * whole holiday list to the browser to be one day more precise about
 * the word "tomorrow" is not a trade worth making.
 */
function workingDaysApprox(from: string): number {
  const start = new Date(from);
  const now = new Date();
  let days = 0;
  const at = new Date(start);
  at.setHours(12, 0, 0, 0);
  at.setDate(at.getDate() + 1);
  const end = new Date(now);
  end.setHours(12, 0, 0, 0);
  while (at <= end) {
    const d = at.getDay();
    if (d !== 0 && d !== 6) days += 1;
    at.setDate(at.getDate() + 1);
  }
  return days;
}
