'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Hash, Search, Bell, HelpCircle } from 'lucide-react';

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
  const path = usePathname();
  const [q, setQ] = useState('');
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceErr, setBalanceErr] = useState<string | null>(null);

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
        if (res.ok && typeof json.balance === 'number') {
          setBalance(json.balance);
          setBalanceErr(null);
        } else {
          setBalance(null);
          setBalanceErr(json.error || 'no balance');
        }
      } catch (e: any) {
        if (!mounted) return;
        setBalanceErr(e.message || 'fetch failed');
      }
    }
    load();
    const id = setInterval(load, 60_000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  return (
    <header className="topbar">
      <div className="topbar__crumbs">
        <Hash size={14} style={{ color: 'var(--stc-red)' }} />
        <span>{crumbs[0]}</span>
        <span className="sep">/</span>
        <span className="cur">{crumbs[1]}</span>
      </div>

      <div className="topbar__search">
        <Search size={14} />
        <input placeholder="Search contacts, posts, trailers..." value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="kbd">⌘K</span>
      </div>

      <div className="topbar__right">
        <div className="lusha" title={balanceErr ? `Lusha: ${balanceErr}` : 'Live Lusha balance'}>
          <span className="lusha__dot" />
          <span className="lusha__label">LUSHA</span>
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
