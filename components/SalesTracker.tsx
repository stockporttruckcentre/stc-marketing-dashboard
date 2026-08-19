'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueSetterParams } from 'ag-grid-community';
import { Plus, Trash2, TrendingUp, ChevronRight, Loader, Search, Edit2, X, Calendar, DollarSign, Briefcase, CalendarPlus, AlertTriangle, Link as LinkIcon, Wrench, PoundSterling, Truck, Eye, Copy, Package, Container, Upload } from 'lucide-react';
import { ScheduleMeetingModal } from './crm/ScheduleMeetingModal';
import type { CalendarEvent } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';
import { useDismissGuard } from '@/components/kit/useDismissGuard';
import { ImportDialog } from '@/components/crm/ImportDialog';
import { trackerFromCrm } from '@/lib/crm/tracker-operations';
import { SALES_TRACKER } from '@/lib/import/dictionary';
import type { CRMContact, ContactStatus, LeadAccount, LeadType, LeadWithAccount, Profile, StockTrailer } from '@/lib/types';

/**
 * One row of the tracker: the pitch, with the company's own details
 * flattened alongside it.
 *
 * Flattened rather than nested because the grid, the drawer and the
 * commission view all address fields by name, and a company's name is
 * something you edit in the same breath as the deal it belongs to. What
 * decides the difference is `ACCOUNT_FIELDS` below: those go to the
 * company record, everything else to the lead.
 */
type TrackerRow = LeadWithAccount & {
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  source: string | null;
  description: string | null;
  category: string | null;
  account_manager: string | null;
  vehicles: string | null;
};

/**
 * The fields that describe the company rather than the pitch.
 *
 * Editing a phone number on a tracker row now changes it for everybody,
 * because there is one Dawson and that is their phone number. Editing an
 * estimated value changes this pitch and no other.
 */
const ACCOUNT_FIELDS = new Set([
  'company_name', 'contact_name', 'email', 'phone', 'location',
  'source', 'description', 'category', 'account_manager', 'vehicles',
]);

function flatten(l: LeadWithAccount): TrackerRow {
  return {
    ...l,
    company_name:    l.account?.company_name ?? 'Unknown company',
    contact_name:    l.account?.contact_name ?? null,
    email:           l.account?.email ?? null,
    phone:           l.account?.phone ?? null,
    location:        l.account?.location ?? null,
    source:          (l.account as any)?.source ?? null,
    description:     (l.account as any)?.description ?? null,
    category:        (l.account as any)?.category ?? null,
    account_manager: (l.account as any)?.account_manager ?? null,
    vehicles:        (l.account as any)?.vehicles ?? null,
  };
}

const TYPE_LABEL: Record<LeadType, string> = {
  trailer_sales: 'Trailer sales',
  maintenance:   'Maintenance',
  rental:        'Rental & leasing',
};

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
  working: 'Active leads, chasing the deal',
  customer: 'Active customer, ongoing relationship',
  lost: 'Lost, no longer pursuing',
  commission: 'Your earned commission, summarised',
};

const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
function fmtMoney(v: number | null | undefined) { return v == null ? '' : GBP.format(Number(v)); }
function fmtDate(v: string | null | undefined) {
  if (!v) return '';
  try { return new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }); } catch { return v; }
}

export function SalesTracker({
  initialLeads, profile,
}: { initialLeads: LeadWithAccount[]; profile: Profile }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<TrackerRow[]>(() => initialLeads.map(flatten));
  const [side, setSide] = useState<LeadType>('trailer_sales');
  const [whatFilter, setWhatFilter] = useState<string | null>(null);
  const [tab, setTab] = useState<TrackerTab>('working');
  const [query, setQuery] = useState('');
  const [editingRow, setEditingRow] = useState<TrackerRow | null>(null);

  // ?contact=ID deep-link from the stock drawer's "View in tracker" button.
  // It names a company, and a company can now have several pitches open,
  // so it opens the one on the tab being looked at and otherwise the first.
  const sp = useSearchParams();
  useEffect(() => {
    const id = sp?.get('contact');
    if (!id) return;
    const mine = rows.filter(r => r.contact_id === id || r.id === id);
    const target = mine.find(r => r.type === side) ?? mine[0];
    if (target) {
      setEditingRow(target);
      setSide(target.type);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, rows]);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Counts of the CURRENT side only
  const sideRows = useMemo(() => rows.filter(r => (r.type ?? 'trailer_sales') === side), [rows, side]);
  const counts = useMemo(() => {
    const c = { all: sideRows.length, working: 0, customer: 0, lost: 0, commission: 0 } as Record<TrackerTab, number>;
    for (const r of sideRows) c[STATUS_TO_TAB[r.status]]++;
    // commission tab "count" = number of paid-out sales (rows with commission > 0)
    c.commission = sideRows.filter(r => Number(r.commission) > 0).length;
    return c;
  }, [sideRows]);
  const sideCounts = useMemo(() => ({
    trailer_sales: rows.filter(r => (r.type ?? 'trailer_sales') === 'trailer_sales').length,
    maintenance:   rows.filter(r => r.type === 'maintenance').length,
    rental:        rows.filter(r => r.type === 'rental').length,
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

  /**
   * One cell, and the field decides which record it belongs to.
   *
   * A phone number is the company's, so editing it here changes it
   * everywhere, which is the point of there being one Dawson. An
   * estimated value is this pitch's and touches nothing else.
   */
  const saveCell = useCallback((params: ValueSetterParams<TrackerRow>): boolean => {
    const field = params.colDef.field as string;
    if ((params.data as any)[field] === params.newValue) return false;
    (params.data as any)[field] = params.newValue;

    const toAccount = ACCOUNT_FIELDS.has(field);
    const table = toAccount ? 'crm_contacts' : 'crm_leads';
    const id    = toAccount ? params.data.contact_id : params.data.id;
    if (!id) { setMessage('That row has no record behind it to write to.'); return false; }

    supabase.from(table).update({ [field]: params.newValue }).eq('id', id)
      .then(({ error }) => { if (error) setMessage(error.message); });
    return true;
  }, [supabase]);

  const isCustomerTab = tab === 'customer';
  const isMaintenance = side === 'maintenance';

  const columnDefs = useMemo<ColDef<TrackerRow>[]>(() => {
    const commonStart: ColDef<TrackerRow>[] = [
      { field: 'date_of_enquiry', headerName: isMaintenance ? 'Last update' : 'Enquiry', width: 110,
        valueFormatter: (p) => fmtDate(p.value), editable: true, valueSetter: saveCell, cellEditor: 'agTextCellEditor' },
      { field: 'company_name', headerName: 'Company', flex: 1.3, minWidth: 160, editable: true, valueSetter: saveCell },
      { field: 'contact_name', headerName: 'Contact', flex: 1, minWidth: 130, editable: true, valueSetter: saveCell },
      { field: 'phone', headerName: 'Phone', width: 140, editable: true, valueSetter: saveCell },
      { field: 'email', headerName: 'Email', flex: 1.2, minWidth: 160, editable: true, valueSetter: saveCell },
    ];
    const salesMid: ColDef<TrackerRow>[] = [
      { field: 'new_or_used', headerName: 'New/Used', width: 110, editable: true, valueSetter: saveCell,
        cellEditor: 'agSelectCellEditor', cellEditorParams: { values: ['', 'New', 'Used', 'New/Used', 'Used/Refurb', 'Refurb'] } },
      { field: 'estimated_value', headerName: 'Est. value', width: 120, editable: true, valueSetter: saveCell,
        valueParser: p => p.newValue === '' ? null : Number(p.newValue),
        valueFormatter: p => fmtMoney(p.value), cellStyle: { textAlign: 'right' } },
      { field: 'source', headerName: 'Source', width: 140, editable: true, valueSetter: saveCell },
      { field: 'description', headerName: 'Description', flex: 1.2, minWidth: 150, editable: true, valueSetter: saveCell },
    ];
    const maintMid: ColDef<TrackerRow>[] = [
      { field: 'what', headerName: 'What', width: 150, editable: true, valueSetter: saveCell,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: ['', 'Maintenance', 'Trukplan', 'All Services', 'Maintenance and MOT', 'Maintenance and Trukplan', 'Van Maintenance and Repair', 'Accident Repair', 'All Services and Parking'] } },
      { field: 'category', headerName: 'Cat', width: 70, editable: true, valueSetter: saveCell,
        cellEditor: 'agSelectCellEditor', cellEditorParams: { values: ['', 'A', 'B', 'C'] },
        cellRenderer: (p: ICellRendererParams<TrackerRow, string>) => p.value
          ? <span className={`maint-cat maint-cat--${p.value.toLowerCase()}`}>{p.value}</span> : <span style={{ color: 'var(--fg-3)' }}>—</span> },
      { field: 'account_manager', headerName: 'Manager', width: 100, editable: true, valueSetter: saveCell },
      { field: 'source', headerName: 'Source', width: 130, editable: true, valueSetter: saveCell },
      { field: 'vehicles', headerName: 'Vehicles', flex: 1.4, minWidth: 180, editable: true, valueSetter: saveCell },
    ];
    const commonEnd: ColDef<TrackerRow>[] = [
      { field: 'requirement', headerName: 'Requirement', flex: 1.2, minWidth: 160, editable: true, valueSetter: saveCell },
      { field: 'action', headerName: 'Action', flex: 1.2, minWidth: 160, editable: true, valueSetter: saveCell },
      ...(isMaintenance ? [{ field: 'next_action' as keyof TrackerRow, headerName: 'Next action', flex: 1.2, minWidth: 160, editable: true, valueSetter: saveCell }] : []),
      { field: 'status', headerName: 'Status', width: 120, editable: true, valueSetter: saveCell,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: ['lead', 'contacted', 'quoted', 'won', 'customer', 'lost'] },
        cellRenderer: (p: ICellRendererParams<TrackerRow, ContactStatus>) => p.value
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
      cellRenderer: (p: ICellRendererParams<TrackerRow>) => (
        <div className="row" style={{ gap: 4 }}>
          <button onClick={() => setEditingRow(p.data!)} className="btn btn--icon btn--sm" title="Edit"><Edit2 size={12} /></button>
          {/* Removes the pitch, never the customer. Dropping a quote is
              not the same as saying you have never heard of them, and
              before leads existed those were the same button. */}
          <button onClick={async () => {
            if (!confirm(`Drop this ${TYPE_LABEL[p.data!.type].toLowerCase()} lead for "${p.data!.company_name}"?\n\nThe customer stays in the CRM.`)) return;
            const { error } = await supabase.from('crm_leads').delete().eq('id', p.data!.id);
            if (error) { setMessage(error.message); return; }
            setRows(r => r.filter(x => x.id !== p.data!.id));
          }} className="btn btn--icon btn--sm" style={{ color: 'var(--stc-red-300)' }} title="Drop this lead"><Trash2 size={12} /></button>
        </div>
      ),
    });
    return base;
  }, [saveCell, supabase, isCustomerTab]);

  const defaultColDef = useMemo<ColDef>(() => ({
    resizable: true, sortable: true, filter: true, floatingFilter: false,
  }), []);

  const [showNewLead, setShowNewLead] = useState(false);
  const [showImport, setShowImport] = useState(false);

  /**
   * Write the reviewed tracker rows.
   *
   * They land on whichever side is being looked at, because a tracker
   * import is somebody bringing in one of the two spreadsheets rather
   * than a mixture, and asking which side each row belongs to after they
   * have already reviewed every column would be a fourth step nobody
   * wants. Wrong guesses are one cell to change.
   */
  /** Read a lead back with its company attached, the way the page loads them. */
  async function readLead(id: string): Promise<TrackerRow | null> {
    const { data } = await supabase.from('crm_leads').select(`*, account:crm_contacts (
      id, company_name, contact_name, email, phone, location, relationship,
      source, description, category, account_manager, vehicles
    )`).eq('id', id).single();
    return data ? flatten(data as unknown as LeadWithAccount) : null;
  }

  /**
   * The company this pitch is to, found or created.
   *
   * A tracker never invents a customer quietly any more. If the name is
   * already in the CRM this returns that account, so a second quote to
   * Dawson attaches to the Dawson everybody else can see. If it is not,
   * the account is created IN THE CRM, on the shared pipeline, which is
   * the rule the business set: you cannot have a lead for a company that
   * does not exist as an account.
   */
  async function accountFor(companyName: string, websiteUrl = ''): Promise<string | null> {
    const name = companyName.trim();
    if (!name) { setMessage('A lead needs a company.'); return null; }

    const { data: found } = await supabase.from('crm_contacts')
      .select('id').ilike('company_name', name).limit(1).maybeSingle();
    if (found) return (found as { id: string }).id;

    const links = websiteUrl.trim()
      ? [{ id: crypto.randomUUID(), label: 'Website', url: websiteUrl.trim(), kind: 'website' as const }]
      : [];
    const { data: made, error } = await supabase.from('crm_contacts')
      .insert({ company_name: name, source: 'Manual', status: 'lead', links })
      .select('id').single();
    if (error || !made) { setMessage(error?.message ?? 'Could not create that account.'); return null; }

    // Onto the shared pipeline, so it is an account everybody can find
    // rather than something that exists only inside one tracker.
    const { data: pipeline } = await supabase.from('crm_lists')
      .select('id').eq('is_global', true).limit(1).maybeSingle();
    if (pipeline) {
      await supabase.from('crm_list_contacts')
        .insert({ list_id: (pipeline as { id: string }).id, contact_id: (made as { id: string }).id });
    }
    return (made as { id: string }).id;
  }

  /**
   * Write the reviewed tracker rows.
   *
   * A spreadsheet row is a pitch, so each one finds or creates its
   * company and then becomes a lead against it. Importing Dean's
   * maintenance sheet twice no longer produces two of every customer.
   *
   * They land on whichever side is being looked at, because a tracker
   * import is somebody bringing in one of the spreadsheets rather than a
   * mixture, and asking which type each row is after they have already
   * reviewed every column would be a step nobody wants. Wrong guesses
   * are one cell to change.
   */
  async function commitTrackerImport(records: Record<string, any>[]) {
    const made: TrackerRow[] = [];
    for (const r of records) {
      const contactId = await accountFor(String(r.company_name ?? ''));
      if (!contactId) continue;

      const patch: Record<string, any> = {};
      for (const [k, v] of Object.entries(r)) {
        if (k === 'company_name' || ACCOUNT_FIELDS.has(k)) continue;
        patch[k] = v;
      }
      const { data, error } = await supabase.from('crm_leads').insert({
        contact_id: contactId,
        owner_id: profile.id,
        created_by: profile.id,
        type: side,
        status: 'lead',
        last_activity_at: new Date().toISOString(),
        ...patch,
      }).select('id').single();
      if (error) return { inserted: made.length, error: error.message };

      const row = await readLead((data as { id: string }).id);
      if (row) made.push(row);
    }
    setRows(r => [...made, ...r]);
    setMessage(`Imported ${made.length} onto ${TYPE_LABEL[side].toLowerCase()}`);
    return { inserted: made.length };
  }

  /**
   * A new lead, against an account that exists.
   *
   * `contactId` is null only when the person typed a company the CRM has
   * never heard of, and then the account is created first. Either way a
   * lead is a pitch to somebody who is in the CRM by the time it exists.
   */
  async function createLead(
    contactId: string | null,
    company: string,
    websiteUrl: string,
    newSide: LeadType,
    what: string | null,
    ownerId: string,
  ) {
    const account = contactId ?? await accountFor(company, websiteUrl);
    if (!account) return;

    /* The same operation the command bar performs, rather than an insert
       of this screen's own. Two implementations of "start a lead" is how
       one of them forgets to carry the status across or quietly lets you
       raise one against a company that is not an account. */
    const done = await trackerFromCrm(supabase, {
      contacts: [account], side: newSide, what, owner: ownerId,
    });
    if (!done.ok) { setMessage(done.why); return; }
    if (!done.rowId) { setMessage('That lead was raised but did not come back.'); return; }

    const row = await readLead(done.rowId);
    setSide(newSide);
    setShowNewLead(false);
    if (!row) return;
    setRows(r => [row, ...r]);

    // Handed to somebody else, so it is on their tracker and not this one.
    if (ownerId !== profile.id) {
      setRows(r => r.filter(x => x.id !== row.id));
      setMessage(`Lead created and handed over. It is on their tracker now.`);
      return;
    }
    setEditingRow(row);
  }


  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-head__eyebrow">Sales · Personal tracker</div>
          <h1 className="page-head__title">
            <TrendingUp size={26} style={{ color: 'var(--stc-red)' }} />
            <span>{(profile?.full_name ?? 'My').split(' ')[0]}&rsquo;s leads<span style={{ color: 'var(--stc-red)' }}>.</span></span>
          </h1>
          <div className="page-head__sub">
            Your own and any shared with you. {sideRows.length} {TYPE_LABEL[side].toLowerCase()} lead{sideRows.length === 1 ? '' : 's'}
            {!isMaintenance && <> · Pipeline est: <strong style={{ color: 'var(--fg-1)' }}>{fmtMoney(totalEstValue)}</strong> · Customer revenue: <strong style={{ color: 'var(--fg-1)' }}>{fmtMoney(totalCustomerRevenue)}</strong> · Commission: <strong style={{ color: 'var(--fg-1)' }}>{fmtMoney(totalCommission)}</strong></>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowImport(true)} className="btn"><Upload size={14} /> Import</button>
          <button onClick={() => setShowNewLead(true)} className="btn btn--primary"><Plus size={14} /> New lead</button>
        </div>
      </div>

      {showImport && (
        <ImportDialog
          dict={SALES_TRACKER}
          listName={`your ${TYPE_LABEL[side].toLowerCase()} leads`}
          existing={rows.map((r) => ({ id: r.id, company_name: r.company_name, email: r.email }))}
          onCommit={commitTrackerImport}
          onClose={() => setShowImport(false)}
        />
      )}

      {/* The three kinds of work a lead can be for. Rental and leasing
          is here because a lead type is a value, not a column that has
          to be widened to hold a third thing. */}
      <div className="side-toggle">
        <button onClick={() => { setSide('trailer_sales'); setWhatFilter(null); }}
          className={`side-toggle__btn ${side === 'trailer_sales' ? 'is-active' : ''}`}>
          <Container size={14} /> <span>Trailer Sales</span>
          <span className="side-toggle__count">{sideCounts.trailer_sales}</span>
        </button>
        <button onClick={() => setSide('maintenance')}
          className={`side-toggle__btn ${side === 'maintenance' ? 'is-active' : ''}`}>
          <Wrench size={14} /> <span>Maintenance</span>
          <span className="side-toggle__count">{sideCounts.maintenance}</span>
        </button>
        <button onClick={() => { setSide('rental'); setWhatFilter(null); }}
          className={`side-toggle__btn ${side === 'rental' ? 'is-active' : ''}`}>
          <Truck size={14} /> <span>Rental &amp; Leasing</span>
          <span className="side-toggle__count">{sideCounts.rental}</span>
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
        <AgGridReact<TrackerRow>
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
          profile={profile}
          onCreate={createLead}
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
function LeadEditDrawer({ row, profile, onClose, onSave }: { row: TrackerRow; profile: Profile; onClose: () => void; onSave: (patch: Partial<TrackerRow>) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [edit, setEdit] = useState<TrackerRow>(row);
  const [saving, setSaving] = useState(false);
  const [meetings, setMeetings] = useState<CalendarEvent[]>([]);
  const [loadingMeetings, setLoadingMeetings] = useState(true);
  const [showSchedule, setShowSchedule] = useState(false);
  const [conflictMeeting, setConflictMeeting] = useState<CalendarEvent | null>(null);
  const tab = STATUS_TO_TAB[edit.status];

  // Every meeting with this company, whichever pitch prompted it. Read
  // by company rather than by lead: a visit to Dawson is a visit to
  // Dawson, and closing one quote should not hide it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingMeetings(true);
      const { data } = await supabase
        .from('calendar_events').select('*')
        .eq('contact_id', row.contact_id)
        .order('start_at', { ascending: true });
      if (!cancelled) { setMeetings((data ?? []) as CalendarEvent[]); setLoadingMeetings(false); }
    })();
    return () => { cancelled = true; };
  }, [supabase, row.contact_id]);

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

  /**
   * One field, written to whichever record owns it.
   *
   * The same split as the grid: a company's phone number belongs to the
   * company, this pitch's estimated value belongs to this pitch. Writing
   * both to `crm_contacts` was correct only while they were the same row.
   */
  async function saveField<K extends keyof TrackerRow>(field: K, value: TrackerRow[K]) {
    if (edit[field] === value) return;
    setEdit(e => ({ ...e, [field]: value }));
    setSaving(true);
    const toAccount = ACCOUNT_FIELDS.has(field as string);
    const target = toAccount ? row.contact_id : row.id;
    if (!target) { setSaving(false); alert('That row has no record behind it to write to.'); return; }
    const { error } = await supabase
      .from(toAccount ? 'crm_contacts' : 'crm_leads')
      .update({ [field]: value }).eq('id', target);
    setSaving(false);
    if (error) { alert(error.message); return; }
    onSave({ [field]: value } as any);
  }

  // Same guard as the other drawers: the shade is easy to clip on the
  // way past, and one click should not lose where you were.
  const dismiss = useDismissGuard(onClose);

  return (
    <div className="drawer-bg" {...dismiss.backdropProps}>
      {dismiss.hint}
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer__head">
          <div>
            <div className="page-head__eyebrow">Sales · {tab.toUpperCase()}</div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Container size={20} style={{ color: 'var(--stc-red)' }} />
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
            contact={{ id: edit.contact_id, company_name: edit.company_name }}
            profile={profile}
            allProfiles={[]}
            onClose={() => {
              setShowSchedule(false);
              // Reload meetings after the modal closes (in case one was created)
              supabase.from('calendar_events').select('*').eq('contact_id', row.contact_id).order('start_at', { ascending: true })
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


// ===== New lead: a pitch to a company that is already an account =====
/**
 * You cannot raise a lead for a company that is not in the CRM.
 *
 * That is the rule the business set and it is the whole reason the
 * duplicates existed: this used to offer "Create new" as a first class
 * button beside the search, so anybody in a hurry made a second Dawson
 * rather than picking the one already there. Now the search is the
 * route, and creating an account is what happens when the search comes
 * back empty, which is the only time it should.
 *
 * Delegation is here rather than after the fact because the meeting's
 * example was Dave taking a call while Dean is away: he wants it in
 * Dean's tracker as he writes it down, not in his own and moved later.
 */
function NewLeadModal({ profile, onCreate, onClose }: {
  profile: Profile;
  onCreate: (contactId: string | null, company: string, websiteUrl: string,
             type: LeadType, what: string | null, ownerId: string) => void;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [type, setType] = useState<LeadType>('trailer_sales');
  const [what, setWhat] = useState<string>('Maintenance');
  const [company, setCompany] = useState('');
  const [website, setWebsite] = useState('');
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<LeadAccount[]>([]);
  const [searched, setSearched] = useState(false);
  const [owner, setOwner] = useState(profile.id);
  const [people, setPeople] = useState<Profile[]>([]);

  useEffect(() => {
    supabase.from('profiles').select('*').order('full_name')
      .then(({ data }) => setPeople((data ?? []) as Profile[]));
  }, [supabase]);

  function extractDomain(s: string): string {
    let v = s.trim().toLowerCase();
    if (!v) return '';
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    try { return new URL(v).hostname.replace(/^www\./i, ''); } catch { return ''; }
  }

  /* Every account the person can see, not every account minus this
     tracker's list. A tracker is no longer a list, and a company being
     on somebody's tracker is not a reason to hide it: that is precisely
     the company you want to attach a second pitch to. */
  const search = useCallback(async () => {
    const q = company.trim();
    const domain = extractDomain(website);
    if (!q && !domain) return;
    setSearching(true);
    setSearched(false);

    const cols = 'id, company_name, contact_name, email, phone, location, relationship, links';
    let rows: any[] = [];
    if (q) {
      const { data } = await supabase.from('crm_contacts').select(cols)
        .ilike('company_name', `%${q}%`).order('company_name').limit(20);
      rows = (data ?? []) as any[];
    }
    if (domain) {
      const seen = new Set(rows.map(r => r.id));
      const { data } = await supabase.from('crm_contacts').select(cols).limit(200);
      for (const row of (data ?? []) as any[]) {
        if (seen.has(row.id)) continue;
        if ((row.links || []).some((l: any) => l?.url && extractDomain(l.url) === domain)) {
          rows.push(row); seen.add(row.id);
        }
      }
    }
    setMatches(rows as LeadAccount[]);
    setSearching(false);
    setSearched(true);
  }, [company, website, supabase]);

  // Search as they type, so the CRM is consulted without anybody
  // deciding to consult it.
  useEffect(() => {
    if (company.trim().length < 2) { setMatches([]); setSearched(false); return; }
    const handle = setTimeout(() => { void search(); }, 250);
    return () => clearTimeout(handle);
  }, [company, search]);

  const delegated = owner !== profile.id;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal__head">
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Plus size={16} style={{ color: 'var(--stc-red)' }} /> New lead
          </h3>
          <button onClick={onClose} className="btn btn--icon btn--sm"><X size={14} /></button>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field">
            <div className="field__label">What are you pitching for?</div>
            <div className="side-picker">
              <button type="button" onClick={() => setType('trailer_sales')}
                className={`side-picker__opt ${type === 'trailer_sales' ? 'is-active' : ''}`}>
                <Container size={14} /> <strong>Trailer Sales</strong>
                <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>Pursuing a deal on trailer or vehicle sales</span>
              </button>
              <button type="button" onClick={() => setType('maintenance')}
                className={`side-picker__opt ${type === 'maintenance' ? 'is-active' : ''}`}>
                <Wrench size={14} /> <strong>Maintenance</strong>
                <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>Trukplan, MOT, servicing, repairs</span>
              </button>
              <button type="button" onClick={() => setType('rental')}
                className={`side-picker__opt ${type === 'rental' ? 'is-active' : ''}`}>
                <Truck size={14} /> <strong>Rental &amp; Leasing</strong>
                <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>Hire, contract hire, leasing</span>
              </button>
            </div>
          </div>

          {type === 'maintenance' && (
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

          <Field label="Which customer?">
            <input className="input" value={company} onChange={(e) => setCompany(e.target.value)}
              placeholder="Start typing a company in the CRM" autoFocus />
          </Field>

          {company.trim().length >= 2 && (
            <div className="card" style={{ padding: 10 }}>
              {searching ? (
                <div className="row" style={{ gap: 6, fontSize: 12.5, color: 'var(--fg-2)' }}>
                  <Loader size={12} className="spin" /> Looking in the CRM
                </div>
              ) : matches.length > 0 ? (
                <>
                  <div className="field__label" style={{ marginBottom: 8 }}>
                    {matches.length} account{matches.length === 1 ? '' : 's'} in the CRM
                  </div>
                  <div className="col" style={{ gap: 6, maxHeight: 240, overflowY: 'auto' }}>
                    {matches.map(m => (
                      <div key={m.id} className="row" style={{ gap: 8, padding: 8, background: 'var(--bg-3)', borderRadius: 6 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{m.company_name}</div>
                          <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                            {[m.contact_name, m.email, m.location].filter(Boolean).join(' · ') || 'No contact details yet'}
                          </div>
                        </div>
                        <button onClick={() => onCreate(m.id, m.company_name, '', type, type === 'maintenance' ? what : null, owner)}
                          className="btn btn--sm btn--primary">
                          <LinkIcon size={11} /> Start lead
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              ) : searched ? (
                <div style={{ fontSize: 12.5 }}>
                  <strong>Not in the CRM.</strong>
                  <div style={{ fontSize: 11.5, color: 'var(--fg-2)', margin: '4px 0 10px' }}>
                    Creating the lead adds <strong>{company.trim()}</strong> to the CRM as a new account first,
                    so everybody can see them and the next quote attaches to the same record.
                  </div>
                  <Field label="Website (optional)">
                    <input className="input" value={website} onChange={(e) => setWebsite(e.target.value)}
                      placeholder="customer.com" />
                  </Field>
                  <button onClick={() => onCreate(null, company, website, type, type === 'maintenance' ? what : null, owner)}
                    className="btn btn--primary" style={{ marginTop: 8 }}>
                    <Plus size={12} /> Add to the CRM and start the lead
                  </button>
                </div>
              ) : null}
            </div>
          )}

          <Field label="Whose tracker does it go on?">
            <select className="input" value={owner} onChange={(e) => setOwner(e.target.value)}>
              {people.map(p => (
                <option key={p.id} value={p.id}>
                  {p.full_name || p.email}{p.id === profile.id ? ' (you)' : ''}
                </option>
              ))}
            </select>
          </Field>
          {delegated && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-2)' }}>
              This goes straight onto their tracker rather than yours.
            </p>
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

// ===== Mark-as-Sold confirm modal, previewing commission before saving =====
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
  x: number; y: number; row: TrackerRow;
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
      {row.type === 'trailer_sales' && row.status !== 'customer' && (
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


// ===== My Commission tab: KPIs, monthly bars, per-sale table =====
function CommissionView({ rows }: { rows: TrackerRow[] }) {
  // Only consider rows that actually have commission (closed deals)
  const sales = useMemo(() => rows.filter(r => Number(r.commission) > 0)
    .sort((a, b) => (b.dispatch_date || b.order_date || '').localeCompare(a.dispatch_date || a.order_date || '')), [rows]);

  const now = new Date();
  const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  const dKey = (r: TrackerRow) => (r.dispatch_date || r.order_date || '').slice(0,7);
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
