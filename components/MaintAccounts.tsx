'use client';

import { useCallback, useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueSetterParams } from 'ag-grid-community';
import { Plus, Trash2, Search, Wrench, X, Loader, Edit2, Truck } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { MaintAccount, Profile } from '@/lib/types';

type CategoryTab = 'all' | 'A' | 'B' | 'C' | 'uncategorised';

const CATEGORY_LABEL: Record<CategoryTab, string> = {
  all: 'All',
  A: 'A — Top tier',
  B: 'B — Mid tier',
  C: 'C — Low tier',
  uncategorised: 'Uncategorised',
};

function fmtDate(v: string | null | undefined) {
  if (!v) return '';
  try { return new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }); } catch { return v; }
}

export function MaintAccounts({ profile, initialRows }: { profile: Profile; initialRows: MaintAccount[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<MaintAccount[]>(initialRows);
  const [tab, setTab] = useState<CategoryTab>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<MaintAccount | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<CategoryTab, number> = { all: rows.length, A: 0, B: 0, C: 0, uncategorised: 0 };
    for (const r of rows) {
      const cat = (r.category ?? '').toUpperCase();
      if (cat === 'A') c.A++;
      else if (cat === 'B') c.B++;
      else if (cat === 'C') c.C++;
      else c.uncategorised++;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(r => {
      if (tab !== 'all') {
        const cat = (r.category ?? '').toUpperCase();
        if (tab === 'uncategorised') { if (cat) return false; }
        else if (cat !== tab) return false;
      }
      if (!q) return true;
      return [r.company_name, r.contact_name, r.email, r.phone, r.location, r.services, r.vehicles, r.update_log, r.next_action]
        .filter(Boolean).join(' ').toLowerCase().includes(q);
    });
  }, [rows, tab, query]);

  const saveCell = useCallback((params: ValueSetterParams<MaintAccount>): boolean => {
    const field = params.colDef.field as keyof MaintAccount;
    if (params.data[field] === params.newValue) return false;
    (params.data as any)[field] = params.newValue;
    supabase.from('maint_accounts').update({ [field]: params.newValue }).eq('id', params.data.id)
      .then(({ error }) => { if (error) setMessage(error.message); });
    return true;
  }, [supabase]);

  const columnDefs = useMemo<ColDef<MaintAccount>[]>(() => [
    { field: 'category', headerName: 'Cat', width: 70, editable: true, valueSetter: saveCell,
      cellEditor: 'agSelectCellEditor', cellEditorParams: { values: ['', 'A', 'B', 'C'] },
      cellRenderer: (p: ICellRendererParams<MaintAccount, string>) => p.value
        ? <span className={`maint-cat maint-cat--${p.value.toLowerCase()}`}>{p.value}</span>
        : <span className="mono" style={{ color: 'var(--fg-3)' }}>—</span> },
    { field: 'date_of_update', headerName: 'Last update', width: 110,
      valueFormatter: (p) => fmtDate(p.value), editable: true, valueSetter: saveCell },
    { field: 'company_name', headerName: 'Company', flex: 1.4, minWidth: 180, editable: true, valueSetter: saveCell },
    { field: 'contact_name', headerName: 'Contact', flex: 1, minWidth: 130, editable: true, valueSetter: saveCell },
    { field: 'phone', headerName: 'Phone', width: 140, editable: true, valueSetter: saveCell },
    { field: 'email', headerName: 'Email', flex: 1.2, minWidth: 180, editable: true, valueSetter: saveCell },
    { field: 'location', headerName: 'Location', flex: 1, minWidth: 120, editable: true, valueSetter: saveCell },
    { field: 'services', headerName: 'Services', flex: 1, minWidth: 130, editable: true, valueSetter: saveCell },
    { field: 'vehicles', headerName: 'Vehicles', flex: 1.6, minWidth: 200, editable: true, valueSetter: saveCell },
    { field: 'status', headerName: 'Status', width: 110, editable: true, valueSetter: saveCell,
      cellEditor: 'agSelectCellEditor', cellEditorParams: { values: ['', 'Customer', 'On Going', 'Lost'] } },
    { field: 'update_log', headerName: 'Latest update', flex: 1.6, minWidth: 200, editable: true, valueSetter: saveCell },
    { field: 'next_action', headerName: 'Next action', flex: 1, minWidth: 140, editable: true, valueSetter: saveCell },
    { headerName: '', width: 56, pinned: 'right', sortable: false, filter: false, editable: false,
      cellRenderer: (p: ICellRendererParams<MaintAccount>) => (
        <div className="row" style={{ gap: 4 }}>
          <button onClick={() => setEditing(p.data!)} className="btn btn--icon btn--sm" title="Edit"><Edit2 size={12} /></button>
          <button onClick={async () => {
            if (!confirm(`Delete account for "${p.data!.company_name}"?`)) return;
            const { error } = await supabase.from('maint_accounts').delete().eq('id', p.data!.id);
            if (error) { setMessage(error.message); return; }
            setRows(r => r.filter(x => x.id !== p.data!.id));
          }} className="btn btn--icon btn--sm" style={{ color: 'var(--stc-red-300)' }} title="Delete"><Trash2 size={12} /></button>
        </div>
      ) },
  ], [saveCell, supabase]);

  const defaultColDef = useMemo<ColDef>(() => ({ resizable: true, sortable: true, filter: true }), []);

  async function addRow() {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase.from('maint_accounts').insert({
      owner_id: profile.id, company_name: 'New account', status: 'Customer', date_of_update: today,
    }).select('*').single();
    if (error) { setMessage(error.message); return; }
    setRows(r => [data as MaintAccount, ...r]);
    setEditing(data as MaintAccount);
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-head__eyebrow">Sales · Maintenance accounts</div>
          <h1 className="page-head__title">
            <Wrench size={26} style={{ color: 'var(--stc-red)' }} />
            <span>Maintenance<span style={{ color: 'var(--stc-red)' }}>.</span></span>
          </h1>
          <div className="page-head__sub">
            Only you see this list. {rows.length} active account{rows.length === 1 ? '' : 's'} · A: {counts.A} · B: {counts.B} · C: {counts.C}
            {counts.uncategorised > 0 && ` · ${counts.uncategorised} uncategorised`}
          </div>
        </div>
        <button onClick={addRow} className="btn btn--primary"><Plus size={14} /> New account</button>
      </div>

      <div className="toolbar" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {(['all', 'A', 'B', 'C', 'uncategorised'] as CategoryTab[]).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`news-chip ${tab === t ? 'is-active' : ''}`}>
            {CATEGORY_LABEL[t]} <span className="news-chip__count">{counts[t]}</span>
          </button>
        ))}
        <div className="news-search" style={{ marginLeft: 'auto' }}>
          <Search size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search company, contact, vehicles, update..." />
        </div>
      </div>

      {message && <div className="alert alert--info" style={{ marginTop: 12 }}>{message}</div>}

      <div className="ag-theme-quartz-dark" style={{ height: 'calc(100vh - 320px)', marginTop: 14, minHeight: 480 }}>
        <AgGridReact<MaintAccount>
          rowData={filtered}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          animateRows
          stopEditingWhenCellsLoseFocus
          getRowId={(p) => p.data.id}
          onRowDoubleClicked={(e) => setEditing(e.data ?? null)}
        />
      </div>

      {editing && <MaintEditDrawer row={editing} onClose={() => setEditing(null)} onSave={(patch) => {
        setRows(r => r.map(x => x.id === editing.id ? { ...x, ...patch } : x));
        setEditing({ ...editing, ...patch });
      }} />}
    </div>
  );
}

function MaintEditDrawer({ row, onClose, onSave }: { row: MaintAccount; onClose: () => void; onSave: (p: Partial<MaintAccount>) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [edit, setEdit] = useState<MaintAccount>(row);
  const [saving, setSaving] = useState(false);

  async function save<K extends keyof MaintAccount>(field: K, value: MaintAccount[K]) {
    if (edit[field] === value) return;
    setEdit(e => ({ ...e, [field]: value }));
    setSaving(true);
    const { error } = await supabase.from('maint_accounts').update({ [field]: value }).eq('id', row.id);
    setSaving(false);
    if (error) { alert(error.message); return; }
    onSave({ [field]: value } as any);
  }

  return (
    <div className="drawer-bg" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer__head">
          <div>
            <div className="page-head__eyebrow">Maintenance · {(edit.category ?? '—').toUpperCase()}</div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Truck size={20} style={{ color: 'var(--stc-red)' }} />
              {edit.company_name || 'Untitled account'}
            </h2>
          </div>
          <button onClick={onClose} className="btn btn--icon"><X size={16} /></button>
        </div>
        <div className="drawer__body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="split-2">
            <Field label="Company">
              <input className="input" value={edit.company_name ?? ''} onChange={(e) => setEdit(s => ({ ...s, company_name: e.target.value }))} onBlur={(e) => save('company_name', e.target.value)} />
            </Field>
            <Field label="Contact">
              <input className="input" value={edit.contact_name ?? ''} onChange={(e) => setEdit(s => ({ ...s, contact_name: e.target.value }))} onBlur={(e) => save('contact_name', e.target.value)} />
            </Field>
          </div>
          <div className="split-2">
            <Field label="Phone">
              <input className="input" value={edit.phone ?? ''} onChange={(e) => setEdit(s => ({ ...s, phone: e.target.value }))} onBlur={(e) => save('phone', e.target.value)} />
            </Field>
            <Field label="Email">
              <input className="input" value={edit.email ?? ''} onChange={(e) => setEdit(s => ({ ...s, email: e.target.value }))} onBlur={(e) => save('email', e.target.value)} />
            </Field>
          </div>
          <Field label="Location">
            <input className="input" value={edit.location ?? ''} onChange={(e) => setEdit(s => ({ ...s, location: e.target.value }))} onBlur={(e) => save('location', e.target.value)} />
          </Field>
          <div className="split-2">
            <Field label="Status">
              <select className="input" value={edit.status ?? ''} onChange={(e) => save('status', e.target.value || null)}>
                <option value="">—</option>
                <option>Customer</option><option>On Going</option><option>Lost</option>
              </select>
            </Field>
            <Field label="Category (A / B / C)">
              <select className="input" value={edit.category ?? ''} onChange={(e) => save('category', e.target.value || null)}>
                <option value="">— (uncategorised)</option>
                <option value="A">A — Top tier</option>
                <option value="B">B — Mid tier</option>
                <option value="C">C — Low tier</option>
              </select>
            </Field>
          </div>
          <Field label="Last update date">
            <input type="date" className="input" value={edit.date_of_update ?? ''} onChange={(e) => save('date_of_update', e.target.value || null)} />
          </Field>
          <Field label="Services">
            <input className="input" placeholder="e.g. All services, MOT only, MOT+service" value={edit.services ?? ''} onChange={(e) => setEdit(s => ({ ...s, services: e.target.value }))} onBlur={(e) => save('services', e.target.value || null)} />
          </Field>
          <Field label="Vehicles">
            <textarea className="input" rows={3} placeholder="e.g. 1 Tipper, 1 Hotbox, 2 Vans, 1 Ford Ranger" value={edit.vehicles ?? ''} onChange={(e) => setEdit(s => ({ ...s, vehicles: e.target.value }))} onBlur={(e) => save('vehicles', e.target.value || null)} />
          </Field>
          <Field label="Requirements">
            <textarea className="input" rows={2} value={edit.requirements ?? ''} onChange={(e) => setEdit(s => ({ ...s, requirements: e.target.value }))} onBlur={(e) => save('requirements', e.target.value || null)} />
          </Field>
          <Field label="Latest update / log">
            <textarea className="input" rows={3} value={edit.update_log ?? ''} onChange={(e) => setEdit(s => ({ ...s, update_log: e.target.value }))} onBlur={(e) => save('update_log', e.target.value || null)} />
          </Field>
          <Field label="Next action">
            <textarea className="input" rows={2} value={edit.next_action ?? ''} onChange={(e) => setEdit(s => ({ ...s, next_action: e.target.value }))} onBlur={(e) => save('next_action', e.target.value || null)} />
          </Field>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field" style={{ flex: 1 }}>
      <div className="field__label">{label}</div>
      {children}
    </div>
  );
}
