'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueSetterParams, CellContextMenuEvent, RowClickedEvent } from 'ag-grid-community';
import Papa from 'papaparse';
import {
  Plus, Upload, Download, Loader, Trash2, X, Mail, Edit2, MoreHorizontal,
  Globe, Users, UserPlus, Share2, Phone, Building, MapPin, Hash, Send, Home, Star,
  CalendarPlus, Lock, Globe2, ChevronDown, Calendar,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { CRMContact, ContactStatus, CrmList, Profile, ContactNote, ContactAddress } from '@/lib/types';
import { ContactDrawer } from '@/components/crm/ContactDrawer';
import { NextActionPrompt } from '@/components/crm/NextActionPrompt';
import { GenerateProposalPicker } from '@/components/crm/GenerateProposalPicker';
import { ScheduleMeetingModal } from '@/components/crm/ScheduleMeetingModal';
import { Figure, Card } from '@/components/kit/primitives';

const STATUSES: ContactStatus[] = ['lead', 'contacted', 'quoted', 'won', 'lost'];

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

  const selectedList = lists.find((l) => l.id === selectedListId);
  const isOwner = selectedList ? selectedList.owner_id === profile.id : false;
  const canEdit = selectedList?.is_global
    ? true
    : isOwner ||
      members.some((m) => m.list_id === selectedListId && m.user_id === profile.id && m.can_edit) ||
      profile.role === 'admin';

  const myLists = lists.filter((l) => !l.is_global && l.owner_id === profile.id);
  const sharedLists = lists.filter((l) => !l.is_global && l.owner_id !== profile.id);
  const globalList = lists.find((l) => l.is_global);

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
    { field: 'company_name', headerName: 'Company', flex: 1.4, minWidth: 200, editable: canEdit, valueSetter: saveCell,
      cellRenderer: (p: ICellRendererParams<CRMContact>) =>
        <span style={{ fontWeight: 500, color: 'var(--fg-1)' }}>{p.value}</span> },
    { field: 'contact_name', headerName: 'Contact', flex: 1, minWidth: 150, editable: canEdit, valueSetter: saveCell },
    { field: 'email', headerName: 'Email', flex: 1.2, minWidth: 220, editable: canEdit, valueSetter: saveCell,
      cellRenderer: (p: ICellRendererParams<CRMContact>) =>
        p.value ? <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 12 }}>{p.value}</span>
                : <span style={{ color: 'var(--fg-4)', fontStyle: 'italic', fontSize: 12 }}>Right-click to enrich</span> },
    { field: 'phone', headerName: 'Phone', width: 140, editable: canEdit, valueSetter: saveCell,
      cellRenderer: (p: ICellRendererParams<CRMContact>) =>
        p.value ? <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 12 }}>{p.value}</span>
                : <span style={{ color: 'var(--fg-4)', fontStyle: 'italic', fontSize: 12 }}>Right-click to enrich</span> },
    { field: 'location', headerName: 'Location', width: 140, editable: canEdit, valueSetter: saveCell },
    { field: 'fleet_size', headerName: 'Fleet', width: 80, editable: false,
      valueGetter: (p) => {
        const r = p.data!;
        if (r.trucks != null || r.trailers != null || r.vans != null) {
          return (r.trucks ?? 0) + (r.trailers ?? 0) + (r.vans ?? 0);
        }
        return null;
      },
      cellRenderer: (p: ICellRendererParams<CRMContact, number>) =>
        p.value == null ? <span style={{ color: 'var(--fg-4)' }}>—</span> : <span className="tnum">{p.value}</span>
    },
    { field: 'status', headerName: 'Status', width: 130, editable: canEdit, valueSetter: saveCell,
      cellEditor: 'agSelectCellEditor', cellEditorParams: { values: STATUSES },
      cellRenderer: (p: ICellRendererParams<CRMContact, ContactStatus>) => {
        const v = p.value as ContactStatus | undefined;
        if (!v) return null;
        return <span className={`pill pill--${v}`}><span className="pill__dot" />{v}</span>;
      },
    },
    { field: 'turnover', headerName: 'Turnover', width: 130, editable: canEdit, valueSetter: saveCell,
      valueParser: (p) => p.newValue === '' ? null : Number(p.newValue) || null,
      valueFormatter: (p) => p.value != null ? '£' + Number(p.value).toLocaleString() : '',
      cellStyle: { fontFamily: '"IBM Plex Mono", monospace' } },
    { field: 'assigned_to', headerName: 'Assigned', width: 130, editable: canEdit, valueSetter: saveCell },
    { field: 'last_contact', headerName: 'Last contact', width: 120, editable: canEdit, valueSetter: saveCell },
    { field: 'notes', headerName: 'Latest note', flex: 1.5, minWidth: 240, editable: canEdit, valueSetter: saveCell,
      cellRenderer: (p: ICellRendererParams<CRMContact>) => p.value
        ? <span style={{ color: 'var(--fg-2)' }}>{p.value}</span>
        : <span style={{ color: 'var(--fg-4)', fontStyle: 'italic' }}>Click the row to add a note</span> },
  ], [canEdit, saveCell]);

  const defaultColDef: ColDef = useMemo(() => ({
    resizable: true, sortable: true, filter: true, floatingFilter: false, suppressMenu: false,
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
    const data = sel.length ? sel : rows;
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

  async function handleImport(file: File) {
    setImporting(true); setMessage(null);
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: async (results) => {
        try {
          const res = await fetch('/api/crm/import', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rows: results.data, list_id: selectedListId }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || 'Import failed');
          setMessage(`Imported ${json.inserted} contacts`);
          const { data } = await supabase.from('crm_contacts').select('*').eq('list_id', selectedListId).order('updated_at', { ascending: false });
          setRows((data ?? []) as CRMContact[]);
        } catch (e: any) { setMessage(e.message); }
        finally { setImporting(false); }
      },
    });
  }

  async function handleAddRow(name?: string) {
    const { data, error } = await supabase.from('crm_contacts')
      .insert({ company_name: name?.trim() || 'New company', status: 'lead', source: 'manual', list_id: selectedListId })
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
    setSelectedCount(gridRef.current?.api.getSelectedRows().length ?? 0);
  }

  // ---- counts ----
  const counts = useMemo(() => {
    const c = { all: rows.length, lead: 0, contacted: 0, quoted: 0, won: 0, lost: 0 } as Record<string, number>;
    rows.forEach((r) => { c[r.status] = (c[r.status] ?? 0) + 1; });
    return c;
  }, [rows]);

  // Visual: distinct color/icon for current list
  const listIsGlobal = selectedList?.is_global;
  const listOwnerName = profiles.find((p) => p.id === selectedList?.owner_id)?.full_name;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-head__eyebrow">
            {listIsGlobal ? 'Sales · Global CRM (team-shared)' : `Sales · My CRM list · owned by ${listOwnerName ?? 'nobody'}`}
          </div>
          <h1 className="page-head__title">
            <Users size={26} style={{ color: 'var(--stc-red)' }} />
            <span>{selectedList?.name ?? 'CRM'}<span style={{ color: 'var(--stc-red)' }}>.</span></span>
          </h1>
          <div className="page-head__sub">{rows.length} contacts · {listIsGlobal ? 'realtime · visible to everyone' : 'private to owner + shared members'}</div>
        </div>
      </div>

      {/* List bar - global pinned, personal on right */}
      <div className="list-bar">
        {globalList && (
          <button onClick={() => selectList(globalList.id)} className={`list-bar__tab list-bar__tab--global${selectedListId === globalList.id ? ' is-active' : ''}`}>
            <Globe size={14} /> Global CRM
          </button>
        )}
        {(myLists.length > 0 || sharedLists.length > 0) && (
          <span className="list-bar__divider" />
        )}
        {myLists.map((l) => (
          <button key={l.id} onClick={() => selectList(l.id)} className={`list-bar__tab${selectedListId === l.id ? ' is-active' : ''}`}>
            <Users size={14} /> {l.name}
          </button>
        ))}
        {sharedLists.map((l) => (
          <button key={l.id} onClick={() => selectList(l.id)} className={`list-bar__tab${selectedListId === l.id ? ' is-active' : ''}`}>
            <Share2 size={14} /> {l.name}
            <span className="mono" style={{ fontSize: 10, color: 'var(--fg-3)', marginLeft: 4 }}>SHARED</span>
          </button>
        ))}
        <button onClick={() => setShowNewList(true)} className="list-bar__tab list-bar__tab--new">
          <Plus size={14} /> New list
        </button>
        {selectedList && !selectedList.is_global && selectedList.owner_id === profile.id && (
          <>
            <div className="toolbar__spacer" />
            <button onClick={() => setShowShare(selectedList)} className="btn btn--sm"><UserPlus size={12} /> Share</button>
            <button onClick={() => deleteList(selectedList.id)} className="btn btn--sm btn--icon"><Trash2 size={12} /></button>
          </>
        )}
      </div>

      {/* Pipeline at a glance. One strip, because five separate tiles of
          the same weight read as noise and told you nothing about shape. */}
      <div className="kit" style={{ marginBottom: 14 }}>
        <Card padded={false}>
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            {[
              { label: 'Total', value: String(counts.all), sub: 'On this list' },
              { label: 'Leads', value: String(counts.lead), sub: 'Not yet approached', tone: 'info' as const },
              { label: 'Contacted', value: String(counts.contacted), sub: 'In conversation', tone: 'warning' as const },
              { label: 'Quoted', value: String(counts.quoted), sub: 'Awaiting a decision', tone: 'accent' as const },
              { label: 'Won', value: String(counts.won), sub: `${counts.lost} lost`, tone: 'success' as const },
            ].map((f, i) => (
              <div key={f.label} style={{
                flex: '1 1 150px', minWidth: 0, padding: '13px 17px',
                borderLeft: i === 0 ? 'none' : '1px solid var(--border)',
              }}>
                <Figure {...f} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Toolbar */}
      <div className="toolbar" style={{ marginTop: 14 }}>
        {canEdit && (
          <div className="row">
            <input type="email" placeholder="email@company.com to enrich"
              value={enrichEmail} onChange={(e) => setEnrichEmail(e.target.value)} className="input" style={{ width: 280 }} />
            <button onClick={handleEnrichInput} disabled={enriching || !enrichEmail} className="btn btn--primary">
              {enriching ? <Loader size={14} className="spin" /> : <Plus size={14} />} Enrich + add
            </button>
          </div>
        )}
        <div className="toolbar__spacer" />
        {selectedCount > 0 && (
          <div className="row" style={{ background: 'var(--stc-danger-bg)', padding: '4px 10px', borderRadius: 'var(--r-2)', border: '1px solid rgba(207,36,23,0.3)' }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--stc-red-300)' }}>{selectedCount} SELECTED</span>
            <button onClick={bulkEnrich} className="btn btn--sm"><Mail size={12} /> Enrich</button>
            <button onClick={(e) => setMoveTargetMenu({ x: e.clientX, y: e.clientY + 20, rowIds: gridRef.current?.api.getSelectedRows().map((r) => r.id) ?? [], mode: 'move' })} className="btn btn--sm"><MoreHorizontal size={12} /> Move…</button>
            {selectedCount <= 10 && (
              <button onClick={(e) => setMoveTargetMenu({ x: e.clientX, y: e.clientY + 20, rowIds: gridRef.current?.api.getSelectedRows().map((r) => r.id) ?? [], mode: 'duplicate' })} className="btn btn--sm"><Plus size={12} /> Duplicate…</button>
            )}
            <button onClick={bulkDelete} className="btn btn--sm" style={{ color: 'var(--stc-red-300)' }}><Trash2 size={12} /> Delete</button>
          </div>
        )}
        {canEdit && (
          <label className="btn">
            {importing ? <Loader size={14} className="spin" /> : <Upload size={14} />} Import CSV
            <input type="file" accept=".csv" hidden onChange={(e) => {
              const f = e.target.files?.[0]; if (f) handleImport(f); e.target.value = '';
            }} />
          </label>
        )}
        <button onClick={handleExport} className="btn"><Download size={14} /> Export{selectedCount > 0 ? ` (${selectedCount})` : ''}</button>
        {canEdit && <button onClick={() => handleAddRow()} className="btn btn--primary"><Plus size={14} /> Add contact</button>}
      </div>

      <div className="mono" style={{ fontSize: 11, color: 'var(--fg-3)', marginBottom: 6, marginTop: 4 }}>
        TIP · click any row to open details · right-click any cell for edit, enrich, move, delete
      </div>

      {message && <div className="alert alert--info" style={{ marginBottom: 12 }}>{message}</div>}

      <div className="ag-theme-quartz-dark"
        onContextMenu={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('.ag-row') || target.closest('.ag-header-cell')) return;
          e.preventDefault();
          setEmptyAreaMenu({ x: e.clientX, y: e.clientY });
        }}
        style={{ height: 'calc(100vh - 420px)', minHeight: 400, borderRadius: 'var(--r-3)', border: '1px solid var(--border)', overflow: 'hidden' }}>
        <AgGridReact<CRMContact>
          ref={gridRef}
          rowData={rows}
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
        />
      </div>

      {showNewList && <NewListModal onCreate={createList} onClose={() => setShowNewList(false)} />}
      {showShare && <ShareModal list={showShare} profiles={profiles.filter((p) => p.id !== profile.id)} members={members.filter((m) => m.list_id === showShare.id)} onShare={shareList} onUnshare={unshareList} onClose={() => setShowShare(null)} />}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y} row={contextMenu.row} field={contextMenu.field}
          canEdit={canEdit}
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
          <div className="ctx-menu__head">{selectedList?.name ?? 'CRM'}</div>
          <button onClick={() => { setEmptyAreaMenu(null); handleAddRow(); }} disabled={!canEdit}><Plus size={12} /> Add contact</button>
          <button onClick={() => { setEmptyAreaMenu(null); document.querySelector<HTMLInputElement>('input[type=file][accept=".csv"]')?.click(); }} disabled={!canEdit}><Upload size={12} /> Import CSV…</button>
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

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: 'red'|'success'|'warning'|'info'|'lusha' }) {
  return (
    <div className={`stat ${accent ? `stat--${accent}` : ''}`}>
      <div className="stat__bar" />
      <div className="stat__label">{label}</div>
      <div className="stat__value tnum">{value}</div>
    </div>
  );
}

function NewListModal({ onCreate, onClose }: { onCreate: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  return (
    <Modal onClose={onClose} title="New CRM list">
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) onCreate(name.trim()); }}>
        <div className="field">
          <div className="field__label">List name</div>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. M62 corridor, Hyde walk-ins" />
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" onClick={onClose} className="btn btn--ghost">Cancel</button>
          <button type="submit" className="btn btn--primary"><Plus size={14} /> Create</button>
        </div>
      </form>
    </Modal>
  );
}

function ShareModal({ list, profiles, members, onShare, onUnshare, onClose }: {
  list: CrmList; profiles: Profile[]; members: Member[];
  onShare: (l: string, u: string, e: boolean) => void; onUnshare: (l: string, u: string) => void; onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} title={`Share "${list.name}"`}>
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        {profiles.map((p) => {
          const m = members.find((x) => x.user_id === p.id);
          return (
            <div key={p.id} className="row-item">
              <div>
                <div className="row-item__title">{p.full_name}</div>
                <div className="row-item__sub mono">{p.email}</div>
              </div>
              {m ? <button onClick={() => onUnshare(list.id, p.id)} className="btn btn--sm">Remove</button>
                 : <button onClick={() => onShare(list.id, p.id, true)} className="btn btn--sm btn--primary"><UserPlus size={12} /> Share</button>}
            </div>
          );
        })}
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


// Inline wrapper for ctx-menus that auto-flips position to stay in viewport.
function EdgeAwareCtxMenu({ x, y, className, children }: { x: number; y: number; className?: string; children: React.ReactNode }) {
  const { ref, pos } = useEdgeAwarePosition(x, y);
  return (
    <div ref={ref} className={className ?? 'ctx-menu'} style={{ left: pos.left, top: pos.top }} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}

function ContextMenu({ x, y, row, field, canEdit, onView, onEdit, onEnrich, onDelete, onMove }: any) {
  const { ref, pos } = useEdgeAwarePosition(x, y);
  // Lusha returns these contact attributes:
  const ENRICHABLE_FIELDS = ['company_name','contact_name','email','phone','location','fleet_size'];
  const hasLookupHandle = !!row.email || !!row.company_name;
  const canEnrich = hasLookupHandle && ENRICHABLE_FIELDS.includes(field);
  const enrichTitle = !hasLookupHandle
    ? 'Add an email or company name to the row first - Lusha needs at least one to look up'
    : !ENRICHABLE_FIELDS.includes(field)
      ? 'Lusha does not provide this field'
      : row.email
        ? 'Look this contact up on Lusha by email'
        : 'Lusha will find a contact at ' + row.company_name + ' (Sales Director, MD, Fleet Manager...)';
  return (
    <div ref={ref} className="ctx-menu" style={{ left: pos.left, top: pos.top }} onClick={(e) => e.stopPropagation()}>
      <div className="ctx-menu__head">{row.company_name}{row.location && <span className="mono" style={{ marginLeft: 6, color: 'var(--fg-4)' }}>· {row.location}</span>}</div>
      <button onClick={onView}><Edit2 size={12} /> Open details</button>
      <button onClick={onEdit} disabled={!canEdit}><Edit2 size={12} /> Edit this cell</button>
      <button onClick={onEnrich} disabled={!canEnrich} title={enrichTitle}><Mail size={12} /> Enrich from Lusha…</button>
      <button onClick={onMove}><MoreHorizontal size={12} /> Move to list…</button>
      <hr />
      <button onClick={onDelete} disabled={!canEdit} style={{ color: 'var(--stc-red-300)' }}><Trash2 size={12} /> Delete</button>
    </div>
  );
}

function MoveMenu({ x, y, lists, onPick, onClose, mode = 'move' }: { x: number; y: number; lists: CrmList[]; onPick: (id: string) => void; onClose: () => void; mode?: 'move' | 'duplicate' }) {
  const { ref, pos } = useEdgeAwarePosition(x, y);
  return (
    <div ref={ref} className="ctx-menu" style={{ left: pos.left, top: pos.top }} onClick={(e) => e.stopPropagation()}>
      <div className="ctx-menu__head">{mode === 'duplicate' ? 'Duplicate to list' : 'Move to list'}</div>
      {lists.map((l) => (
        <button key={l.id} onClick={() => onPick(l.id)}>
          {l.is_global ? <Globe size={12} /> : <Users size={12} />} {l.name}
        </button>
      ))}
      {lists.length === 0 && <div className="row-item__sub" style={{ padding: 8 }}>No other lists.</div>}
      <hr />
      <button onClick={onClose}>Cancel</button>
    </div>
  );
}

function ListPickerModal({ lists, onPick, onClose, title }: { lists: CrmList[]; onPick: (id: string) => void; onClose: () => void; title: string }) {
  return (
    <Modal onClose={onClose} title={title}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {lists.map((l) => (
          <button key={l.id} onClick={() => onPick(l.id)} className="btn" style={{ justifyContent: 'flex-start', height: 40 }}>
            {l.is_global ? <Globe size={14} /> : <Users size={14} />} {l.name}
          </button>
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

  return (
    <Modal onClose={onCancel} title="Enrich from Lusha">
      <p style={{ color: 'var(--fg-2)', fontSize: 13.5, margin: 0 }}>
        Looking up via Lusha using <strong style={{ color: 'var(--fg-1)' }}>{lookupHandle}</strong>.
      </p>

      {/* Pre-flight banner */}
      {checkState === 'loading' && (
        <div className="card" style={{ marginTop: 12, padding: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Loader size={14} className="spin" />
          <span style={{ fontSize: 13, color: 'var(--fg-2)' }}>Checking Lusha&hellip; (free, no credits spent)</span>
        </div>
      )}
      {checkState === 'found' && (
        <div className="card" style={{ marginTop: 12, padding: 10, borderColor: 'var(--stc-success, #2da44e)' }}>
          <div style={{ fontSize: 12.5, color: 'var(--fg-1)' }}>
            <strong style={{ color: 'var(--stc-success, #2da44e)' }}>✓ Found on Lusha</strong>
            {checkData?.lushaName && <> &mdash; indexed as <strong>{checkData.lushaName}</strong></>}
            {checkData?.matchedRole && (
              <span style={{ fontSize: 12, color: 'var(--fg-2)', display: 'block', marginTop: 4 }}>
                Found contact at: <strong style={{ color: 'var(--fg-1)' }}>{checkData.matchedRole}</strong>
              </span>
            )}
            {!checkData?.matchedRole && checkData?.contactCount === 0 && (
              <span style={{ fontSize: 12, color: 'var(--stc-warning, #d4a017)', display: 'block', marginTop: 4 }}>
                No contact found in our role cascade, so only company-level fields will populate.
              </span>
            )}
            {checkData?.matchedVariant && checkData.matchedVariant !== row.company_name && (
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--fg-3)', display: 'block', marginTop: 4 }}>
                matched on &ldquo;{checkData.matchedVariant}&rdquo;
              </span>
            )}
          </div>
        </div>
      )}
      {checkState === 'requires_website' && (
        <div className="card" style={{ marginTop: 12, padding: 10, borderColor: 'var(--stc-red)' }}>
          <div style={{ fontSize: 12.5, color: 'var(--fg-1)' }}>
            <strong style={{ color: 'var(--stc-red)' }}>Website URL required</strong>
            <div style={{ fontSize: 12, color: 'var(--fg-2)', marginTop: 4 }}>{checkData?.message}</div>
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--fg-3)', marginTop: 6 }}>
              Open this contact&apos;s full view and add a Website link (any URL form works:{' '}
              <span style={{ color: 'var(--fg-2)' }}>customer.com</span>,{' '}
              <span style={{ color: 'var(--fg-2)' }}>www.customer.com</span>,{' '}
              <span style={{ color: 'var(--fg-2)' }}>https://customer.com/</span>).
            </div>
          </div>
        </div>
      )}

      {checkState === 'not_found' && (
        <div className="card" style={{ marginTop: 12, padding: 10, borderColor: 'var(--stc-warning, #d4a017)' }}>
          <div style={{ fontSize: 12.5, color: 'var(--fg-1)' }}>
            <strong style={{ color: 'var(--stc-warning, #d4a017)' }}>Not on Lusha</strong>
            <div style={{ fontSize: 12, color: 'var(--fg-2)', marginTop: 4 }}>{checkData?.message}</div>
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--fg-3)', marginTop: 6 }}>0 credits will be charged. Close this dialog or edit the company name.</div>
          </div>
        </div>
      )}
      {checkState === 'error' && (
        <div className="card" style={{ marginTop: 12, padding: 10, borderColor: 'var(--stc-red)' }}>
          <div style={{ fontSize: 12.5, color: 'var(--fg-1)' }}>
            <strong style={{ color: 'var(--stc-red)' }}>Lusha pre-check failed</strong>
            <div style={{ fontSize: 12, color: 'var(--fg-2)', marginTop: 4 }}>{checkData?.message}</div>
          </div>
        </div>
      )}

      {/* Field picker - disabled until we confirm Lusha has a match;
          each row also disabled if Lusha won't populate it. */}
      <div style={{ marginTop: 12, opacity: checkState === 'found' ? 1 : 0.4, pointerEvents: checkState === 'found' ? 'auto' : 'none' }}>
        <div className="field__label" style={{ marginBottom: 8 }}>Which fields to update?</div>
        <div className="col" style={{ gap: 4 }}>
          {ENRICHABLE_FIELD_CHOICES.map((f) => {
            const current = (row as any)[f.key];
            const has = current !== null && current !== undefined && current !== '';
            const available = checkData?.availableFields ? (checkData.availableFields as any)[f.key] !== false : true;
            const disabled = !available && checkState === 'found';
            // Auto-uncheck unavailable fields the moment we know they're unavailable
            if (disabled && checked.has(f.key)) {
              setTimeout(() => { const n = new Set(checked); n.delete(f.key); setChecked(n); }, 0);
            }
            return (
              <label key={f.key} className="row" style={{
                gap: 8, padding: '6px 8px',
                cursor: disabled ? 'not-allowed' : 'pointer',
                borderRadius: 'var(--r-2)',
                opacity: disabled ? 0.45 : 1,
                background: checked.has(f.key) && !disabled ? 'rgba(207,36,23,0.06)' : 'transparent',
              }}>
                <input type="checkbox" checked={checked.has(f.key) && !disabled} disabled={disabled} onChange={() => !disabled && toggle(f.key)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--fg-1)' }}>
                    {f.label}
                    {disabled && <span className="mono" style={{ fontSize: 10, color: 'var(--stc-warning, #d4a017)', marginLeft: 6 }}>not available on Lusha for this row</span>}
                    {!disabled && has && <span className="mono" style={{ fontSize: 10, color: 'var(--fg-3)', marginLeft: 6 }}>(will overwrite: {String(current).slice(0,40)})</span>}
                  </div>
                  <div className="row-item__sub">{f.help}</div>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {checkState === 'found' && (
        <div className="card" style={{ marginTop: 12, padding: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--fg-3)' }}>COST</span>
            <span className="tnum" style={{ fontWeight: 600 }}>1 credit</span>
          </div>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 4 }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--fg-3)' }}>REMAINING AFTER</span>
            <span className="tnum">{balance == null ? '?' : Math.max(0, balance - 1)} (of {remaining})</span>
          </div>
          {willOverwrite.length > 0 && (
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--stc-warning)', marginTop: 6 }}>
              {`// `}WILL OVERWRITE {willOverwrite.length} EXISTING VALUE{willOverwrite.length === 1 ? '' : 'S'}
            </div>
          )}
        </div>
      )}

      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        <button type="button" onClick={onCancel} className="btn btn--ghost">Cancel</button>
        {checkState === 'found' && (
          <button type="button" onClick={() => onConfirm(Array.from(checked))} className="btn btn--primary" disabled={!canSpend}>
            {busy ? <Loader size={14} className="spin" /> : <Send size={14} />} Spend 1 credit · update {checked.size} field{checked.size === 1 ? '' : 's'}
          </button>
        )}
      </div>
    </Modal>
  );
}

function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button onClick={onClose} className="btn btn--icon btn--sm"><X size={14} /></button>
        </div>
        <div style={{ padding: 16 }}>{children}</div>
      </div>
    </div>
  );
}
