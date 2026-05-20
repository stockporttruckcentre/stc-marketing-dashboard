'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Hash, Search, Bell, HelpCircle, Building } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { CRMContact } from '@/lib/types';

const CRUMBS: Record<string, [string, string]> = {
  '/dashboard':           ['Workspace', 'Dashboard'],
  '/dashboard/calendar':  ['Workspace', 'Team calendar'],
  '/dashboard/news':      ['Workspace', 'Industry news'],
  '/dashboard/crm':       ['Sales',     'CRM pipeline'],
  '/dashboard/finder':    ['Sales',     'Company finder'],
  '/dashboard/sales':     ['Sales',     'Trailer sales'],
  '/dashboard/social':    ['Marketing', 'Social planner'],
  '/dashboard/brand':     ['Marketing', 'Brand kit'],
  '/dashboard/admin':     ['Admin',     'Team'],
  '/dashboard/settings':  ['Admin',     'Settings'],
};

export function TopBar() {
  const router = useRouter();
  const path = usePathname();
  const [balance, setBalance] = useState<number | null>(null);
  const [breakdown, setBreakdown] = useState<any>(null);
  const [balanceErr, setBalanceErr] = useState<string | null>(null);
  const isCrm = path?.startsWith('/dashboard/crm');

  let crumbs: [string, string] = ['Workspace', 'Dashboard'];
  for (const key of Object.keys(CRUMBS)) {
    if (path === key || path.startsWith(key + '/')) crumbs = CRUMBS[key];
  }

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const res = await fetch('/api/lusha/balance', { cache: 'no-store' });
        const json = await res.json();
        if (!mounted) return;
        if (res.ok && typeof json.balance === 'number') { setBalance(json.balance); setBalanceErr(null); setBreakdown(json.breakdown ?? null); }
        else { setBalance(null); setBalanceErr(json.error || 'no balance'); }
      } catch (e: any) {
        if (!mounted) return;
        setBalanceErr(e.message || 'fetch failed');
      }
    }
    load();
    const id = setInterval(load, 90_000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  return (
    <header className="topbar topbar--has-search">
      <div className="topbar__crumbs">
        <Hash size={14} style={{ color: 'var(--stc-red)' }} />
        <span>{crumbs[0]}</span>
        <span className="sep">/</span>
        <span className="cur">{crumbs[1]}</span>
      </div>

      {isCrm ? (
        <div className="topbar__search-wrap">
          <CrmSearch onPick={(id, listId) => router.push(`/dashboard/crm?list=${listId}&contact=${id}`)} />
        </div>
      ) : (
        <div className="topbar__search-wrap topbar__search-wrap--ghost" />
      )}

      <div className="topbar__right">
        <div className="lusha" title={balanceErr ? `Lusha: ${balanceErr}` : (breakdown ? Object.entries(breakdown).map(([k,v]: any) => `${k}: ${v?.remaining ?? '?'} remaining (${v?.used ?? '?'}/${v?.total ?? '?'} used)`).join('\n') : 'Lusha Balance — live (account/usage)')}>
          <span className="lusha__dot" />
          <span className="lusha__label">BALANCE</span>
          <span className="lusha__value tnum">
            {balance === null ? (balanceErr ? '—' : '…') : balance.toLocaleString()}
          </span>
        </div>
        <button className="btn btn--icon" title="Notifications" aria-label="Notifications"><Bell size={14} /></button>
        <button className="btn btn--icon" title="Help" aria-label="Help"><HelpCircle size={14} /></button>
      </div>
    </header>
  );
}

// ========== CRM search (debounced live results) ==========
function CrmSearch({ onPick }: { onPick: (contactId: string, listId: string) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<(CRMContact & { list_name?: string | null })[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global Ctrl+K / Cmd+K to focus the search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isShortcut = (e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K');
      if (isShortcut) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Close on outside click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Debounced query
  useEffect(() => {
    const trimmed = q.trim();
    if (!trimmed) { setResults([]); return; }
    const handle = setTimeout(async () => {
      const like = `%${trimmed}%`;
      const { data } = await supabase
        .from('crm_contacts')
        .select('id, list_id, company_name, contact_name, email, phone, location, status, crm_lists(name)')
        .or(`company_name.ilike.${like},contact_name.ilike.${like},email.ilike.${like},phone.ilike.${like},location.ilike.${like}`)
        .limit(8);
      const mapped = (data ?? []).map((r: any) => ({ ...r, list_name: r.crm_lists?.name ?? null }));
      setResults(mapped as any);
      setHighlight(0);
      setOpen(true);
    }, 180);
    return () => clearTimeout(handle);
  }, [q, supabase]);

  function pick(r: any) {
    onPick(r.id, r.list_id);
    setQ('');
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && results[highlight]) { e.preventDefault(); pick(results[highlight]); }
    else if (e.key === 'Escape') setOpen(false);
  }

  return (
    <div ref={wrapRef} className="crm-search">
      <Search size={14} />
      <input ref={inputRef}
        type="text" placeholder="Search CRM contacts..." value={q}
        onChange={(e) => setQ(e.target.value)} onFocus={() => q && setOpen(true)} onKeyDown={onKey}
      />
      <span className="kbd">Ctrl K</span>

      {open && results.length > 0 && (
        <div className="crm-search__dropdown">
          {results.map((r, i) => (
            <button key={r.id} className={`crm-search__row${i === highlight ? ' is-active' : ''}`} onMouseDown={(e) => { e.preventDefault(); pick(r); }}>
              <Building size={14} style={{ color: 'var(--fg-4)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="crm-search__title">{r.company_name}</div>
                <div className="crm-search__sub">
                  {[r.contact_name, r.location, r.email].filter(Boolean).join(' · ')}
                  {r.list_name && <span className="mono" style={{ marginLeft: 8, color: 'var(--fg-4)' }}>· {r.list_name}</span>}
                </div>
              </div>
              <span className={`pill pill--${r.status}`}><span className="pill__dot" />{r.status}</span>
            </button>
          ))}
        </div>
      )}
      {open && q.trim() && results.length === 0 && (
        <div className="crm-search__dropdown">
          <div className="crm-search__empty">No matches for &ldquo;{q}&rdquo;</div>
        </div>
      )}
    </div>
  );
}
