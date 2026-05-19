'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Users, Calendar, Search, Package, Image as ImageIcon, TrendingUp,
} from 'lucide-react';
import type { UserRole } from '@/lib/types';

const tabs = [
  { href: '/dashboard/crm',    label: 'CRM Pipeline',   icon: Users,        roles: ['admin','marketer','sales','viewer'] as UserRole[] },
  { href: '/dashboard/social', label: 'Social Planner', icon: Calendar,     roles: ['admin','marketer','viewer'] as UserRole[] },
  { href: '/dashboard/finder', label: 'Company Finder', icon: Search,       roles: ['admin','marketer','sales','viewer'] as UserRole[] },
  { href: '/dashboard/sales',  label: 'Trailer Sales',  icon: Package,      roles: ['admin','sales','marketer','viewer'] as UserRole[] },
  { href: '/dashboard/brand',  label: 'Brand Kit',      icon: ImageIcon,    roles: ['admin','marketer','sales','viewer'] as UserRole[] },
  { href: '/dashboard/news',   label: 'Industry News',  icon: TrendingUp,   roles: ['admin','marketer','sales','viewer'] as UserRole[] },
];

export function Nav({ role }: { role: UserRole }) {
  const path = usePathname();
  return (
    <nav className="bg-white border-b sticky top-0 z-10">
      <div className="max-w-screen-3xl mx-auto px-6 flex gap-1 overflow-x-auto">
        {tabs.filter(t => t.roles.includes(role)).map(({ href, label, icon: Icon }) => {
          const active = path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 whitespace-nowrap transition-colors ${
                active
                  ? 'border-stc-red text-stc-navy font-semibold'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
