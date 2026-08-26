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
import {
  Alert, Badge, Button, Card, Chip, EmptyState, GridBadge, GridHint, IconButton,
  money, RecordHead, Row, SearchInput, SectionHead, StatStrip, TabShell, Tabs,
} from '@/components/kit/primitives';
import {
  Drawer, Field, Modal, OptionCard, Select, Split, TextArea, TextInput,
} from '@/components/kit/forms';
import { EdgeAwareCtxMenu, MenuHead, MenuItem, MenuRule } from '@/components/kit/menus';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/crm/status';
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
          ? <GridBadge tone={STATUS_TONE[p.value] ?? 'neutral'}>{STATUS_LABEL[p.value]}</GridBadge> : null },
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: '100%' }}>
          <IconButton label="Open the lead" onClick={() => setEditingRow(p.data!)}>
            <Edit2 size={13} />
          </IconButton>
          {/* Removes the pitch, never the customer. Dropping a quote is
              not the same as saying you have never heard of them, and
              before leads existed those were the same button. */}
          <IconButton label="Drop this lead" danger onClick={async () => {
            if (!confirm(`Drop this ${TYPE_LABEL[p.data!.type].toLowerCase()} lead for "${p.data!.company_name}"?\n\nThe customer stays in the CRM.`)) return;
            const { error } = await supabase.from('crm_leads').delete().eq('id', p.data!.id);
            if (error) { setMessage(error.message); return; }
            setRows(r => r.filter(x => x.id !== p.data!.id));
          }}>
            <Trash2 size={13} />
          </IconButton>
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


  const firstName = (profile?.full_name ?? 'My').split(' ')[0];

  return (
    <TabShell>

      {/* Same header shape the CRM pipeline uses: icon tile, Panton
          title, what qualifies it, one line of context, and the two
          actions that are always available. */}
      <RecordHead
        icon={<TrendingUp size={20} />}
        title={`${firstName}’s leads`}
        badges={<>
          <Badge tone="neutral" dot>{TYPE_LABEL[side]}</Badge>
          {tab !== 'all' && <Badge tone="neutral">{TAB_LABEL[tab]}</Badge>}
        </>}
        sub={<>
          Your own and any shared with you.
          {' '}{sideRows.length} {TYPE_LABEL[side].toLowerCase()} lead{sideRows.length === 1 ? '' : 's'}
          {filtered.length !== sideRows.length ? `, ${filtered.length} showing.` : '.'}
        </>}
        actions={<>
          <Button size="sm" variant="secondary" onClick={() => setShowImport(true)}>
            <Upload size={13} /> Import
          </Button>
          <Button size="sm" variant="primary" onClick={() => setShowNewLead(true)}>
            <Plus size={13} /> New lead
          </Button>
        </>}
      />

      {/* The pipeline at a glance, in the kit's stat strip. These were
          bold figures crammed into the sub-line, where three sums ran
          together and none of them could be read at a glance. No colour
          on any value: rule one. */}
      <StatStrip items={isMaintenance ? [
        { label: 'Total', value: counts.all, note: 'on this side' },
        { label: 'Working', value: counts.working, note: 'jobs in hand' },
        { label: 'Customers', value: counts.customer, note: 'ongoing' },
        { label: 'Lost', value: counts.lost, note: 'not pursuing' },
        { label: 'Kinds', value: whatValues.length, note: 'of work' },
      ] : [
        { label: 'Total', value: counts.all, note: 'on this side' },
        { label: 'Working', value: counts.working, note: 'chasing the deal' },
        { label: 'Pipeline', value: fmtMoney(totalEstValue) || '—', note: 'estimated' },
        { label: 'Revenue', value: fmtMoney(totalCustomerRevenue) || '—', note: `${counts.customer} won` },
        { label: 'Commission', value: fmtMoney(totalCommission) || '—', note: 'yours' },
      ]} />

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
          to be widened to hold a third thing.

          Underline tabs, from the kit's navigation page: this is the
          tab's own navigation, and the chips below it are filters
          within whichever one is open. Two rows of identical looking
          pills could not say which was which. */}
      <Tabs
        value={side}
        onChange={(v) => { setSide(v); if (v !== 'maintenance') setWhatFilter(null); }}
        tabs={[
          { key: 'trailer_sales' as LeadType, label: 'Trailer sales', count: sideCounts.trailer_sales },
          { key: 'maintenance' as LeadType, label: 'Maintenance', count: sideCounts.maintenance },
          { key: 'rental' as LeadType, label: 'Rental & leasing', count: sideCounts.rental },
        ]}
      />

      {/* One toolbar, like the CRM's. Status filters, the kind of work
          where there is one to pick, and a search, all on a line. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap',
        padding: '10px 14px', borderRadius: 'var(--r-md)',
        background: 'var(--surface)', border: '1px solid var(--border)',
      }}>
        {(['working', 'customer', 'lost', 'all', 'commission'] as TrackerTab[]).map(t => (
          <Chip key={t} active={tab === t} count={counts[t]} title={TAB_HINT[t]}
            onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
          </Chip>
        ))}

        {isMaintenance && whatValues.length > 0 && (
          <>
            <span style={{ width: 1, height: 18, background: 'var(--border)' }} />
            <Chip active={whatFilter === null} onClick={() => setWhatFilter(null)}>All work</Chip>
            {whatValues.map(w => (
              <Chip key={w} active={whatFilter === w}
                onClick={() => setWhatFilter(w === whatFilter ? null : w)}>{w}</Chip>
            ))}
          </>
        )}

        {(query || tab !== 'working' || whatFilter) && (
          <button onClick={() => { setQuery(''); setTab('working'); setWhatFilter(null); }} style={{
            background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
            color: 'var(--accent)', fontFamily: 'var(--inter)', fontSize: 12, fontWeight: 600,
            textDecoration: 'underline', textUnderlineOffset: 3,
          }}>Clear</button>
        )}

        <span style={{ flex: 1 }} />

        <div style={{ width: 260, maxWidth: '100%' }}>
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search company, contact, requirement"
            icon={<Search size={14} />}
          />
        </div>
      </div>

      {message && <Alert tone="info">{message}</Alert>}

      {tab === 'commission' ? (
        <div style={{ flex: 1, minHeight: 260, overflowY: 'auto' }}>
          <CommissionView rows={sideRows} />
        </div>
      ) : (
      <div className="kit-grid ag-theme-quartz" style={{ flex: 1, minHeight: 260 }}>
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

      <GridHint>
        Double click a row to open it. A lead belongs to a customer in the CRM,
        so deleting one leaves the customer where it is.
      </GridHint>

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
    </TabShell>
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
    <Drawer
      eyebrow={`Sales · ${TAB_LABEL[tab]}`}
      title={edit.company_name || 'Untitled lead'}
      icon={<Container size={18} />}
      onClose={onClose}
      backdropProps={dismiss.backdropProps as Record<string, unknown>}
      hint={dismiss.hint}
      footer={<>
        <span style={{ flex: 1 }} />
        {saving && <Loader size={14} className="spin" />}
        <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
      </>}
    >
          <Split>
            <Field label="Contact">
              <TextInput value={edit.contact_name ?? ''} onChange={(v) => setEdit(s => ({ ...s, contact_name: v }))} onCommit={(v) => saveField('contact_name', v)} />
            </Field>
            <Field label="Company">
              <TextInput value={edit.company_name ?? ''} onChange={(v) => setEdit(s => ({ ...s, company_name: v }))} onCommit={(v) => saveField('company_name', v)} />
            </Field>
          </Split>
          <Split>
            <Field label="Phone">
              <TextInput value={edit.phone ?? ''} onChange={(v) => setEdit(s => ({ ...s, phone: v }))} onCommit={(v) => saveField('phone', v)} />
            </Field>
            <Field label="Email">
              <TextInput value={edit.email ?? ''} onChange={(v) => setEdit(s => ({ ...s, email: v }))} onCommit={(v) => saveField('email', v)} />
            </Field>
          </Split>
          <Split>
            <Field label="Date of enquiry">
              <TextInput type="date" value={edit.date_of_enquiry ?? ''} onChange={(v) => saveField('date_of_enquiry', v || null)} />
            </Field>
            <Field label="New / Used">
              <Select value={edit.new_or_used ?? ''} onChange={(v) => saveField('new_or_used', v || null)}>
                <option value="">—</option>
                <option>New</option><option>Used</option><option>New/Used</option><option>Used/Refurb</option><option>Refurb</option>
              </Select>
            </Field>
          </Split>
          <Split>
            <Field label="Source">
              <TextInput placeholder="LinkedIn, Prospect call, Website enquiry, Walk-in" value={edit.source ?? ''} onChange={(v) => setEdit(s => ({ ...s, source: v }))} onCommit={(v) => saveField('source', v || '')} />
            </Field>
            <Field label="Estimated sales value">
              <TextInput type="number" value={edit.estimated_value == null ? '' : String(edit.estimated_value)} onChange={(v) => saveField('estimated_value', v === '' ? null : Number(v))} />
            </Field>
          </Split>
          <Field label="Description">
            <TextInput placeholder="4.7m curtain, PSK flats, drawbar" value={edit.description ?? ''} onChange={(v) => setEdit(s => ({ ...s, description: v }))} onCommit={(v) => saveField('description', v || null)} />
          </Field>
          <Field label="Requirement">
            <TextArea rows={2} value={edit.requirement ?? ''} onChange={(v) => setEdit(s => ({ ...s, requirement: v }))} onCommit={(v) => saveField('requirement', v || null)} />
          </Field>
          <Field label="Action / next step">
            <TextArea rows={2} value={edit.action ?? ''} onChange={(v) => setEdit(s => ({ ...s, action: v }))} onCommit={(v) => saveField('action', v || null)} />
          </Field>
          <Field label="Status">
            <Select value={edit.status} onChange={(v) => saveField('status', v as ContactStatus)}>
              <option value="lead">Lead</option>
              <option value="contacted">Contacted</option>
              <option value="quoted">Quoted</option>
              <option value="won">Won (just closed)</option>
              <option value="customer">Customer (active)</option>
              <option value="lost">Lost</option>
            </Select>
          </Field>

          {/* Every meeting with this company, whichever pitch prompted it.
              Read by company rather than by lead: a visit to Dawson is a
              visit to Dawson, and closing one quote should not hide it. */}
          <Card padded={false}>
            <SectionHead
              title="Scheduled meetings"
              action={
                <Button size="sm" variant="secondary" onClick={handleSchedule}>
                  <CalendarPlus size={12} /> Schedule
                </Button>
              }
            />
            <div style={{ padding: '10px 14px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {loadingMeetings ? (
                <div style={{ display: 'flex', gap: 7, alignItems: 'center', color: 'var(--text-subtle)', fontSize: 12.5 }}>
                  <Loader size={12} className="spin" /> Loading
                </div>
              ) : meetings.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>
                  Nothing booked with this customer yet.
                </div>
              ) : meetings.map((m) => {
                const date = new Date(m.start_at);
                const isPast = date.getTime() < Date.now();
                return (
                  <div key={m.id} style={{
                    display: 'flex', alignItems: 'center', gap: 9,
                    padding: '7px 9px', borderRadius: 'var(--r)',
                    background: 'var(--surface-sunken)', border: '1px solid var(--border)',
                    opacity: isPast ? 0.6 : 1,
                  }}>
                    <Calendar size={14} style={{
                      color: isPast ? 'var(--text-subtle)' : 'var(--accent)', flexShrink: 0,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{m.title}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
                        {date.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    {isPast && <Badge tone="neutral">Past</Badge>}
                  </div>
                );
              })}
            </div>
          </Card>

          <Field label="Latest update / notes">
            <TextArea rows={3} value={edit.notes ?? ''}
              onChange={(v) => setEdit(s => ({ ...s, notes: v }))}
              onCommit={(v) => saveField('notes', v || null)} />
          </Field>

          {/* Only once there is a sale to describe. */}
          {(edit.status === 'customer' || edit.status === 'won') && (
            <Card padded={false}>
              <SectionHead title="Closing details" hint="What the sale was worth" />
              <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Split>
                  <Field label="Order date">
                    <TextInput type="date" value={edit.order_date ?? ''} onChange={(v) => saveField('order_date', v || null)} />
                  </Field>
                  <Field label="Dispatch date">
                    <TextInput type="date" value={edit.dispatch_date ?? ''} onChange={(v) => saveField('dispatch_date', v || null)} />
                  </Field>
                </Split>
                <Split>
                  <Field label="Sale price (£)">
                    <TextInput type="number" value={edit.sale_price == null ? '' : String(edit.sale_price)} onChange={(v) => saveField('sale_price', v === '' ? null : Number(v))} />
                  </Field>
                  <Field label="Profit (£)">
                    <TextInput type="number" value={edit.profit == null ? '' : String(edit.profit)} onChange={(v) => saveField('profit', v === '' ? null : Number(v))} />
                  </Field>
                </Split>
                <Split>
                  <Field label="Profit rate" hint="0.15 is 15%">
                    <TextInput type="number" value={edit.profit_pct == null ? '' : String(edit.profit_pct)} onChange={(v) => saveField('profit_pct', v === '' ? null : Number(v))} />
                  </Field>
                  <Field label="Commission (£)">
                    <TextInput type="number" value={edit.commission == null ? '' : String(edit.commission)} onChange={(v) => saveField('commission', v === '' ? null : Number(v))} />
                  </Field>
                </Split>
              </div>
            </Card>
          )}

          {conflictMeeting && (
          <Modal
            title="There is already a meeting booked"
            description={`With ${edit.company_name} in the next fortnight.`}
            width={460}
            onClose={() => setConflictMeeting(null)}
            footer={<>
              <Button size="sm" variant="ghost" onClick={() => setConflictMeeting(null)}>View the existing one</Button>
              <Button size="sm" variant="primary"
                onClick={() => { setConflictMeeting(null); setShowSchedule(true); }}>Book another anyway</Button>
            </>}
          >
            <Card>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{conflictMeeting.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4 }}>
                {new Date(conflictMeeting.start_at).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
              </div>
            </Card>
          </Modal>
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
    </Drawer>
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
    <Modal
      title="New lead"
      description="A lead belongs to a customer in the CRM. Find them, or add them here."
      width={560}
      onClose={onClose}
      footer={<>
        {delegated && (
          <span style={{ flex: 1, fontSize: 12, color: 'var(--text-subtle)' }}>
            This goes onto their tracker rather than yours.
          </span>
        )}
        <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
      </>}
    >
      <Field label="What are you pitching for?">
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <OptionCard
            selected={type === 'trailer_sales'}
            onSelect={() => setType('trailer_sales')}
            icon={<Container size={14} />}
            title="Trailer sales"
            description="A deal on trailers or vehicles"
          />
          <OptionCard
            selected={type === 'maintenance'}
            onSelect={() => setType('maintenance')}
            icon={<Wrench size={14} />}
            title="Maintenance"
            description="Trukplan, MOT, servicing, repairs"
          />
          <OptionCard
            selected={type === 'rental'}
            onSelect={() => setType('rental')}
            icon={<Truck size={14} />}
            title="Rental & leasing"
            description="Hire, contract hire, leasing"
          />
        </div>
      </Field>

      {type === 'maintenance' && (
        <Field label="What kind of maintenance work?">
          <Select value={what} onChange={setWhat}>
            <option>Maintenance</option>
            <option>Trukplan</option>
            <option>All Services</option>
            <option>Maintenance and MOT</option>
            <option>Maintenance and Trukplan</option>
            <option>Van Maintenance and Repair</option>
            <option>Accident Repair</option>
            <option>All Services and Parking</option>
            <option>MOT only</option>
          </Select>
        </Field>
      )}

      <Field label="Which customer?" hint="Search as you type. The CRM is the only way in.">
        <TextInput value={company} onChange={setCompany}
          placeholder="Start typing a company in the CRM" />
      </Field>

      {company.trim().length >= 2 && (
        <Card padded={false}>
          {searching ? (
            <div style={{ display: 'flex', gap: 7, alignItems: 'center', padding: '12px 14px', fontSize: 12.5, color: 'var(--text-muted)' }}>
              <Loader size={12} className="spin" /> Looking in the CRM
            </div>
          ) : matches.length > 0 ? (
            <>
              <SectionHead title={`${matches.length} in the CRM`} hint="Pick the one you mean" />
              <div style={{ padding: '8px 10px 10px', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
                {matches.map((m) => (
                  <div key={m.id} style={{
                    display: 'flex', alignItems: 'center', gap: 9,
                    padding: '8px 10px', borderRadius: 'var(--r)',
                    background: 'var(--surface-sunken)', border: '1px solid var(--border)',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{m.company_name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
                        {[m.contact_name, m.email, m.location].filter(Boolean).join(' · ') || 'No contact details yet'}
                      </div>
                    </div>
                    <Button size="sm" variant="primary"
                      onClick={() => onCreate(m.id, m.company_name, '', type, type === 'maintenance' ? what : null, owner)}>
                      <LinkIcon size={11} /> Start lead
                    </Button>
                  </div>
                ))}
              </div>
            </>
          ) : searched ? (
            <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Alert tone="info">
                <span>
                  <strong style={{ color: 'var(--text)' }}>{company.trim()}</strong> is not in the CRM.
                  Starting the lead adds them as an account first, so everybody can find them
                  and the next quote attaches to the same record.
                </span>
              </Alert>
              <Field label="Website" hint="Optional, and used to spot the same firm later">
                <TextInput value={website} onChange={setWebsite} placeholder="customer.com" />
              </Field>
              <div>
                <Button size="sm" variant="primary"
                  onClick={() => onCreate(null, company, website, type, type === 'maintenance' ? what : null, owner)}>
                  <Plus size={12} /> Add to the CRM and start the lead
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      )}

      <Field label="Whose tracker does it go on?"
        hint="Anybody can raise a lead and hand it to somebody else.">
        <Select value={owner} onChange={setOwner}>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name || p.email}{p.id === profile.id ? ' (you)' : ''}
            </option>
          ))}
        </Select>
      </Field>
    </Modal>
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
    <Modal
      title="Link a stock trailer"
      description="Search by stock number, chassis, make or model."
      width={560}
      onClose={onClose}
      footer={<Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>}
    >
      <SearchInput value={q} onChange={setQ}
        placeholder="STC number, chassis, make, model" icon={<Search size={14} />} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto' }}>
        {searching && (
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5, color: 'var(--text-subtle)' }}>
            <Loader size={12} className="spin" /> Searching
          </div>
        )}
        {!searching && q.trim().length >= 2 && results.length === 0 && (
          <div style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>
            Nothing in stock matches that.
          </div>
        )}
        {results.map((t) => (
          <button key={t.id} onClick={() => onPick(t)} style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
            padding: '9px 11px', borderRadius: 'var(--r)',
            border: '1px solid var(--border)', background: 'var(--surface-sunken)',
            color: 'var(--text)', cursor: 'pointer', fontFamily: 'var(--inter)',
          }}>
            <Truck size={14} style={{ flexShrink: 0, color: 'var(--accent)' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {t.stc_no || t.chassis_number} · {t.year} {t.make} {t.model}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
                {[t.category, t.status, t.location].filter(Boolean).join(' · ')}
              </div>
            </div>
          </button>
        ))}
      </div>
    </Modal>
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
  const unit = trailer.stc_no || trailer.chassis_number;

  return (
    <Modal
      title="Mark as sold"
      description={`${unit} · ${[trailer.year, trailer.make, trailer.model].filter(Boolean).join(' ')}`}
      width={480}
      onClose={onClose}
      footer={<>
        <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="accent" disabled={sp <= 0}
          onClick={() => { if (sp > 0) onConfirm(sp, dispatchDate || null); }}>
          <PoundSterling size={13} /> Confirm the sale
        </Button>
      </>}
    >
      <Row>
        <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text-muted)' }}>
          Total book value, locked from stock
        </span>
        <span className="tnum" style={{ fontWeight: 600, color: 'var(--text)' }}>
          {money(totalNbv)}
        </span>
      </Row>

      <Split>
        <Field label="Sale price (£)">
          <TextInput type="number" value={salePrice} onChange={setSalePrice} />
        </Field>
        <Field label="Dispatch date" hint="Optional">
          <TextInput type="date" value={dispatchDate} onChange={setDispatchDate} />
        </Field>
      </Split>

      {sp > 0 && (
        <Card padded={false}>
          <SectionHead title="What this earns" />
          <div style={{ padding: '10px 14px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
              <span style={{ color: 'var(--text-muted)' }}>Profit</span>
              <span className="tnum" style={{ color: 'var(--text)' }}>{money(profit)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
              <span style={{ color: 'var(--text-muted)' }}>
                Your commission, {(rate * 100).toFixed(0)}% of profit
              </span>
              <span className="tnum" style={{ fontWeight: 600, color: 'var(--text)' }}>
                {money(commission)}
              </span>
            </div>
          </div>
        </Card>
      )}

      <Alert tone="warning">
        This marks {unit} sold on the stock list everybody reads: the customer, the
        rep, the price and the dispatch date all go with it. Your commission stays
        on your own tracker.
      </Alert>
    </Modal>
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
  const STATUSES: ContactStatus[] = ['lead', 'contacted', 'quoted', 'won', 'customer', 'lost'];

  return (
    <EdgeAwareCtxMenu x={x} y={y}>
      <MenuHead>
        {row.company_name}{row.contact_name ? ` · ${row.contact_name}` : ''}
      </MenuHead>
      <MenuItem icon={<Eye size={13} />} label="Open the lead" onClick={onView} />
      <MenuItem icon={<Edit2 size={13} />} label="Edit this cell" onClick={onEditCell} />
      {row.type === 'trailer_sales' && row.status !== 'customer' && (
        <MenuItem icon={<PoundSterling size={13} />} label="Mark as sold" onClick={onMarkSold} />
      )}
      <MenuRule />
      <MenuHead>Move to</MenuHead>
      {STATUSES.filter((st) => st !== row.status).map((st) => (
        <MenuItem key={st} label={<Badge tone={STATUS_TONE[st]} dot>{STATUS_LABEL[st]}</Badge>}
          onClick={() => onMoveStatus(st)} />
      ))}
      <MenuRule />
      <MenuItem icon={<Copy size={13} />} label="Duplicate the pitch" onClick={onDuplicate} />
      <MenuItem icon={<Trash2 size={13} />} label="Delete the lead" onClick={onDelete} danger />
    </EdgeAwareCtxMenu>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* The same stat strip the pipeline uses. These were five coloured
          tiles, each with its own accent bar, which is rule one broken
          four times: nothing on the screen was more important than
          anything else, so nothing read as important at all. */}
      <StatStrip items={[
        { label: 'This month', value: fmtMoney(thisMonth) || '—',
          note: now.toLocaleDateString('en-GB', { month: 'long' }) },
        { label: 'This quarter', value: fmtMoney(quarter) || '—', note: QUARTER_LABEL },
        { label: 'Year to date', value: fmtMoney(ytd) || '—', note: String(thisYear) },
        { label: 'All time', value: fmtMoney(allTime) || '—',
          note: `${sales.length} closed` },
        { label: 'Average', value: fmtMoney(avgPerDeal) || '—', note: 'per deal' },
      ]} />

      {/* Twelve months, drawn from the kit's chart palette. Navy carries
          the series and the current month is the one bar in red: the
          series carrying the message, which is the only thing red is
          for on a chart. */}
      <Card padded={false}>
        <SectionHead title="Last twelve months" hint="Commission earned" />
        <div style={{ padding: '14px 16px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 180 }}>
            {monthly.map(m => {
              const h = Math.max(2, (m.total / maxMonthly) * 148);
              const isThisMonth = m.key === thisMonthKey;
              return (
                <div key={m.key} style={{
                  flex: 1, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 5, minWidth: 0,
                }}>
                  <span style={{
                    fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
                    fontVariantNumeric: 'tabular-nums', minHeight: 14,
                    color: isThisMonth ? 'var(--accent)' : 'var(--text-subtle)',
                  }}>
                    {m.total > 0 ? `${(m.total / 1000).toFixed(1)}k` : ''}
                  </span>
                  <div style={{
                    width: '100%', maxWidth: 40, height: h,
                    background: isThisMonth ? 'var(--accent)' : 'var(--chart-1, var(--primary))',
                    opacity: isThisMonth ? 1 : 0.75,
                    borderRadius: 'var(--r-sm) var(--r-sm) 0 0',
                  }} />
                  <span style={{
                    fontSize: 10.5, letterSpacing: '0.02em',
                    color: isThisMonth ? 'var(--text)' : 'var(--text-subtle)',
                    fontWeight: isThisMonth ? 700 : 500,
                  }}>{m.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      <Card padded={false}>
        <SectionHead title="Every closed deal" hint={`${sales.length} in all`} />
        {sales.length === 0 ? (
          <div style={{ padding: '10px 16px 16px' }}>
            <EmptyState
              what="commission"
              why="Nothing has been marked sold on this tracker yet."
            />
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Dispatched', 'Customer', 'Sale price', 'Profit', 'Commission'].map((h, i) => (
                    <th key={h} style={{
                      padding: '9px 14px', textAlign: i > 1 ? 'right' : 'left',
                      background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
                      fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 11,
                      letterSpacing: '0.13em', textTransform: 'uppercase', color: 'var(--text-subtle)',
                      whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sales.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '9px 14px', color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {fmtDate(r.dispatch_date || r.order_date) || '—'}
                    </td>
                    <td style={{ padding: '9px 14px', color: 'var(--text)' }}>{r.company_name}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.sale_price)}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.profit)}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--text)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.commission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
