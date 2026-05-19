import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { ContactStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

const VALID_STATUSES: ContactStatus[] = ['lead','contacted','quoted','won','lost'];

function pick<T extends Record<string, any>>(row: T, names: string[]): any {
  for (const n of names) {
    const k = Object.keys(row).find(k => k.trim().toLowerCase() === n.toLowerCase());
    if (k && row[k] !== '' && row[k] != null) return row[k];
  }
  return null;
}

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const rows: any[] = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return NextResponse.json({ error: 'no rows' }, { status: 400 });

  const records = rows.map((r) => {
    const status = String(pick(r, ['status']) ?? 'lead').toLowerCase();
    const fleetStr = pick(r, ['fleet_size','fleet size','fleet','vehicles']);
    return {
      company_name: String(pick(r, ['company_name','company','company name','business']) ?? '').slice(0, 255) || 'Unknown',
      contact_name: pick(r, ['contact_name','contact','name','full_name','full name']) || null,
      email:        pick(r, ['email','email_address']) || null,
      phone:        pick(r, ['phone','telephone','mobile']) || null,
      location:     pick(r, ['location','city','town','address']) || null,
      fleet_size:   fleetStr ? Number(fleetStr) || null : null,
      source:       String(pick(r, ['source']) ?? 'CSV'),
      status:       (VALID_STATUSES.includes(status as ContactStatus) ? status : 'lead') as ContactStatus,
      notes:        pick(r, ['notes','note','comment','comments']) || null,
      assigned_to:  pick(r, ['assigned_to','assigned','owner']) || null,
    };
  }).filter(r => r.company_name && r.company_name !== 'Unknown' || r.email);

  // Chunk into 500-row batches
  let inserted = 0;
  for (let i = 0; i < records.length; i += 500) {
    const chunk = records.slice(i, i + 500);
    const { error, count } = await supabase
      .from('crm_contacts')
      .insert(chunk, { count: 'exact' });
    if (error) return NextResponse.json({ error: error.message, inserted }, { status: 500 });
    inserted += count ?? chunk.length;
  }

  return NextResponse.json({ inserted });
}
