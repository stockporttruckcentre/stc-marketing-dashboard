'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, CalendarPlus, Users, Mail, Lock, Globe2, ChevronDown, UserCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button, Label, Badge } from '@/components/kit/primitives';
import type { CRMContact, Profile } from '@/lib/types';

/* =============================================================
   Schedule a meeting.

   Moved out of CrmWorkspace so the contact drawer can own it without a
   circular import, and given the delegation the meeting asked for: Tom
   takes a call while Dave is away and books the follow-up in Dave's
   diary, so it has to land on the right person.

   Two caveats worth knowing, both documented in the dashboard plan:
   the event carries owner_user_id only once the dashboard migration has
   run, and the existing calendar policies let only the creator edit an
   event, so until those are rewritten the owner cannot amend a meeting
   booked for them. The picker still records the intent correctly.
   ============================================================= */

// ===== Schedule meeting modal =====
export function ScheduleMeetingModal({ contact, profile, allProfiles, onClose }: {
  contact: CRMContact;
  profile: Profile;
  allProfiles: Profile[];
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [profiles, setProfiles] = useState<Profile[]>(allProfiles);
  const [title, setTitle] = useState(`Meeting with ${contact.company_name}`);
  // Default: tomorrow 10:00 for 1 hour
  const tomorrow = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d; }, []);
  const oneHourLater = useMemo(() => { const d = new Date(tomorrow); d.setHours(d.getHours() + 1); return d; }, [tomorrow]);
  function toLocalISO(d: Date) { const pad = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  const [start, setStart] = useState(toLocalISO(tomorrow));
  const [end, setEnd] = useState(toLocalISO(oneHourLater));
  const [description, setDescription] = useState('');
  const [attendees, setAttendees] = useState<{ user_id?: string; name: string; email?: string }[]>([
    { user_id: profile.id, name: profile.full_name, email: profile.email },
  ]);
  const [attendeeInput, setAttendeeInput] = useState('');
  // Whose diary this lands in. Tom takes a call while Dave is away and
  // books the follow-up for Dave, so the owner is not always the creator.
  const [ownerId, setOwnerId] = useState<string>(profile.id);
  const [step, setStep] = useState<'form' | 'visibility' | 'saving'>('form');
  const [error, setError] = useState<string | null>(null);

  // Load profiles for the team picker
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('profiles').select('id, email, full_name, role').order('full_name');
      setProfiles((data ?? []) as Profile[]);
    })();
  }, [supabase]);

  function addAttendeeFromText() {
    const t = attendeeInput.trim();
    if (!t) return;
    // Try match against profiles by name or email
    const lower = t.toLowerCase();
    const match = profiles.find(p => p.full_name.toLowerCase() === lower || p.email.toLowerCase() === lower);
    if (match && !attendees.some(a => a.user_id === match.id)) {
      setAttendees(a => [...a, { user_id: match.id, name: match.full_name, email: match.email }]);
    } else if (!match && !attendees.some(a => (a.email || a.name).toLowerCase() === lower)) {
      // Free text, so treat as a guest. If it looks like an email, store it as one.
      const isEmail = /@/.test(t);
      setAttendees(a => [...a, isEmail ? { name: t, email: t } : { name: t }]);
    }
    setAttendeeInput('');
  }

  function removeAttendee(idx: number) {
    setAttendees(a => a.filter((_, i) => i !== idx));
  }

  function addProfile(p: Profile) {
    if (attendees.some(a => a.user_id === p.id)) return;
    setAttendees(a => [...a, { user_id: p.id, name: p.full_name, email: p.email }]);
  }

  async function save(visibility: 'private' | 'team' | 'specific', visibleTo: string[]) {
    setStep('saving'); setError(null);
    const startISO = new Date(start).toISOString();
    const endISO = end ? new Date(end).toISOString() : null;
    const delegated = ownerId !== profile.id;
    // The owner must be able to see it even when somebody else booked it.
    const seeAlso = visibility === 'specific'
      ? Array.from(new Set([...visibleTo, ownerId]))
      : visibleTo;

    const payload: Record<string, any> = {
      title,
      description: description || null,
      start_at: startISO,
      end_at: endISO,
      all_day: false,
      color: '#cf2417',
      created_by: profile.id,
      owner_user_id: ownerId,
      contact_id: contact.id,
      attendees,
      visibility: delegated && visibility === 'private' ? 'specific' : visibility,
      visible_to: delegated && visibility === 'private' ? [ownerId] : seeAlso,
    };

    let { error } = await supabase.from('calendar_events').insert(payload);
    // owner_user_id only exists once the dashboard migration has run.
    if (error && /owner_user_id/.test(error.message)) {
      const { owner_user_id, ...withoutOwner } = payload;
      ({ error } = await supabase.from('calendar_events').insert(withoutOwner));
    }
    if (error) { setError(error.message); setStep('visibility'); return; }
    onClose();
  }

  if (step === 'visibility') {
    return <VisibilityPicker
      profiles={profiles.filter(p => p.id !== profile.id)}
      onCancel={() => setStep('form')}
      onSave={save}
      error={error}
    />;
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal__head">
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <CalendarPlus size={16} style={{ color: 'var(--stc-red)' }} /> Schedule a meeting
          </h3>
          <button onClick={onClose} className="btn btn--icon btn--sm"><X size={14} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field">
            <div className="field__label">Customer</div>
            <input className="input" value={contact.company_name} readOnly style={{ background: 'var(--bg-3)', color: 'var(--fg-2)' }} />
          </div>
          <div className="field">
            <div className="field__label">Meeting title</div>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="split-2">
            <div className="field">
              <div className="field__label">Starts</div>
              <input type="datetime-local" className="input" value={start} onChange={(e) => setStart(e.target.value)} required />
            </div>
            <div className="field">
              <div className="field__label">Ends</div>
              <input type="datetime-local" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <div className="field__label">Whose diary</div>
            <select
              className="input"
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
            >
              <option value={profile.id}>{profile.full_name} (you)</option>
              {profiles.filter((p) => p.id !== profile.id).map((p) => (
                <option key={p.id} value={p.id}>{p.full_name}</option>
              ))}
            </select>
            {ownerId !== profile.id && (
              <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 6, lineHeight: 1.5 }}>
                Booked by you, owned by {profiles.find((p) => p.id === ownerId)?.full_name}.
                It will be shared with them automatically. Pushing it to their Outlook
                needs the Microsoft calendar sync, which is not connected yet.
              </div>
            )}
          </div>

          <div className="field">
            <div className="field__label">Participants</div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {attendees.map((a, i) => (
                <span key={i} className="pill" style={{ fontSize: 11 }}>
                  {a.user_id ? <Users size={11} /> : <Mail size={11} />} {a.name}
                  <button onClick={() => removeAttendee(i)} className="btn btn--icon btn--sm" style={{ marginLeft: 4 }}><X size={10} /></button>
                </span>
              ))}
            </div>
            <input
              className="input"
              placeholder="Type a team member name, email, or external guest name then Enter"
              value={attendeeInput}
              onChange={(e) => setAttendeeInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAttendeeFromText(); } }}
              list="profile-suggest"
            />
            <datalist id="profile-suggest">
              {profiles.map(p => <option key={p.id} value={p.full_name} />)}
            </datalist>
            {profiles.length > 0 && (
              <div className="row" style={{ flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>Team:</span>
                {profiles.filter(p => !attendees.some(a => a.user_id === p.id)).map(p => (
                  <button key={p.id} type="button" onClick={() => addProfile(p)} className="btn btn--sm" style={{ fontSize: 11 }}>+ {p.full_name}</button>
                ))}
              </div>
            )}
          </div>
          <div className="field">
            <div className="field__label">Description</div>
            <textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Agenda, links, prep notes..." />
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', padding: '0 16px 16px', gap: 8 }}>
          <button onClick={onClose} className="btn btn--ghost">Cancel</button>
          <button
            onClick={() => setStep('visibility')}
            className="btn btn--primary"
            disabled={!title.trim() || !start}>
            Confirm <ChevronDown size={12} style={{ transform: 'rotate(-90deg)' }} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function VisibilityPicker({ profiles, onCancel, onSave, error }: {
  profiles: Profile[];
  onCancel: () => void;
  onSave: (visibility: 'private' | 'team' | 'specific', visibleTo: string[]) => void;
  error: string | null;
}) {
  const [choice, setChoice] = useState<'private' | 'team' | 'specific'>('private');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  function toggle(id: string) {
    const n = new Set(selected); if (n.has(id)) n.delete(id); else n.add(id); setSelected(n);
  }
  return (
    <div className="modal-bg">
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal__head">
          <h3 style={{ margin: 0 }}>Who sees this meeting?</h3>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={() => setChoice('private')} className="btn" style={{ justifyContent: 'flex-start', height: 56, padding: 12, borderColor: choice === 'private' ? 'var(--stc-red)' : undefined }}>
            <Lock size={14} /> <div style={{ textAlign: 'left' }}>
              <div style={{ fontWeight: 600 }}>Just my calendar</div>
              <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>Only you can see this event</div>
            </div>
          </button>
          <button onClick={() => setChoice('specific')} className="btn" style={{ justifyContent: 'flex-start', height: 56, padding: 12, borderColor: choice === 'specific' ? 'var(--stc-red)' : undefined }}>
            <Users size={14} /> <div style={{ textAlign: 'left' }}>
              <div style={{ fontWeight: 600 }}>Specific people&apos;s calendars</div>
              <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>Pick which teammates can see it</div>
            </div>
          </button>
          <button onClick={() => setChoice('team')} className="btn" style={{ justifyContent: 'flex-start', height: 56, padding: 12, borderColor: choice === 'team' ? 'var(--stc-red)' : undefined }}>
            <Globe2 size={14} /> <div style={{ textAlign: 'left' }}>
              <div style={{ fontWeight: 600 }}>Everyone&apos;s calendar</div>
              <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>All team members will see this event</div>
            </div>
          </button>

          {choice === 'specific' && (
            <div className="card" style={{ marginTop: 8, padding: 10, maxHeight: 220, overflowY: 'auto' }}>
              <div className="field__label" style={{ marginBottom: 6 }}>Pick teammates</div>
              {profiles.map(p => (
                <label key={p.id} className="row" style={{ padding: '6px 4px', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                  <span style={{ fontSize: 13 }}>{p.full_name}</span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--fg-3)' }}>{p.email}</span>
                </label>
              ))}
              {profiles.length === 0 && <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>No other team members.</div>}
            </div>
          )}

          {error && <div className="alert alert--error" style={{ marginTop: 8 }}>{error}</div>}
        </div>
        <div className="row" style={{ justifyContent: 'space-between', padding: '0 16px 16px', gap: 8 }}>
          <button onClick={onCancel} className="btn btn--ghost">Back</button>
          <button
            onClick={() => onSave(choice, choice === 'specific' ? Array.from(selected) : [])}
            className="btn btn--primary"
            disabled={choice === 'specific' && selected.size === 0}>
            <CalendarPlus size={14} /> Schedule
          </button>
        </div>
      </div>
    </div>
  );
}
