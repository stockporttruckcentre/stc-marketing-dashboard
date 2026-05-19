import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { enrichByEmail } from '@/lib/lusha';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { email?: string };
  try { body = await req.json(); } catch { body = {}; }
  const email = (body.email || '').trim();
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

  // Decrement Lusha credit first - so we don't over-spend on errors
  const { data: credit, error: cErr } = await supabase
    .from('lusha_credits')
    .select('id, balance')
    .limit(1)
    .single();
  if (cErr || !credit) return NextResponse.json({ error: 'no credit record' }, { status: 500 });
  if (credit.balance <= 0) return NextResponse.json({ error: 'Out of Lusha credits' }, { status: 402 });

  let lushaData: any = null;
  try {
    lushaData = await enrichByEmail(email);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Lusha error' }, { status: 502 });
  }

  // Decrement credit only on success
  await supabase
    .from('lusha_credits')
    .update({ balance: credit.balance - 1, updated_at: new Date().toISOString() })
    .eq('id', credit.id);

  // Best-effort parse of Lusha response
  const person = lushaData?.data ?? lushaData;
  const company = person?.company ?? person?.companyName ? {
    name: person?.company?.name ?? person?.companyName,
    location: person?.company?.location ?? person?.location,
    fleet_size: person?.company?.employees ?? null,
  } : null;

  const contact = {
    company_name: company?.name ?? 'Unknown',
    contact_name: [person?.firstName, person?.lastName].filter(Boolean).join(' ') || null,
    email,
    phone: person?.phoneNumbers?.[0] ?? person?.phone ?? null,
    location: company?.location ?? null,
    fleet_size: company?.fleet_size ?? null,
    source: 'Lusha',
    status: 'lead' as const,
  };

  // Insert into CRM
  const { data: inserted, error: insErr } = await supabase
    .from('crm_contacts')
    .insert(contact)
    .select('*')
    .single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({ contact: inserted, raw: lushaData });
}
