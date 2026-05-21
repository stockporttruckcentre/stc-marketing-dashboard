import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import postgres from 'postgres';
import { readFile } from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
    // 1) DDL (additive, idempotent)
    const ddl = [
      `CREATE TABLE IF NOT EXISTS stock_trailers (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'in_stock' CHECK (status IN ('new_build','in_stock','sales_order','sold','rental','scrap')),
        category TEXT, stc_no TEXT, supplier TEXT, trade_in BOOLEAN,
        chassis_number TEXT, ministry_no TEXT, supplier_no TEXT,
        received_date DATE, paid_status TEXT, year INTEGER, make TEXT, model TEXT,
        side_aperture TEXT, colour TEXT, description TEXT, door_type TEXT,
        mot_date DATE, axle_type TEXT, location TEXT, status_text TEXT, sales_rep TEXT,
        nbv NUMERIC, refurb_costs NUMERIC, refurb_costs_at_sale NUMERIC, total_nbv NUMERIC,
        new_or_used TEXT, customer TEXT, order_date DATE, dispatch_date DATE, month DATE,
        sales_price NUMERIC, profit NUMERIC, profit_pct NUMERIC,
        trailer_docs TEXT, signed_order TEXT, deposit_received TEXT, paid_in_full TEXT,
        refurb_update TEXT, refurb_done TEXT, tread_depths TEXT,
        chassis_colour TEXT, body_colour TEXT, expected_delivery DATE,
        retail_price NUMERIC, sold_price NUMERIC, quote_no TEXT, hyperlink TEXT,
        notes TEXT, jr_notes TEXT, comments TEXT, documents TEXT, fleet_serve_link TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS idx_stock_trailers_status   ON stock_trailers (status)`,
      `CREATE INDEX IF NOT EXISTS idx_stock_trailers_category ON stock_trailers (category)`,
      `CREATE INDEX IF NOT EXISTS idx_stock_trailers_customer ON stock_trailers (customer)`,
      `CREATE INDEX IF NOT EXISTS idx_stock_trailers_stc      ON stock_trailers (stc_no)`,
      `ALTER TABLE stock_trailers ENABLE ROW LEVEL SECURITY`,
      `DROP POLICY IF EXISTS "stock_select" ON stock_trailers`,
      `DROP POLICY IF EXISTS "stock_write"  ON stock_trailers`,
      `CREATE POLICY "stock_select" ON stock_trailers FOR SELECT USING (auth.role() = 'authenticated')`,
      `CREATE POLICY "stock_write"  ON stock_trailers FOR ALL USING (current_role_safe() IN ('admin','marketer','sales'))`,
    ];
    for (const stmt of ddl) { try { await sql.unsafe(stmt); } catch {} }

    // 2) Truncate existing data (previous partial import had bad dates - re-importing all fresh)
    const before = await sql`SELECT COUNT(*)::int AS n FROM stock_trailers`;
    const beforeCount = (before as any)[0].n;
    if (beforeCount > 0) {
      await sql.unsafe('TRUNCATE TABLE stock_trailers');
    }

    // 3) Read records and bulk-insert
    const raw = await readFile(path.join(process.cwd(), 'data', 'stock-import.json'), 'utf-8');
    const records: any[] = JSON.parse(raw);
    const cols = [
      'status','category','stc_no','supplier','trade_in',
      'chassis_number','ministry_no','supplier_no',
      'received_date','paid_status','year','make','model',
      'side_aperture','colour','description','door_type',
      'mot_date','axle_type','location','status_text','sales_rep',
      'nbv','refurb_costs','refurb_costs_at_sale','total_nbv',
      'new_or_used','customer','order_date','dispatch_date','month',
      'sales_price','profit','profit_pct',
      'trailer_docs','signed_order','deposit_received','paid_in_full',
      'refurb_update','refurb_done','tread_depths',
      'chassis_colour','body_colour','expected_delivery',
      'retail_price','sold_price','quote_no','hyperlink',
      'notes','jr_notes','comments','documents','fleet_serve_link',
    ];
    // Normalise: every row has every key (null where missing). postgres-js bulk insert needs this.
    const rows = records.map(r => {
      const obj: any = {};
      for (const c of cols) obj[c] = r[c] ?? null;
      return obj;
    });
    // Bulk insert in chunks of 200 to keep parameter count under Postgres's 65535 limit (200 x 53 = 10,600 params)
    let inserted = 0;
    const chunkSize = 200;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      await sql`INSERT INTO stock_trailers ${sql(chunk, ...cols)}`;
      inserted += chunk.length;
    }
    return NextResponse.json({ ok: true, totalInFile: records.length, inserted });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, stack: e.stack?.slice(0, 500) }, { status: 500 });
  } finally {
    await sql.end({ timeout: 2 });
  }
}
