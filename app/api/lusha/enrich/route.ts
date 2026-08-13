import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { lushaLockResponse } from '@/lib/crm/lusha-gate';
import { enrichByEmail, enrichByName, prospectingByCompanyAndRoles, prospectingByCompanyId, findLushaCompanyByDomain, extractDomain } from '@/lib/lusha';

export const dynamic = 'force-dynamic';

function pickPhone(p: any): string | null {
  if (!p) return null;
  if (Array.isArray(p.phoneNumbers) && p.phoneNumbers.length) {
    const f = p.phoneNumbers[0];
    return typeof f === 'string' ? f : (f?.number ?? f?.phone ?? null);
  }
  return p.phone ?? null;
}
function pickEmail(p: any): string | null {
  if (!p) return null;
  if (Array.isArray(p.emailAddresses) && p.emailAddresses.length) {
    const f = p.emailAddresses[0];
    return typeof f === 'string' ? f : (f?.email ?? f?.address ?? null);
  }
  return p.email ?? null;
}
function pickCompany(p: any) {
  const c = p?.company ?? p?.companyData ?? null;
  if (!c) return { name: p?.companyName, location: p?.location };
  const addr = c.address;
  let addressStr: string | undefined; let city: string | undefined;
  if (addr && typeof addr === 'object') {
    city = addr.city ?? addr.locality;
    addressStr = [addr.street, city, addr.state, addr.country, addr.postalCode].filter(Boolean).join(', ');
  } else if (typeof addr === 'string') addressStr = addr;
  return {
    name: c.name ?? c.companyName,
    location: city ?? c.city ?? c.location ?? p?.location,
    size: typeof c.size === 'number' ? c.size : (typeof c.employees === 'number' ? c.employees : null),
    address: addressStr,
    website: c.fqdn ? `https://${c.fqdn}` : (c.website ?? null),
  };
}

export async function POST(req: NextRequest) {
  /* The global lock below stops everybody today. It is temporary, and
     when it lifts the per-user capability is what decides who may spend
     a credit. Checking only the lock meant lifting it would grant
     enrichment to the whole company at once, which is the opposite of
     what the meeting asked for. */
  const gate = await requireCapability('crm.enrich');
  if (!gate.ok) return gate.response;
  const { supabase, user } = gate;
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const locked = lushaLockResponse();
  if (locked) return locked;

  const body = await req.json().catch(() => ({})) as {
    email?: string;
    company_name?: string;
    website_url?: string;
    contact_name?: string;
    list_id?: string;
    replace_id?: string;
    only_fields?: string[];  // if set, only these fields will be patched on the row
  };

  const email = (body.email || '').trim();
  const companyName = (body.company_name || '').trim();
  const contactName = (body.contact_name || '').trim();
  const websiteUrl  = (body.website_url || '').trim();
  const domain      = extractDomain(websiteUrl);
  if (!email && !domain) {
    return NextResponse.json({ error: 'Need either an email or a website URL on the row to enrich.' }, { status: 400 });
  }

  let listId = body.list_id;
  if (!listId) {
    const { data: globalList } = await supabase.from('crm_lists').select('id').eq('is_global', true).single();
    listId = globalList?.id;
  }
  if (!listId) return NextResponse.json({ error: 'no list to assign to' }, { status: 400 });

  // ============ Strategy chain ============
  const attempts: { strategy: string; status?: number; error?: string; ok: boolean }[] = [];
  let lushaData: any = null;
  let usedStrategy = '';

  // 1) by email
  if (email) {
    try {
      const r = await enrichByEmail(email);
      if (r?.data || (r && (r.firstName || r.lastName || r.company))) { lushaData = r; usedStrategy = 'email'; }
      attempts.push({ strategy: 'email', ok: true });
    } catch (e: any) {
      attempts.push({ strategy: 'email', ok: false, error: e.message });
    }
  }

  // 2) by name + company
  if (!lushaData && contactName && companyName) {
    const parts = contactName.split(/\s+/);
    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ');
    if (firstName && lastName) {
      try {
        const r = await enrichByName(firstName, lastName, companyName);
        if (r?.data || (r && (r.firstName || r.lastName || r.company))) { lushaData = r; usedStrategy = 'name+company'; }
        attempts.push({ strategy: 'name+company', ok: true });
      } catch (e: any) {
        attempts.push({ strategy: 'name+company', ok: false, error: e.message });
      }
    }
  }

  // 3) prospecting by DOMAIN (preferred - Lusha supports domains[] filter) + role fallbacks
  if (!lushaData && domain) {
    try {
      const company = await findLushaCompanyByDomain(domain);
      const r = company ? await prospectingByCompanyId(company.id) : null;
      if (r) { lushaData = r; usedStrategy = `prospecting (${r._role})`; }
      attempts.push({ strategy: 'prospecting', ok: !!r });
    } catch (e: any) {
      attempts.push({ strategy: 'prospecting', ok: false, error: e.message });
    }
  }

  if (!lushaData) {
    return NextResponse.json({
      error: 'Lusha could not find a contact using available row data',
      attempts,
    }, { status: 404 });
  }

  const person = lushaData?.data ?? lushaData;
  const company = pickCompany(person);
  const enrichedFields: Record<string, any> = {};
  const personFullName = [person?.firstName, person?.lastName].filter(Boolean).join(' ');

  if (personFullName) enrichedFields.contact_name = personFullName;
  const enrichedEmail = pickEmail(person);
  if (enrichedEmail) enrichedFields.email = enrichedEmail;
  const enrichedPhone = pickPhone(person);
  if (enrichedPhone) enrichedFields.phone = enrichedPhone;
  if (company?.name) enrichedFields.company_name = company.name;
  if (company?.location) enrichedFields.location = company.location;
  if (company?.size != null) {
    enrichedFields.employee_count = company.size;
    enrichedFields.fleet_size = company.size;
  }
  enrichedFields.source = `Lusha (${usedStrategy})`;

  // If the caller specified which fields to update, filter to those (source always allowed)
  if (Array.isArray(body.only_fields) && body.only_fields.length) {
    const allowed = new Set([...body.only_fields, 'source']);
    for (const k of Object.keys(enrichedFields)) if (!allowed.has(k)) delete enrichedFields[k];
  }

  // Persist
  let contactRow: any = null;
  if (body.replace_id) {
    const { data, error } = await supabase
      .from('crm_contacts').update(enrichedFields).eq('id', body.replace_id)
      .select('*').single();
    if (error) return NextResponse.json({ error: error.message, attempts }, { status: 500 });
    contactRow = data;
  } else {
    const insert = { list_id: listId, status: 'lead' as const, ...enrichedFields,
                     company_name: enrichedFields.company_name ?? companyName ?? 'Unknown' };
    const { data, error } = await supabase
      .from('crm_contacts').insert(insert).select('*').single();
    if (error) return NextResponse.json({ error: error.message, attempts }, { status: 500 });
    contactRow = data;
  }

  // Side effects
  if (company?.address && contactRow?.id) {
    await supabase.from('contact_addresses').insert({
      contact_id: contactRow.id, label: 'Lusha enrichment',
      address: company.address, is_primary: true,
    });
  }
  if (company?.website && contactRow?.id) {
    const cur = contactRow.links ?? [];
    if (!cur.some((l: any) => l.url === company.website)) {
      await supabase.from('crm_contacts').update({
        links: [...cur, { id: crypto.randomUUID(), label: 'Website', url: company.website, kind: 'website' }],
      }).eq('id', contactRow.id);
    }
  }

  return NextResponse.json({ contact: contactRow, enriched: enrichedFields, strategy: usedStrategy, attempts });
}
