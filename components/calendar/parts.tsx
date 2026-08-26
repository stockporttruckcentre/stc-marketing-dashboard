'use client';

import type { CSSProperties, ReactNode } from 'react';
import {
  Building2, Check, CircleHelp, Clock, Phone, ShieldCheck, Truck, Users, X,
} from 'lucide-react';
import type { InviteStatus } from '@/lib/types';
import { KIND_LABEL, KIND_TONE, type EventKind } from '@/lib/calendar/kind';
import { STATUS_LABEL, type DiaryAttendee, type DiaryEntry } from '@/lib/calendar/diary';
import { durationLabel, timeLabel } from '@/lib/calendar/grid';
import { Badge, type Tone } from '@/components/kit/primitives';

/* =============================================================
   The small pieces the calendar and the Work tab's diary both draw.

   Kept here rather than in either screen because the point of the
   diary being one list is that a call looks like a call wherever it is
   read. A second copy of the attendee row would drift from this one the
   first time either screen grew a status.
   ============================================================= */

/** The glyph for each kind. One per kind, everywhere. */
export function KindIcon({ kind, size = 13 }: { kind: EventKind; size?: number }) {
  if (kind === 'call') return <Phone size={size} />;
  if (kind === 'visit') return <Truck size={size} />;
  if (kind === 'inspection') return <ShieldCheck size={size} />;
  if (kind === 'reminder') return <Clock size={size} />;
  if (kind === 'meeting') return <Users size={size} />;
  return <CircleHelp size={size} />;
}

export function KindBadge({ kind }: { kind: EventKind }) {
  return (
    <Badge tone={KIND_TONE[kind]} dot>{KIND_LABEL[kind]}</Badge>
  );
}

const STATUS_TONE: Record<InviteStatus, Tone> = {
  pending: 'neutral',
  accepted: 'success',
  declined: 'danger',
  proposed: 'warning',
};

export function StatusBadge({ status }: { status: InviteStatus }) {
  return <Badge tone={STATUS_TONE[status]} dot>{STATUS_LABEL[status]}</Badge>;
}

/**
 * Somebody's initials in a circle.
 *
 * Deliberately not a colour per person. The kit's rule one says red
 * points at the one thing that matters, and eight people rendered in
 * eight colours is eight things shouting. The ring is the only signal
 * here: solid where they have said yes, dashed where they have not
 * answered, struck through where they cannot come.
 */
export function Avatar({ person, size = 24 }: { person: DiaryAttendee; size?: number }) {
  const initials = person.name
    .split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';

  const border =
    person.status === 'accepted' ? '1px solid var(--success)'
    : person.status === 'declined' ? '1px solid var(--danger)'
    : person.status === 'proposed' ? '1px dashed var(--warning)'
    : person.status === 'pending' ? '1px dashed var(--border-emphasis)'
    : '1px solid var(--border)';

  return (
    <span
      title={`${person.name}${person.status ? `, ${STATUS_LABEL[person.status].toLowerCase()}` : ''}`}
      style={{
        width: size, height: size, borderRadius: 'var(--r-full)', flex: 'none',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-subtle)', border,
        color: person.status === 'declined' ? 'var(--text-subtle)' : 'var(--text-muted)',
        fontFamily: 'var(--panton)', fontWeight: 700, fontSize: size * 0.42,
        textDecoration: person.status === 'declined' ? 'line-through' : 'none',
      }}
    >{initials}</span>
  );
}

/** A row of them, with a count where there are more than fit. */
export function AvatarRow({ people, max = 5 }: { people: DiaryAttendee[]; max?: number }) {
  if (!people.length) return null;
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      {shown.map((p, i) => (
        <span key={p.key} style={{ marginLeft: i === 0 ? 0 : -6, display: 'inline-flex' }}>
          <Avatar person={p} size={22} />
        </span>
      ))}
      {rest > 0 && (
        <span style={{
          marginLeft: 5, fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
          color: 'var(--text-subtle)',
        }}>+{rest}</span>
      )}
    </span>
  );
}

/** Where a meeting stands, in one line, from the invitations on it. */
export function invitationLine(entry: DiaryEntry): string | null {
  const asked = entry.attendees.filter((a) => a.status && !a.organiser);
  if (!asked.length) return null;

  const yes = asked.filter((a) => a.status === 'accepted').length;
  const no = asked.filter((a) => a.status === 'declined').length;
  const maybe = asked.filter((a) => a.status === 'proposed').length;
  const quiet = asked.filter((a) => a.status === 'pending').length;

  const bits: string[] = [];
  if (yes) bits.push(`${yes} coming`);
  if (no) bits.push(`${no} cannot`);
  if (maybe) bits.push(`${maybe} suggested another time`);
  if (quiet) bits.push(`${quiet} yet to answer`);
  return bits.join(', ');
}

/* ---------- one entry, as a row in a list ---------- */

const ROW: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 11,
  padding: '9px 13px', width: '100%', textAlign: 'left',
  background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)',
  cursor: 'pointer',
};

export function DiaryRow({
  entry, onOpen, showDay, trailing,
}: {
  entry: DiaryEntry;
  onOpen: () => void;
  showDay?: string;
  trailing?: ReactNode;
}) {
  const length = durationLabel(entry.event.start_at, entry.event.end_at);

  return (
    <button
      type="button"
      onClick={onOpen}
      style={ROW}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-subtle)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{
        width: 26, height: 26, borderRadius: 'var(--r-sm)', flex: 'none',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-subtle)', color: 'var(--text-muted)',
      }}>
        <KindIcon kind={entry.kind} />
      </span>

      <span style={{
        width: 96, flex: 'none', fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 12,
        fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
      }}>
        {showDay && <span style={{ color: 'var(--text-subtle)', marginRight: 6 }}>{showDay}</span>}
        {entry.event.all_day ? 'All day' : timeLabel(entry.event.start_at)}
      </span>

      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{entry.event.title}</span>
        <span style={{
          display: 'flex', alignItems: 'center', gap: 8, marginTop: 2,
          fontSize: 11.5, color: 'var(--text-subtle)',
        }}>
          <span>{KIND_LABEL[entry.kind]}</span>
          {entry.company && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Building2 size={11} /> {entry.company}
            </span>
          )}
          {length && <span>{length}</span>}
          {invitationLine(entry) && <span>{invitationLine(entry)}</span>}
        </span>
      </span>

      {entry.needsMyAnswer && <Badge tone="warning" dot>Needs your answer</Badge>}
      <AvatarRow people={entry.attendees} />
      {trailing}
    </button>
  );
}

/** The yes and no buttons that appear on an invitation waiting on you. */
export function AnswerButtons({
  onAccept, onDecline, busy,
}: { onAccept: () => void; onDecline: () => void; busy: boolean }) {
  const base: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    height: 26, padding: '0 9px', borderRadius: 'var(--r)',
    fontFamily: 'var(--inter)', fontSize: 12, fontWeight: 600,
    cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1,
  };
  return (
    <span style={{ display: 'inline-flex', gap: 6 }}>
      <button
        type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); onAccept(); }}
        style={{ ...base, background: 'var(--primary)', color: 'var(--primary-fg)', border: '1px solid var(--primary)' }}
      ><Check size={12} /> Coming</button>
      <button
        type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); onDecline(); }}
        style={{ ...base, background: 'var(--surface)', color: 'var(--text-muted)', border: '1px solid var(--border-strong)' }}
      ><X size={12} /> Cannot</button>
    </span>
  );
}
