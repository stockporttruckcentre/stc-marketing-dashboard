'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { publishSelection } from '@/lib/command/selection';
import { useRouter, useSearchParams } from 'next/navigation';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueSetterParams, CellContextMenuEvent, RowClickedEvent } from 'ag-grid-community';
import Papa from 'papaparse';
import {
  Plus, Upload, Download, Loader, Trash2, X, Mail, Edit2, MoreHorizontal,
  Globe, Users, UserPlus, Send, Star, Search, ChevronDown, SearchX,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { CRMContact, ContactStatus, CrmList, Profile, ContactNote, ContactAddress } from '@/lib/types';
import { ContactDrawer } from '@/components/crm/ContactDrawer';
import { NextActionPrompt } from '@/components/crm/NextActionPrompt';
import { GenerateProposalPicker } from '@/components/crm/GenerateProposalPicker';
import { ScheduleMeetingModal } from '@/components/crm/ScheduleMeetingModal';
import { ImportDialog } from '@/components/crm/ImportDialog';
import { CRM_CONTACTS } from '@/lib/import/dictionary';
import { Figure, Button, Alert, Badge, type Tone } from '@/components/kit/primitives';
import { Modal, Field, TextInput, Select, OptionCard, Checkbox } from '@/components/kit/forms';
import {
  applyScope, ownerOptions, ownersAmbiguous, ownerKey, scopeFromParam, scopeToParam, type Scope,
} from '@/lib/crm/ownership';
import { capabilitiesFor, defaultScopeKind, roleLabel, type CrmCapabilities } from '@/lib/crm/permissions';
import { ukDateShort } from '@/lib/format/date';

const STATUSES: ContactStatus[] = ['lead', 'contacted', 'quoted', 'won', 'lost'];

const STATUS_TONE: Record<string, Tone> = {
  lead: 'info', contacted: 'warning', quoted: 'accent',
  won: 'success', customer: 'success', lost: 'neutral',
};

const TONE_COLOR: Record<Tone, string> = {
  neutral: 'var(--text-subtle)', info: 'var(--info)', success: 'var(--success)',
  warning: 'var(--warning)', danger: 'var(--danger)', accent: 'var(--accent)',
};

/**
 * The kit's table badge, drawn inline because an AG Grid cell renderer
 * cannot inherit the kit's own Badge sizing without fighting the row's
 * 36px line box.
 */
function GridBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, height: 20, padding: '0 8px',
      borderRadius: 'var(--r-sm)', color: TONE_COLOR[tone],
      background: 'color-mix(in srgb, currentColor 13%, transparent)',
      fontSize: 11, fontWeight: 600, letterSpacing: '0.01em',
      textTransform: 'capitalize', whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 'var(--r-full)', background: 'currentColor' }} />
      {children}
    </span>
  );
}

type Member = { list_id: string; user_id: string; can_edit: boolean };

export function CrmWorkspace({
  profile, lists: initialLists, members: initialMembers, profiles, selectedListId, initialContacts,
}: {
  profile: Profile;
  lists: CrmList[];
  members: Member[];
  profiles: Profile[];
  selectedListId: string;
  initialContacts: CRMContact[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const searchParams = useSearchParams();
  const gridRef = useRef<AgGridReact<CRMContact>>(null);

  const [lists, setLists] = useState<CrmList[]>(initialLists);
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [rows, setRows] = useState<CRMContact[]>(initialContacts);

  // Sync rows when the page server-fetches a different list
  useEffect(() => {
    setRows(initialContacts);
  }, [initialContacts, selectedListId]);

  // Remember last list so the sidebar nav can return you here
  useEffect(() => {
    if (selectedListId) try { localStorage.setItem('stc:lastListId', selectedListId); } catch {}
  }, [selectedListId]);
  const [enrichEmail, setEnrichEmail] = useState('');
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showNewList, setShowNewList] = useState(false);
  const [showShare, setShowShare] = useState<CrmList | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; row: CRMContact; field?: string } | null>(null);
  const [moveTargetMenu, setMoveTargetMenu] = useState<{ x: number; y: number; rowIds: string[]; mode?: 'move' | 'duplicate' } | null>(null);
  const [emptyAreaMenu, setEmptyAreaMenu] = useState<{ x: number; y: number } | null>(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const [listPickerFor, setListPickerFor] = useState<{ purpose: 'enrich'; email: string } | null>(null);
  const [enrichConfirm, setEnrichConfirm] = useState<{ row: CRMContact; field: string } | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [drawerRow, setDrawerRow] = useState<CRMContact | null>(null);
  const [lushaBalance, setLushaBalance] = useState<number | null>(null);
  const [nextActionFor, setNextActionFor] = useState<CRMContact | null>(null);
  const [promptSchedule, setPromptSchedule] = useState<CRMContact | null>(null);
  const [promptProposal, setPromptProposal] = useState<CRMContact | null>(null);
  const [assignMenu, setAssignMenu] = useState<{ x: number; y: number; rowIds: string[] } | null>(null);
  const [showAddContact, setShowAddContact] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [search, setSearch] = useState('');

  /**
   * What this person may do here. Derived from role today, overridden per
   * user by the admin panel when it exists. Every gate on this screen
   * reads from this one set rather than testing role in place, so the
   * panel is a single swap rather than a hunt.
   */
  const caps: CrmCapabilities = useMemo(() => capabilitiesFor(profile), [profile]);
  const defaultScope = useMemo(() => defaultScopeKind(caps), [caps]);

  const selectedIds = useCallback(
    () => gridRef.current?.api.getSelectedRows().map((r) => r.id) ?? [],
    [],
  );

  /**
   * Whose accounts you are looking at. Kept in the URL so a filtered view
   * can be sent to somebody, and remembered so a rep who lives in their
   * own portfolio does not reset to everyone's on every visit.
   */
  const [scope, setScope] = useState<Scope>(() => {
    const fromUrl = searchParams.get('who');
    // The CRM opens on your own accounts. The shared pipeline is mostly
    // other people's work, and starting there means scrolling past all of
    // it to reach the handful you actually owe a call today.
    return fromUrl ? scopeFromParam(fromUrl) : { kind: 'mine' };
  });
  useEffect(() => {
    const fromUrl = searchParams.get('who');
    if (fromUrl) { setScope(scopeFromParam(fromUrl)); return; }
    try {
      const saved = localStorage.getItem('stc:crmScope');
      if (saved) setScope(scopeFromParam(saved));
      else setScope({ kind: defaultScopeKind(capabilitiesFor(profile)) });
    } catch { setScope({ kind: defaultScopeKind(capabilitiesFor(profile)) }); }
    // Reading the saved scope is a first-load concern only. Re-running it
    // on every URL change would fight the user's own clicks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeScope(next: Scope) {
    setScope(next);
    try { localStorage.setItem('stc:crmScope', scopeToParam(next)); } catch {}
    const params = new URLSearchParams(searchParams.toString());
    if (next.kind === 'all') params.delete('who'); else params.set('who', scopeToParam(next));
    router.replace(`/dashboard/crm?${params.toString()}`, { scroll: false });
  }

  const selectedList = lists.find((l) => l.id === selectedListId);
  const isOwner = selectedList ? selectedList.owner_id === profile.id : false;
  /**
   * Two gates, and both have to pass. Your role has to allow editing at
   * all, and this particular list has to be one you can write to. A read
   * only viewer on a list shared with them is still a read only viewer.
   */
  const listWritable = selectedList?.is_global
    ? true
    : isOwner ||
      members.some((m) => m.list_id === selectedListId && m.user_id === profile.id && m.can_edit) ||
      profile.role === 'admin';
  const canEdit = listWritable && capabilitiesFor(profile).has('crm.edit');

  const myLists = lists.filter((l) => !l.is_global && l.owner_id === profile.id);
  const sharedLists = lists.filter((l) => !l.is_global && l.owner_id !== profile.id);
  const globalList = lists.find((l) => l.is_global);

  const owners = useMemo(() => ownerOptions(profiles), [profiles]);
  const ambiguousFirstNames = useMemo(() => ownersAmbiguous(profiles), [profiles]);
  const visibleRows = useMemo(() => {
    const scoped = applyScope(rows, scope, profile, profiles);
    const q = search.trim().toLowerCase();
    if (!q) return scoped;
    // Every field somebody would plausibly recognise a company by. Not a
    // clever search: this is the one on the table, and the toolbar upstairs
    // is where a question gets asked.
    return scoped.filter((r) => [
      r.company_name, r.contact_name, r.email, r.phone,
      r.location, r.assigned_to, r.status, r.source, r.notes,
    ].some((v) => v && String(v).toLowerCase().includes(q)));
  }, [rows, scope, profile, profiles, search]);
  const unassignedCount = useMemo(
    () => rows.filter((r) => !ownerKey(r.assigned_to)).length,
    [rows],
  );
  const scopeLabel = scope.kind === 'mine' ? 'My accounts'
    : scope.kind === 'unassigned' ? 'Unassigned'
    : scope.kind === 'person' ? (profiles.find((p) => p.id === scope.id)?.full_name ?? 'A colleague')
    : 'Everyone';

  function selectList(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('list', id);
    router.push(`/dashboard/crm?${params.toString()}`);
  }

  // If URL has ?contact=<id>, open drawer for it (from TopBar search jump)
  useEffect(() => {
    const targetId = searchParams.get('contact');
    if (!targetId) return;
    const row = rows.find((r) => r.id === targetId);
    if (row) {
      setDrawerRow(row);
    } else {
      // Not in current list - fetch it directly
      supabase.from('crm_contacts').select('*').eq('id', targetId).single()
        .then(({ data }) => { if (data) setDrawerRow(data as CRMContact); });
    }
  }, [searchParams, rows, supabase]);

  // Realtime: contacts in this list
  useEffect(() => {
    if (!selectedListId) return;
    const channel = supabase
      .channel(`crm_contacts:${selectedListId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_contacts', filter: `list_id=eq.${selectedListId}` },
        (payload: any) => {
          if (payload.eventType === 'INSERT') {
            setRows((rs) => (rs.find((r) => r.id === payload.new.id) ? rs : [payload.new as CRMContact, ...rs]));
          } else if (payload.eventType === 'UPDATE') {
            setRows((rs) => rs.map((r) => (r.id === payload.new.id ? (payload.new as CRMContact) : r)));
          } else if (payload.eventType === 'DELETE') {
            setRows((rs) => rs.filter((r) => r.id !== payload.old.id));
          }
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, selectedListId]);

  // Cell save
  const saveCell = useCallback((params: ValueSetterParams<CRMContact>): boolean => {
    const field = params.colDef.field as keyof CRMContact;
    const newValue = params.newValue;
    if (params.data[field] === newValue) return false;
    (params.data as any)[field] = newValue;

    if (field === 'notes' && newValue) {
      // Inline-edited notes = new note entry in history
      supabase.from('contact_notes')
        .insert({ contact_id: params.data.id, author_id: profile.id, author_name: profile.full_name, text: newValue })
        .then(({ error }) => { if (error) setMessage(`Note save failed: ${error.message}`); });
    } else {
      supabase.from('crm_contacts').update({ [field]: newValue }).eq('id', params.data.id)
        .then(({ error }) => { if (error) setMessage(`Save failed: ${error.message}`); });
    }
    return true;
  }, [supabase, profile]);

  const columnDefs: ColDef<CRMContact>[] = useMemo(() => [
    { headerName: '', field: 'id', width: 38, pinned: 'left',
      checkboxSelection: canEdit, headerCheckboxSelection: canEdit, headerCheckboxSelectionFilteredOnly: true,
      sortable: false, filter: false, editable: false, suppressMenu: true,
    },
    { field: 'company_name', headerName: 'Company', flex: 1.3, minWidth: 180, editable: canEdit, valueSetter: saveCell,
      cellRenderer: (p: ICellRendererParams<CRMContact>) =>
        <span style={{ fontWeight: 500, color: 'var(--text)' }}>{p.value}</span> },
    { field: 'contact_name', headerName: 'Contact', flex: 0.9, minWidth: 130, editable: canEdit, valueSetter: saveCell },
    { field: 'email', headerName: 'Email', flex: 1.1, minWidth: 190, editable: canEdit, valueSetter: saveCell,
      cellRenderer: (p: ICellRendererParams<CRMContact>) =>
        p.value ? <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{p.value}</span>
                : <span style={{ color: 'var(--text-subtle)', fontStyle: 'italic', fontSize: 12 }}>Right-click to enrich</span> },
    { field: 'phone', headerName: 'Phone', width: 140, editable: canEdit, valueSetter: saveCell,
      cellRenderer: (p: ICellRendererParams<CRMContact>) =>
        p.value ? <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{p.value}</span>
                : <span style={{ color: 'var(--text-subtle)', fontStyle: 'italic', fontSize: 12 }}>Right-click to enrich</span> },
    { field: 'location', headerName: 'Location', width: 120, editable: canEdit, valueSetter: saveCell },
    { field: 'fleet_size', headerName: 'Fleet', width: 80, editable: false,
      valueGetter: (p) => {
        const r = p.data!;
        if (r.trucks != null || r.trailers != null || r.vans != null) {
          return (r.trucks ?? 0) + (r.trailers ?? 0) + (r.vans ?? 0);
        }
        return null;
      },
      cellRenderer: (p: ICellRendererParams<CRMContact, number>) =>
        p.value == null
          ? <span style={{ color: 'var(--text-subtle)' }}>—</span>
          : <span>{p.value}</span>
    },
    { field: 'status', headerName: 'Status', width: 130, editable: canEdit, valueSetter: saveCell,
      cellEditor: 'agSelectCellEditor', cellEditorParams: { values: STATUSES },
      // The kit's table badge: 20px tall, tinted fill, a 6px dot and the
      // tone doing the talking. The old one was the app's legacy pill.
      cellRenderer: (p: ICellRendererParams<CRMContact, ContactStatus>) => {
        const v = p.value as ContactStatus | undefined;
        if (!v) return null;
        return <GridBadge tone={STATUS_TONE[v] ?? 'neutral'}>{v}</GridBadge>;
      },
    },
    { field: 'turnover', headerName: 'Turnover', width: 115, editable: canEdit, valueSetter: saveCell,
      valueParser: (p) => p.newValue === '' ? null : Number(p.newValue) || null,
      valueFormatter: (p) => p.value != null ? '£' + Number(p.value).toLocaleString() : '',
      cellStyle: { fontFamily: 'var(--mono)' } },
    /* A picker, not a text box. Everything typed in here before today
       reads as a different person to the portfolio filter, so new values
       are chosen from the real list of people instead. */
    { field: 'assigned_to', headerName: 'Assigned', width: 140, editable: canEdit, valueSetter: saveCell,
      cellEditor: 'agSelectCellEditor', cellEditorParams: { values: ['', ...owners] },
      cellRenderer: (p: ICellRendererParams<CRMContact, string>) => p.value
        ? <span>{p.value}</span>
        : <span style={{ color: 'var(--text-subtle)' }}>Unassigned</span> },
    // Dates are read, not parsed. A raw 2026-08-11 in a column somebody
    // scans for "who have I not called" is doing them no favours.
    { field: 'last_contact', headerName: 'Last contact', width: 130, editable: canEdit, valueSetter: saveCell,
      cellRenderer: (p: ICellRendererParams<CRMContact, string>) => p.value
        ? <span>{ukDateShort(p.value)}</span>
        : <span style={{ color: 'var(--text-subtle)' }}>—</span> },
    { field: 'notes', headerName: 'Latest note', flex: 1.4, minWidth: 200, editable: canEdit, valueSetter: saveCell,
      cellRenderer: (p: ICellRendererParams<CRMContact>) => p.value
        ? <span style={{ color: 'var(--text-muted)' }}>{p.value}</span>
        : <span style={{ color: 'var(--text-subtle)', fontStyle: 'italic' }}>Click the row to add a note</span> },
  ], [canEdit, saveCell, owners]);

  /* Sortable, resizable, and no per column menu button. A funnel icon on
     every header is a lot of furniture for a filter almost nobody opens,
     and the search box in the toolbar does the same job in one place. */
  const defaultColDef: ColDef = useMemo(() => ({
    resizable: true, sortable: true, filter: false, floatingFilter: false, suppressMenu: true,
  }), []);

  // ---- Lusha balance fetch (for confirm modal) ----
  async function fetchBalance() {
    try {
      const r = await fetch('/api/lusha/balance', { cache: 'no-store' });
      const j = await r.json();
      if (typeof j.balance === 'number') setLushaBalance(j.balance);
      return typeof j.balance === 'number' ? j.balance : null;
    } catch { return null; }
  }

  // ---- enrichment ----
  async function handleEnrichInput() {
    if (!enrichEmail.trim()) return;
    const email = enrichEmail.trim();
    if (lists.length > 1) {
      setListPickerFor({ purpose: 'enrich', email });
      return;
    }
    return doEnrich(email, selectedListId);
  }

  async function doEnrich(email: string, targetListId: string, replaceId?: string) {
    setEnriching(true); setMessage(null); setListPickerFor(null); setEnrichConfirm(null);
    try {
      const res = await fetch('/api/lusha/enrich', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, list_id: targetListId, replace_id: replaceId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Enrichment failed');
      setEnrichEmail('');
      setMessage(`Enriched ${email}`);
      if (!replaceId && targetListId === selectedListId) setRows((r) => [json.contact, ...r]);
      else if (replaceId) setRows((r) => r.map((c) => c.id === replaceId ? json.contact as CRMContact : c));
      fetchBalance();
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setEnriching(false);
    }
  }

  async function confirmRowEnrich(fields: string[]) {
    if (!enrichConfirm) return;
    const { row } = enrichConfirm;
    if (!row.email && !row.company_name) {
      setMessage('Need an email or company name on the row to enrich.');
      setEnrichConfirm(null);
      return;
    }
    if (fields.length === 0) {
      setMessage('Tick at least one field to update.');
      return;
    }
    setEnriching(true); setMessage(null); setEnrichConfirm(null);
    try {
      const websiteLink = (row.links || []).find((l: any) => l?.kind === 'website' && l?.url);
      const res = await fetch('/api/lusha/enrich', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: row.email,
          company_name: row.company_name,
          contact_name: row.contact_name,
          website_url: websiteLink?.url || '',
          list_id: selectedListId,
          replace_id: row.id,
          only_fields: fields,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Enrichment failed');
      setMessage(`Enriched via ${json.strategy ?? 'Lusha'} - updated ${Object.keys(json.enriched ?? {}).filter((k) => k !== 'source').length} field(s)`);
      if (json.contact) setRows((r) => r.map((c) => c.id === json.contact.id ? json.contact as CRMContact : c));
      fetchBalance();
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setEnriching(false);
    }
  }

  // ---- CSV ----
  function handleExport() {
    const sel = gridRef.current?.api.getSelectedRows() ?? [];
    // What is on screen, not what is in the list. Exporting everyone's
    // accounts from a view filtered to yours is the kind of surprise that
    // ends up in somebody's inbox.
    const data = sel.length ? sel : visibleRows;
    const csv = Papa.unparse(data.map((r) => ({
      company_name: r.company_name, contact_name: r.contact_name, email: r.email,
      phone: r.phone, location: r.location, fleet_size: r.fleet_size, status: r.status,
      source: r.source, assigned_to: r.assigned_to, last_contact: r.last_contact, notes: r.notes,
    })));
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stc-${selectedList?.name.toLowerCase().replace(/\s+/g, '-') ?? 'crm'}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * The commit half of the import. Everything before this point is the
   * dialog: parsing, mapping, duplicate checking and the review. By the
   * time a row arrives here the user has seen it and its values are
   * already the right shape for the column, so this only has to write.
   */
  async function commitImport(records: Record<string, any>[]) {
    setImporting(true); setMessage(null);
    try {
      const res = await fetch('/api/crm/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: records, list_id: selectedListId, mapped: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Import failed');
      setMessage(`Imported ${json.inserted} ${json.inserted === 1 ? 'contact' : 'contacts'}`);
      const { data } = await supabase.from('crm_contacts').select('*')
        .eq('list_id', selectedListId).order('updated_at', { ascending: false });
      setRows((data ?? []) as CRMContact[]);
      return { inserted: json.inserted as number };
    } catch (e: any) {
      return { inserted: 0, error: e.message as string };
    } finally {
      setImporting(false);
    }
  }

  /**
   * Dave's complaint was that adding a record inline is fiddly: you are
   * typing into a 36px grid cell with no idea which columns matter. The
   * modal asks for the four things that make a record useful and leaves
   * the rest to the drawer.
   *
   * The owner defaults to whoever is adding it, because an account
   * created with no owner is an account nobody chases.
   */
  async function handleAddRow(fields?: Partial<CRMContact>) {
    setShowAddContact(false);
    const { data, error } = await supabase.from('crm_contacts')
      .insert({
        company_name: fields?.company_name?.trim() || 'New company',
        contact_name: fields?.contact_name?.trim() || null,
        email: fields?.email?.trim() || null,
        phone: fields?.phone?.trim() || null,
        assigned_to: caps.has('crm.edit') ? (fields?.assigned_to ?? profile.full_name) : null,
        status: 'lead',
        source: 'manual',
        list_id: selectedListId,
      })
      .select('*').single();
    if (error) { setMessage(error.message); return; }
    setRows((r) => [data as CRMContact, ...r]);
    setDrawerRow(data as CRMContact);
    // Do not leave people staring at a blank record. Ask for the next step
    // while they still have the context in their head.
    setNextActionFor(data as CRMContact);
  }

  // ---- bulk actions ----
  async function bulkDelete() {
    const sel = gridRef.current?.api.getSelectedRows() ?? [];
    if (!sel.length) return;
    if (!confirm(`Delete ${sel.length} contacts?`)) return;
    const ids = sel.map((r) => r.id);
    const { error } = await supabase.from('crm_contacts').delete().in('id', ids);
    if (error) { setMessage(error.message); return; }
    setRows((r) => r.filter((c) => !ids.includes(c.id)));
    setMessage(`Deleted ${ids.length} contacts`);
  }

  async function bulkEnrich() {
    const sel = gridRef.current?.api.getSelectedRows() ?? [];
    const withEmail = sel.filter((r) => r.email);
    if (!withEmail.length) { setMessage('No selected rows have an email'); return; }
    const bal = await fetchBalance();
    const balStr = bal == null ? '?' : bal.toString();
    if (!confirm(`Enrich ${withEmail.length} contacts via Lusha.\n\nThis will spend ${withEmail.length} credit${withEmail.length === 1 ? '' : 's'}.\nYou have ${balStr} remaining.\n\nContinue?`)) return;
    setMessage(`Enriching ${withEmail.length}…`);
    let ok = 0;
    for (const r of withEmail) {
      try {
        await fetch('/api/lusha/enrich', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: r.email, list_id: selectedListId, replace_id: r.id }),
        });
        ok++;
      } catch {}
    }
    setMessage(`Enriched ${ok}/${withEmail.length}`);
    const { data } = await supabase.from('crm_contacts').select('*').eq('list_id', selectedListId).order('updated_at', { ascending: false });
    setRows((data ?? []) as CRMContact[]);
    fetchBalance();
  }

  // ---- list ops ----
  async function createList(name: string) {
    const { data, error } = await supabase.from('crm_lists').insert({ name, owner_id: profile.id }).select('*').single();
    if (error) { setMessage(error.message); return; }
    setLists((ls) => [...ls, data as CrmList]);
    setShowNewList(false);
    selectList((data as CrmList).id);
  }

  async function deleteList(id: string) {
    if (!confirm('Delete this list and all its contacts?')) return;
    await supabase.from('crm_contacts').delete().eq('list_id', id);
    const { error } = await supabase.from('crm_lists').delete().eq('id', id);
    if (error) { setMessage(error.message); return; }
    setLists((ls) => ls.filter((l) => l.id !== id));
    if (id === selectedListId) selectList(globalList?.id ?? '');
  }

  async function shareList(listId: string, userId: string, can_edit: boolean) {
    const { error } = await supabase.from('crm_list_members').upsert({ list_id: listId, user_id: userId, can_edit });
    if (error) { setMessage(error.message); return; }
    setMembers((ms) => [...ms.filter((m) => !(m.list_id === listId && m.user_id === userId)), { list_id: listId, user_id: userId, can_edit, added_at: '' as any }]);
  }
  async function unshareList(listId: string, userId: string) {
    const { error } = await supabase.from('crm_list_members').delete().eq('list_id', listId).eq('user_id', userId);
    if (error) { setMessage(error.message); return; }
    setMembers((ms) => ms.filter((m) => !(m.list_id === listId && m.user_id === userId)));
  }

  // ---- context menu / row click ----
  function onCellContextMenu(e: CellContextMenuEvent<CRMContact>) {
    if (!e.event) return;
    (e.event as MouseEvent).preventDefault();
    const me = e.event as MouseEvent;
    setContextMenu({ x: me.clientX, y: me.clientY, row: e.data!, field: e.colDef.field });
  }
  function onRowClicked(e: RowClickedEvent<CRMContact>) {
    // Only open drawer if not currently editing
    if ((e.event as MouseEvent)?.target && (e.event as any).target.closest('.ag-cell-edit-wrapper')) return;
    setDrawerRow(e.data ?? null);
  }

  useEffect(() => {
    function close() { setContextMenu(null); setMoveTargetMenu(null); setEmptyAreaMenu(null); }
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  function onSelectionChanged() {
    const rows = gridRef.current?.api.getSelectedRows() ?? [];
    setSelectedCount(rows.length);
    /* Told to the command bar, so "export these to Excel" and "assign
       these to Dave" mean the rows ticked here. Ids only, and the server
       reads every one of them back through the caller's own session. */
    publishSelection({ entity: 'contacts', ids: rows.map((r: any) => String(r.id)) });
  }

  // ---- counts ----
  const counts = useMemo(() => {
    const c = { all: visibleRows.length, lead: 0, contacted: 0, quoted: 0, won: 0, lost: 0 } as Record<string, number>;
    visibleRows.forEach((r) => { c[r.status] = (c[r.status] ?? 0) + 1; });
    return c;
  }, [visibleRows]);

  /**
   * Set the owner on a set of rows, writing the canonical profile name so
   * the match is exact from here on. Passing null clears it, which is how
   * an account goes back into the unassigned pile for somebody to pick up.
   */
  async function assignRows(rowIds: string[], name: string | null) {
    setAssignMenu(null);
    if (!rowIds.length) return;
    const { error } = await supabase.from('crm_contacts')
      .update({ assigned_to: name }).in('id', rowIds);
    if (error) { setMessage(error.message); return; }
    setRows((rs) => rs.map((r) => (rowIds.includes(r.id) ? { ...r, assigned_to: name } : r)));
    setMessage(name
      ? `Assigned ${rowIds.length} ${rowIds.length === 1 ? 'account' : 'accounts'} to ${name}`
      : `Cleared the owner on ${rowIds.length} ${rowIds.length === 1 ? 'account' : 'accounts'}`);
  }

  // Visual: distinct color/icon for current list
  const listIsGlobal = selectedList?.is_global;
  const listOwnerName = profiles.find((p) => p.id === selectedList?.owner_id)?.full_name;

  return (
    /* One kit scope for the whole tab, and only one.
       Putting `.kit` on individual clusters is what produced the bands of
       slightly-different dark: `.kit` paints `var(--bg)`, so every wrapper
       laid its own canvas over the page and every seam showed. The page is
       kit or it is not. This one is.

       Fixed height rather than natural flow so the table gets everything
       left over. 52px top bar, 24px page padding above, 56px below. */
    <div className="kit" style={{
      height: 'calc(100vh - 132px)',
      minHeight: 520,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      background: 'transparent',
    }}>

      {/* ---- header. Title left, the actions that are always available
              right, which is the kit's own header shape and the reason the
              top right no longer sits empty. ---- */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)', padding: '14px 16px',
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      }}>
        <span style={{
          width: 40, height: 40, borderRadius: 'var(--r)', flex: 'none',
          background: 'var(--bg-subtle)', color: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Users size={20} />
        </span>

        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <h1 style={{
              margin: 0, fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 22,
              letterSpacing: '-0.03em', color: 'var(--text)', lineHeight: 1.2,
            }}>{selectedList?.name ?? 'CRM'}</h1>
            {listIsGlobal
              ? <Badge tone="info" dot>Shared</Badge>
              : <Badge tone="neutral" dot>{listOwnerName === profile.full_name ? 'Yours' : `${listOwnerName ?? 'Unowned'}`}</Badge>}
            <Badge tone="neutral">{roleLabel(profile.role)}</Badge>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-subtle)', marginTop: 3 }}>
            {scope.kind === 'all'
              ? `${rows.length} contacts.`
              : `${scopeLabel}: ${visibleRows.length} of ${rows.length} contacts.`}
            {' '}
            {listIsGlobal ? 'Everyone can see this list.' : 'Only the owner and anyone it is shared with.'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {caps.has('crm.import') && (
            <Button size="sm" variant="secondary" onClick={() => setShowImport(true)} disabled={importing}>
              {importing ? <Loader size={13} className="spin" /> : <Upload size={13} />} Import
            </Button>
          )}
          {caps.has('crm.export') && (
            <Button size="sm" variant="secondary" onClick={handleExport}>
              <Download size={13} /> Export{selectedCount > 0 ? ` (${selectedCount})` : ''}
            </Button>
          )}
          {caps.has('crm.create') && (
            <Button size="sm" variant="primary" onClick={() => setShowAddContact(true)}>
              <Plus size={13} /> Add contact
            </Button>
          )}
        </div>
      </div>

      {/* ---- pipeline at a glance.

              The kit's stat strip puts no colour on the value: a rule
              separated row, Panton label above a Panton number, and any
              qualifier as small subtle text beside it. Colouring five
              numbers five ways was rule one broken twice over, and it
              made a quoted count of zero shout in red. ---- */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)', display: 'flex', flexWrap: 'wrap', overflow: 'hidden',
      }}>
        {[
          { label: 'Total', value: counts.all, note: 'in this view' },
          { label: 'Leads', value: counts.lead, note: 'not yet approached' },
          { label: 'Contacted', value: counts.contacted, note: 'in conversation' },
          { label: 'Quoted', value: counts.quoted, note: 'awaiting a decision' },
          { label: 'Won', value: counts.won, note: `${counts.lost} lost` },
        ].map((f, i) => (
          <div key={f.label} style={{
            flex: '1 1 140px', minWidth: 0, padding: '13px 18px',
            display: 'flex', flexDirection: 'column', gap: 4,
            borderLeft: i === 0 ? 'none' : '1px solid var(--border)',
          }}>
            <span style={{
              fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 11,
              letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-subtle)',
            }}>{f.label}</span>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
              <span style={{
                fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 24,
                letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums',
                color: 'var(--text)', lineHeight: 1.1,
              }}>{f.value}</span>
              <span style={{
                fontSize: 11.5, color: 'var(--text-subtle)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{f.note}</span>
            </span>
          </div>
        ))}
      </div>

      {/* ---- one toolbar. Whose accounts, which list, and a search, all on
              a single line. This was three stacked rows and it read as
              three, because it was. The bulk bar below replaces it rather
              than adding a fourth. ---- */}
      {selectedCount > 0 ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 11, flexWrap: 'wrap',
          padding: '9px 14px', borderRadius: 'var(--r-md)',
          background: 'var(--primary)', color: 'var(--primary-fg)',
        }} className="crm-bulk-bar">
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>
            {selectedCount} {selectedCount === 1 ? 'contact' : 'contacts'} selected
          </span>
          <span style={{ width: 1, height: 18, background: 'var(--bar-line)' }} />
          {caps.has('crm.enrich') && <InverseButton icon={<Mail size={13} />} label="Enrich" onClick={bulkEnrich} />}
          {caps.has('crm.assign') && (
            <InverseButton icon={<UserPlus size={13} />} label="Assign"
              onClick={(e) => setAssignMenu({ x: e.clientX, y: e.clientY + 20, rowIds: selectedIds() })} />
          )}
          {caps.has('crm.edit') && (
            <InverseButton icon={<MoreHorizontal size={13} />} label="Add to a list"
              onClick={(e) => setMoveTargetMenu({ x: e.clientX, y: e.clientY + 20, rowIds: selectedIds(), mode: 'move' })} />
          )}
          {caps.has('crm.create') && selectedCount <= 10 && (
            <InverseButton icon={<Plus size={13} />} label="Copy to a list"
              onClick={(e) => setMoveTargetMenu({ x: e.clientX, y: e.clientY + 20, rowIds: selectedIds(), mode: 'duplicate' })} />
          )}
          {caps.has('crm.delete') && <InverseButton icon={<Trash2 size={13} />} label="Delete" onClick={bulkDelete} danger />}
          <span style={{ flex: 1 }} />
          <button onClick={() => gridRef.current?.api.deselectAll()} aria-label="Clear selection"
            style={{ display: 'flex', border: 'none', background: 'transparent', color: 'inherit', opacity: 0.75, cursor: 'pointer' }}>
            <X size={15} />
          </button>
        </div>
      ) : (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap',
          padding: '10px 14px', borderRadius: 'var(--r-md)',
          background: 'var(--surface)', border: '1px solid var(--border)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', height: 28, width: 210,
            background: 'var(--surface)', border: '1px solid var(--border-strong)',
            borderRadius: 'var(--r)',
          }}>
            <span style={{ display: 'flex', alignItems: 'center', paddingLeft: 10, color: 'var(--text-subtle)' }}>
              <Search size={14} />
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search this list"
              style={{
                flex: 1, minWidth: 0, height: '100%', padding: '0 10px 0 8px',
                background: 'transparent', color: 'var(--text)', border: 0, outline: 0,
                fontFamily: 'var(--inter)', fontSize: 12, letterSpacing: '-0.01em',
              }}
            />
          </div>

          <ScopeSwitch
            scope={scope}
            onChange={changeScope}
            profiles={profiles}
            me={profile}
            caps={caps}
            unassignedCount={unassignedCount}
          />

          <ListPicker
            lists={lists}
            selectedId={selectedListId}
            onSelect={selectList}
            onNew={caps.has('crm.manageLists') ? () => setShowNewList(true) : undefined}
          />

          {(search || scope.kind !== defaultScope) && (
            <button onClick={() => { setSearch(''); changeScope({ kind: defaultScope }); }} style={{
              background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
              color: 'var(--accent)', fontFamily: 'var(--inter)', fontSize: 12, fontWeight: 600,
              textDecoration: 'underline', textUnderlineOffset: 3,
            }}>Clear</button>
          )}

          <span style={{ flex: 1 }} />

          {selectedList && !selectedList.is_global && selectedList.owner_id === profile.id && caps.has('crm.manageLists') && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setShowShare(selectedList)}>
                <UserPlus size={12} /> Share
              </Button>
              <Button size="sm" variant="ghost" onClick={() => deleteList(selectedList.id)} aria-label="Delete this list">
                <Trash2 size={12} />
              </Button>
            </>
          )}
        </div>
      )}

      {message && <Alert tone="info">{message}</Alert>}

      {ambiguousFirstNames.length > 0 && scope.kind === 'mine' && (
        <Alert tone="warning">
          Two people share the first name {ambiguousFirstNames.join(' and ')}, so rows
          assigned to just that name are left out of both portfolios. Set an owner on
          them to fix it.
        </Alert>
      )}

      {/* ---- the table, taking everything that is left ---- */}
      <div
        className="kit-grid ag-theme-quartz"
        onContextMenu={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('.ag-row') || target.closest('.ag-header-cell')) return;
          e.preventDefault();
          setEmptyAreaMenu({ x: e.clientX, y: e.clientY });
        }}
        style={{ flex: 1, minHeight: 260 }}
      >
        <AgGridReact<CRMContact>
          ref={gridRef}
          rowData={visibleRows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          rowSelection="multiple"
          suppressRowClickSelection
          animateRows
          stopEditingWhenCellsLoseFocus
          enableCellTextSelection
          getRowId={(p) => p.data.id}
          onCellContextMenu={onCellContextMenu}
          onSelectionChanged={onSelectionChanged}
          onRowClicked={onRowClicked}
          preventDefaultOnContextMenu
          noRowsOverlayComponent={NoRows}
          noRowsOverlayComponentParams={{
            scope, scopeLabel, total: rows.length, search,
            onClear: () => { setSearch(''); changeScope({ kind: 'all' }); },
          }}
        />
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
        Click a row to open it. Right click any cell to edit, enrich, move or delete it.
      </div>

      {assignMenu && (
        <AssignMenu
          x={assignMenu.x} y={assignMenu.y} count={assignMenu.rowIds.length}
          owners={owners} me={profile.full_name}
          onPick={(name) => assignRows(assignMenu.rowIds, name)}
          onClose={() => setAssignMenu(null)}
        />
      )}

      {showImport && (
        <ImportDialog
          dict={CRM_CONTACTS}
          listName={selectedList?.name ?? 'this list'}
          existing={rows.map((r) => ({ id: r.id, company_name: r.company_name, email: r.email }))}
          onCommit={commitImport}
          onClose={() => setShowImport(false)}
        />
      )}

      {showAddContact && (
        <AddContactModal
          owners={owners}
          me={profile.full_name}
          canAssign={caps.has('crm.assign')}
          listName={selectedList?.name ?? 'this list'}
          onCreate={handleAddRow}
          onClose={() => setShowAddContact(false)}
        />
      )}

      {showNewList && <NewListModal onCreate={createList} onClose={() => setShowNewList(false)} />}
      {showShare && <ShareModal list={showShare} profiles={profiles.filter((p) => p.id !== profile.id)} members={members.filter((m) => m.list_id === showShare.id)} onShare={shareList} onUnshare={unshareList} onClose={() => setShowShare(null)} />}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y} row={contextMenu.row} field={contextMenu.field}
          canEdit={canEdit}
          enrichAllowed={caps.has('crm.enrich')}
          onEdit={() => {
            const node = gridRef.current?.api.getRowNode(contextMenu.row.id);
            if (node) gridRef.current?.api.startEditingCell({ rowIndex: node.rowIndex!, colKey: contextMenu.field ?? 'company_name' });
            setContextMenu(null);
          }}
          onView={() => { setDrawerRow(contextMenu.row); setContextMenu(null); }}
          onEnrich={async () => {
            await fetchBalance();
            setEnrichConfirm({ row: contextMenu.row, field: contextMenu.field ?? 'email' });
            setContextMenu(null);
          }}
          onDelete={async () => {
            if (confirm('Delete this contact?')) {
              const { error } = await supabase.from('crm_contacts').delete().eq('id', contextMenu.row.id);
              if (error) setMessage(error.message); else setRows((r) => r.filter((c) => c.id !== contextMenu.row.id));
            }
            setContextMenu(null);
          }}
          onMove={(e: React.MouseEvent) => {
            setContextMenu(null);
            setMoveTargetMenu({ x: e.clientX, y: e.clientY, rowIds: [contextMenu.row.id] });
          }}
        />
      )}

      {moveTargetMenu && (
        <MoveMenu x={moveTargetMenu.x} y={moveTargetMenu.y}
          mode={moveTargetMenu.mode ?? 'move'}
          lists={lists.filter((l) => l.id !== selectedListId)}
          onPick={async (listId) => {
            const mode = moveTargetMenu.mode ?? 'move';
            if (mode === 'duplicate') {
              const { data: src } = await supabase.from('crm_contacts').select('*').in('id', moveTargetMenu.rowIds);
              if (src && src.length) {
                const clones = src.map(({ id, created_at, updated_at, ...rest }: any) => ({ ...rest, list_id: listId }));
                const { error } = await supabase.from('crm_contacts').insert(clones);
                if (error) setMessage(error.message); else setMessage(`Duplicated ${clones.length} → ${lists.find((l) => l.id === listId)?.name}`);
              }
            } else {
              const { error } = await supabase.from('crm_contacts').update({ list_id: listId }).in('id', moveTargetMenu.rowIds);
              if (error) setMessage(error.message); else {
                setRows((r) => r.filter((c) => !moveTargetMenu.rowIds.includes(c.id)));
                setMessage(`Moved ${moveTargetMenu.rowIds.length} → ${lists.find((l) => l.id === listId)?.name}`);
              }
            }
            setMoveTargetMenu(null);
          }}
          onClose={() => setMoveTargetMenu(null)} />
      )}

      {listPickerFor && (
        <ListPickerModal lists={lists} onPick={(id) => doEnrich(listPickerFor.email, id)} onClose={() => setListPickerFor(null)}
          title={`Add ${listPickerFor.email} to which list?`} />
      )}

      {enrichConfirm && (
        <EnrichConfirmModal
          row={enrichConfirm.row}
          balance={lushaBalance}
          onConfirm={confirmRowEnrich}
          onCancel={() => setEnrichConfirm(null)}
          busy={enriching}
        />
      )}

            {emptyAreaMenu && (
        <EdgeAwareCtxMenu x={emptyAreaMenu.x} y={emptyAreaMenu.y}>
          <MenuHead>{selectedList?.name ?? 'CRM'}</MenuHead>
          <MenuItem icon={<Plus size={13} />} label="Add contact" disabled={!canEdit}
            onClick={() => { setEmptyAreaMenu(null); handleAddRow(); }} />
          <MenuItem icon={<Upload size={13} />} label="Import a spreadsheet" disabled={!caps.has('crm.import')}
            onClick={() => { setEmptyAreaMenu(null); setShowImport(true); }} />
        </EdgeAwareCtxMenu>
      )}
      {nextActionFor && (
        <NextActionPrompt
          contact={nextActionFor}
          onClose={() => setNextActionFor(null)}
          onSchedule={() => { setPromptSchedule(nextActionFor); setNextActionFor(null); }}
          onProposal={() => { setPromptProposal(nextActionFor); setNextActionFor(null); }}
          onAddNote={() => { setDrawerRow(nextActionFor); setNextActionFor(null); }}
        />
      )}
      {promptSchedule && (
        <ScheduleMeetingModal contact={promptSchedule} profile={profile} allProfiles={profiles}
          onClose={() => setPromptSchedule(null)} />
      )}
      {promptProposal && (
        <GenerateProposalPicker contact={promptProposal} onClose={() => setPromptProposal(null)} />
      )}
      {drawerRow && (
        <ContactDrawer
          contact={drawerRow}
          profile={profile}
          canEdit={canEdit}
          lists={lists}
          members={members}
          onClose={() => setDrawerRow(null)}
          onChange={(updated) => {
            setRows((r) => r.map((c) => c.id === updated.id ? updated : c));
            setDrawerRow(updated);
          }}
          onDelete={async () => {
            if (!confirm('Delete this contact?')) return;
            await supabase.from('crm_contacts').delete().eq('id', drawerRow.id);
            setRows((r) => r.filter((c) => c.id !== drawerRow.id));
            setDrawerRow(null);
          }}
        />
      )}
    </div>
  );
}

// ============ subcomponents ============

/** A button on the navy bulk bar. Borders only, so the bar stays one object. */
function InverseButton({ icon, label, onClick, danger }: {
  icon: React.ReactNode; label: string;
  onClick: (e: React.MouseEvent) => void; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px',
        background: 'transparent', cursor: 'pointer', borderRadius: 'var(--r)',
        color: danger ? 'var(--bar-danger)' : 'inherit',
        border: `1px solid ${danger ? 'var(--bar-danger)' : 'var(--bar-line)'}`,
        fontFamily: 'var(--inter)', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
      }}
    >{icon}{label}</button>
  );
}

/**
 * Which list.
 *
 * This was a row of tabs of its own, which is a lot of furniture for
 * something most people change twice a week. As a select it costs one
 * control on a line that already existed, and it still reads when
 * somebody has fifteen lists rather than three.
 */
function ListPicker({ lists, selectedId, onSelect, onNew }: {
  lists: CrmList[]; selectedId: string;
  onSelect: (id: string) => void; onNew?: () => void;
}) {
  const global = lists.filter((l) => l.is_global);
  const mine = lists.filter((l) => !l.is_global);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        display: 'flex', alignItems: 'center', height: 28, position: 'relative',
        background: 'var(--surface)', border: '1px solid var(--border-strong)',
        borderRadius: 'var(--r)',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', paddingLeft: 9, color: 'var(--text-subtle)' }}>
          {lists.find((l) => l.id === selectedId)?.is_global ? <Globe size={13} /> : <Users size={13} />}
        </span>
        <select
          value={selectedId}
          onChange={(e) => onSelect(e.target.value)}
          style={{
            appearance: 'none', background: 'transparent', border: 0, outline: 0,
            color: 'var(--text)', fontFamily: 'var(--inter)', fontSize: 12, fontWeight: 600,
            padding: '0 26px 0 7px', height: '100%', cursor: 'pointer', maxWidth: 190,
          }}
        >
          {global.length > 0 && (
            <optgroup label="Shared">
              {global.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </optgroup>
          )}
          {mine.length > 0 && (
            <optgroup label="Lists">
              {mine.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </optgroup>
          )}
        </select>
        <span style={{
          position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
          pointerEvents: 'none', color: 'var(--text-subtle)', display: 'flex',
        }}><ChevronDown size={13} /></span>
      </div>
      {onNew && (
        <button onClick={onNew} title="New list" aria-label="New list" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28, borderRadius: 'var(--r)', cursor: 'pointer',
          border: '1px dashed var(--border-strong)', background: 'transparent',
          color: 'var(--text-muted)',
        }}><Plus size={13} /></button>
      )}
    </div>
  );
}

/**
 * What the grid shows when it has nothing to draw.
 *
 * The kit's rule is that an empty state says what the thing is, why it is
 * empty, and the one action that fills it. "No Rows To Show", the grid's
 * own default, manages none of the three and reads as a fault.
 */
function NoRows({ scope, scopeLabel, total, search, onClear }: {
  scope: Scope; scopeLabel: string; total: number; search: string; onClear: () => void;
}) {
  const filtered = total > 0;
  const what = !filtered
    ? 'This list has no contacts yet.'
    : search
      ? `Nothing on this list matches "${search}".`
      : scope.kind === 'unassigned'
        ? `All ${total} accounts on this list have an owner.`
        : `None of the ${total} accounts on this list are assigned to ${scope.kind === 'mine' ? 'you' : scopeLabel}.`;
  const why = !filtered
    ? 'Add one, or bring a spreadsheet in with Import CSV.'
    : search
      ? 'Company, contact, email, phone, town, owner and notes are all searched.'
      : scope.kind === 'unassigned'
        ? 'Nothing is going unclaimed, which is the point of this view.'
        : 'Set the Assigned column on a row, or select rows and press Assign.';

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9,
      padding: '30px 24px', textAlign: 'center', pointerEvents: 'auto',
    }}>
      <span style={{
        width: 40, height: 40, borderRadius: 'var(--r-full)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-subtle)', color: 'var(--text-subtle)',
      }}>
        {filtered ? <SearchX size={19} /> : <Users size={19} />}
      </span>
      <div style={{
        fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 15,
        letterSpacing: '-0.02em', color: 'var(--text)',
      }}>{what}</div>
      <div style={{ fontSize: 12.5, color: 'var(--text-subtle)', maxWidth: '46ch', lineHeight: 1.5 }}>{why}</div>
      {filtered && <Button size="sm" variant="secondary" onClick={onClear}>Show everything</Button>}
    </div>
  );
}

/* =============================================================
   Whose accounts.

   Mine is the default and the one a rep uses all day. Unassigned is how
   an account stops quietly belonging to nobody, so it carries a count.

   The other two are gated. Seeing the shared pipeline needs CRM rights,
   which is how the meeting described it. Reading a named colleague's
   portfolio is a manager's action and is hidden entirely rather than
   shown disabled, because an option you can see but never use is just a
   daily reminder of what you are not.
   ============================================================= */
function ScopeSwitch({ scope, onChange, profiles, me, caps, unassignedCount }: {
  scope: Scope;
  onChange: (s: Scope) => void;
  profiles: Profile[];
  me: Profile;
  caps: CrmCapabilities;
  unassignedCount: number;
}) {
  const others = profiles.filter((p) => p.id !== me.id && p.full_name);
  const active = (k: Scope['kind']) => scope.kind === k;
  const ownsAccounts = caps.has('crm.edit');

  const seg = (on: boolean): React.CSSProperties => ({
    height: 26, padding: '0 11px', border: 'none', cursor: 'pointer',
    background: on ? 'var(--primary)' : 'transparent',
    color: on ? 'var(--primary-fg)' : 'var(--text-muted)',
    fontFamily: 'var(--inter)', fontSize: 12, fontWeight: 600,
    display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', height: 28,
        border: '1px solid var(--border-strong)', borderRadius: 'var(--r)',
        overflow: 'hidden', background: 'var(--surface)',
      }}>
        {ownsAccounts && (
          <>
            <button style={seg(active('mine'))} onClick={() => onChange({ kind: 'mine' })}>
              <Star size={12} /> Mine
            </button>
            <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)' }} />
          </>
        )}
        {caps.has('crm.viewGlobal') && (
          <button style={seg(active('all'))} onClick={() => onChange({ kind: 'all' })}>
            <Users size={12} /> Everyone
          </button>
        )}
        {ownsAccounts && (
          <>
            <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)' }} />
            <button style={seg(active('unassigned'))} onClick={() => onChange({ kind: 'unassigned' })}>
              Unassigned
              {unassignedCount > 0 && (
                <span style={{
                  fontSize: 10, fontVariantNumeric: 'tabular-nums',
                  padding: '1px 5px', borderRadius: 'var(--r-full)',
                  background: active('unassigned') ? 'rgba(255,255,255,0.22)' : 'var(--bg-subtle)',
                  color: active('unassigned') ? 'inherit' : 'var(--text-subtle)',
                }}>{unassignedCount}</span>
              )}
            </button>
          </>
        )}
      </div>

      {caps.has('crm.viewOthers') && others.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', height: 28, position: 'relative',
          background: 'var(--surface)', border: '1px solid var(--border-strong)',
          borderRadius: 'var(--r)',
        }}>
          <select
            value={scope.kind === 'person' ? scope.id : ''}
            onChange={(e) => onChange(e.target.value ? { kind: 'person', id: e.target.value } : { kind: 'mine' })}
            style={{
              appearance: 'none', background: 'transparent', border: 0, outline: 0,
              color: scope.kind === 'person' ? 'var(--text)' : 'var(--text-muted)',
              fontFamily: 'var(--inter)', fontSize: 12, fontWeight: 600,
              padding: '0 24px 0 10px', height: '100%', cursor: 'pointer',
            }}
          >
            <option value="">A colleague</option>
            {others.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
          <span style={{
            position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)',
            pointerEvents: 'none', color: 'var(--text-subtle)', display: 'flex',
          }}><ChevronDown size={13} /></span>
        </div>
      )}
    </div>
  );
}

function AssignMenu({ x, y, count, owners, me, onPick, onClose }: {
  x: number; y: number; count: number; owners: string[]; me: string;
  onPick: (name: string | null) => void; onClose: () => void;
}) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 69 }} />
      <EdgeAwareCtxMenu x={x} y={y} width={236}>
        <MenuHead>Assign {count} {count === 1 ? 'account' : 'accounts'}</MenuHead>
        <div style={{ maxHeight: 280, overflowY: 'auto' }}>
          {me && <MenuItem label={`${me} (me)`} onClick={() => onPick(me)} />}
          {owners.filter((o) => o !== me).map((o) => (
            <MenuItem key={o} label={o} onClick={() => onPick(o)} />
          ))}
        </div>
        <MenuRule />
        <MenuItem label="Clear the owner" onClick={() => onPick(null)} />
      </EdgeAwareCtxMenu>
    </>
  );
}

/* =============================================================
   Add a contact.

   Dave's complaint was that the inline row is fiddly: you type into a
   36px grid cell with no sense of which of twenty columns matter. This
   asks for the four fields that make a record worth having and leaves
   everything else to the drawer, which is where the detail belongs.

   Only the company name is required. A prospect scribbled off a phone
   call often is just a name, and refusing to save it is how notes end up
   back on paper.
   ============================================================= */
function AddContactModal({ owners, me, canAssign, listName, onCreate, onClose }: {
  owners: string[];
  me: string;
  canAssign: boolean;
  listName: string;
  onCreate: (fields: Partial<CRMContact>) => void;
  onClose: () => void;
}) {
  const [company, setCompany] = useState('');
  const [contact, setContact] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [owner, setOwner] = useState(me);

  function submit() {
    if (!company.trim()) return;
    onCreate({
      company_name: company, contact_name: contact,
      email, phone, assigned_to: owner,
    });
  }

  return (
    <Modal
      title="Add a contact"
      description={`Goes onto ${listName}. You can fill in the rest on the record itself.`}
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!company.trim()}>
            <Plus size={14} /> Add contact
          </Button>
        </>
      }
    >
      <Field label="Company">
        <TextInput value={company} onChange={setCompany} placeholder="Bredbury Haulage Ltd" />
      </Field>
      <Field label="Contact name" hint="Who you actually speak to.">
        <TextInput value={contact} onChange={setContact} placeholder="Optional" />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Email">
          <TextInput type="email" value={email} onChange={setEmail} placeholder="Optional" />
        </Field>
        <Field label="Phone">
          <TextInput value={phone} onChange={setPhone} placeholder="Optional" />
        </Field>
      </div>
      {canAssign && owners.length > 1 && (
        <Field label="Owner" hint="Whose portfolio this lands in.">
          <Select value={owner} onChange={setOwner}>
            <option value={me}>{me} (me)</option>
            {owners.filter((o) => o !== me).map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        </Field>
      )}
    </Modal>
  );
}

function NewListModal({ onCreate, onClose }: { onCreate: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  return (
    <Modal
      onClose={onClose}
      title="New CRM list"
      description="A working list of your own. Share it with colleagues afterwards if it turns out to be useful to them."
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => { if (name.trim()) onCreate(name.trim()); }} disabled={!name.trim()}>
            <Plus size={14} /> Create list
          </Button>
        </>
      }
    >
      <Field label="List name">
        <TextInput
          value={name}
          onChange={setName}
          placeholder="M62 corridor, Hyde walk-ins"
        />
      </Field>
    </Modal>
  );
}

function ShareModal({ list, profiles, members, onShare, onUnshare, onClose }: {
  list: CrmList; profiles: Profile[]; members: Member[];
  onShare: (l: string, u: string, e: boolean) => void; onUnshare: (l: string, u: string) => void; onClose: () => void;
}) {
  const shared = profiles.filter((p) => members.some((m) => m.user_id === p.id));
  return (
    <Modal
      onClose={onClose}
      title={`Share ${list.name}`}
      description={shared.length
        ? `${shared.length} ${shared.length === 1 ? 'colleague has' : 'colleagues have'} access. They can edit the contacts on it.`
        : 'Nobody else can see this list yet.'}
      width={470}
      footer={<Button variant="secondary" onClick={onClose}>Done</Button>}
    >
      <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {profiles.map((p, i) => {
          const isShared = members.some((x) => x.user_id === p.id);
          return (
            <div key={p.id} style={{
              display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, padding: '7px 2px',
              borderTop: i === 0 ? 'none' : '1px solid var(--border)',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: 'var(--text)', letterSpacing: '-0.01em' }}>{p.full_name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.email}</div>
              </div>
              {isShared
                ? <Button size="sm" variant="ghost" onClick={() => onUnshare(list.id, p.id)}>Remove</Button>
                : <Button size="sm" variant="secondary" onClick={() => onShare(list.id, p.id, true)}><UserPlus size={12} /> Share</Button>}
            </div>
          );
        })}
        {profiles.length === 0 && (
          <span style={{ fontSize: 13, color: 'var(--text-subtle)' }}>There is nobody else on the system yet.</span>
        )}
      </div>
    </Modal>
  );
}


// Viewport-aware positioning hook for floating menus. Returns a ref to attach to the menu.
// After mount, measures the menu and pushes it up/left if it would overflow the viewport.
function useEdgeAwarePosition(x: number, y: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let nextLeft = x;
    let nextTop = y;
    if (x + rect.width + margin > window.innerWidth) {
      nextLeft = Math.max(margin, x - rect.width);
    }
    if (y + rect.height + margin > window.innerHeight) {
      nextTop = Math.max(margin, y - rect.height);
    }
    if (nextLeft !== pos.left || nextTop !== pos.top) {
      setPos({ left: nextLeft, top: nextTop });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);
  return { ref, pos };
}


/* =============================================================
   Floating menus.

   One shell for all of them, so a right click on a row and a right click
   on empty space produce the same object rather than two near misses.
   The kit's own rule applies: a 1px border and a real elevation, because
   this is a thing that genuinely floats.
   ============================================================= */
function EdgeAwareCtxMenu({ x, y, width = 220, children }: {
  x: number; y: number; width?: number; children: React.ReactNode;
}) {
  const { ref, pos } = useEdgeAwarePosition(x, y);
  return (
    <div
      ref={ref}
      className="kit"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', left: pos.left, top: pos.top, zIndex: 70, width,
        background: 'var(--surface-raised)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-3)', padding: 5,
      }}
    >
      {children}
    </div>
  );
}

function MenuHead({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '7px 9px 8px', fontFamily: 'var(--panton)', fontWeight: 700,
      fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase',
      color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>{children}</div>
  );
}

function MenuItem({ icon, label, onClick, disabled, danger, title }: {
  icon?: React.ReactNode; label: React.ReactNode; onClick: () => void;
  disabled?: boolean; danger?: boolean; title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
        border: 'none', background: 'transparent', padding: '7px 9px',
        borderRadius: 'var(--r-sm)', fontFamily: 'var(--inter)', fontSize: 13,
        letterSpacing: '-0.01em',
        color: disabled ? 'var(--text-subtle)' : danger ? 'var(--danger)' : 'var(--text)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'var(--surface-sunken)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {icon && <span style={{ display: 'flex', flexShrink: 0, color: 'currentColor', opacity: 0.75 }}>{icon}</span>}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </button>
  );
}

function MenuRule() {
  return <div style={{ height: 1, background: 'var(--border)', margin: '5px 0' }} />;
}

function ContextMenu({ x, y, row, field, canEdit, enrichAllowed, onView, onEdit, onEnrich, onDelete, onMove }: any) {
  // What Lusha can actually return, so the option is not offered where it cannot work.
  const ENRICHABLE_FIELDS = ['company_name', 'contact_name', 'email', 'phone', 'location', 'fleet_size'];
  const hasLookupHandle = !!row.email || !!row.company_name;
  const canEnrich = enrichAllowed && hasLookupHandle && ENRICHABLE_FIELDS.includes(field);
  const enrichTitle = !enrichAllowed
    ? 'Lusha is switched off until a policy is agreed for who can spend credits'
    : !hasLookupHandle
    ? 'Add an email or a company name to the row first. Lusha needs at least one to look anything up'
    : !ENRICHABLE_FIELDS.includes(field)
      ? 'Lusha does not provide this field'
      : row.email
        ? 'Look this contact up on Lusha by email'
        : `Lusha will find a contact at ${row.company_name}, working down from Sales Director to Fleet Manager`;

  return (
    <EdgeAwareCtxMenu x={x} y={y} width={232}>
      <MenuHead>{row.company_name}{row.location ? `, ${row.location}` : ''}</MenuHead>
      <MenuItem icon={<Edit2 size={13} />} label="Open details" onClick={onView} />
      <MenuItem icon={<Edit2 size={13} />} label="Edit this cell" onClick={onEdit} disabled={!canEdit} />
      <MenuItem icon={<Mail size={13} />} label="Enrich from Lusha" onClick={onEnrich} disabled={!canEnrich} title={enrichTitle} />
      <MenuItem icon={<MoreHorizontal size={13} />} label="Move onto another list" onClick={onMove} />
      <MenuRule />
      <MenuItem icon={<Trash2 size={13} />} label="Delete" onClick={onDelete} disabled={!canEdit} danger />
    </EdgeAwareCtxMenu>
  );
}

function MoveMenu({ x, y, lists, onPick, onClose, mode = 'move' }: {
  x: number; y: number; lists: CrmList[]; onPick: (id: string) => void; onClose: () => void; mode?: 'move' | 'duplicate';
}) {
  return (
    <EdgeAwareCtxMenu x={x} y={y} width={232}>
      <MenuHead>{mode === 'duplicate' ? 'Copy onto which list' : 'Move onto which list'}</MenuHead>
      {lists.map((l) => (
        <MenuItem
          key={l.id}
          icon={l.is_global ? <Globe size={13} /> : <Users size={13} />}
          label={l.name}
          onClick={() => onPick(l.id)}
        />
      ))}
      <div style={{ padding: '2px 9px 7px', fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.45 }}>
        {mode === 'duplicate'
          ? 'The contact stays where it is and a copy goes onto the other list.'
          : 'This changes which list the contact sits on. It is not a won or lost outcome.'}
      </div>
      {lists.length === 0 && (
        <div style={{ padding: '7px 9px', fontSize: 12.5, color: 'var(--text-subtle)' }}>
          There are no other lists to move it onto.
        </div>
      )}
      <MenuRule />
      <MenuItem label="Cancel" onClick={onClose} />
    </EdgeAwareCtxMenu>
  );
}

function ListPickerModal({ lists, onPick, onClose, title }: { lists: CrmList[]; onPick: (id: string) => void; onClose: () => void; title: string }) {
  return (
    <Modal onClose={onClose} title={title} width={440}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {lists.map((l) => (
          <OptionCard
            key={l.id}
            selected={false}
            onSelect={() => onPick(l.id)}
            icon={l.is_global ? <Globe size={15} /> : <Users size={15} />}
            title={l.name}
            description={l.is_global ? 'Shared with everyone' : 'A personal list'}
          />
        ))}
      </div>
    </Modal>
  );
}

const ENRICHABLE_FIELD_CHOICES: { key: 'company_name' | 'contact_name' | 'email' | 'phone' | 'location' | 'fleet_size'; label: string; help: string }[] = [
  { key: 'company_name', label: 'Company name', help: 'Official name from Lusha' },
  { key: 'contact_name', label: 'Contact name', help: 'Full name of person found' },
  { key: 'email',        label: 'Email',        help: 'Best-match email address' },
  { key: 'phone',        label: 'Phone',        help: 'Primary phone number' },
  { key: 'location',     label: 'Location',     help: 'City / country' },
  { key: 'fleet_size',   label: 'Employee count', help: 'Company size (also written to legacy fleet_size)' },
];

function EnrichConfirmModal({ row, balance, onConfirm, onCancel, busy }: { row: CRMContact; balance: number | null; onConfirm: (fields: string[]) => void; onCancel: () => void; busy: boolean }) {
  // Pre-flight: ask the server to do a FREE company lookup before we let the user pick fields.
  // No credits are spent until they hit "Spend 1 credit".
  const [checkState, setCheckState] = useState<'loading' | 'found' | 'not_found' | 'requires_website' | 'error'>('loading');
  const [checkData, setCheckData] = useState<{ lushaName?: string | null; matchedVariant?: string | null; strategy?: string; message?: string; availableFields?: Record<string, boolean>; matchedRole?: string | null; contactCount?: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Look up the row's website link (kind === 'website') to use as the Lusha lookup key
        const websiteLink = (row.links || []).find((l: any) => l?.kind === 'website' && l?.url);
        const websiteUrl = websiteLink?.url || '';
        const res = await fetch('/api/lusha/check', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ company_name: row.company_name, email: row.email, website_url: websiteUrl }),
        });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) { setCheckState('error'); setCheckData({ message: json.error || 'Lusha check failed' }); return; }
        setCheckData(json);
        if (!json.found && json.strategy === 'requires_website') setCheckState('requires_website');
        else if (!json.found && json.strategy === 'bad_url') setCheckState('requires_website');
        else setCheckState(json.found ? 'found' : 'not_found');
      } catch (e: any) {
        if (!cancelled) { setCheckState('error'); setCheckData({ message: e.message }); }
      }
    })();
    return () => { cancelled = true; };
  }, [row.company_name, row.email]);

  const remaining = balance == null ? '?' : balance.toString();
  const initialChecked = new Set(ENRICHABLE_FIELD_CHOICES.filter((f) => {
    const v = (row as any)[f.key];
    return v === null || v === undefined || v === '';
  }).map((f) => f.key));
  const [checked, setChecked] = useState<Set<string>>(initialChecked.size > 0 ? initialChecked : new Set());

  function toggle(k: string) {
    const next = new Set(checked);
    if (next.has(k)) next.delete(k); else next.add(k);
    setChecked(next);
  }

  const lookupHandle = row.email ? `email: ${row.email}` : `company: ${row.company_name}`;
  const willOverwrite = ENRICHABLE_FIELD_CHOICES.filter((f) => checked.has(f.key) && (row as any)[f.key]);
  const canSpend = checkState === 'found' && checked.size > 0 && !busy;

  const stateBanner = () => {
    if (checkState === 'loading') {
      return (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 9, padding: '11px 13px',
          borderRadius: 'var(--r)', border: '1px solid var(--border)', background: 'var(--surface)',
        }}>
          <Loader size={14} className="spin" style={{ color: 'var(--text-subtle)' }} />
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Checking Lusha. This part is free, no credits are spent.
          </span>
        </div>
      );
    }
    if (checkState === 'found') {
      return (
        <Alert tone="success">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span>
              <strong>Found on Lusha</strong>
              {checkData?.lushaName ? <>, indexed as <strong>{checkData.lushaName}</strong></> : null}
            </span>
            {checkData?.matchedRole && (
              <span style={{ color: 'var(--text-muted)' }}>
                Contact found: <strong style={{ color: 'var(--text)' }}>{checkData.matchedRole}</strong>
              </span>
            )}
            {!checkData?.matchedRole && checkData?.contactCount === 0 && (
              <span style={{ color: 'var(--text-muted)' }}>
                No contact found in our role cascade, so only company level fields will populate.
              </span>
            )}
            {checkData?.matchedVariant && checkData.matchedVariant !== row.company_name && (
              <span style={{ color: 'var(--text-subtle)', fontSize: 11.5 }}>
                Matched on &ldquo;{checkData.matchedVariant}&rdquo;
              </span>
            )}
          </div>
        </Alert>
      );
    }
    if (checkState === 'requires_website') {
      return (
        <Alert tone="danger">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <strong>A website address is needed</strong>
            <span>{checkData?.message}</span>
            <span style={{ color: 'var(--text-subtle)', fontSize: 11.5 }}>
              Open this contact and add a Website link. Any form works: customer.com,
              www.customer.com, https://customer.com/
            </span>
          </div>
        </Alert>
      );
    }
    if (checkState === 'not_found') {
      return (
        <Alert tone="warning">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <strong>Not on Lusha</strong>
            <span>{checkData?.message}</span>
            <span style={{ color: 'var(--text-subtle)', fontSize: 11.5 }}>
              Nothing has been charged. Close this, or correct the company name and try again.
            </span>
          </div>
        </Alert>
      );
    }
    return (
      <Alert tone="danger">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <strong>The Lusha check failed</strong>
          <span>{checkData?.message}</span>
        </div>
      </Alert>
    );
  };

  return (
    <Modal
      onClose={onCancel}
      title="Enrich from Lusha"
      description={`Looking up ${lookupHandle}`}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          {checkState === 'found' && (
            <Button variant="accent" onClick={() => onConfirm(Array.from(checked))} disabled={!canSpend}>
              {busy ? <Loader size={14} className="spin" /> : <Send size={14} />}
              Spend 1 credit, update {checked.size} {checked.size === 1 ? 'field' : 'fields'}
            </Button>
          )}
        </>
      }
    >
      {stateBanner()}

      {/* The picker stays inert until Lusha confirms a match, because
          choosing fields for a company it cannot find spends nothing and
          teaches the wrong thing about what the button does. */}
      <div style={{
        opacity: checkState === 'found' ? 1 : 0.4,
        pointerEvents: checkState === 'found' ? 'auto' : 'none',
      }}>
        <Field label="Which fields to update">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {ENRICHABLE_FIELD_CHOICES.map((f) => {
              const current = (row as any)[f.key];
              const has = current !== null && current !== undefined && current !== '';
              const available = checkData?.availableFields ? (checkData.availableFields as any)[f.key] !== false : true;
              const disabled = !available && checkState === 'found';
              // Unavailable fields uncheck themselves the moment we know.
              if (disabled && checked.has(f.key)) {
                setTimeout(() => { const n = new Set(checked); n.delete(f.key); setChecked(n); }, 0);
              }
              const on = checked.has(f.key) && !disabled;
              return (
                <div key={f.key} style={{
                  padding: '4px 8px', borderRadius: 'var(--r)',
                  opacity: disabled ? 0.45 : 1,
                  background: on ? 'var(--surface-sunken)' : 'transparent',
                }}>
                  <Checkbox
                    checked={on}
                    onChange={() => !disabled && toggle(f.key)}
                    label={
                      <span>
                        {f.label}
                        {disabled && (
                          <span style={{ color: 'var(--warning)', fontSize: 11.5, marginLeft: 7 }}>
                            not available for this row
                          </span>
                        )}
                        {!disabled && has && (
                          <span style={{ color: 'var(--text-subtle)', fontSize: 11.5, marginLeft: 7 }}>
                            replaces {String(current).slice(0, 40)}
                          </span>
                        )}
                      </span>
                    }
                    hint={f.help}
                  />
                </div>
              );
            })}
          </div>
        </Field>
      </div>

      {checkState === 'found' && (
        <div style={{
          padding: '11px 13px', borderRadius: 'var(--r)',
          border: '1px solid var(--border)', background: 'var(--surface)',
          display: 'flex', flexDirection: 'column', gap: 5,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ color: 'var(--text-muted)' }}>Cost</span>
            <span style={{ fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>1 credit</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ color: 'var(--text-muted)' }}>Left afterwards</span>
            <span style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
              {balance == null ? 'unknown' : `${Math.max(0, balance - 1)} of ${remaining}`}
            </span>
          </div>
          {willOverwrite.length > 0 && (
            <div style={{ fontSize: 11.5, color: 'var(--warning)', borderTop: '1px solid var(--border)', paddingTop: 7 }}>
              This replaces {willOverwrite.length} existing {willOverwrite.length === 1 ? 'value' : 'values'}.
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
