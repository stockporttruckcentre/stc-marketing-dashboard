'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueSetterParams, GridReadyEvent } from 'ag-grid-community';
import Papa from 'papaparse';
import { Plus, Upload, Download, Loader, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { CRMContact, ContactStatus, UserRole } from '@/lib/types';

const STATUS_COLORS: Record<ContactStatus, string> = {
  lead:      'bg-blue-100 text-blue-800',
  contacted: 'bg-yellow-100 text-yellow-800',
  quoted:    'bg-purple-100 text-purple-800',
  won:       'bg-green-100 text-green-800',
  lost:      'bg-red-100 text-red-800',
};

const STATUSES: ContactStatus[] = ['lead', 'contacted', 'quoted', 'won', 'lost'];

export function CrmGrid({
  initialContacts,
  role,
}: {
  initialContacts: CRMContact[];
  role: UserRole;
}) {
  const supabase = useMemo(() => createClient(), []);
  const gridRef = useRef<AgGridReact<CRMContact>>(null);
  const [rows, setRows] = useState<CRMContact[]>(initialContacts);
  const [enrichEmail, setEnrichEmail] = useState('');
  const [enriching, setEnriching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const canEdit = role === 'admin' || role === 'marketer' || role === 'sales';
  const canDelete = role === 'admin';

  const saveCell = useCallback((params: ValueSetterParams<CRMContact>): boolean => {
    const field = params.colDef.field as keyof CRMContact;
    const newValue = params.newValue;
    if (params.data[field] === newValue) return false;
    (params.data as any)[field] = newValue;

    // Fire-and-forget background save; surface errors via message.
    supabase
      .from('crm_contacts')
      .update({ [field]: newValue })
      .eq('id', params.data.id)
      .then(({ error }) => {
        if (error) setMessage(`Save failed: ${error.message}`);
      });
    return true;
  }, [supabase]);

  const columnDefs: ColDef<CRMContact>[] = useMemo(() => [
    {
      headerName: '', field: 'id', width: 50, pinned: 'left',
      cellRenderer: (p: ICellRendererParams<CRMContact>) =>
        canDelete ? (
          <button
            className="p-1 text-gray-400 hover:text-red-600"
            onClick={async () => {
              if (!confirm('Delete this contact?')) return;
              const { error } = await supabase.from('crm_contacts').delete().eq('id', p.data!.id);
              if (error) { setMessage(error.message); return; }
              setRows(r => r.filter(c => c.id !== p.data!.id));
            }}
          ><Trash2 size={14} /></button>
        ) : null,
      sortable: false, filter: false, editable: false,
    },
    { field: 'company_name', headerName: 'Company', flex: 1, minWidth: 180, editable: canEdit, valueSetter: saveCell },
    { field: 'contact_name', headerName: 'Contact', flex: 1, minWidth: 140, editable: canEdit, valueSetter: saveCell },
    { field: 'email', headerName: 'Email', flex: 1.2, minWidth: 200, editable: canEdit, valueSetter: saveCell },
    { field: 'phone', headerName: 'Phone', width: 140, editable: canEdit, valueSetter: saveCell },
    { field: 'location', headerName: 'Location', width: 140, editable: canEdit, valueSetter: saveCell },
    { field: 'fleet_size', headerName: 'Fleet', width: 90, editable: canEdit, valueSetter: saveCell,
      valueParser: (p) => p.newValue === '' ? null : Number(p.newValue) },
    {
      field: 'status', headerName: 'Status', width: 130, editable: canEdit, valueSetter: saveCell,
      cellEditor: 'agSelectCellEditor', cellEditorParams: { values: STATUSES },
      cellRenderer: (p: ICellRendererParams<CRMContact, ContactStatus>) => {
        const v = p.value as ContactStatus | undefined;
        if (!v) return null;
        return <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[v]}`}>{v}</span>;
      },
    },
    { field: 'source', headerName: 'Source', width: 110, editable: canEdit, valueSetter: saveCell },
    { field: 'assigned_to', headerName: 'Assigned', width: 130, editable: canEdit, valueSetter: saveCell },
    { field: 'last_contact', headerName: 'Last contact', width: 120, editable: canEdit, valueSetter: saveCell },
    { field: 'notes', headerName: 'Notes', flex: 1.5, minWidth: 200, editable: canEdit, valueSetter: saveCell },
  ], [canEdit, canDelete, saveCell, supabase]);

  const defaultColDef: ColDef = useMemo(() => ({
    resizable: true, sortable: true, filter: true, floatingFilter: true,
  }), []);

  async function handleEnrich() {
    if (!enrichEmail.trim()) return;
    setEnriching(true);
    setMessage(null);
    try {
      const res = await fetch('/api/lusha/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: enrichEmail.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Enrichment failed');
      setRows(r => [json.contact, ...r]);
      setEnrichEmail('');
      setMessage(`Enriched ${enrichEmail}`);
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setEnriching(false);
    }
  }

  function handleExport() {
    const csv = Papa.unparse(rows.map(r => ({
      company_name: r.company_name, contact_name: r.contact_name, email: r.email,
      phone: r.phone, location: r.location, fleet_size: r.fleet_size, status: r.status,
      source: r.source, assigned_to: r.assigned_to, last_contact: r.last_contact, notes: r.notes,
    })));
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `stc-crm-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(file: File) {
    setImporting(true);
    setMessage(null);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const res = await fetch('/api/crm/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rows: results.data }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || 'Import failed');
          setMessage(`Imported ${json.inserted} contacts`);
          // Re-fetch
          const { data } = await supabase
            .from('crm_contacts').select('*').order('updated_at', { ascending: false });
          setRows((data ?? []) as CRMContact[]);
        } catch (e: any) {
          setMessage(e.message);
        } finally {
          setImporting(false);
        }
      },
    });
  }

  async function handleAddRow() {
    setAdding(true);
    const { data, error } = await supabase
      .from('crm_contacts')
      .insert({
        company_name: 'New company',
        status: 'lead',
        source: 'manual',
      })
      .select('*')
      .single();
    setAdding(false);
    if (error) { setMessage(error.message); return; }
    setRows(r => [data as CRMContact, ...r]);
  }

  const statusCounts = useMemo(() => {
    const c = { all: rows.length, lead: 0, contacted: 0, quoted: 0, won: 0, lost: 0 } as Record<string, number>;
    rows.forEach(r => { c[r.status] = (c[r.status] ?? 0) + 1; });
    return c;
  }, [rows]);

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Stat label="Total"     value={statusCounts.all}       color="bg-gray-100" />
        <Stat label="Leads"     value={statusCounts.lead}      color="bg-blue-100" />
        <Stat label="Contacted" value={statusCounts.contacted} color="bg-yellow-100" />
        <Stat label="Quoted"    value={statusCounts.quoted}    color="bg-purple-100" />
        <Stat label="Won"       value={statusCounts.won}       color="bg-green-100" />
        <Stat label="Lost"      value={statusCounts.lost}      color="bg-red-100" />
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-lg shadow p-3 flex flex-wrap items-center gap-3">
        {canEdit && (
          <div className="flex items-center gap-2">
            <input
              type="email"
              placeholder="email@company.com"
              value={enrichEmail}
              onChange={(e) => setEnrichEmail(e.target.value)}
              className="px-3 py-2 border rounded-lg w-60"
            />
            <button
              onClick={handleEnrich}
              disabled={enriching || !enrichEmail}
              className="px-4 py-2 bg-stc-navy text-white rounded-lg hover:bg-stc-navy-light disabled:opacity-50 flex items-center gap-2"
            >
              {enriching ? <Loader size={14} className="animate-spin" /> : <Plus size={14} />}
              Enrich
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 ml-auto">
          {canEdit && (
            <label className="px-4 py-2 border rounded-lg flex items-center gap-2 hover:bg-gray-50 cursor-pointer">
              {importing ? <Loader size={14} className="animate-spin" /> : <Upload size={14} />}
              Import CSV
              <input type="file" accept=".csv" hidden onChange={(e) => {
                const f = e.target.files?.[0]; if (f) handleImport(f);
                e.target.value = '';
              }} />
            </label>
          )}
          <button onClick={handleExport} className="px-4 py-2 border rounded-lg flex items-center gap-2 hover:bg-gray-50">
            <Download size={14} /> Export
          </button>
          {canEdit && (
            <button
              onClick={handleAddRow}
              disabled={adding}
              className="px-4 py-2 bg-stc-red text-white rounded-lg hover:bg-stc-red-dark flex items-center gap-2"
            >
              <Plus size={14} /> Add contact
            </button>
          )}
        </div>
      </div>

      {message && (
        <div className="bg-blue-50 border border-blue-200 text-blue-900 rounded-lg px-4 py-2 text-sm">
          {message}
        </div>
      )}

      {/* Grid */}
      <div className="ag-theme-quartz bg-white rounded-lg shadow" style={{ height: 'calc(100vh - 380px)', minHeight: 400 }}>
        <AgGridReact<CRMContact>
          ref={gridRef}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          animateRows
          stopEditingWhenCellsLoseFocus
          enableCellTextSelection
          getRowId={(p) => p.data.id}
        />
      </div>
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
