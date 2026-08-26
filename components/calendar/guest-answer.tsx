'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, CalendarClock, Check, Clock, Send, X,
} from 'lucide-react';
import { dateLabel, durationLabel, timeLabel } from '@/lib/calendar/grid';
import { Alert, Badge, Button, Label } from '@/components/kit/primitives';
import { Field, TextArea, TextInput } from '@/components/kit/forms';

/* =============================================================
   The invitation, as the guest sees it.

   One question, three answers, and nothing else on the screen. This is
   the only page a customer of STC ever opens, so everything that is not
   the meeting or the answer has been left off it: no navigation, no
   sign in, no mention of anything else the business has.

   Everything it knows comes from `/api/invitation`, which is keyed on
   the token in the address and returns the meeting and the organiser's
   name. It never had anything else to show.
   ============================================================= */

type View = {
  ok: boolean;
  why?: 'not_found' | 'cancelled';
  guest?: { name: string; email: string; status: string; respondedAt: string | null };
  meeting?: {
    title: string; detail: string | null;
    startAt: string; endAt: string | null; allDay: boolean;
  };
  organiser?: string;
};

const SAID: Record<string, string> = {
  accepted: 'You said you are coming.',
  declined: 'You said you cannot make it.',
  proposed: 'You suggested another time. It is with them now.',
};

export function GuestAnswer({ token }: { token: string }) {
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [when, setWhen] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    let live = true;
    fetch(`/api/invitation?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((json) => { if (live) setView(json); })
      .catch(() => { if (live) setView({ ok: false, why: 'not_found' }); });
    return () => { live = false; };
  }, [token]);

  const answer = useCallback(async (action: 'accept' | 'decline' | 'propose') => {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/invitation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token, action,
          startAt: action === 'propose' ? when : null,
          note: note.trim() || null,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.message ?? 'That did not go through. Try again in a moment.');
        return;
      }
      setDone(json.said as string);
    } catch {
      setError('That did not reach us. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }, [token, when, note]);

  return (
    <div className="kit" style={{
      minHeight: '100vh', background: 'var(--bg)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '48px 20px',
    }}>
      <div style={{ width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <span style={{
            width: 38, height: 38, borderRadius: 'var(--r)', flex: 'none',
            background: 'var(--bg-subtle)', color: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><CalendarClock size={19} /></span>
          <div>
            <div style={{
              fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 15,
              letterSpacing: '-0.01em', textTransform: 'uppercase', color: 'var(--text)',
            }}>Stockport Truck Centre</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>An invitation</div>
          </div>
        </div>

        {view === null && (
          <Card><span style={{ color: 'var(--text-subtle)', fontSize: 13 }}>One moment.</span></Card>
        )}

        {view && !view.ok && (
          <Card>
            <Label>{view.why === 'cancelled' ? 'This meeting is off' : 'This link does not open'}</Label>
            <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              {view.why === 'cancelled'
                ? 'The meeting this invitation was for is no longer going ahead. There is nothing you need to do.'
                : 'It may have been withdrawn, or the address may have been copied short. Reply to whoever '
                  + 'sent it and they can send you another.'}
            </p>
          </Card>
        )}

        {view?.ok && view.meeting && (
          <>
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', marginBottom: 12 }}>
                <Label>{view.organiser} would like to meet you</Label>
                {view.guest?.respondedAt && view.guest.status !== 'pending' && (
                  <Badge tone={view.guest.status === 'accepted' ? 'success'
                    : view.guest.status === 'declined' ? 'danger' : 'warning'} dot>
                    {view.guest.status === 'accepted' ? 'You are coming'
                      : view.guest.status === 'declined' ? 'You cannot make it'
                        : 'You suggested another time'}
                  </Badge>
                )}
              </div>

              <div style={{
                fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 20,
                letterSpacing: '-0.02em', color: 'var(--text)', lineHeight: 1.25,
              }}>{view.meeting.title}</div>

              <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 6 }}>
                {dateLabel(view.meeting.startAt)}
                {!view.meeting.allDay && `, ${timeLabel(view.meeting.startAt)}`}
                {!view.meeting.allDay && durationLabel(view.meeting.startAt, view.meeting.endAt)
                  ? `, ${durationLabel(view.meeting.startAt, view.meeting.endAt)}`
                  : ''}
                {view.meeting.allDay && ', all day'}
              </div>

              {view.meeting.detail && (
                <p style={{
                  margin: '12px 0 0', fontSize: 13, color: 'var(--text-muted)',
                  lineHeight: 1.55, whiteSpace: 'pre-wrap',
                }}>{view.meeting.detail}</p>
              )}
            </Card>

            {done ? (
              <Alert tone="success">
                <Check size={14} />
                <span>
                  <span style={{ display: 'block', fontWeight: 600, color: 'var(--text)' }}>{done}</span>
                  There is nothing else you need to do. You can close this page.
                </span>
              </Alert>
            ) : (
              <>
                {error && <Alert tone="danger"><AlertTriangle size={13} /> {error}</Alert>}

                {view.guest?.respondedAt && view.guest.status !== 'pending' && (
                  <Alert tone="info">
                    {SAID[view.guest.status] ?? 'You have already answered this.'}
                    {' '}Answering again replaces it.
                  </Alert>
                )}

                <Card>
                  {suggesting ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <Field label="A time that would suit you">
                        <TextInput type="datetime-local" value={when} onChange={setWhen} />
                      </Field>
                      <Field label="Anything to add" hint="Optional.">
                        <TextArea value={note} onChange={setNote} rows={3}
                          placeholder="I am at the depot until eleven." />
                      </Field>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Button variant="accent" disabled={busy || !when}
                          onClick={() => answer('propose')}>
                          <Send size={14} /> Send the suggestion
                        </Button>
                        <Button variant="ghost" onClick={() => setSuggesting(false)}>Back</Button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                      <Label>Can you make it</Label>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <Button variant="accent" disabled={busy} onClick={() => answer('accept')}>
                          <Check size={14} /> Yes, I will be there
                        </Button>
                        <Button variant="secondary" disabled={busy} onClick={() => answer('decline')}>
                          <X size={14} /> No, I cannot
                        </Button>
                        <Button variant="ghost" disabled={busy}
                          onClick={() => { setSuggesting(true); setWhen(localInput(view.meeting!.startAt)); }}>
                          <Clock size={14} /> Suggest another time
                        </Button>
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                        There is nothing to sign in to. Whichever you pick goes straight back to
                        {' '}{view.organiser}.
                      </span>
                    </div>
                  )}
                </Card>
              </>
            )}
          </>
        )}

        <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.6 }}>
          Stockport Truck Centre Limited, Old Moor Road, Bredbury, Stockport, Cheshire SK6 2QE
        </div>
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--r-md)', padding: 18,
    }}>{children}</div>
  );
}

/** What a datetime-local input wants, from an instant. */
function localInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
