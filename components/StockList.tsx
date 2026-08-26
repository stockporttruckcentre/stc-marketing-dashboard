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
import {
  Alert, Badge, Button, Card, Chip, EmptyState, GridBadge, GridHint, IconButton,
  InverseButton, money, RecordHead, Row, SearchInput, SectionHead, StatStrip,
  TabShell, Tabs, type Tone,
} from '@/components/kit/primitives';
import {
  Drawer, Field, Modal, OptionCard, Select, Split, TextArea, TextInput,
} from '@/components/kit/forms';
import { EdgeAwareCtxMenu, MenuHead, MenuItem, MenuRule } from '@/components/kit/menus';

type StatusTab = 'all' | StockStatus;

const STATUS_LABEL: Record<StockStatus, string> = {
  new_build: 'New Builds', in_stock: 'Available', sales_order: 'Sales Orders',
  sold: 'Sold', rental: 'Rental', scrap: 'Scrap',
};
const STATUS_ORDER: StockStatus[] = ['in_stock','new_build','sales_order','rental','sold','scrap'];

/* What a unit's state looks like. Sold is the success, scrap is the end
   of the line, and everything between is neutral or waiting: colouring
   all six would be rule one broken five times. */
const STOCK_TONE: Record<StockStatus, Tone> = {
  in_stock: 'info', new_build: 'warning', sales_order: 'accent',
  rental: 'neutral', sold: 'success', scrap: 'neutral',
};

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
          ? <GridBadge tone="neutral">{p.value}</GridBadge> : null },
      { field: 'status', headerName: 'Status', width: 110, editable: canEdit, valueSetter: saveCell,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: STATUS_ORDER },
        cellRenderer: (p: ICellRendererParams<StockTrailer, StockStatus>) => p.value
          ? <GridBadge tone={STOCK_TONE[p.value] ?? 'neutral'}>{STATUS_LABEL[p.value]}</GridBadge> : null },
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: '100%' }}>
          <IconButton label="Open the unit" onClick={() => setEditing({ row: p.data! })}>
            <Edit2 size={13} />
          </IconButton>
          {canEdit && (
            <IconButton label="Delete this unit" danger onClick={async () => {
              if (!confirm(`Delete trailer ${p.data!.stc_no || p.data!.chassis_number || p.data!.id}?`)) return;
              const { error } = await supabase.from('stock_trailers').delete().eq('id', p.data!.id);
              if (error) { setMessage(error.message); return; }
              setRows(r => r.filter(x => x.id !== p.data!.id));
            }}><Trash2 size={13} /></IconButton>
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
    <TabShell>

      {/* The same header shape the CRM pipeline uses. */}
      <RecordHead
        icon={<Truck size={20} />}
        title="Trailer stock"
        badges={<>
          <Badge tone="neutral" dot>{tab === 'all' ? 'Everything' : STATUS_LABEL[tab as StockStatus]}</Badge>
          {category && <Badge tone="neutral">{category}</Badge>}
        </>}
        sub={<>
          {totals.count} unit{totals.count === 1 ? '' : 's'} in view
          {filtered.length !== rows.length ? `, of ${rows.length} in the yard.` : '.'}
        </>}
        actions={canEdit ? <>
          <Button size="sm" variant="secondary" onClick={() => setShowImport(true)}>
            <Upload size={13} /> Import
          </Button>
          <Button size="sm" variant="primary" onClick={addRow}>
            <Plus size={13} /> Add trailer
          </Button>
        </> : undefined}
      />

      {/* What the units in view are worth. These were bold figures run
          together in the sub-line, where three sums read as one. */}
      <StatStrip items={isSoldOrOrder ? [
        { label: 'Units', value: totals.count, note: 'in view' },
        { label: 'Book value', value: fmtMoney(totals.totalNbv) || '—', note: 'total NBV' },
        { label: 'Sale value', value: fmtMoney(totals.totalSale) || '—', note: 'invoiced' },
        { label: 'Profit', value: fmtMoney(totals.totalProfit) || '—', note: 'on these units' },
        { label: 'Categories', value: categoriesInTab.length, note: 'of trailer' },
      ] : [
        { label: 'Units', value: totals.count, note: 'in view' },
        { label: 'Book value', value: fmtMoney(totals.totalNbv) || '—', note: 'total NBV' },
        { label: 'In stock', value: counts.in_stock, note: 'ready to sell' },
        { label: 'New build', value: counts.new_build, note: 'being built' },
        { label: 'Categories', value: categoriesInTab.length, note: 'of trailer' },
      ]} />

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

      {/* Where a unit is in its life. The tab's own navigation, so
          underline tabs, and the category chips below filter within
          whichever one is open. */}
      <Tabs
        value={tab}
        onChange={(v) => { setTab(v); setCategory(null); }}
        tabs={[
          { key: 'all' as StatusTab, label: 'All', count: counts.all },
          ...STATUS_ORDER.map((st) => ({
            key: st as StatusTab, label: STATUS_LABEL[st], count: counts[st],
          })),
        ]}
      />

      {/* One toolbar, like the CRM's: the sub filter, a way back, and a
          search, all on a line. */}
      {selectedCount > 0 && canEdit ? (
        <div className="crm-bulk-bar" style={{
          display: 'flex', alignItems: 'center', gap: 11, flexWrap: 'wrap',
          padding: '9px 14px', borderRadius: 'var(--r-md)',
          background: 'var(--primary)', color: 'var(--primary-fg)',
        }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>
            {selectedCount} {selectedCount === 1 ? 'unit' : 'units'} selected
          </span>
          <span style={{ width: 1, height: 18, background: 'var(--bar-line)' }} />
          <InverseButton icon={<Move size={13} />} label="Move to status"
            onClick={() => setBulkMove(true)} />
          <InverseButton icon={<MapPin size={13} />} label="Change location"
            onClick={() => setBulkLocation(true)} />
          <InverseButton icon={<Trash2 size={13} />} label="Delete" onClick={bulkDelete} danger />
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
          {categoriesInTab.length > 1 && (
            <>
              <Chip active={category === null} onClick={() => setCategory(null)}>All categories</Chip>
              {categoriesInTab.map((c) => (
                <Chip key={c} active={category === c}
                  onClick={() => setCategory(c === category ? null : c)}>{c}</Chip>
              ))}
            </>
          )}

          {(query || category || tab !== 'all') && (
            <button onClick={() => { setQuery(''); setCategory(null); setTab('all'); }} style={{
              background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
              color: 'var(--accent)', fontFamily: 'var(--inter)', fontSize: 12, fontWeight: 600,
              textDecoration: 'underline', textUnderlineOffset: 3,
            }}>Clear</button>
          )}

          <span style={{ flex: 1 }} />

          <div style={{ width: 280, maxWidth: '100%' }}>
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Stock number, chassis, make, customer, location"
              icon={<Search size={14} />}
            />
          </div>
        </div>
      )}

      {message && <Alert tone="info">{message}</Alert>}

      <div className="kit-grid ag-theme-quartz" style={{ flex: 1, minHeight: 260 }}>
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

      <GridHint>
        Double click a unit to open it. Right click any cell to edit, move or
        delete it.
      </GridHint>
    </TabShell>
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
    <Drawer
      eyebrow={`Stock · ${[edit.year, edit.make, edit.model].filter(Boolean).join(' ') || (edit.category ?? edit.status)}`}
      title={edit.stc_no || edit.chassis_number || 'Untitled trailer'}
      icon={<Truck size={18} />}
      onClose={onClose}
      backdropProps={dismiss.backdropProps as Record<string, unknown>}
      hint={dismiss.hint}
      bodyRef={bodyRef}
      footer={<>
        <span style={{ flex: 1 }} />
        {saving && <Loader size={14} className="spin" />}
        <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
      </>}
    >
          {/* Whose pipeline this unit is in: yours, or somebody else's. */}
          {myTrackerRow && (
            <Row>
              <Send size={15} style={{ color: 'var(--success)', flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--text)' }}>
                On your tracker, at <strong>{myTrackerRow.status}</strong>.
              </span>
              <Button size="sm" variant="secondary"
                onClick={() => router?.push(`/dashboard/leads?contact=${myTrackerRow.tracker_row_id}`)}>
                Open it <ArrowRight size={12} />
              </Button>
            </Row>
          )}
          {!myTrackerRow && othersTracking.length > 0 && (
            <Alert tone="info">
              <span>
                On {othersTracking.map((o, i) => (
                  <span key={i}>
                    <strong style={{ color: 'var(--text)' }}>{o.owner_name}</strong>&apos;s tracker at {o.status}
                    {i < othersTracking.length - 1 ? ', ' : ''}
                  </span>
                ))}.
              </span>
            </Alert>
          )}

          {/* Sold by panel - visible to anyone when status is sold (no commission shown) */}
          {edit.status === 'sold' && soldBy && (
            <Card padded={false}>
              <SectionHead title="Sale record" />
              <div style={{ padding: '12px 14px 14px', fontSize: 13, lineHeight: 1.6, color: 'var(--text-muted)' }}>
                <strong style={{ color: 'var(--text)' }}>{soldBy.sold_by}</strong> sold this trailer
                {soldBy.dispatch_date ? ` on ${new Date(soldBy.dispatch_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : soldBy.order_date ? ` on ${new Date(soldBy.order_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}
                {soldBy.customer ? <> to <strong style={{ color: 'var(--text)' }}>{soldBy.customer}</strong></> : ''}
                {soldBy.sale_price ? <> for <strong style={{ color: 'var(--text)' }}>{money(Number(soldBy.sale_price))}</strong></> : ''}.
              </div>
            </Card>
          )}

          {/* IDENTITY */}
          <Section title="Identity">
            <Split>
              <Field label="STC No"><Input v={edit.stc_no} onSave={(v) => save('stc_no', v)} disabled={!canEdit} /></Field>
              <Field label="Chassis No"><Input v={edit.chassis_number} onSave={(v) => save('chassis_number', v)} disabled={!canEdit} /></Field>
            </Split>
            <Split>
              <Field label="Ministry No"><Input v={edit.ministry_no} onSave={(v) => save('ministry_no', v)} disabled={!canEdit} /></Field>
              <Field label="Supplier No"><Input v={edit.supplier_no} onSave={(v) => save('supplier_no', v)} disabled={!canEdit} /></Field>
            </Split>
            <Split>
              <Field label="Supplier"><Input v={edit.supplier} onSave={(v) => save('supplier', v)} disabled={!canEdit} /></Field>
              <Field label="Trade In?">
                <Select value={edit.trade_in == null ? '' : (edit.trade_in ? 'yes' : 'no')} onChange={(v) => { if (canEdit) save('trade_in', v === '' ? null : v === 'yes'); }}>
                  <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
                </Select>
              </Field>
            </Split>
          </Section>

          {/* VEHICLE */}
          <Section title="Trailer">
            <Split cols={3}>
              <Field label="Year"><Input type="number" v={edit.year} onSave={(v) => save('year', v === '' ? null : Number(v))} disabled={!canEdit} /></Field>
              <Field label="Make"><Input v={edit.make} onSave={(v) => save('make', v)} disabled={!canEdit} /></Field>
              <Field label="Model"><Input v={edit.model} onSave={(v) => save('model', v)} disabled={!canEdit} /></Field>
            </Split>
            <Split>
              <Field label="Side Aperture"><Input v={edit.side_aperture} onSave={(v) => save('side_aperture', v)} disabled={!canEdit} /></Field>
              <Field label="Door Type"><Input v={edit.door_type} onSave={(v) => save('door_type', v)} disabled={!canEdit} /></Field>
            </Split>
            <Split>
              <Field label="Colour"><Input v={edit.colour} onSave={(v) => save('colour', v)} disabled={!canEdit} /></Field>
              <Field label="Axle Type"><Input v={edit.axle_type} onSave={(v) => save('axle_type', v)} disabled={!canEdit} /></Field>
            </Split>
            <Field label="Description"><Input v={edit.description} onSave={(v) => save('description', v)} disabled={!canEdit} /></Field>
            <Split cols={3}>
              <Field label="MOT Date"><Input type="date" v={edit.mot_date} onSave={(v) => save('mot_date', v || null)} disabled={!canEdit} /></Field>
              <Field label="Received Date"><Input type="date" v={edit.received_date} onSave={(v) => save('received_date', v || null)} disabled={!canEdit} /></Field>
              <Field label="Paid?"><Input v={edit.paid_status} onSave={(v) => save('paid_status', v)} disabled={!canEdit} /></Field>
            </Split>
            <Split>
              <Field label="Location"><Input v={edit.location} onSave={(v) => save('location', v)} disabled={!canEdit} /></Field>
              <Field label="Sales Rep"><Input v={edit.sales_rep} onSave={(v) => save('sales_rep', v)} disabled={!canEdit} /></Field>
            </Split>
          </Section>

          {/* STATUS + CATEGORY */}
          <Section title="Status & Category">
            <Split cols={3}>
              <Field label="Status">
                <Select value={edit.status} onChange={(v) => { if (canEdit) save('status', v as StockStatus); }}>
                  {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </Select>
              </Field>
              <Field label="Category"><Input v={edit.category} onSave={(v) => save('category', v)} disabled={!canEdit} /></Field>
              <Field label="Status text (paint condition etc.)"><Input v={edit.status_text} onSave={(v) => save('status_text', v)} disabled={!canEdit} /></Field>
            </Split>
          </Section>

          {/* FINANCIALS */}
          <Section title="Financials">
            <Split cols={3}>
              <Field label="NBV (£)"><Input type="number" step="0.01" v={edit.nbv} onSave={(v) => save('nbv', v === '' ? null : Number(v))} disabled={!canEdit} /></Field>
              <Field label="Refurb costs (£)"><Input type="number" step="0.01" v={edit.refurb_costs} dataField="refurb_costs" onSave={(v) => save('refurb_costs', v === '' ? null : Number(v))} disabled={!canEdit} /></Field>
              <Field label="Refurb at sale (£)"><Input type="number" step="0.01" v={edit.refurb_costs_at_sale} onSave={(v) => save('refurb_costs_at_sale', v === '' ? null : Number(v))} disabled={!canEdit} /></Field>
            </Split>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
              <ComputedBox label="Total NBV" value={fmtMoney(totalNbv)} />
              <ComputedBox label="Computed profit" value={edit.sales_price ? fmtMoney(computedProfit) : '—'} />
              <ComputedBox label="Profit %" value={computedProfitPct != null ? `${(computedProfitPct * 100).toFixed(1)}%` : '—'} />
            </div>
          </Section>

          {/* SALE */}
          <Section title="Sale">
            <Split>
              <Field label="Customer"><Input v={edit.customer} onSave={(v) => save('customer', v)} disabled={!canEdit} /></Field>
              <Field label="New / Used"><Input v={edit.new_or_used} onSave={(v) => save('new_or_used', v)} disabled={!canEdit} /></Field>
            </Split>
            <Split cols={3}>
              <Field label="Order date"><Input type="date" v={edit.order_date} onSave={(v) => save('order_date', v || null)} disabled={!canEdit} /></Field>
              <Field label="Dispatch date"><Input type="date" v={edit.dispatch_date} onSave={(v) => save('dispatch_date', v || null)} disabled={!canEdit} /></Field>
              <Field label="Sales price (£)"><Input type="number" step="0.01" v={edit.sales_price} onSave={(v) => save('sales_price', v === '' ? null : Number(v))} disabled={!canEdit} /></Field>
            </Split>
            <Split>
              <Field label="Profit (£)"><Input type="number" step="0.01" v={edit.profit} onSave={(v) => save('profit', v === '' ? null : Number(v))} disabled={!canEdit} /></Field>
              <Field label="Profit %"><Input type="number" step="0.0001" v={edit.profit_pct} onSave={(v) => save('profit_pct', v === '' ? null : Number(v))} disabled={!canEdit} /></Field>
            </Split>
            <Split>
              <Field label="Deposit received?"><Input v={edit.deposit_received} onSave={(v) => save('deposit_received', v)} disabled={!canEdit} /></Field>
              <Field label="Paid in full?"><Input v={edit.paid_in_full} onSave={(v) => save('paid_in_full', v)} disabled={!canEdit} /></Field>
            </Split>
            <Split>
              <Field label="Trailer docs"><Input v={edit.trailer_docs} onSave={(v) => save('trailer_docs', v)} disabled={!canEdit} /></Field>
              <Field label="Signed order"><Input v={edit.signed_order} onSave={(v) => save('signed_order', v)} disabled={!canEdit} /></Field>
            </Split>
          </Section>

          {/* NEW BUILD SPECIFICS */}
          {(edit.status === 'new_build' || edit.expected_delivery || edit.chassis_colour || edit.body_colour) && (
            <Section title="New build">
              <Split>
                <Field label="Chassis colour"><Input v={edit.chassis_colour} onSave={(v) => save('chassis_colour', v)} disabled={!canEdit} /></Field>
                <Field label="Body colour"><Input v={edit.body_colour} onSave={(v) => save('body_colour', v)} disabled={!canEdit} /></Field>
              </Split>
              <Split cols={3}>
                <Field label="Expected delivery"><Input type="date" v={edit.expected_delivery} onSave={(v) => save('expected_delivery', v || null)} disabled={!canEdit} /></Field>
                <Field label="Retail price (£)"><Input type="number" step="0.01" v={edit.retail_price} onSave={(v) => save('retail_price', v === '' ? null : Number(v))} disabled={!canEdit} /></Field>
                <Field label="Sold price (£)"><Input type="number" step="0.01" v={edit.sold_price} onSave={(v) => save('sold_price', v === '' ? null : Number(v))} disabled={!canEdit} /></Field>
              </Split>
              <Split>
                <Field label="Quote No."><Input v={edit.quote_no} onSave={(v) => save('quote_no', v)} disabled={!canEdit} /></Field>
                <Field label="Hyperlink"><Input v={edit.hyperlink} onSave={(v) => save('hyperlink', v)} disabled={!canEdit} /></Field>
              </Split>
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
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card padded={false}>
      <SectionHead title={title} />
      <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </Card>
  );
}
/* The drawer's fifty odd fields are written as `<Input v= onSave= />`,
   so these three stay as that shape and render the kit underneath. The
   alternative was rewriting every call site to say the same thing in
   the kit's words, which changes nothing anybody can see. */
function Input({ v, onSave, disabled, type, step, dataField }: {
  v: any; onSave: (s: string) => void; disabled?: boolean;
  type?: string; step?: string; dataField?: string;
}) {
  const [local, setLocal] = useState(v ?? '');
  useMemo(() => setLocal(v ?? ''), [v]);
  return (
    <TextInput
      type={type || 'text'}
      readOnly={disabled}
      value={String(local ?? '')}
      onChange={setLocal}
      onCommit={onSave}
    />
  );
}

function Textarea({ v, onSave, disabled }: {
  v: any; onSave: (s: string | null) => void; disabled?: boolean;
}) {
  const [local, setLocal] = useState(v ?? '');
  useMemo(() => setLocal(v ?? ''), [v]);
  return (
    <TextArea
      rows={2}
      value={String(local ?? '')}
      onChange={disabled ? () => {} : setLocal}
      onCommit={(x) => { if (!disabled) onSave(x || null); }}
    />
  );
}

/** A number the record works out for itself, shown rather than typed. */
function ComputedBox({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 3,
      padding: '9px 11px', borderRadius: 'var(--r)',
      background: 'var(--surface-sunken)', border: '1px solid var(--border)',
    }}>
      <span style={{
        fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
        letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-subtle)',
      }}>{label}</span>
      <span style={{
        fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 17,
        letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
      }}>{value}</span>
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
  const STATUS_ICON: Record<StockStatus, React.ReactNode> = {
    in_stock: <Package size={13} />, new_build: <Wrench size={13} />,
    sales_order: <ShoppingCart size={13} />, rental: <Truck size={13} />,
    sold: <Briefcase size={13} />, scrap: <Archive size={13} />,
  };

  return (
    <EdgeAwareCtxMenu x={x} y={y}>
      <MenuHead>
        {row.stc_no || row.chassis_number || 'Trailer'}
        {row.year ? ` · ${row.year} ${row.make ?? ''}`.trimEnd() : ''}
      </MenuHead>
      <MenuItem icon={<Eye size={13} />} label="Open the unit" onClick={onView} />
      <MenuItem icon={<Edit2 size={13} />} label="Edit this cell" onClick={onEditCell} disabled={!canEdit} />
      <MenuItem icon={<Send size={13} />} label="Send to my tracker" onClick={onSendToTracker} />
      <MenuItem icon={<Paintbrush size={13} />} label="Add refurb cost" onClick={onAddRefurb} disabled={!canEdit} />
      <MenuItem icon={<PoundSterling size={13} />} label="Mark as sold"
        onClick={() => onMoveStatus('sold')} disabled={!canEdit || row.status === 'sold'} />
      <MenuRule />
      <MenuHead>Move to</MenuHead>
      {STATUS_ORDER.map((st) => (
        <MenuItem key={st} icon={STATUS_ICON[st]} label={STATUS_LABEL[st]}
          onClick={() => onMoveStatus(st)} disabled={!canEdit || st === row.status} />
      ))}
      <MenuRule />
      <MenuItem icon={<Copy size={13} />} label="Duplicate" onClick={onDuplicate} disabled={!canEdit} />
      <MenuItem icon={<Trash2 size={13} />} label="Delete" onClick={onDelete} disabled={!canEdit} danger />
    </EdgeAwareCtxMenu>
  );
}

function BulkStatusModal({ currentSelectionCount, onPick, onClose }: { currentSelectionCount: number; onPick: (s: StockStatus) => void; onClose: () => void }) {
  const ICON: Record<StockStatus, React.ReactNode> = {
    in_stock: <Package size={14} />, new_build: <Wrench size={14} />,
    sales_order: <ShoppingCart size={14} />, rental: <Truck size={14} />,
    sold: <Briefcase size={14} />, scrap: <Archive size={14} />,
  };
  return (
    <Modal
      title={`Move ${currentSelectionCount} ${currentSelectionCount === 1 ? 'unit' : 'units'}`}
      description="Pick where they go."
      width={460}
      onClose={onClose}
      footer={<Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>}
    >
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        {STATUS_ORDER.map((st) => (
          <OptionCard key={st} selected={false} onSelect={() => onPick(st)}
            icon={ICON[st]} title={STATUS_LABEL[st]} />
        ))}
      </div>
    </Modal>
  );
}

function BulkLocationModal({ currentSelectionCount, onSave, onClose }: { currentSelectionCount: number; onSave: (location: string) => void; onClose: () => void }) {
  const [v, setV] = useState('');
  return (
    <Modal
      title={`Change location for ${currentSelectionCount} ${currentSelectionCount === 1 ? 'unit' : 'units'}`}
      width={460}
      onClose={onClose}
      footer={<>
        <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={() => onSave(v)}>
          <MapPin size={13} /> Apply to {currentSelectionCount}
        </Button>
      </>}
    >
      <Field label="New location" hint="Leave it blank to clear the location on all of them.">
        <TextInput value={v} onChange={setV} placeholder="Hyde, Bredbury, Atherton" />
      </Field>
    </Modal>
  );
}


// ===== Send to tracker. Confirms when the trailer is already on one =====
function SendToTrackerConfirm({ row, myEntry, others, onProceed, onClose }: {
  row: StockTrailer; myEntry: any; others: any[];
  onProceed: () => void; onClose: () => void;
}) {
  return (
    <Modal
      title="Already on a tracker"
      description={`${row.stc_no || row.chassis_number} · ${[row.year, row.make, row.model].filter(Boolean).join(' ')}`}
      width={480}
      onClose={onClose}
      footer={<>
        <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={onProceed}>
          <Send size={13} /> Add it anyway
        </Button>
      </>}
    >
      {myEntry && (
        <Alert tone="warning">
          This unit is already on your own tracker, at <strong style={{ color: 'var(--text)' }}>{myEntry.status}</strong>.
        </Alert>
      )}
      {others.map((o, i) => (
        <Alert key={i} tone="info">
          On <strong style={{ color: 'var(--text)' }}>{o.owner_name}</strong>&apos;s tracker,
          at <strong style={{ color: 'var(--text)' }}>{o.status}</strong>
          {o.status === 'customer' ? ', with a deal in progress' : ''}.
        </Alert>
      ))}
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-subtle)', lineHeight: 1.5 }}>
        Several reps can have the same unit in their pipeline. Whoever marks it
        sold first takes the commission.
      </p>
    </Modal>
  );
}

// ===== Sold transition warning, for moving a Sold trailer to another status =====
function SoldTransitionWarning({ row, targetStatus, entries, onProceed, onClose }: {
  row: StockTrailer; targetStatus: StockStatus; entries: any[];
  onProceed: () => void; onClose: () => void;
}) {
  const top = entries[0];
  const when = top.dispatch_date || top.order_date;
  return (
    <Modal
      title="This unit has been sold"
      description={`${row.stc_no || row.chassis_number} · ${[row.year, row.make, row.model].filter(Boolean).join(' ')}`}
      width={520}
      onClose={onClose}
      footer={<>
        <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="accent" onClick={onProceed}>
          Change it to {STATUS_LABEL[targetStatus]} anyway
        </Button>
      </>}
    >
      <Alert tone="danger">
        <span>
          <strong style={{ color: 'var(--text)' }}>{top.owner_first}</strong> sold it
          {when ? ` on ${new Date(when).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}
          {top.sale_price ? ` for ${money(Number(top.sale_price))}` : ''}.
        </span>
      </Alert>

      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Moving it back to <strong style={{ color: 'var(--text)' }}>{STATUS_LABEL[targetStatus]}</strong> will:
        <ul style={{ margin: '6px 0 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <li>change Sales and Leasing&apos;s revenue for that period</li>
          <li>reverse the commission allocated to {top.owner_first}</li>
          <li>leave the lead as a customer, because the sale did happen. Only the unit&apos;s status changes</li>
        </ul>
      </div>
    </Modal>
  );
}
