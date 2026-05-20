'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueSetterParams } from 'ag-grid-community';
import { Plus, Trash2, TrendingUp, ChevronRight, Loader, Search, Edit2, X, Calendar, DollarSign, Briefcase, CalendarPlus, AlertTriangle, Link as LinkIcon } from 'lucide-react';
import { ScheduleMeetingModal } from './CrmWorkspace';
import type { CalendarEvent } from '@/lib/types';
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

  const [showNewLead, setShowNewLead] = useState(false);

  async function createBlankLead(company: string, websiteUrl: string) {
    const today = new Date().toISOString().slice(0, 10);
    const links = websiteUrl.trim()
      ? [{ id: crypto.randomUUID(), label: 'Website', url: websiteUrl.trim(), kind: 'website' as const }]
      : [];
    const { data, error } = await supabase.from('crm_contacts').insert({
      list_id: list.id, company_name: company.trim() || 'New lead', source: 'Manual',
      status: 'lead', date_of_enquiry: today, links,
    }).select('*').single();
    if (error) { setMessage(error.message); return; }
    setRows(r => [data as CRMContact, ...r]);
    setShowNewLead(false);
    setEditingRow(data as CRMContact);
  }

  async function importFromCrm(sourceContact: CRMContact) {
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
            Only you see this list. {rows.length} row{rows.length === 1 ? '' : 's'} ·
            &nbsp;Pipeline est: <strong style={{ color: 'var(--fg-1)' }}>{fmtMoney(totalEstValue)}</strong> ·
            &nbsp;Customer revenue: <strong style={{ color: 'var(--fg-1)' }}>{fmtMoney(totalCustomerRevenue)}</strong> ·
            &nbsp;Commission: <strong style={{ color: 'var(--fg-1)' }}>{fmtMoney(totalCommission)}</strong>
          </div>
        </div>
        <button onClick={() => setShowNewLead(true)} className="btn btn--primary"><Plus size={14} /> New lead</button>
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
  onCreateNew: (company: string, websiteUrl: string) => void;
  onImport: (contact: CRMContact) => void;
  onClose: () => void;
}) {
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
            <button onClick={() => onCreateNew(company, website)} disabled={!company.trim()} className="btn btn--primary">
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
                      <button onClick={() => onImport(m)} className="btn btn--sm btn--primary"><LinkIcon size={11} /> Import</button>
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
