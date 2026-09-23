'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Send, Trash2, X, Check } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Alert, Button, EmptyState, IconButton, Label } from '@/components/kit/primitives';
import type { ContactNote, Profile } from '@/lib/types';

/* =============================================================
   THE CUSTOMER'S NOTES, WHEREVER YOU ARE STANDING.

   From the business:

     When clicking into a lead and adding the latest note (at the very
     bottom) rework this so that it's a global customer note adder that
     will update the CRM record. Any other fields in the tracker relate
     to that specific deal but the latest notes one (needs renaming)
     will show when clicking into the customer in the CRM and also in
     any other leads for this customer. [...] It can be deleted or
     updated from the CRM tab after which updates the note globally
     too. Essentially a shortcut.

   So there is ONE component and one set of database functions behind
   it, used by the CRM record and by the tracker's deal drawer. A note
   written in either place is the same note, and editing or removing it
   in either place changes it in both, because there is only one row.

   Every write goes through `crm_note_add`, `crm_note_edit` and
   `crm_note_remove` from migration 144 rather than through the table,
   so the capability that refuses the button is the same capability
   that refuses the write.
   ============================================================= */

export function CustomerNotes({
  contactId, profile, readOnly = false, fromLeadId, compact = false, onChanged,
}: {
  contactId: string;
  profile: Profile;
  /** Somebody else's tracker, or a role that may read but not write. */
  readOnly?: boolean;
  /** The deal somebody was standing on when they wrote it, if any. */
  fromLeadId?: string | null;
  /** The tracker drawer has less room than the CRM record. */
  compact?: boolean;
  /** The newest note, after whatever just happened, so a grid can follow. */
  onChanged?: (latest: ContactNote | null) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  /* Somebody else's note is editable only with the CRM capability, and
     removable only with the delete one. Asked of the server rather than
     worked out from a role name here, because the server is what
     refuses the write and the two must be the same answer. */
  const [mayEditAny, setMayEditAny] = useState(false);
  const [mayRemoveAny, setMayRemoveAny] = useState(false);

  useEffect(() => {
    let dead = false;
    void (async () => {
      const [edit, del] = await Promise.all([
        supabase.rpc('command_may', { p_capability: 'crm.edit' }),
        supabase.rpc('command_may', { p_capability: 'crm.delete' }),
      ]);
      if (dead) return;
      setMayEditAny(edit.data === true);
      setMayRemoveAny(del.data === true);
    })();
    return () => { dead = true; };
  }, [supabase]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('contact_notes')
      .select('*').eq('contact_id', contactId).is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (error) setMessage(error.message);
    const list = (data ?? []) as ContactNote[];
    setNotes(list);
    setLoading(false);
    return list;
  }, [supabase, contactId]);

  useEffect(() => { void load(); }, [load]);

  async function add() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setMessage(null);
    const { error } = await supabase.rpc('crm_note_add', {
      p_contact: contactId, p_text: body, p_from_lead: fromLeadId ?? null,
    });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    setText('');
    const list = await load();
    onChanged?.(list[0] ?? null);
  }

  async function saveEdit(id: string) {
    const body = editText.trim();
    if (!body || busy) return;
    setBusy(true); setMessage(null);
    const { error } = await supabase.rpc('crm_note_edit', { p_note: id, p_text: body });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    setEditing(null);
    const list = await load();
    onChanged?.(list[0] ?? null);
  }

  async function remove(id: string) {
    if (busy) return;
    setBusy(true); setMessage(null);
    const { error } = await supabase.rpc('crm_note_remove', { p_note: id });
    setBusy(false);
    setConfirming(null);
    if (error) { setMessage(error.message); return; }
    const list = await load();
    onChanged?.(list[0] ?? null);
  }

  /* Whose note it is decides the buttons without asking the server, so
     the two rules match: your own always, somebody else's only with the
     CRM capability. The server checks again and is the one that counts,
     which is why a refusal here shows its own words rather than a
     guess. */
  const mine = (n: ContactNote) => n.author_id === profile.id;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {message && <Alert tone="danger">{message}</Alert>}

      {!readOnly && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Call summary, next step, anything worth remembering"
            style={{
              flex: 1, minHeight: compact ? 56 : 66, padding: 10, resize: 'vertical',
              borderRadius: 'var(--r)', border: '1px solid var(--border)',
              background: 'var(--surface-sunken)', color: 'var(--text)',
              fontFamily: 'var(--inter)', fontSize: 13.5, lineHeight: 1.5,
            }}
          />
          <Button variant="primary" onClick={add} disabled={!text.trim() || busy}>
            <Send size={14} /> Add
          </Button>
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-subtle)' }}>Loading</div>
      ) : notes.length === 0 ? (
        <EmptyState
          what="No notes on this customer yet."
          why="A note here belongs to the company, so it shows on every deal with them and on their CRM record."
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {notes.map((n) => {
            const canAmend  = !readOnly && (mine(n) || mayEditAny);
            const canRemove = !readOnly && (mine(n) || mayRemoveAny);
            return (
              <div key={n.id} style={{
                padding: '11px 13px', borderRadius: 'var(--r)',
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderLeft: '2px solid var(--border-emphasis)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 5, alignItems: 'center' }}>
                  <Label>{n.author_name}</Label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 11.5, color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums' }}>
                      {new Date(n.created_at).toLocaleString('en-GB', {
                        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                    {editing === n.id ? (
                      <>
                        <IconButton label="Save the change" onClick={() => saveEdit(n.id)} disabled={busy || !editText.trim()}>
                          <Check size={13} />
                        </IconButton>
                        <IconButton label="Leave it as it was" onClick={() => setEditing(null)}>
                          <X size={13} />
                        </IconButton>
                      </>
                    ) : (
                      <>
                        <IconButton
                          label={canAmend ? 'Edit this note' : 'Changing somebody else\'s note needs permission to edit the CRM'}
                          disabled={!canAmend}
                          onClick={() => { setEditing(n.id); setEditText(n.text); setConfirming(null); }}
                        >
                          <Pencil size={13} />
                        </IconButton>
                        <IconButton
                          label={canRemove ? 'Remove this note' : 'Removing somebody else\'s note needs permission to remove CRM records'}
                          danger
                          disabled={!canRemove}
                          onClick={() => setConfirming(confirming === n.id ? null : n.id)}
                        >
                          <Trash2 size={13} />
                        </IconButton>
                      </>
                    )}
                  </div>
                </div>

                {editing === n.id ? (
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    autoFocus
                    style={{
                      width: '100%', minHeight: 60, padding: 8, resize: 'vertical',
                      borderRadius: 'var(--r)', border: '1px solid var(--border-emphasis)',
                      background: 'var(--surface-sunken)', color: 'var(--text)',
                      fontFamily: 'var(--inter)', fontSize: 13.5, lineHeight: 1.55,
                    }}
                  />
                ) : (
                  <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
                    {n.text}
                  </p>
                )}

                {n.edited_at && editing !== n.id && (
                  <div style={{ marginTop: 5, fontSize: 11, color: 'var(--text-subtle)' }}>
                    Edited {new Date(n.edited_at).toLocaleString('en-GB', {
                      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </div>
                )}

                {confirming === n.id && (
                  <div style={{
                    marginTop: 8, display: 'flex', alignItems: 'center', gap: 8,
                    fontSize: 12.5, color: 'var(--text-muted)',
                  }}>
                    <span>Remove this note from the customer?</span>
                    <Button size="sm" variant="danger" onClick={() => remove(n.id)} disabled={busy}>Remove</Button>
                    <Button size="sm" onClick={() => setConfirming(null)}>Keep it</Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
