'use client';

import { useMemo, useState } from 'react';
import { Loader, Search, Plus, CheckCircle, Globe, Users, X, MapPin, Building } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { DEPOTS, type CrmList } from '@/lib/types';
import { BusinessActivityStrip } from './BusinessActivityStrip';

// LinkedIn / Lusha numeric industry IDs (mainIndustriesIds)
const INDUSTRIES = [
  { id: 116, label: 'Transportation, Logistics & Storage' },
  { id: 92,  label: 'Truck Transportation' },
  { id: 93,  label: 'Warehousing & Storage' },
  { id: 48,  label: 'Construction' },
  { id: 25,  label: 'Manufacturing (general)' },
  { id: 135, label: 'Industrial Machinery Manufacturing' },
  { id: 53,  label: 'Motor Vehicle Manufacturing' },
  { id: 27,  label: 'Retail' },
  { id: 23,  label: 'Food & Beverage Manufacturing' },
  { id: 332, label: 'Oil, Gas & Mining' },
  { id: 56,  label: 'Mining' },
  { id: 63,  label: 'Farming' },
  { id: 201, label: 'Farming, Ranching, Forestry' },
  { id: 1981,label: 'Waste Collection' },
  { id: 2226,label: 'Vehicle Repair & Maintenance' },
];

interface FinderResult {
  name: string; employees: number | null; location: string;
  distance: number | null; domain: string | null; industry: string | null;
}

export function CompanyFinder({ lists }: { lists: CrmList[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<'finder' | 'company'>('finder');
  const [depotKey, setDepotKey] = useState<string>('Hyde');
  const [customPostcode, setCustomPostcode] = useState('');
  const [radius, setRadius] = useState(10);
  const [industry, setIndustry] = useState<number>(INDUSTRIES[0].id);
  const [empMin, setEmpMin] = useState(10);
  const [empMax, setEmpMax] = useState(200);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<FinderResult[]>([]);
  const [added, setAdded] = useState<Record<string, string>>({}); // name -> list_id added to
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [listPickerFor, setListPickerFor] = useState<{ kind: 'single'; company: FinderResult } | { kind: 'bulk'; companies: FinderResult[] } | null>(null);

  const isCustom = depotKey === '__custom__';

  function locationLabel() {
    if (isCustom) return customPostcode.trim() || 'Custom location';
    return depotKey;
  }

  async function handleSearch() {
    setSearching(true); setMessage(null); setAdded({}); setSelected(new Set());
    try {
      const res = await fetch('/api/lusha/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: isCustom ? customPostcode : depotKey,
          radiusMiles: radius, industryIds: [industry],
          minEmployees: empMin, maxEmployees: empMax, limit: 25,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Search failed');
      setResults(json.companies);
      setMessage(`Found ${json.companies.length} companies within ${radius} mi of ${locationLabel()}`);
    } catch (e: any) {
      setMessage(e.message); setResults([]);
    } finally { setSearching(false); }
  }

  async function addToCrm(companies: FinderResult[], listId: string) {
    const rows = companies.map((c) => ({
      list_id: listId,
      company_name: c.name, location: c.location, fleet_size: c.employees,
      source: 'Lusha Company Finder', status: 'lead',
      notes: c.domain ? `Domain: ${c.domain}` : null,
    }));
    const { error } = await supabase.from('crm_contacts').insert(rows);
    if (error) { setMessage(error.message); return; }
    const a = { ...added };
    companies.forEach((c) => { a[c.name] = listId; });
    setAdded(a);
    setListPickerFor(null);
    const listName = lists.find((l) => l.id === listId)?.name;
    setMessage(`Added ${companies.length} compan${companies.length === 1 ? 'y' : 'ies'} → ${listName}`);
    setSelected(new Set());
  }

  function handleAddSingle(c: FinderResult) {
    if (lists.length === 1) addToCrm([c], lists[0].id);
    else setListPickerFor({ kind: 'single', company: c });
  }
  function handleAddBulk() {
    const chosen = results.filter((r) => selected.has(r.name));
    if (!chosen.length) return;
    if (lists.length === 1) addToCrm(chosen, lists[0].id);
    else setListPickerFor({ kind: 'bulk', companies: chosen });
  }

  function toggleRow(name: string) {
    const s = new Set(selected);
    if (s.has(name)) s.delete(name); else s.add(name);
    setSelected(s);
  }
  function toggleAll() {
    if (selected.size === results.length) setSelected(new Set());
    else setSelected(new Set(results.map((r) => r.name)));
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-head__eyebrow">Sales · Company finder</div>
          <h1 className="page-head__title"><Search size={26} style={{ color: 'var(--stc-red)' }} /><span>Find prospects<span style={{ color: 'var(--stc-red)' }}>.</span></span></h1>
          <div className="page-head__sub">Search any STC depot, custom postcode, or radius via Lusha. Add results in bulk to any CRM list.</div>
        </div>
      </div>

      <div className="toolbar" style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <button onClick={() => setTab('finder')}
          className={`news-chip ${tab === 'finder' ? 'is-active' : ''}`}>
          Company Finder
        </button>
        <button onClick={() => setTab('company')}
          className={`news-chip ${tab === 'company' ? 'is-active' : ''}`}>
          Company Updates
        </button>
      </div>

      {tab === 'company' ? (
        <BusinessActivityStrip />
      ) : (
      <>
      <div className="finder-hero">
        <div className="finder-hero__grid">
          <Field label="LOCATION">
            <select value={depotKey} onChange={(e) => setDepotKey(e.target.value)} className="input">
              <optgroup label="STC Depots">
                {DEPOTS.map((d) => <option key={d.name} value={d.name}>STC {d.name}</option>)}
              </optgroup>
              <option value="__custom__">Custom postcode / city…</option>
            </select>
          </Field>
          {isCustom ? (
            <Field label="POSTCODE OR CITY">
              <input type="text" value={customPostcode} onChange={(e) => setCustomPostcode(e.target.value)}
                placeholder="e.g. M1 2AB · Liverpool · Wakefield"
                className="input" autoFocus />
            </Field>
          ) : <span />}
          <Field label="RADIUS (MI)">
            <input type="number" min={1} max={300} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="input" />
          </Field>
          <Field label="INDUSTRY">
            <select value={industry} onChange={(e) => setIndustry(Number(e.target.value))} className="input">
              {INDUSTRIES.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
            </select>
          </Field>
          <Field label="EMPLOYEES MIN">
            <input type="number" min={1} value={empMin} onChange={(e) => setEmpMin(Number(e.target.value))} className="input" />
          </Field>
          <Field label="EMPLOYEES MAX">
            <input type="number" min={1} value={empMax} onChange={(e) => setEmpMax(Number(e.target.value))} className="input" />
          </Field>
        </div>
        <div className="finder-hero__cta">
          <div className="finder-hero__summary">
            <MapPin size={14} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />
            <strong style={{ color: 'var(--fg-1)' }}>{locationLabel()}</strong>
            <span style={{ color: 'var(--fg-3)', marginLeft: 6 }}>· within {radius} mi · {empMin}–{empMax} employees</span>
          </div>
          <button onClick={handleSearch} disabled={searching || (isCustom && !customPostcode.trim())}
            className="btn btn--primary btn--lg">
            {searching ? <Loader size={14} className="spin" /> : <Search size={14} />} Search Lusha
          </button>
        </div>
      </div>

      {message && <div className="alert alert--info" style={{ marginTop: 14 }}>{message}</div>}

      {results.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card__head">
            <div className="row" style={{ gap: 12 }}>
              <input type="checkbox" checked={selected.size === results.length} onChange={toggleAll} />
              <h3 style={{ margin: 0 }}>{results.length} results</h3>
              {selected.size > 0 && (
                <span className="mono" style={{ fontSize: 11, color: 'var(--stc-red)' }}>
                  {`// `}{selected.size} SELECTED
                </span>
              )}
            </div>
            <div className="row">
              {selected.size > 0 && (
                <button onClick={handleAddBulk} className="btn btn--primary">
                  <Plus size={14} /> Add {selected.size} to CRM
                </button>
              )}
            </div>
          </div>
          <table className="adm-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}></th>
                <th>Company</th>
                <th>Employees</th>
                <th>Location</th>
                <th>Industry</th>
                <th>Domain</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {results.map((c, i) => {
                const isAdded = added[c.name];
                const isSelected = selected.has(c.name);
                return (
                  <tr key={`${c.name}-${i}`} style={{ background: isSelected ? 'rgba(207,36,23,0.06)' : undefined }}>
                    <td><input type="checkbox" checked={isSelected} onChange={() => toggleRow(c.name)} disabled={!!isAdded} /></td>
                    <td style={{ color: 'var(--fg-1)', fontWeight: 500 }}>
                      <Building size={12} style={{ verticalAlign: 'text-bottom', marginRight: 6, color: 'var(--fg-4)' }} />
                      {c.name}
                    </td>
                    <td className="tnum">{c.employees ?? '—'}</td>
                    <td>{c.location || '—'}</td>
                    <td style={{ color: 'var(--fg-3)' }}>{c.industry || '—'}</td>
                    <td className="mono" style={{ color: 'var(--fg-3)', fontSize: 12 }}>{c.domain || '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {isAdded ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--stc-success)', fontSize: 12 }}>
                          <CheckCircle size={12} /> Added
                        </span>
                      ) : (
                        <button onClick={() => handleAddSingle(c)} className="btn btn--sm">
                          <Plus size={12} /> Add
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {listPickerFor && (
        <div className="modal-bg" onClick={() => setListPickerFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__head">
              <h3 style={{ margin: 0 }}>
                Add {listPickerFor.kind === 'single' ? listPickerFor.company.name : `${listPickerFor.companies.length} companies`} to…
              </h3>
              <button onClick={() => setListPickerFor(null)} className="btn btn--icon btn--sm"><X size={14} /></button>
            </div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {lists.map((l) => (
                <button key={l.id}
                  onClick={() => addToCrm(listPickerFor.kind === 'single' ? [listPickerFor.company] : listPickerFor.companies, l.id)}
                  className="btn" style={{ justifyContent: 'flex-start', height: 40 }}>
                  {l.is_global ? <Globe size={14} /> : <Users size={14} />} {l.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <div className="field__label">{label}</div>
      {children}
    </div>
  );
}
