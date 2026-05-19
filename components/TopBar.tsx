'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Hash, Search, Bell, HelpCircle } from 'lucide-react';

const CRUMBS: Record<string, [string, string]> = {
  '/dashboard':           ['Workspace', 'Dashboard'],
  '/dashboard/news':      ['Workspace', 'Industry news'],
  '/dashboard/calendar':  ['Workspace', 'Team calendar'],
  '/dashboard/crm':       ['Sales',     'CRM pipeline'],
  '/dashboard/finder':    ['Sales',     'Company finder'],
  '/dashboard/sales':     ['Sales',     'Trailer sales'],
  '/dashboard/social':    ['Marketing', 'Social planner'],
  '/dashboard/brand':     ['Marketing', 'Brand kit'],
  '/dashboard/admin':     ['Admin',     'Roles & approvals'],
  '/dashboard/settings':  ['Admin',     'Settings'],
};

export function TopBar({ initialLushaBalance }: { initialLushaBalance: number }) {
  const path = usePathname();
  const [q, setQ] = useState('');
  const [balance, setBalance] = useState(initialLushaBalance);

  // Find best matching crumb
  let crumbs: [string, string] = ['Workspace', 'Dashboard'];
  for (const key of Object.keys(CRUMBS)) {
    if (path === key || path.startsWith(key + '/')) crumbs = CRUMBS[key];
  }

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch('/api/lusha/balance', { cache: 'no-store' });
        if (res.ok) {
          const j = await res.json();
          setBalance(j.balance);
        }
      } catch {}
    }, 30_000);
    return () => clearInterval(id);
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
        <input
          placeholder="Search contacts, posts, trailers..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="kbd">⌘K</span>
      </div>

      <div className="topbar__right">
        <div className="lusha" title="Lusha enrichment credits remaining">
          <span className="lusha__dot" />
          <span className="lusha__label">LUSHA</span>
          <span className="lusha__value tnum">{balance.toLocaleString()}</span>
        </div>
        <button className="btn btn--icon" title="Notifications" aria-label="Notifications">
          <Bell size={14} />
        </button>
        <button className="btn btn--icon" title="Help" aria-label="Help">
          <HelpCircle size={14} />
        </button>
      </div>
    </header>
  );
}
