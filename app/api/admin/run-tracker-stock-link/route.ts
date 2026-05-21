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
  if (!url) return NextResponse.json({ error: 'POSTGRES_URL not set' }, { status: 500 });
  const sql = postgres(url, { ssl: 'require', max: 1, idle_timeout: 5, prepare: false });
  try {
    const statements = [
      `ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS stock_trailer_id UUID REFERENCES stock_trailers(id) ON DELETE SET NULL`,
      `ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS commission_rate NUMERIC DEFAULT 0.10`,
      `CREATE INDEX IF NOT EXISTS idx_crm_contacts_stock_trailer ON crm_contacts (stock_trailer_id)`,
    ];
    const results = [];
    for (const stmt of statements) {
      try { await sql.unsafe(stmt); results.push({ ok: true, stmt: stmt.slice(0, 80) }); }
      catch (e: any) { results.push({ ok: false, stmt: stmt.slice(0, 80), error: e.message }); }
    }
    return NextResponse.json({ ran: results.length, results });
  } finally { await sql.end({ timeout: 2 }); }
}
