'use client';

import { useState } from 'react';
import { Loader, Search, Plus, CheckCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { DEPOTS } from '@/lib/types';

const INDUSTRIES = [
  { value: 'transportation/trucking/railroad', label: 'Transport & Logistics' },
  { value: 'construction',                     label: 'Construction' },
  { value: 'wholesale',                        label: 'Wholesale & Distribution' },
  { value: 'machinery',                        label: 'Machinery / Manufacturing' },
  { value: 'retail',                           label: 'Retail' },
  { value: 'food production',                  label: 'Food production' },
];

interface FinderResult {
  name: string; employees: number | null; location: string;
  distance: number | null; domain: string | null; industry: string | null;
}

export function CompanyFinder() {
  const supabase = createClient();
  const [depot, setDepot] = useState<string>('Hyde');
  const [radius, setRadius] = useState(10);
  const [industry, setIndustry] = useState(INDUSTRIES[0].value);
  const [empMin, setEmpMin] = useState(10);
  const [empMax, setEmpMax] = useState(200);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<FinderResult[]>([]);
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function handleSearch() {
    setSearching(true); setMessage(null); setAdded({});
    try {
      const res = await fetch('/api/lusha/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: depot, radiusMiles: radius, industry,
          minEmployees: empMin, maxEmployees: empMax, limit: 25,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Search failed');
      setResults(json.companies);
      setMessage(`Found ${json.companies.length} companies (${json.cost} credits used)`);
    } catch (e: any) {
      setMessage(e.message); setResults([]);
    } finally { setSearching(false); }
  }

  async function addToCrm(c: FinderResult) {
    const { error } = await supabase.from('crm_contacts').insert({
      company_name: c.name, location: c.location, fleet_size: c.employees,
      source: 'Lusha Company Finder', status: 'lead',
      notes: c.domain ? `Domain: ${c.domain}` : null,
    });
    if (error) { setMessage(error.message); return; }
    setAdded(a => ({ ...a, [c.name]: true }));
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-head__eyebrow">Sales · Company finder</div>
          <h1 className="page-head__title">Find prospects<span style={{ color: 'var(--stc-red)' }}>.</span></h1>
          <div className="page-head__sub">Lusha company search around each depot. One credit per result returned.</div>
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div className="grid-5">
          <div className="field"><div className="field__label">Depot</div>
            <select value={depot} onChange={(e) => setDepot(e.target.value)} className="input">
              {DEPOTS.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
            </select></div>
          <div className="field"><div className="field__label">Radius (mi)</div>
            <input type="number" value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="input" /></div>
          <div className="field"><div className="field__label">Industry</div>
            <select value={industry} onChange={(e) => setIndustry(e.target.value)} className="input">
              {INDUSTRIES.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
            </select></div>
          <div className="field"><div className="field__label">Employees min</div>
            <input type="number" value={empMin} onChange={(e) => setEmpMin(Number(e.target.value))} className="input" /></div>
          <div className="field"><div className="field__label">Employees max</div>
            <input type="number" value={empMax} onChange={(e) => setEmpMax(Number(e.target.value))} className="input" /></div>
        </div>
        <div style={{ marginTop: 14 }}>
          <button onClick={handleSearch} disabled={searching} className="btn btn--primary btn--lg">
            {searching ? <Loader size={14} className="spin" /> : <Search size={14} />} Search
          </button>
        </div>
      </div>

      {message && <div className="alert alert--info" style={{ marginTop: 14 }}>{message}</div>}

      {results.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card__head">
            <h3 style={{ margin: 0 }}>Results</h3>
            <span className="mono" style={{ color: 'var(--fg-3)', fontSize: 11 }}>
              WITHIN {radius} MI OF {depot.toUpperCase()}
            </span>
          </div>
          <table className="adm-table">
            <thead>
              <tr>
                <th>Company</th><th>Employees</th><th>Location</th><th>Industry</th><th>Domain</th><th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {results.map((c, i) => (
                <tr key={`${c.name}-${i}`}>
                  <td style={{ color: 'var(--fg-1)', fontWeight: 500 }}>{c.name}</td>
                  <td className="tnum">{c.employees ?? '—'}</td>
                  <td>{c.location || '—'}</td>
                  <td style={{ color: 'var(--fg-3)' }}>{c.industry || '—'}</td>
                  <td className="mono" style={{ color: 'var(--fg-3)', fontSize: 12 }}>{c.domain || '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    {added[c.name] ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--stc-success)', fontSize: 12 }}>
                        <CheckCircle size={12} /> Added
                      </span>
                    ) : (
                      <button onClick={() => addToCrm(c)} className="btn btn--sm btn--primary">
                        <Plus size={12} /> Add
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
