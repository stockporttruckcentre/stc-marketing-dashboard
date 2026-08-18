'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { publishSelection } from '@/lib/command/selection';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueSetterParams, CellContextMenuEvent } from 'ag-grid-community';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Truck, X, Search, Edit2, Package, Loader, Briefcase, Wrench, ShoppingCart, Archive, Eye, Copy, MoreHorizontal, MapPin, Move, Paintbrush, PoundSterling, Send, ArrowRight, AlertCircle, Upload } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useDismissGuard } from '@/components/kit/useDismissGuard';
import { ImportDialog } from '@/components/crm/ImportDialog';
import { STOCK_TRAILERS } from '@/lib/import/dictionary';
import { commitStockImport as writeStock, prepareStock } from '@/lib/import/stock';
import type { StockTrailer, StockStatus, Profile } from '@/lib/types';

type StatusTab = 'all' | StockStatus;

const STATUS_LABEL: Record<StockStatus, string> = {
  new_build: 'New Builds', in_stock: 'Available', sales_order: 'Sales Orders',
  sold: 'Sold', rental: 'Rental', scrap: 'Scrap',
};
const STATUS_ORDER: StockStatus[] = ['in_stock','new_build','sales_order','rental','sold','scrap'];

const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
const fmtMoney = (v: number | null | undefined) => (v == null ? '' : GBP.format(Number(v)));
const fmtDate = (v: string | null | undefined) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '';

export function StockList({ initialRows, role }: { initialRows: StockTrailer[]; role: Profile['role'] }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<StockTrailer[]>(initialRows);
  const [showImport, setShowImport] = useState(false);
  const [tab, setTab] = useState<StatusTab>('in_stock');
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ row: StockTrailer; focusField?: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; row: StockTrailer; field?: string } | null>(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const [bulkMove, setBulkMove] = useState(false);
  const [bulkLocation, setBulkLocation] = useState(false);
  const [sendConfirm, setSendConfirm] = useState<{ row: StockTrailer; myEntry: any; others: any[] } | null>(null);
  const [soldWarning, setSoldWarning] = useState<{ row: StockTrailer; targetStatus: StockStatus; entries: any[] } | null>(null);
  const router = useRouter();
  const gridRef = useRef<AgGridReact<StockTrailer>>(null);

  // Close context menu on outside click / escape. We must check the native event target
  // because React's synthetic stopPropagation doesn't reach document listeners.
  useEffect(() => {
    function close(e: MouseEvent) {
      if ((e.target as HTMLElement)?.closest?.('.ctx-menu')) return; // click inside menu
      setContextMenu(null);
    }
    function key(e: KeyboardEvent) { if (e.key === 'Escape') setContextMenu(null); }
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key); };
  }, []);

  const canEdit = role === 'admin' || role === 'sales' || role === 'marketer';

  const counts = useMemo(() => {
    const c: Record<StatusTab, number> = { all: rows.length, new_build: 0, in_stock: 0, sales_order: 0, sold: 0, rental: 0, scrap: 0 };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  // Categories available within the current status (for in_stock view especially)
  const categoriesInTab = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (tab !== 'all' && r.status !== tab) continue;
      if (r.category) set.add(r.category);
    }
    return Array.from(set).sort();
  }, [rows, tab]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(r => {
      if (tab !== 'all' && r.status !== tab) return false;
      if (category && (r.category || '') !== category) return false;
      if (!q) return true;
      return [r.stc_no, r.chassis_number, r.make, r.model, r.description, r.location, r.customer, r.sales_rep, r.supplier, r.category]
        .filter(Boolean).join(' ').toLowerCase().includes(q);
    });
  }, [rows, tab, category, query]);

  const isSoldOrOrder = tab === 'sold' || tab === 'sales_order';

  // Aggregates
  const totals = useMemo(() => {
    const totalNbv = filtered.reduce((sum, r) => sum + (Number(r.nbv) || 0) + (Number(r.refurb_costs) || 0) + (Number(r.refurb_costs_at_sale) || 0), 0);
    const totalSale = filtered.reduce((sum, r) => sum + (Number(r.sales_price) || 0), 0);
    const totalProfit = filtered.reduce((sum, r) => sum + (Number(r.profit) || 0), 0);
    return { totalNbv, totalSale, totalProfit, count: filtered.length };
  }, [filtered]);

  const saveCell = useCallback((params: ValueSetterParams<StockTrailer>): boolean => {
    const field = params.colDef.field as keyof StockTrailer;
    if ((params.data as any)[field] === params.newValue) return false;
    (params.data as any)[field] = params.newValue;
    supabase.from('stock_trailers').update({ [field]: params.newValue }).eq('id', params.data.id)
      .then(({ error }) => { if (error) setMessage(error.message); });
    return true;
  }, [supabase]);

  const columnDefs = useMemo<ColDef<StockTrailer>[]>(() => {
    const base: ColDef<StockTrailer>[] = [
      { headerCheckboxSelection: true, checkboxSelection: true, width: 42, pinned: 'left', sortable: false, filter: false, editable: false, resizable: false },
      { field: 'stc_no', headerName: 'STC No', width: 100, pinned: 'left', editable: canEdit, valueSetter: saveCell },
      { field: 'category', headerName: 'Category', width: 110, editable: canEdit, valueSetter: saveCell,
        cellRenderer: (p: ICellRendererParams<StockTrailer, string>) => p.value
          ? <span className="pill" style={{ fontSize: 10.5 }}>{p.value}</span> : null },
      { field: 'status', headerName: 'Status', width: 110, editable: canEdit, valueSetter: saveCell,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: STATUS_ORDER },
        cellRenderer: (p: ICellRendererParams<StockTrailer, StockStatus>) => p.value
          ? <span className={`pill pill--${p.value}`}><span className="pill__dot" />{STATUS_LABEL[p.value]}</span> : null },
      { field: 'year', headerName: 'Year', width: 75, editable: canEdit, valueSetter: saveCell,
        valueParser: p => p.newValue === '' ? null : Number(p.newValue) },
      { field: 'make', headerName: 'Make', width: 110, editable: canEdit, valueSetter: saveCell },
      { field: 'model', headerName: 'Model', flex: 1, minWidth: 130, editable: canEdit, valueSetter: saveCell },
      { field: 'description', headerName: 'Description', flex: 1.4, minWidth: 180, editable: canEdit, valueSetter: saveCell },
      { field: 'colour', headerName: 'Colour', width: 100, editable: canEdit, valueSetter: saveCell },
      { field: 'location', headerName: 'Location', width: 120, editable: canEdit, valueSetter: saveCell },
      { field: 'sales_rep', headerName: 'Rep', width: 80, editable: canEdit, valueSetter: saveCell },
      { field: 'mot_date', headerName: 'MOT', width: 100, valueFormatter: p => fmtDate(p.value), editable: canEdit, valueSetter: saveCell },
    ];

    if (isSoldOrOrder) {
      base.push(
        { field: 'customer', headerName: 'Customer', flex: 1, minWidth: 150, editable: canEdit, valueSetter: saveCell },
        { field: 'order_date', headerName: 'Order date', width: 110, valueFormatter: p => fmtDate(p.value), editable: canEdit, valueSetter: saveCell },
        { field: 'sales_price', headerName: 'Sale £', width: 110, cellStyle: { textAlign: 'right' },
          valueFormatter: p => fmtMoney(p.value), valueParser: p => p.newValue === '' ? null : Number(p.newValue), editable: canEdit, valueSetter: saveCell },
        { field: 'profit', headerName: 'Profit £', width: 100, cellStyle: { textAlign: 'right' },
          valueFormatter: p => fmtMoney(p.value), valueParser: p => p.newValue === '' ? null : Number(p.newValue), editable: canEdit, valueSetter: saveCell },
        { field: 'profit_pct', headerName: 'Profit %', width: 90, cellStyle: { textAlign: 'right' },
          valueFormatter: p => p.value != null ? `${(Number(p.value) * 100).toFixed(1)}%` : '' },
      );
    } else {
      base.push(
        { field: 'nbv', headerName: 'NBV', width: 100, cellStyle: { textAlign: 'right' },
          valueFormatter: p => fmtMoney(p.value), valueParser: p => p.newValue === '' ? null : Number(p.newValue), editable: canEdit, valueSetter: saveCell },
        { field: 'refurb_costs', headerName: 'Refurb £', width: 100, cellStyle: { textAlign: 'right' },
          valueFormatter: p => fmtMoney(p.value), valueParser: p => p.newValue === '' ? null : Number(p.newValue), editable: canEdit, valueSetter: saveCell },
        { headerName: 'Total NBV', width: 110, cellStyle: { textAlign: 'right', fontWeight: 600 },
          valueGetter: p => (Number(p.data?.nbv) || 0) + (Number(p.data?.refurb_costs) || 0) + (Number(p.data?.refurb_costs_at_sale) || 0),
          valueFormatter: p => p.value ? fmtMoney(p.value) : '' },
      );
    }

    base.push({
      headerName: '', width: 56, pinned: 'right', sortable: false, filter: false, editable: false,
      cellRenderer: (p: ICellRendererParams<StockTrailer>) => (
        <div className="row" style={{ gap: 4 }}>
          <button onClick={() => setEditing({ row: p.data! })} className="btn btn--icon btn--sm" title="Full view"><Edit2 size={12} /></button>
          {canEdit && (
            <button onClick={async () => {
              if (!confirm(`Delete trailer ${p.data!.stc_no || p.data!.chassis_number || p.data!.id}?`)) return;
              const { error } = await supabase.from('stock_trailers').delete().eq('id', p.data!.id);
              if (error) { setMessage(error.message); return; }
              setRows(r => r.filter(x => x.id !== p.data!.id));
            }} className="btn btn--icon btn--sm" style={{ color: 'var(--stc-red-300)' }} title="Delete"><Trash2 size={12} /></button>
          )}
        </div>
      ),
    });
    return base;
  }, [saveCell, supabase, canEdit, isSoldOrOrder]);

  const defaultColDef = useMemo<ColDef>(() => ({ resizable: true, sortable: true, filter: true }), []);

  async function bulkChangeStatus(newStatus: StockStatus) {
    const sel = gridRef.current?.api.getSelectedRows() ?? [];
    if (!sel.length) return;
    const ids = sel.map(r => r.id);
    const { error } = await supabase.from('stock_trailers').update({ status: newStatus }).in('id', ids);
    if (error) { setMessage(error.message); return; }
    setRows(r => r.map(x => ids.includes(x.id) ? { ...x, status: newStatus } : x));
    setMessage(`Moved ${ids.length} trailer${ids.length === 1 ? '' : 's'} to ${STATUS_LABEL[newStatus]}`);
    setBulkMove(false);
    gridRef.current?.api.deselectAll();
  }

  async function bulkChangeLocation(location: string) {
    const sel = gridRef.current?.api.getSelectedRows() ?? [];
    if (!sel.length) return;
    const ids = sel.map(r => r.id);
    const { error } = await supabase.from('stock_trailers').update({ location: location || null }).in('id', ids);
    if (error) { setMessage(error.message); return; }
    setRows(r => r.map(x => ids.includes(x.id) ? { ...x, location: location || null } : x));
    setMessage(`Set location to "${location || '(blank)'}" on ${ids.length} trailer${ids.length === 1 ? '' : 's'}`);
    setBulkLocation(false);
    gridRef.current?.api.deselectAll();
  }

  /**
   * Write the reviewed stock rows.
   *
   * Everything intelligent already happened in the dialog: mapping,
   * coercion, duplicate checking and the review. By the time rows arrive
   * here they are the right shape for the columns, so this only inserts
   * and reloads.
   */
  /* The import is one operation, in `lib/import/stock.ts`, which the
     command bar reaches too. It used to be an insert straight from here,
     which put the allowlist and the permission in code somebody can edit
     in a console and had no answer for a failure halfway down a
     supplier's file. */
  async function commitStockImport(records: Record<string, any>[]) {
    const { records: ready, refused } = prepareStock(records);
    if (!ready.length) {
      return { inserted: 0, error: 'none of those rows had a stock number to identify them by' };
    }

    const done = await writeStock(supabase, ready);
    if (!done.ok) return { inserted: 0, error: done.why };

    const { data } = await supabase.from('stock_trailers').select('*')
      .order('updated_at', { ascending: false });
    setRows((data ?? []) as StockTrailer[]);
    setMessage(refused
      ? `Imported ${done.inserted} trailers. ${refused} had no stock number and were left out.`
      : `Imported ${done.inserted} trailers`);
    return { inserted: done.inserted };
  }

  async function bulkDelete() {
    const sel = gridRef.current?.api.getSelectedRows() ?? [];
    if (!sel.length) return;
    if (!confirm(`Delete ${sel.length} trailer${sel.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    const ids = sel.map(r => r.id);
    const { error } = await supabase.from('stock_trailers').delete().in('id', ids);
    if (error) { setMessage(error.message); return; }
    setRows(r => r.filter(x => !ids.includes(x.id)));
    setMessage(`Deleted ${ids.length} trailer${ids.length === 1 ? '' : 's'}`);
    gridRef.current?.api.deselectAll();
  }

  /* ONE OPERATION, TWO WAYS IN.
     This built the copy here, out of the row the grid happened to be
     holding, and inserted it. The command bar can duplicate a unit too,
     and two implementations of "duplicate" is how they end up copying
     different columns: this one copied whatever the grid had loaded.
     `command_duplicate_stock` is the operation now, and this is one
     caller of it. Migration 038. */
  async function duplicateRow(row: StockTrailer) {
    const { data, error } = await supabase.rpc('command_duplicate_stock', { p_ids: [row.id] });
    if (error) { setMessage(error.message); return; }
    const made = (data as { id?: string } | null)?.id;
    if (made) {
      const { data: fresh } = await supabase.from('stock_trailers').select('*').eq('id', made).single();
      if (fresh) setRows(r => [fresh as StockTrailer, ...r]);
    }
    setMessage(`Duplicated ${row.stc_no || row.chassis_number || 'row'}`);
  }

  // Check whether this trailer is already on the caller's tracker (or somebody else's), then send.
  async function sendToTracker(row: StockTrailer, force = false) {
    if (!force) {
      const checkRes = await fetch('/api/tracker/check-link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock_trailer_id: row.id }),
      });
      const j = await checkRes.json();
      if (j.myEntry || (j.othersEntries && j.othersEntries.length > 0)) {
        setSendConfirm({ row, myEntry: j.myEntry, others: j.othersEntries || [] });
        return;
      }
    }
    const sendRes = await fetch('/api/tracker/send-from-stock', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock_trailer_id: row.id }),
    });
    const j = await sendRes.json();
    if (!sendRes.ok) { setMessage(j.error || 'Send failed'); return; }
    setMessage(`Added ${row.stc_no || row.chassis_number || 'trailer'} to your Sales tracker`);
    setSendConfirm(null);
  }

  // Intercept status change FROM 'sold'. Warn the user about the rep and the sale being undone.
  async function changeStatusWithGuard(row: StockTrailer, newStatus: StockStatus) {
    if (row.status === 'sold' && newStatus !== 'sold') {
      const r = await fetch('/api/stock/sold-warning', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock_trailer_id: row.id }),
      });
      const j = await r.json();
      if (j.soldEntries && j.soldEntries.length > 0) {
        setSoldWarning({ row, targetStatus: newStatus, entries: j.soldEntries });
        return;
      }
    }
    // No warning needed - apply directly
    await applyStockStatus(row, newStatus);
  }

  async function applyStockStatus(row: StockTrailer, newStatus: StockStatus) {
    const { error } = await supabase.from('stock_trailers').update({ status: newStatus }).eq('id', row.id);
    if (error) { setMessage(error.message); return; }
    setRows(r => r.map(x => x.id === row.id ? { ...x, status: newStatus } : x));
    setMessage(`Status updated to ${STATUS_LABEL[newStatus]}`);
    setSoldWarning(null);
  }

  function onCellContextMenu(e: CellContextMenuEvent<StockTrailer>) {
    if (!e.data) return;
    const me = e.event as MouseEvent;
    me.preventDefault();
    setContextMenu({ x: me.clientX, y: me.clientY, row: e.data, field: e.colDef.field as string | undefined });
  }

  async function addRow() {
    const { data, error } = await supabase.from('stock_trailers').insert({
      status: tab === 'all' ? 'in_stock' : tab,
      category: category ?? null,
    }).select('*').single();
    if (error) { setMessage(error.message); return; }
    setRows(r => [data as StockTrailer, ...r]);
    setEditing({ row: data as StockTrailer });
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-head__eyebrow">Sales · Trailer stock</div>
          <h1 className="page-head__title"><Truck size={26} style={{ color: 'var(--stc-red)' }} /><span>Stock<span style={{ color: 'var(--stc-red)' }}>.</span></span></h1>
          <div className="page-head__sub">
            {totals.count} units in view · Total NBV <strong style={{ color: 'var(--fg-1)' }}>{fmtMoney(totals.totalNbv)}</strong>
            {isSoldOrOrder && (
              <>
                {' '}· Sale value <strong style={{ color: 'var(--fg-1)' }}>{fmtMoney(totals.totalSale)}</strong>
                {' '}· Profit <strong style={{ color: 'var(--fg-1)' }}>{fmtMoney(totals.totalProfit)}</strong>
              </>
            )}
          </div>
        </div>
        {canEdit && (
          <button onClick={() => setShowImport(true)} className="btn">
            <Upload size={14} /> Import
          </button>
        )}
        {canEdit && <button onClick={addRow} className="btn btn--primary"><Plus size={14} /> Add trailer</button>}
      </div>

      {/* Status tabs */}
      {showImport && (
        <ImportDialog
          dict={STOCK_TRAILERS}
          listName="the stock list"
          existing={rows.map((r) => ({
            id: r.id,
            stc_no: r.stc_no,
            chassis_number: (r as any).chassis_number ?? null,
          }))}
          onCommit={commitStockImport}
          onClose={() => setShowImport(false)}
        />
      )}

      <div className="toolbar" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <button onClick={() => { setTab('all'); setCategory(null); }} className={`news-chip ${tab === 'all' ? 'is-active' : ''}`}>
          All <span className="news-chip__count">{counts.all}</span>
        </button>
        {STATUS_ORDER.map(s => (
          <button key={s} onClick={() => { setTab(s); setCategory(null); }} className={`news-chip ${tab === s ? 'is-active' : ''}`}>
            {s === 'in_stock' && <Package size={11} />}
            {s === 'new_build' && <Wrench size={11} />}
            {s === 'sales_order' && <ShoppingCart size={11} />}
            {s === 'sold' && <Briefcase size={11} />}
            {s === 'scrap' && <Archive size={11} />}
            {STATUS_LABEL[s]} <span className="news-chip__count">{counts[s]}</span>
          </button>
        ))}
        <div className="news-search" style={{ marginLeft: 'auto' }}>
          <Search size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="STC no, chassis, make, model, customer, location..." />
        </div>
      </div>

      {/* Category sub-filter (especially useful on the In Stock tab where the original sheets group by category) */}
      {categoriesInTab.length > 1 && (
        <div className="toolbar" style={{ flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--fg-3)', fontWeight: 600 }}>CATEGORY:</span>
          <button onClick={() => setCategory(null)} className={`news-chip ${category === null ? 'is-active' : ''}`}>All</button>
          {categoriesInTab.map(c => (
            <button key={c} onClick={() => setCategory(c === category ? null : c)}
              className={`news-chip ${category === c ? 'is-active' : ''}`}>{c}</button>
          ))}
        </div>
      )}

      {selectedCount > 0 && canEdit && (
        <div className="card" style={{ padding: 10, marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(207,36,23,0.06)', borderColor: 'rgba(207,36,23,0.3)' }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg-1)' }}>
            {selectedCount} selected
          </span>
          <div className="toolbar__spacer" />
          <button onClick={() => setBulkMove(true)} className="btn btn--sm"><Move size={12} /> Move to status…</button>
          <button onClick={() => setBulkLocation(true)} className="btn btn--sm"><MapPin size={12} /> Change location…</button>
          <button onClick={bulkDelete} className="btn btn--sm" style={{ color: 'var(--stc-red-300)' }}><Trash2 size={12} /> Delete</button>
          <button onClick={() => gridRef.current?.api.deselectAll()} className="btn btn--sm btn--ghost"><X size={12} /> Clear</button>
        </div>
      )}

      {message && <div className="alert alert--info" style={{ marginTop: 12 }}>{message}</div>}

      <div className="ag-theme-quartz-dark" style={{ height: 'calc(100vh - 350px)', marginTop: 14, minHeight: 480 }}>
        <AgGridReact<StockTrailer>
          ref={gridRef}
          rowData={filtered}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          animateRows
          stopEditingWhenCellsLoseFocus
          rowSelection="multiple"
          suppressRowClickSelection
          preventDefaultOnContextMenu
          getRowId={(p) => p.data.id}
          onRowDoubleClicked={(e) => setEditing(e.data ? { row: e.data } : null)}
          onCellContextMenu={onCellContextMenu}
          onSelectionChanged={(e) => {
            const rows = e.api.getSelectedRows();
            setSelectedCount(rows.length);
            /* Told to the command bar, so "move these to Bredbury" means
               the ones ticked here. Ids only, and the server reads every
               one of them back through the caller's own session. */
            publishSelection({ entity: 'trailers', ids: rows.map((r: any) => String(r.id)) });
          }}
        />
      </div>

      {contextMenu && (
        <StockContextMenu
          x={contextMenu.x} y={contextMenu.y} row={contextMenu.row} canEdit={canEdit}
          onView={() => { setEditing({ row: contextMenu.row }); setContextMenu(null); }}
          onEditCell={() => {
            // Start AG Grid edit on the right-clicked cell
            const api = gridRef.current?.api;
            if (api && contextMenu.field) {
              api.startEditingCell({ rowIndex: api.getRowNode(contextMenu.row.id)!.rowIndex!, colKey: contextMenu.field });
            }
            setContextMenu(null);
          }}
          onMoveStatus={(news) => {
            const ids = [contextMenu.row.id];
            supabase.from('stock_trailers').update({ status: news }).in('id', ids)
              .then(({ error }) => {
                if (error) { setMessage(error.message); return; }
                setRows(r => r.map(x => x.id === contextMenu.row.id ? { ...x, status: news } : x));
                setMessage(`Moved to ${STATUS_LABEL[news]}`);
              });
            setContextMenu(null);
          }}
          onAddRefurb={() => {
            setEditing({ row: contextMenu.row, focusField: 'refurb_costs' });
            setContextMenu(null);
          }}
          onSendToTracker={() => { sendToTracker(contextMenu.row); setContextMenu(null); }}
          onDuplicate={() => { duplicateRow(contextMenu.row); setContextMenu(null); }}
          onDelete={async () => {
            if (!confirm(`Delete ${contextMenu.row.stc_no || contextMenu.row.chassis_number || 'this row'}?`)) return;
            const { error } = await supabase.from('stock_trailers').delete().eq('id', contextMenu.row.id);
            if (error) { setMessage(error.message); return; }
            setRows(r => r.filter(x => x.id !== contextMenu.row.id));
            setContextMenu(null);
          }}
          onClose={() => setContextMenu(null)}
        />
      )}

      {bulkMove && (
        <BulkStatusModal currentSelectionCount={selectedCount} onPick={bulkChangeStatus} onClose={() => setBulkMove(false)} />
      )}
      {bulkLocation && (
        <BulkLocationModal currentSelectionCount={selectedCount} onSave={bulkChangeLocation} onClose={() => setBulkLocation(false)} />
      )}

      {sendConfirm && (
        <SendToTrackerConfirm
          row={sendConfirm.row}
          myEntry={sendConfirm.myEntry}
          others={sendConfirm.others}
          onProceed={() => sendToTracker(sendConfirm.row, true)}
          onClose={() => setSendConfirm(null)}
        />
      )}

      {soldWarning && (
        <SoldTransitionWarning
          row={soldWarning.row}
          targetStatus={soldWarning.targetStatus}
          entries={soldWarning.entries}
          onProceed={() => applyStockStatus(soldWarning.row, soldWarning.targetStatus)}
          onClose={() => setSoldWarning(null)}
        />
      )}

      {editing && <StockDrawer row={editing.row} focusField={editing.focusField} canEdit={canEdit} onClose={() => setEditing(null)} onSave={(patch) => {
        setRows(r => r.map(x => x.id === editing.row.id ? { ...x, ...patch } : x));
        setEditing({ ...editing, row: { ...editing.row, ...patch } });
      }} />}
    </div>
  );
}

// ===== Full-detail drawer for a single trailer =====
function StockDrawer({ row, focusField, canEdit, onClose, onSave }: { row: StockTrailer; focusField?: string; canEdit: boolean; onClose: () => void; onSave: (p: Partial<StockTrailer>) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [edit, setEdit] = useState<StockTrailer>(row);
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Tracker linkage info (does the CURRENT user have this on their tracker?)
  const [myTrackerRow, setMyTrackerRow] = useState<{ tracker_row_id: string; status: string } | null>(null);
  const [othersTracking, setOthersTracking] = useState<Array<{ owner_name: string; status: string }>>([]);
  // Sold-by info (visible to anyone when trailer is sold; never includes commission)
  const [soldBy, setSoldBy] = useState<{ sold_by: string; customer: string | null; sale_price: number | null; order_date: string | null; dispatch_date: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetch('/api/tracker/check-link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock_trailer_id: row.id }),
      });
      const j = await r.json();
      if (!cancelled) {
        setMyTrackerRow(j.myEntry ?? null);
        setOthersTracking(j.othersEntries ?? []);
      }
    })();
    return () => { cancelled = true; };
  }, [row.id]);

  useEffect(() => {
    let cancelled = false;
    if (edit.status !== 'sold') { setSoldBy(null); return; }
    (async () => {
      const r = await fetch('/api/stock/sold-info', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock_trailer_id: row.id }),
      });
      const j = await r.json();
      if (!cancelled) setSoldBy(j.sale ?? null);
    })();
    return () => { cancelled = true; };
  }, [row.id, edit.status]);

  // If a focusField was requested (e.g. via right-click "Add refurb cost"), find the matching input,
  // scroll it into view, and focus + select its contents.
  useEffect(() => {
    if (!focusField || !bodyRef.current) return;
    const t = setTimeout(() => {
      const el = bodyRef.current!.querySelector(`[data-field="${focusField}"]`) as HTMLInputElement | HTMLTextAreaElement | null;
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus();
      if (typeof (el as HTMLInputElement).select === 'function') (el as HTMLInputElement).select();
    }, 100);
    return () => clearTimeout(t);
  }, [focusField]);

  async function save<K extends keyof StockTrailer>(field: K, value: StockTrailer[K]) {
    if (edit[field] === value) return;
    setEdit(e => ({ ...e, [field]: value }));
    setSaving(true);
    const { error } = await supabase.from('stock_trailers').update({ [field]: value }).eq('id', row.id);
    setSaving(false);
    if (error) { alert(error.message); return; }
    onSave({ [field]: value } as any);
  }

  // A trailer drawer holds unsaved edits, so a stray click on the shade
  // must not throw them away. First click arms, second closes.
  const dismiss = useDismissGuard(onClose);

  const totalNbv = (Number(edit.nbv) || 0) + (Number(edit.refurb_costs) || 0) + (Number(edit.refurb_costs_at_sale) || 0);
  const computedProfit = (Number(edit.sales_price) || 0) - totalNbv;
  const computedProfitPct = edit.sales_price ? computedProfit / Number(edit.sales_price) : null;

  return (
    <div className="drawer-bg" {...dismiss.backdropProps}>
      {dismiss.hint}
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer__head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="page-head__eyebrow">Stock · {edit.category ?? edit.status}</div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <Truck size={20} style={{ color: 'var(--stc-red)', flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {edit.stc_no || edit.chassis_number || 'Untitled trailer'}
              </span>
            </h2>
            {(edit.year || edit.make || edit.model) && (
              <div style={{ color: 'var(--fg-3)', fontSize: 13, marginTop: 4 }}>
                {[edit.year, edit.make, edit.model].filter(Boolean).join(' ')}
              </div>
            )}
          </div>
          <button onClick={onClose} className="btn btn--icon" style={{ flexShrink: 0 }}><X size={16} /></button>
        </div>
        <div ref={bodyRef} className="drawer__body">
          {/* Tracker linkage banner: yours, or someone else's */}
          {myTrackerRow && (
            <div className="card" style={{ padding: 12, background: 'rgba(46,160,67,0.08)', borderColor: 'rgba(46,160,67,0.35)' }}>
              <div className="row" style={{ gap: 10, alignItems: 'center' }}>
                <Send size={16} style={{ color: '#5fb572', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                  This trailer is on <strong>your Sales tracker</strong> at status <strong>{myTrackerRow.status}</strong>.
                </div>
                <button onClick={() => router?.push(`/dashboard/leads?contact=${myTrackerRow.tracker_row_id}`)} className="btn btn--sm btn--primary">
                  View in tracker <ArrowRight size={12} />
                </button>
              </div>
            </div>
          )}
          {!myTrackerRow && othersTracking.length > 0 && (
            <div className="card" style={{ padding: 12, background: 'rgba(91,141,239,0.06)', borderColor: 'rgba(91,141,239,0.3)' }}>
              <div style={{ fontSize: 12.5 }}>
                Tracked by: {othersTracking.map((o, i) => (
                  <span key={i} className="mono" style={{ marginRight: 8 }}>
                    <strong>{o.owner_name}</strong> ({o.status}){i < othersTracking.length - 1 ? ',' : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Sold by panel - visible to anyone when status is sold (no commission shown) */}
          {edit.status === 'sold' && soldBy && (
            <div className="card" style={{ padding: 14, background: 'rgba(127,127,127,0.08)', borderColor: 'var(--border-strong)' }}>
              <div className="field__label" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--fg-2)' }}>
                <PoundSterling size={12} /> SALE RECORD
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                <strong>{soldBy.sold_by}</strong> sold this trailer
                {soldBy.dispatch_date ? ` on ${new Date(soldBy.dispatch_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : soldBy.order_date ? ` on ${new Date(soldBy.order_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}
                {soldBy.customer ? <> to <strong>{soldBy.customer}</strong></> : ''}
                {soldBy.sale_price ? <> for <strong>£{Number(soldBy.sale_price).toLocaleString()}</strong></> : ''}.
              </div>
            </div>
          )}

          {/* IDENTITY */}
          <Section title="Identity">
            <div className="split-2">
              <Field label="STC No"><Input v={edit.stc_no} onSave={(v) => save('stc_no', v)} disabled={!canEdit} /></Field>
              <Field label="Chassis No"><Input v={edit.chassis_number} onSave={(v) => save('chassis_number', v)} disabled={!canEdit} /></Field>
            </div>
            <div className="split-2">
              <Field label="Ministry No"><Input v={edit.ministry_no} onSave={(v) => save('ministry_no', v)} disabled={!canEdit} /></Field>
              <Field label="Supplier No"><Input v={edit.supplier_no} onSave={(v) => save('supplier_no', v)} disabled={!canEdit} /></Field>
            </div>
            <div className="split-2">
              <Field label="Supplier"><Input v={edit.supplier} onSave={(v) => save('supplier', v)} disabled={!canEdit} /></Field>
              <Field label="Trade In?">
                <select className="input" disabled={!canEdit} value={edit.trade_in == null ? '' : (edit.trade_in ? 'yes' : 'no')} onChange={(e) => save('trade_in', e.target.value === '' ? null : e.target.value === 'yes')}>
                  <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
                </select>
              </Field>
            </div>
          </Section>

          {/* VEHICLE */}
          <Section title="Trailer">
            <div className="split-3">
              <Field label="Year"><Input type="number" v={edit.year} onSave={(v) => save('year', v === '' ? null : Number(v))} disabled={!canEdit} /></Field>
              <Field label="Make"><Input v={edit.make} onSave={(v) => save('make', v)} disabled={!canEdit} /></Field>
              <Field label="Model"><Input v={edit.model} onSave={(v) => save('model', v)} disabled={!canEdit} /></Field>
            </div>
            <div className="split-2">
              <Field label="Side Aperture"><Input v={edit.side_aperture} onSave={(v) => save('side_aperture', v)} disabled={!canEdit} /></Field>
              <Field label="Door Type"><Input v={edit.door_type} onSave={(v) => save('door_type', v)} disabled={!canEdit} /></Field>
            </div>
            <div className="split-2">
              <Field label="Colour"><Input v={edit.colour} onSave={(v) => save('colour', v)} disabled={!canEdit} /></Field>
              <Field label="Axle Type"><Input v={edit.axle_type} onSave={(v) => save('axle_type', v)} disabled={!canEdit} /></Field>
            </div>
            <Field label="Description"><Input v={edit.description} onSave={(v) => save('description', v)} disabled={!canEdit} /></Field>
            <div className="split-3">
              <Field label="MOT Date"><Input type="date" v={edit.mot_date} onSave={(v) => save('mot_date', v || null)} disabled={!canEdit} /></Field>
              <Field label="Received Date"><Input type="date" v={edit.received_date} onSave={(v) => save('received_date', v || null)} disabled={!canEdit} /></Field>
              <Field label="Paid?"><Input v={edit.paid_status} onSave={(v) => save('paid_status', v)} disabled={!canEdit} /></Field>
            </div>
            <div className="split-2">
              <Field label="Location"><Input v={edit.location} onSave={(v) => save('location', v)} disabled={!canEdit} /></Field>
              <Field label="Sales Rep"><Input v={edit.sales_rep} onSave={(v) => save('sales_rep', v)} disabled={!canEdit} /></Field>
            </div>
          </Section>

          {/* STATUS + CATEGORY */}
          <Section title="Status & Category">
            <div className="split-3">
              <Field label="Status">
                <select className="input" disabled={!canEdit} value={edit.status} onChange={(e) => save('status', e.target.value as StockStatus)}>
                  {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </Field>
              <Field label="Category"><Input v={edit.category} onSave={(v) => save('category', v)} disabled={!canEdit} /></Field>
              <Field label="Status text (paint condition etc.)"><Input v={edit.status_text} onSave={(v) => save('status_text', v)} disabled={!canEdit} /></Field>
            </div>
          </Section>

          {/* FINANCIALS */}
          <Section title="Financials">
            <div className="split-3">
              <Field label="NBV (£)"><Input type="number" step="0.01" v={edit.nbv} onSave={(v) => save('nbv', v === '' ? null : Number(v))} disabled={!canEdit} /></Field>
              <Field label="Refurb costs (£)"><Input type="number" step="0.01" v={edit.refurb_costs} dataField="refurb_costs" onSave={(v) => save('refurb_costs', v === '' ? null : Number(v))} disabled={!canEdit} /></Field>
              <Field label="Refurb at sale (£)"><Input type="number" step="0.01" v={edit.refurb_costs_at_sale} onSave={(v) => save('refurb_costs_at_sale', v === '' ? null : Number(v))} disabled={!canEdit} /></Field>
            </div>
            <div className="card" style={{ padding: 10, background: 'var(--bg-3)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              <ComputedBox label="Total NBV" value={fmtMoney(totalNbv)} />
              <ComputedBox label="Computed profit" value={edit.sales_price ? fmtMoney(computedProfit) : '—'} />
              <ComputedBox label="Profit %" value={computedProfitPct != null ? `${(computedProfitPct * 100).toFixed(1)}%` : '—'} />
            </div>
          </Section>

          {/* SALE */}
          <Section title="Sale">
            <div className="split-2">
              <Field label="Customer"><Input v={edit.customer} onSave={(v) => save('customer', v)} disabled={!canEdit} /></Field>
              <Field label="New / Used"><Input v={edit.new_or_used} onSave={(v) => save('new_or_used', v)} disabled={!canEdit} /></Field>
            </div>
            <div className="split-3">
              <Field label="Order date"><Input type="date" v={edit.order_date} onSave={(v) => save('order_date', v || null)} disabled={!canEdit} /></Field>
              <Field label="Dispatch date"><Input type="date" v={edit.dispatch_date} onSave={(v) => save('dispatch_date', v || null)} disabled={!canEdit} /></Field>
              <Field label="Sales price (£)"><Input type="number" step="0.01" v={edit.sales_price} onSave={(v) => save('sales_price', v === '' ? null : Number(v))} disabled={!canEdit} /></Field>
            </div>
            <div className="split-2">
              <Field label="Profit (£)"><Input type="number" step="0.01" v={edit.profit} onSave={(v) => save('profit', v === '' ? null : Number(v))} disabled={!canEdit} /></Field>
              <Field label="Profit %"><Input type="number" step="0.0001" v={edit.profit_pct} onSave={(v) => save('profit_pct', v === '' ? null : Number(v))} disabled={!canEdit} /></Field>
            </div>
            <div className="split-2">
              <Field label="Deposit received?"><Input v={edit.deposit_received} onSave={(v) => save('deposit_received', v)} disabled={!canEdit} /></Field>
              <Field label="Paid in full?"><Input v={edit.paid_in_full} onSave={(v) => save('paid_in_full', v)} disabled={!canEdit} /></Field>
            </div>
            <div className="split-2">
              <Field label="Trailer docs"><Input v={edit.trailer_docs} onSave={(v) => save('trailer_docs', v)} disabled={!canEdit} /></Field>
              <Field label="Signed order"><Input v={edit.signed_order} onSave={(v) => save('signed_order', v)} disabled={!canEdit} /></Field>
            </div>
          </Section>

          {/* NEW BUILD SPECIFICS */}
          {(edit.status === 'new_build' || edit.expected_delivery || edit.chassis_colour || edit.body_colour) && (
            <Section title="New build">
              <div className="split-2">
                <Field label="Chassis colour"><Input v={edit.chassis_colour} onSave={(v) => save('chassis_colour', v)} disabled={!canEdit} /></Field>
                <Field label="Body colour"><Input v={edit.body_colour} onSave={(v) => save('body_colour', v)} disabled={!canEdit} /></Field>
              </div>
              <div className="split-3">
                <Field label="Expected delivery"><Input type="date" v={edit.expected_delivery} onSave={(v) => save('expected_delivery', v || null)} disabled={!canEdit} /></Field>
                <Field label="Retail price (£)"><Input type="number" step="0.01" v={edit.retail_price} onSave={(v) => save('retail_price', v === '' ? null : Number(v))} disabled={!canEdit} /></Field>
                <Field label="Sold price (£)"><Input type="number" step="0.01" v={edit.sold_price} onSave={(v) => save('sold_price', v === '' ? null : Number(v))} disabled={!canEdit} /></Field>
              </div>
              <div className="split-2">
                <Field label="Quote No."><Input v={edit.quote_no} onSave={(v) => save('quote_no', v)} disabled={!canEdit} /></Field>
                <Field label="Hyperlink"><Input v={edit.hyperlink} onSave={(v) => save('hyperlink', v)} disabled={!canEdit} /></Field>
              </div>
            </Section>
          )}

          {/* NOTES */}
          <Section title="Notes">
            <Field label="Refurb update"><Textarea v={edit.refurb_update} onSave={(v) => save('refurb_update', v)} disabled={!canEdit} /></Field>
            <Field label="Refurb done"><Textarea v={edit.refurb_done} onSave={(v) => save('refurb_done', v)} disabled={!canEdit} /></Field>
            <Field label="Tread depths"><Textarea v={edit.tread_depths} onSave={(v) => save('tread_depths', v)} disabled={!canEdit} /></Field>
            <Field label="Notes"><Textarea v={edit.notes} onSave={(v) => save('notes', v)} disabled={!canEdit} /></Field>
            <Field label="JR notes"><Textarea v={edit.jr_notes} onSave={(v) => save('jr_notes', v)} disabled={!canEdit} /></Field>
            <Field label="Comments"><Textarea v={edit.comments} onSave={(v) => save('comments', v)} disabled={!canEdit} /></Field>
            <Field label="Documents"><Textarea v={edit.documents} onSave={(v) => save('documents', v)} disabled={!canEdit} /></Field>
            <Field label="Fleet Serve link"><Input v={edit.fleet_serve_link} onSave={(v) => save('fleet_serve_link', v)} disabled={!canEdit} /></Field>
          </Section>
        </div>
        <div className="drawer__foot">
          <div className="toolbar__spacer" />
          {saving && <Loader size={14} className="spin" />}
          <button onClick={onClose} className="btn">Close</button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="field__label" style={{ marginBottom: 10, color: 'var(--stc-red)' }}>{title.toUpperCase()}</div>
      <div className="col" style={{ gap: 10 }}>{children}</div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="field" style={{ flex: 1 }}><div className="field__label">{label}</div>{children}</div>;
}
function Input({ v, onSave, disabled, type, step, dataField }: { v: any; onSave: (s: string) => void; disabled?: boolean; type?: string; step?: string; dataField?: string }) {
  const [local, setLocal] = useState(v ?? '');
  useMemo(() => setLocal(v ?? ''), [v]);
  return <input className="input" type={type || 'text'} step={step} disabled={disabled} data-field={dataField}
    value={local} onChange={(e) => setLocal(e.target.value)} onBlur={(e) => onSave(e.target.value)} />;
}
function Textarea({ v, onSave, disabled }: { v: any; onSave: (s: string | null) => void; disabled?: boolean }) {
  const [local, setLocal] = useState(v ?? '');
  useMemo(() => setLocal(v ?? ''), [v]);
  return <textarea className="input" rows={2} disabled={disabled}
    value={local} onChange={(e) => setLocal(e.target.value)} onBlur={(e) => onSave(e.target.value || null)} />;
}
function ComputedBox({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mono" style={{ fontSize: 10, color: 'var(--fg-3)' }}>{label.toUpperCase()}</div>
      <div className="tnum" style={{ fontSize: 16, fontWeight: 600 }}>{value}</div>
    </div>
  );
}


// ===== Right-click context menu for stock rows =====
function StockContextMenu({ x, y, row, canEdit, onView, onEditCell, onAddRefurb, onSendToTracker, onMoveStatus, onDuplicate, onDelete, onClose }: {
  x: number; y: number; row: StockTrailer; canEdit: boolean;
  onView: () => void; onEditCell: () => void;
  onAddRefurb: () => void;
  onSendToTracker: () => void;
  onMoveStatus: (s: StockStatus) => void;
  onDuplicate: () => void; onDelete: () => void; onClose: () => void;
}) {
  // Viewport-aware position
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const m = 8;
    let l = x, t = y;
    if (x + r.width + m > window.innerWidth) l = Math.max(m, x - r.width);
    if (y + r.height + m > window.innerHeight) t = Math.max(m, y - r.height);
    setPos({ left: l, top: t });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  return (
    <div ref={ref} className="ctx-menu" style={{ left: pos.left, top: pos.top }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <div className="ctx-menu__head">{row.stc_no || row.chassis_number || 'Trailer'}{row.year && <span className="mono" style={{ marginLeft: 6, color: 'var(--fg-4)' }}>· {row.year} {row.make}</span>}</div>
      <button onClick={onView}><Eye size={12} /> Open full view</button>
      <button onClick={onEditCell} disabled={!canEdit}><Edit2 size={12} /> Edit this cell</button>
      <button onClick={onSendToTracker}><Send size={12} /> Send to my Sales tracker</button>
      <button onClick={onAddRefurb} disabled={!canEdit}><Paintbrush size={12} /> Add refurb cost</button>
      <button onClick={() => onMoveStatus('sold')} disabled={!canEdit || row.status === 'sold'}><PoundSterling size={12} /> Mark as Sold</button>
      <hr />
      <div className="ctx-menu__head" style={{ marginTop: 4 }}>Move to status</div>
      {STATUS_ORDER.map(s => (
        <button key={s} onClick={() => onMoveStatus(s)} disabled={!canEdit || s === row.status}>
          {s === 'in_stock' && <Package size={12} />}
          {s === 'new_build' && <Wrench size={12} />}
          {s === 'sales_order' && <ShoppingCart size={12} />}
          {s === 'rental' && <Truck size={12} />}
          {s === 'sold' && <Briefcase size={12} />}
          {s === 'scrap' && <Archive size={12} />}
          {STATUS_LABEL[s]}
        </button>
      ))}
      <hr />
      <button onClick={onDuplicate} disabled={!canEdit}><Copy size={12} /> Duplicate</button>
      <button onClick={onDelete} disabled={!canEdit} style={{ color: 'var(--stc-red-300)' }}><Trash2 size={12} /> Delete</button>
    </div>
  );
}

function BulkStatusModal({ currentSelectionCount, onPick, onClose }: { currentSelectionCount: number; onPick: (s: StockStatus) => void; onClose: () => void }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal__head">
          <h3 style={{ margin: 0 }}>Move {currentSelectionCount} trailer{currentSelectionCount === 1 ? '' : 's'} to…</h3>
          <button onClick={onClose} className="btn btn--icon btn--sm"><X size={14} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {STATUS_ORDER.map(s => (
            <button key={s} onClick={() => onPick(s)} className="btn" style={{ justifyContent: 'flex-start', height: 40 }}>
              {s === 'in_stock' && <Package size={14} />}
              {s === 'new_build' && <Wrench size={14} />}
              {s === 'sales_order' && <ShoppingCart size={14} />}
              {s === 'rental' && <Truck size={14} />}
              {s === 'sold' && <Briefcase size={14} />}
              {s === 'scrap' && <Archive size={14} />}
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function BulkLocationModal({ currentSelectionCount, onSave, onClose }: { currentSelectionCount: number; onSave: (location: string) => void; onClose: () => void }) {
  const [v, setV] = useState('');
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal__head">
          <h3 style={{ margin: 0 }}>Change location for {currentSelectionCount} trailer{currentSelectionCount === 1 ? '' : 's'}</h3>
          <button onClick={onClose} className="btn btn--icon btn--sm"><X size={14} /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSave(v); }} style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field">
            <div className="field__label">New location</div>
            <input className="input" autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder="e.g. Hyde, Bredbury, Atherton" />
            <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>Leave blank to clear location on all selected rows.</div>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={onClose} className="btn btn--ghost">Cancel</button>
            <button type="submit" className="btn btn--primary"><MapPin size={14} /> Apply to {currentSelectionCount}</button>
          </div>
        </form>
      </div>
    </div>
  );
}


// ===== Send to tracker. Confirms when the trailer is already on one =====
function SendToTrackerConfirm({ row, myEntry, others, onProceed, onClose }: {
  row: StockTrailer; myEntry: any; others: any[];
  onProceed: () => void; onClose: () => void;
}) {
  return (
    <div className="modal-bg" onClick={onClose} style={{ zIndex: 1100 }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal__head">
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={16} style={{ color: 'var(--stc-warning, #d4a017)' }} /> Already on a tracker
          </h3>
          <button onClick={onClose} className="btn btn--icon btn--sm"><X size={14} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ margin: 0, fontSize: 13.5 }}>
            <strong>{row.stc_no || row.chassis_number}</strong> ({row.year} {row.make} {row.model})
          </p>
          {myEntry && (
            <div className="card" style={{ padding: 10, borderColor: 'var(--stc-warning, #d4a017)' }}>
              <div style={{ fontSize: 12.5 }}>
                <strong>This trailer is already on your tracker</strong> at status <strong style={{ color: 'var(--stc-red)' }}>{myEntry.status}</strong>.
              </div>
            </div>
          )}
          {others.map((o, i) => (
            <div key={i} className="card" style={{ padding: 10, borderColor: 'rgba(91,141,239,0.4)', background: 'rgba(91,141,239,0.06)' }}>
              <div style={{ fontSize: 12.5 }}>
                On <strong>{o.owner_name}&apos;s</strong> tracker at status <strong style={{ color: 'var(--stc-red)' }}>{o.status}</strong>.
                {o.status === 'customer' && <span style={{ color: 'var(--fg-3)' }}> (deal in progress)</span>}
              </div>
            </div>
          ))}
          <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
            You can still add it to your tracker. Several reps can have the same trailer in their pipeline, and whoever marks it Sold first gets the commission.
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', padding: '0 16px 16px', gap: 8 }}>
          <button onClick={onClose} className="btn btn--ghost">Cancel</button>
          <button onClick={onProceed} className="btn btn--primary"><Send size={14} /> Add anyway</button>
        </div>
      </div>
    </div>
  );
}

// ===== Sold transition warning, for moving a Sold trailer to another status =====
function SoldTransitionWarning({ row, targetStatus, entries, onProceed, onClose }: {
  row: StockTrailer; targetStatus: StockStatus; entries: any[];
  onProceed: () => void; onClose: () => void;
}) {
  const top = entries[0];
  return (
    <div className="modal-bg" onClick={onClose} style={{ zIndex: 1100 }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal__head">
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={18} style={{ color: 'var(--stc-red)' }} /> Confirm undo of sale
          </h3>
          <button onClick={onClose} className="btn btn--icon btn--sm"><X size={14} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13.5 }}>
            <strong>{row.stc_no || row.chassis_number}</strong> ({row.year} {row.make} {row.model}) is currently <strong style={{ color: 'var(--stc-red)' }}>Sold</strong>.
          </p>
          <div className="card" style={{ padding: 12, background: 'rgba(207,36,23,0.06)', borderColor: 'rgba(207,36,23,0.3)' }}>
            <div style={{ fontSize: 13 }}>
              <strong>{top.owner_first}</strong> sold this trailer{top.dispatch_date ? ` on ${new Date(top.dispatch_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : top.order_date ? ` on ${new Date(top.order_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}
              {top.sale_price ? ` for £${Number(top.sale_price).toLocaleString()}` : ''}.
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 6 }}>
              Moving this trailer back to <strong style={{ color: 'var(--fg-1)' }}>{STATUS_LABEL[targetStatus]}</strong> will:
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                <li>Affect Sales &amp; Leasing&apos;s revenue figures for the period</li>
                <li>Reverse any commission allocated to {top.owner_first}</li>
                <li>The tracker rows linked to this trailer stay as customer. The sale happened: only the trailer status changes</li>
              </ul>
            </div>
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', padding: '0 16px 16px', gap: 8 }}>
          <button onClick={onClose} className="btn btn--ghost">Cancel</button>
          <button onClick={onProceed} className="btn btn--primary" style={{ background: 'var(--stc-red)' }}>
            Yes, change status anyway
          </button>
        </div>
      </div>
    </div>
  );
}
