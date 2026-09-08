'use client';

import { useMemo, useState } from 'react';
import { Bell, Loader } from 'lucide-react';
import { Alert, Button } from '@/components/kit/primitives';
import { Field, Modal, Select, Split, TextArea, TextInput } from '@/components/kit/forms';
import type { CRMContact } from '@/lib/types';

/* =============================================================
   Remind me about this customer.

   ---- What it is ----

   From the business:

     When you set a reminder, it's typically a personal task so it should
     push to Work (and to dashboard if it's one of today's tasks to see
     on login)

   So a reminder is not a fourth kind of record. It is a task, in the
   Work tab, raised on yourself, due at a time you pick, carrying the
   customer it came from. Everything Work already does then applies to
   it: it appears in My work, it can be dragged on the board, it can be
   completed, and the dashboard's "Needs you today" reads it because
   that strip now reads tasks due today.

   Making it its own table would have meant a second list of things
   people owe, which is how two of them end up disagreeing about what
   you are supposed to be doing.

   ---- Why the times are a list and not a clock ----

   Reminders are set in the twenty seconds after a phone call. Four
   presets and a full date field covers it: "tomorrow morning" is the
   answer nine times out of ten, and picking 09:00 from a time control on
   a phone takes longer than the call did.
   ============================================================= */

/** 09:00 tomorrow, and the rest, as an ISO string. */
function at(days: number, hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

/** The local `datetime-local` value for an ISO instant. */
function localValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const PRESETS: { key: string; label: string; when: () => string }[] = [
  { key: 'later',    label: 'Later today',       when: () => at(0, Math.min(23, new Date().getHours() + 3)) },
  { key: 'tomorrow', label: 'Tomorrow morning',  when: () => at(1, 9) },
  { key: 'week',     label: 'In a week',         when: () => at(7, 9) },
  { key: 'month',    label: 'In a month',        when: () => at(30, 9) },
];

export function ReminderModal({ contact, me, onClose, onDone }: {
  contact: CRMContact;
  /** Who it lands on. Always the person setting it: see below. */
  me: string;
  onClose: () => void;
  /** So the record can say the reminder landed, without a page reload. */
  onDone: (message: string) => void;
}) {
  const [title, setTitle] = useState(`Follow up ${contact.company_name}`);
  const [note, setNote] = useState('');
  const [preset, setPreset] = useState('tomorrow');
  const [when, setWhen] = useState(() => at(1, 9));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dueToday = useMemo(() => {
    const d = new Date(when);
    const now = new Date();
    return d.getFullYear() === now.getFullYear()
      && d.getMonth() === now.getMonth()
      && d.getDate() === now.getDate();
  }, [when]);

  async function save() {
    const what = title.trim();
    if (!what) { setError('Give the reminder something to say.'); return; }
    setSaving(true);
    setError(null);

    const res = await fetch('/api/work/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: what,
        description: note.trim() || null,
        /* On yourself. A reminder you can put on somebody else is a
           delegation, and Work already has a screen for that with a
           refusal path attached to it. */
        assignee_kind: 'person',
        assignee_id: me,
        status: 'ready',
        priority: 'p2',
        due_at: when,
        /* What it is about, so "what is outstanding on Dawson" has an
           answer and so the record can list it back. */
        organisation_id: contact.id,
        source: 'reminder',
      }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { setError(json.error ?? 'That reminder did not save.'); return; }

    onDone(dueToday
      ? 'Reminder set. It is on your Work tab and on your dashboard for today.'
      : 'Reminder set. It is on your Work tab, and on your dashboard on the day.');
  }

  return (
    <Modal
      title="Set a reminder"
      description={`A task on you about ${contact.company_name}, in the Work tab.`}
      width={480}
      onClose={onClose}
      footer={<>
        <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={save} disabled={saving || !title.trim()}>
          {saving ? <Loader size={13} className="spin" /> : <Bell size={13} />} Set reminder
        </Button>
      </>}
    >
      {error && <Alert tone="danger">{error}</Alert>}

      <Field label="Remind me to">
        <TextInput value={title} onChange={setTitle} placeholder="Ring them about the curtainsider quote" />
      </Field>

      <Split>
        <Field label="When">
          <Select value={preset} onChange={(v) => {
            setPreset(v);
            const found = PRESETS.find((p) => p.key === v);
            if (found) setWhen(found.when());
          }}>
            {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            <option value="custom">Pick a time</option>
          </Select>
        </Field>
        <Field label="Due" hint={dueToday ? 'Today, so it shows on your dashboard' : undefined}>
          <TextInput
            type="datetime-local"
            value={localValue(when)}
            onChange={(v) => {
              if (!v) return;
              setPreset('custom');
              setWhen(new Date(v).toISOString());
            }}
          />
        </Field>
      </Split>

      <Field label="Anything to add" hint="Optional. Shows on the task.">
        <TextArea rows={2} value={note} onChange={setNote}
          placeholder="They are out until the 14th, ask for Julie" />
      </Field>
    </Modal>
  );
}
