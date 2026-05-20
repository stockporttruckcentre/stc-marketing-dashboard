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
    let listId: string;
    const existing = await sql`SELECT id FROM crm_lists WHERE owner_id = ${target.id} AND is_global = false AND name ILIKE '%Sales tracker%' LIMIT 1`;
    if (existing.length) listId = existing[0].id;
    else {
      const firstName = (target.full_name ?? targetEmail.split('@')[0]).split(' ')[0];
      const created = await sql`
        INSERT INTO crm_lists (name, owner_id, is_global, color, description)
        VALUES (${`${firstName}'s Sales tracker`}, ${target.id}, false, '#cf2417', 'Personal sales pipeline')
        RETURNING id`;
      listId = created[0].id;
    }
    const raw = await readFile(path.join(process.cwd(), 'data', 'tracker-import.json'), 'utf-8');
    const records: any[] = JSON.parse(raw);
    const existingCompanies = await sql<{ company_name: string }[]>`
      SELECT lower(company_name) AS company_name FROM crm_contacts WHERE list_id = ${listId}`;
    const seen = new Set(existingCompanies.map(r => (r as any).company_name));
    const toInsert = records.filter(r => !seen.has((r.company_name || '').toLowerCase()));
    let inserted = 0;
    for (const r of toInsert) {
      await sql`INSERT INTO crm_contacts (
        list_id, company_name, contact_name, email, phone, status, source,
        date_of_enquiry, new_or_used, estimated_value, description, requirement, action, notes,
        order_date, dispatch_date, sale_price, profit, profit_pct, commission
      ) VALUES (
        ${listId}, ${r.company_name}, ${r.contact_name}, ${r.email}, ${r.phone},
        ${r.status}, ${r.source ?? 'Import'},
        ${r.date_of_enquiry}, ${r.new_or_used}, ${r.estimated_value},
        ${r.description}, ${r.requirement}, ${r.action}, ${r.notes},
        ${r.order_date ?? null}, ${r.dispatch_date ?? null}, ${r.sale_price ?? null},
        ${r.profit ?? null}, ${r.profit_pct ?? null}, ${r.commission ?? null})`;
      inserted++;
    }
    return NextResponse.json({ ok: true, target: target.full_name, totalInFile: records.length, inserted, skipped: records.length - inserted, listId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally { await sql.end({ timeout: 2 }); }
}
