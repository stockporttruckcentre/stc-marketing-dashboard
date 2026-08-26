'use client';

import { usePathname } from 'next/navigation';
import { Hash, Bell, HelpCircle } from 'lucide-react';
import { CommandBar } from '@/components/dashboard/CommandBar';
import type { UserRole } from '@/lib/types';

const CRUMBS: Record<string, [string, string]> = {
  '/dashboard':           ['Workspace', 'Dashboard'],
  '/dashboard/work':      ['Workspace', 'Work'],
  '/dashboard/calendar':  ['Workspace', 'Diary'],
  '/dashboard/news':      ['Workspace', 'Industry news'],
  // Analytics and the tracker were missing, so both showed the fallback
  // and told you you were on the Dashboard when you were not.
  '/dashboard/analytics': ['Workspace', 'Analytics'],
  '/dashboard/crm':       ['Sales',     'CRM pipeline'],
  '/dashboard/leads':     ['Sales',     'Sales tracker'],
  '/dashboard/finder':    ['Sales',     'Company finder'],
  '/dashboard/sales':     ['Sales',     'Trailer sales'],
  '/dashboard/fleetsmart': ['Sales',    'FleetSmart+'],
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

  /* Three columns rather than a flex row.

     Flex centred it against whatever was left over, so the bar shifted
     sideways every time the breadcrumb changed length: Dashboard and
     Company finder are different widths and the thing people aim at
     moved between pages. Equal outer columns hold it in the middle of
     the window whatever is either side of it. */
  return (
    <header className="topbar topbar--command">
      <div className="topbar__crumbs">
        <Hash size={14} style={{ color: 'var(--stc-red)' }} />
        <span>{crumbs[0]}</span>
        <span className="sep">/</span>
        <span className="cur">{crumbs[1]}</span>
      </div>

      {/* The command bar is the point of the product, so it gets the
          middle of the screen and the width to look like it. */}
      <div className="topbar__command">
        <CommandBar variant="bar" role={role} />
      </div>

      <div className="topbar__right">
        <button className="btn btn--icon" title="Notifications" aria-label="Notifications"><Bell size={14} /></button>
        <button className="btn btn--icon" title="Help" aria-label="Help"><HelpCircle size={14} /></button>
      </div>
    </header>
  );
}
