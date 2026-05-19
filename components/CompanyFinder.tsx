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
  name: string;
  employees: number | null;
  location: string;
  distance: number | null;
  domain: string | null;
  industry: string | null;
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
    setSearching(true);
    setMessage(null);
    setAdded({});
    try {
      const res = await fetch('/api/lusha/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: depot,
          radiusMiles: radius,
          industry,
          minEmployees: empMin,
          maxEmployees: empMax,
          limit: 25,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Search failed');
      setResults(json.companies);
      setMessage(`Found ${json.companies.length} companies (${json.cost} credits used)`);
    } catch (e: any) {
      setMessage(e.message);
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function addToCrm(c: FinderResult) {
    const { error } = await supabase.from('crm_contacts').insert({
      company_name: c.name,
      location: c.location,
      fleet_size: c.employees,
      source: 'Lusha Company Finder',
      status: 'lead',
      notes: c.domain ? `Domain: ${c.domain}` : null,
    });
    if (error) { setMessage(error.message); return; }
    setAdded(a => ({ ...a, [c.name]: true }));
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-5">
        <h2 className="text-lg font-semibold mb-4">Find companies near your depots</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
          <Field label="Depot">
            <select value={depot} onChange={(e) => setDepot(e.target.value)} className="w-full px-3 py-2 border rounded-lg">
              {DEPOTS.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Radius (mi)">
            <input type="number" value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="w-full px-3 py-2 border rounded-lg" />
          </Field>
          <Field label="Industry">
            <select value={industry} onChange={(e) => setIndustry(e.target.value)} className="w-full px-3 py-2 border rounded-lg">
              {INDUSTRIES.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
            </select>
          </Field>
          <Field label="Employees min">
            <input type="number" value={empMin} onChange={(e) => setEmpMin(Number(e.target.value))} className="w-full px-3 py-2 border rounded-lg" />
          </Field>
          <Field label="Employees max">
            <input type="number" value={empMax} onChange={(e) => setEmpMax(Number(e.target.value))} className="w-full px-3 py-2 border rounded-lg" />
          </Field>
        </div>
        <button
          onClick={handleSearch}
          disabled={searching}
          className="px-5 py-2 bg-stc-navy text-white rounded-lg hover:bg-stc-navy-light disabled:opacity-50 flex items-center gap-2"
        >
          {searching ? <Loader size={16} className="animate-spin" /> : <Search size={16} />}
          Search
        </button>
      </div>

      {message && <div className="bg-blue-50 border border-blue-200 text-blue-900 rounded-lg px-4 py-2 text-sm">{message}</div>}

      {results.length > 0 && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <Th>Company</Th>
                <Th>Employees</Th>
                <Th>Location</Th>
                <Th>Industry</Th>
                <Th>Domain</Th>
                <Th className="text-right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {results.map((c, i) => (
                <tr key={`${c.name}-${i}`} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3">{c.employees ?? '—'}</td>
                  <td className="px-4 py-3">{c.location || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{c.industry || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{c.domain || '—'}</td>
                  <td className="px-4 py-3 text-right">
                    {added[c.name] ? (
                      <span className="inline-flex items-center gap-1 text-green-700 text-sm">
                        <CheckCircle size={14} /> Added
                      </span>
                    ) : (
                      <button onClick={() => addToCrm(c)} className="px-3 py-1.5 bg-stc-navy text-white text-sm rounded hover:bg-stc-navy-light inline-flex items-center gap-1">
                        <Plus size={14} /> Add to CRM
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase ${className}`}>{children}</th>;
}
