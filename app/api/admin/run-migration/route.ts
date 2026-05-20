import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import postgres from 'postgres';

export const dynamic = 'force-dynamic';

/**
 * One-off migration runner. Admin-only. Runs the additive calendar_events changes.
 * Safe to call multiple times (idempotent). Should be deleted after the migration lands.
 */
export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if ((profile as any)?.role !== 'admin') {
    return NextResponse.json({ error: 'admin only' }, { status: 403 });
  }

  const url = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
  if (!url) return NextResponse.json({ error: 'POSTGRES_URL not set' }, { status: 500 });

  const sql = postgres(url, { ssl: 'require', max: 1, idle_timeout: 5 });
  try {
    // Run each statement separately - sql.unsafe handles multi-statement strings
    const statements = [
      `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS contact_id  UUID REFERENCES crm_contacts(id) ON DELETE SET NULL`,
      `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS attendees   JSONB DEFAULT '[]'::jsonb NOT NULL`,
      `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS visibility  TEXT  DEFAULT 'private' NOT NULL CHECK (visibility IN ('private','team','specific'))`,
      `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS visible_to  UUID[] DEFAULT '{}'::UUID[] NOT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_calendar_events_contact ON calendar_events (contact_id)`,
      `CREATE INDEX IF NOT EXISTS idx_calendar_events_visibility ON calendar_events (visibility)`,
      `DROP POLICY IF EXISTS "calendar_select" ON calendar_events`,
      `DROP POLICY IF EXISTS "calendar_select_v2" ON calendar_events`,
      `CREATE POLICY "calendar_select_v2" ON calendar_events FOR SELECT USING (auth.role() = 'authenticated' AND (created_by = auth.uid() OR visibility = 'team' OR (visibility = 'specific' AND auth.uid() = ANY (visible_to))))`,
      `DROP POLICY IF EXISTS "calendar_insert" ON calendar_events`,
      `CREATE POLICY "calendar_insert" ON calendar_events FOR INSERT WITH CHECK (auth.uid() = created_by)`,
      `DROP POLICY IF EXISTS "calendar_update" ON calendar_events`,
      `CREATE POLICY "calendar_update" ON calendar_events FOR UPDATE USING (auth.uid() = created_by)`,
      `DROP POLICY IF EXISTS "calendar_delete" ON calendar_events`,
      `CREATE POLICY "calendar_delete" ON calendar_events FOR DELETE USING (auth.uid() = created_by)`,
    ];
    const results = [];
    for (const stmt of statements) {
      try {
        await sql.unsafe(stmt);
        results.push({ ok: true, stmt: stmt.slice(0, 80) });
      } catch (e: any) {
        results.push({ ok: false, stmt: stmt.slice(0, 80), error: e.message });
      }
    }
    return NextResponse.json({ ran: results.length, results });
  } finally {
    await sql.end({ timeout: 2 });
  }
}
