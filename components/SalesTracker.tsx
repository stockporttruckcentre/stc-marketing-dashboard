'use client';

import { useCallback, useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueSetterParams } from 'ag-grid-community';
import { Plus, Trash2, TrendingUp, ChevronRight, Loader, Search, Edit2, X, Calendar, DollarSign, Briefcase } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { CRMContact, ContactStatus, CrmList, Profile } from '@/lib/types';

// Tracker has 3 tabs that group the existing CRM statuses
type TrackerTab = 'all' | 'working' | 'customer' | 'lost';
const STATUS_TO_TAB: Record<ContactStatus, TrackerTab> = {
  lead: 'working', contacted: 'working', quoted: 'working', won: 'working',
  customer: 'customer',
  lost: 'lost',
};
const TAB_LABEL: Record<TrackerTab, string> = {
  all: 'All',
  working: 'Working',
  customer: 'Customer',
  lost: 'Lost',
};
const TAB_HINT: Record<TrackerTab, string> = {
  all: '',
  working: 'Active leads — chasing the deal',
  customer: 'Active customer — ongoing relationship',
  lost: 'Lost — no longer pursuing',
};

const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
function fmtMoney(v: number | null | undefined) { return v == null ? '' : GBP.format(Number(v)); }
function fmtDate(v: string | null | undefined) {
  if (!v) return '';
  try { return new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }); } catch { return v; }
}

export function SalesTracker({
  list, initialContacts, profile,
}: { list: CrmList; initialContacts: CRMContact[]; profile: Profile }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<CRMContact[]>(initialContacts);
  const [tab, setTab] = useState<TrackerTab>('working');
  const [query, setQuery] = useState('');
  const [editingRow, setEditingRow] = useState<CRMContact | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c = { all: rows.length, working: 0, customer: 0, lost: 0 } as Record<TrackerTab, number>;
    for (const r of rows) c[STATUS_TO_TAB[r.status]]++;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(r => {
      if (tab !== 'all' && STATUS_TO_TAB[r.status] !== tab) return false;
      if (!q) return true;
      return ([r.company_name, r.contact_name, r.email, r.phone, r.description, r.requirement, r.action]
        .filter(Boolean).join(' ').toLowerCase().includes(q));
    });
  }, [rows, tab, query]);

  const totalEstValue = useMemo(() =>
    rows.filter(r => STATUS_TO_TAB[r.status] === 'working').reduce((sum, r) => sum + (Number(r.estimated_value) || 0), 0),
    [rows]);
  const totalCustomerRevenue = useMemo(() =>
    rows.filter(r => STATUS_TO_TAB[r.status] === 'customer').reduce((sum, r) => sum + (Number(r.sale_price) || 0), 0),
    [rows]);
  const totalCommission = useMemo(() =>
    rows.filter(r => STATUS_TO_TAB[r.status] === 'customer').reduce((sum, r) => sum + (Number(r.commission) || 0), 0),
    [rows]);

  const saveCell = useCallback((params: ValueSetterParams<CRMContact>): boolean => {
    const field = params.colDef.field as keyof CRMContact;
    if (params.data[field] === params.newValue) return false;
    (params.data as any)[field] = params.newValue;
    supabase.from('crm_contacts').update({ [field]: params.newValue }).eq('id', params.data.id)
      .then(({ error }) => { if (error) setMessage(error.message); });
    return true;
  }, [supabase]);

  const isCustomerTab = tab === 'customer';

  const columnDefs = useMemo<ColDef<CRMContact>[]>(() => {
    const base: ColDef<CRMContact>[] = [
      { field: 'date_of_enquiry', headerName: 'Enquiry', width: 110,
        valueFormatter: (p) => fmtDate(p.value), editable: true, valueSetter: saveCell,
        cellEditor: 'agTextCellEditor' },
      { field: 'contact_name', headerName: 'Contact', flex: 1, minWidth: 130, editable: true, valueSetter: saveCell },
      { field: 'company_name', headerName: 'Company', flex: 1.3, minWidth: 160, editable: true, valueSetter: saveCell },
      { field: 'phone', headerName: 'Phone', width: 140, editable: true, valueSetter: saveCell },
      { field: 'email', headerName: 'Email', flex: 1.2, minWidth: 160, editable: true, valueSetter: saveCell },
      { field: 'new_or_used', headerName: 'New/Used', width: 110, editable: true, valueSetter: saveCell,
        cellEditor: 'agSelectCellEditor', cellEditorParams: { values: ['', 'New', 'Used', 'New/Used', 'Used/Refurb', 'Refurb'] } },
      { field: 'estimated_value', headerName: 'Est. value', width: 120, editable: true, valueSetter: saveCell,
        valueParser: p => p.newValue === '' ? null : Number(p.newValue),
        valueFormatter: p => fmtMoney(p.value), cellStyle: { textAlign: 'right' } },
      { field: 'source', headerName: 'Source', width: 140, editable: true, valueSetter: saveCell },
      { field: 'description', headerName: 'Description', flex: 1.2, minWidth: 150, editable: true, valueSetter: saveCell },
      { field: 'requirement', headerName: 'Requirement', flex: 1.4, minWidth: 180, editable: true, valueSetter: saveCell },
      { field: 'action', headerName: 'Action', flex: 1.4, minWidth: 180, editable: true, valueSetter: saveCell },
      { field: 'status', headerName: 'Status', width: 120, editable: true, valueSetter: saveCell,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: ['lead', 'contacted', 'quoted', 'won', 'customer', 'lost'] },
        cellRenderer: (p: ICellRendererParams<CRMContact, ContactStatus>) => p.value
          ? <span className={`pill pill--${p.value}`}><span className="pill__dot" />{p.value}</span> : null },
      { field: 'notes', headerName: 'Latest update', flex: 1.5, minWidth: 200, editable: true, valueSetter: saveCell },
    ];
    if (isCustomerTab) {
      // Show closing financials only on the Customer tab
      base.splice(7, 0,
        { field: 'order_date',    headerName: 'Order date',    width: 110, valueFormatter: p => fmtDate(p.value), editable: true, valueSetter: saveCell },
        { field: 'dispatch_date', headerName: 'Dispatch date', width: 110, valueFormatter: p => fmtDate(p.value), editable: true, valueSetter: saveCell },
        { field: 'sale_price',    headerName: 'Sale price',    width: 110, valueFormatter: p => fmtMoney(p.value), cellStyle: { textAlign: 'right' },
          valueParser: p => p.newValue === '' ? null : Number(p.newValue), editable: true, valueSetter: saveCell },
        { field: 'profit',        headerName: 'Profit',        width: 100, valueFormatter: p => fmtMoney(p.value), cellStyle: { textAlign: 'right' },
          valueParser: p => p.newValue === '' ? null : Number(p.newValue), editable: true, valueSetter: saveCell },
        { field: 'profit_pct',    headerName: 'Profit %',      width: 90,  valueFormatter: p => p.value != null ? `${(Number(p.value) * 100).toFixed(1)}%` : '', cellStyle: { textAlign: 'right' },
          valueParser: p => p.newValue === '' ? null : Number(p.newValue), editable: true, valueSetter: saveCell },
        { field: 'commission',    headerName: 'Commission',    width: 110, valueFormatter: p => fmtMoney(p.value), cellStyle: { textAlign: 'right' },
          valueParser: p => p.newValue === '' ? null : Number(p.newValue), editable: true, valueSetter: saveCell },
      );
    }
    base.push({
      headerName: '', width: 56, pinned: 'right', sortable: false, filter: false, editable: false,
      cellRenderer: (p: ICellRendererParams<CRMContact>) => (
        <div className="row" style={{ gap: 4 }}>
          <button onClick={() => setEditingRow(p.data!)} className="btn btn--icon btn--sm" title="Edit"><Edit2 size={12} /></button>
          <button onClick={async () => {
            if (!confirm(`Delete "${p.data!.company_name}"?`)) return;
            const { error } = await supabase.from('crm_contacts').delete().eq('id', p.data!.id);
            if (error) { setMessage(error.message); return; }
            setRows(r => r.filter(x => x.id !== p.data!.id));
          }} className="btn btn--icon btn--sm" style={{ color: 'var(--stc-red-300)' }} title="Delete"><Trash2 size={12} /></button>
        </div>
      ),
    });
    return base;
  }, [saveCell, supabase, isCustomerTab]);

  const defaultColDef = useMemo<ColDef>(() => ({
    resizable: true, sortable: true, filter: true, floatingFilter: false,
  }), []);

  async function addRow() {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase.from('crm_contacts').insert({
      list_id: list.id, company_name: 'New lead', source: 'Manual',
      status: 'lead', date_of_enquiry: today,
    }).select('*').single();
    if (error) { setMessage(error.message); return; }
    setRows(r => [data as CRMContact, ...r]);
    setEditingRow(data as CRMContact);
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-head__eyebrow">Sales · Personal tracker</div>
          <h1 className="page-head__title">
            <TrendingUp size={26} style={{ color: 'var(--stc-red)' }} />
            <span>{list.name}<span style={{ color: 'var(--stc-red)' }}>.</span></span>
          </h1>
          <div className="page-head__sub">
            Only you see this list. {rows.length} row{rows.length === 1 ? '' : 's'} ·
            &nbsp;Pipeline est: <strong style={{ color: 'var(--fg-1)' }}>{fmtMoney(totalEstValue)}</strong> ·
            &nbsp;Customer revenue: <strong style={{ color: 'var(--fg-1)' }}>{fmtMoney(totalCustomerRevenue)}</strong> ·
            &nbsp;Commission: <strong style={{ color: 'var(--fg-1)' }}>{fmtMoney(totalCommission)}</strong>
          </div>
        </div>
        <button onClick={addRow} className="btn btn--primary"><Plus size={14} /> New lead</button>
      </div>

      <div className="toolbar" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {(['working', 'customer', 'lost', 'all'] as TrackerTab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`news-chip ${tab === t ? 'is-active' : ''}`}
            title={TAB_HINT[t]}>
            {TAB_LABEL[t]} <span className="news-chip__count">{counts[t]}</span>
          </button>
        ))}
        <div className="news-search" style={{ marginLeft: 'auto' }}>
          <Search size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search company, contact, requirement…" />
        </div>
      </div>

      {message && <div className="alert alert--info" style={{ marginTop: 12 }}>{message}</div>}

      <div className="ag-theme-quartz-dark" style={{ height: 'calc(100vh - 320px)', marginTop: 14, minHeight: 480 }}>
        <AgGridReact<CRMContact>
          rowData={filtered}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          animateRows
          stopEditingWhenCellsLoseFocus
          getRowId={(p) => p.data.id}
          onRowDoubleClicked={(e) => setEditingRow(e.data ?? null)}
        />
      </div>

      {editingRow && (
        <LeadEditDrawer
          row={editingRow}
          onClose={() => setEditingRow(null)}
          onSave={(patch) => {
            setRows(r => r.map(x => x.id === editingRow.id ? { ...x, ...patch } : x));
            setEditingRow({ ...editingRow, ...patch });
          }}
        />
      )}
    </div>
  );
}

// ===== Detail drawer for full edit of a single lead =====
function LeadEditDrawer({ row, onClose, onSave }: { row: CRMContact; onClose: () => void; onSave: (patch: Partial<CRMContact>) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [edit, setEdit] = useState<CRMContact>(row);
  const [saving, setSaving] = useState(false);
  const tab = STATUS_TO_TAB[edit.status];

  async function saveField<K extends keyof CRMContact>(field: K, value: CRMContact[K]) {
    if (edit[field] === value) return;
    setEdit(e => ({ ...e, [field]: value }));
    setSaving(true);
    const { error } = await supabase.from('crm_contacts').update({ [field]: value }).eq('id', row.id);
    setSaving(false);
    if (error) { alert(error.message); return; }
    onSave({ [field]: value } as any);
  }

  return (
    <div className="drawer-bg" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer__head">
          <div>
            <div className="page-head__eyebrow">Sales · {tab.toUpperCase()}</div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Briefcase size={20} style={{ color: 'var(--stc-red)' }} />
              {edit.company_name || 'Untitled lead'}
            </h2>
          </div>
          <button onClick={onClose} className="btn btn--icon"><X size={16} /></button>
        </div>
        <div className="drawer__body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="split-2">
            <Field label="Contact">
              <input className="input" value={edit.contact_name ?? ''} onChange={(e) => setEdit(s => ({ ...s, contact_name: e.target.value }))} onBlur={(e) => saveField('contact_name', e.target.value)} />
            </Field>
            <Field label="Company">
              <input className="input" value={edit.company_name ?? ''} onChange={(e) => setEdit(s => ({ ...s, company_name: e.target.value }))} onBlur={(e) => saveField('company_name', e.target.value)} />
            </Field>
          </div>
          <div className="split-2">
            <Field label="Phone">
              <input className="input" value={edit.phone ?? ''} onChange={(e) => setEdit(s => ({ ...s, phone: e.target.value }))} onBlur={(e) => saveField('phone', e.target.value)} />
            </Field>
            <Field label="Email">
              <input className="input" value={edit.email ?? ''} onChange={(e) => setEdit(s => ({ ...s, email: e.target.value }))} onBlur={(e) => saveField('email', e.target.value)} />
            </Field>
          </div>
          <div className="split-2">
            <Field label="Date of enquiry">
              <input type="date" className="input" value={edit.date_of_enquiry ?? ''} onChange={(e) => saveField('date_of_enquiry', e.target.value || null)} />
            </Field>
            <Field label="New / Used">
              <select className="input" value={edit.new_or_used ?? ''} onChange={(e) => saveField('new_or_used', e.target.value || null)}>
                <option value="">—</option>
                <option>New</option><option>Used</option><option>New/Used</option><option>Used/Refurb</option><option>Refurb</option>
              </select>
            </Field>
          </div>
          <div className="split-2">
            <Field label="Source">
              <input className="input" placeholder="LinkedIn, Prospect call, Website enquiry, Walk-in…" value={edit.source ?? ''} onChange={(e) => setEdit(s => ({ ...s, source: e.target.value }))} onBlur={(e) => saveField('source', e.target.value || '')} />
            </Field>
            <Field label="Estimated sales value">
              <input type="number" step="100" className="input" value={edit.estimated_value ?? ''} onChange={(e) => saveField('estimated_value', e.target.value === '' ? null : Number(e.target.value))} />
            </Field>
          </div>
          <Field label="Description">
            <input className="input" placeholder="e.g. 4.7m curtain, PSK flats, drawbar" value={edit.description ?? ''} onChange={(e) => setEdit(s => ({ ...s, description: e.target.value }))} onBlur={(e) => saveField('description', e.target.value || null)} />
          </Field>
          <Field label="Requirement">
            <textarea className="input" rows={2} value={edit.requirement ?? ''} onChange={(e) => setEdit(s => ({ ...s, requirement: e.target.value }))} onBlur={(e) => saveField('requirement', e.target.value || null)} />
          </Field>
          <Field label="Action / next step">
            <textarea className="input" rows={2} value={edit.action ?? ''} onChange={(e) => setEdit(s => ({ ...s, action: e.target.value }))} onBlur={(e) => saveField('action', e.target.value || null)} />
          </Field>
          <Field label="Status">
            <select className="input" value={edit.status} onChange={(e) => saveField('status', e.target.value as ContactStatus)}>
              <option value="lead">Lead</option>
              <option value="contacted">Contacted</option>
              <option value="quoted">Quoted</option>
              <option value="won">Won (just closed)</option>
              <option value="customer">Customer (active)</option>
              <option value="lost">Lost</option>
            </select>
          </Field>
          <Field label="Latest update / notes">
            <textarea className="input" rows={3} value={edit.notes ?? ''} onChange={(e) => setEdit(s => ({ ...s, notes: e.target.value }))} onBlur={(e) => saveField('notes', e.target.value || null)} />
          </Field>

          {/* Closing financials - only relevant for Customer or Won */}
          {(edit.status === 'customer' || edit.status === 'won') && (
            <div className="card" style={{ padding: 14, marginTop: 8 }}>
              <div className="field__label" style={{ marginBottom: 10, color: 'var(--stc-red)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <DollarSign size={14} /> CLOSING DETAILS
              </div>
              <div className="split-2">
                <Field label="Order date">
                  <input type="date" className="input" value={edit.order_date ?? ''} onChange={(e) => saveField('order_date', e.target.value || null)} />
                </Field>
                <Field label="Dispatch date">
                  <input type="date" className="input" value={edit.dispatch_date ?? ''} onChange={(e) => saveField('dispatch_date', e.target.value || null)} />
                </Field>
              </div>
              <div className="split-2">
                <Field label="Sale price (£)">
                  <input type="number" step="0.01" className="input" value={edit.sale_price ?? ''} onChange={(e) => saveField('sale_price', e.target.value === '' ? null : Number(e.target.value))} />
                </Field>
                <Field label="Profit (£)">
                  <input type="number" step="0.01" className="input" value={edit.profit ?? ''} onChange={(e) => saveField('profit', e.target.value === '' ? null : Number(e.target.value))} />
                </Field>
              </div>
              <div className="split-2">
                <Field label="Profit % (e.g. 0.15 = 15%)">
                  <input type="number" step="0.01" className="input" value={edit.profit_pct ?? ''} onChange={(e) => saveField('profit_pct', e.target.value === '' ? null : Number(e.target.value))} />
                </Field>
                <Field label="Commission (£)">
                  <input type="number" step="0.01" className="input" value={edit.commission ?? ''} onChange={(e) => saveField('commission', e.target.value === '' ? null : Number(e.target.value))} />
                </Field>
              </div>
            </div>
          )}
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
