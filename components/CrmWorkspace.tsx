'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueSetterParams, RowClickedEvent, CellContextMenuEvent } from 'ag-grid-community';
import Papa from 'papaparse';
import {
  Plus, Upload, Download, Loader, Trash2, MoreHorizontal, X, Mail, Edit2,
  Globe, Users, ChevronDown, UserPlus, Share2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { CRMContact, ContactStatus, CrmList, Profile } from '@/lib/types';

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
  const [enriching, setEnriching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showNewList, setShowNewList] = useState(false);
  const [showShare, setShowShare] = useState<CrmList | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; row: CRMContact } | null>(null);
  const [moveTargetMenu, setMoveTargetMenu] = useState<{ x: number; y: number; rowIds: string[] } | null>(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const [listPickerFor, setListPickerFor] = useState<{ purpose: 'enrich'; email: string } | null>(null);

  const selectedList = lists.find((l) => l.id === selectedListId);
  const isOwner = selectedList ? selectedList.owner_id === profile.id : false;
  const canEdit = selectedList?.is_global
    ? true
    : isOwner ||
      members.some((m) => m.list_id === selectedListId && m.user_id === profile.id && m.can_edit) ||
      profile.role === 'admin';

  // Lists visible to user (already filtered by RLS)
  const myLists = lists.filter((l) => !l.is_global);
  const globalList = lists.find((l) => l.is_global);

  // Switch list
  function selectList(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('list', id);
    router.push(`/dashboard/crm?${params.toString()}`);
  }

  // Realtime subscription for the current list
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

  // ---- cell save ----
  const saveCell = useCallback((params: ValueSetterParams<CRMContact>): boolean => {
    const field = params.colDef.field as keyof CRMContact;
    const newValue = params.newValue;
    if (params.data[field] === newValue) return false;
    (params.data as any)[field] = newValue;
    supabase.from('crm_contacts').update({ [field]: newValue }).eq('id', params.data.id)
      .then(({ error }) => { if (error) setMessage(`Save failed: ${error.message}`); });
    return true;
  }, [supabase]);

  // ---- columns ----
  const columnDefs: ColDef<CRMContact>[] = useMemo(() => [
    { headerName: '', field: 'id', width: 42, pinned: 'left',
      checkboxSelection: canEdit, headerCheckboxSelection: canEdit, headerCheckboxSelectionFilteredOnly: true,
      sortable: false, filter: false, editable: false, suppressMenu: true,
    },
    { field: 'company_name',  headerName: 'Company',  flex: 1.2, minWidth: 180, editable: canEdit, valueSetter: saveCell },
    { field: 'contact_name',  headerName: 'Contact',  flex: 1,   minWidth: 140, editable: canEdit, valueSetter: saveCell },
    { field: 'email',         headerName: 'Email',    flex: 1.2, minWidth: 200, editable: canEdit, valueSetter: saveCell },
    { field: 'phone',         headerName: 'Phone',    width: 140, editable: canEdit, valueSetter: saveCell },
    { field: 'location',      headerName: 'Location', width: 140, editable: canEdit, valueSetter: saveCell },
    { field: 'fleet_size',    headerName: 'Fleet',    width: 90,  editable: canEdit, valueSetter: saveCell,
      valueParser: (p) => p.newValue === '' ? null : Number(p.newValue) },
    { field: 'status', headerName: 'Status', width: 140, editable: canEdit, valueSetter: saveCell,
      cellEditor: 'agSelectCellEditor', cellEditorParams: { values: STATUSES },
      cellRenderer: (p: ICellRendererParams<CRMContact, ContactStatus>) => {
        const v = p.value as ContactStatus | undefined;
        if (!v) return null;
        return <span className={`pill pill--${v}`}><span className="pill__dot" />{v}</span>;
      },
    },
    { field: 'source',        headerName: 'Source',   width: 110, editable: canEdit, valueSetter: saveCell },
    { field: 'assigned_to',   headerName: 'Assigned', width: 130, editable: canEdit, valueSetter: saveCell },
    { field: 'last_contact',  headerName: 'Last contact', width: 120, editable: canEdit, valueSetter: saveCell },
    { field: 'notes',         headerName: 'Notes',    flex: 1.5, minWidth: 200, editable: canEdit, valueSetter: saveCell },
  ], [canEdit, saveCell]);

  const defaultColDef: ColDef = useMemo(() => ({
    resizable: true, sortable: true, filter: true, floatingFilter: true,
  }), []);

  // ---- enrichment ----
  async function handleEnrich() {
    if (!enrichEmail.trim()) return;
    const email = enrichEmail.trim();
    // If user has >1 list, show picker
    if (lists.length > 1) {
      setListPickerFor({ purpose: 'enrich', email });
      return;
    }
    return doEnrich(email, selectedListId);
  }
  async function doEnrich(email: string, targetListId: string) {
    setEnriching(true); setMessage(null); setListPickerFor(null);
    try {
      const res = await fetch('/api/lusha/enrich', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, list_id: targetListId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Enrichment failed');
      setEnrichEmail('');
      setMessage(`Enriched ${email} → ${lists.find((l) => l.id === targetListId)?.name ?? 'list'}`);
      if (targetListId === selectedListId) setRows((r) => [json.contact, ...r]);
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

  async function bulkMove(targetListId: string) {
    const sel = gridRef.current?.api.getSelectedRows() ?? [];
    if (!sel.length) return;
    const ids = sel.map((r) => r.id);
    const { error } = await supabase.from('crm_contacts').update({ list_id: targetListId }).in('id', ids);
    if (error) { setMessage(error.message); return; }
    setRows((r) => r.filter((c) => !ids.includes(c.id)));
    setMessage(`Moved ${ids.length} contacts → ${lists.find((l) => l.id === targetListId)?.name}`);
  }

  async function bulkEnrich() {
    const sel = gridRef.current?.api.getSelectedRows() ?? [];
    const withEmail = sel.filter((r) => r.email);
    if (!withEmail.length) { setMessage('No selected rows have an email'); return; }
    if (!confirm(`Enrich ${withEmail.length} contacts via Lusha (costs ${withEmail.length} credits)?`)) return;
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
  }

  // ---- list create ----
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

  // ---- context menu ----
  function onCellContextMenu(e: CellContextMenuEvent<CRMContact>) {
    if (!e.event) return;
    (e.event as MouseEvent).preventDefault();
    const me = e.event as MouseEvent;
    setContextMenu({ x: me.clientX, y: me.clientY, row: e.data! });
  }

  useEffect(() => {
    function close() { setContextMenu(null); setMoveTargetMenu(null); }
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', (e) => {
      // Only close if click is outside the menu — handled in menu's stopPropagation
    });
    return () => window.removeEventListener('click', close);
  }, []);

  // ---- selection counter ----
  function onSelectionChanged() {
    setSelectedCount(gridRef.current?.api.getSelectedRows().length ?? 0);
  }

  // ---- counts ----
  const counts = useMemo(() => {
    const c = { all: rows.length, lead: 0, contacted: 0, quoted: 0, won: 0, lost: 0 } as Record<string, number>;
    rows.forEach((r) => { c[r.status] = (c[r.status] ?? 0) + 1; });
    return c;
  }, [rows]);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-head__eyebrow">Sales · CRM pipeline</div>
          <h1 className="page-head__title">{selectedList?.name ?? 'CRM'}<span style={{ color: 'var(--stc-red)' }}>.</span></h1>
          <div className="page-head__sub">
            {selectedList?.is_global ? 'Shared by the whole team · realtime' : `Owned by ${profiles.find((p) => p.id === selectedList?.owner_id)?.full_name ?? 'you'}`}
            {' · '}{rows.length} contacts
          </div>
        </div>
      </div>

      {/* List bar */}
      <div className="list-bar">
        {globalList && (
          <button onClick={() => selectList(globalList.id)} className={`list-bar__tab${selectedListId === globalList.id ? ' is-active' : ''}`}>
            <Globe size={14} /> Global CRM
          </button>
        )}
        {myLists.map((l) => {
          const owned = l.owner_id === profile.id;
          return (
            <button key={l.id} onClick={() => selectList(l.id)} className={`list-bar__tab${selectedListId === l.id ? ' is-active' : ''}`}>
              {owned ? <Users size={14} /> : <Share2 size={14} />}
              {l.name}
              {!owned && <span className="mono" style={{ fontSize: 10, color: 'var(--fg-3)', marginLeft: 4 }}>SHARED</span>}
            </button>
          );
        })}
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
            <input type="email" placeholder="email@company.com"
              value={enrichEmail} onChange={(e) => setEnrichEmail(e.target.value)} className="input" style={{ width: 240 }} />
            <button onClick={handleEnrich} disabled={enriching || !enrichEmail} className="btn btn--primary">
              {enriching ? <Loader size={14} className="spin" /> : <Plus size={14} />} Enrich
            </button>
          </div>
        )}
        <div className="toolbar__spacer" />
        {selectedCount > 0 && (
          <div className="row" style={{ background: 'var(--stc-danger-bg)', padding: '4px 10px', borderRadius: 'var(--r-2)', border: '1px solid rgba(207,36,23,0.3)' }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--stc-red-300)' }}>{selectedCount} SELECTED</span>
            <button onClick={bulkEnrich} className="btn btn--sm"><Mail size={12} /> Enrich</button>
            <button onClick={(e) => setMoveTargetMenu({ x: e.clientX, y: e.clientY + 20, rowIds: gridRef.current?.api.getSelectedRows().map(r => r.id) ?? [] })} className="btn btn--sm"><MoreHorizontal size={12} /> Move…</button>
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

      {message && <div className="alert alert--info" style={{ marginBottom: 12 }}>{message}</div>}

      <div className="ag-theme-quartz-dark" style={{ height: 'calc(100vh - 460px)', minHeight: 400, borderRadius: 'var(--r-3)', border: '1px solid var(--border)', overflow: 'hidden' }}>
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
          preventDefaultOnContextMenu
        />
      </div>

      {/* New list modal */}
      {showNewList && <NewListModal onCreate={createList} onClose={() => setShowNewList(false)} />}
      {/* Share modal */}
      {showShare && <ShareModal list={showShare} profiles={profiles.filter((p) => p.id !== profile.id)} members={members.filter((m) => m.list_id === showShare.id)} onShare={shareList} onUnshare={unshareList} onClose={() => setShowShare(null)} />}
      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y}
          row={contextMenu.row}
          canEdit={canEdit}
          onEdit={() => { gridRef.current?.api.startEditingCell({ rowIndex: gridRef.current.api.getRowNode(contextMenu.row.id)!.rowIndex!, colKey: 'company_name' }); setContextMenu(null); }}
          onEnrich={() => { if (contextMenu.row.email) doEnrich(contextMenu.row.email, selectedListId); setContextMenu(null); }}
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
      {/* Move-to-list popup */}
      {moveTargetMenu && (
        <MoveMenu
          x={moveTargetMenu.x} y={moveTargetMenu.y}
          lists={lists.filter((l) => l.id !== selectedListId)}
          onPick={async (listId) => {
            const { error } = await supabase.from('crm_contacts').update({ list_id: listId }).in('id', moveTargetMenu.rowIds);
            if (error) setMessage(error.message); else {
              setRows((r) => r.filter((c) => !moveTargetMenu.rowIds.includes(c.id)));
              setMessage(`Moved ${moveTargetMenu.rowIds.length} → ${lists.find((l) => l.id === listId)?.name}`);
            }
            setMoveTargetMenu(null);
          }}
          onClose={() => setMoveTargetMenu(null)}
        />
      )}
      {/* List picker for enrich */}
      {listPickerFor && (
        <ListPickerModal
          lists={lists}
          onPick={(id) => doEnrich(listPickerFor.email, id)}
          onClose={() => setListPickerFor(null)}
          title={`Add ${listPickerFor.email} to which list?`}
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
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. M62 corridor, Hyde walk-ins, Anchor accounts" />
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
  onShare: (listId: string, userId: string, canEdit: boolean) => void;
  onUnshare: (listId: string, userId: string) => void;
  onClose: () => void;
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
              {m ? (
                <button onClick={() => onUnshare(list.id, p.id)} className="btn btn--sm">Remove</button>
              ) : (
                <button onClick={() => onShare(list.id, p.id, true)} className="btn btn--sm btn--primary"><UserPlus size={12} /> Share</button>
              )}
            </div>
          );
        })}
        {profiles.length === 0 && <div className="row-item__sub" style={{ padding: 20, textAlign: 'center' }}>No other users to share with.</div>}
      </div>
    </Modal>
  );
}

function ContextMenu({ x, y, row, canEdit, onEdit, onEnrich, onDelete, onMove }: any) {
  return (
    <div className="ctx-menu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      <div className="ctx-menu__head">{row.company_name}</div>
      <button onClick={onEdit} disabled={!canEdit}><Edit2 size={12} /> Edit field</button>
      <button onClick={onEnrich} disabled={!row.email}><Mail size={12} /> Enrich via Lusha</button>
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
