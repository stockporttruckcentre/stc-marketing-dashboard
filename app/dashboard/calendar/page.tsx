import { createClient } from '@/lib/supabase/server';
import { TeamCalendar } from '@/components/TeamCalendar';
import type { CalendarEvent } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 1).toISOString();
  const { data } = await supabase
    .from('calendar_events')
    .select('*')
    .gte('start_at', monthStart)
    .lt('start_at', nextMonth)
    .order('start_at');
  return <TeamCalendar initialEvents={(data ?? []) as CalendarEvent[]} userId={user!.id} />;
}
