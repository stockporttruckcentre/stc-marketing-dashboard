'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  X, Building2, Plus, Trash2, Star, Send, CalendarPlus, FileText,
  MoreHorizontal, ChevronDown, Calendar, Link2, MapPin, Map as MapIcon, Share2, PenLine,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { extractCityFromAddress } from '@/lib/uk-cities';
import {
  Button, Badge, Label, SectionHead, EmptyState, NotProvisioned, Alert, type Tone,
} from '@/components/kit/primitives';
import { Segmented } from '@/components/kit/forms';
import { ScheduleMeetingModal } from './ScheduleMeetingModal';
import { GenerateProposalPicker } from './GenerateProposalPicker';
import { AddressMap } from './AddressMap';
import type { CRMContact, ContactStatus, CrmList, Profile, ContactNote, ContactAddress } from '@/lib/types';

/* =============================================================
   Contact drawer.

   Rebuilt on the kit. The old one put every field on screen at once
   in 12px text, marked its sections with eyebrows that read as noise,
   floated the company icon away from the name, and buried the actions
   in a row of small ghost buttons at the bottom.

   This one leads with who the customer is and what you would do next,
   groups the fields into named sections at the kit's 14px base, and
   folds the long tail (addresses, links) away until asked for.
   ============================================================= */

const STATUSES: ContactStatus[] = ['lead', 'contacted', 'quoted', 'won', 'customer', 'lost'];

/** Where a deal has to be before anything is worth signing. */
const SIGNABLE: string[] = ['quoted', 'won', 'customer'];

const SIDE_LABEL: Record<string, string> = {
  trailer_sales: 'Sales and leasing',
  maintenance: 'Maintenance',
};

const STATUS_TONE: Record<string, Tone> = {
  lead: 'info', contacted: 'warning', quoted: 'accent',
  won: 'success', customer: 'success', lost: 'neutral',
};

type Member = { list_id: string; user_id: string; can_edit: boolean };

export function ContactDrawer({
  contact, profile, canEdit, lists, onClose, onChange, onDelete,
}: {
  contact: CRMContact; profile: Profile; canEdit: boolean;
  lists: CrmList[]; members: Member[];
  onClose: () => void; onChange: (c: CRMContact) => void; onDelete: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [edit, setEdit] = useState<CRMContact>(contact);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [noteText, setNoteText] = useState('');
  const [loadingNotes, setLoadingNotes] = useState(true);
  const [meetings, setMeetings] = useState<any[]>([]);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showProposal, setShowProposal] = useState(false);
  const [showAddLink, setShowAddLink] = useState<null | 'website' | 'linkedin' | 'other'>(null);
  const [movePickerOpen, setMovePickerOpen] = useState<'move' | 'duplicate' | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [alsoOn, setAlsoOn] = useState<{ id: string; name: string; company: string; side: string; status: string }[]>([]);
  const [linked, setLinked] = useState<any[]>([]);
  const [linkAvailable, setLinkAvailable] = useState(true);
  const [linking, setLinking] = useState(false);
  const [addresses, setAddresses] = useState<ContactAddress[]>([]);
  const [showMap, setShowMap] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => { setEdit(contact); }, [contact]);

  const loadAddresses = useCallback(async () => {
    const { data } = await supabase.from('contact_addresses').select('*')
      .eq('contact_id', contact.id)
      .order('is_primary', { ascending: false }).order('created_at', { ascending: true });
    setAddresses((data ?? []) as ContactAddress[]);
  }, [supabase, contact.id]);
  useEffect(() => { loadAddresses(); }, [loadAddresses]);

  useEffect(() => {
    (async () => {
      setLoadingNotes(true);
      const { data } = await supabase.from('contact_notes').select('*')
        .eq('contact_id', contact.id).order('created_at', { ascending: false });
      setNotes((data ?? []) as ContactNote[]);
      setLoadingNotes(false);
    })();
  }, [supabase, contact.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('calendar_events').select('*')
        .eq('contact_id', contact.id).order('start_at', { ascending: true });
      if (!cancelled) setMeetings(data ?? []);
    })();
    return () => { cancelled = true; };
  }, [supabase, contact.id, showSchedule]);

  /**
   * Two questions with one answer: which records are deliberately twinned
   * with this one, and which look like the same customer but are not
   * linked yet. Showing them together is what turns an accidental
   * duplicate into a decision rather than a mystery.
   */
  const loadSameCustomer = useCallback(async () => {
    const res = await fetch(`/api/crm/link?id=${contact.id}`).then((r) => r.json()).catch(() => null);
    if (res) {
      setLinked(res.linked ?? []);
      setLinkAvailable(res.available !== false);
    }

    const linkedIds = new Set<string>(((res?.linked ?? []) as any[]).map((r) => r.id));
    let q = supabase.from('crm_contacts')
      .select('id, company_name, list_id, side, status')
      .neq('id', contact.id);
    q = contact.email
      ? q.eq('email', contact.email)
      : q.eq('company_name', contact.company_name);
    const { data } = await q;
    setAlsoOn(((data ?? []) as any[])
      .filter((r) => !linkedIds.has(r.id))
      .map((r) => ({
        id: r.id,
        name: lists.find((l) => l.id === r.list_id)?.name ?? 'Another list',
        company: r.company_name, side: r.side ?? 'trailer_sales', status: r.status,
      })));
  }, [supabase, contact.id, contact.email, contact.company_name, lists]);

  useEffect(() => { loadSameCustomer(); }, [loadSameCustomer]);

  async function linkAction(action: 'create_twin' | 'link' | 'unlink', targetId?: string) {
    setLinking(true);
    const res = await fetch('/api/crm/link', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, contact_id: contact.id, target_id: targetId }),
    }).then((r) => r.json()).catch((e) => ({ error: e.message }));
    setLinking(false);
    setMessage(res.error ?? res.message ?? null);
    if (!res.error) loadSameCustomer();
  }

  async function saveField(field: keyof CRMContact, value: any) {
    if ((contact as any)[field] === value) return;
    const patch: any = { [field]: value };
    if (field === 'address' && typeof value === 'string') {
      const city = extractCityFromAddress(value);
      if (city && city !== contact.location) patch.location = city;
    }
    const { data, error } = await supabase.from('crm_contacts')
      .update(patch).eq('id', contact.id).select('*').single();
    if (error) {
      // Columns added by a migration that has not been run yet say so in
      // plain terms, rather than showing a Postgres error to a salesman.
      const missing = /column .*"?(\w+)"? .*does not exist|Could not find the '(\w+)' column/i.exec(error.message);
      setMessage(missing
        ? `Saving ${String(field).replace(/_/g, ' ')} needs a database change that has not been applied yet. Everything else on this record still saves.`
        : error.message);
      return;
    }
    setEdit(data as CRMContact); onChange(data as CRMContact);
  }

  async function addNote() {
    if (!noteText.trim()) return;
    const { data, error } = await supabase.from('contact_notes').insert({
      contact_id: contact.id, author_id: profile.id,
      author_name: profile.full_name, text: noteText.trim(),
    }).select('*').single();
    if (error) { setMessage(error.message); return; }
    setNotes((n) => [data as ContactNote, ...n]);
    setNoteText('');
    onChange({ ...contact, notes: (data as ContactNote).text });
  }

  async function addLink(kind: string, label: string, url: string) {
    if (!url.trim()) return;
    const fresh = [...(contact.links ?? []), {
      id: crypto.randomUUID(),
      label: label.trim() || kind, url: url.trim(), kind: kind as any,
    }];
    const { data, error } = await supabase.from('crm_contacts')
      .update({ links: fresh }).eq('id', contact.id).select('*').single();
    if (error) { setMessage(error.message); return; }
    setEdit(data as CRMContact); onChange(data as CRMContact); setShowAddLink(null);
  }

  async function removeLink(id: string) {
    const fresh = (contact.links ?? []).filter((l) => l.id !== id);
    const { data, error } = await supabase.from('crm_contacts')
      .update({ links: fresh }).eq('id', contact.id).select('*').single();
    if (error) { setMessage(error.message); return; }
    setEdit(data as CRMContact); onChange(data as CRMContact);
  }

  async function moveToList(targetListId: string, mode: 'move' | 'duplicate') {
    if (mode === 'move') {
      const { data, error } = await supabase.from('crm_contacts')
        .update({ list_id: targetListId }).eq('id', contact.id).select('*').single();
      if (error) { setMessage(error.message); return; }
      onChange(data as CRMContact); setMovePickerOpen(null); onClose();
    } else {
      const { id, created_at, updated_at, ...rest } = contact as any;
      const { error } = await supabase.from('crm_contacts').insert({ ...rest, list_id: targetListId });
      if (error) { setMessage(error.message); return; }
      setMovePickerOpen(null);
      setMessage(`Copied to ${lists.find((l) => l.id === targetListId)?.name}`);
    }
  }

  const fleetTotal = (edit.trucks ?? 0) + (edit.trailers ?? 0) + (edit.vans ?? 0);
  const upcoming = meetings.filter((m) => new Date(m.start_at).getTime() > Date.now());
  const metaLine = [edit.contact_name, edit.location, edit.assigned_to && `Owned by ${edit.assigned_to}`]
    .filter(Boolean).join(' · ');

  return (
    <div className="kit" onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 900,
      background: 'rgba(5, 13, 38, 0.5)',
      display: 'flex', justifyContent: 'flex-end',
    }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(660px, 100%)', height: '100%', overflowY: 'auto',
          background: 'var(--bg)', borderLeft: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* ---- header: who they are, and what you would do next ---- */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 2,
          background: 'var(--surface)', borderBottom: '1px solid var(--border)',
          padding: '18px 22px 14px',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <div style={{
              width: 44, height: 44, flexShrink: 0, borderRadius: 'var(--r-md)',
              background: 'var(--bg-subtle)', border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--accent)',
            }}>
              <Building2 size={21} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h2 style={{
                  margin: 0, fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 22,
                  lineHeight: 1.2, letterSpacing: '-0.025em', color: 'var(--text)',
                }}>{edit.company_name}</h2>
                <Badge tone={STATUS_TONE[edit.status] ?? 'neutral'} dot>{edit.status}</Badge>
              {edit.relationship === 'existing' && <Badge tone="success">Customer</Badge>}
              </div>
              {metaLine && (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{metaLine}</div>
              )}
              {linked.length > 0 && (
                <div style={{ marginTop: 7, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Label>Same customer</Label>
                  {linked.map((l: any) => (
                    <Badge key={l.id} tone="accent">{SIDE_LABEL[l.side] ?? l.side}</Badge>
                  ))}
                </div>
              )}
            </div>
            <button onClick={onClose} aria-label="Close"
              style={{ border: 'none', background: 'transparent', color: 'var(--text-subtle)', cursor: 'pointer', display: 'flex', padding: 4 }}>
              <X size={18} />
            </button>
          </div>

          {canEdit && (
            <div style={{ display: 'flex', gap: 7, marginTop: 14, flexWrap: 'wrap', position: 'relative' }}>
              <Button size="sm" variant="accent" onClick={() => setShowProposal(true)}>
                <FileText size={13} /> Generate proposal
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setShowSchedule(true)}>
                <CalendarPlus size={13} /> Schedule
              </Button>
              <Button size="sm" variant="secondary"
                onClick={() => window.open(`/export/crm/${contact.id}`, '_blank', 'noopener')}>
                <Share2 size={13} /> Export
              </Button>
              {/* Only on a converting prospect, which is when it is any
                  use. On a fresh lead it would be a fourth button in the
                  row earning nothing.

                  It opens the DocuSign home page and stops there. That
                  was decided in the meeting and it is not laziness: the
                  CRM sits behind the VPN, so anything it generates is a
                  file rather than something signable through a link, and
                  a half-built envelope would be worse than none. The user
                  picks their own template, of which Tom keeps two because
                  sales and leasing and the workshop are separate
                  entities. */}
              {SIGNABLE.includes(edit.status) && (
                <Button size="sm" variant="secondary"
                  onClick={() => window.open('https://app.docusign.com/', '_blank', 'noopener')}
                  title="Opens DocuSign so you can build and send the envelope yourself">
                  <PenLine size={13} /> DocuSign
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setOverflowOpen((v) => !v)} aria-label="More actions">
                <MoreHorizontal size={15} />
              </Button>
              {overflowOpen && (
                <>
                  <div onClick={() => setOverflowOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1 }} />
                  <div style={{
                    position: 'absolute', top: 38, right: 0, zIndex: 2, minWidth: 190,
                    background: 'var(--surface-raised)', border: '1px solid var(--border)',
                    borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-3)', padding: 4,
                  }}>
                    {[
                      { label: 'Move to another list', on: () => setMovePickerOpen('move') },
                      { label: 'Copy to another list', on: () => setMovePickerOpen('duplicate') },
                    ].map((a) => (
                      <button key={a.label} onClick={() => { setOverflowOpen(false); a.on(); }}
                        style={menuItem}>{a.label}</button>
                    ))}
                    <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                    <button onClick={() => { setOverflowOpen(false); onDelete(); }}
                      style={{ ...menuItem, color: 'var(--danger)' }}>Delete contact</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: '18px 22px 40px', display: 'flex', flexDirection: 'column', gap: 26 }}>
          {message && <Alert tone="info">{message}</Alert>}

          {/* ---- contact ---- */}
          <section>
            <SectionHead title="Contact" />
            <FieldGrid>
              <Field label="Contact name" value={edit.contact_name} onSave={(v) => saveField('contact_name', v)} canEdit={canEdit} />
              <Field label="Email" value={edit.email} onSave={(v) => saveField('email', v)} canEdit={canEdit} />
              <Field label="Phone" value={edit.phone} onSave={(v) => saveField('phone', v)} canEdit={canEdit} />
              <Field label="Owned by" value={edit.assigned_to} onSave={(v) => saveField('assigned_to', v)} canEdit={canEdit} />
            </FieldGrid>
          </section>

          {/* ---- commercial ---- */}
          <section>
            <SectionHead title="Commercial" />
            <FieldGrid>
              <div>
                <Label>Status</Label>
                <select
                  disabled={!canEdit}
                  value={edit.status}
                  onChange={(e) => saveField('status', e.target.value)}
                  style={{ ...inputStyle, marginTop: 6 }}
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <Label>Relationship</Label>
                {/* Not the same question as status, and next to it on
                    purpose so the difference is obvious. Status is where
                    a deal is. This is whether they were already trading
                    with us, which is what splits the proposal pipelines
                    Tom asked to see separately. */}
                <div style={{ marginTop: 6 }}>
                  <Segmented
                    value={edit.relationship ?? 'prospect'}
                    onChange={(v) => canEdit && saveField('relationship', v)}
                    options={[
                      { value: 'prospect', label: 'Prospect' },
                      { value: 'existing', label: 'Customer' },
                    ]}
                  />
                </div>
              </div>
              <NumberField label="Estimated value" value={edit.estimated_value} prefix="£"
                onSave={(n) => saveField('estimated_value', n)} canEdit={canEdit} />
              <NumberField label="Employees" value={edit.employee_count}
                onSave={(n) => saveField('employee_count', n)} canEdit={canEdit} />
              <NumberField label="Turnover" value={edit.turnover} prefix="£"
                onSave={(n) => saveField('turnover', n)} canEdit={canEdit} />
            </FieldGrid>
          </section>

          {/* ---- fleet ---- */}
          <section>
            <SectionHead title="Fleet" hint={fleetTotal > 0 ? `${fleetTotal} units` : undefined} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              <NumberField label="Trucks" value={edit.trucks} onSave={(n) => saveField('trucks', n)} canEdit={canEdit} />
              <NumberField label="Trailers" value={edit.trailers} onSave={(n) => saveField('trailers', n)} canEdit={canEdit} />
              <NumberField label="Vans" value={edit.vans} onSave={(n) => saveField('vans', n)} canEdit={canEdit} />
            </div>
          </section>

          {/* ---- meetings ---- */}
          <section>
            <SectionHead
              title="Meetings"
              hint={upcoming.length ? `${upcoming.length} upcoming` : undefined}
              action={canEdit ? <Button size="sm" variant="secondary" onClick={() => setShowSchedule(true)}>Schedule</Button> : undefined}
            />
            {meetings.length === 0 ? (
              <EmptyState
                what="Nothing booked with this customer."
                why="Calls and visits scheduled here appear on your dashboard and in the team calendar."
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {meetings.map((m) => {
                  const past = new Date(m.start_at).getTime() < Date.now();
                  return (
                    <div key={m.id} style={{
                      display: 'flex', alignItems: 'center', gap: 11, minHeight: 36,
                      padding: '7px 0', borderBottom: '1px solid var(--border)', opacity: past ? 0.55 : 1,
                    }}>
                      <Calendar size={15} style={{ color: past ? 'var(--text-subtle)' : 'var(--accent)', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)' }}>{m.title}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums' }}>
                          {new Date(m.start_at).toLocaleString('en-GB', {
                            weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                          })}{past ? ' · past' : ''}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ---- the long tail, folded away ---- */}
          {/* Open as soon as there is an address to show, and the map
              button carries navy rather than the quiet secondary it had.
              Seeing where a customer's sites are is most of the point of
              keeping them, and it was behind a closed section and a
              button you would scan straight past. Navy and not red
              because the red on this screen belongs to Generate
              proposal, and a screen with two red buttons has none. */}
          <Collapsible
            icon={<MapPin size={14} />}
            title="Addresses"
            count={addresses.length || undefined}
            defaultOpen={addresses.length > 0}
            action={addresses.length > 0 ? (
              <Button variant="primary" onClick={(e) => { e.stopPropagation(); setShowMap(true); }}>
                <MapIcon size={14} /> View on map
              </Button>
            ) : undefined}
          >
            <AddressList
              contactId={edit.id}
              items={addresses}
              reload={loadAddresses}
              canEdit={canEdit}
              legacyAddress={edit.address}
              onPrimaryChange={(addr, city) => onChange({ ...edit, address: addr, location: city ?? edit.location })}
            />
          </Collapsible>

          <Collapsible
            icon={<Link2 size={14} />}
            title="Links"
            count={(edit.links ?? []).length}
            defaultOpen={false}
            action={canEdit ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setShowAddLink('website'); }}>Website</Button>
                <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setShowAddLink('linkedin'); }}>Social</Button>
              </div>
            ) : undefined}
          >
            {(edit.links ?? []).length === 0 ? (
              <EmptyState
                what="No links saved."
                why="A website is what Lusha needs to enrich this record, so it is worth adding one."
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {edit.links.map((l) => (
                  <div key={l.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 11px', borderRadius: 'var(--r)',
                    border: '1px solid var(--border)', background: 'var(--surface)',
                  }}>
                    <Badge tone="neutral">{l.kind}</Badge>
                    <a href={l.url} target="_blank" rel="noopener noreferrer"
                      style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.label}
                      <span style={{ color: 'var(--text-subtle)', marginLeft: 8, fontSize: 12 }}>{l.url}</span>
                    </a>
                    {canEdit && (
                      <button onClick={() => removeLink(l.id)} aria-label="Remove link"
                        style={{ border: 'none', background: 'transparent', color: 'var(--text-subtle)', cursor: 'pointer', display: 'flex' }}>
                        <X size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {showAddLink && (
              <AddLinkForm kind={showAddLink} onSave={(label, url) => addLink(showAddLink, label, url)} onCancel={() => setShowAddLink(null)} />
            )}
          </Collapsible>

          {/* ---- the same business, under more than one account ---- */}
          <section>
            <SectionHead
              title="Same customer"
              hint={linked.length ? `${linked.length + 1} accounts` : undefined}
            />
            {!linkAvailable ? (
              <NotProvisioned
                what="Sales and maintenance accounts for one business, linked so nobody types the details twice."
                needs="migration 003"
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {linked.map((l: any) => (
                  <div key={l.id} style={{
                    display: 'flex', alignItems: 'center', gap: 11,
                    padding: '10px 12px', borderRadius: 'var(--r)',
                    border: '1px solid var(--border)', background: 'var(--surface)',
                    borderLeft: '2px solid var(--accent)',
                  }}>
                    <Building2 size={15} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>
                        {SIDE_LABEL[l.side] ?? l.side}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{l.status}</div>
                    </div>
                    <Button size="sm" variant="ghost"
                      onClick={() => window.location.assign(`/dashboard/crm?contact=${l.id}`)}>Open</Button>
                  </div>
                ))}

                {canEdit && !linked.some((l: any) => l.side !== (edit.side ?? 'trailer_sales')) && (
                  <Button variant="secondary" disabled={linking}
                    onClick={() => linkAction('create_twin')}>
                    <Plus size={13} />
                    Create the {(edit.side ?? 'trailer_sales') === 'maintenance' ? 'sales and leasing' : 'maintenance'} account
                  </Button>
                )}

                {alsoOn.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <Label>Looks like the same customer, not linked</Label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                      {alsoOn.map((a) => (
                        <div key={a.id} style={{
                          display: 'flex', alignItems: 'center', gap: 11,
                          padding: '9px 12px', borderRadius: 'var(--r)',
                          border: '1px dashed var(--border-strong)', background: 'var(--surface-sunken)',
                        }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {a.company}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                              {SIDE_LABEL[a.side] ?? a.side} · {a.status} · {a.name}
                            </div>
                          </div>
                          {canEdit && (
                            <Button size="sm" variant="secondary" disabled={linking}
                              onClick={() => linkAction('link', a.id)}>Link</Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {linked.length === 0 && alsoOn.length === 0 && (
                  <EmptyState
                    what="This is the only account for this business."
                    why="Some customers need a sales and leasing account and a maintenance account, because they are separate entities in Protean. Creating the second one copies the details across."
                  />
                )}

                {canEdit && edit.parent_customer_id && (
                  <Button size="sm" variant="ghost" disabled={linking}
                    onClick={() => linkAction('unlink')}>Unlink this account</Button>
                )}
              </div>
            )}
          </section>

          {/* ---- notes ---- */}
          <section>
            <SectionHead title="Notes and history" hint={notes.length ? `${notes.length}` : undefined} />
            {canEdit && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 14 }}>
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Call summary, next step, anything worth remembering"
                  style={{ ...inputStyle, minHeight: 66, padding: 10, flex: 1, resize: 'vertical' }}
                />
                <Button variant="primary" onClick={addNote} disabled={!noteText.trim()}>
                  <Send size={14} /> Add
                </Button>
              </div>
            )}
            {loadingNotes ? (
              <div style={{ fontSize: 13, color: 'var(--text-subtle)' }}>Loading</div>
            ) : notes.length === 0 ? (
              <EmptyState
                what="No notes yet."
                why="The newest note shows in the grid, so the team can see where this stands without opening the record."
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {notes.map((n) => (
                  <div key={n.id} style={{
                    padding: '11px 13px', borderRadius: 'var(--r)',
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    borderLeft: '2px solid var(--border-emphasis)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 5 }}>
                      <Label>{n.author_name}</Label>
                      <span style={{ fontSize: 11.5, color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums' }}>
                        {new Date(n.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{n.text}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {showSchedule && (
          <ScheduleMeetingModal contact={edit} profile={profile} allProfiles={[]} onClose={() => setShowSchedule(false)} />
        )}
        {showProposal && (
          <GenerateProposalPicker contact={edit} onClose={() => setShowProposal(false)} />
        )}
        {showMap && (
          <AddressMap
            contactId={edit.id}
            addresses={addresses}
            canEdit={canEdit}
            onClose={() => setShowMap(false)}
            onChanged={loadAddresses}
          />
        )}
        {movePickerOpen && (
          <ListPicker
            title={movePickerOpen === 'move' ? 'Move to which list?' : 'Copy to which list?'}
            lists={lists.filter((l) => l.id !== contact.list_id)}
            onPick={(id) => moveToList(id, movePickerOpen)}
            onClose={() => setMovePickerOpen(null)}
          />
        )}
      </div>
    </div>
  );
}

/* ---------------- pieces ---------------- */

const inputStyle: React.CSSProperties = {
  width: '100%', height: 32, padding: '0 10px', borderRadius: 'var(--r)',
  border: '1px solid var(--border-strong)', background: 'var(--surface)',
  color: 'var(--text)', fontFamily: 'var(--inter)', fontSize: 13.5, outline: 'none',
};

const menuItem: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '7px 10px', borderRadius: 'var(--r)', border: 'none',
  background: 'transparent', color: 'var(--text)',
  fontFamily: 'var(--inter)', fontSize: 13, cursor: 'pointer',
};

function FieldGrid({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>{children}</div>;
}

function Field({
  label, value, onSave, canEdit,
}: { label: string; value: string | null; onSave: (v: string) => void; canEdit: boolean }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => { setV(value ?? ''); }, [value]);
  return (
    <div>
      <Label>{label}</Label>
      <input
        disabled={!canEdit} value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => onSave(v)}
        placeholder={canEdit ? 'Not set' : ''}
        style={{ ...inputStyle, marginTop: 6 }}
      />
    </div>
  );
}

function NumberField({
  label, value, onSave, canEdit, prefix,
}: { label: string; value: number | null; onSave: (n: number | null) => void; canEdit: boolean; prefix?: string }) {
  const [v, setV] = useState(value?.toString() ?? '');
  useEffect(() => { setV(value?.toString() ?? ''); }, [value]);
  return (
    <div>
      <Label>{label}</Label>
      <div style={{ position: 'relative', marginTop: 6 }}>
        {prefix && (
          <span style={{
            position: 'absolute', left: 10, top: 0, height: 32, display: 'flex', alignItems: 'center',
            fontSize: 13.5, color: 'var(--text-subtle)', pointerEvents: 'none',
          }}>{prefix}</span>
        )}
        <input
          type="number" min={0} disabled={!canEdit} value={v}
          onChange={(e) => setV(e.target.value)}
          onBlur={() => onSave(v === '' ? null : Number(v))}
          style={{ ...inputStyle, paddingLeft: prefix ? 22 : 10, fontVariantNumeric: 'tabular-nums' }}
        />
      </div>
    </div>
  );
}

/** A section that stays out of the way until it is wanted. */
function Collapsible({
  title, icon, count, children, action, defaultOpen,
}: { title: string; icon?: ReactNode; count?: number; children: ReactNode; action?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  /**
   * Sections whose contents arrive over the network start closed and
   * should open once there is something in them. `useState` reads its
   * argument once, at mount, when the addresses have not loaded yet, so
   * without this the Addresses section stays shut on every record that
   * has any. Forced open once only: after that it is the user's.
   */
  const forced = useRef(false);
  useEffect(() => {
    if (defaultOpen && !forced.current) { forced.current = true; setOpen(true); }
  }, [defaultOpen]);
  return (
    <section>
      <div
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
          paddingBottom: 10, borderBottom: open ? '1px solid var(--border)' : 'none',
        }}
      >
        <ChevronDown size={14} style={{
          color: 'var(--text-subtle)', flexShrink: 0,
          transform: open ? 'none' : 'rotate(-90deg)',
          transition: 'transform 120ms cubic-bezier(0.2,0,0,1)',
        }} />
        {icon && <span style={{ color: 'var(--text-subtle)', display: 'flex' }}>{icon}</span>}
        <h3 style={{
          margin: 0, fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 15,
          letterSpacing: '-0.02em', color: 'var(--text)', flex: 1,
        }}>{title}</h3>
        {count != null && <Badge tone="neutral">{count}</Badge>}
        {action}
      </div>
      {open && <div style={{ paddingTop: 12 }}>{children}</div>}
    </section>
  );
}

function ListPicker({
  title, lists, onPick, onClose,
}: { title: string; lists: CrmList[]; onPick: (id: string) => void; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(5,13,38,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 'min(420px, 100%)', background: 'var(--surface-raised)',
        border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
        boxShadow: 'var(--shadow-4)', padding: 18,
      }}>
        <SectionHead title={title} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {lists.map((l) => (
            <button key={l.id} onClick={() => onPick(l.id)} style={{
              ...menuItem, height: 38, border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', fontWeight: 500,
            }}>{l.name}</button>
          ))}
          {lists.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--text-subtle)' }}>There is nowhere else to put it yet.</div>
          )}
        </div>
        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

function AddLinkForm({ kind, onSave, onCancel }: { kind: string; onSave: (label: string, url: string) => void; onCancel: () => void }) {
  const [label, setLabel] = useState(kind === 'website' ? 'Main site' : 'LinkedIn');
  const [url, setUrl] = useState('');
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSave(label, url); }}
      style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}
    >
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label"
        style={{ ...inputStyle, width: 130 }} />
      <input value={url} onChange={(e) => setUrl(e.target.value)} required autoFocus
        placeholder={kind === 'website' ? 'customer.co.uk' : 'linkedin.com/company/...'}
        style={{ ...inputStyle, flex: 1, minWidth: 180 }} />
      <Button type="submit" variant="primary" size="sm">Save</Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
    </form>
  );
}

function AddressList({
  contactId, items, reload, canEdit, legacyAddress, onPrimaryChange,
}: {
  contactId: string; items: ContactAddress[]; reload: () => void;
  canEdit: boolean; legacyAddress: string | null;
  onPrimaryChange: (a: string, c: string | null) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const load = reload;

  async function save(id: string, patch: Partial<ContactAddress>) {
    const next: any = { ...patch };
    if (patch.address !== undefined) next.city = patch.address ? extractCityFromAddress(patch.address) : null;
    await supabase.from('contact_addresses').update(next).eq('id', id);
    load();
  }
  async function setPrimary(id: string) {
    await supabase.from('contact_addresses').update({ is_primary: true }).eq('id', id);
    const { data } = await supabase.from('crm_contacts').select('address, location').eq('id', contactId).single();
    if (data) onPrimaryChange((data as any).address ?? '', (data as any).location ?? null);
    load();
  }
  async function add() {
    await supabase.from('contact_addresses').insert({ contact_id: contactId, label: 'New location', address: '', is_primary: items.length === 0 });
    load();
  }
  async function remove(id: string) {
    if (!confirm('Delete this address?')) return;
    await supabase.from('contact_addresses').delete().eq('id', id);
    load();
  }

  if (items.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <EmptyState
          what={legacyAddress ? 'One address on the old single field.' : 'No address saved.'}
          why={legacyAddress
            ? 'Adding it properly lets a customer have more than one site, with one marked as head office.'
            : 'A customer can have several sites. The one marked primary sets the location shown in the grid.'}
          action={canEdit ? <Button size="sm" variant="secondary" onClick={add}>Add an address</Button> : undefined}
        />
        {legacyAddress && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', padding: '10px 12px', background: 'var(--surface-sunken)', borderRadius: 'var(--r)' }}>
            {legacyAddress}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((a) => (
        <div key={a.id} style={{
          border: '1px solid var(--border)', borderRadius: 'var(--r)',
          borderLeft: a.is_primary ? '2px solid var(--accent)' : '1px solid var(--border)',
          background: 'var(--surface)', padding: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <input defaultValue={a.label} disabled={!canEdit}
              onBlur={(e) => save(a.id, { label: e.target.value || 'Location' })}
              style={{ ...inputStyle, height: 28, fontWeight: 600, maxWidth: 220 }} />
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              {a.is_primary
                ? <Badge tone="accent">Primary</Badge>
                : canEdit && <Button size="sm" variant="ghost" onClick={() => setPrimary(a.id)}><Star size={12} /> Set primary</Button>}
              {canEdit && (
                <button onClick={() => remove(a.id)} aria-label="Delete address"
                  style={{ border: 'none', background: 'transparent', color: 'var(--text-subtle)', cursor: 'pointer', display: 'flex' }}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>
          <textarea defaultValue={a.address} disabled={!canEdit} rows={3}
            placeholder="Building, street, town, city, postcode"
            onBlur={(e) => save(a.id, { address: e.target.value })}
            style={{ ...inputStyle, height: 'auto', padding: 10, resize: 'vertical' }} />
        </div>
      ))}
      {canEdit && <Button size="sm" variant="secondary" onClick={add}><Plus size={12} /> Add another site</Button>}
    </div>
  );
}
