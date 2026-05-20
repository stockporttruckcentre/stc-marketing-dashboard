import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import postgres from 'postgres';
import { readFile } from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

/**
 * One-off importer: loads Dean Mann's existing Excel tracker rows into his personal
 * Sales tracker CRM list. Admin-only. Reads data/dean-tracker-import.json from the repo.
 */
export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: caller } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if ((caller as any)?.role !== 'admin') return NextResponse.json({ error: 'admin only' }, { status: 403 });

  // Locate Dean's profile
  const { data: dean } = await supabase
    .from('profiles').select('id, email, full_name')
    .ilike('email', 'deanmann@%').single();
  if (!dean) return NextResponse.json({ error: "Could not find Dean's profile (deanmann@*)" }, { status: 404 });

  // Find or create Dean's personal Sales tracker list (must be owned by Dean for RLS visibility)
  const url = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
  if (!url) return NextResponse.json({ error: 'POSTGRES_URL not set' }, { status: 500 });
  const sql = postgres(url, { ssl: 'require', max: 1, idle_timeout: 5 });

  try {
    let listId: string;
    const existing = await sql`SELECT id FROM crm_lists WHERE owner_id = ${dean.id} AND is_global = false AND name ILIKE '%Sales tracker%' LIMIT 1`;
    if (existing.length) {
      listId = existing[0].id;
    } else {
      const firstName = (dean.full_name ?? 'Dean').split(' ')[0];
      const created = await sql`
        INSERT INTO crm_lists (name, owner_id, is_global, color, description)
        VALUES (${`${firstName}'s Sales tracker`}, ${dean.id}, false, '#cf2417', 'Personal sales pipeline - only you see this list')
        RETURNING id
      `;
      listId = created[0].id;
    }

    // Read import data
    const filePath = path.join(process.cwd(), 'data', 'dean-tracker-import.json');
    const raw = await readFile(filePath, 'utf-8');
    const records: any[] = JSON.parse(raw);

    // De-dup: skip rows where same company already exists in this list
    const existingCompanies = await sql<{ company_name: string }[]>`
      SELECT lower(company_name) AS company_name FROM crm_contacts WHERE list_id = ${listId}
    `;
    const seen = new Set(existingCompanies.map(r => (r as any).company_name));

    const toInsert = records.filter(r => !seen.has((r.company_name || '').toLowerCase()));
    const skipped = records.length - toInsert.length;

    let inserted = 0;
    for (const r of toInsert) {
      await sql`
        INSERT INTO crm_contacts (
          list_id, company_name, contact_name, email, phone, status, source,
          date_of_enquiry, new_or_used, estimated_value, description, requirement, action, notes,
          order_date, dispatch_date, sale_price, profit, profit_pct, commission
        ) VALUES (
          ${listId}, ${r.company_name}, ${r.contact_name}, ${r.email}, ${r.phone},
          ${r.status}, ${r.source ?? 'Import'},
          ${r.date_of_enquiry}, ${r.new_or_used}, ${r.estimated_value},
          ${r.description}, ${r.requirement}, ${r.action}, ${r.notes},
          ${r.order_date ?? null}, ${r.dispatch_date ?? null}, ${r.sale_price ?? null},
          ${r.profit ?? null}, ${r.profit_pct ?? null}, ${r.commission ?? null}
        )
      `;
      inserted++;
    }

    return NextResponse.json({
      ok: true,
      deanProfile: { id: dean.id, name: dean.full_name },
      listId,
      totalInExcel: records.length,
      inserted,
      skipped,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await sql.end({ timeout: 2 });
  }
}
