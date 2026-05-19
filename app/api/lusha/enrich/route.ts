import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { enrichByEmail } from '@/lib/lusha';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { email?: string; list_id?: string; replace_id?: string };
  try { body = await req.json(); } catch { body = {}; }
  const email = (body.email || '').trim();
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

  let listId = body.list_id;
  if (!listId) {
    const { data: globalList } = await supabase.from('crm_lists').select('id').eq('is_global', true).single();
    listId = globalList?.id;
  }
  if (!listId) return NextResponse.json({ error: 'no list to assign to' }, { status: 400 });

  let lushaData: any = null;
  try {
    lushaData = await enrichByEmail(email);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Lusha error' }, { status: 502 });
  }

  const person = lushaData?.data ?? lushaData;
  const company = person?.company ?? (person?.companyName ? { name: person.companyName, location: person.location, fleet_size: null } : null);

  const contact = {
    list_id: listId,
    company_name: company?.name ?? 'Unknown',
    contact_name: [person?.firstName, person?.lastName].filter(Boolean).join(' ') || null,
    email,
    phone: person?.phoneNumbers?.[0] ?? person?.phone ?? null,
    location: company?.location ?? null,
    fleet_size: company?.fleet_size ?? null,
    source: 'Lusha',
    status: 'lead' as const,
  };

  if (body.replace_id) {
    const { data: updated, error: uErr } = await supabase
      .from('crm_contacts')
      .update({
        company_name: contact.company_name,
        contact_name: contact.contact_name,
        phone: contact.phone,
        location: contact.location,
        fleet_size: contact.fleet_size,
        source: 'Lusha (enriched)',
      })
      .eq('id', body.replace_id)
      .select('*').single();
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
    return NextResponse.json({ contact: updated, raw: lushaData });
  }

  const { data: inserted, error: insErr } = await supabase
    .from('crm_contacts').insert(contact).select('*').single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({ contact: inserted, raw: lushaData });
}
