'use client';

import { useCallback, useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueSetterParams } from 'ag-grid-community';
import Papa from 'papaparse';
import { Plus, Upload, Trash2, Loader, Download } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Trailer, TrailerStatus, UserRole } from '@/lib/types';

const STATUSES: TrailerStatus[] = ['available', 'reserved', 'sold'];

export function TrailerSales({
  initialTrailers, role,
}: { initialTrailers: Trailer[]; role: UserRole }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Trailer[]>(initialTrailers);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const gridRef = useState<AgGridReact<Trailer> | null>(null)[0];

  const canEdit = role === 'admin' || role === 'sales';

  const saveCell = useCallback((params: ValueSetterParams<Trailer>): boolean => {
    const field = params.colDef.field as keyof Trailer;
    if (params.data[field] === params.newValue) return false;
    (params.data as any)[field] = params.newValue;
    supabase.from('trailer_sales').update({ [field]: params.newValue }).eq('id', params.data.id)
      .then(({ error }) => { if (error) setMessage(error.message); });
    return true;
  }, [supabase]);

  const columnDefs: ColDef<Trailer>[] = useMemo(() => [
    { headerName: '', width: 38, pinned: 'left',
      checkboxSelection: canEdit, headerCheckboxSelection: canEdit, headerCheckboxSelectionFilteredOnly: true,
      sortable: false, filter: false, editable: false, suppressMenu: true,
    },
    { field: 'make',  headerName: 'Make',  flex: 1, minWidth: 120, editable: canEdit, valueSetter: saveCell },
    { field: 'model', headerName: 'Model', flex: 1.2, minWidth: 160, editable: canEdit, valueSetter: saveCell },
    { field: 'year', headerName: 'Year', width: 90, editable: canEdit, valueSetter: saveCell, valueParser: (p) => Number(p.newValue) || null },
    { field: 'price', headerName: 'Price', width: 130, editable: canEdit, valueSetter: saveCell,
      valueParser: (p) => Number(p.newValue) || 0,
      valueFormatter: (p) => p.value != null ? `£${Number(p.value).toLocaleString()}` : '',
      cellStyle: { fontFamily: '"IBM Plex Mono", monospace' } },
    { field: 'status', headerName: 'Status', width: 130, editable: canEdit, valueSetter: saveCell,
      cellEditor: 'agSelectCellEditor', cellEditorParams: { values: STATUSES },
      cellRenderer: (p: ICellRendererParams<Trailer, TrailerStatus>) =>
        p.value ? <span className={`pill pill--${p.value}`}><span className="pill__dot" />{p.value}</span> : null,
    },
    { field: 'location', headerName: 'Location', flex: 1, minWidth: 130, editable: canEdit, valueSetter: saveCell },
    { field: 'description', headerName: 'Description', flex: 1.5, minWidth: 220, editable: canEdit, valueSetter: saveCell },
  ], [canEdit, saveCell]);

  const defaultColDef: ColDef = useMemo(() => ({
    resizable: true, sortable: true, filter: true, floatingFilter: false,
  }), []);

  async function handleAdd() {
    const { data, error } = await supabase.from('trailer_sales')
      .insert({ make: 'New', model: 'Trailer', year: new Date().getFullYear(), price: 0, status: 'available', location: '' })
      .select('*').single();
    if (error) { setMessage(error.message); return; }
    setRows((r) => [data as Trailer, ...r]);
  }

  async function handleUploadStockSheet(file: File) {
    setImporting(true); setMessage(null);
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: async (results) => {
        try {
          const res = await fetch('/api/trailers/sync', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rows: results.data }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || 'Upload failed');
          setMessage(`Uploaded ${json.upserted} trailers from stock sheet`);
          const { data } = await supabase.from('trailer_sales').select('*').order('updated_at', { ascending: false });
          setRows((data ?? []) as Trailer[]);
        } catch (e: any) { setMessage(e.message); }
        finally { setImporting(false); }
      },
    });
  }

  function handleExport() {
    const csv = Papa.unparse(rows.map((r) => ({
      make: r.make, model: r.model, year: r.year, price: r.price, status: r.status,
      location: r.location, description: r.description,
    })));
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `stc-trailer-stock-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function bulkDelete(api: any) {
    const sel = api?.getSelectedRows() ?? [];
    if (!sel.length) return;
    if (!confirm(`Delete ${sel.length} trailer${sel.length === 1 ? '' : 's'}?`)) return;
    const ids = sel.map((r: Trailer) => r.id);
    const { error } = await supabase.from('trailer_sales').delete().in('id', ids);
    if (error) { setMessage(error.message); return; }
    setRows((r) => r.filter((c) => !ids.includes(c.id)));
  }

  const counts = useMemo(() => ({
    total: rows.length,
    available: rows.filter((r) => r.status === 'available').length,
    reserved: rows.filter((r) => r.status === 'reserved').length,
    sold: rows.filter((r) => r.status === 'sold').length,
  }), [rows]);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-head__eyebrow">Sales · Trailer inventory</div>
          <h1 className="page-head__title">{counts.total} <span style={{ fontWeight: 400, color: 'var(--fg-3)', fontSize: 22 }}>units in stock</span></h1>
          <div className="page-head__sub">{counts.available} available · {counts.reserved} reserved · {counts.sold} sold</div>
        </div>
      </div>

      <div className="stats-grid">
        <Stat label="Total"     value={counts.total} />
        <Stat label="Available" value={counts.available} accent="success" />
        <Stat label="Reserved"  value={counts.reserved}  accent="warning" />
        <Stat label="Sold"      value={counts.sold}      accent="info" />
      </div>

      <div className="toolbar" style={{ marginTop: 14 }}>
        <div className="toolbar__spacer" />
        {selectedCount > 0 && (
          <span className="row" style={{ background: 'var(--stc-danger-bg)', padding: '4px 10px', borderRadius: 'var(--r-2)', border: '1px solid rgba(207,36,23,0.3)', marginRight: 8 }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--stc-red-300)' }}>{selectedCount} SELECTED</span>
          </span>
        )}
        <button onClick={handleExport} className="btn"><Download size={14} /> Export CSV</button>
        {canEdit && (
          <>
            <label className="btn">
              {importing ? <Loader size={14} className="spin" /> : <Upload size={14} />} Upload stock sheet
              <input type="file" accept=".csv" hidden onChange={(e) => {
                const f = e.target.files?.[0]; if (f) handleUploadStockSheet(f);
                e.target.value = '';
              }} />
            </label>
            <button onClick={handleAdd} className="btn btn--primary"><Plus size={14} /> Add trailer</button>
          </>
        )}
      </div>

      <div className="mono" style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 6, marginTop: 4 }}>
        TIP · click any cell to edit · select rows to delete · upload a CSV with columns: make, model, year, price, status, location, description
      </div>

      {message && <div className="alert alert--info" style={{ marginBottom: 12 }}>{message}</div>}

      <div className="ag-theme-quartz-dark" style={{ height: 'calc(100vh - 380px)', minHeight: 420, borderRadius: 'var(--r-3)', border: '1px solid var(--border)', overflow: 'hidden' }}>
        <AgGridReact<Trailer>
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          rowSelection="multiple"
          suppressRowClickSelection
          animateRows
          stopEditingWhenCellsLoseFocus
          enableCellTextSelection
          getRowId={(p) => p.data.id}
          onSelectionChanged={(e) => setSelectedCount(e.api.getSelectedRows().length)}
        />
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: 'red'|'success'|'warning'|'info'|'lusha' }) {
  return (
    <div className={`stat ${accent ? `stat--${accent}` : ''}`}>
      <div className="stat__bar" />
      <div className="stat__label">{label}</div>
      <div className="stat__value tnum">{value}</div>
    </div>
  );
}
