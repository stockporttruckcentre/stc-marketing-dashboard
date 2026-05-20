import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { enrichByEmail } from '@/lib/lusha';

export const dynamic = 'force-dynamic';

// Pull a phone number from Lusha's response (it's an array of {number, phoneType} or strings)
function pickPhone(p: any): string | null {
  if (!p) return null;
  if (Array.isArray(p.phoneNumbers) && p.phoneNumbers.length) {
    const first = p.phoneNumbers[0];
    return typeof first === 'string' ? first : (first?.number ?? first?.phone ?? null);
  }
  return p.phone ?? null;
}

function pickCompany(p: any): { name?: string; location?: string; size?: number | null; address?: string; website?: string } {
  const c = p?.company ?? p?.companyData ?? null;
  if (!c) return { name: p?.companyName, location: p?.location };
  // Lusha returns company.address as an object {street, city, state, country, ...} or sometimes a string
  const addr = c.address;
  let addressStr: string | undefined;
  let city: string | undefined;
  if (addr && typeof addr === 'object') {
    city = addr.city ?? addr.locality;
    addressStr = [addr.street, addr.city ?? addr.locality, addr.state, addr.country, addr.postalCode]
      .filter(Boolean).join(', ');
  } else if (typeof addr === 'string') {
    addressStr = addr;
  }
  return {
    name: c.name ?? c.companyName,
    location: city ?? c.city ?? c.location ?? p?.location,
    size: typeof c.size === 'number' ? c.size : (typeof c.employees === 'number' ? c.employees : null),
    address: addressStr,
    website: c.fqdn ? `https://${c.fqdn}` : (c.website ?? null),
  };
}

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

  // Did Lusha actually return person data? If not, surface the raw payload so we know why
  const looksEmpty = !person || (!person.firstName && !person.lastName && !person.company && !person.phoneNumbers);
  if (looksEmpty) {
    return NextResponse.json({
      error: 'Lusha returned no person data for that email',
      lusha_raw: lushaData,
    }, { status: 404 });
  }

  const company = pickCompany(person);
  const contactName = [person?.firstName, person?.lastName].filter(Boolean).join(' ') || null;
  const phone = pickPhone(person);

  const enrichedFields: any = {
    company_name: company?.name ?? undefined,
    contact_name: contactName ?? undefined,
    phone: phone ?? undefined,
    location: company?.location ?? undefined,
    fleet_size: company?.size ?? undefined,
    employee_count: company?.size ?? undefined,
    source: 'Lusha',
  };
  // Strip undefined so we only patch what we actually got
  for (const k of Object.keys(enrichedFields)) if (enrichedFields[k] === undefined) delete enrichedFields[k];

  if (body.replace_id) {
    const { data: updated, error: uErr } = await supabase
      .from('crm_contacts')
      .update(enrichedFields)
      .eq('id', body.replace_id)
      .select('*').single();
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
    // Add address as a primary address if we got one
    if (company?.address) {
      await supabase.from('contact_addresses').insert({
        contact_id: body.replace_id,
        label: 'Lusha enrichment',
        address: company.address,
        is_primary: true,
      });
    }
    // Add website as a link
    if (company?.website) {
      const cur = (updated as any).links ?? [];
      await supabase.from('crm_contacts').update({
        links: [...cur, { id: crypto.randomUUID(), label: 'Website', url: company.website, kind: 'website' }],
      }).eq('id', body.replace_id);
    }
    return NextResponse.json({ contact: updated, enriched: enrichedFields, raw: lushaData });
  }

  // New row
  const insert = {
    list_id: listId,
    email,
    status: 'lead' as const,
    ...enrichedFields,
    company_name: enrichedFields.company_name ?? 'Unknown',
  };
  const { data: inserted, error: insErr } = await supabase
    .from('crm_contacts').insert(insert).select('*').single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  if (company?.address) {
    await supabase.from('contact_addresses').insert({
      contact_id: (inserted as any).id,
      label: 'Lusha enrichment',
      address: company.address,
      is_primary: true,
    });
  }
  if (company?.website) {
    await supabase.from('crm_contacts').update({
      links: [{ id: crypto.randomUUID(), label: 'Website', url: company.website, kind: 'website' }],
    }).eq('id', (inserted as any).id);
  }

  return NextResponse.json({ contact: inserted, enriched: enrichedFields, raw: lushaData });
}
