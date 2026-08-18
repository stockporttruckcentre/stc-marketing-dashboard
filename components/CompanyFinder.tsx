'use client';

import { useMemo, useState } from 'react';
import { Loader, Search, Plus, CheckCircle, Globe, Users, X, MapPin, Building, Sparkles, Briefcase, Hash } from 'lucide-react';
import { Alert } from '@/components/kit/primitives';
import { LUSHA_LOCKED } from '@/lib/crm/permissions';
import { createClient } from '@/lib/supabase/client';
import { DEPOTS, type CrmList } from '@/lib/types';
import { asContactRows } from '@/lib/crm/finder';
import { commitImport } from '@/lib/import/commit';
import { BusinessActivityStrip } from './BusinessActivityStrip';

// LinkedIn / Lusha numeric industry IDs (mainIndustriesIds)
const INDUSTRIES = [
  { id: 0,   label: 'All industries (recommended)' },
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
  const [industry, setIndustry] = useState<number>(0);
  const [empMin, setEmpMin] = useState(1);
  const [empMax, setEmpMax] = useState(10000);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<FinderResult[]>([]);
  const [added, setAdded] = useState<Record<string, string>>({}); // name -> list_id added to
  const [message, setMessage] = useState<string | null>(null);
  const [diag, setDiag] = useState<any>(null);
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
          location: isCustom
            ? customPostcode
            : (DEPOTS.find(d => d.name === depotKey)?.lushaCity ?? depotKey),
          radiusMiles: radius,
          ...(industry > 0 ? { industryIds: [industry] } : {}),
          minEmployees: empMin, maxEmployees: empMax, limit: 25,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Search failed');
      setResults(json.companies);
      setDiag(json._diag ?? null);
      setMessage(`Found ${json.companies.length} companies within ${radius} mi of ${locationLabel()}`);
    } catch (e: any) {
      setMessage(e.message); setResults([]);
    } finally { setSearching(false); }
  }

  /* The same operation the command bar performs, in one transaction.
     This used to insert straight from the browser, which put the
     allowlist and the permission in code somebody can edit in a
     console, and wrote `fleet_size` from Lusha's employee count: a
     column a trigger derives from the three vehicle counts, so the
     number was written and then thrown away. */
  async function addToCrm(companies: FinderResult[], listId: string) {
    const done = await commitImport(supabase, {
      rows: asContactRows(companies),
      listId,
    });
    if (!done.ok) { setMessage(done.why); return; }
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
    <div className="cf-hub">
      <div className="cf-hero">
        <div>
          <div className="cf-hero__eyebrow"><Sparkles size={11} /> Prospecting · Lusha</div>
          <h1>Find your next customer</h1>
          <div className="cf-hero__sub">Search any STC depot, custom postcode, or radius via Lusha. Add results in bulk to any CRM list.</div>
        </div>
      </div>

      {/* The lock the meeting asked for at rollout. Said out loud rather
          than left as buttons that quietly fail, and the routes refuse it
          server side too, because hiding a button is not a lock. */}
      {LUSHA_LOCKED && (
        <div className="kit" style={{ marginBottom: 14 }}>
          <Alert tone="warning">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <strong>Lusha searching is switched off</strong>
              <span>
                Searches and enrichment come out of a shared monthly credit
                allowance, so it stays off until it is agreed who can spend
                them. Nothing here will charge anything in the meantime.
              </span>
            </div>
          </Alert>
        </div>
      )}

      <div className="cf-tabs" role="tablist">
        <button onClick={() => setTab('finder')}
          className={`cf-tab ${tab === 'finder' ? 'is-active' : ''}`}>
          <Search size={12} /> Company Finder
        </button>
        <button onClick={() => setTab('company')}
          className={`cf-tab ${tab === 'company' ? 'is-active' : ''}`}>
          <Briefcase size={12} /> Insolvency Updates
        </button>
      </div>

      {tab === 'company' ? (
        <BusinessActivityStrip />
      ) : (
      <>
      <div className="cf-card">
        <div className="cf-search-grid">
          <CfField label="Location" Icon={MapPin}>
            <select value={depotKey} onChange={(e) => setDepotKey(e.target.value)} className="cf-input">
              <optgroup label="STC Depots">
                {DEPOTS.map((d) => <option key={d.name} value={d.name}>STC {d.name}</option>)}
              </optgroup>
              <option value="__custom__">Custom postcode / city…</option>
            </select>
          </CfField>
          {isCustom && (
            <CfField label="Postcode or city" Icon={MapPin}>
              <input type="text" value={customPostcode} onChange={(e) => setCustomPostcode(e.target.value)}
                placeholder="e.g. M1 2AB · Liverpool · Wakefield"
                className="cf-input" autoFocus />
            </CfField>
          )}
          <CfField label="Radius (miles)" Icon={Hash}>
            <input type="number" min={1} max={300} value={radius}
              onChange={(e) => setRadius(Number(e.target.value))} className="cf-input" />
          </CfField>
          <CfField label="Industry" Icon={Briefcase}>
            <select value={industry} onChange={(e) => setIndustry(Number(e.target.value))} className="cf-input">
              {INDUSTRIES.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
            </select>
          </CfField>
          <CfField label="Employees · min" Icon={Users}>
            <input type="number" min={1} value={empMin}
              onChange={(e) => setEmpMin(Number(e.target.value))} className="cf-input" />
          </CfField>
          <CfField label="Employees · max" Icon={Users}>
            <input type="number" min={1} value={empMax}
              onChange={(e) => setEmpMax(Number(e.target.value))} className="cf-input" />
          </CfField>
        </div>
        <div className="cf-actions">
          <div className="cf-summary">
            <MapPin size={13} />
            <strong>{locationLabel()}</strong>
            <span className="cf-summary__sub">· within {radius} mi · {empMin} to {empMax} employees</span>
          </div>
          <button onClick={handleSearch}
            disabled={LUSHA_LOCKED || searching || (isCustom && !customPostcode.trim())}
            title={LUSHA_LOCKED ? 'Switched off until a credit policy is agreed' : undefined}
            className="cf-btn-primary">
            {searching ? <Loader size={14} className="spin" /> : <Search size={14} />}
            {LUSHA_LOCKED ? 'Switched off' : searching ? 'Searching…' : 'Search Lusha'}
          </button>
        </div>
      </div>

      {message && <div className="alert alert--info" style={{ marginTop: 14, background: 'var(--cf-surface-1)', border: '1px solid var(--cf-border)', borderRadius: 10, padding: 12, color: 'var(--cf-text-1)', fontSize: 13 }}>{message}</div>}
      {diag && (
        <details style={{ marginTop: 10, background: 'var(--cf-surface-0)', border: '1px solid var(--cf-border)', borderRadius: 10, padding: 12, fontSize: 12, color: 'var(--cf-text-2)' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--cf-text-1)', fontWeight: 600 }}>Lusha diagnostics (click to expand)</summary>
          <pre style={{ marginTop: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5, lineHeight: 1.4 }}>{JSON.stringify(diag, null, 2)}</pre>
        </details>
      )}

      {results.length > 0 && (
        <div className="cf-results">
          <div className="cf-results__head">
            <div className="cf-results__title">
              <input type="checkbox" className="cf-checkbox"
                checked={selected.size === results.length} onChange={toggleAll} />
              Results
              <span className="cf-results__title__count">{results.length}</span>
              {selected.size > 0 && (
                <span className="cf-results__title__count" style={{ color: 'var(--cf-stc-red)' }}>
                  {selected.size} selected
                </span>
              )}
            </div>
            {selected.size > 0 && (
              <button onClick={handleAddBulk} className="cf-bulk-cta">
                <Plus size={13} /> Add {selected.size} to CRM
              </button>
            )}
          </div>

          <div>
            {results.map((c, i) => {
              const isAdded = added[c.name];
              const isSelected = selected.has(c.name);
              const initials = c.name.split(/\s+/).filter(Boolean).slice(0,2).map(s => s[0]?.toUpperCase() ?? '').join('') || '·';
              const palette = [
                ['#ff3b2d', '#cf2417'],
                ['#4d63ff', '#071458'],
                ['#22d3ee', '#0ea5e9'],
                ['#a78bfa', '#7c3aed'],
                ['#20c997', '#15a085'],
                ['#f7b500', '#d97706'],
              ];
              let h = 0;
              for (let j = 0; j < c.name.length; j++) h = (h * 31 + c.name.charCodeAt(j)) >>> 0;
              const [ax, ay] = palette[h % palette.length];
              return (
                <div key={`${c.name}-${i}`}
                  className={`cf-row ${isSelected ? 'is-selected' : ''} ${isAdded ? 'is-added' : ''}`}>
                  <input type="checkbox" className="cf-checkbox"
                    checked={isSelected} onChange={() => toggleRow(c.name)} disabled={!!isAdded} />
                  <div className="cf-row__company" style={{ ['--ax' as any]: ax, ['--ay' as any]: ay } as any}>
                    <span className="cf-row__company__avatar">{initials}</span>
                    <span className="cf-row__company__name">{c.name}</span>
                  </div>
                  <div className="cf-row__cell">{c.employees != null ? c.employees.toLocaleString() : '—'}</div>
                  <div className="cf-row__cell">{c.location || '—'}</div>
                  <div className="cf-row__cell cf-row__cell--muted">{c.industry || '—'}</div>
                  <div className="cf-row__action">
                    {isAdded ? (
                      <span className="cf-row__added"><CheckCircle size={12} /> Added</span>
                    ) : (
                      <button onClick={() => handleAddSingle(c)} className="cf-row__add-btn">
                        <Plus size={11} /> Add
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
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

function CfField({ label, Icon, children }: { label: string; Icon?: any; children: React.ReactNode }) {
  return (
    <div className="cf-field">
      <div className="cf-field__label">{Icon && <Icon size={11} />} {label}</div>
      {children}
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
