'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, CalendarPlus, Users, Mail, Lock, Globe2, ArrowRight, ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button, Alert } from '@/components/kit/primitives';
import { Modal, Field, TextInput, TextArea, Select, Segmented, OptionCard, Checkbox } from '@/components/kit/forms';
import type { CRMContact, Profile } from '@/lib/types';

/* =============================================================
   Schedule a call or a meeting.

   Moved out of CrmWorkspace so the contact drawer can own it without a
   circular import, and given the delegation the meeting asked for: Tom
   takes a call while Dave is away and books the follow-up in Dave's
   diary, so it has to land on the right person.

   Now built on the kit. The old version was the app's legacy modal:
   11px labels, a wall of same-weight fields, and a visibility step whose
   three options were styled as ordinary buttons even though choosing one
   is the whole point of the screen.

   Two caveats worth knowing, both documented in the dashboard plan:
   the event carries owner_user_id only once the dashboard migration has
   run, and the existing calendar policies let only the creator edit an
   event, so until those are rewritten the owner cannot amend a meeting
   booked for them. The picker still records the intent correctly.
   ============================================================= */

/**
 * A meeting is with the company, never with one pitch to them.
 *
 * So this takes only what identifies the company. It used to take a
 * whole `CRMContact` because a tracker row and a company were the same
 * record; now a tracker row is a lead, and passing the lead here would
 * file the meeting against the pitch and lose it when the pitch closed.
 */
export function ScheduleMeetingModal({ contact, profile, allProfiles, onClose }: {
  contact: Pick<CRMContact, 'id' | 'company_name'>;
  profile: Profile;
  allProfiles: Profile[];
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [profiles, setProfiles] = useState<Profile[]>(allProfiles);

  // A call and a site visit are booked the same way but are not the same
  // thing, and the diary reads badly when everything is called a meeting.
  const [kind, setKind] = useState<'call' | 'meeting'>('call');
  const [title, setTitle] = useState(`Call with ${contact.company_name}`);
  const [titleEdited, setTitleEdited] = useState(false);

  function pickKind(k: 'call' | 'meeting') {
    setKind(k);
    if (!titleEdited) setTitle(`${k === 'call' ? 'Call' : 'Meeting'} with ${contact.company_name}`);
  }

  // Tomorrow at 10, for an hour. Nobody books a meeting for right now.
  const tomorrow = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d; }, []);
  const oneHourLater = useMemo(() => { const d = new Date(tomorrow); d.setHours(d.getHours() + 1); return d; }, [tomorrow]);
  function toLocalISO(d: Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
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
  const [step, setStep] = useState<'form' | 'visibility'>('form');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('profiles').select('id, email, full_name, role').order('full_name');
      if (data?.length) setProfiles(data as Profile[]);
    })();
  }, [supabase]);

  function addAttendeeFromText() {
    const t = attendeeInput.trim();
    if (!t) return;
    const lower = t.toLowerCase();
    const match = profiles.find((p) => p.full_name?.toLowerCase() === lower || p.email?.toLowerCase() === lower);
    if (match && !attendees.some((a) => a.user_id === match.id)) {
      setAttendees((a) => [...a, { user_id: match.id, name: match.full_name, email: match.email }]);
    } else if (!match && !attendees.some((a) => (a.email || a.name).toLowerCase() === lower)) {
      // Free text, so treat it as a guest. If it looks like an email, store it as one.
      const isEmail = /@/.test(t);
      setAttendees((a) => [...a, isEmail ? { name: t, email: t } : { name: t }]);
    }
    setAttendeeInput('');
  }

  function removeAttendee(idx: number) {
    setAttendees((a) => a.filter((_, i) => i !== idx));
  }

  function addProfile(p: Profile) {
    if (attendees.some((a) => a.user_id === p.id)) return;
    setAttendees((a) => [...a, { user_id: p.id, name: p.full_name, email: p.email }]);
  }

  async function save(visibility: 'private' | 'team' | 'specific', visibleTo: string[]) {
    setSaving(true); setError(null);
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

    let { error: err } = await supabase.from('calendar_events').insert(payload);
    // owner_user_id only exists once the dashboard migration has run.
    if (err && /owner_user_id/.test(err.message)) {
      const { owner_user_id, ...withoutOwner } = payload;
      ({ error: err } = await supabase.from('calendar_events').insert(withoutOwner));
    }
    setSaving(false);
    if (err) { setError(err.message); return; }
    onClose();
  }

  if (step === 'visibility') {
    return <VisibilityPicker
      kind={kind}
      profiles={profiles.filter((p) => p.id !== profile.id)}
      saving={saving}
      onCancel={() => setStep('form')}
      onSave={save}
      error={error}
    />;
  }

  const owner = profiles.find((p) => p.id === ownerId);
  const others = profiles.filter((p) => p.id !== profile.id);
  const unadded = profiles.filter((p) => !attendees.some((a) => a.user_id === p.id));

  return (
    <Modal
      title="Schedule"
      description={`With ${contact.company_name}`}
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => setStep('visibility')} disabled={!title.trim() || !start}>
            Continue <ArrowRight size={14} />
          </Button>
        </>
      }
    >
      <Field label="What is it">
        <Segmented
          value={kind}
          onChange={pickKind}
          options={[
            { value: 'call', label: 'Call' },
            { value: 'meeting', label: 'Meeting' },
          ]}
        />
      </Field>

      <Field label="Title">
        <TextInput value={title} onChange={(v) => { setTitle(v); setTitleEdited(true); }} />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Starts">
          <TextInput type="datetime-local" value={start} onChange={setStart} />
        </Field>
        <Field label="Ends">
          <TextInput type="datetime-local" value={end} onChange={setEnd} />
        </Field>
      </div>

      <Field
        label="Whose diary"
        hint={ownerId !== profile.id
          ? `Booked by you, owned by ${owner?.full_name ?? 'them'}. It is shared with them automatically. Pushing it to their Outlook needs the Microsoft calendar sync, which is not connected yet.`
          : undefined}
      >
        <Select value={ownerId} onChange={setOwnerId}>
          <option value={profile.id}>{profile.full_name} (you)</option>
          {others.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </Select>
      </Field>

      <Field label="Participants">
        {attendees.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 7 }}>
            {attendees.map((a, i) => (
              <span key={i} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 4px 0 9px',
                borderRadius: 'var(--r-full)', border: '1px solid var(--border-strong)',
                background: 'var(--surface-sunken)', fontSize: 12, color: 'var(--text)',
              }}>
                {a.user_id ? <Users size={11} /> : <Mail size={11} />}
                {a.name}
                <button onClick={() => removeAttendee(i)} aria-label={`Remove ${a.name}`} style={{
                  display: 'flex', border: 'none', background: 'transparent', cursor: 'pointer',
                  color: 'var(--text-subtle)', padding: 3,
                }}><X size={11} /></button>
              </span>
            ))}
          </div>
        )}
        <TextInput
          value={attendeeInput}
          onChange={setAttendeeInput}
          placeholder="A colleague, an email address, or a guest name, then Enter"
          list="profile-suggest"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAttendeeFromText(); } }}
        />
        <datalist id="profile-suggest">
          {profiles.map((p) => <option key={p.id} value={p.full_name} />)}
        </datalist>
        {unadded.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7, alignItems: 'center' }}>
            <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>Add:</span>
            {unadded.map((p) => (
              <button key={p.id} type="button" onClick={() => addProfile(p)} style={{
                height: 24, padding: '0 9px', borderRadius: 'var(--r-full)',
                border: '1px dashed var(--border-strong)', background: 'transparent',
                color: 'var(--text-muted)', cursor: 'pointer',
                fontFamily: 'var(--inter)', fontSize: 12,
              }}>{p.full_name}</button>
            ))}
          </div>
        )}
      </Field>

      <Field label="Description">
        <TextArea value={description} onChange={setDescription} rows={3} placeholder="Agenda, links, prep notes" />
      </Field>
    </Modal>
  );
}

/* =============================================================
   Who sees it.

   Its own step rather than another field, because this is the decision
   with consequences outside the room and the old version buried it in a
   row of identical buttons. Each option says what it actually does.
   ============================================================= */
export function VisibilityPicker({ kind, profiles, saving, onCancel, onSave, error }: {
  kind?: 'call' | 'meeting';
  profiles: Profile[];
  saving?: boolean;
  onCancel: () => void;
  onSave: (visibility: 'private' | 'team' | 'specific', visibleTo: string[]) => void;
  error: string | null;
}) {
  const [choice, setChoice] = useState<'private' | 'team' | 'specific'>('private');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSelected(n);
  }

  const noun = kind === 'meeting' ? 'meeting' : 'call';

  return (
    <Modal
      title={`Who sees this ${noun}?`}
      description="Calendars are shared across the team, so this is worth a moment."
      onClose={onCancel}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}><ArrowLeft size={14} /> Back</Button>
          <span style={{ flex: 1 }} />
          <Button
            variant="primary"
            onClick={() => onSave(choice, choice === 'specific' ? Array.from(selected) : [])}
            disabled={saving || (choice === 'specific' && selected.size === 0)}
          >
            <CalendarPlus size={14} /> {saving ? 'Scheduling' : 'Schedule'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <OptionCard
          selected={choice === 'private'}
          onSelect={() => setChoice('private')}
          icon={<Lock size={15} />}
          title="Just my calendar"
          description="Nobody else sees it, including the people invited to it."
        />
        <OptionCard
          selected={choice === 'specific'}
          onSelect={() => setChoice('specific')}
          icon={<Users size={15} />}
          title="Chosen colleagues"
          description="Pick who it appears for. The diary owner is always included."
        />
        <OptionCard
          selected={choice === 'team'}
          onSelect={() => setChoice('team')}
          icon={<Globe2 size={15} />}
          title="Everyone"
          description="It shows on the team calendar for all staff."
        />
      </div>

      {choice === 'specific' && (
        <div style={{
          padding: '11px 13px', borderRadius: 'var(--r)',
          border: '1px solid var(--border)', background: 'var(--surface)',
          maxHeight: 220, overflowY: 'auto',
        }}>
          {profiles.length === 0
            ? <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>There is nobody else on the system yet.</span>
            : profiles.map((p) => (
              <Checkbox
                key={p.id}
                checked={selected.has(p.id)}
                onChange={() => toggle(p.id)}
                label={p.full_name}
                hint={p.email}
              />
            ))}
        </div>
      )}

      {error && <Alert tone="danger">{error}</Alert>}
    </Modal>
  );
}
