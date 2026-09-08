'use client';

import { useRouter } from 'next/navigation';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueSetterParams } from 'ag-grid-community';
import { Plus, Trash2, TrendingUp, ChevronRight, Loader, Search, Edit2, X, Calendar, DollarSign, Briefcase, CalendarPlus, AlertTriangle, Link as LinkIcon, Wrench, PoundSterling, Truck, Eye, Copy, Package, Container, Upload, ShieldCheck, Users, ChevronDown, History, BadgeCheck,
} from 'lucide-react';
import { ScheduleMeetingModal } from './crm/ScheduleMeetingModal';
import { CustomerValue } from './crm/CustomerValue';
import type { CalendarEvent } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';
import { useDismissGuard } from '@/components/kit/useDismissGuard';
import {
  Alert, Badge, Button, Card, Chip, EmptyState, GridBadge, GridHint, IconButton,
  money, PanelHead, RecordHead, Row, SearchInput, StatStrip, TabShell, Tabs,
} from '@/components/kit/primitives';
import {
  Drawer, Field, Modal, OptionCard, Select, Split, TextArea, TextInput,
} from '@/components/kit/forms';
import { EdgeAwareCtxMenu, MenuHead, MenuItem, MenuRule } from '@/components/kit/menus';
import { hasAnAccount, nameOfLead } from '@/lib/crm/lead-identity';
import { applyOrder, readOrder, writeOrder } from '@/lib/ui/order';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/crm/status';
import { fieldsFor } from '@/lib/crm/lead-fields';
import { convertToCustomer, relationshipOf, winsAProspect } from '@/lib/crm/conversion';
import {
  MAINTENANCE_WHAT, WORK_KINDS, WORK_KIND_HINT, WORK_KIND_LABEL, workKindOf, type WorkKind,
} from '@/lib/crm/work-kind';
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
    /* Three states, not two: an account, no account with a name, and
       nothing at all. Only the last is genuinely unknown. See
       `lib/crm/lead-identity.ts` for the row this used to get wrong. */
    company_name:    nameOfLead(l),
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

/* The three divisions as the application declares them, which is the
   order anybody who has never dragged one sees. A fourth added here
   appears at the END of somebody's saved order rather than vanishing
   from it: see `applyOrder`. */
const SIDES: LeadType[] = ['trailer_sales', 'maintenance', 'rental'];
const SIDE_ORDER = 'tracker-divisions';

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
  initialLeads, profile, colleagues = [], viewing = null,
  refused = false, unknownOwner = false, canViewOthers = false,
}: {
  initialLeads: LeadWithAccount[];
  profile: Profile;
  /** Everybody the picker can offer. Empty for anybody who cannot use it. */
  colleagues?: Profile[];
  /** Whose tracker is open, when it is not your own. */
  viewing?: Profile | null;
  /** `?owner=` was given by somebody not allowed to use it. */
  refused?: boolean;
  /** `?owner=` named nobody. */
  unknownOwner?: boolean;
  canViewOthers?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [rows, setRows] = useState<TrackerRow[]>(() => initialLeads.map(flatten));
  const [side, setSide] = useState<LeadType>('trailer_sales');

  /* Somebody else's tracker is read through this screen, not edited
     through it. An administrator opening Dean's to see where a deal has
     got to has no business typing into his grid by accident, and the
     one thing worse than not being able to edit is editing a row you
     did not realise was somebody else's. Changes go where they always
     went: open the lead from the CRM record, which names the owner. */
  const readOnly = viewing != null;

  const [whatFilter, setWhatFilter] = useState<WorkKind | null>(null);
  const [tab, setTab] = useState<TrackerTab>('working');
  const [query, setQuery] = useState('');
  const [editingRow, setEditingRow] = useState<TrackerRow | null>(null);

  /* Two deep links into this screen, and both open a drawer.

     ?contact=ID names a company, from the stock drawer's "View in
     tracker" button. A company can have several pitches open, so it
     opens the one on the tab being looked at and otherwise the first.

     ?lead=ID names one pitch, from the CRM record and from the customer
     value block on this drawer. That link existed and did nothing: the
     CRM record has offered an Open button against every lead since the
     lead entity went in, and nothing here has ever read the parameter,
     so it landed on the tracker with no drawer and no explanation.

     A lead that is not on this tracker is the case worth handling
     rather than ignoring. The page only loads pitches somebody owns or
     that are shared with them, so a link to a colleague's lead is a
     link to a row that is not here, and doing nothing looks exactly
     like a broken button. It says so instead. */
  /* WHICH DIVISION IS ALREADY DECIDED.

     A deep link naming a lead decides it, and so does a click on a tab.
     Recorded so that the saved order arriving a frame later (below)
     does not overrule either of them and drop somebody on Maintenance
     while the drawer they asked for is a trailer sale. */
  const chosen = useRef(false);
  const pickSide = useCallback((s: LeadType) => { chosen.current = true; setSide(s); }, []);

  const sp = useSearchParams();
  useEffect(() => {
    const contact = sp?.get('contact');
    if (contact) {
      const mine = rows.filter(r => r.contact_id === contact || r.id === contact);
      const target = mine.find(r => r.type === side) ?? mine[0];
      if (target) { setEditingRow(target); pickSide(target.type); }
      return;
    }

    const lead = sp?.get('lead');
    if (!lead) return;

    const target = rows.find(r => r.id === lead);
    if (target) {
      setEditingRow(target);
      pickSide(target.type ?? 'trailer_sales');
      /* The tab as well as the side, or a won pitch opens behind the
         Working tab and the grid underneath looks empty. */
      setTab(STATUS_TO_TAB[target.status] ?? 'all');
      return;
    }

    /* Only once the rows have actually arrived. On the first render
       they are the server's, so an empty list here means empty, but
       saying so before anything loaded would flash a warning on every
       deep link. */
    if (rows.length > 0) {
      setMessage(
        'That lead is not on your tracker. It belongs to somebody else, or it was not shared with you. '
        + 'Open the customer in the CRM to see it.',
      );
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
  /* Does a row survive everything except the kind-of-work filter.
     Pulled out so the chips can be counted against the same rules the
     grid uses, which is the whole of what stops a chip claiming rows
     that are not there. */
  const passesExceptWork = useCallback((r: TrackerRow) => {
    if (tab !== 'all' && STATUS_TO_TAB[r.status] !== tab) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return ([r.company_name, r.contact_name, r.email, r.phone, r.description, r.requirement, r.action, r.what, r.vehicles]
      .filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [tab, query]);

  /* THE ORDER OF THE THREE DIVISIONS.

     From the business: "make it so people can re-order them by drag and
     it saves forever device-wide."

     Read after the first paint rather than during it. This component
     renders on the server as well, and `localStorage` does not exist
     there, so reading it in a `useState` initialiser is a hydration
     mismatch: the server sends the declared order, the browser paints a
     different one, and React throws away the tree it was given. So the
     first paint is always the declared order and the saved one arrives
     a frame later, which nobody sees and nothing breaks.

     ---- AND THE FIRST ONE IS THE ONE THAT OPENS ----

     From the business:

       You changed it so we can drag maintenance/trailersales/rental tab
       headers around on the tracker but it's still defaulting your
       primary tab that opens first as the trailer sales one. It should
       be whichever is first in your list, so Maintenance for dean
       currently.

     Dragging a tab to the front said what it was for and then did not
     do it. `side` was initialised to `trailer_sales` and nothing ever
     reconsidered, so the order decided where the tabs sat and not where
     you landed, which is the only part of it anybody feels every
     morning.

     Applied here rather than in the initialiser for the same hydration
     reason: the server has no idea what this machine remembers. */
  const [order, setOrder] = useState<string[] | null>(null);
  useEffect(() => {
    const saved = readOrder(SIDE_ORDER);
    setOrder(saved);
    if (chosen.current) return;
    const first = applyOrder(SIDES.map((k) => ({ key: k })), saved)[0]?.key as LeadType | undefined;
    if (first) setSide(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sideTabs = useMemo(
    () => applyOrder(SIDES.map((s) => ({
      key: s, label: TYPE_LABEL[s], count: sideCounts[s],
    })), order),
    [order, sideCounts],
  );

  /* A drop moves where you land tomorrow as well as where the tab sits,
     which is the whole point of the complaint above. It does not move
     you now: somebody dragging Maintenance to the front while reading a
     trailer sale is arranging their tabs, not asking to be taken
     somewhere else. */
  const reorderSides = useCallback((keys: LeadType[]) => {
    setOrder(keys);
    writeOrder(SIDE_ORDER, keys);
  }, []);

  /* The kinds of work on the maintenance side, each with the number of
     rows it would actually show.

     ---- Five chips, not thirty ----

     From the business:

       There are too many filters on Maintenance in the sales tracker,
       things like maintenance/brake tests and maintenance/refurb mean
       the same thing really.

     This grouped on the text of `what`, folded only for case, which is
     the right answer to "what distinct values are there" and the wrong
     answer to "what kind of work is this". `what` came off a spreadsheet
     where people wrote whatever described the job, so one kind of work
     arrived spelled four ways and got four chips.

     `workKindOf` decides which of five a job belongs to, and the rule
     lives in `lib/crm/work-kind.ts` where it can be read and checked.
     The raw text is untouched and still shows in the grid and the
     drawer: this decides the chip, not the record.

     What survives from the old version, because both were right: a chip
     is counted against everything except the work filter itself, so the
     number on it is the number of rows it would show, and a chip with
     nothing behind it is not drawn at all. A filter that empties the
     grid and does not say why reads as a broken screen. */
  const whatChips = useMemo(() => {
    if (side !== 'maintenance') return [];

    const counts = new Map<WorkKind, number>();
    for (const r of sideRows) {
      const kind = workKindOf(r.what);
      if (passesExceptWork(r)) counts.set(kind, (counts.get(kind) ?? 0) + 1);
      else if (!counts.has(kind)) counts.set(kind, 0);
    }

    return WORK_KINDS
      .map((kind) => ({ key: kind, label: WORK_KIND_LABEL[kind], hint: WORK_KIND_HINT[kind], count: counts.get(kind) ?? 0 }))
      /* Zero means this filter would empty the grid. The one exception
         is the filter somebody has already picked: hiding that would
         leave them looking at nothing with no way to see why or undo
         it. */
      .filter((c) => c.count > 0 || c.key === whatFilter);
  }, [side, sideRows, passesExceptWork, whatFilter]);

  const filtered = useMemo(() => sideRows.filter((r) => {
    if (!passesExceptWork(r)) return false;
    if (side === 'maintenance' && whatFilter && workKindOf(r.what) !== whatFilter) return false;
    return true;
  }), [sideRows, side, whatFilter, passesExceptWork]);

  const totalEstValue = useMemo(() =>
    sideRows.filter(r => STATUS_TO_TAB[r.status] === 'working').reduce((sum, r) => sum + (Number(r.estimated_value) || 0), 0),
    [sideRows]);
  const totalCustomerRevenue = useMemo(() =>
    sideRows.filter(r => STATUS_TO_TAB[r.status] === 'customer').reduce((sum, r) => sum + (Number(r.sale_price) || 0), 0),
    [sideRows]);
  const totalCommission = useMemo(() =>
    sideRows.filter(r => STATUS_TO_TAB[r.status] === 'customer').reduce((sum, r) => sum + (Number(r.commission) || 0), 0),
    [sideRows]);

  /* The lead somebody has just won, waiting on an answer about the
     customer behind it. See `lib/crm/conversion.ts`. */
  const [convert, setConvert] = useState<TrackerRow | null>(null);

  /**
   * Ask, if this write has just won something for a prospect.
   *
   * Read from the database rather than from the row in front of us: the
   * tracker carries a copy of a few account fields that is as old as the
   * page, and offering to convert a firm somebody else converted an hour
   * ago is the version of this that makes people distrust the prompt.
   */
  const maybeConvert = useCallback(async (row: TrackerRow, before: string, after: string) => {
    if (!row.contact_id) return;
    if (after !== 'won' || before === 'won') return;
    const rel = await relationshipOf(supabase, row.contact_id);
    if (winsAProspect(before, after, rel)) setConvert(row);
  }, [supabase]);

  /**
   * One cell, and the field decides which record it belongs to.
   *
   * A phone number is the company's, so editing it here changes it
   * everywhere, which is the point of there being one Dawson. An
   * estimated value is this pitch's and touches nothing else.
   */
  const saveCell = useCallback((params: ValueSetterParams<TrackerRow>): boolean => {
    const field = params.colDef.field as string;
    const before = (params.data as any)[field];
    if (before === params.newValue) return false;
    (params.data as any)[field] = params.newValue;

    const toAccount = ACCOUNT_FIELDS.has(field);
    const table = toAccount ? 'crm_contacts' : 'crm_leads';
    const id    = toAccount ? params.data.contact_id : params.data.id;
    if (!id) { setMessage('That row has no record behind it to write to.'); return false; }

    supabase.from(table).update({ [field]: params.newValue }).eq('id', id)
      .then(({ error }) => { if (error) setMessage(error.message); });

    /* THE ROW YOU EDITED IS THE ROW THAT MOVES.

       A company field written from a lead row goes to `crm_contacts`,
       so the trigger that keeps `crm_leads.last_activity_at` honest
       never sees it, and correcting a phone number here would leave the
       lead reading as untouched. Stamped from this side rather than
       cascaded in the database, because a cascade from the account
       would mark all four of Dawson's open pitches as worked on when
       only this one was in front of anybody. */
    if (toAccount) {
      const now = new Date().toISOString();
      (params.data as any).last_activity_at = now;
      supabase.from('crm_leads').update({ last_activity_at: now }).eq('id', params.data.id)
        .then(({ error }) => { if (error) setMessage(error.message); });
    }

    if (field === 'status') void maybeConvert(params.data, before, String(params.newValue));
    return true;
  }, [supabase, maybeConvert]);

  const isCustomerTab = tab === 'customer';
  const isMaintenance = side === 'maintenance';

  const columnDefs = useMemo<ColDef<TrackerRow>[]>(() => {
    const words = fieldsFor(side);
    const commonStart: ColDef<TrackerRow>[] = [
      { field: 'date_of_enquiry', headerName: 'Enquiry', width: 100,
        valueFormatter: (p) => fmtDate(p.value), editable: true, valueSetter: saveCell, cellEditor: 'agTextCellEditor' },
      /* LAST UPDATED, MEANING IT.

         The maintenance side printed the heading "Last update" above
         `date_of_enquiry`, which is the day the enquiry arrived and
         never moves again. So a lead worked for a month with nine notes
         on it read as last touched the day it was raised, which is the
         complaint. Two fixes, and this is the visible half: the heading
         goes back on the enquiry date, and the real column is here.

         Never editable. It is evidence of work rather than a field, and
         a date somebody can type is not evidence of anything. It is
         written by `crm_leads_touch_activity`, migration 096. */
      { field: 'last_activity_at', headerName: 'Last updated', width: 115, editable: false,
        valueFormatter: (p) => fmtDate(p.value),
        cellStyle: { color: 'var(--text-muted)' } },
      { field: 'company_name', headerName: 'Company', flex: 1.3, minWidth: 160, editable: true, valueSetter: saveCell },
      { field: 'contact_name', headerName: 'Contact', flex: 1, minWidth: 130, editable: true, valueSetter: saveCell },
      { field: 'phone', headerName: 'Phone', width: 140, editable: true, valueSetter: saveCell },
      { field: 'email', headerName: 'Email', flex: 1.2, minWidth: 160, editable: true, valueSetter: saveCell },
    ];
    /* THE MIDDLE OF THE GRID IS WHAT THIS DIVISION SELLS.

       Trailer sales asks new or used and describes a specification.
       Maintenance asks what kind of work and lists the fleet. Rental had
       neither: it fell through to the trailer sales columns, so a hire
       enquiry was asked whether the hire was new or used. The words
       come from `lib/crm/lead-fields.ts`, once, so the grid, the drawer
       and the new lead modal cannot drift apart. */
    const salesMid: ColDef<TrackerRow>[] = [
      { field: 'what', headerName: 'What', flex: 1, minWidth: 140, editable: true, valueSetter: saveCell },
      { field: 'new_or_used', headerName: 'New/Used', width: 110, editable: true, valueSetter: saveCell,
        cellEditor: 'agSelectCellEditor', cellEditorParams: { values: ['', 'New', 'Used', 'New/Used', 'Used/Refurb', 'Refurb'] } },
      { field: 'estimated_value', headerName: 'Est. value', width: 120, editable: true, valueSetter: saveCell,
        valueParser: p => p.newValue === '' ? null : Number(p.newValue),
        valueFormatter: p => fmtMoney(p.value), cellStyle: { textAlign: 'right' } },
      { field: 'source', headerName: 'Source', width: 140, editable: true, valueSetter: saveCell },
      { field: 'description', headerName: words.description.label, flex: 1.2, minWidth: 150, editable: true, valueSetter: saveCell },
    ];
    const rentalMid: ColDef<TrackerRow>[] = [
      { field: 'what', headerName: 'Hire', width: 150, editable: true, valueSetter: saveCell,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: ['', ...(words.what.options ?? [])] } },
      { field: 'estimated_value', headerName: 'Est. value', width: 120, editable: true, valueSetter: saveCell,
        valueParser: p => p.newValue === '' ? null : Number(p.newValue),
        valueFormatter: p => fmtMoney(p.value), cellStyle: { textAlign: 'right' } },
      { field: 'source', headerName: 'Source', width: 130, editable: true, valueSetter: saveCell },
      { field: 'vehicles', headerName: 'Units', flex: 1.2, minWidth: 150, editable: true, valueSetter: saveCell },
      { field: 'description', headerName: words.description.label, flex: 1.2, minWidth: 150, editable: true, valueSetter: saveCell },
    ];
    const maintMid: ColDef<TrackerRow>[] = [
      /* The editor offers the seven words a NEW record can use, from
         `MAINTENANCE_WHAT`. Anything already written stays exactly as it
         was typed: `agSelectCellEditor` shows the current value even
         when it is not on the list, and the chips group it either way. */
      { field: 'what', headerName: 'What', width: 160, editable: true, valueSetter: saveCell,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: ['', ...(words.what.options ?? [])] } },
      { field: 'estimated_value', headerName: 'Est. value', width: 120, editable: true, valueSetter: saveCell,
        valueParser: p => p.newValue === '' ? null : Number(p.newValue),
        valueFormatter: p => fmtMoney(p.value), cellStyle: { textAlign: 'right' } },
      { field: 'category', headerName: 'Cat', width: 70, editable: true, valueSetter: saveCell,
        cellEditor: 'agSelectCellEditor', cellEditorParams: { values: ['', 'A', 'B', 'C'] },
        cellRenderer: (p: ICellRendererParams<TrackerRow, string>) => p.value
          ? <GridBadge tone="neutral">{p.value}</GridBadge>
          : <span style={{ color: 'var(--text-subtle)' }}>—</span> },
      { field: 'account_manager', headerName: 'Manager', width: 100, editable: true, valueSetter: saveCell },
      { field: 'source', headerName: 'Source', width: 130, editable: true, valueSetter: saveCell },
      { field: 'vehicles', headerName: 'Vehicles', flex: 1.4, minWidth: 180, editable: true, valueSetter: saveCell },
    ];
    const commonEnd: ColDef<TrackerRow>[] = [
      { field: 'requirement', headerName: words.requirementLabel, flex: 1.2, minWidth: 160, editable: true, valueSetter: saveCell },
      { field: 'action', headerName: 'Action', flex: 1.2, minWidth: 160, editable: true, valueSetter: saveCell },
      ...(side === 'maintenance' ? [{ field: 'next_action' as keyof TrackerRow, headerName: 'Next action', flex: 1.2, minWidth: 160, editable: true, valueSetter: saveCell }] : []),
      { field: 'status', headerName: 'Status', width: 120, editable: true, valueSetter: saveCell,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: ['lead', 'contacted', 'quoted', 'won', 'customer', 'lost'] },
        cellRenderer: (p: ICellRendererParams<TrackerRow, ContactStatus>) => p.value
          ? <GridBadge tone={STATUS_TONE[p.value] ?? 'neutral'}>{STATUS_LABEL[p.value]}</GridBadge> : null },
      { field: 'notes', headerName: 'Latest update', flex: 1.5, minWidth: 200, editable: true, valueSetter: saveCell },
    ];
    const mid = side === 'maintenance' ? maintMid : side === 'rental' ? rentalMid : salesMid;
    const base = [...commonStart, ...mid, ...commonEnd];
    if (isCustomerTab) {
      /* The closing figures, in this division's words. What a trailer
         sale calls an order date a contract calls the day it was agreed,
         and it is the same column: see the header of
         `lib/crm/lead-fields.ts` for why one column and three names
         rather than three columns.

         Placed by NAME rather than at index 7. It was at index 7, which
         was the end of the middle block until a column was added in
         front of it, and an index into a list built four lines earlier
         is a number that goes wrong silently. */
      const closing: ColDef<TrackerRow>[] = [
        { field: 'order_date',    headerName: words.closing.orderDate,    width: 115, valueFormatter: p => fmtDate(p.value), editable: true, valueSetter: saveCell },
        { field: 'dispatch_date', headerName: words.closing.dispatchDate, width: 115, valueFormatter: p => fmtDate(p.value), editable: true, valueSetter: saveCell },
        { field: 'sale_price',    headerName: words.closing.salePrice.replace(' (£)', ''), width: 115, valueFormatter: p => fmtMoney(p.value), cellStyle: { textAlign: 'right' },
          valueParser: p => p.newValue === '' ? null : Number(p.newValue), editable: true, valueSetter: saveCell },
        ...(words.closing.profit ? [
          { field: 'profit' as keyof TrackerRow, headerName: 'Profit', width: 100, valueFormatter: (p: any) => fmtMoney(p.value), cellStyle: { textAlign: 'right' },
            valueParser: (p: any) => p.newValue === '' ? null : Number(p.newValue), editable: true, valueSetter: saveCell },
          { field: 'profit_pct' as keyof TrackerRow, headerName: 'Profit %', width: 90, valueFormatter: (p: any) => p.value != null ? `${(Number(p.value) * 100).toFixed(1)}%` : '', cellStyle: { textAlign: 'right' },
            valueParser: (p: any) => p.newValue === '' ? null : Number(p.newValue), editable: true, valueSetter: saveCell },
        ] : []),
        { field: 'commission',    headerName: 'Commission',    width: 110, valueFormatter: p => fmtMoney(p.value), cellStyle: { textAlign: 'right' },
          valueParser: p => p.newValue === '' ? null : Number(p.newValue), editable: true, valueSetter: saveCell },
      ];
      const at = base.findIndex((c) => c.field === 'requirement');
      base.splice(at === -1 ? base.length : at, 0, ...closing);
    }
    /* Somebody else's tracker is read, not typed into. Applied to every
       column at once rather than remembered on each of the thirty
       above, because a column added later would inherit the wrong
       answer and nothing would say so. */
    if (readOnly) for (const c of base) c.editable = false;

    base.push({
      headerName: '', width: readOnly ? 40 : 56, pinned: 'right', sortable: false, filter: false, editable: false,
      cellRenderer: (p: ICellRendererParams<TrackerRow>) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: '100%' }}>
          <IconButton label="Open the lead" onClick={() => setEditingRow(p.data!)}>
            {readOnly ? <Eye size={13} /> : <Edit2 size={13} />}
          </IconButton>
          {/* Removes the pitch, never the customer. Dropping a quote is
              not the same as saying you have never heard of them, and
              before leads existed those were the same button. */}
          {!readOnly && (
          <IconButton label="Drop this lead" danger onClick={async () => {
            if (!confirm(`Drop this ${TYPE_LABEL[p.data!.type].toLowerCase()} lead for "${p.data!.company_name}"?\n\nThe customer stays in the CRM.`)) return;
            const { error } = await supabase.from('crm_leads').delete().eq('id', p.data!.id);
            if (error) { setMessage(error.message); return; }
            setRows(r => r.filter(x => x.id !== p.data!.id));
          }}>
            <Trash2 size={13} />
          </IconButton>
          )}
        </div>
      ),
    });
    return base;
    /* `isMaintenance` was missing from this list, and it is read seven
       times in the body above. The memo therefore kept the columns it
       built for whichever division was open when it last ran, and only
       rebuilt them when the status tab changed, which is why clicking
       Maintenance left the trailer sales columns on screen until you
       clicked a filter inside it.

       It read as a rendering glitch and was worse than that. Both sides
       have a column the other does not, and one of them is called
       "What" on maintenance while trailer sales has its own What field
       for the type of unit. So the stale header sat above the right
       data with the wrong name on it, on a screen people read figures
       off.

       `side` rather than `isMaintenance` now, because there are three
       sets of columns and not two: rental used to be given trailer
       sales' and was asked whether a hire was new or used. */
  }, [saveCell, supabase, isCustomerTab, side, readOnly]);

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
    pickSide(newSide);
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
  const whose = viewing ? (viewing.full_name || viewing.email || 'a colleague') : firstName;
  const whoseFirst = whose.split(' ')[0];

  return (
    <TabShell>

      {/* Same header shape the CRM pipeline uses: icon tile, Panton
          title, what qualifies it, one line of context, and the two
          actions that are always available.

          WHOSE TRACKER, IN THE TITLE. Not in a corner and not only in
          the picker: a manager who forgets they are reading Dean's and
          starts working it has done something they cannot see they did.
          The eye badge is the second half of the same sentence. */}
      <RecordHead
        icon={viewing ? <Eye size={20} /> : <TrendingUp size={20} />}
        title={`${whoseFirst}’s leads`}
        badges={<>
          {viewing && <Badge tone="accent" dot>Viewing</Badge>}
          <Badge tone="neutral" dot>{TYPE_LABEL[side]}</Badge>
          {tab !== 'all' && <Badge tone="neutral">{TAB_LABEL[tab]}</Badge>}
        </>}
        sub={<>
          {viewing
            ? `${whose}’s own leads and any shared with them. Read only.`
            : 'Your own and any shared with you.'}
          {' '}{sideRows.length} {TYPE_LABEL[side].toLowerCase()} lead{sideRows.length === 1 ? '' : 's'}
          {filtered.length !== sideRows.length ? `, ${filtered.length} showing.` : '.'}
        </>}
        actions={<>
          {canViewOthers && (
            <WhoseTracker me={profile} viewing={viewing} colleagues={colleagues} />
          )}
          {!viewing && <>
            <Button size="sm" variant="secondary" onClick={() => setShowImport(true)}>
              <Upload size={13} /> Import
            </Button>
            <Button size="sm" variant="primary" onClick={() => setShowNewLead(true)}>
              <Plus size={13} /> New lead
            </Button>
          </>}
        </>}
      />

      {/* Both refusals, said in the words of what happened. A screen
          that quietly shows your own tracker when you asked for
          somebody else's is a screen you stop trusting. */}
      {refused && (
        <Alert tone="warning">
          You asked for a colleague&rsquo;s tracker. Reading somebody else&rsquo;s is an
          administrator&rsquo;s, so this is yours. Ask an administrator if you need that access.
        </Alert>
      )}
      {unknownOwner && (
        <Alert tone="warning">
          That link names somebody who is no longer on the system, so this is your own tracker.
        </Alert>
      )}

      {/* The pipeline at a glance, in the kit's stat strip. These were
          bold figures crammed into the sub-line, where three sums ran
          together and none of them could be read at a glance. No colour
          on any value: rule one. */}
      {/* THE MAINTENANCE SIDE COUNTS MONEY TOO.

          From the business: "We have estimated sales value on each
          maintenance lead but the value isn't showing at the top of the
          maintenance tab and it should."

          It was true and it had a cause. This strip was written when the
          maintenance sheet was a list of jobs rather than a pipeline, so
          it counted rows in four states and then filled the fifth slot
          with how many kinds of work were on it, which is a fact about
          the spreadsheet rather than about the business. The estimated
          value was on every row and totalled nowhere.

          Same five slots, same order, same figures as trailer sales
          wherever they mean the same thing: a maintenance rep and a
          trailer rep now read the same strip. */}
      <StatStrip items={isMaintenance ? [
        { label: 'Total', value: counts.all, note: 'on this side' },
        { label: 'Working', value: counts.working, note: 'jobs in hand' },
        { label: 'Pipeline', value: fmtMoney(totalEstValue) || '—', note: 'estimated' },
        { label: 'Won', value: fmtMoney(totalCustomerRevenue) || '—', note: `${counts.customer} on contract` },
        { label: 'Lost', value: counts.lost, note: 'not pursuing' },
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
        onChange={(v) => { pickSide(v); if (v !== 'maintenance') setWhatFilter(null); }}
        tabs={sideTabs}
        onReorder={reorderSides}
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

        {isMaintenance && whatChips.length > 0 && (
          <>
            <span style={{ width: 1, height: 18, background: 'var(--border)' }} />
            <Chip active={whatFilter === null} onClick={() => setWhatFilter(null)}>All work</Chip>
            {whatChips.map(w => (
              <Chip key={w.key} active={whatFilter === w.key} count={w.count} title={w.hint}
                onClick={() => setWhatFilter(w.key === whatFilter ? null : w.key)}>{w.label}</Chip>
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
          onFleetSmart={() => { setShowNewLead(false); router.push('/dashboard/fleetsmart?new=1'); }}
          onClose={() => setShowNewLead(false)}
        />
      )}

      {editingRow && (
        <LeadEditDrawer
          row={editingRow}
          profile={profile}
          readOnly={readOnly}
          onWon={maybeConvert}
          onClose={() => setEditingRow(null)}
          onSave={(patch) => {
            setRows(r => r.map(x => x.id === editingRow.id ? { ...x, ...patch } : x));
            setEditingRow({ ...editingRow, ...patch });
          }}
        />
      )}

      {convert && (
        <ConvertProspectModal
          row={convert}
          onClose={() => setConvert(null)}
          onConvert={async () => {
            const done = await convertToCustomer(supabase, convert.contact_id!);
            setConvert(null);
            setMessage(done.ok
              ? `${convert.company_name} is an active customer account now.`
              : done.why);
          }}
        />
      )}
    </TabShell>
  );
}

/* =============================================================
   Whose tracker is open.

   Two controls in one, and deliberately not a third row of tabs: an
   administrator spends nearly all of their time on their own tracker,
   so the picker is a select that says "Mine" until it does not.

   Navigation rather than state. `?owner=` is read by the page on the
   server, which is where the capability is checked and where the leads
   are actually loaded, so a link to somebody's tracker is a link that
   works when it is pasted into a message.
   ============================================================= */
function WhoseTracker({ me, viewing, colleagues }: {
  me: Profile; viewing: Profile | null; colleagues: Profile[];
}) {
  const router = useRouter();
  const others = colleagues.filter((p) => p.id !== me.id && (p.full_name || p.email));

  if (others.length === 0) return null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', height: 32, position: 'relative',
      background: 'var(--surface)', border: '1px solid var(--border-strong)',
      borderRadius: 'var(--r)',
    }}>
      <span style={{ display: 'flex', paddingLeft: 9, color: 'var(--text-subtle)' }}>
        <Users size={13} />
      </span>
      <select
        aria-label="Whose tracker"
        value={viewing?.id ?? ''}
        onChange={(e) => router.push(e.target.value
          ? `/dashboard/leads?owner=${e.target.value}`
          : '/dashboard/leads')}
        style={{
          appearance: 'none', background: 'transparent', border: 0, outline: 0,
          color: viewing ? 'var(--text)' : 'var(--text-muted)',
          fontFamily: 'var(--inter)', fontSize: 12, fontWeight: 600,
          padding: '0 24px 0 7px', height: '100%', cursor: 'pointer',
        }}
      >
        <option value="">My tracker</option>
        {others.map((p) => (
          <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
        ))}
      </select>
      <span style={{
        position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)',
        pointerEvents: 'none', color: 'var(--text-subtle)', display: 'flex',
      }}><ChevronDown size={13} /></span>
    </div>
  );
}

/* =============================================================
   Make them a customer, now that you have won something.

   Asked at the moment of the handshake rather than done quietly. The
   reasoning is in `lib/crm/conversion.ts`; what matters on screen is
   that both answers are safe and both are one click, and that the
   question says what will change rather than asking for a decision in
   the abstract.
   ============================================================= */
function ConvertProspectModal({ row, onClose, onConvert }: {
  row: TrackerRow; onClose: () => void; onConvert: () => void;
}) {
  return (
    <Modal
      title={`Make ${row.company_name} an active customer?`}
      description="You have just marked this lead as won."
      width={480}
      onClose={onClose}
      footer={<>
        <Button size="sm" variant="ghost" onClick={onClose}>Leave them a prospect</Button>
        <Button size="sm" variant="primary" onClick={onConvert}>
          <BadgeCheck size={13} /> Make them a customer
        </Button>
      </>}
    >
      <p style={{ margin: 0, fontFamily: 'var(--inter)', fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
        They are recorded as a prospect. Converting them marks the CRM record as an active
        customer account, which is what the customer reports, the proposal pipelines and the
        analytics split on.
      </p>
      <p style={{ margin: 0, fontFamily: 'var(--inter)', fontSize: 12.5, color: 'var(--text-subtle)', lineHeight: 1.55 }}>
        The lead stays won either way. If the deal is not certain yet, leave them a prospect:
        the Relationship control on their record does this whenever you are ready.
      </p>
    </Modal>
  );
}

/** The little the value block needs about a sibling pitch. */
type SiblingLead = {
  id: string;
  type: string | null;
  status: string;
  what: string | null;
  estimated_value: number | null;
  sale_price: number | null;
};

// ===== Detail drawer for full edit of a single lead =====
function LeadEditDrawer({ row, profile, readOnly = false, onWon, onClose, onSave }: {
  row: TrackerRow;
  profile: Profile;
  /** Somebody else's tracker. Read, do not type. */
  readOnly?: boolean;
  /** Told when the status moves, so the prospect question can be asked. */
  onWon?: (row: TrackerRow, before: string, after: string) => void;
  onClose: () => void;
  onSave: (patch: Partial<TrackerRow>) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [edit, setEdit] = useState<TrackerRow>(row);
  const [saving, setSaving] = useState(false);
  const [meetings, setMeetings] = useState<CalendarEvent[]>([]);
  const [loadingMeetings, setLoadingMeetings] = useState(true);
  const [showSchedule, setShowSchedule] = useState(false);
  const [conflictMeeting, setConflictMeeting] = useState<CalendarEvent | null>(null);
  const tab = STATUS_TO_TAB[edit.status];

  /* WHICH DIVISION THIS LEAD IS FOR, AND ITS OWN VOCABULARY.

     From the business: "on the sales tracker, make the lead type more
     prominent when you click in to it and ensure they're wired depending
     on which tab they're on, if maintenance, trailer sales or rental.
     Currently it says Sales on them all and it's not prominent either."

     Both halves were true. The eyebrow was the literal string "Sales"
     followed by the status tab, so a maintenance contract and a hire
     both announced themselves as Sales; and the fields underneath were
     one set for all three, so a maintenance lead was asked whether it
     was new or used and what the trailer sold for.

     `words` is where the second half is fixed, once, from
     `lib/crm/lead-fields.ts`. The grid reads the same file. */
  const side: LeadType = (edit.type ?? 'trailer_sales') as LeadType;
  const words = fieldsFor(side);

  /* Every other pitch to the same customer, and what they come to.

     The drawer showed this one lead and nothing else, so a rep opening
     a £4,000 trailer enquiry could not see that the same haulier had a
     £40,000 maintenance contract quoted by somebody else. The tracker's
     own pipeline figure counted every open lead across every customer,
     which answers a different question entirely.

     Read by company, the same way the meetings below already are, and
     for the same reason: a pitch to Dawson is a pitch to Dawson. Row
     level security decides which of them come back, so a rep and a
     manager see different lists and neither list is decided here. */
  const [siblings, setSiblings] = useState<SiblingLead[]>([]);
  const [loadingSiblings, setLoadingSiblings] = useState(true);

  useEffect(() => {
    if (!row.contact_id) { setSiblings([]); setLoadingSiblings(false); return; }
    let cancelled = false;
    (async () => {
      setLoadingSiblings(true);
      const { data } = await supabase
        .from('crm_leads')
        .select('id, type, status, what, estimated_value, sale_price')
        .eq('contact_id', row.contact_id)
        .order('status')
        .order('updated_at', { ascending: false });
      if (!cancelled) {
        setSiblings((data ?? []) as SiblingLead[]);
        setLoadingSiblings(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, row.contact_id, edit.status, edit.estimated_value, edit.sale_price]);

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
    /* A MEETING NEEDS SOMEBODY TO BE WITH.

       `contact_id` is nullable on a lead and the type used to say it
       was not, so this passed null straight into the booking modal and
       wrote a meeting attached to nobody. Caught by correcting the
       type, not by anybody seeing it happen.

       Refused rather than worked around: the fix is to give the lead a
       CRM record, and inventing one here would put a half filled
       company in the CRM as a side effect of booking a call. */
    if (!hasAnAccount(row)) return;
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

  /* What is actually in the database, as opposed to what is in the box.
     See `saveField`: comparing a commit against the box it came from is
     always equal, and was silently dropping every write. */
  const persisted = useRef<TrackerRow>(row);

  /**
   * One field, written to whichever record owns it.
   *
   * The same split as the grid: a company's phone number belongs to the
   * company, this pitch's estimated value belongs to this pitch. Writing
   * both to `crm_contacts` was correct only while they were the same row.
   *
   * ---- The comparison is against the DATABASE, not the box ----
   *
   * Every text field here is `onChange` into local state plus `onCommit`
   * to here, which is the kit's inline edit shape: typing is local,
   * leaving the field is the save. So by the time a commit arrives,
   * `edit[field]` IS the new value, and `edit[field] === value` was
   * therefore true on every single edit. The function returned before
   * writing anything, the drawer showed the new text because the box
   * held it, and nothing reached Supabase.
   *
   * That is why an action note typed into this drawer came back empty:
   * nine fields were affected, not one. Held in a ref rather than state
   * because it must be current within the same tick as the write and
   * nothing renders from it.
   */
  async function saveField<K extends keyof TrackerRow>(field: K, value: TrackerRow[K]) {
    /* Reading somebody else's tracker. Every control below is already
       disabled, so this is the belt to that pair of braces: a commit
       that arrives from a keyboard shortcut or a stale handler writes
       nothing. */
    if (readOnly) return;
    if (persisted.current[field] === value) return;
    const before = persisted.current[field];
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
    /* Only once the write came back. A field marked saved before the
       round trip is a field that stops retrying after a refusal. */
    persisted.current = { ...persisted.current, [field]: value };

    /* The row you edited is the row that moves. A company field written
       from here goes to `crm_contacts`, where the lead's activity
       trigger never sees it. Same reasoning as `saveCell`. */
    const now = new Date().toISOString();
    if (toAccount) {
      await supabase.from('crm_leads').update({ last_activity_at: now }).eq('id', row.id);
    }
    setEdit((e) => ({ ...e, last_activity_at: now }));
    onSave({ [field]: value, last_activity_at: now } as any);

    if (field === 'status') onWon?.(row, String(before ?? ''), String(value ?? ''));
  }

  // Same guard as the other drawers: the shade is easy to clip on the
  // way past, and one click should not lose where you were.
  const dismiss = useDismissGuard(onClose);

  return (
    <Drawer
      /* The division, in the eyebrow, in the icon and in a badge beside
         the name. Three places for one fact is not repetition here: the
         eyebrow is read on the way in, the icon is what the eye lands
         on, and the badge is what stays visible while you scroll. */
      eyebrow={`${words.label} · ${TAB_LABEL[tab]}`}
      title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {edit.company_name || 'Untitled lead'}
        </span>
        <Badge tone={side === 'maintenance' ? 'accent' : side === 'rental' ? 'info' : 'neutral'} dot>
          {words.label}
        </Badge>
        {/* WHEN IT LAST MOVED, BESIDE THE NAME.

            Asked for with the column: "Show this to the right of the
            customer name when you open a lead up too." It is the one
            fact that decides whether the next thing you do is ring them
            or read the notes, and it was on neither screen. */}
        {edit.last_activity_at && (
          <span title={new Date(edit.last_activity_at).toLocaleString('en-GB')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none',
              fontFamily: 'var(--inter)', fontSize: 11.5, fontWeight: 500,
              color: 'var(--text-subtle)', letterSpacing: 0,
            }}>
            <History size={12} /> Updated {fmtDate(edit.last_activity_at)}
          </span>
        )}
      </span>}
      icon={side === 'maintenance' ? <Wrench size={18} />
        : side === 'rental' ? <Truck size={18} />
        : <Container size={18} />}
      onClose={onClose}
      backdropProps={dismiss.backdropProps as Record<string, unknown>}
      hint={dismiss.hint}
      footer={<>
        {readOnly && (
          <span style={{ flex: 1, fontFamily: 'var(--inter)', fontSize: 12, color: 'var(--text-subtle)' }}>
            Somebody else&rsquo;s lead. Open it from the customer&rsquo;s CRM record to work on it.
          </span>
        )}
        {!readOnly && <span style={{ flex: 1 }} />}
        {saving && <Loader size={14} className="spin" />}
        <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
      </>}
    >
          {/* What this customer is worth across everything open with
              them, and every pitch that makes it up, before the fields
              for this one.

              First on the drawer on purpose. Somebody opening a lead is
              about to ring the customer, and what they need in their
              head before they dial is not this pitch's estimate, it is
              whether the same haulier has £40,000 quoted by somebody
              else. */}
          {!loadingSiblings && siblings.length > 0 && (
            <CustomerValue
              leads={siblings}
              currentLeadId={row.id}
              dense
              onOpenLead={(l) => {
                const id = (l as { id?: string }).id;
                if (id) window.location.assign(`/dashboard/leads?lead=${id}`);
              }}
            />
          )}

          <Split>
            <Field label="Contact">
              <TextInput readOnly={readOnly} value={edit.contact_name ?? ''} onChange={(v) => setEdit(s => ({ ...s, contact_name: v }))} onCommit={(v) => saveField('contact_name', v)} />
            </Field>
            <Field label="Company">
              <TextInput readOnly={readOnly} value={edit.company_name ?? ''} onChange={(v) => setEdit(s => ({ ...s, company_name: v }))} onCommit={(v) => saveField('company_name', v)} />
            </Field>
          </Split>
          <Split>
            <Field label="Phone">
              <TextInput readOnly={readOnly} value={edit.phone ?? ''} onChange={(v) => setEdit(s => ({ ...s, phone: v }))} onCommit={(v) => saveField('phone', v)} />
            </Field>
            <Field label="Email">
              <TextInput readOnly={readOnly} value={edit.email ?? ''} onChange={(v) => setEdit(s => ({ ...s, email: v }))} onCommit={(v) => saveField('email', v)} />
            </Field>
          </Split>

          {/* WHAT THIS PITCH IS FOR.

              The field a maintenance lead is most about, and it was on
              the grid, on the new lead modal, and not here. A trailer
              sale describes a unit in its own words, so that one is free
              text; the other two pick from a short list, which is what
              keeps the filter chips down to five. */}
          <Split>
            <Field label={words.what.label} hint={words.what.hint}>
              {words.what.options ? (
                <Select disabled={readOnly} value={edit.what ?? ''} onChange={(v) => saveField('what', v || null)}>
                  <option value="">—</option>
                  {/* Whatever is already on the record, even where it is
                      not one of the seven. A select that silently drops
                      an unrecognised value shows the first option
                      instead and looks like the record says that. */}
                  {edit.what && !words.what.options.includes(edit.what) && (
                    <option value={edit.what}>{edit.what}</option>
                  )}
                  {words.what.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </Select>
              ) : (
                <TextInput readOnly={readOnly} placeholder="Curtainsider, 4.7m, tri-axle"
                  value={edit.what ?? ''} onChange={(v) => setEdit(s => ({ ...s, what: v }))}
                  onCommit={(v) => saveField('what', v || null)} />
              )}
            </Field>
            <Field label="Date of enquiry">
              <TextInput readOnly={readOnly} type="date" value={edit.date_of_enquiry ?? ''} onChange={(v) => saveField('date_of_enquiry', v || null)} />
            </Field>
          </Split>

          <Split>
            <Field label="Source">
              <TextInput readOnly={readOnly} placeholder="LinkedIn, Prospect call, Website enquiry, Walk-in" value={edit.source ?? ''} onChange={(v) => setEdit(s => ({ ...s, source: v }))} onCommit={(v) => saveField('source', v || '')} />
            </Field>
            <Field label={words.estimatedLabel} hint={words.estimatedHint}>
              <TextInput readOnly={readOnly} type="number" value={edit.estimated_value == null ? '' : String(edit.estimated_value)} onChange={(v) => saveField('estimated_value', v === '' ? null : Number(v))} />
            </Field>
          </Split>

          {/* New or used describes a trailer. A maintenance contract is
              neither, and a hire is neither, so they are not asked. */}
          {words.newOrUsed && (
            <Field label="New / Used">
              <Select disabled={readOnly} value={edit.new_or_used ?? ''} onChange={(v) => saveField('new_or_used', v || null)}>
                <option value="">—</option>
                <option>New</option><option>Used</option><option>New/Used</option><option>Used/Refurb</option><option>Refurb</option>
              </Select>
            </Field>
          )}

          <Field label={words.description.label}>
            <TextInput readOnly={readOnly} placeholder={words.description.placeholder} value={edit.description ?? ''} onChange={(v) => setEdit(s => ({ ...s, description: v }))} onCommit={(v) => saveField('description', v || null)} />
          </Field>
          <Field label={words.requirementLabel}>
            <TextArea readOnly={readOnly} rows={2} value={edit.requirement ?? ''} onChange={(v) => setEdit(s => ({ ...s, requirement: v }))} onCommit={(v) => saveField('requirement', v || null)} />
          </Field>
          <Field label="Action / next step">
            <TextArea readOnly={readOnly} rows={2} value={edit.action ?? ''} onChange={(v) => setEdit(s => ({ ...s, action: v }))} onCommit={(v) => saveField('action', v || null)} />
          </Field>
          <Field label="Status">
            <Select disabled={readOnly} value={edit.status} onChange={(v) => saveField('status', v as ContactStatus)}>
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
          {/* `PanelHead`, not `SectionHead`.

              `SectionHead` is a page heading: no padding of its own and
              a 12px bottom margin, both right in a padded page and
              wrong inside `Card padded={false}`. The title sat flush
              against the left border, the Schedule button against the
              right one, and the margin collided with the body's own
              padding underneath. Five other panels on this screen had
              the same shape and the same defect. */}
          <Card padded={false}>
            <PanelHead
              title="Scheduled meetings"
              count={meetings.length || undefined}
              action={
                <Button size="sm" variant="secondary" onClick={handleSchedule}
                  disabled={readOnly || !hasAnAccount(row)}>
                  <CalendarPlus size={12} /> Schedule
                </Button>
              }
            />
            <div style={{ padding: '10px 14px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {loadingMeetings ? (
                <div style={{ display: 'flex', gap: 7, alignItems: 'center', color: 'var(--text-subtle)', fontSize: 12.5 }}>
                  <Loader size={12} className="spin" /> Loading
                </div>
              ) : !hasAnAccount(row) ? (
                <div style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>
                  This lead has no CRM record behind it yet, so there is nobody to book a
                  meeting with. Pick or create the account and this fills in.
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
            <TextArea readOnly={readOnly} rows={3} value={edit.notes ?? ''}
              onChange={(v) => setEdit(s => ({ ...s, notes: v }))}
              onCommit={(v) => saveField('notes', v || null)} />
          </Field>

          {/* Only once there is something to describe, and in the words
              of the thing that was agreed. A maintenance contract has no
              dispatch date and a hire has no sale price: same four
              columns, three vocabularies, from `lib/crm/lead-fields.ts`.

              Profit is trailer sales only. On a maintenance contract it
              is a workshop figure that arrives months later out of the
              invoices, not a number a rep types at the handshake, and a
              box asking for it at the wrong moment gets a guess. */}
          {(edit.status === 'customer' || edit.status === 'won') && (
            <Card padded={false}>
              <PanelHead title={words.closing.title} hint={words.closing.hint} />
              <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Split>
                  <Field label={words.closing.orderDate}>
                    <TextInput readOnly={readOnly} type="date" value={edit.order_date ?? ''} onChange={(v) => saveField('order_date', v || null)} />
                  </Field>
                  <Field label={words.closing.dispatchDate}>
                    <TextInput readOnly={readOnly} type="date" value={edit.dispatch_date ?? ''} onChange={(v) => saveField('dispatch_date', v || null)} />
                  </Field>
                </Split>
                <Split>
                  <Field label={words.closing.salePrice}>
                    <TextInput readOnly={readOnly} type="number" value={edit.sale_price == null ? '' : String(edit.sale_price)} onChange={(v) => saveField('sale_price', v === '' ? null : Number(v))} />
                  </Field>
                  <Field label="Commission (£)">
                    <TextInput readOnly={readOnly} type="number" value={edit.commission == null ? '' : String(edit.commission)} onChange={(v) => saveField('commission', v === '' ? null : Number(v))} />
                  </Field>
                </Split>
                {words.closing.profit && (
                  <Split>
                    <Field label="Profit (£)">
                      <TextInput readOnly={readOnly} type="number" value={edit.profit == null ? '' : String(edit.profit)} onChange={(v) => saveField('profit', v === '' ? null : Number(v))} />
                    </Field>
                    <Field label="Profit rate" hint="0.15 is 15%">
                      <TextInput readOnly={readOnly} type="number" value={edit.profit_pct == null ? '' : String(edit.profit_pct)} onChange={(v) => saveField('profit_pct', v === '' ? null : Number(v))} />
                    </Field>
                  </Split>
                )}
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

        {showSchedule && edit.contact_id && (
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
function NewLeadModal({ profile, onCreate, onFleetSmart, onClose }: {
  profile: Profile;
  /** Through to the FleetSmart+ builder, which raises its own lead. */
  onFleetSmart: () => void;
  onCreate: (contactId: string | null, company: string, websiteUrl: string,
             type: LeadType, what: string | null, ownerId: string) => void;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [type, setType] = useState<LeadType>('trailer_sales');
  const words = fieldsFor(type);
  /* The first option of whichever division is picked, not the word
     "Maintenance" whatever you picked. Switching from maintenance to
     rental used to leave "Maintenance" in the box and write it onto a
     hire enquiry, which is a row that then groups under the wrong chip
     for the rest of its life. */
  const [what, setWhat] = useState<string>(MAINTENANCE_WHAT[0]);
  useEffect(() => {
    const first = fieldsFor(type).what.options?.[0];
    if (first) setWhat(first);
  }, [type]);
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
          {/* Not a fourth lead type. FleetSmart+ is a priced maintenance
              contract, and building one already creates the maintenance
              lead behind it, so raising a lead here as well would make
              two records for one pitch. This is the way through to the
              builder, which is where the price gets set. */}
          <OptionCard
            selected={false}
            onSelect={onFleetSmart}
            icon={<ShieldCheck size={14} />}
            title="FleetSmart+"
            description="Price a fixed cost maintenance contract"
          />
        </div>
      </Field>

      <p style={{
        margin: '-2px 0 0', fontFamily: 'var(--inter)', fontSize: 11.5,
        color: 'var(--text-subtle)',
      }}>
        FleetSmart+ opens the contract builder. Saving a contract there puts the maintenance lead
        on this tracker, and the two move together after that.
      </p>

      {/* WHAT THIS LEAD IS FOR, ASKED IN THIS DIVISION'S WORDS.

          Maintenance was the only one asked, from a list of nine
          phrasings of four jobs, which is where half of the thirty
          filter chips came from. It is seven now, one per kind of work,
          and rental is asked as well: a hire enquiry with nothing in
          `what` is a row nobody can group.

          Trailer sales is deliberately not asked here. The unit gets
          described in the drawer where there is room for it, and a
          required select in front of "which customer" is a step between
          somebody and the thing they opened this for. */}
      {words.what.options && (
        <Field label={words.what.label} hint={words.what.hint}>
          <Select value={what} onChange={setWhat}>
            {words.what.options.map((o) => <option key={o} value={o}>{o}</option>)}
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
              <PanelHead title={`${matches.length} in the CRM`} hint="Pick the one you mean" />
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
                      onClick={() => onCreate(m.id, m.company_name, '', type, words.what.options ? what : null, owner)}>
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
                  onClick={() => onCreate(null, company, website, type, words.what.options ? what : null, owner)}>
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
          <PanelHead title="What this earns" />
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

  /* Rebuilt every render, so the memo below it is recomputed every
     render too. Accepted: it is a handful of sums over rows already in
     memory, and a today that moved mid session would be worse. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <PanelHead title="Last twelve months" hint="Commission earned" />
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
        <PanelHead title="Every closed deal" hint={`${sales.length} in all`} />
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
