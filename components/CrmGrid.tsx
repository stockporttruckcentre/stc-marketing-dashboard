'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, ValueSetterParams } from 'ag-grid-community';
import Papa from 'papaparse';
import { Plus, Upload, Download, Loader, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { CRMContact, ContactStatus, UserRole } from '@/lib/types';

const STATUSES: ContactStatus[] = ['lead', 'contacted', 'quoted', 'won', 'lost'];

export function CrmGrid({
  initialContacts, role,
}: { initialContacts: CRMContact[]; role: UserRole }) {
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
    supabase
      .from('crm_contacts')
      .update({ [field]: newValue })
      .eq('id', params.data.id)
      .then(({ error }) => { if (error) setMessage(`Save failed: ${error.message}`); });
    return true;
  }, [supabase]);

  const columnDefs: ColDef<CRMContact>[] = useMemo(() => [
    {
      headerName: '', field: 'id', width: 50, pinned: 'left',
      cellRenderer: (p: ICellRendererParams<CRMContact>) =>
        canDelete ? (
          <button className="btn btn--icon btn--sm"
            onClick={async () => {
              if (!confirm('Delete this contact?')) return;
              const { error } = await supabase.from('crm_contacts').delete().eq('id', p.data!.id);
              if (error) { setMessage(error.message); return; }
              setRows(r => r.filter(c => c.id !== p.data!.id));
            }}
          ><Trash2 size={12} /></button>
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
      field: 'status', headerName: 'Status', width: 140, editable: canEdit, valueSetter: saveCell,
      cellEditor: 'agSelectCellEditor', cellEditorParams: { values: STATUSES },
      cellRenderer: (p: ICellRendererParams<CRMContact, ContactStatus>) => {
        const v = p.value as ContactStatus | undefined;
        if (!v) return null;
        return <span className={`pill pill--${v}`}><span className="pill__dot" />{v}</span>;
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
    setEnriching(true); setMessage(null);
    try {
      const res = await fetch('/api/lusha/enrich', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
    setImporting(true); setMessage(null);
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: async (results) => {
        try {
          const res = await fetch('/api/crm/import', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rows: results.data }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || 'Import failed');
          setMessage(`Imported ${json.inserted} contacts`);
          const { data } = await supabase.from('crm_contacts').select('*').order('updated_at', { ascending: false });
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
    const { data, error } = await supabase.from('crm_contacts')
      .insert({ company_name: 'New company', status: 'lead', source: 'manual' })
      .select('*').single();
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
    <div>
      <div className="page-head">
        <div>
          <div className="page-head__eyebrow">Sales · CRM pipeline</div>
          <h1 className="page-head__title">{rows.length} <span style={{ fontWeight: 400, color: 'var(--fg-3)', fontSize: 22 }}>contacts</span></h1>
          <div className="page-head__sub">Inline edit · sort · filter · export. Type an email below to enrich via Lusha.</div>
        </div>
      </div>

      <div className="stats-grid">
        <Stat label="Open Leads" value={statusCounts.lead}      accent="info" />
        <Stat label="Contacted"  value={statusCounts.contacted} accent="warning" />
        <Stat label="Quoted"     value={statusCounts.quoted}    accent="lusha" />
        <Stat label="Won · Lost" value={`${statusCounts.won} · ${statusCounts.lost}`} accent="success" />
      </div>

      <div className="toolbar" style={{ marginTop: 14 }}>
        {canEdit && (
          <div className="row">
            <input type="email" placeholder="email@company.com"
              value={enrichEmail} onChange={(e) => setEnrichEmail(e.target.value)}
              className="input" style={{ width: 240 }} />
            <button onClick={handleEnrich} disabled={enriching || !enrichEmail} className="btn btn--primary">
              {enriching ? <Loader size={14} className="spin" /> : <Plus size={14} />} Enrich
            </button>
          </div>
        )}
        <div className="toolbar__spacer" />
        {canEdit && (
          <label className="btn">
            {importing ? <Loader size={14} className="spin" /> : <Upload size={14} />} Import CSV
            <input type="file" accept=".csv" hidden onChange={(e) => {
              const f = e.target.files?.[0]; if (f) handleImport(f);
              e.target.value = '';
            }} />
          </label>
        )}
        <button onClick={handleExport} className="btn"><Download size={14} /> Export</button>
        {canEdit && (
          <button onClick={handleAddRow} disabled={adding} className="btn btn--primary">
            <Plus size={14} /> Add contact
          </button>
        )}
      </div>

      {message && <div className="alert alert--info" style={{ marginBottom: 12 }}>{message}</div>}

      <div className="ag-theme-quartz-dark" style={{ height: 'calc(100vh - 380px)', minHeight: 420, borderRadius: 'var(--r-3)', border: '1px solid var(--border)', overflow: 'hidden' }}>
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

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: 'red'|'success'|'warning'|'info'|'lusha' }) {
  return (
    <div className={`stat ${accent ? `stat--${accent}` : ''}`}>
      <div className="stat__bar" />
      <div className="stat__label">{label}</div>
      <div className="stat__value tnum">{value}</div>
    </div>
  );
}
