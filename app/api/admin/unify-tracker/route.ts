import { NextResponse, NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import postgres from 'postgres';
import { readFile } from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

function normWhat(w: string | null | undefined): string | null {
  if (!w) return null;
  const s = w.trim();
  const lower = s.toLowerCase();
  if (lower === 'miantenance') return 'Maintenance';        // common typo
  if (lower === 'all services') return 'All Services';
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function normStatus(s: string | null | undefined): string {
  const v = (s || '').trim().toLowerCase();
  if (v === 'customer' || v === 'cu' || v === 'customer ') return 'customer';
  if (v.includes('lost')) return 'lost';
  return 'lead';  // "On Going" and everything else
}
function normCategory(c: string | null | undefined): string | null {
  if (!c) return null;
  const u = c.trim().toUpperCase();
  if (u === 'A' || u === 'B' || u === 'C') return u;
  return null;
}

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data: caller } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if ((caller as any)?.role !== 'admin') return NextResponse.json({ error: 'admin only' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { target_email?: string };
  const targetEmail = (body.target_email || '').trim();
  if (!targetEmail) return NextResponse.json({ error: 'target_email required' }, { status: 400 });

  const { data: target } = await supabase.from('profiles').select('id, full_name, email')
    .ilike('email', targetEmail).single();
  if (!target) return NextResponse.json({ error: `No profile for ${targetEmail}` }, { status: 404 });

  const url = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
  if (!url) return NextResponse.json({ error: 'POSTGRES_URL not set' }, { status: 500 });
  const sql = postgres(url, { ssl: 'require', max: 1, idle_timeout: 5 });

  const results: any = { target: target.full_name };
  try {
    // 1) DDL — additive, idempotent
    const ddl = [
      `ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS side TEXT DEFAULT 'trailer_sales' CHECK (side IN ('trailer_sales','maintenance'))`,
      `ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS what TEXT`,
      `ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS account_manager TEXT`,
      `ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS next_action TEXT`,
      `ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS category TEXT`,
      `ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS vehicles TEXT`,
      `ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS initials TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_crm_contacts_side ON crm_contacts (side)`,
    ];
    for (const stmt of ddl) { try { await sql.unsafe(stmt); } catch {} }
    results.ddl_done = true;

    // 2) Backfill side='trailer_sales' for any existing rows where it's null
    const backfill = await sql`UPDATE crm_contacts SET side = 'trailer_sales' WHERE side IS NULL`;
    results.backfilled_trailer_sales = (backfill as any).count ?? 0;

    // 3) Find or create this user's personal Sales tracker list
    let listId: string;
    const existing = await sql`SELECT id FROM crm_lists WHERE owner_id = ${target.id} AND is_global = false AND name ILIKE '%Sales tracker%' LIMIT 1`;
    if (existing.length) listId = existing[0].id;
    else {
      const firstName = (target.full_name ?? 'Tracker').split(' ')[0];
      const created = await sql`
        INSERT INTO crm_lists (name, owner_id, is_global, color, description)
        VALUES (${`${firstName}'s Sales tracker`}, ${target.id}, false, '#cf2417', 'Personal sales pipeline')
        RETURNING id`;
      listId = created[0].id;
    }
    results.listId = listId;

    // 4) Pull existing companies in this list for dedup
    const existingCompanies = await sql<{ company_name: string }[]>`
      SELECT lower(company_name) AS company_name FROM crm_contacts WHERE list_id = ${listId}`;
    const seen = new Set(existingCompanies.map(r => (r as any).company_name));

    // 5) Migrate maint_accounts (legacy table from earlier import) into crm_contacts as side='maintenance'
    let migratedMaint = 0, skippedMaint = 0;
    try {
      const maintRows = await sql<any[]>`SELECT * FROM maint_accounts WHERE owner_id = ${target.id}`;
      for (const m of maintRows) {
        const key = (m.company_name || '').toLowerCase();
        if (!m.company_name || seen.has(key)) { skippedMaint++; continue; }
        await sql`
          INSERT INTO crm_contacts (
            list_id, side, what, status, company_name, contact_name, phone, email,
            location, vehicles, requirement, notes, next_action, category, source, date_of_enquiry
          ) VALUES (
            ${listId}, 'maintenance', ${m.services}, ${normStatus(m.status)},
            ${m.company_name}, ${m.contact_name}, ${m.phone}, ${m.email},
            ${m.location}, ${m.vehicles}, ${m.requirements}, ${m.update_log}, ${m.next_action},
            ${normCategory(m.category)}, 'Migrated from maint_accounts', ${m.date_of_update}
          )`;
        seen.add(key);
        migratedMaint++;
      }
    } catch (e: any) {
      results.maint_migration_error = e.message;
    }
    results.migratedFromMaintAccounts = migratedMaint;
    results.skippedFromMaintAccounts = skippedMaint;

    // 6) Import the NEW maintenance file's 66 rows (data/maint-tracker-import.json) — skip dupes
    const raw = await readFile(path.join(process.cwd(), 'data', 'maint-tracker-import.json'), 'utf-8');
    const records: any[] = JSON.parse(raw);
    let importedNew = 0, skippedNew = 0;
    for (const r of records) {
      const key = (r.company_name || '').toLowerCase();
      if (!r.company_name || seen.has(key)) { skippedNew++; continue; }
      await sql`
        INSERT INTO crm_contacts (
          list_id, side, what, status, company_name, contact_name, phone, email,
          notes, source, requirement, action, next_action, account_manager, category, initials,
          date_of_enquiry
        ) VALUES (
          ${listId}, 'maintenance', ${normWhat(r.what)}, ${normStatus(r.status)},
          ${r.company_name}, ${r.contact_name}, ${r.phone}, ${r.email},
          ${r.update_log}, ${r.source}, ${r.requirements}, ${r.action}, ${r.next_action},
          ${r.account_manager}, ${normCategory(r.category)}, ${r.initials},
          ${r.date_of_update}
        )`;
      seen.add(key);
      importedNew++;
    }
    results.importedFromNewFile = importedNew;
    results.skippedFromNewFile = skippedNew;

    // 7) Drop maint_accounts table at the end (data preserved above)
    // Done at the very end, after all targets are processed. We'll do it once via a final step.

    return NextResponse.json(results);
  } catch (e: any) {
    return NextResponse.json({ error: e.message, partial: results }, { status: 500 });
  } finally {
    await sql.end({ timeout: 2 });
  }
}
