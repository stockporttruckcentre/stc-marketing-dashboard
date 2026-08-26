'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CalendarClock, Check, Clock, X } from 'lucide-react';
import type { DiaryEntry } from '@/lib/calendar/diary';
import { dateLabel, relativeDay, timeLabel } from '@/lib/calendar/grid';
import { KIND_LABEL } from '@/lib/calendar/kind';
import { Alert, Badge, Button, Label } from '@/components/kit/primitives';
import { useToast } from '@/components/kit/toast';

/* =============================================================
   The invitations waiting on you, answerable where they sit.

   Three places show a pending invitation and until now only one of
   them could do anything about it.

     the bell        buttons on the card
     the diary       buttons in the drawer, once you have opened it
     Work            a badge saying "Needs your answer", and nothing

   That third one is the case this exists for. Work is where somebody
   looks to answer "what is on me", and an invitation is the most on you
   a thing can be: somebody is waiting. Telling them it needs an answer
   and then making them open another screen to give one is the worst of
   both, because they have already been interrupted.

   ---- Why a strip and not buttons on every row ----

   Two invitations in a list of forty entries is two rows that matter,
   and putting Accept and Decline on all forty to catch them is a list
   nobody can scan. Pulled to the top, they are the first thing read and
   the rest of the list stays a list.

   ---- Change, and why it is a link ----

   Accepting and declining are one call each. Suggesting another time
   needs a time, which needs a date picker, which is the drawer. So the
   third button opens it rather than growing a second date picker here
   that would then have to be kept in step with the first.
   ============================================================= */

export function WaitingOnYou({
  entries, meId, onAnswered,
}: {
  entries: DiaryEntry[];
  /** Whose answer. `needsMyAnswer` is computed for this person too, and
      finding the invitation without checking would pick up somebody
      else's pending row on the same meeting. */
  meId: string;
  /** So the screen behind can re-read once one is answered. */
  onAnswered?: () => void;
}) {
  const router = useRouter();
  const { say } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const waiting = entries.filter((e) => e.needsMyAnswer);

  const answer = useCallback(async (
    entry: DiaryEntry, action: 'accept' | 'decline',
  ) => {
    const mine = entry.attendees.find((a) => a.userId === meId && a.awaited && a.inviteId);
    if (!mine?.inviteId) {
      setFailed('That invitation is missing its reference. Open it in the diary to answer it.');
      return;
    }

    setBusy(entry.event.id);
    setFailed(null);
    try {
      const res = await fetch('/api/calendar/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, inviteId: mine.inviteId }),
      });
      const json = await res.json();
      if (!json.ok) {
        setFailed(json.message ?? 'That did not go through.');
        return;
      }
      say({
        tone: 'success',
        title: action === 'accept' ? 'You are down as coming' : 'They know you cannot make it',
        body: entry.event.title,
      });
      onAnswered?.();
      router.refresh();
    } catch {
      setFailed('That did not reach the server.');
    } finally {
      setBusy(null);
    }
  }, [meId, onAnswered, router, say]);

  if (waiting.length === 0) return null;

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderLeft: '2px solid var(--warning)',
      borderRadius: 'var(--r-md)', overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, minHeight: 34, padding: '0 13px',
        background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
      }}>
        <Label>Waiting on your answer</Label>
        <Badge tone="warning" dot>{waiting.length}</Badge>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
          Somebody has asked you and has not heard back.
        </span>
      </div>

      {failed && (
        <div style={{ padding: '10px 13px 0' }}>
          <Alert tone="danger"><AlertTriangle size={13} /> {failed}</Alert>
        </div>
      )}

      {waiting.map((e) => (
        <div
          key={e.event.id}
          style={{
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            padding: '11px 13px', borderTop: '1px solid var(--border)',
          }}
        >
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{
              fontSize: 13, fontWeight: 600, color: 'var(--text)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{e.event.title}</div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginTop: 2,
              fontSize: 11.5, color: 'var(--text-subtle)', flexWrap: 'wrap',
            }}>
              <span>{KIND_LABEL[e.kind]}</span>
              <span>
                {relativeDay(e.start)}, {e.event.all_day
                  ? 'all day'
                  : timeLabel(e.event.start_at)}
              </span>
              <span>{dateLabel(e.event.start_at)}</span>
              {e.company && <span>{e.company}</span>}
              {e.attendees.length > 1 && (
                <span>{e.attendees.length} on it</span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            <Button
              size="sm" variant="accent"
              disabled={busy === e.event.id}
              onClick={() => answer(e, 'accept')}
            ><Check size={13} /> I can make it</Button>
            <Button
              size="sm" variant="secondary"
              disabled={busy === e.event.id}
              onClick={() => answer(e, 'decline')}
            ><X size={13} /> I cannot</Button>
            <Button
              size="sm" variant="ghost"
              onClick={() => router.push(`/dashboard/calendar?event=${e.event.id}`)}
            ><Clock size={13} /> Suggest another time</Button>
          </div>
        </div>
      ))}

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '9px 13px', borderTop: '1px solid var(--border)',
        background: 'var(--bg-subtle)',
      }}>
        <CalendarClock size={12} style={{ color: 'var(--text-subtle)' }} />
        <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
          Answering here is the same as answering in the diary. Whoever asked is told either way.
        </span>
      </div>
    </div>
  );
}
