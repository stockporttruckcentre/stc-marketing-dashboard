'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, BarChart3, TrendingUp, Users, Search, Package, Calendar,
  Image as ImageIcon, ShieldCheck, Settings, LogOut, CalendarDays,
} from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { TruckIcon } from '@/components/TruckIcon';
import type { Profile, UserRole } from '@/lib/types';

type Item = { href: string; label: string; Icon: any; roles: UserRole[]; badge?: string; alert?: boolean };
type Section = { key: string; label: string; items: Item[] };

export function Sidebar({ profile, pendingPosts = 0, emblemUrl = null }: { profile: Profile; pendingPosts?: number; emblemUrl?: string | null }) {
  const path = usePathname();

  const sections: Section[] = [
    {
      key: 'workspace', label: 'Workspace',
      items: [
        { href: '/dashboard',          label: 'Dashboard',     Icon: LayoutDashboard, roles: ['admin','marketer','sales','viewer'] },
        { href: '/dashboard/analytics', label: 'Analytics',     Icon: BarChart3,       roles: ['admin','marketer','sales','viewer'] },
        { href: '/dashboard/calendar', label: 'Team calendar', Icon: CalendarDays,    roles: ['admin','marketer','sales','viewer'] },
        { href: '/dashboard/news',     label: 'Industry news', Icon: TrendingUp,      roles: ['admin','marketer','sales','viewer'] },
      ],
    },
    {
      key: 'sales', label: 'Sales',
      items: [
        { href: '/dashboard/crm',    label: 'CRM pipeline',   Icon: Users,    roles: ['admin','marketer','sales','viewer'] },
        { href: '/dashboard/leads',       label: 'Sales tracker', Icon: TrendingUp, roles: ['admin','marketer','sales','viewer'] },
        { href: '/dashboard/finder', label: 'Company finder', Icon: Search,   roles: ['admin','marketer','sales','viewer'] },
        { href: '/dashboard/sales',  label: 'Trailer sales',  Icon: TruckIcon, roles: ['admin','marketer','sales','viewer'] },
      ],
    },
    {
      key: 'marketing', label: 'Marketing',
      items: [
        { href: '/dashboard/social', label: 'Social planner', Icon: Calendar,  roles: ['admin','marketer','viewer'],
          badge: pendingPosts > 0 ? String(pendingPosts) : undefined, alert: pendingPosts > 0 },
        { href: '/dashboard/brand',  label: 'Brand kit',      Icon: ImageIcon, roles: ['admin','marketer','sales','viewer'] },
      ],
    },
    {
      key: 'admin', label: 'Admin',
      items: [
        { href: '/dashboard/admin',    label: 'Team', Icon: ShieldCheck, roles: ['admin'] },
        { href: '/dashboard/settings', label: 'Settings',          Icon: Settings,    roles: ['admin','marketer','sales','viewer'] },
      ],
    },
  ];

  const isActive = (href: string) => href === '/dashboard' ? path === '/dashboard' : path.startsWith(href);

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        {emblemUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={emblemUrl} alt="STC" width={38} height={38} style={{ borderRadius: 6, objectFit: 'contain' }} />
        ) : (
          <div style={{ width: 38, height: 38, borderRadius: 6, background: 'var(--bg-3)' }} />
        )}
        <div className="sidebar__brand-text">
          <div className="sidebar__brand-title">STC Workspace</div>
          <div className="sidebar__brand-sub">Marketing &amp; Sales</div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sections.map((s) => {
          const items = s.items.filter((i) => i.roles.includes(profile.role));
          if (!items.length) return null;
          return (
            <div key={s.key} className="sidebar__section">
              <div className="sidebar__section-head"><span>{s.label}</span></div>
              <div className="sidebar__nav">
                {items.map((i) => {
                  const active = isActive(i.href);
                  const Icon = i.Icon;
                  return (
                    <Link key={i.href} href={i.href} className={`sidebar__item${active ? ' is-active' : ''}`}>
                      <Icon size={16} />
                      <span>{i.label}</span>
                      {i.badge && <span className={`badge${i.alert ? ' badge--alert' : ''}`}>{i.badge}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

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
