'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ChevronLeft, ChevronRight, Plus, X, Trash2 } from 'lucide-react';
import type { CalendarEvent } from '@/lib/types';

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date)   { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function fmtMonth(d: Date) { return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); }
function fmtDay(d: Date)   { return d.toISOString().slice(0, 10); }

const COLORS = ['#cf2417', '#5b8def', '#2ecc71', '#f5a623', '#a065ff', '#06b6d4'];

export function TeamCalendar({ initialEvents, userId }: { initialEvents: CalendarEvent[]; userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [events, setEvents] = useState<CalendarEvent[]>(initialEvents);
  const [cursor, setCursor] = useState(new Date());
  const [dayModal, setDayModal] = useState<{ date: string } | null>(null);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Refetch when month changes
  useEffect(() => {
    const monthStart = startOfMonth(cursor).toISOString();
    const nextMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1).toISOString();
    supabase.from('calendar_events').select('*')
      .gte('start_at', monthStart).lt('start_at', nextMonth).order('start_at')
      .then(({ data }) => { setEvents((data ?? []) as CalendarEvent[]); });
  }, [supabase, cursor]);

  // Realtime
  useEffect(() => {
    const ch = supabase.channel('calendar_events')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events' },
        (payload: any) => {
          if (payload.eventType === 'INSERT') setEvents((e) => [...e, payload.new as CalendarEvent]);
          else if (payload.eventType === 'UPDATE') setEvents((e) => e.map((x) => x.id === payload.new.id ? payload.new as CalendarEvent : x));
          else if (payload.eventType === 'DELETE') setEvents((e) => e.filter((x) => x.id !== payload.old.id));
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase]);

  // Build month grid
  const monthGrid = useMemo(() => {
    const start = startOfMonth(cursor);
    const end = endOfMonth(cursor);
    // Start on Monday (UK)
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
    return events.filter((e) => fmtDay(new Date(e.start_at)) === k);
  }

  async function saveEvent(payload: Partial<CalendarEvent>) {
    setMessage(null);
    if (editing) {
      const { error } = await supabase.from('calendar_events').update(payload).eq('id', editing.id);
      if (error) { setMessage(error.message); return; }
    } else {
      const { error } = await supabase.from('calendar_events').insert({ ...payload, created_by: userId } as any);
      if (error) { setMessage(error.message); return; }
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

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-head__eyebrow">Workspace · Calendar</div>
          <h1 className="page-head__title">{fmtMonth(cursor)}<span style={{ color: 'var(--stc-red)' }}>.</span></h1>
          <div className="page-head__sub">Team calendar · realtime · {events.length} events this month</div>
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
              <button
                key={i}
                className={`cal__cell${isCurrentMonth(d) ? ' is-cur' : ''}${isToday(d) ? ' is-today' : ''}`}
                onClick={() => setDayModal({ date: fmtDay(d) })}
              >
                <div className="cal__date">{d.getDate()}</div>
                <div className="cal__events">
                  {evs.slice(0, 3).map((e) => (
                    <div key={e.id} className="cal__chip" style={{ background: `${e.color}22`, color: e.color, borderLeft: `2px solid ${e.color}` }}
                      onClick={(ev) => { ev.stopPropagation(); setEditing(e); setDayModal({ date: fmtDay(d) }); }}>
                      {e.title}
                    </div>
                  ))}
                  {evs.length > 3 && <div className="cal__more">+{evs.length - 3} more</div>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {dayModal && (
        <div className="modal-bg" onClick={() => { setDayModal(null); setEditing(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__head">
              <h3 style={{ margin: 0 }}>{editing ? 'Edit event' : 'New event'} · {dayModal.date}</h3>
              <button onClick={() => { setDayModal(null); setEditing(null); }} className="btn btn--icon btn--sm"><X size={14} /></button>
            </div>
            <EventForm
              defaults={editing ?? { title: '', start_at: `${dayModal.date}T09:00:00`, end_at: null, all_day: false, color: COLORS[0], description: null } as any}
              onSave={saveEvent}
              onDelete={editing ? () => deleteEvent(editing.id) : undefined}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function EventForm({ defaults, onSave, onDelete }: { defaults: CalendarEvent; onSave: (p: Partial<CalendarEvent>) => void; onDelete?: () => void }) {
  const [title, setTitle] = useState(defaults.title);
  const [description, setDescription] = useState(defaults.description ?? '');
  const [allDay, setAllDay] = useState(defaults.all_day);
  const [start, setStart] = useState(defaults.start_at.slice(0, 16));
  const [end, setEnd] = useState((defaults.end_at ?? defaults.start_at).slice(0, 16));
  const [color, setColor] = useState(defaults.color);

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ title, description: description || null, all_day: allDay, start_at: new Date(start).toISOString(), end_at: end ? new Date(end).toISOString() : null, color }); }}
      style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="field">
        <div className="field__label">Title</div>
        <input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </div>
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
