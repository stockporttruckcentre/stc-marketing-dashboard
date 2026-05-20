import { NextResponse, NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import postgres from 'postgres';
import { readFile } from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data: caller } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if ((caller as any)?.role !== 'admin') return NextResponse.json({ error: 'admin only' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { target_email?: string };
  const targetEmail = (body.target_email || '').trim();
  if (!targetEmail) return NextResponse.json({ error: 'target_email required' }, { status: 400 });

  const { data: target } = await supabase.from('profiles').select('id, email, full_name')
    .ilike('email', targetEmail).single();
  if (!target) return NextResponse.json({ error: `No profile for ${targetEmail}` }, { status: 404 });

  const url = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
  if (!url) return NextResponse.json({ error: 'POSTGRES_URL not set' }, { status: 500 });
  const sql = postgres(url, { ssl: 'require', max: 1, idle_timeout: 5 });
  try {
    // 1) Apply schema (idempotent)
    const ddl = [
      `CREATE TABLE IF NOT EXISTS maint_accounts (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        owner_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
        date_of_update DATE,
        status TEXT, company_name TEXT, contact_name TEXT, phone TEXT, email TEXT,
        location TEXT, services TEXT, vehicles TEXT, requirements TEXT,
        update_log TEXT, next_action TEXT, category TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS idx_maint_accounts_owner    ON maint_accounts (owner_id)`,
      `CREATE INDEX IF NOT EXISTS idx_maint_accounts_category ON maint_accounts (category)`,
      `ALTER TABLE maint_accounts ENABLE ROW LEVEL SECURITY`,
      `DROP POLICY IF EXISTS "maint_owner_select" ON maint_accounts`,
      `DROP POLICY IF EXISTS "maint_owner_write" ON maint_accounts`,
      `CREATE POLICY "maint_owner_select" ON maint_accounts FOR SELECT USING (owner_id = auth.uid())`,
      `CREATE POLICY "maint_owner_write" ON maint_accounts FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid())`,
    ];
    for (const stmt of ddl) { try { await sql.unsafe(stmt); } catch {} }

    // 2) Load records and skip dupes
    const raw = await readFile(path.join(process.cwd(), 'data', 'maint-accounts-import.json'), 'utf-8');
    const records: any[] = JSON.parse(raw);
    const existingRows = await sql<{ company_name: string }[]>`
      SELECT lower(company_name) AS company_name FROM maint_accounts WHERE owner_id = ${target.id}`;
    const seen = new Set(existingRows.map(r => (r as any).company_name));
    const toInsert = records.filter(r => r.company_name && !seen.has(r.company_name.toLowerCase()));
    let inserted = 0;
    for (const r of toInsert) {
      await sql`INSERT INTO maint_accounts (
        owner_id, date_of_update, status, company_name, contact_name, phone, email,
        location, services, vehicles, requirements, update_log, next_action, category
      ) VALUES (
        ${target.id}, ${r.date_of_update}, ${r.status}, ${r.company_name}, ${r.contact_name}, ${r.phone}, ${r.email},
        ${r.location}, ${r.services}, ${r.vehicles}, ${r.requirements}, ${r.update_log}, ${r.next_action}, ${r.category}
      )`;
      inserted++;
    }
    return NextResponse.json({ ok: true, target: target.full_name, totalInFile: records.length, inserted, skipped: records.length - inserted });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally { await sql.end({ timeout: 2 }); }
}
