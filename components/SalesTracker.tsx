'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueSetterParams } from 'ag-grid-community';
import { Plus, Trash2, TrendingUp, ChevronRight, Loader, Search, Edit2, X, Calendar, DollarSign, Briefcase, CalendarPlus, AlertTriangle, Link as LinkIcon, Wrench, PoundSterling, Truck, Eye, Copy, Package } from 'lucide-react';
import { ScheduleMeetingModal } from './CrmWorkspace';
import type { CalendarEvent } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';
import type { CRMContact, ContactStatus, CrmList, Profile, StockTrailer } from '@/lib/types';

// Tracker has 3 tabs that group the existing CRM statuses
type TrackerTab = 'all' | 'working' | 'customer' | 'lost' | 'commission';
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
  commission: 'My commission',
};
const TAB_HINT: Record<TrackerTab, string> = {
  all: '',
  working: 'Active leads — chasing the deal',
  customer: 'Active customer — ongoing relationship',
  lost: 'Lost — no longer pursuing',
  commission: 'Your earned commission, summarised',
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
  const [side, setSide] = useState<'trailer_sales' | 'maintenance'>('trailer_sales');
  const [whatFilter, setWhatFilter] = useState<string | null>(null);
  const [tab, setTab] = useState<TrackerTab>('working');
  const [query, setQuery] = useState('');
  const [editingRow, setEditingRow] = useState<CRMContact | null>(null);

  // ?contact=ID deep-link from the stock drawer's "View in tracker" button
  const sp = useSearchParams();
  useEffect(() => {
    const id = sp?.get('contact');
    if (!id) return;
    const target = rows.find(r => r.id === id);
    if (target) {
      setEditingRow(target);
      if (target.side) setSide(target.side as any);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, rows]);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Counts of the CURRENT side only
  const sideRows = useMemo(() => rows.filter(r => (r.side ?? 'trailer_sales') === side), [rows, side]);
  const counts = useMemo(() => {
    const c = { all: sideRows.length, working: 0, customer: 0, lost: 0, commission: 0 } as Record<TrackerTab, number>;
    for (const r of sideRows) c[STATUS_TO_TAB[r.status]]++;
    // commission tab "count" = number of paid-out sales (rows with commission > 0)
    c.commission = sideRows.filter(r => Number(r.commission) > 0).length;
    return c;
  }, [sideRows]);
  const sideCounts = useMemo(() => ({
    trailer_sales: rows.filter(r => (r.side ?? 'trailer_sales') === 'trailer_sales').length,
    maintenance:   rows.filter(r => r.side === 'maintenance').length,
  }), [rows]);
  // Unique "What" values present in current side (for the maintenance filter chips)
  const whatValues = useMemo(() => {
    if (side !== 'maintenance') return [];
    const set = new Set<string>();
    for (const r of sideRows) if (r.what) set.add(r.what);
    return Array.from(set).sort();
  }, [side, sideRows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sideRows.filter(r => {
      if (tab !== 'all' && STATUS_TO_TAB[r.status] !== tab) return false;
      if (side === 'maintenance' && whatFilter && (r.what || '').toLowerCase() !== whatFilter.toLowerCase()) return false;
      if (!q) return true;
      return ([r.company_name, r.contact_name, r.email, r.phone, r.description, r.requirement, r.action, r.what, r.vehicles]
        .filter(Boolean).join(' ').toLowerCase().includes(q));
    });
  }, [sideRows, side, whatFilter, tab, query]);

  const totalEstValue = useMemo(() =>
    sideRows.filter(r => STATUS_TO_TAB[r.status] === 'working').reduce((sum, r) => sum + (Number(r.estimated_value) || 0), 0),
    [sideRows]);
  const totalCustomerRevenue = useMemo(() =>
    sideRows.filter(r => STATUS_TO_TAB[r.status] === 'customer').reduce((sum, r) => sum + (Number(r.sale_price) || 0), 0),
    [sideRows]);
  const totalCommission = useMemo(() =>
    sideRows.filter(r => STATUS_TO_TAB[r.status] === 'customer').reduce((sum, r) => sum + (Number(r.commission) || 0), 0),
    [sideRows]);

  const saveCell = useCallback((params: ValueSetterParams<CRMContact>): boolean => {
    const field = params.colDef.field as keyof CRMContact;
    if (params.data[field] === params.newValue) return false;
    (params.data as any)[field] = params.newValue;
    supabase.from('crm_contacts').update({ [field]: params.newValue }).eq('id', params.data.id)
      .then(({ error }) => { if (error) setMessage(error.message); });
    return true;
  }, [supabase]);

  const isCustomerTab = tab === 'customer';
  const isMaintenance = side === 'maintenance';

  const columnDefs = useMemo<ColDef<CRMContact>[]>(() => {
    const commonStart: ColDef<CRMContact>[] = [
      { field: 'date_of_enquiry', headerName: isMaintenance ? 'Last update' : 'Enquiry', width: 110,
        valueFormatter: (p) => fmtDate(p.value), editable: true, valueSetter: saveCell, cellEditor: 'agTextCellEditor' },
      { field: 'company_name', headerName: 'Company', flex: 1.3, minWidth: 160, editable: true, valueSetter: saveCell },
      { field: 'contact_name', headerName: 'Contact', flex: 1, minWidth: 130, editable: true, valueSetter: saveCell },
      { field: 'phone', headerName: 'Phone', width: 140, editable: true, valueSetter: saveCell },
      { field: 'email', headerName: 'Email', flex: 1.2, minWidth: 160, editable: true, valueSetter: saveCell },
    ];
    const salesMid: ColDef<CRMContact>[] = [
      { field: 'new_or_used', headerName: 'New/Used', width: 110, editable: true, valueSetter: saveCell,
        cellEditor: 'agSelectCellEditor', cellEditorParams: { values: ['', 'New', 'Used', 'New/Used', 'Used/Refurb', 'Refurb'] } },
      { field: 'estimated_value', headerName: 'Est. value', width: 120, editable: true, valueSetter: saveCell,
        valueParser: p => p.newValue === '' ? null : Number(p.newValue),
        valueFormatter: p => fmtMoney(p.value), cellStyle: { textAlign: 'right' } },
      { field: 'source', headerName: 'Source', width: 140, editable: true, valueSetter: saveCell },
      { field: 'description', headerName: 'Description', flex: 1.2, minWidth: 150, editable: true, valueSetter: saveCell },
    ];
    const maintMid: ColDef<CRMContact>[] = [
      { field: 'what', headerName: 'What', width: 150, editable: true, valueSetter: saveCell,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: ['', 'Maintenance', 'Trukplan', 'All Services', 'Maintenance and MOT', 'Maintenance and Trukplan', 'Van Maintenance and Repair', 'Accident Repair', 'All Services and Parking'] } },
      { field: 'category', headerName: 'Cat', width: 70, editable: true, valueSetter: saveCell,
        cellEditor: 'agSelectCellEditor', cellEditorParams: { values: ['', 'A', 'B', 'C'] },
        cellRenderer: (p: ICellRendererParams<CRMContact, string>) => p.value
          ? <span className={`maint-cat maint-cat--${p.value.toLowerCase()}`}>{p.value}</span> : <span style={{ color: 'var(--fg-3)' }}>—</span> },
      { field: 'account_manager', headerName: 'Manager', width: 100, editable: true, valueSetter: saveCell },
      { field: 'source', headerName: 'Source', width: 130, editable: true, valueSetter: saveCell },
      { field: 'vehicles', headerName: 'Vehicles', flex: 1.4, minWidth: 180, editable: true, valueSetter: saveCell },
    ];
    const commonEnd: ColDef<CRMContact>[] = [
      { field: 'requirement', headerName: 'Requirement', flex: 1.2, minWidth: 160, editable: true, valueSetter: saveCell },
      { field: 'action', headerName: 'Action', flex: 1.2, minWidth: 160, editable: true, valueSetter: saveCell },
      ...(isMaintenance ? [{ field: 'next_action' as keyof CRMContact, headerName: 'Next action', flex: 1.2, minWidth: 160, editable: true, valueSetter: saveCell }] : []),
      { field: 'status', headerName: 'Status', width: 120, editable: true, valueSetter: saveCell,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: ['lead', 'contacted', 'quoted', 'won', 'customer', 'lost'] },
        cellRenderer: (p: ICellRendererParams<CRMContact, ContactStatus>) => p.value
          ? <span className={`pill pill--${p.value}`}><span className="pill__dot" />{p.value}</span> : null },
      { field: 'notes', headerName: 'Latest update', flex: 1.5, minWidth: 200, editable: true, valueSetter: saveCell },
    ];
    const base = [...commonStart, ...(isMaintenance ? maintMid : salesMid), ...commonEnd];
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

  const [showNewLead, setShowNewLead] = useState(false);

  async function createBlankLead(company: string, websiteUrl: string, newSide: 'trailer_sales' | 'maintenance', what: string | null) {
    const today = new Date().toISOString().slice(0, 10);
    const links = websiteUrl.trim()
      ? [{ id: crypto.randomUUID(), label: 'Website', url: websiteUrl.trim(), kind: 'website' as const }]
      : [];
    const { data, error } = await supabase.from('crm_contacts').insert({
      list_id: list.id, company_name: company.trim() || 'New lead', source: 'Manual',
      status: 'lead', date_of_enquiry: today, links,
      side: newSide, what: newSide === 'maintenance' ? what : null,
    }).select('*').single();
    if (error) { setMessage(error.message); return; }
    setRows(r => [data as CRMContact, ...r]);
    setSide(newSide);
    setShowNewLead(false);
    setEditingRow(data as CRMContact);
  }

  async function importFromCrm(sourceContact: CRMContact, newSide: 'trailer_sales' | 'maintenance' = 'trailer_sales', what: string | null = null) {
    // Copy the row's data into a NEW row in the tracker list (preserves the source contact)
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase.from('crm_contacts').insert({
      list_id: list.id,
      company_name: sourceContact.company_name,
      contact_name: sourceContact.contact_name,
      email: sourceContact.email,
      phone: sourceContact.phone,
      source: sourceContact.source || 'Imported from CRM',
      status: sourceContact.status === 'lost' ? 'lost' : sourceContact.status === 'customer' ? 'customer' : 'lead',
      side: newSide,
      what: newSide === 'maintenance' ? what : null,
      address: sourceContact.address,
      links: sourceContact.links,
      location: sourceContact.location,
      employee_count: sourceContact.employee_count,
      turnover: sourceContact.turnover,
      trucks: sourceContact.trucks,
      trailers: sourceContact.trailers,
      vans: sourceContact.vans,
      assigned_to: sourceContact.assigned_to,
      notes: sourceContact.notes,
      date_of_enquiry: today,
    }).select('*').single();
    if (error) { setMessage(error.message); return; }
    setRows(r => [data as CRMContact, ...r]);
    setSide(newSide);
    setShowNewLead(false);
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
            Only you see this list. {sideRows.length} {isMaintenance ? 'maintenance account' : 'trailer-sales lead'}{sideRows.length === 1 ? '' : 's'}
            {!isMaintenance && <> · Pipeline est: <strong style={{ color: 'var(--fg-1)' }}>{fmtMoney(totalEstValue)}</strong> · Customer revenue: <strong style={{ color: 'var(--fg-1)' }}>{fmtMoney(totalCustomerRevenue)}</strong> · Commission: <strong style={{ color: 'var(--fg-1)' }}>{fmtMoney(totalCommission)}</strong></>}
          </div>
        </div>
        <button onClick={() => setShowNewLead(true)} className="btn btn--primary"><Plus size={14} /> New lead</button>
      </div>

      {/* Top-level side switcher: Trailer Sales | Maintenance */}
      <div className="side-toggle">
        <button onClick={() => { setSide('trailer_sales'); setWhatFilter(null); }}
          className={`side-toggle__btn ${side === 'trailer_sales' ? 'is-active' : ''}`}>
          <Package size={14} /> <span>Trailer Sales</span>
          <span className="side-toggle__count">{sideCounts.trailer_sales}</span>
        </button>
        <button onClick={() => setSide('maintenance')}
          className={`side-toggle__btn ${side === 'maintenance' ? 'is-active' : ''}`}>
          <Wrench size={14} /> <span>Maintenance</span>
          <span className="side-toggle__count">{sideCounts.maintenance}</span>
        </button>
      </div>

      {isMaintenance && whatValues.length > 0 && (
        <div className="toolbar" style={{ flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--fg-3)', fontWeight: 600 }}>WHAT:</span>
          <button onClick={() => setWhatFilter(null)} className={`news-chip ${whatFilter === null ? 'is-active' : ''}`}>All</button>
          {whatValues.map(w => (
            <button key={w} onClick={() => setWhatFilter(w === whatFilter ? null : w)} className={`news-chip ${whatFilter === w ? 'is-active' : ''}`}>
              {w}
            </button>
          ))}
        </div>
      )}

      <div className="toolbar" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {(['working', 'customer', 'lost', 'all', 'commission'] as TrackerTab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`news-chip ${t === 'commission' ? 'news-chip--commission' : ''} ${tab === t ? 'is-active' : ''}`}
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

      {tab === 'commission' ? (
        <CommissionView rows={sideRows} />
      ) : (
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
      )}

      {showNewLead && (
        <NewLeadModal
          currentListId={list.id}
          onCreateNew={createBlankLead}
          onImport={importFromCrm}
          onClose={() => setShowNewLead(false)}
        />
      )}

      {editingRow && (
        <LeadEditDrawer
          row={editingRow}
          profile={profile}
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
function LeadEditDrawer({ row, profile, onClose, onSave }: { row: CRMContact; profile: Profile; onClose: () => void; onSave: (patch: Partial<CRMContact>) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [edit, setEdit] = useState<CRMContact>(row);
  const [saving, setSaving] = useState(false);
  const [meetings, setMeetings] = useState<CalendarEvent[]>([]);
  const [loadingMeetings, setLoadingMeetings] = useState(true);
  const [showSchedule, setShowSchedule] = useState(false);
  const [conflictMeeting, setConflictMeeting] = useState<CalendarEvent | null>(null);
  const tab = STATUS_TO_TAB[edit.status];

  // Load all scheduled meetings tied to this contact (any visibility user can see)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingMeetings(true);
      const { data } = await supabase
        .from('calendar_events').select('*')
        .eq('contact_id', row.id)
        .order('start_at', { ascending: true });
      if (!cancelled) { setMeetings((data ?? []) as CalendarEvent[]); setLoadingMeetings(false); }
    })();
    return () => { cancelled = true; };
  }, [supabase, row.id]);

  function handleSchedule() {
    // Find any existing meeting within +/- 14 days from now - warn before opening modal
    const now = Date.now();
    const window = 14 * 86_400_000;
    const upcoming = meetings.find(m => {
      const t = new Date(m.start_at).getTime();
      return t > now && (t - now) < window;
    });
    if (upcoming) { setConflictMeeting(upcoming); return; }
    setShowSchedule(true);
  }

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
              <Package size={20} style={{ color: 'var(--stc-red)' }} />
              {edit.company_name || 'Untitled lead'}
            </h2>
          </div>
          <button onClick={onClose} className="btn btn--icon"><X size={16} /></button>
        </div>
        <div className="drawer__body">
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

          {/* Scheduled meetings tied to this contact */}
          <div className="card" style={{ padding: 14 }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
              <div className="field__label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Calendar size={14} /> SCHEDULED MEETINGS
              </div>
              <button onClick={handleSchedule} className="btn btn--sm btn--primary"><CalendarPlus size={12} /> Schedule</button>
            </div>
            {loadingMeetings ? (
              <div className="row" style={{ gap: 6, color: 'var(--fg-3)', fontSize: 12 }}><Loader size={12} className="spin" /> Loading…</div>
            ) : meetings.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>No meetings scheduled with this contact yet.</div>
            ) : (
              <div className="col" style={{ gap: 6 }}>
                {meetings.map(m => {
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
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
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

        {conflictMeeting && (
          <div className="modal-bg" onClick={() => setConflictMeeting(null)} style={{ zIndex: 1100 }}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
              <div className="modal__head">
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertTriangle size={16} style={{ color: 'var(--stc-warning, #d4a017)' }} /> Existing meeting found
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
                <p style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>Schedule another anyway, or close this dialog to view the existing one?</p>
              </div>
              <div className="row" style={{ justifyContent: 'flex-end', padding: '0 16px 16px', gap: 8 }}>
                <button onClick={() => setConflictMeeting(null)} className="btn btn--ghost">View existing</button>
                <button onClick={() => { setConflictMeeting(null); setShowSchedule(true); }} className="btn btn--primary">Schedule anyway</button>
              </div>
            </div>
          </div>
        )}

        {showSchedule && (
          <ScheduleMeetingModal
            contact={edit}
            profile={profile}
            allProfiles={[]}
            onClose={() => {
              setShowSchedule(false);
              // Reload meetings after the modal closes (in case one was created)
              supabase.from('calendar_events').select('*').eq('contact_id', row.id).order('start_at', { ascending: true })
                .then(({ data }) => setMeetings((data ?? []) as CalendarEvent[]));
            }}
          />
        )}
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


// ===== New lead modal: checks user's accessible CRM contacts for matches before creating =====
function NewLeadModal({ currentListId, onCreateNew, onImport, onClose }: {
  currentListId: string;
  onCreateNew: (company: string, websiteUrl: string, side: 'trailer_sales' | 'maintenance', what: string | null) => void;
  onImport: (contact: CRMContact, side: 'trailer_sales' | 'maintenance', what: string | null) => void;
  onClose: () => void;
}) {
  const [side, setSide] = useState<'trailer_sales' | 'maintenance'>('trailer_sales');
  const [what, setWhat] = useState<string>('Maintenance');
  const supabase = useMemo(() => createClient(), []);
  const [company, setCompany] = useState('');
  const [website, setWebsite] = useState('');
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<Array<CRMContact & { list_name?: string | null }>>([]);
  const [searched, setSearched] = useState(false);

  function extractDomain(s: string): string {
    let v = s.trim().toLowerCase();
    if (!v) return '';
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    try { return new URL(v).hostname.replace(/^www\./i, ''); } catch { return ''; }
  }

  async function search() {
    if (!company.trim() && !website.trim()) return;
    setSearching(true);
    setSearched(false);
    const q = company.trim();
    const domain = extractDomain(website);
    // Search crm_contacts the user can see (RLS handles list visibility), excluding the current tracker list
    let query = supabase
      .from('crm_contacts')
      .select('*, crm_lists(name)')
      .neq('list_id', currentListId)
      .limit(20);
    if (q) query = query.ilike('company_name', `%${q}%`);
    const { data } = await query;
    let results = (data ?? []) as any[];
    // If website domain provided, also include rows whose links contain that domain
    if (domain) {
      const seen = new Set(results.map((r: any) => r.id));
      const { data: byUrl } = await supabase
        .from('crm_contacts')
        .select('*, crm_lists(name)')
        .neq('list_id', currentListId)
        .limit(20);
      for (const row of (byUrl ?? []) as any[]) {
        if (seen.has(row.id)) continue;
        const hasMatch = (row.links || []).some((l: any) => {
          if (!l?.url) return false;
          const d = extractDomain(l.url);
          return d && d === domain;
        });
        if (hasMatch) { results.push(row); seen.add(row.id); }
      }
    }
    setMatches(results.map(r => ({ ...r, list_name: r.crm_lists?.name ?? null })));
    setSearching(false);
    setSearched(true);
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
        <div className="modal__head">
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Plus size={16} style={{ color: 'var(--stc-red)' }} /> New lead
          </h3>
          <button onClick={onClose} className="btn btn--icon btn--sm"><X size={14} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field">
            <div className="field__label">What are you tracking?</div>
            <div className="side-picker">
              <button type="button" onClick={() => setSide('trailer_sales')}
                className={`side-picker__opt ${side === 'trailer_sales' ? 'is-active' : ''}`}>
                <Package size={14} /> <strong>Trailer Sales</strong>
                <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>Pursuing a deal on trailer / vehicle sales</span>
              </button>
              <button type="button" onClick={() => setSide('maintenance')}
                className={`side-picker__opt ${side === 'maintenance' ? 'is-active' : ''}`}>
                <Wrench size={14} /> <strong>Maintenance</strong>
                <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>Trukplan, MOT, servicing, repairs</span>
              </button>
            </div>
          </div>
          {side === 'maintenance' && (
            <Field label="What kind of maintenance work?">
              <select className="input" value={what} onChange={(e) => setWhat(e.target.value)}>
                <option>Maintenance</option>
                <option>Trukplan</option>
                <option>All Services</option>
                <option>Maintenance and MOT</option>
                <option>Maintenance and Trukplan</option>
                <option>Van Maintenance and Repair</option>
                <option>Accident Repair</option>
                <option>All Services and Parking</option>
                <option>MOT only</option>
              </select>
            </Field>
          )}
          <p style={{ margin: 0, color: 'var(--fg-2)', fontSize: 13 }}>
            We&apos;ll check the CRM first so you don&apos;t duplicate an existing record.
          </p>
          <Field label="Company name">
            <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Zenith Vehicles" autoFocus />
          </Field>
          <Field label="Website URL (optional, helps dedup)">
            <input className="input" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="customer.com or https://customer.com/" />
          </Field>
          <div className="row" style={{ gap: 8 }}>
            <button onClick={search} disabled={searching || (!company.trim() && !website.trim())} className="btn">
              {searching ? <Loader size={12} className="spin" /> : <Search size={12} />} Check CRM
            </button>
            <div className="toolbar__spacer" />
            <button onClick={() => onCreateNew(company, website, side, side === 'maintenance' ? what : null)} disabled={!company.trim()} className="btn btn--primary">
              <Plus size={12} /> Create new
            </button>
          </div>

          {searched && (
            matches.length === 0 ? (
              <div className="card" style={{ padding: 10, borderColor: 'var(--stc-success, #2da44e)' }}>
                <div style={{ fontSize: 12.5, color: 'var(--fg-1)' }}>
                  <strong style={{ color: 'var(--stc-success, #2da44e)' }}>✓ No existing record found</strong>
                  <div style={{ fontSize: 11.5, color: 'var(--fg-2)', marginTop: 4 }}>Safe to create new. Click &ldquo;Create new&rdquo; above.</div>
                </div>
              </div>
            ) : (
              <div className="card" style={{ padding: 10 }}>
                <div className="field__label" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--stc-warning, #d4a017)', marginBottom: 8 }}>
                  <AlertTriangle size={12} /> {matches.length} EXISTING RECORD{matches.length === 1 ? '' : 'S'} IN CRM
                </div>
                <div className="col" style={{ gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                  {matches.map(m => (
                    <div key={m.id} className="row" style={{ gap: 8, padding: 8, background: 'var(--bg-3)', borderRadius: 6 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{m.company_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                          {[m.contact_name, m.email].filter(Boolean).join(' · ')}
                          {m.list_name && <span className="mono" style={{ marginLeft: 6 }}>in &ldquo;{m.list_name}&rdquo;</span>}
                          {' · '}<span className={`pill pill--${m.status}`} style={{ fontSize: 10 }}>{m.status}</span>
                        </div>
                      </div>
                      <button onClick={() => onImport(m, side, side === 'maintenance' ? what : null)} className="btn btn--sm btn--primary"><LinkIcon size={11} /> Import</button>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 10 }}>
                  Import copies an existing CRM contact into your tracker. Click &ldquo;Create new&rdquo; to add a separate row anyway.
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}


// ===== Stock trailer picker (typeahead by STC No / chassis / make/model) =====
function StockTrailerPicker({ onPick, onClose }: { onPick: (t: StockTrailer | null) => void; onClose: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<StockTrailer[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const handle = setTimeout(async () => {
      setSearching(true);
      const like = `%${q.trim()}%`;
      const { data } = await supabase.from('stock_trailers')
        .select('id, stc_no, chassis_number, year, make, model, status, location, nbv, refurb_costs, refurb_costs_at_sale, category')
        .or(`stc_no.ilike.${like},chassis_number.ilike.${like},make.ilike.${like},model.ilike.${like}`)
        .limit(20);
      setResults((data ?? []) as StockTrailer[]);
      setSearching(false);
    }, 200);
    return () => clearTimeout(handle);
  }, [q, supabase]);

  return (
    <div className="modal-bg" onClick={onClose} style={{ zIndex: 1100 }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal__head">
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Truck size={16} style={{ color: 'var(--stc-red)' }} /> Link a stock trailer
          </h3>
          <button onClick={onClose} className="btn btn--icon btn--sm"><X size={14} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input className="input" autoFocus placeholder="Search by STC No, chassis, make, model…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="col" style={{ gap: 6, maxHeight: 340, overflowY: 'auto' }}>
            {searching && <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>Searching…</div>}
            {!searching && q.trim().length >= 2 && results.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>No matches</div>
            )}
            {results.map(t => (
              <button key={t.id} onClick={() => onPick(t)} className="btn" style={{ justifyContent: 'flex-start', textAlign: 'left', height: 'auto', padding: 10 }}>
                <Truck size={14} style={{ flexShrink: 0, color: 'var(--stc-red)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t.stc_no || t.chassis_number} · {t.year} {t.make} {t.model}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                    {t.category} · {t.status} {t.location && `· ${t.location}`}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== Mark-as-Sold confirm modal — preview commission before saving =====
function MarkAsSoldModal({ trailer, totalNbv, rate, onConfirm, onClose }: {
  trailer: StockTrailer; totalNbv: number; rate: number;
  onConfirm: (salePrice: number, dispatchDate: string | null) => void;
  onClose: () => void;
}) {
  const [salePrice, setSalePrice] = useState<string>('');
  const [dispatchDate, setDispatchDate] = useState<string>('');
  const sp = Number(salePrice) || 0;
  const profit = sp - totalNbv;
  const commission = profit * rate;
  return (
    <div className="modal-bg" onClick={onClose} style={{ zIndex: 1100 }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal__head">
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <PoundSterling size={16} style={{ color: 'var(--stc-red)' }} /> Mark as Sold
          </h3>
          <button onClick={onClose} className="btn btn--icon btn--sm"><X size={14} /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (sp > 0) onConfirm(sp, dispatchDate || null); }}
          style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--fg-2)' }}>
            Trailer <strong style={{ color: 'var(--fg-1)' }}>{trailer.stc_no || trailer.chassis_number}</strong> ({trailer.year} {trailer.make} {trailer.model})
          </div>
          <div className="card" style={{ padding: 10, background: 'var(--bg-3)' }}>
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: 'var(--fg-3)' }}>Total NBV (locked from stock)</span>
              <span className="tnum" style={{ fontWeight: 600 }}>£{totalNbv.toLocaleString()}</span>
            </div>
          </div>
          <div className="field">
            <div className="field__label">Sale price (£)</div>
            <input className="input" type="number" step="0.01" required autoFocus value={salePrice} onChange={(e) => setSalePrice(e.target.value)} />
          </div>
          <div className="field">
            <div className="field__label">Dispatch date (optional)</div>
            <input className="input" type="date" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)} />
          </div>
          {sp > 0 && (
            <div className="card" style={{ padding: 10, background: 'rgba(46,160,67,0.08)', borderColor: 'rgba(46,160,67,0.3)' }}>
              <div className="row" style={{ justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: 'var(--fg-3)' }}>Profit</span>
                <span className="tnum">£{profit.toLocaleString()}</span>
              </div>
              <div className="row" style={{ justifyContent: 'space-between', fontSize: 12, marginTop: 4 }}>
                <span style={{ color: 'var(--fg-3)' }}>Your commission ({(rate * 100).toFixed(0)}% of profit)</span>
                <span className="tnum" style={{ fontWeight: 600, color: '#5fb572' }}>£{commission.toLocaleString()}</span>
              </div>
            </div>
          )}
          <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
            This will mark <strong>{trailer.stc_no}</strong> as Sold on the global stock list (customer + sales rep + sale price + dispatch date all pushed). Your commission stays private to your tracker.
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={onClose} className="btn btn--ghost">Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={sp <= 0}>
              <PoundSterling size={14} /> Confirm sale
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


// ===== Right-click context menu for tracker rows =====
function TrackerContextMenu({ x, y, row, onView, onEditCell, onMarkSold, onMoveStatus, onDuplicate, onDelete }: {
  x: number; y: number; row: CRMContact;
  onView: () => void; onEditCell: () => void;
  onMarkSold: () => void;
  onMoveStatus: (s: ContactStatus) => void;
  onDuplicate: () => void; onDelete: () => void;
}) {
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

  const STATUSES: ContactStatus[] = ['lead','contacted','quoted','won','customer','lost'];

  return (
    <div ref={ref} className="ctx-menu" style={{ left: pos.left, top: pos.top }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <div className="ctx-menu__head">
        {row.company_name}
        {row.contact_name && <span className="mono" style={{ marginLeft: 6, color: 'var(--fg-4)' }}>· {row.contact_name}</span>}
      </div>
      <button onClick={onView}><Eye size={12} /> Open full view</button>
      <button onClick={onEditCell}><Edit2 size={12} /> Edit this cell</button>
      {row.side === 'trailer_sales' && row.status !== 'customer' && (
        <button onClick={onMarkSold}><PoundSterling size={12} /> Mark as Sold…</button>
      )}
      <hr />
      <div className="ctx-menu__head" style={{ marginTop: 4 }}>Move to status</div>
      {STATUSES.filter(s => s !== row.status).map(s => (
        <button key={s} onClick={() => onMoveStatus(s)}>
          <span className={`pill pill--${s}`} style={{ fontSize: 10 }}><span className="pill__dot" />{s}</span>
        </button>
      ))}
      <hr />
      <button onClick={onDuplicate}><Copy size={12} /> Duplicate</button>
      <button onClick={onDelete} style={{ color: 'var(--stc-red-300)' }}><Trash2 size={12} /> Delete</button>
    </div>
  );
}


// ===== My Commission tab — KPIs, monthly bars, per-sale table =====
function CommissionView({ rows }: { rows: CRMContact[] }) {
  // Only consider rows that actually have commission (closed deals)
  const sales = useMemo(() => rows.filter(r => Number(r.commission) > 0)
    .sort((a, b) => (b.dispatch_date || b.order_date || '').localeCompare(a.dispatch_date || a.order_date || '')), [rows]);

  const now = new Date();
  const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  const dKey = (r: CRMContact) => (r.dispatch_date || r.order_date || '').slice(0,7);
  const thisMonthKey = ym(now);
  const thisQuarter = Math.floor(now.getMonth() / 3);
  const thisYear = now.getFullYear();

  const thisMonth = sales.filter(r => dKey(r) === thisMonthKey).reduce((s, r) => s + Number(r.commission || 0), 0);
  const ytd = sales.filter(r => Number((r.dispatch_date || r.order_date || '').slice(0,4)) === thisYear).reduce((s, r) => s + Number(r.commission || 0), 0);
  const quarter = sales.filter(r => {
    const m = Number((r.dispatch_date || r.order_date || '').slice(5,7)) - 1;
    const y = Number((r.dispatch_date || r.order_date || '').slice(0,4));
    return y === thisYear && Math.floor(m / 3) === thisQuarter;
  }).reduce((s, r) => s + Number(r.commission || 0), 0);
  const allTime = sales.reduce((s, r) => s + Number(r.commission || 0), 0);
  const avgPerDeal = sales.length ? allTime / sales.length : 0;

  // Last 12 months breakdown for the bar chart
  const monthly = useMemo(() => {
    const months: { key: string; label: string; total: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: ym(d), label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }), total: 0 });
    }
    for (const r of sales) {
      const k = dKey(r);
      const m = months.find(x => x.key === k);
      if (m) m.total += Number(r.commission || 0);
    }
    return months;
  }, [sales, now]);
  const maxMonthly = Math.max(1, ...monthly.map(m => m.total));

  const QUARTER_LABEL = `Q${thisQuarter + 1} ${thisYear}`;

  return (
    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* KPI tiles */}
      <div className="stats-grid stats-grid--5">
        <KpiTile label="This month" value={fmtMoney(thisMonth)} sub={now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} accent="red" />
        <KpiTile label="This quarter" value={fmtMoney(quarter)} sub={QUARTER_LABEL} accent="warning" />
        <KpiTile label="Year to date" value={fmtMoney(ytd)} sub={String(thisYear)} accent="info" />
        <KpiTile label="All time" value={fmtMoney(allTime)} sub={`${sales.length} closed deal${sales.length === 1 ? '' : 's'}`} accent="success" />
        <KpiTile label="Avg / deal" value={fmtMoney(avgPerDeal)} sub="Across all closed deals" />
      </div>

      {/* Last 12 months bar chart */}
      <div className="card" style={{ padding: 16 }}>
        <div className="field__label" style={{ marginBottom: 12 }}>LAST 12 MONTHS</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 180, padding: '0 4px' }}>
          {monthly.map(m => {
            const h = Math.max(2, (m.total / maxMonthly) * 150);
            const isThisMonth = m.key === thisMonthKey;
            return (
              <div key={m.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div className="mono" style={{ fontSize: 10, color: 'var(--fg-3)', minHeight: 14 }}>
                  {m.total > 0 ? `£${(m.total/1000).toFixed(1)}k` : ''}
                </div>
                <div style={{
                  width: '100%', maxWidth: 40,
                  height: h,
                  background: isThisMonth ? 'var(--stc-red)' : 'rgba(91,141,239,0.5)',
                  borderRadius: '4px 4px 0 0',
                  transition: 'height .25s ease',
                }} />
                <div style={{ fontSize: 10.5, color: isThisMonth ? 'var(--stc-red)' : 'var(--fg-3)', fontWeight: isThisMonth ? 700 : 500 }}>
                  {m.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Per-sale list */}
      <div className="card">
        <div className="card__head"><h3 style={{ margin: 0 }}>Every closed deal · {sales.length}</h3></div>
        <div style={{ padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-3)', textAlign: 'left' }}>
                <th style={{ padding: 10 }}>Dispatch / Order</th>
                <th style={{ padding: 10 }}>Company</th>
                <th style={{ padding: 10 }}>Sale price</th>
                <th style={{ padding: 10 }}>Profit</th>
                <th style={{ padding: 10, color: 'var(--stc-red)' }}>Commission</th>
              </tr>
            </thead>
            <tbody>
              {sales.map(r => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="mono" style={{ padding: 10, fontSize: 11.5, color: 'var(--fg-3)' }}>
                    {(r.dispatch_date || r.order_date || '').slice(0,10) || '—'}
                  </td>
                  <td style={{ padding: 10 }}>{r.company_name}</td>
                  <td className="tnum" style={{ padding: 10 }}>{fmtMoney(r.sale_price)}</td>
                  <td className="tnum" style={{ padding: 10 }}>{fmtMoney(r.profit)}</td>
                  <td className="tnum" style={{ padding: 10, fontWeight: 600, color: 'var(--stc-red)' }}>{fmtMoney(r.commission)}</td>
                </tr>
              ))}
              {sales.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: 'var(--fg-3)' }}>
                  No closed deals yet. Commission rolls in here as you Mark-as-Sold from the tracker.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KpiTile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: 'red'|'success'|'warning'|'info' }) {
  return (
    <div className={`stat ${accent ? `stat--${accent}` : ''}`}>
      <div className="stat__bar" />
      <div className="stat__label">{label}</div>
      <div className="stat__value tnum">{value}</div>
      {sub && <div className="stat__sub">{sub}</div>}
    </div>
  );
}
