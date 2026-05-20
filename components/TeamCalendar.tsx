'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ChevronLeft, ChevronRight, Plus, X, Trash2, CalendarDays, Users, Lock, Globe2, MapPin, FileText, Briefcase, Mail, ExternalLink } from 'lucide-react';
import type { CalendarEvent, CalendarEventAttendee, CalendarVisibility, CRMContact } from '@/lib/types';

// IMPORTANT: format a Date in LOCAL time (not UTC). The bug we fixed was
// using d.toISOString() which gives UTC and is off-by-one in BST.
function fmtDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date)   { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function fmtMonth(d: Date) { return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); }
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function fmtFullDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

const COLORS = ['#cf2417', '#5b8def', '#2ecc71', '#f5a623', '#a065ff', '#06b6d4'];

type EventKind = 'meeting' | 'appointment' | 'reminder' | 'other';
function inferKind(e: Pick<CalendarEvent, 'contact_id' | 'attendees'>): EventKind {
  if (e.contact_id) return 'meeting';
  if (Array.isArray(e.attendees) && e.attendees.length > 1) return 'meeting';
  return 'appointment';
}

// ===== Toast notifications (4s, hover-pause, 2s after leave) =====
function useToasts() {
  const [toasts, setToasts] = useState<Array<{ id: string; title: string; subtitle?: string; viewEventId?: string }>>([]);
  const dismiss = useCallback((id: string) => setToasts(t => t.filter(x => x.id !== id)), []);
  const push = useCallback((t: { title: string; subtitle?: string; viewEventId?: string }) => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, ...t }]);
    return id;
  }, []);
  return { toasts, push, dismiss };
}

export function TeamCalendar({ initialEvents, userId }: { initialEvents: CalendarEvent[]; userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [events, setEvents] = useState<CalendarEvent[]>(initialEvents);
  const [cursor, setCursor] = useState(new Date());
  const [dayModal, setDayModal] = useState<{ date: string } | null>(null);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();
  // Cache of contacts referenced by events, fetched on demand
  const [contactCache, setContactCache] = useState<Record<string, CRMContact>>({});

  // Refetch when month changes (broader window for the 7-day overview at bottom)
  useEffect(() => {
    const monthStart = startOfMonth(cursor).toISOString();
    const sevenDaysFromNow = new Date(Date.now() + 8 * 86_400_000).toISOString();
    const nextMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1).toISOString();
    // Window covers the visible month AND the next 7 days from now, whichever is wider
    const upper = new Date(Math.max(new Date(nextMonth).getTime(), new Date(sevenDaysFromNow).getTime())).toISOString();
    supabase.from('calendar_events').select('*')
      .gte('start_at', monthStart).lt('start_at', upper).order('start_at')
      .then(({ data }) => setEvents((data ?? []) as CalendarEvent[]));
  }, [supabase, cursor]);

  // Realtime
  useEffect(() => {
    const ch = supabase.channel('calendar_events')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events' },
        (payload: any) => {
          if (payload.eventType === 'INSERT') {
            const e = payload.new as CalendarEvent;
            setEvents(prev => prev.some(x => x.id === e.id) ? prev : [...prev, e]);
            // Toast notification — only if this user created it (avoids spamming everyone on team events)
            if (e.created_by === userId) {
              const subtitle = `${fmtFullDate(e.start_at)} · ${e.all_day ? 'All day' : fmtTime(e.start_at)}`;
              pushToast({ title: `${inferKind(e) === 'meeting' ? 'Meeting' : 'Event'} scheduled: ${e.title}`, subtitle, viewEventId: e.id });
            }
          } else if (payload.eventType === 'UPDATE') {
            setEvents(prev => prev.map(x => x.id === payload.new.id ? payload.new as CalendarEvent : x));
          } else if (payload.eventType === 'DELETE') {
            setEvents(prev => prev.filter(x => x.id !== payload.old.id));
          }
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, userId, pushToast]);

  // Fetch CRM contact rows referenced by events (so we can render "Bay Freight" in cards)
  useEffect(() => {
    const wantIds = Array.from(new Set(events.map(e => e.contact_id).filter(Boolean) as string[]))
      .filter(id => !(id in contactCache));
    if (!wantIds.length) return;
    supabase.from('crm_contacts').select('id, company_name, contact_name, email, phone, list_id').in('id', wantIds)
      .then(({ data }) => {
        if (!data) return;
        setContactCache(prev => {
          const next = { ...prev };
          for (const c of data) next[c.id as string] = c as CRMContact;
          return next;
        });
      });
  }, [supabase, events, contactCache]);

  // Build month grid
  const monthGrid = useMemo(() => {
    const start = startOfMonth(cursor);
    const end = endOfMonth(cursor);
    const offset = (start.getDay() + 6) % 7;
    const cells: Date[] = [];
    for (let i = 0; i < offset; i++) {
      const d = new Date(start); d.setDate(d.getDate() - (offset - i));
      cells.push(d);
    }
    for (let day = 1; day <= end.getDate(); day++) {
      cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), day));
    }
    while (cells.length % 7 !== 0) {
      const last = cells[cells.length - 1];
      const next = new Date(last); next.setDate(last.getDate() + 1);
      cells.push(next);
    }
    return cells;
  }, [cursor]);

  function eventsOn(date: Date) {
    const k = fmtDay(date);
    return events.filter(e => fmtDay(new Date(e.start_at)) === k);
  }

  async function saveEvent(payload: Partial<CalendarEvent>) {
    setMessage(null);
    if (editing) {
      const { error } = await supabase.from('calendar_events').update(payload).eq('id', editing.id);
      if (error) { setMessage(error.message); return; }
    } else {
      const insertPayload = { ...payload, created_by: userId } as any;
      const { data, error } = await supabase.from('calendar_events').insert(insertPayload).select('*').single();
      if (error) { setMessage(error.message); return; }
      // Toast directly (realtime will arrive shortly but instant feel is better)
      if (data) {
        const e = data as CalendarEvent;
        const subtitle = `${fmtFullDate(e.start_at)} · ${e.all_day ? 'All day' : fmtTime(e.start_at)}`;
        pushToast({ title: `${inferKind(e) === 'meeting' ? 'Meeting' : 'Event'} created: ${e.title}`, subtitle, viewEventId: e.id });
      }
    }
    setEditing(null);
    setDayModal(null);
  }

  async function deleteEvent(id: string) {
    if (!confirm('Delete this event?')) return;
    const { error } = await supabase.from('calendar_events').delete().eq('id', id);
    if (error) { setMessage(error.message); return; }
    setEditing(null);
  }

  const isCurrentMonth = (d: Date) => d.getMonth() === cursor.getMonth();
  const isToday = (d: Date) => fmtDay(d) === fmtDay(new Date());

  // 7-day overview rows
  const next7Days = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const rows: { date: Date; events: CalendarEvent[] }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today); d.setDate(today.getDate() + i);
      const dKey = fmtDay(d);
      rows.push({ date: d, events: events.filter(e => fmtDay(new Date(e.start_at)) === dKey) });
    }
    return rows;
  }, [events]);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-head__eyebrow">Workspace · Calendar</div>
          <h1 className="page-head__title"><CalendarDays size={26} style={{ color: 'var(--stc-red)' }} /><span>{fmtMonth(cursor)}<span style={{ color: 'var(--stc-red)' }}>.</span></span></h1>
          <div className="page-head__sub">Team calendar · realtime · {events.length} events loaded</div>
        </div>
        <div className="row">
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="btn btn--icon"><ChevronLeft size={14} /></button>
          <button onClick={() => setCursor(new Date())} className="btn">Today</button>
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="btn btn--icon"><ChevronRight size={14} /></button>
        </div>
      </div>

      {message && <div className="alert alert--danger" style={{ marginBottom: 12 }}>{message}</div>}

      <div className="cal">
        <div className="cal__head">
          {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d) => <div key={d} className="cal__hcell">{d}</div>)}
        </div>
        <div className="cal__grid">
          {monthGrid.map((d, i) => {
            const evs = eventsOn(d);
            return (
              <button key={i}
                className={`cal__cell${isCurrentMonth(d) ? ' is-cur' : ''}${isToday(d) ? ' is-today' : ''}`}
                onClick={() => setDayModal({ date: fmtDay(d) })}>
                <div className="cal__date">{d.getDate()}</div>
                <div className="cal__events">
                  {evs.slice(0, 4).map((e) => {
                    const isMeeting = inferKind(e) === 'meeting';
                    return (
                      <div key={e.id}
                        className={`cal__chip${isMeeting ? ' cal__chip--meeting' : ''}`}
                        style={{ background: `${e.color}22`, color: e.color, borderLeft: `3px solid ${e.color}` }}
                        onClick={(ev) => { ev.stopPropagation(); setEditing(e); setDayModal({ date: fmtDay(d) }); }}>
                        {isMeeting && <Users size={9} style={{ flexShrink: 0 }} />}
                        <span>{!e.all_day && <span className="cal__chip-time">{fmtTime(e.start_at)} </span>}{e.title}</span>
                      </div>
                    );
                  })}
                  {evs.length > 4 && <div className="cal__more">+{evs.length - 4} more</div>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 7-day overview */}
      <Next7Days rows={next7Days} contactCache={contactCache} onClickEvent={(e) => { setEditing(e); setDayModal({ date: fmtDay(new Date(e.start_at)) }); }} />

      {dayModal && (
        <div className="modal-bg" onClick={() => { setDayModal(null); setEditing(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal__head">
              <h3 style={{ margin: 0 }}>{editing ? 'Edit event' : 'New event'} · {dayModal.date}</h3>
              <button onClick={() => { setDayModal(null); setEditing(null); }} className="btn btn--icon btn--sm"><X size={14} /></button>
            </div>
            <EventForm
              defaults={editing ?? { title: '', start_at: `${dayModal.date}T09:00:00`, end_at: null, all_day: false, color: COLORS[0], description: null, attendees: [], visibility: 'private', visible_to: [], contact_id: null } as any}
              contact={editing?.contact_id ? contactCache[editing.contact_id] : null}
              onSave={saveEvent}
              onDelete={editing ? () => deleteEvent(editing.id) : undefined}
            />
          </div>
        </div>
      )}

      <Toasts toasts={toasts} dismiss={dismissToast} onView={(id) => {
        const ev = events.find(e => e.id === id);
        if (ev) { setEditing(ev); setDayModal({ date: fmtDay(new Date(ev.start_at)) }); }
      }} />
    </div>
  );
}

// ===== 7-day overview component =====
function Next7Days({ rows, contactCache, onClickEvent }: {
  rows: { date: Date; events: CalendarEvent[] }[];
  contactCache: Record<string, CRMContact>;
  onClickEvent: (e: CalendarEvent) => void;
}) {
  function smartLine(date: Date, evs: CalendarEvent[]): { headline: string; sub?: string } {
    const dayLabel = date.toLocaleDateString('en-GB', { weekday: 'long' });
    const isToday = fmtDay(date) === fmtDay(new Date());
    const isTomorrow = fmtDay(date) === fmtDay(new Date(Date.now() + 86_400_000));
    const when = isToday ? 'today' : isTomorrow ? 'tomorrow' : `on ${dayLabel}`;
    if (evs.length === 0) return { headline: `No meetings ${when}`, sub: 'Free day' };
    const meetings = evs.filter(e => inferKind(e) === 'meeting');
    if (meetings.length === 1) {
      const m = meetings[0];
      const c = m.contact_id ? contactCache[m.contact_id] : null;
      const company = c?.company_name;
      if (company) return { headline: `You have a meeting with ${company} ${when}`, sub: `${fmtTime(m.start_at)} · ${m.title}` };
      return { headline: `You have a meeting ${when}`, sub: `${fmtTime(m.start_at)} · ${m.title}` };
    }
    if (meetings.length >= 2) {
      return { headline: `${meetings.length} meetings lined up ${when}`, sub: meetings.map(m => fmtTime(m.start_at)).join(' · ') };
    }
    if (evs.length === 1) return { headline: `1 appointment ${when}`, sub: `${fmtTime(evs[0].start_at)} · ${evs[0].title}` };
    return { headline: `${evs.length} appointments ${when}`, sub: evs.map(e => e.title).slice(0, 3).join(' · ') };
  }
  return (
    <div style={{ marginTop: 22 }}>
      <div className="page-head__eyebrow" style={{ marginBottom: 10 }}>Next 7 days</div>
      <div className="overview-grid">
        {rows.map(({ date, events }, i) => {
          const { headline, sub } = smartLine(date, events);
          const isEmpty = events.length === 0;
          const isToday = fmtDay(date) === fmtDay(new Date());
          return (
            <div key={i} className={`overview-card ${isEmpty ? 'is-empty' : ''} ${isToday ? 'is-today' : ''}`}>
              <div className="overview-card__date">
                <div className="overview-card__day">{date.toLocaleDateString('en-GB', { weekday: 'short' })}</div>
                <div className="overview-card__num">{date.getDate()}</div>
                <div className="overview-card__month">{date.toLocaleDateString('en-GB', { month: 'short' })}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="overview-card__headline">{headline}</div>
                {sub && <div className="overview-card__sub">{sub}</div>}
                {events.length > 0 && (
                  <div className="overview-card__chips">
                    {events.slice(0, 3).map(e => (
                      <button key={e.id} onClick={() => onClickEvent(e)} className="overview-card__chip" style={{ borderLeft: `3px solid ${e.color}` }}>
                        {inferKind(e) === 'meeting' && <Users size={10} />}
                        {!e.all_day && <span className="mono" style={{ fontSize: 10 }}>{fmtTime(e.start_at)}</span>}
                        <span>{e.title}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ===== Event form with FULL details (attendees, contact, visibility, kind) =====
function EventForm({ defaults, contact, onSave, onDelete }: {
  defaults: CalendarEvent;
  contact: CRMContact | null;
  onSave: (p: Partial<CalendarEvent>) => void;
  onDelete?: () => void;
}) {
  const [title, setTitle] = useState(defaults.title);
  const [description, setDescription] = useState(defaults.description ?? '');
  const [allDay, setAllDay] = useState(defaults.all_day);
  const [start, setStart] = useState(defaults.start_at.slice(0, 16));
  const [end, setEnd] = useState((defaults.end_at ?? defaults.start_at).slice(0, 16));
  const [color, setColor] = useState(defaults.color);
  const [kind, setKind] = useState<EventKind>(inferKind(defaults));
  const attendees = (defaults.attendees ?? []) as CalendarEventAttendee[];
  const visibility = (defaults.visibility ?? 'private') as CalendarVisibility;
  const isExistingMeeting = !!defaults.contact_id || (Array.isArray(attendees) && attendees.length > 1);

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      onSave({
        title, description: description || null, all_day: allDay,
        start_at: new Date(start).toISOString(), end_at: end ? new Date(end).toISOString() : null,
        color,
      });
    }} style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Existing meeting: show read-only summary of meeting-specific info */}
      {isExistingMeeting && (
        <div className="card" style={{ padding: 12, background: 'rgba(91, 141, 239, 0.08)', borderColor: 'rgba(91, 141, 239, 0.3)' }}>
          <div className="field__label" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, color: '#5b8def' }}>
            <Users size={12} /> MEETING DETAILS
          </div>
          {contact && (
            <div className="row" style={{ gap: 8, padding: '6px 0', alignItems: 'flex-start' }}>
              <Briefcase size={14} style={{ flexShrink: 0, marginTop: 2, color: 'var(--fg-3)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{contact.company_name}</div>
                {contact.contact_name && <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>{contact.contact_name}</div>}
                {(contact.email || contact.phone) && (
                  <div style={{ fontSize: 11.5, color: 'var(--fg-3)', display: 'flex', gap: 10, marginTop: 2 }}>
                    {contact.email && <span><Mail size={10} /> {contact.email}</span>}
                    {contact.phone && <span>📞 {contact.phone}</span>}
                  </div>
                )}
              </div>
            </div>
          )}
          {attendees.length > 0 && (
            <div style={{ padding: '8px 0' }}>
              <div className="field__label" style={{ marginBottom: 4, fontSize: 11 }}>Attendees ({attendees.length})</div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                {attendees.map((a, i) => (
                  <span key={i} className="pill" style={{ fontSize: 11 }}>
                    {a.user_id ? <Users size={11} /> : <Mail size={11} />} {a.name}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="row" style={{ gap: 6, fontSize: 11.5, color: 'var(--fg-3)' }}>
            {visibility === 'private' && <><Lock size={11} /> Private — only you can see this</>}
            {visibility === 'team' && <><Globe2 size={11} /> Visible to everyone on the team</>}
            {visibility === 'specific' && <><Users size={11} /> Visible to specific teammates</>}
          </div>
        </div>
      )}

      <div className="field">
        <div className="field__label">Title</div>
        <input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </div>

      {/* Type selector for NEW manual events (not shown for existing meetings) */}
      {!isExistingMeeting && (
        <div className="field">
          <div className="field__label">Type</div>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as EventKind)}>
            <option value="appointment">Appointment</option>
            <option value="meeting">Meeting (with attendees)</option>
            <option value="reminder">Reminder</option>
            <option value="other">Other</option>
          </select>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>
            For meetings with customers, use the &ldquo;Schedule meeting&rdquo; button on a contact instead — it links the meeting to the customer record.
          </div>
        </div>
      )}

      <div className="row" style={{ gap: 10 }}>
        <label className="row" style={{ fontSize: 12, color: 'var(--fg-2)' }}>
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day
        </label>
      </div>
      {!allDay && (
        <div className="split-2">
          <div className="field"><div className="field__label">Start</div>
            <input type="datetime-local" className="input" value={start} onChange={(e) => setStart(e.target.value)} required /></div>
          <div className="field"><div className="field__label">End</div>
            <input type="datetime-local" className="input" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        </div>
      )}
      <div className="field">
        <div className="field__label">Description</div>
        <textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div>
        <div className="field__label" style={{ marginBottom: 6 }}>Colour</div>
        <div className="row">
          {COLORS.map((c) => (
            <button type="button" key={c} onClick={() => setColor(c)}
              style={{ width: 24, height: 24, borderRadius: 6, background: c, border: color === c ? '2px solid var(--fg-1)' : '2px solid transparent' }} />
          ))}
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
        {onDelete ? <button type="button" onClick={onDelete} className="btn btn--sm" style={{ color: 'var(--stc-red-300)' }}><Trash2 size={12} /> Delete</button> : <span />}
        <button type="submit" className="btn btn--primary"><Plus size={14} /> {onDelete ? 'Save' : 'Create'}</button>
      </div>
    </form>
  );
}

// ===== Toast renderer with hover-pause =====
function Toasts({ toasts, dismiss, onView }: {
  toasts: Array<{ id: string; title: string; subtitle?: string; viewEventId?: string }>;
  dismiss: (id: string) => void;
  onView: (eventId: string) => void;
}) {
  return (
    <div className="toast-stack">
      {toasts.map(t => <Toast key={t.id} toast={t} dismiss={dismiss} onView={onView} />)}
    </div>
  );
}
function Toast({ toast, dismiss, onView }: {
  toast: { id: string; title: string; subtitle?: string; viewEventId?: string };
  dismiss: (id: string) => void;
  onView: (eventId: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    // 4s default; if hovered, when mouse leaves we wait 2s then dismiss
    let timer: any;
    if (!hovered) {
      timer = setTimeout(() => dismiss(toast.id), 4000);
    }
    return () => clearTimeout(timer);
  }, [hovered, toast.id, dismiss]);

  return (
    <div className="toast"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        // 2s after mouse leaves
        setHovered(false);
        setTimeout(() => dismiss(toast.id), 2000);
      }}>
      <div className="toast__icon"><CalendarDays size={16} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="toast__title">{toast.title}</div>
        {toast.subtitle && <div className="toast__sub">{toast.subtitle}</div>}
      </div>
      {toast.viewEventId && (
        <button className="btn btn--sm btn--primary" onClick={() => { onView(toast.viewEventId!); dismiss(toast.id); }}>
          View <ExternalLink size={11} />
        </button>
      )}
      <button onClick={() => dismiss(toast.id)} className="btn btn--icon btn--sm" title="Dismiss"><X size={12} /></button>
    </div>
  );
}
