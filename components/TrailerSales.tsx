'use client';

import { useCallback, useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueSetterParams } from 'ag-grid-community';
import Papa from 'papaparse';
import { Plus, Upload, Trash2, Package, MapPin, Loader, LayoutGrid, Table } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Trailer, TrailerStatus, UserRole } from '@/lib/types';

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
    supabase.from('trailer_sales').update({ [field]: params.newValue }).eq('id', params.data.id)
      .then(({ error }) => { if (error) setMessage(error.message); });
    return true;
  }, [supabase]);

  const columnDefs: ColDef<Trailer>[] = useMemo(() => [
    {
      headerName: '', width: 50, pinned: 'left',
      cellRenderer: (p: ICellRendererParams<Trailer>) => canEdit ? (
        <button className="btn btn--icon btn--sm"
          onClick={async () => {
            if (!confirm('Delete trailer?')) return;
            const { error } = await supabase.from('trailer_sales').delete().eq('id', p.data!.id);
            if (error) { setMessage(error.message); return; }
            setRows(r => r.filter(t => t.id !== p.data!.id));
          }}><Trash2 size={12} /></button>
      ) : null, sortable: false, filter: false, editable: false,
    },
    { field: 'make',  flex: 1, minWidth: 120, editable: canEdit, valueSetter: saveCell },
    { field: 'model', flex: 1, minWidth: 140, editable: canEdit, valueSetter: saveCell },
    { field: 'year', width: 90, editable: canEdit, valueSetter: saveCell, valueParser: p => Number(p.newValue) || null },
    { field: 'price', width: 120, editable: canEdit, valueSetter: saveCell, valueParser: p => Number(p.newValue) || 0,
      valueFormatter: p => p.value != null ? `£${Number(p.value).toLocaleString()}` : '' },
    { field: 'status', width: 140, editable: canEdit, valueSetter: saveCell,
      cellEditor: 'agSelectCellEditor', cellEditorParams: { values: STATUSES },
      cellRenderer: (p: ICellRendererParams<Trailer, TrailerStatus>) =>
        p.value ? <span className={`pill pill--${p.value}`}><span className="pill__dot" />{p.value}</span> : null,
    },
    { field: 'location', flex: 1, minWidth: 130, editable: canEdit, valueSetter: saveCell },
    { field: 'description', flex: 1.5, minWidth: 200, editable: canEdit, valueSetter: saveCell },
    { field: 'external_id', headerName: 'MD Excel ID', width: 130, editable: canEdit, valueSetter: saveCell },
  ], [canEdit, saveCell, supabase]);

  const defaultColDef: ColDef = useMemo(() => ({
    resizable: true, sortable: true, filter: true, floatingFilter: true,
  }), []);

  async function handleAdd() {
    const { data, error } = await supabase.from('trailer_sales')
      .insert({ make: 'New', model: 'Trailer', year: new Date().getFullYear(), price: 0, status: 'available', location: '' })
      .select('*').single();
    if (error) { setMessage(error.message); return; }
    setRows(r => [data as Trailer, ...r]);
  }

  async function handleSyncCsv(file: File) {
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
          if (!res.ok) throw new Error(json.error || 'Sync failed');
          setMessage(`Synced ${json.upserted} trailers from MD's Excel`);
          const { data } = await supabase.from('trailer_sales').select('*').order('updated_at', { ascending: false });
          setRows((data ?? []) as Trailer[]);
        } catch (e: any) {
          setMessage(e.message);
        } finally { setImporting(false); }
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
    <div>
      <div className="page-head">
        <div>
          <div className="page-head__eyebrow">Sales · Trailer inventory</div>
          <h1 className="page-head__title">{counts.total} <span style={{ fontWeight: 400, color: 'var(--fg-3)', fontSize: 22 }}>units</span></h1>
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
        <div className="row" style={{ background: 'var(--stc-black-700)', borderRadius: 'var(--r-2)', border: '1px solid var(--border)', overflow: 'hidden', padding: 2 }}>
          <button onClick={() => setView('grid')} className={`btn btn--sm ${view === 'grid' ? 'btn--primary' : 'btn--ghost'}`}>
            <Table size={12} /> Grid
          </button>
          <button onClick={() => setView('cards')} className={`btn btn--sm ${view === 'cards' ? 'btn--primary' : 'btn--ghost'}`}>
            <LayoutGrid size={12} /> Cards
          </button>
        </div>
        <div className="toolbar__spacer" />
        {canEdit && (
          <>
            <label className="btn">
              {importing ? <Loader size={14} className="spin" /> : <Upload size={14} />} Sync from MD&apos;s Excel (CSV)
              <input type="file" accept=".csv" hidden onChange={(e) => {
                const f = e.target.files?.[0]; if (f) handleSyncCsv(f);
                e.target.value = '';
              }} />
            </label>
            <button onClick={handleAdd} className="btn btn--primary"><Plus size={14} /> Add trailer</button>
          </>
        )}
      </div>

      {message && <div className="alert alert--info" style={{ marginBottom: 12 }}>{message}</div>}

      {view === 'grid' ? (
        <div className="ag-theme-quartz-dark" style={{ height: 'calc(100vh - 380px)', minHeight: 420, borderRadius: 'var(--r-3)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <AgGridReact<Trailer>
            rowData={rows} columnDefs={columnDefs} defaultColDef={defaultColDef}
            animateRows stopEditingWhenCellsLoseFocus getRowId={(p) => p.data.id}
          />
        </div>
      ) : (
        <div className="card-grid">
          {rows.map(t => (
            <div key={t.id} className="trailer-card">
              <div className="trailer-card__img"><Package size={42} /></div>
              <div className="trailer-card__body">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-1)' }}>{t.make} {t.model}</div>
                    <div className="mono" style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>{t.year}</div>
                  </div>
                  <span className={`pill pill--${t.status}`}><span className="pill__dot" />{t.status}</span>
                </div>
                <div style={{ fontFamily: '"Panton", sans-serif', fontSize: 22, fontWeight: 700, color: 'var(--stc-red)', marginTop: 6 }}>£{(t.price ?? 0).toLocaleString()}</div>
                <p style={{ fontSize: 12.5, color: 'var(--fg-3)', margin: '6px 0 0' }}>{t.description || '—'}</p>
                <div className="row" style={{ marginTop: 8, fontSize: 12.5, color: 'var(--fg-3)' }}>
                  <MapPin size={12} /> {t.location || '—'}
                </div>
              </div>
            </div>
          ))}
          {rows.length === 0 && (
            <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--fg-3)', gridColumn: '1/-1' }}>No trailers in stock.</div>
          )}
        </div>
      )}
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
