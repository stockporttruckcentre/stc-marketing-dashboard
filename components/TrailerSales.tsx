'use client';

import { useCallback, useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueSetterParams } from 'ag-grid-community';
import Papa from 'papaparse';
import { Plus, Upload, Trash2, Package, MapPin, Loader, LayoutGrid, Table } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Trailer, TrailerStatus, UserRole } from '@/lib/types';

const STATUS_COLORS: Record<TrailerStatus, string> = {
  available: 'bg-green-100 text-green-800',
  reserved:  'bg-yellow-100 text-yellow-800',
  sold:      'bg-gray-200 text-gray-800',
};

const STATUSES: TrailerStatus[] = ['available', 'reserved', 'sold'];

export function TrailerSales({
  initialTrailers, role,
}: { initialTrailers: Trailer[]; role: UserRole }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Trailer[]>(initialTrailers);
  const [view, setView] = useState<'grid' | 'cards'>('grid');
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const canEdit = role === 'admin' || role === 'sales';

  const saveCell = useCallback((params: ValueSetterParams<Trailer>): boolean => {
    const field = params.colDef.field as keyof Trailer;
    if (params.data[field] === params.newValue) return false;
    (params.data as any)[field] = params.newValue;
    supabase
      .from('trailer_sales')
      .update({ [field]: params.newValue })
      .eq('id', params.data.id)
      .then(({ error }) => { if (error) setMessage(error.message); });
    return true;
  }, [supabase]);

  const columnDefs: ColDef<Trailer>[] = useMemo(() => [
    {
      headerName: '', width: 50, pinned: 'left',
      cellRenderer: (p: ICellRendererParams<Trailer>) => canEdit ? (
        <button className="p-1 text-gray-400 hover:text-red-600"
          onClick={async () => {
            if (!confirm('Delete trailer?')) return;
            const { error } = await supabase.from('trailer_sales').delete().eq('id', p.data!.id);
            if (error) { setMessage(error.message); return; }
            setRows(r => r.filter(t => t.id !== p.data!.id));
          }}><Trash2 size={14} /></button>
      ) : null, sortable: false, filter: false, editable: false,
    },
    { field: 'make',  flex: 1, minWidth: 120, editable: canEdit, valueSetter: saveCell },
    { field: 'model', flex: 1, minWidth: 140, editable: canEdit, valueSetter: saveCell },
    { field: 'year', width: 90, editable: canEdit, valueSetter: saveCell, valueParser: p => Number(p.newValue) || null },
    { field: 'price', width: 110, editable: canEdit, valueSetter: saveCell, valueParser: p => Number(p.newValue) || 0,
      valueFormatter: p => p.value != null ? `£${Number(p.value).toLocaleString()}` : '' },
    { field: 'status', width: 130, editable: canEdit, valueSetter: saveCell,
      cellEditor: 'agSelectCellEditor', cellEditorParams: { values: STATUSES },
      cellRenderer: (p: ICellRendererParams<Trailer, TrailerStatus>) =>
        p.value ? <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[p.value]}`}>{p.value}</span> : null,
    },
    { field: 'location', flex: 1, minWidth: 130, editable: canEdit, valueSetter: saveCell },
    { field: 'description', flex: 1.5, minWidth: 200, editable: canEdit, valueSetter: saveCell },
    { field: 'external_id', headerName: 'MD Excel ID', width: 130, editable: canEdit, valueSetter: saveCell },
  ], [canEdit, saveCell, supabase]);

  const defaultColDef: ColDef = useMemo(() => ({
    resizable: true, sortable: true, filter: true, floatingFilter: true,
  }), []);

  async function handleAdd() {
    const { data, error } = await supabase
      .from('trailer_sales')
      .insert({ make: 'New', model: 'Trailer', year: new Date().getFullYear(), price: 0, status: 'available', location: '' })
      .select('*').single();
    if (error) { setMessage(error.message); return; }
    setRows(r => [data as Trailer, ...r]);
  }

  async function handleSyncCsv(file: File) {
    setImporting(true);
    setMessage(null);
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: async (results) => {
        try {
          const res = await fetch('/api/trailers/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rows: results.data }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || 'Sync failed');
          setMessage(`Synced ${json.upserted} trailers from MD's Excel`);
          const { data } = await supabase.from('trailer_sales').select('*').order('updated_at', { ascending: false });
          setRows((data ?? []) as Trailer[]);
        } catch (e: any) {
          setMessage(e.message);
        } finally {
          setImporting(false);
        }
      },
    });
  }

  const counts = useMemo(() => ({
    total: rows.length,
    available: rows.filter(r => r.status === 'available').length,
    reserved: rows.filter(r => r.status === 'reserved').length,
    sold: rows.filter(r => r.status === 'sold').length,
  }), [rows]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <Stat label="Total" value={counts.total} color="bg-gray-100" />
        <Stat label="Available" value={counts.available} color="bg-green-100" />
        <Stat label="Reserved" value={counts.reserved} color="bg-yellow-100" />
        <Stat label="Sold" value={counts.sold} color="bg-gray-200" />
      </div>

      <div className="bg-white rounded-lg shadow p-3 flex flex-wrap items-center gap-3">
        <div className="flex border rounded-lg overflow-hidden">
          <button onClick={() => setView('grid')} className={`px-3 py-2 flex items-center gap-1 text-sm ${view === 'grid' ? 'bg-stc-navy text-white' : 'bg-white'}`}>
            <Table size={14} /> Grid
          </button>
          <button onClick={() => setView('cards')} className={`px-3 py-2 flex items-center gap-1 text-sm ${view === 'cards' ? 'bg-stc-navy text-white' : 'bg-white'}`}>
            <LayoutGrid size={14} /> Cards
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {canEdit && (
            <>
              <label className="px-4 py-2 border rounded-lg flex items-center gap-2 hover:bg-gray-50 cursor-pointer">
                {importing ? <Loader size={14} className="animate-spin" /> : <Upload size={14} />}
                Sync from MD&apos;s Excel (CSV)
                <input type="file" accept=".csv" hidden onChange={(e) => {
                  const f = e.target.files?.[0]; if (f) handleSyncCsv(f);
                  e.target.value = '';
                }} />
              </label>
              <button onClick={handleAdd} className="px-4 py-2 bg-stc-red text-white rounded-lg hover:bg-stc-red-dark flex items-center gap-2">
                <Plus size={14} /> Add trailer
              </button>
            </>
          )}
        </div>
      </div>

      {message && <div className="bg-blue-50 text-blue-900 rounded-lg px-4 py-2 text-sm">{message}</div>}

      {view === 'grid' ? (
        <div className="ag-theme-quartz bg-white rounded-lg shadow" style={{ height: 'calc(100vh - 380px)', minHeight: 400 }}>
          <AgGridReact<Trailer>
            rowData={rows}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            animateRows
            stopEditingWhenCellsLoseFocus
            getRowId={(p) => p.data.id}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map(t => (
            <div key={t.id} className="bg-white rounded-lg shadow overflow-hidden">
              <div className="h-44 bg-gray-100 flex items-center justify-center">
                <Package size={48} className="text-gray-300" />
              </div>
              <div className="p-4 space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold">{t.make} {t.model}</h3>
                    <p className="text-xs text-gray-600">{t.year}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[t.status]}`}>{t.status}</span>
                </div>
                <p className="text-2xl font-bold text-stc-red">£{(t.price ?? 0).toLocaleString()}</p>
                <p className="text-sm text-gray-600 line-clamp-2">{t.description || '—'}</p>
                <div className="flex items-center gap-1 text-sm text-gray-600">
                  <MapPin size={14} /> {t.location || '—'}
                </div>
              </div>
            </div>
          ))}
          {rows.length === 0 && (
            <div className="col-span-full bg-white rounded-lg shadow p-8 text-center text-gray-500">No trailers in stock.</div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`${color} rounded-lg p-3`}>
      <div className="text-2xl font-bold leading-none mb-1">{value}</div>
      <div className="text-xs text-gray-700">{label}</div>
    </div>
  );
}
