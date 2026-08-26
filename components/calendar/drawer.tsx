'use client';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Building2, CalendarClock, Check, Clock, Globe2, Lock, Mail, MessageSquare,
  Pencil, Plus, Search, Send, Trash2, UserPlus, Users, X,
} from 'lucide-react';
import type { CalendarEvent, CalendarEventAttendee, CalendarVisibility } from '@/lib/types';
import { EVENT_COLOURS } from '@/lib/calendar/wire';
import {
  attendeesOf, type DiaryAttendee, type DiaryInvite, type DiaryPerson,
} from '@/lib/calendar/diary';
import { dateLabel, durationLabel, timeLabel } from '@/lib/calendar/grid';
import { eventKind, KIND_LABEL } from '@/lib/calendar/kind';
import {
  Alert, Badge, Button, IconButton, Label, SearchInput,
} from '@/components/kit/primitives';
import {
  Checkbox, Drawer, Field, Select, Split, TextArea, TextInput,
} from '@/components/kit/forms';
import { AnswerButtons, Avatar, KindBadge, StatusBadge } from './parts';

/* =============================================================
   One entry in the diary, opened.

   ---- What was missing ----

   Clicking a meeting used to open a form with a title, a time and a
   colour on it. Everything that makes it a meeting rather than a note
   to self was either read only or absent: who is on it, whether they
   have said yes, and any way to ask somebody new. The invitation tables
   have existed since migration 006 and the operations since 021, and no
   screen had ever called them.

   So this drawer is the whole record. Who is on it and where each of
   them stands, the back and forth that got it to this time, the
   customer it is against, who else can see it, and the two buttons that
   answer an invitation waiting on you.

   ---- Reading and editing are the same drawer ----

   Not two, because a meeting somebody opens to check the time and then
   wants to move is one thing they are looking at. The Edit toggle swaps
   the top half for fields and leaves the attendees, the history and the
   answer buttons exactly where they were.
   ============================================================= */

export type Person = { id: string; full_name: string | null; email: string | null };
export type Company = { id: string; company_name: string | null };

type InviteMessage = {
  id: string;
  invite_id: string;
  actor_id: string | null;
  action: 'invited' | 'accepted' | 'declined' | 'proposed' | 'withdrawn';
  start_at: string | null;
  end_at: string | null;
  note: string | null;
  created_at: string;
};

/** What the form holds while somebody is typing into it. */
export type Draft = {
  id: string | null;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  color: string;
  contactId: string | null;
  attendees: CalendarEventAttendee[];
  visibility: CalendarVisibility;
  visibleTo: string[];
};

const PANEL: CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 'var(--r-md)', overflow: 'hidden',
};

/** `2026-08-26T09:00`, which is what a datetime-local input wants. */
function localInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function draftFor(event: CalendarEvent): Draft {
  return {
    id: event.id,
    title: event.title,
    description: event.description ?? '',
    startAt: localInput(event.start_at),
    endAt: event.end_at ? localInput(event.end_at) : '',
    allDay: event.all_day,
    color: event.color,
    contactId: event.contact_id,
    attendees: Array.isArray(event.attendees) ? event.attendees : [],
    visibility: event.visibility ?? 'private',
    visibleTo: Array.isArray(event.visible_to) ? event.visible_to : [],
  };
}

/**
 * A blank one, at nine in the morning on the day somebody clicked.
 *
 * Nine rather than now, because clicking the 14th means booking
 * something on the 14th and a default of "this second, next Tuesday" is
 * a time nobody wants and everybody has to clear.
 */
export function blankDraft(dayKey: string, meId: string, myName: string): Draft {
  return {
    id: null,
    title: '',
    description: '',
    startAt: `${dayKey}T09:00`,
    endAt: `${dayKey}T09:30`,
    allDay: false,
    color: EVENT_COLOURS[0],
    contactId: null,
    attendees: [{ user_id: meId, name: myName }],
    visibility: 'private',
    visibleTo: [],
  };
}

export function EntryDrawer({
  event, draft: initialDraft, people, companies, meId, may, onClose, onSaved, onDeleted,
}: {
  /** Null when this is a new entry being booked. */
  event: CalendarEvent | null;
  draft: Draft;
  people: Person[];
  companies: Company[];
  meId: string;
  may: (c: string) => boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
  onDeleted: (message: string) => void;
}) {
  const isNew = event === null;
  const [editing, setEditing] = useState(isNew);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [invites, setInvites] = useState<DiaryInvite[]>([]);
  const [messages, setMessages] = useState<InviteMessage[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(!isNew);
  const [proposing, setProposing] = useState<{ inviteId: string; at: string } | null>(null);

  const peopleById = useMemo(
    () => new Map(people.map((p) => [p.id, p as DiaryPerson])),
    [people],
  );

  const set = useCallback(<K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
  }, []);

  /* Where every invitation on this meeting stands, and the whole
     exchange that got there. Read on open rather than handed down,
     because it changes when somebody else answers and the list the page
     was rendered with would be yesterday's. */
  useEffect(() => {
    if (!event) return;
    let live = true;
    setLoadingInvites(true);
    fetch(`/api/calendar/invite?eventId=${event.id}`)
      .then((r) => r.json())
      .then((json) => {
        if (!live || !json.ok) return;
        setInvites((json.invites ?? []) as DiaryInvite[]);
        setMessages((json.messages ?? []) as InviteMessage[]);
      })
      .catch(() => { /* the drawer still shows the meeting */ })
      .finally(() => { if (live) setLoadingInvites(false); });
    return () => { live = false; };
  }, [event]);

  const attendees: DiaryAttendee[] = useMemo(() => {
    if (!event) {
      /* A meeting being booked has no invitations yet, so the list is
         whoever is in the form. Shown with no status, which is honest:
         nobody has been asked until it is saved. */
      return draft.attendees.map((a, i) => ({
        key: a.user_id ?? `new-${i}`,
        name: a.name,
        email: a.email ?? null,
        userId: a.user_id ?? null,
        status: null,
        inviteId: null,
        awaited: false,
        organiser: a.user_id === meId,
      }));
    }
    return attendeesOf(
      { ...event, attendees: draft.attendees },
      { invites, people: peopleById },
    );
  }, [event, draft.attendees, invites, peopleById, meId]);

  const mine = attendees.find((a) => a.userId === meId && a.inviteId);
  const company = draft.contactId
    ? companies.find((c) => c.id === draft.contactId)?.company_name ?? null
    : null;

  async function save() {
    setBusy(true); setError(null);
    try {
      const body = {
        title: draft.title,
        description: draft.description,
        start_at: new Date(draft.startAt).toISOString(),
        end_at: draft.allDay || !draft.endAt ? null : new Date(draft.endAt).toISOString(),
        all_day: draft.allDay,
        color: draft.color,
        contact_id: draft.contactId,
        attendees: draft.attendees,
        visibility: draft.visibility,
        visible_to: draft.visibleTo,
      };
      const res = await fetch(
        draft.id ? `/api/calendar/events/${draft.id}` : '/api/calendar/events',
        {
          method: draft.id ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const json = await res.json();
      if (!json.ok) { setError(json.message ?? 'That did not save.'); return; }

      const asked = json.invited > 0
        ? ` ${json.invited} ${json.invited === 1 ? 'person has' : 'people have'} been asked.`
        : '';
      onSaved((json.warning as string | undefined)
        ?? `${draft.title} is in the diary.${asked}`);
    } catch {
      setError('That did not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!draft.id) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/calendar/events/${draft.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.ok) { setError(json.message ?? 'That would not delete.'); return; }
      onDeleted(`${draft.title} is off the diary. Nobody on it was told.`);
    } catch {
      setError('That did not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  /** Invitations: asking, answering, and taking one back. */
  async function invitation(body: Record<string, unknown>, then: string) {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/calendar/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) { setError(json.message ?? 'That did not go through.'); return; }
      /* Read the invitations back rather than guessing what changed:
         accepting a proposal moves the meeting, and a screen that
         patched its own copy would show the old time. */
      const fresh = await (await fetch(`/api/calendar/invite?eventId=${draft.id}`)).json();
      if (fresh.ok) {
        setInvites((fresh.invites ?? []) as DiaryInvite[]);
        setMessages((fresh.messages ?? []) as InviteMessage[]);
      }
      onSaved(json.message ?? then);
    } catch {
      setError('That did not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const kind = eventKind({ title: draft.title, contact_id: draft.contactId, attendees: draft.attendees });
  const length = event ? durationLabel(event.start_at, event.end_at) : null;

  return (
    <Drawer
      eyebrow={isNew ? 'New in the diary' : KIND_LABEL[kind]}
      title={draft.title.trim() || (isNew ? 'Book something' : 'Untitled')}
      icon={<CalendarClock size={18} />}
      onClose={onClose}
      width={720}
      /* Rule one of the kit: red is the single most important action on
         a screen, plus destructive intent, and three red buttons means
         none. Calling a meeting off is destructive and it is not what
         somebody came here to do, so it sits quietly on the left beside
         Close. The right hand end is the thing they did come for:
         editing it, or saving what they have typed. */
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
          {!isNew && may('crm.delegate') && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={remove}>
              <Trash2 size={13} /> Call it off
            </Button>
          )}
          <span style={{ flex: 1 }} />
          {!isNew && may('crm.delegate') && !editing && (
            <Button size="sm" variant="primary" onClick={() => setEditing(true)}>
              <Pencil size={13} /> Edit
            </Button>
          )}
          {editing && !isNew && (
            <Button size="sm" variant="secondary" disabled={busy}
              onClick={() => { setDraft(initialDraft); setEditing(false); }}>
              Put it back
            </Button>
          )}
          {editing && (
            <Button
              size="sm" variant="accent" disabled={busy || !draft.title.trim() || !draft.startAt}
              onClick={save}
            >
              {busy ? 'Saving' : isNew ? 'Book it' : 'Save'}
            </Button>
          )}
        </>
      }
    >
      {error && <Alert tone="danger"><AlertTriangle size={13} /> {error}</Alert>}

      {/* An invitation waiting on you is the first thing on the screen,
          because it is the only thing here that is asking something of
          the person reading it. */}
      {mine?.awaited && (
        <Alert tone="warning">
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontWeight: 600, color: 'var(--text)' }}>
              You have not answered this yet
            </span>
            {dateLabel(draft.startAt)}, {timeLabel(new Date(draft.startAt).toISOString())}
          </span>
          <AnswerButtons
            busy={busy}
            onAccept={() => invitation(
              { action: 'accept', inviteId: mine.inviteId }, 'You are down as coming.')}
            onDecline={() => invitation(
              { action: 'decline', inviteId: mine.inviteId }, 'They know you cannot make it.')}
          />
        </Alert>
      )}

      {editing ? (
        <EditFields
          draft={draft} set={set} people={people} companies={companies} meId={meId}
        />
      ) : (
        <ReadFields
          event={event} draft={draft} company={company} length={length} kind={kind}
        />
      )}

      {/* ---- who is on it ---- */}
      <div style={PANEL}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, minHeight: 36, padding: '0 14px',
          background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
        }}>
          <Label>Who is on it</Label>
          <span style={{
            fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
            color: 'var(--text-subtle)',
          }}>{attendees.length}</span>
          <span style={{ flex: 1 }} />
          {loadingInvites && (
            <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>Checking</span>
          )}
        </div>

        {attendees.length === 0 ? (
          <div style={{ padding: '13px 14px', fontSize: 12.5, color: 'var(--text-subtle)' }}>
            Nobody on it yet. {editing ? 'Add people below.' : 'Edit it to add people.'}
          </div>
        ) : (
          attendees.map((a) => (
            <div key={a.key} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 14px', borderBottom: '1px solid var(--border)',
            }}>
              <Avatar person={a} size={26} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, color: 'var(--text)', fontWeight: 500,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {a.name}
                  {a.userId === meId && (
                    <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}> (you)</span>
                  )}
                </div>
                {a.email && (
                  <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>{a.email}</div>
                )}
              </div>

              {a.organiser && <Badge tone="neutral">Organiser</Badge>}
              {a.status && !a.organiser && <StatusBadge status={a.status} />}
              {!a.status && !a.organiser && (
                <span
                  title="On the list, but never actually asked. Save the entry to send an invitation."
                  style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}
                >Not asked</span>
              )}

              {/* The organiser's controls on somebody else's invitation. */}
              {!isNew && event?.created_by === meId && a.inviteId && !a.organiser && (
                <IconButton
                  label={`Take back the invitation to ${a.name}`}
                  disabled={busy}
                  onClick={() => invitation(
                    { action: 'withdraw', inviteId: a.inviteId },
                    `${a.name} is off the meeting.`)}
                >
                  <X size={13} />
                </IconButton>
              )}

              {editing && !a.inviteId && a.userId !== meId && (
                <IconButton
                  label={`Take ${a.name} off the list`}
                  onClick={() => set('attendees', draft.attendees.filter(
                    (x) => (x.user_id ?? x.name) !== (a.userId ?? a.name)))}
                >
                  <X size={13} />
                </IconButton>
              )}
            </div>
          ))
        )}

        {editing && (
          <AddPeople
            people={people}
            already={draft.attendees}
            onAdd={(p) => set('attendees', [...draft.attendees,
              { user_id: p.id, name: p.full_name ?? p.email ?? 'Somebody', email: p.email ?? undefined }])}
          />
        )}

        {!isNew && !editing && may('crm.delegate') && event?.created_by === meId && (
          <div style={{ padding: '9px 14px' }}>
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              <UserPlus size={13} /> Ask somebody else
            </Button>
          </div>
        )}
      </div>

      {/* ---- how the time was arrived at ---- */}
      {!isNew && messages.length > 0 && (
        <History
          messages={messages}
          invites={invites}
          people={peopleById}
          meId={meId}
          busy={busy}
          proposing={proposing}
          onPropose={setProposing}
          onSend={(inviteId, at) => invitation(
            { action: 'propose', inviteId, startAt: new Date(at).toISOString() },
            'Your suggestion is with them.')}
        />
      )}

      {/* Suggesting another time is the third answer, and the one that
          makes an invitation a conversation rather than a yes or no. */}
      {mine?.inviteId && !proposing && (
        <div>
          <Button size="sm" variant="ghost" onClick={() => setProposing({
            inviteId: mine.inviteId!, at: draft.startAt,
          })}>
            <Clock size={13} /> Suggest another time
          </Button>
        </div>
      )}
    </Drawer>
  );
}

/* ---------------- reading it ---------------- */

function ReadFields({
  event, draft, company, length, kind,
}: {
  event: CalendarEvent | null;
  draft: Draft;
  company: string | null;
  length: string | null;
  kind: ReturnType<typeof eventKind>;
}) {
  return (
    <div style={{ ...PANEL, padding: 14, display: 'flex', flexDirection: 'column', gap: 11 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <KindBadge kind={kind} />
        {draft.visibility === 'private' && (
          <Badge tone="neutral"><Lock size={10} /> Only you</Badge>
        )}
        {draft.visibility === 'team' && (
          <Badge tone="info"><Globe2 size={10} /> Everybody</Badge>
        )}
        {draft.visibility === 'specific' && (
          <Badge tone="info"><Users size={10} /> Named people</Badge>
        )}
      </div>

      <div>
        <div style={{
          fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 15,
          letterSpacing: '-0.02em', color: 'var(--text)',
        }}>
          {event ? dateLabel(event.start_at) : dateLabel(new Date(draft.startAt).toISOString())}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>
          {draft.allDay
            ? 'All day'
            : `${timeLabel(new Date(draft.startAt).toISOString())}${
                draft.endAt ? ` to ${timeLabel(new Date(draft.endAt).toISOString())}` : ''}`}
          {length ? `, ${length}` : ''}
        </div>
      </div>

      {company && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text)' }}>
          <Building2 size={14} style={{ color: 'var(--text-subtle)' }} /> {company}
        </div>
      )}

      {draft.description && (
        <div style={{
          fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55, whiteSpace: 'pre-wrap',
        }}>{draft.description}</div>
      )}
    </div>
  );
}

/* ---------------- editing it ---------------- */

function EditFields({
  draft, set, people, companies, meId,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
  people: Person[];
  companies: Company[];
  meId: string;
}) {
  return (
    <div style={{ ...PANEL, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Field label="What is it" hint="Say what it is in the words you would use on the phone. Calls, visits and inspections are told apart by this.">
        <TextInput value={draft.title} onChange={(v) => set('title', v)}
          placeholder="Call Dawson about the trailer quote" />
      </Field>

      <Split cols={2}>
        <Field label="Starts">
          <TextInput type="datetime-local" value={draft.startAt} onChange={(v) => set('startAt', v)} />
        </Field>
        <Field label="Ends" hint={draft.allDay ? 'Not needed for an all day entry.' : undefined}>
          <TextInput type="datetime-local" value={draft.endAt} onChange={(v) => set('endAt', v)} />
        </Field>
      </Split>

      <Checkbox
        checked={draft.allDay}
        onChange={(v) => set('allDay', v)}
        label="All day"
        hint="Shows without a time, at the top of the day."
      />

      <Field label="Customer" hint="Links it to the account, so it shows on their record too.">
        <Select value={draft.contactId ?? ''} onChange={(v) => set('contactId', v || null)}>
          <option value="">Not against a customer</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.company_name ?? 'Unnamed'}</option>
          ))}
        </Select>
      </Field>

      <Field label="Detail">
        <TextArea value={draft.description} onChange={(v) => set('description', v)} rows={3}
          placeholder="Anything whoever turns up needs to know." />
      </Field>

      <Field label="Who can see it">
        <Select
          value={draft.visibility}
          onChange={(v) => set('visibility', v as CalendarVisibility)}
        >
          <option value="private">Only me and whoever is on it</option>
          <option value="team">Everybody here</option>
          <option value="specific">Named people</option>
        </Select>
      </Field>

      {draft.visibility === 'specific' && (
        <Field label="Who else" hint="On top of whoever is on the entry itself.">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {people.filter((p) => p.id !== meId).map((p) => {
              const on = draft.visibleTo.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => set('visibleTo', on
                    ? draft.visibleTo.filter((x) => x !== p.id)
                    : [...draft.visibleTo, p.id])}
                  style={{
                    height: 26, padding: '0 10px', borderRadius: 'var(--r)',
                    border: `1px solid ${on ? 'var(--border-emphasis)' : 'var(--border)'}`,
                    background: on ? 'var(--bg-subtle)' : 'var(--surface)',
                    color: on ? 'var(--text)' : 'var(--text-muted)',
                    fontFamily: 'var(--inter)', fontSize: 12, cursor: 'pointer',
                  }}
                >{p.full_name ?? p.email}</button>
              );
            })}
          </div>
        </Field>
      )}

      <Field label="Colour" hint="For picking it out of a busy week, nothing more.">
        <div style={{ display: 'flex', gap: 7 }}>
          {EVENT_COLOURS.map((c) => (
            <button
              key={c} type="button" onClick={() => set('color', c)}
              aria-label={`Colour ${c}`}
              style={{
                width: 24, height: 24, borderRadius: 'var(--r-sm)', background: c,
                border: draft.color === c ? '2px solid var(--text)' : '1px solid var(--border)',
                cursor: 'pointer',
              }}
            />
          ))}
        </div>
      </Field>
    </div>
  );
}

/* ---------------- adding somebody ---------------- */

function AddPeople({
  people, already, onAdd,
}: {
  people: Person[];
  already: CalendarEventAttendee[];
  onAdd: (p: Person) => void;
}) {
  const [query, setQuery] = useState('');
  const taken = new Set(already.map((a) => a.user_id).filter(Boolean));

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people
      .filter((p) => !taken.has(p.id))
      .filter((p) => !q || `${p.full_name ?? ''} ${p.email ?? ''}`.toLowerCase().includes(q))
      .slice(0, 6);
  }, [people, query, taken]);

  return (
    <div style={{ padding: '11px 14px', display: 'flex', flexDirection: 'column', gap: 9 }}>
      <SearchInput
        value={query} onChange={setQuery}
        placeholder="Add somebody from the team"
        icon={<Search size={14} />}
      />
      {matches.length === 0 ? (
        <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
          {query.trim() ? 'Nobody by that name.' : 'Everybody here is already on it.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {matches.map((p) => (
            <button
              key={p.id} type="button" onClick={() => { onAdd(p); setQuery(''); }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                height: 28, padding: '0 10px', borderRadius: 'var(--r)',
                border: '1px solid var(--border-strong)', background: 'var(--surface)',
                color: 'var(--text-muted)', cursor: 'pointer',
                fontFamily: 'var(--inter)', fontSize: 12.5,
              }}
            ><Plus size={12} /> {p.full_name ?? p.email}</button>
          ))}
        </div>
      )}
      <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
        Anybody added here gets an invitation when this is saved. They can accept it, say they
        cannot make it, or suggest another time.
      </div>
    </div>
  );
}

/* ---------------- how the time was arrived at ---------------- */

const SAID: Record<InviteMessage['action'], string> = {
  invited: 'asked',
  accepted: 'said yes to',
  declined: 'could not make',
  proposed: 'suggested another time for',
  withdrawn: 'was taken off',
};

function History({
  messages, invites, people, meId, busy, proposing, onPropose, onSend,
}: {
  messages: InviteMessage[];
  invites: DiaryInvite[];
  people: Map<string, DiaryPerson>;
  meId: string;
  busy: boolean;
  proposing: { inviteId: string; at: string } | null;
  onPropose: (p: { inviteId: string; at: string } | null) => void;
  onSend: (inviteId: string, at: string) => void;
}) {
  const inviteeOf = new Map(invites.map((i) => [i.id, i.user_id]));

  return (
    <div style={PANEL}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, minHeight: 36, padding: '0 14px',
        background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
      }}>
        <Label>How this time was arrived at</Label>
        <span style={{
          fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5, color: 'var(--text-subtle)',
        }}>{messages.length}</span>
      </div>

      {messages.map((m) => {
        const actor = m.actor_id === meId
          ? 'You'
          : people.get(m.actor_id ?? '')?.full_name
            ?? people.get(m.actor_id ?? '')?.email ?? 'Somebody';
        const about = people.get(inviteeOf.get(m.invite_id) ?? '')?.full_name ?? 'the meeting';

        return (
          <div key={m.id} style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '9px 14px', borderBottom: '1px solid var(--border)',
          }}>
            <span style={{
              width: 22, height: 22, borderRadius: 'var(--r-full)', flex: 'none', marginTop: 1,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--bg-subtle)', color: 'var(--text-subtle)',
            }}>
              {m.action === 'accepted' ? <Check size={11} />
                : m.action === 'declined' || m.action === 'withdrawn' ? <X size={11} />
                : m.action === 'proposed' ? <Clock size={11} />
                : <Mail size={11} />}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: 'var(--text)' }}>
                {m.action === 'invited'
                  ? `${actor} asked ${about}`
                  : `${actor} ${SAID[m.action]} it`}
                {m.start_at && m.action === 'proposed' && (
                  <span style={{ color: 'var(--text-muted)' }}>
                    {': '}{dateLabel(m.start_at)}, {timeLabel(m.start_at)}
                  </span>
                )}
              </div>
              {m.note && (
                <div style={{
                  display: 'flex', gap: 6, marginTop: 3,
                  fontSize: 11.5, color: 'var(--text-subtle)',
                }}>
                  <MessageSquare size={11} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>{m.note}</span>
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>
                {new Date(m.created_at).toLocaleString('en-GB', {
                  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                })}
              </div>
            </div>
          </div>
        );
      })}

      {proposing && (
        <div style={{ padding: '11px 14px', display: 'flex', flexDirection: 'column', gap: 9 }}>
          <Field label="A time that would work">
            <TextInput
              type="datetime-local"
              value={proposing.at}
              onChange={(v) => onPropose({ ...proposing, at: v })}
            />
          </Field>
          <div style={{ display: 'flex', gap: 7 }}>
            <Button size="sm" variant="primary" disabled={busy}
              onClick={() => onSend(proposing.inviteId, proposing.at)}>
              <Send size={12} /> Suggest it
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onPropose(null)}>Never mind</Button>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
            The meeting stays where it is until somebody accepts. Whoever accepts is accepting
            whatever time is on the table, and the meeting moves to it.
          </div>
        </div>
      )}
    </div>
  );
}
