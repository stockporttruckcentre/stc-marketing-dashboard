import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import postgres from 'postgres';

export const dynamic = 'force-dynamic';

/**
 * One-off migration runner. Admin-only. Idempotent.
 * Applies the sales-tracker additive schema to crm_contacts.
 */
export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if ((profile as any)?.role !== 'admin') return NextResponse.json({ error: 'admin only' }, { status: 403 });

  const url = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
  if (!url) return NextResponse.json({ error: 'POSTGRES_URL not set' }, { status: 500 });

  const sql = postgres(url, { ssl: 'require', max: 1, idle_timeout: 5 });
  try {
    const statements = [
      `ALTER TABLE crm_contacts DROP CONSTRAINT IF EXISTS crm_contacts_status_check`,
      `ALTER TABLE crm_contacts ADD CONSTRAINT crm_contacts_status_check CHECK (status IN ('lead','contacted','quoted','won','customer','lost'))`,
      `ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS date_of_enquiry DATE`,
      `ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS description     TEXT`,
      `ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS new_or_used     TEXT`,
      `ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS estimated_value NUMERIC`,
      `ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS requirement     TEXT`,
      `ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS action          TEXT`,
      `ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS order_date      DATE`,
      `ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS dispatch_date   DATE`,
      `ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS sale_price      NUMERIC`,
      `ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS profit          NUMERIC`,
      `ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS profit_pct      NUMERIC`,
      `ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS commission      NUMERIC`,
    ];
    const results = [];
    for (const stmt of statements) {
      try { await sql.unsafe(stmt); results.push({ ok: true, stmt: stmt.slice(0, 80) }); }
      catch (e: any) { results.push({ ok: false, stmt: stmt.slice(0, 80), error: e.message }); }
    }
    return NextResponse.json({ ran: results.length, results });
  } finally { await sql.end({ timeout: 2 }); }
}
