'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueSetterParams, CellContextMenuEvent, RowClickedEvent } from 'ag-grid-community';
import Papa from 'papaparse';
import {
  Plus, Upload, Download, Loader, Trash2, X, Mail, Edit2, MoreHorizontal,
  Globe, Users, UserPlus, Share2, Phone, Building, MapPin, Hash, Send,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { CRMContact, ContactStatus, CrmList, Profile, ContactNote } from '@/lib/types';

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
  const [enrichEmail, setEnrichEmail] = useState('');
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showNewList, setShowNewList] = useState(false);
  const [showShare, setShowShare] = useState<CrmList | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; row: CRMContact; field?: string } | null>(null);
  const [moveTargetMenu, setMoveTargetMenu] = useState<{ x: number; y: number; rowIds: string[] } | null>(null);
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
    { field: 'fleet_size', headerName: 'Fleet', width: 80, editable: canEdit, valueSetter: saveCell,
      valueParser: (p) => p.newValue === '' ? null : Number(p.newValue) },
    { field: 'status', headerName: 'Status', width: 130, editable: canEdit, valueSetter: saveCell,
      cellEditor: 'agSelectCellEditor', cellEditorParams: { values: STATUSES },
      cellRenderer: (p: ICellRendererParams<CRMContact, ContactStatus>) => {
        const v = p.value as ContactStatus | undefined;
        if (!v) return null;
        return <span className={`pill pill--${v}`}><span className="pill__dot" />{v}</span>;
      },
    },
    { field: 'source', headerName: 'Source', width: 110, editable: canEdit, valueSetter: saveCell },
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

  async function confirmRowEnrich() {
    if (!enrichConfirm) return;
    const { row } = enrichConfirm;
    if (!row.email) {
      setMessage('Need an email on the row to enrich. Inline-edit the Email cell first.');
      setEnrichConfirm(null);
      return;
    }
    await doEnrich(row.email, selectedListId, row.id);
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
    function close() { setContextMenu(null); setMoveTargetMenu(null); }
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
            {listIsGlobal && <Globe size={22} style={{ verticalAlign: 'text-bottom', marginRight: 8, color: 'var(--stc-red)' }} />}
            {!listIsGlobal && <Users size={22} style={{ verticalAlign: 'text-bottom', marginRight: 8, color: 'var(--stc-marketing)' }} />}
            {selectedList?.name ?? 'CRM'}<span style={{ color: 'var(--stc-red)' }}>.</span>
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
      <div className="stats-grid">
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
            <button onClick={(e) => setMoveTargetMenu({ x: e.clientX, y: e.clientY + 20, rowIds: gridRef.current?.api.getSelectedRows().map((r) => r.id) ?? [] })} className="btn btn--sm"><MoreHorizontal size={12} /> Move…</button>
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

      <div className="mono" style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 6, marginTop: 4 }}>
        TIP · click any row to open details · right-click any cell for edit, enrich, move, delete
      </div>

      {message && <div className="alert alert--info" style={{ marginBottom: 12 }}>{message}</div>}

      <div className="ag-theme-quartz-dark" style={{ height: 'calc(100vh - 420px)', minHeight: 400, borderRadius: 'var(--r-3)', border: '1px solid var(--border)', overflow: 'hidden' }}>
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
          lists={lists.filter((l) => l.id !== selectedListId)}
          onPick={async (listId) => {
            const { error } = await supabase.from('crm_contacts').update({ list_id: listId }).in('id', moveTargetMenu.rowIds);
            if (error) setMessage(error.message); else {
              setRows((r) => r.filter((c) => !moveTargetMenu.rowIds.includes(c.id)));
              setMessage(`Moved ${moveTargetMenu.rowIds.length} → ${lists.find((l) => l.id === listId)?.name}`);
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

      {drawerRow && (
        <ContactDrawer
          contact={drawerRow}
          profile={profile}
          canEdit={canEdit}
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
  return (
    <div className="ctx-menu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      <div className="ctx-menu__head">{row.company_name}{field && <span className="mono" style={{ marginLeft: 6, color: 'var(--fg-4)' }}>· {field}</span>}</div>
      <button onClick={onView}><Edit2 size={12} /> Open details</button>
      <button onClick={onEdit} disabled={!canEdit}><Edit2 size={12} /> Edit this cell</button>
      <button onClick={onEnrich}><Mail size={12} /> Enrich from Lusha…</button>
      <button onClick={onMove}><MoreHorizontal size={12} /> Move to list…</button>
      <hr />
      <button onClick={onDelete} disabled={!canEdit} style={{ color: 'var(--stc-red-300)' }}><Trash2 size={12} /> Delete</button>
    </div>
  );
}

function MoveMenu({ x, y, lists, onPick, onClose }: { x: number; y: number; lists: CrmList[]; onPick: (id: string) => void; onClose: () => void }) {
  return (
    <div className="ctx-menu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      <div className="ctx-menu__head">Move to list</div>
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

function EnrichConfirmModal({ row, balance, onConfirm, onCancel, busy }: { row: CRMContact; balance: number | null; onConfirm: () => void; onCancel: () => void; busy: boolean }) {
  const remaining = balance == null ? '?' : balance.toString();
  return (
    <Modal onClose={onCancel} title="Enrich from Lusha">
      <p style={{ color: 'var(--fg-2)', fontSize: 13.5, margin: 0 }}>
        Looking up <strong style={{ color: 'var(--fg-1)' }}>{row.email || '(no email — set the Email cell first)'}</strong> via the Lusha API.
      </p>
      <div className="card" style={{ marginTop: 12, padding: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--fg-3)' }}>COST</span>
          <span className="tnum" style={{ fontWeight: 600 }}>1 credit</span>
        </div>
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--fg-3)' }}>REMAINING AFTER</span>
          <span className="tnum">{balance == null ? '?' : Math.max(0, balance - 1)} (of {remaining})</span>
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        <button type="button" onClick={onCancel} className="btn btn--ghost">Cancel</button>
        <button type="button" onClick={onConfirm} className="btn btn--primary" disabled={busy || !row.email}>
          {busy ? <Loader size={14} className="spin" /> : <Send size={14} />} Spend 1 credit
        </button>
      </div>
    </Modal>
  );
}

function ContactDrawer({ contact, profile, canEdit, onClose, onChange, onDelete }: {
  contact: CRMContact; profile: Profile; canEdit: boolean;
  onClose: () => void; onChange: (c: CRMContact) => void; onDelete: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [noteText, setNoteText] = useState('');
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<CRMContact>(contact);
  useEffect(() => { setEdit(contact); }, [contact]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase.from('contact_notes').select('*').eq('contact_id', contact.id).order('created_at', { ascending: false });
      setNotes((data ?? []) as ContactNote[]);
      setLoading(false);
    })();
  }, [supabase, contact.id]);

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
    const { data, error } = await supabase.from('crm_contacts').update({ [field]: value }).eq('id', contact.id).select('*').single();
    if (error) { alert(error.message); return; }
    onChange(data as CRMContact);
  }

  return (
    <div className="drawer-bg" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer__head">
          <div>
            <div className="page-head__eyebrow">Contact</div>
            <h2 style={{ margin: '4px 0 0' }}><Building size={18} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />{edit.company_name}</h2>
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
          <div className="split-2" style={{ gap: 10, marginTop: 10 }}>
            <DrawerField label="Location" value={edit.location} onSave={(v) => saveField('location', v)} canEdit={canEdit} />
            <DrawerField label="Fleet size" value={edit.fleet_size?.toString() ?? ''} onSave={(v) => saveField('fleet_size', v ? Number(v) : null)} canEdit={canEdit} />
          </div>
          <div className="split-2" style={{ gap: 10, marginTop: 10 }}>
            <div className="field">
              <div className="field__label">Status</div>
              <select className="input" disabled={!canEdit} value={edit.status} onChange={(e) => saveField('status', e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <DrawerField label="Assigned to" value={edit.assigned_to} onSave={(v) => saveField('assigned_to', v)} canEdit={canEdit} />
          </div>

          <div className="hr" />

          <div className="page-head__eyebrow" style={{ marginBottom: 8 }}>Notes &amp; history</div>
          {canEdit && (
            <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <textarea className="input" placeholder="Add a note (call summary, next step, anything)…"
                value={noteText} onChange={(e) => setNoteText(e.target.value)}
                style={{ minHeight: 70, flex: 1, padding: 10 }} />
              <button onClick={addNote} className="btn btn--primary" disabled={!noteText.trim()}>
                <Send size={14} /> Add note
              </button>
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            {loading ? (
              <div className="row-item__sub">Loading…</div>
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

        <div className="drawer__foot">
          {canEdit && <button onClick={onDelete} className="btn btn--sm" style={{ color: 'var(--stc-red-300)' }}><Trash2 size={12} /> Delete contact</button>}
          <div className="toolbar__spacer" />
          <button onClick={onClose} className="btn">Close</button>
        </div>
      </div>
    </div>
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
