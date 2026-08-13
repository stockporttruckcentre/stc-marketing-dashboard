'use client';

import { usePathname } from 'next/navigation';
import { Hash, Bell, HelpCircle } from 'lucide-react';
import { CommandBar } from '@/components/dashboard/CommandBar';
import type { UserRole } from '@/lib/types';

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

export function TopBar({ role = 'viewer' }: { role?: UserRole }) {
  const path = usePathname();

  let crumbs: [string, string] = ['Workspace', 'Dashboard'];
  for (const key of Object.keys(CRUMBS)) {
    if (path === key || path.startsWith(key + '/')) crumbs = CRUMBS[key];
  }

  return (
    <header className="topbar">
      <div className="topbar__crumbs">
        <Hash size={14} style={{ color: 'var(--stc-red)' }} />
        <span>{crumbs[0]}</span>
        <span className="sep">/</span>
        <span className="cur">{crumbs[1]}</span>
      </div>

      {/* The command bar is global, so it lives here rather than on the
          dashboard. Margin on both sides keeps it off the breadcrumbs to
          its left and the bell to its right: it is the widest thing in a
          52px bar and without the gaps it reads as one welded strip. */}
      <div style={{ flex: 1, minWidth: 0, maxWidth: 620, margin: '0 18px' }}>
        <CommandBar variant="bar" role={role} />
      </div>

      <div className="topbar__right">
        <button className="btn btn--icon" title="Notifications" aria-label="Notifications"><Bell size={14} /></button>
        <button className="btn btn--icon" title="Help" aria-label="Help"><HelpCircle size={14} /></button>
      </div>
    </header>
  );
}
