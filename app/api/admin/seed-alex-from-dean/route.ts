import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import postgres from 'postgres';

export const dynamic = 'force-dynamic';

/** Copy every row from Dean's Sales tracker into Alex's, preserving fields.
 *  Idempotent: skips companies (lower-case match) already present in Alex's list. */
export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data: caller } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if ((caller as any)?.role !== 'admin') return NextResponse.json({ error: 'admin only' }, { status: 403 });

  const url = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
  const sql = postgres(url!, { ssl: 'require', max: 1, idle_timeout: 5, prepare: false });
  try {
    const dean = await sql<any[]>`SELECT id FROM profiles WHERE email ILIKE 'deanmann@%' LIMIT 1`;
    const alex = await sql<any[]>`SELECT id FROM profiles WHERE email ILIKE 'alexellis@%' LIMIT 1`;
    if (!dean.length || !alex.length) return NextResponse.json({ error: 'Both Dean + Alex profiles required' }, { status: 404 });
    const deanList = await sql<any[]>`SELECT id FROM crm_lists WHERE owner_id = ${dean[0].id} AND name ILIKE '%Sales tracker%' LIMIT 1`;
    const alexList = await sql<any[]>`SELECT id FROM crm_lists WHERE owner_id = ${alex[0].id} AND name ILIKE '%Sales tracker%' LIMIT 1`;
    if (!deanList.length || !alexList.length) return NextResponse.json({ error: 'Tracker list missing' }, { status: 404 });

    const dean_lid = deanList[0].id;
    const alex_lid = alexList[0].id;

    const existingAlex = await sql<{ key: string }[]>`SELECT lower(company_name) AS key FROM crm_contacts WHERE list_id = ${alex_lid}`;
    const seen = new Set(existingAlex.map(r => (r as any).key));

    const deanRows = await sql<any[]>`SELECT * FROM crm_contacts WHERE list_id = ${dean_lid}`;
    let inserted = 0, skipped = 0;
    for (const r of deanRows) {
      const key = (r.company_name || '').toLowerCase();
      if (seen.has(key)) { skipped++; continue; }
      const { id, list_id, created_at, updated_at, ...rest } = r;
      await sql`INSERT INTO crm_contacts ${sql({ ...rest, list_id: alex_lid })}`;
      seen.add(key);
      inserted++;
    }
    return NextResponse.json({ ok: true, inserted, skipped, totalDeanRows: deanRows.length });
  } finally { await sql.end({ timeout: 2 }); }
}
