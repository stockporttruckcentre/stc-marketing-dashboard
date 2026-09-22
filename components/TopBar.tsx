'use client';

import { usePathname } from 'next/navigation';
import { Hash, HelpCircle } from 'lucide-react';
import { CommandBar } from '@/components/dashboard/CommandBar';
import { NotificationBell } from '@/components/notifications/bell';
import { crumbsFor } from '@/lib/nav';
import type { UserRole } from '@/lib/types';

/* The breadcrumb reads `lib/nav.ts`, the same file the sidebar draws
   from. It used to keep its own map, which was missing fourteen
   screens: half the product told you that you were on the Dashboard
   when you were not. One list, so it cannot happen again. */

export function TopBar({ role = 'viewer', caps }: { role?: UserRole; caps?: string[] }) {
  const path = usePathname();

  const crumbs = crumbsFor(path);

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
        <CommandBar variant="bar" role={role} caps={caps} />
      </div>

      <div className="topbar__right">
        <NotificationBell />
        {/* The command bar IS the help, so Help opens it. This button
            had no handler at all and did nothing on every page the top
            bar appears on, which is the whole of the application. */}
        <button
          className="btn btn--icon"
          title="Help: ask the command bar anything"
          aria-label="Help: ask the command bar anything"
          onClick={() => window.dispatchEvent(new Event('stc:open-command-bar'))}
        >
          <HelpCircle size={14} />
        </button>
      </div>
    </header>
  );
}
