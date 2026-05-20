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
import { extractCityFromAddress } from '@/lib/uk-cities';

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
                : <span style={{ color: 'var(--fg-4)', fontStyle: 'italic', fontSize: 12 }}>— right-click to enrich</span> },
    { field: 'phone', headerName: 'Phone', width: 140, editable: canEdit, valueSetter: saveCell,
      cellRenderer: (p: ICellRendererParams<CRMContact>) =>
        p.value ? <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 12 }}>{p.value}</span>
                : <span style={{ color: 'var(--fg-4)', fontStyle: 'italic', fontSize: 12 }}>— right-click</span> },
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
        : <span style={{ color: 'var(--fg-4)', fontStyle: 'italic' }}>— click row to add note</span> },
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

  async function handleAddRow() {
    const { data, error } = await supabase.from('crm_contacts')
      .insert({ company_name: 'New company', status: 'lead', source: 'manual', list_id: selectedListId })
      .select('*').single();
    if (error) { setMessage(error.message); return; }
    setRows((r) => [data as CRMContact, ...r]);
    setDrawerRow(data as CRMContact);
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
            {listIsGlobal ? 'Sales · Global CRM (team-shared)' : `Sales · My CRM list · owned by ${listOwnerName ?? '—'}`}
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

      {/* Stats */}
      <div className="stats-grid stats-grid--5">
        <Stat label="Total"     value={counts.all} />
        <Stat label="Leads"     value={counts.lead}      accent="info" />
        <Stat label="Contacted" value={counts.contacted} accent="warning" />
        <Stat label="Quoted"    value={counts.quoted}    accent="lusha" />
        <Stat label="Won · Lost" value={`${counts.won} · ${counts.lost}`} accent="success" />
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
        {canEdit && <button onClick={handleAddRow} className="btn btn--primary"><Plus size={14} /> Add contact</button>}
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
        <div className="ctx-menu" style={{ left: emptyAreaMenu.x, top: emptyAreaMenu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="ctx-menu__head">{selectedList?.name ?? 'CRM'}</div>
          <button onClick={() => { setEmptyAreaMenu(null); handleAddRow(); }} disabled={!canEdit}><Plus size={12} /> Add contact</button>
          <button onClick={() => { setEmptyAreaMenu(null); document.querySelector<HTMLInputElement>('input[type=file][accept=".csv"]')?.click(); }} disabled={!canEdit}><Upload size={12} /> Import CSV…</button>
        </div>
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

function ContextMenu({ x, y, row, field, canEdit, onView, onEdit, onEnrich, onDelete, onMove }: any) {
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
    <div className="ctx-menu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
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
  return (
    <div className="ctx-menu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
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
                No contact found in our role cascade — only company-level fields will populate.
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

function ContactDrawer({ contact, profile, canEdit, lists, members, onClose, onChange, onDelete }: {
  contact: CRMContact; profile: Profile; canEdit: boolean;
  lists: CrmList[]; members: Member[];
  onClose: () => void; onChange: (c: CRMContact) => void; onDelete: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [noteText, setNoteText] = useState('');
  const [loadingNotes, setLoadingNotes] = useState(true);
  const [edit, setEdit] = useState<CRMContact>(contact);
  const [showAddLink, setShowAddLink] = useState<null | 'website' | 'linkedin' | 'facebook' | 'instagram' | 'x' | 'other'>(null);
  const [movePickerOpen, setMovePickerOpen] = useState<'move' | 'duplicate' | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [meetings, setMeetings] = useState<any[]>([]);
  const [conflictMeeting, setConflictMeeting] = useState<any | null>(null);
  const [alsoOn, setAlsoOn] = useState<{ id: string; name: string; is_global: boolean }[]>([]);
  useEffect(() => { setEdit(contact); }, [contact]);

  useEffect(() => {
    (async () => {
      setLoadingNotes(true);
      const { data } = await supabase.from('contact_notes').select('*').eq('contact_id', contact.id).order('created_at', { ascending: false });
      setNotes((data ?? []) as ContactNote[]);
      setLoadingNotes(false);
    })();
  }, [supabase, contact.id]);

  // Load scheduled meetings for this contact
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('calendar_events').select('*').eq('contact_id', contact.id).order('start_at', { ascending: true });
      if (!cancelled) setMeetings(data ?? []);
    })();
    return () => { cancelled = true; };
  }, [supabase, contact.id, showSchedule]);

  // Detect "also on" - other contacts on lists you can see that share email or company+contact
  useEffect(() => {
    (async () => {
      const matches: { id: string; name: string; is_global: boolean }[] = [];
      const otherIdsSeen = new Set<string>();
      // Query by email if present, else by company_name+contact_name
      let q = supabase.from('crm_contacts').select('id, list_id').neq('id', contact.id);
      if (contact.email) q = q.eq('email', contact.email);
      else q = q.eq('company_name', contact.company_name).eq('contact_name', contact.contact_name ?? '');
      const { data: hits } = await q;
      for (const h of (hits ?? []) as { id: string; list_id: string }[]) {
        if (!h.list_id || otherIdsSeen.has(h.list_id)) continue;
        otherIdsSeen.add(h.list_id);
        const l = lists.find((x) => x.id === h.list_id);
        if (l) matches.push({ id: l.id, name: l.name, is_global: l.is_global });
      }
      setAlsoOn(matches);
    })();
  }, [supabase, contact, lists]);

  async function addNote() {
    if (!noteText.trim()) return;
    const { data, error } = await supabase.from('contact_notes')
      .insert({ contact_id: contact.id, author_id: profile.id, author_name: profile.full_name, text: noteText.trim() })
      .select('*').single();
    if (error) { alert(error.message); return; }
    setNotes((n) => [data as ContactNote, ...n]);
    setNoteText('');
    onChange({ ...contact, notes: (data as ContactNote).text });
  }

  async function saveField(field: keyof CRMContact, value: any) {
    if (contact[field] === value) return;
    const patch: any = { [field]: value };
    // If address changed, also extract city -> location
    if (field === 'address' && typeof value === 'string') {
      const city = extractCityFromAddress(value);
      if (city && city !== contact.location) patch.location = city;
    }
    const { data, error } = await supabase.from('crm_contacts').update(patch).eq('id', contact.id).select('*').single();
    if (error) { alert(error.message); return; }
    setEdit(data as CRMContact);
    onChange(data as CRMContact);
  }

  async function saveFleet(part: 'trucks' | 'trailers' | 'vans', value: number | null) {
    const patch: any = { [part]: value };
    const { data, error } = await supabase.from('crm_contacts').update(patch).eq('id', contact.id).select('*').single();
    if (error) { alert(error.message); return; }
    setEdit(data as CRMContact);
    onChange(data as CRMContact);
  }

  async function addLink(kind: 'website' | 'linkedin' | 'facebook' | 'instagram' | 'x' | 'other', label: string, url: string) {
    if (!url.trim()) return;
    const existing = Array.isArray(contact.links) ? contact.links : [];
    const fresh = [...existing, { id: crypto.randomUUID(), label: label.trim() || kind.charAt(0).toUpperCase() + kind.slice(1), url: url.trim(), kind }];
    const { data, error } = await supabase.from('crm_contacts').update({ links: fresh }).eq('id', contact.id).select('*').single();
    if (error) { alert(error.message); return; }
    setEdit(data as CRMContact);
    onChange(data as CRMContact);
    setShowAddLink(null);
  }
  async function removeLink(id: string) {
    const fresh = (contact.links ?? []).filter((l) => l.id !== id);
    const { data, error } = await supabase.from('crm_contacts').update({ links: fresh }).eq('id', contact.id).select('*').single();
    if (error) { alert(error.message); return; }
    setEdit(data as CRMContact);
    onChange(data as CRMContact);
  }

    const [addrRefreshTick, setAddrRefreshTick] = useState(0);
  async function addAddress() {
    const { error } = await supabase.from('contact_addresses').insert({
      contact_id: contact.id, label: 'New location', address: '', is_primary: false,
    });
    if (error) { alert(error.message); return; }
    setAddrRefreshTick((t) => t + 1);
  }

  async function moveToList(targetListId: string) {
    const { data, error } = await supabase.from('crm_contacts').update({ list_id: targetListId }).eq('id', contact.id).select('*').single();
    if (error) { alert(error.message); return; }
    setMovePickerOpen(null);
    onChange(data as CRMContact);
    onClose();
  }
  async function duplicateToList(targetListId: string) {
    const { id, created_at, updated_at, ...rest } = contact as any;
    const { error } = await supabase.from('crm_contacts').insert({ ...rest, list_id: targetListId });
    if (error) { alert(error.message); return; }
    setMovePickerOpen(null);
    alert(`Duplicated to ${lists.find((l) => l.id === targetListId)?.name}`);
  }

  const fleetTotal = (edit.trucks ?? 0) + (edit.trailers ?? 0) + (edit.vans ?? 0);
  const hasBreakdown = (edit.trucks ?? 0) + (edit.trailers ?? 0) + (edit.vans ?? 0) > 0;

  const otherLists = lists.filter((l) => l.id !== contact.list_id);

  return (
    <div className="drawer-bg" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer__head">
          <div>
            <div className="page-head__eyebrow">Contact</div>
            <h2 style={{ margin: '4px 0 0' }}><Building size={18} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />{edit.company_name}</h2>
            {alsoOn.length > 0 && (
              <div className="mono" style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>
                {`// `}ALSO ON: {alsoOn.map((l) => l.name).join(', ')}
              </div>
            )}
          </div>
          <button onClick={onClose} className="btn btn--icon"><X size={14} /></button>
        </div>

        <div className="drawer__body">
          <div className="split-2" style={{ gap: 10 }}>
            <DrawerField label="Company" value={edit.company_name} onSave={(v) => saveField('company_name', v)} canEdit={canEdit} />
            <DrawerField label="Contact" value={edit.contact_name} onSave={(v) => saveField('contact_name', v)} canEdit={canEdit} />
          </div>
          <div className="split-2" style={{ gap: 10, marginTop: 10 }}>
            <DrawerField label="Email" value={edit.email} onSave={(v) => saveField('email', v)} canEdit={canEdit} mono />
            <DrawerField label="Phone" value={edit.phone} onSave={(v) => saveField('phone', v)} canEdit={canEdit} mono />
          </div>

          {/* Addresses - multiple, primary indicator */}
          <div className="field" style={{ marginTop: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <div className="field__label" style={{ marginBottom: 0 }}>Addresses</div>
              {canEdit && (
                <button type="button" onClick={addAddress} className="btn btn--sm"><Plus size={12} /> Add another location</button>
              )}
            </div>
            <AddressList contactId={edit.id} canEdit={canEdit} legacyAddress={edit.address}
              onPrimaryChange={(addr, city) => onChange({ ...edit, address: addr, location: city ?? edit.location })} />
          </div>

          {/* Fleet breakdown - inline 4-column */}
          <div className="field" style={{ marginTop: 14 }}>
            <div className="field__label">Fleet breakdown</div>
            <div className="fleet-row">
              <FleetInput label="Trucks" value={edit.trucks} onSave={(n) => saveFleet('trucks', n)} canEdit={canEdit} />
              <FleetInput label="Trailers" value={edit.trailers} onSave={(n) => saveFleet('trailers', n)} canEdit={canEdit} />
              <FleetInput label="Vans" value={edit.vans} onSave={(n) => saveFleet('vans', n)} canEdit={canEdit} />
              <div className="fleet-row__total">
                <span className="fleet-row__total-label">Total</span>
                <span className="fleet-row__total-value">{hasBreakdown ? fleetTotal : '—'}</span>
              </div>
            </div>
          </div>

          <div className="split-2" style={{ gap: 10, marginTop: 14 }}>
            <div className="field">
              <div className="field__label">Status</div>
              <select className="input" disabled={!canEdit} value={edit.status} onChange={(e) => saveField('status', e.target.value)}>
                {STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
              </select>
            </div>
            <DrawerField label="Assigned to" value={edit.assigned_to} onSave={(v) => saveField('assigned_to', v)} canEdit={canEdit} />
          </div>
          <div className="split-2" style={{ gap: 10, marginTop: 10 }}>
            <div className="field">
              <div className="field__label">Employees</div>
              <input type="number" min={0} className="input tnum" disabled={!canEdit}
                defaultValue={edit.employee_count ?? ''}
                onBlur={(e) => saveField('employee_count', e.target.value === '' ? null : Number(e.target.value))} />
            </div>
            <div className="field">
              <div className="field__label">Turnover (£)</div>
              <input type="number" min={0} step={1000} className="input tnum" disabled={!canEdit}
                defaultValue={edit.turnover ?? ''}
                onBlur={(e) => saveField('turnover', e.target.value === '' ? null : Number(e.target.value))} />
            </div>
          </div>

          {/* Links */}
          <div className="hr" />
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <div className="page-head__eyebrow" style={{ marginBottom: 0 }}>Links</div>
            {canEdit && (
              <div className="row">
                <button onClick={() => setShowAddLink('website')} className="btn btn--sm"><Plus size={12} /> Add website</button>
                <button onClick={() => setShowAddLink('linkedin')} className="btn btn--sm"><Plus size={12} /> Add social</button>
              </div>
            )}
          </div>
          {(edit.links ?? []).length === 0
            ? <div className="row-item__sub">No links yet.</div>
            : (
              <div className="col" style={{ gap: 4 }}>
                {edit.links.map((l) => (
                  <div key={l.id} className="row" style={{ justifyContent: 'space-between', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--r-2)', padding: '6px 10px' }}>
                    <a href={l.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--fg-1)', fontSize: 13 }}>
                      <span className="mono" style={{ color: 'var(--stc-red)', marginRight: 6, fontSize: 10 }}>{l.kind.toUpperCase()}</span>
                      <strong>{l.label}</strong>
                      <span className="mono" style={{ color: 'var(--fg-4)', marginLeft: 6, fontSize: 11 }}>{l.url}</span>
                    </a>
                    {canEdit && <button onClick={() => removeLink(l.id)} className="btn btn--icon btn--sm"><X size={12} /></button>}
                  </div>
                ))}
              </div>
            )
          }
          {showAddLink && <AddLinkForm kind={showAddLink} onSave={(label, url) => addLink(showAddLink, label, url)} onCancel={() => setShowAddLink(null)} />}

          {/* Notes */}
          <div className="hr" />
          <div className="page-head__eyebrow" style={{ marginBottom: 8 }}>Notes &amp; history</div>
          {canEdit && (
            <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <textarea className="input" placeholder="Add a note (call summary, next step, anything)..."
                value={noteText} onChange={(e) => setNoteText(e.target.value)}
                style={{ minHeight: 70, flex: 1, padding: 10 }} />
              <button onClick={addNote} className="btn btn--primary" disabled={!noteText.trim()}>
                <Send size={14} /> Add note
              </button>
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            {loadingNotes ? (
              <div className="row-item__sub">Loading...</div>
            ) : notes.length === 0 ? (
              <div className="row-item__sub">No notes yet. The latest one shows in the grid.</div>
            ) : notes.map((n) => (
              <div key={n.id} className="note-item">
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--stc-red)' }}>{`// `}{n.author_name.toUpperCase()}</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--fg-4)' }}>{new Date(n.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <p style={{ margin: 0, color: 'var(--fg-1)', whiteSpace: 'pre-wrap' }}>{n.text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Scheduled meetings tied to this contact */}
        <div className="card" style={{ padding: 14, margin: '14px 0' }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <div className="field__label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Calendar size={14} /> SCHEDULED MEETINGS
            </div>
            {canEdit && (
              <button onClick={() => {
                // Check for any upcoming meeting in next 14d - warn before opening modal
                const now = Date.now();
                const wnd = 14 * 86_400_000;
                const upcoming = meetings.find((m: any) => {
                  const t = new Date(m.start_at).getTime();
                  return t > now && (t - now) < wnd;
                });
                if (upcoming) { setConflictMeeting(upcoming); return; }
                setShowSchedule(true);
              }} className="btn btn--sm btn--primary"><CalendarPlus size={12} /> Schedule</button>
            )}
          </div>
          {meetings.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>No meetings scheduled yet.</div>
          ) : (
            <div className="col" style={{ gap: 6 }}>
              {meetings.map((m: any) => {
                const date = new Date(m.start_at);
                const isPast = date.getTime() < Date.now();
                return (
                  <div key={m.id} className="row" style={{ gap: 8, padding: '6px 8px', background: 'var(--bg-3)', borderRadius: 6, opacity: isPast ? 0.55 : 1 }}>
                    <Calendar size={14} style={{ color: isPast ? 'var(--fg-4)' : 'var(--stc-red)', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{m.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                        {date.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        {isPast && ' · (past)'}
                        {Array.isArray(m.attendees) && m.attendees.length > 0 && ` · ${m.attendees.length} attendee${m.attendees.length === 1 ? '' : 's'}`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {conflictMeeting && (
          <div className="modal-bg" onClick={() => setConflictMeeting(null)} style={{ zIndex: 1100 }}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
              <div className="modal__head">
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  ⚠️ Existing meeting found
                </h3>
              </div>
              <div style={{ padding: 16 }}>
                <p style={{ marginTop: 0, color: 'var(--fg-2)', fontSize: 13.5 }}>
                  You already have a meeting with <strong style={{ color: 'var(--fg-1)' }}>{edit.company_name}</strong> within the next 14 days:
                </p>
                <div className="card" style={{ padding: 10, marginBottom: 12 }}>
                  <div style={{ fontWeight: 600 }}>{conflictMeeting.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 4 }}>
                    {new Date(conflictMeeting.start_at).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
              <div className="row" style={{ justifyContent: 'flex-end', padding: '0 16px 16px', gap: 8 }}>
                <button onClick={() => setConflictMeeting(null)} className="btn btn--ghost">View existing</button>
                <button onClick={() => { setConflictMeeting(null); setShowSchedule(true); }} className="btn btn--primary">Schedule anyway</button>
              </div>
            </div>
          </div>
        )}

        {/* Manage footer */}
        <div className="drawer__foot">
          {canEdit && (
            <>
              <button onClick={() => setShowSchedule(true)} className="btn btn--sm btn--primary"><CalendarPlus size={12} /> Schedule meeting</button>
              <button onClick={() => setMovePickerOpen('move')} className="btn btn--sm"><MoreHorizontal size={12} /> Move to list</button>
              <button onClick={() => setMovePickerOpen('duplicate')} className="btn btn--sm"><Plus size={12} /> Duplicate to list</button>
              <button onClick={() => exportContact(edit, notes, lists)} className="btn btn--sm"><Download size={12} /> Export</button>
              <button onClick={onDelete} className="btn btn--sm" style={{ color: 'var(--stc-red-300)' }}><Trash2 size={12} /> Delete</button>
            </>
          )}
          <div className="toolbar__spacer" />
          <button onClick={onClose} className="btn">Close</button>
        </div>

        {showSchedule && (
          <ScheduleMeetingModal
            contact={edit}
            profile={profile}
            allProfiles={[]}
            onClose={() => setShowSchedule(false)}
          />
        )}

        {movePickerOpen && (
          <div className="modal-bg" onClick={() => setMovePickerOpen(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal__head">
                <h3 style={{ margin: 0 }}>{movePickerOpen === 'move' ? 'Move to which list?' : 'Duplicate to which list?'}</h3>
                <button onClick={() => setMovePickerOpen(null)} className="btn btn--icon btn--sm"><X size={14} /></button>
              </div>
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {otherLists.map((l) => (
                  <button key={l.id}
                    onClick={() => movePickerOpen === 'move' ? moveToList(l.id) : duplicateToList(l.id)}
                    className="btn" style={{ justifyContent: 'flex-start', height: 40 }}>
                    {l.is_global ? <Globe size={14} /> : <Users size={14} />} {l.name}
                  </button>
                ))}
                {otherLists.length === 0 && <div className="row-item__sub">No other lists.</div>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AddressList({ contactId, canEdit, legacyAddress, onPrimaryChange }: {
  contactId: string; canEdit: boolean; legacyAddress: string | null;
  onPrimaryChange: (address: string, city: string | null) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<ContactAddress[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('contact_addresses').select('*').eq('contact_id', contactId).order('is_primary', { ascending: false }).order('created_at', { ascending: true });
    setItems((data ?? []) as ContactAddress[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [contactId]);

  // Realtime: keep address list in sync
  useEffect(() => {
    const ch = supabase.channel(`addrs:${contactId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contact_addresses', filter: `contact_id=eq.${contactId}` },
        () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, contactId]);

  async function save(id: string, patch: Partial<ContactAddress>) {
    let nextPatch: any = { ...patch };
    if (patch.address !== undefined) {
      nextPatch.city = patch.address ? extractCityFromAddress(patch.address) : null;
    }
    const { error } = await supabase.from('contact_addresses').update(nextPatch).eq('id', id);
    if (error) alert(error.message);
    if (patch.is_primary) {
      const row = items.find((i) => i.id === id);
      if (row) onPrimaryChange(patch.address ?? row.address, nextPatch.city ?? row.city);
    }
  }
  async function remove(id: string) {
    if (!confirm('Delete this address?')) return;
    const { error } = await supabase.from('contact_addresses').delete().eq('id', id);
    if (error) alert(error.message);
  }
  async function setPrimary(id: string) {
    const { error } = await supabase.from('contact_addresses').update({ is_primary: true }).eq('id', id);
    if (error) { alert(error.message); return; }
    // Trigger runs in DB, but force a refetch of the contact so the grid + drawer reflect
    // the new primary city immediately (without waiting on realtime).
    const { data: refreshed } = await supabase.from('crm_contacts').select('*').eq('id', contactId).single();
    if (refreshed) {
      const row = items.find((i) => i.id === id);
      onPrimaryChange((refreshed as any).address ?? row?.address ?? '', (refreshed as any).location ?? null);
    }
  }

  if (loading) return <div className="row-item__sub">Loading addresses…</div>;
  // Migrate legacy single-address into first entry if no rows exist
  if (items.length === 0 && legacyAddress) {
    return (
      <div className="card" style={{ padding: 12 }}>
        <div className="field__label" style={{ marginBottom: 4 }}>Head office (primary)</div>
        <textarea className="input" rows={6} disabled={!canEdit} defaultValue={legacyAddress}
          onBlur={async (e) => {
            const val = e.target.value;
            await supabase.from('contact_addresses').insert({ contact_id: contactId, label: 'Head office', address: val, is_primary: true });
          }} />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="card" style={{ padding: 12 }}>
        <div className="row-item__sub">No addresses yet. Click <strong>Add another location</strong> to add one.</div>
      </div>
    );
  }
  return (
    <div className="col" style={{ gap: 10 }}>
      {items.map((a) => (
        <div key={a.id} className="card" style={{ padding: 12, borderLeft: a.is_primary ? '2px solid var(--stc-red)' : '1px solid var(--border)' }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <input className="input" disabled={!canEdit} defaultValue={a.label}
              onBlur={(e) => save(a.id, { label: e.target.value || 'Location' })}
              style={{ height: 28, fontSize: 12.5, fontWeight: 600, maxWidth: 240 }} />
            <div className="row" style={{ gap: 4 }}>
              {a.is_primary
                ? <span className="mono" style={{ fontSize: 10, color: 'var(--stc-red)', padding: '2px 6px', border: '1px solid var(--stc-red)', borderRadius: 'var(--r-1)' }}>PRIMARY</span>
                : canEdit && <button onClick={() => setPrimary(a.id)} className="btn btn--sm btn--ghost"><Star size={12} /> Set primary</button>
              }
              {canEdit && <button onClick={() => remove(a.id)} className="btn btn--icon btn--sm"><Trash2 size={12} /></button>}
            </div>
          </div>
          <textarea className="input" rows={5} disabled={!canEdit}
            placeholder="Building, Street, Town, City, Postcode"
            defaultValue={a.address}
            onBlur={(e) => save(a.id, { address: e.target.value })} />
        </div>
      ))}
    </div>
  );
}

function exportContact(c: CRMContact, notes: ContactNote[], lists: CrmList[]) {
  const list = lists.find((l) => l.id === c.list_id);
  const safe = (v: any) => (v === null || v === undefined || v === '') ? null : v;
  // Build lines, omit empty
  const lines: string[] = [];
  lines.push(`<!doctype html><html><head><meta charset="utf-8"><title>${c.company_name} - STC export</title>`);
  lines.push(`<style>
    body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 760px; margin: 24px auto; padding: 0 24px; color: #0a1133; }
    h1 { font-size: 26px; margin: 0 0 4px; }
    h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em; color: #cf2417; margin: 28px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    td { padding: 5px 0; vertical-align: top; }
    td:first-child { width: 32%; color: #666; font-size: 13px; }
    td:last-child { font-size: 14px; }
    .note { background: #f8f8fb; border-left: 3px solid #cf2417; padding: 10px 12px; margin: 8px 0; border-radius: 4px; }
    .note__meta { font-size: 11px; color: #888; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.08em; }
    .fleet { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .fleet > div { background: #f5f5fa; padding: 8px 10px; border-radius: 4px; }
    .fleet .l { font-size: 11px; color: #666; text-transform: uppercase; }
    .fleet .v { font-size: 18px; font-weight: 600; }
  </style></head><body>`);
  lines.push(`<h1>${c.company_name}</h1>`);
  lines.push(`<div style="color:#666; font-size:13px;">${list?.name ?? ''} · ${c.status} · exported ${new Date().toLocaleString('en-GB')}</div>`);

  // Primary details
  lines.push(`<h2>Primary contact</h2><table>`);
  const rows: [string, any][] = [
    ['Contact name', safe(c.contact_name)],
    ['Email', safe(c.email)],
    ['Phone', safe(c.phone)],
    ['Location (primary city)', safe(c.location)],
    ['Source', safe(c.source)],
    ['Assigned to', safe(c.assigned_to)],
    ['Last contacted', safe(c.last_contact)],
    ['Employee count', safe(c.employee_count)],
    ['Turnover', c.turnover != null ? '£' + Number(c.turnover).toLocaleString() : null],
  ];
  for (const [k, v] of rows) if (v !== null) lines.push(`<tr><td>${k}</td><td>${v}</td></tr>`);
  lines.push(`</table>`);

  // Fleet breakdown - always shown
  lines.push(`<h2>Fleet breakdown</h2>`);
  lines.push(`<div class="fleet">
    <div><div class="l">Trucks</div><div class="v">${c.trucks ?? '—'}</div></div>
    <div><div class="l">Trailers</div><div class="v">${c.trailers ?? '—'}</div></div>
    <div><div class="l">Vans</div><div class="v">${c.vans ?? '—'}</div></div>
    <div><div class="l">Total</div><div class="v">${c.fleet_size ?? '—'}</div></div>
  </div>`);

  // Primary address from c.address (legacy single field)
  if (c.address) {
    lines.push(`<h2>Address</h2><div style="white-space:pre-wrap; font-size:14px;">${c.address}</div>`);
  }

  // Links
  if (c.links && c.links.length) {
    lines.push(`<h2>Links</h2><table>`);
    for (const l of c.links) lines.push(`<tr><td>${l.label} <span style="color:#999; font-size:11px;">(${l.kind})</span></td><td><a href="${l.url}">${l.url}</a></td></tr>`);
    lines.push(`</table>`);
  }

  // Notes history
  if (notes.length) {
    lines.push(`<h2>Notes &amp; history</h2>`);
    for (const n of notes) {
      lines.push(`<div class="note"><div class="note__meta">${n.author_name} · ${new Date(n.created_at).toLocaleString('en-GB')}</div><div>${n.text.replace(/\n/g, '<br>')}</div></div>`);
    }
  }

  lines.push(`</body></html>`);
  const blob = new Blob([lines.join('\n')], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${c.company_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-export-${new Date().toISOString().slice(0, 10)}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

function FleetInput({ label, value, onSave, canEdit }: { label: string; value: number | null; onSave: (n: number | null) => void; canEdit: boolean }) {
  const [v, setV] = useState<string>(value?.toString() ?? '');
  useEffect(() => { setV(value?.toString() ?? ''); }, [value]);
  return (
    <div className="field">
      <div className="field__label">{label}</div>
      <input type="number" min={0} disabled={!canEdit} value={v}
        className="input tnum"
        onChange={(e) => setV(e.target.value)}
        onBlur={() => onSave(v === '' ? null : Number(v))} />
    </div>
  );
}

function AddLinkForm({ kind, onSave, onCancel }: { kind: string; onSave: (label: string, url: string) => void; onCancel: () => void }) {
  const placeholders: Record<string, { label: string; url: string }> = {
    website:   { label: 'Main site', url: 'https://example.co.uk' },
    linkedin:  { label: 'LinkedIn',  url: 'https://linkedin.com/company/...' },
    facebook:  { label: 'Facebook',  url: 'https://facebook.com/...' },
    instagram: { label: 'Instagram', url: 'https://instagram.com/...' },
    x:         { label: 'X',         url: 'https://x.com/...' },
    other:     { label: 'Other',     url: 'https://...' },
  };
  const ph = placeholders[kind] ?? placeholders.other;
  const [label, setLabel] = useState(ph.label);
  const [url, setUrl] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(label, url); }}
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--r-2)', padding: 10, marginTop: 8 }}>
      <div className="row" style={{ gap: 8 }}>
        <input className="input" placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} style={{ width: 140 }} />
        <input className="input" placeholder={ph.url} value={url} onChange={(e) => setUrl(e.target.value)} required style={{ flex: 1 }} autoFocus />
        <button type="submit" className="btn btn--primary btn--sm"><Plus size={12} /> Save</button>
        <button type="button" onClick={onCancel} className="btn btn--ghost btn--sm">Cancel</button>
      </div>
    </form>
  );
}

function DrawerField({ label, value, onSave, canEdit, mono }: { label: string; value: string | null; onSave: (v: string) => void; canEdit: boolean; mono?: boolean }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => { setV(value ?? ''); }, [value]);
  return (
    <div className="field">
      <div className="field__label">{label}</div>
      <input className={`input${mono ? ' mono' : ''}`} disabled={!canEdit} value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => onSave(v)} />
    </div>
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
      // Free-text — treat as guest. If it looks like an email, store as email.
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
    const { error } = await supabase.from('calendar_events').insert({
      title,
      description: description || null,
      start_at: startISO,
      end_at: endISO,
      all_day: false,
      color: '#cf2417',
      created_by: profile.id,
      contact_id: contact.id,
      attendees,
      visibility,
      visible_to: visibility === 'specific' ? visibleTo : [],
    });
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
