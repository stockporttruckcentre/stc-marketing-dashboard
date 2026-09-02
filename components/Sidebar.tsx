'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, BarChart3, TrendingUp, Users, Search, Container, Calendar,
  Image as ImageIcon, ShieldCheck, Settings, LogOut, CalendarDays, ListChecks,
  UserCog, Receipt, type LucideIcon,
} from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { NotificationRail } from '@/components/notifications/rail';
import { capabilitiesFor } from '@/lib/crm/permissions';
import { visibleSections, type NavIcon } from '@/lib/nav';
import type { Profile } from '@/lib/types';

/* =============================================================
   The sidebar.

   ---- What it no longer holds ----

   The list of screens. That lives in `lib/nav.ts` now, as plain data,
   because the breadcrumb needs the same list and two copies of it had
   already drifted apart. This file draws whatever that file says.

   ---- Icons resolved by name ----

   The configuration names an icon as a string, so it can one day be
   rows in a table. A React component cannot go in a table. This map is
   the one place the name becomes a component.

   ---- Gated on capability ----

   Not on a list of roles. Turning a permission off now takes the row
   out of the sidebar as well as refusing the screen behind it, so
   nobody is shown a door that will not open.

   ---- Team and Settings under the scroll ----

   Settings is the one thing everybody knows they want by name, and the
   one thing that should never move. It was row twelve of a scrolling
   list. It is pinned now, in its own section, separated by a rule
   rather than by more air: a rule reads as a different kind of thing
   starting, more air reads as the list continuing loosely.

   No heading on that section. Two rows do not need one.
   ============================================================= */

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  analytics: BarChart3,
  work: ListChecks,
  diary: CalendarDays,
  news: TrendingUp,
  crm: Users,
  tracker: TrendingUp,
  finder: Search,
  stock: Container,
  fleetsmart: ShieldCheck,
  revenue: Receipt,
  social: Calendar,
  brand: ImageIcon,
  team: Users,
  settings: Settings,
  admin: UserCog,
};

export function Sidebar({
  profile, pendingPosts = 0, emblemUrl = null,
}: {
  profile: Profile;
  pendingPosts?: number;
  emblemUrl?: string | null;
}) {
  const path = usePathname();

  const sections = useMemo(() => {
    const caps = capabilitiesFor(profile);
    return visibleSections((c) => caps.has(c));
  }, [profile]);

  const isActive = (href: string) => (
    href === '/dashboard' ? path === '/dashboard' : path.startsWith(href)
  );

  const rows = (items: ReturnType<typeof visibleSections>[number]['items']) => (
    <div className="sidebar__nav">
      {items.map((i) => {
        const Icon = ICONS[i.icon];
        const badge = i.badge === 'content' && pendingPosts > 0 ? String(pendingPosts) : undefined;
        return (
          <Link
            key={i.href}
            href={i.href}
            className={`sidebar__item${isActive(i.href) ? ' is-active' : ''}`}
          >
            <Icon size={16} />
            <span>{i.label}</span>
            {badge && <span className="badge badge--alert">{badge}</span>}
          </Link>
        );
      })}
    </div>
  );

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        {emblemUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={emblemUrl} alt="STC" width={38} height={38}
            style={{ borderRadius: 6, objectFit: 'contain' }} />
        ) : (
          <div style={{ width: 38, height: 38, borderRadius: 6, background: 'var(--bg-3)' }} />
        )}
        <div className="sidebar__brand-text">
          <div className="sidebar__brand-title">STC Workspace</div>
          <div className="sidebar__brand-sub">Marketing &amp; Sales</div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sections.filter((s) => !s.atFoot).map((s) => (
          <div key={s.key} className="sidebar__section">
            <div className="sidebar__section-head"><span>{s.label}</span></div>
            {rows(s.items)}
          </div>
        ))}
      </div>

      {sections.filter((s) => s.atFoot).map((s) => (
        <div key={s.key} className="sidebar__section sidebar__section--foot">
          {rows(s.items)}
        </div>
      ))}

      <NotificationRail />

      <div className="sidebar__footer">
        <div className="avatar">
          {profile.full_name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
        </div>
        <div className="sidebar__user">
          <div className="sidebar__user-name">{profile.full_name}</div>
          <div className="sidebar__user-role">{profile.role}</div>
        </div>
        <ThemeToggle profileId={profile.id} initialTheme={profile.theme ?? 'dark'} />
        <form action="/auth/signout" method="post">
          <button type="submit" title="Sign out" className="btn btn--icon" aria-label="Sign out">
            <LogOut size={14} />
          </button>
        </form>
      </div>
    </aside>
  );
}
