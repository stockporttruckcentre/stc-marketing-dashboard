import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import postgres from 'postgres';

export const dynamic = 'force-dynamic';

export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data: caller } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if ((caller as any)?.role !== 'admin') return NextResponse.json({ error: 'admin only' }, { status: 403 });

  const url = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
  const sql = postgres(url!, { ssl: 'require', max: 1, idle_timeout: 5, prepare: false });
  try {
    const rows = await sql`
      SELECT p.email, p.full_name, l.id AS list_id, l.name AS list_name,
             COUNT(c.id)::int AS row_count
      FROM profiles p
      JOIN crm_lists l ON l.owner_id = p.id AND l.name ILIKE '%Sales tracker%'
      LEFT JOIN crm_contacts c ON c.list_id = l.id
      GROUP BY p.email, p.full_name, l.id, l.name`;
    return NextResponse.json(rows);
  } finally { await sql.end({ timeout: 2 }); }
}
