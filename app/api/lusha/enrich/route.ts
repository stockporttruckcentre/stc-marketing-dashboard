import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { lushaLockResponse } from '@/lib/crm/lusha-gate';
import { lookUpInLusha, type EnrichStrategy } from '@/lib/crm/enrich';

export const dynamic = 'force-dynamic';

/**
 * Enrich a customer from Lusha.
 *
 * The lookup itself is `lib/crm/enrich.ts`, which the command bar's
 * `contact.enrich` capability reaches too. Three strategies tried in
 * order, each with its own idea of what counts as a hit: a second copy
 * of that chain would drift on the first one Lusha changed.
 *
 * This route is the button. It does the lookup, writes what came back,
 * and hangs the address and the website off the record, which are the
 * parts that are not columns on it.
 */
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
    only_fields?: string[];
    /** Which paid lookup to make. One, chosen before anything is spent. */
    strategy?: EnrichStrategy;
  };

  /* ONE PAID LOOKUP PER REQUEST.

     The chain used to run email, then name and company, then
     prospecting, all behind one click, and every one of those is a
     purchased call. The strategy is chosen up front now and a miss says
     which strategies remain, so trying another is another click and
     another credit rather than a surprise on the invoice. */
  const found = await lookUpInLusha({
    email: body.email,
    companyName: body.company_name,
    contactName: body.contact_name,
    websiteUrl: body.website_url,
    onlyFields: body.only_fields,
    strategy: body.strategy,
  });
  if (!found.ok) {
    return NextResponse.json({
      error: found.why, attempts: found.attempts,
      tried: found.tried, remaining: found.remaining,
    }, { status: 404 });
  }

  let listId = body.list_id;
  if (!listId) {
    const { data: globalList } = await supabase.from('crm_lists').select('id').eq('is_global', true).single();
    listId = globalList?.id;
  }
  if (!listId) return NextResponse.json({ error: 'no list to assign to' }, { status: 400 });

  let contactRow: any = null;
  if (body.replace_id) {
    const { data, error } = await supabase
      .from('crm_contacts').update(found.fields).eq('id', body.replace_id)
      .select('*').single();
    if (error) {
      return NextResponse.json({ error: error.message, attempts: found.attempts }, { status: 500 });
    }
    contactRow = data;
  } else {
    const insert = {
      list_id: listId, status: 'lead' as const, ...found.fields,
      company_name: found.fields.company_name ?? body.company_name ?? 'Unknown',
    };
    const { data, error } = await supabase
      .from('crm_contacts').insert(insert).select('*').single();
    if (error) {
      return NextResponse.json({ error: error.message, attempts: found.attempts }, { status: 500 });
    }
    contactRow = data;
  }

  /* The parts that are not columns on the record. */
  if (found.address && contactRow?.id) {
    await supabase.from('contact_addresses').insert({
      contact_id: contactRow.id, label: 'Lusha enrichment',
      address: found.address, is_primary: true,
    });
  }
  if (found.website && contactRow?.id) {
    const cur = contactRow.links ?? [];
    if (!cur.some((l: any) => l.url === found.website)) {
      await supabase.from('crm_contacts').update({
        links: [...cur, {
          id: crypto.randomUUID(), label: 'Website', url: found.website, kind: 'website',
        }],
      }).eq('id', contactRow.id);
    }
  }

  return NextResponse.json({
    contact: contactRow,
    enriched: found.fields,
    strategy: found.strategy,
    attempts: found.attempts,
    remaining: found.remaining,
  });
}
