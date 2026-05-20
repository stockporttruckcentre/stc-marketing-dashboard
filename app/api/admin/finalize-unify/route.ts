import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import postgres from 'postgres';

export const dynamic = 'force-dynamic';

/** One-off: drop maint_accounts table (data preserved in crm_contacts). Admin-only. */
export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data: caller } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if ((caller as any)?.role !== 'admin') return NextResponse.json({ error: 'admin only' }, { status: 403 });

  const url = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
  if (!url) return NextResponse.json({ error: 'POSTGRES_URL not set' }, { status: 500 });
  const sql = postgres(url, { ssl: 'require', max: 1, idle_timeout: 5, prepare: false });
  try {
    // First: how many rows of each side in crm_contacts (so we know the unified data is there)
    const counts = await sql`SELECT side, COUNT(*)::int AS n FROM crm_contacts GROUP BY side`;
    // Then drop maint_accounts (data already migrated to crm_contacts)
    await sql.unsafe(`DROP TABLE IF EXISTS maint_accounts CASCADE`);
    return NextResponse.json({ ok: true, dropped: 'maint_accounts', sideCounts: counts });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally { await sql.end({ timeout: 2 }); }
}
