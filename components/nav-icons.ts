import {
  LayoutDashboard, BarChart3, TrendingUp, Users, Search, Container, Calendar,
  Image as ImageIcon, ShieldCheck, Settings, CalendarDays, ListChecks,
  UserCog, Receipt, Newspaper, Contact, type LucideIcon,
} from 'lucide-react';
import type { NavIcon } from '@/lib/nav';

/* Every row gets its own glyph.

   Two rows sharing one is not a cosmetic slip: the sidebar is scanned
   by shape rather than read, so an icon that appears twice makes both
   rows harder to find than either would be alone. `news` and `tracker`
   were both TrendingUp, and `crm` and `team` were both Users.

   `npm run check:nav` asserts it, because this is the kind of thing
   that comes back the next time somebody adds a screen. */
export const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  analytics: BarChart3,
  work: ListChecks,
  diary: CalendarDays,
  news: Newspaper,
  crm: Users,
  tracker: TrendingUp,
  finder: Search,
  stock: Container,
  fleetsmart: ShieldCheck,
  revenue: Receipt,
  social: Calendar,
  brand: ImageIcon,
  team: Contact,
  settings: Settings,
  admin: UserCog,
};

/* The same object, named for the check that reads it. Exported
   separately so the name says why a script is importing a component's
   internals: `npm run check:nav`. */
export const ICONS_FOR_CHECKING = ICONS;
