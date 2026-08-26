import { NextRequest, NextResponse } from 'next/server';
import { requireCapability, requireUser } from '@/lib/api/guard';
import { ukToday } from '@/lib/format/date';

export const dynamic = 'force-dynamic';

/**
 * Twinned customer accounts.
 *
 * The same business can hold a sales and leasing account and a
 * maintenance account, and Protean treats those as separate entities.
 * The requirement from the meeting was that nobody types the customer's
 * details twice, so `create_twin` copies everything that belongs to the
 * business and leaves everything that belongs to the deal behind.
 *
 * Links are flat: a twin points at a head record and a head record points
 * at nothing. The database trigger in migration 003 enforces that, so a
 * chain cannot form and "the same customer" always has one answer.
 */

/** Belongs to the business, so it is copied to a twin. */
const SHARED_FIELDS = [
  'company_name', 'contact_name', 'email', 'phone', 'address', 'location',
  'employee_count', 'turnover', 'trucks', 'trailers', 'vans', 'links',
] as const;

const MISSING_COLUMN = /parent_customer_id/;

export async function POST(req: NextRequest) {
  /* Linking rewrites parent_customer_id on arbitrary contact ids, which
     is an edit to two records at once. */
  const gate = await requireCapability('crm.edit');
  if (!gate.ok) return gate.response;
  const { supabase, user } = gate;

  const body = await req.json().catch(() => ({})) as {
    action?: 'create_twin' | 'link' | 'unlink';
    contact_id?: string;
    target_id?: string;
    side?: 'trailer_sales' | 'maintenance';
  };
  if (!body.contact_id) return NextResponse.json({ error: 'contact_id required' }, { status: 400 });

  const { data: source, error: sErr } = await supabase
    .from('crm_contacts').select('*').eq('id', body.contact_id).single();
  if (sErr || !source) return NextResponse.json({ error: 'contact not found' }, { status: 404 });
  const src: any = source;

  // ---------------------------------------------------------------
  if (body.action === 'unlink') {
    const { error } = await supabase.from('crm_contacts')
      .update({ parent_customer_id: null }).eq('id', body.contact_id);
    if (error) {
      return NextResponse.json({
        error: MISSING_COLUMN.test(error.message)
          ? 'Linked accounts need migration 003 to be run first.'
          : error.message,
      }, { status: 400 });
    }
    return NextResponse.json({ ok: true, message: 'Unlinked' });
  }

  // ---------------------------------------------------------------
  if (body.action === 'link') {
    if (!body.target_id) return NextResponse.json({ error: 'target_id required' }, { status: 400 });
    if (body.target_id === body.contact_id) {
      return NextResponse.json({ error: 'A record cannot be linked to itself' }, { status: 400 });
    }
    // Point at the target's head if it already has one, so the link stays flat.
    const { data: target } = await supabase
      .from('crm_contacts').select('id, parent_customer_id, company_name')
      .eq('id', body.target_id).single();
    const head = (target as any)?.parent_customer_id ?? body.target_id;

    const { error } = await supabase.from('crm_contacts')
      .update({ parent_customer_id: head }).eq('id', body.contact_id);
    if (error) {
      return NextResponse.json({
        error: MISSING_COLUMN.test(error.message)
          ? 'Linked accounts need migration 003 to be run first.'
          : error.message,
      }, { status: 400 });
    }
    return NextResponse.json({ ok: true, message: `Linked to ${(target as any)?.company_name ?? 'the other account'}` });
  }

  // ---------------------------------------------------------------
  // create_twin: the other side of the same business.
  const side = body.side ?? (src.side === 'maintenance' ? 'trailer_sales' : 'maintenance');
  const head = src.parent_customer_id ?? src.id;

  const { data: existing } = await supabase
    .from('crm_contacts').select('id, side')
    .or(`id.eq.${head},parent_customer_id.eq.${head}`);
  if ((existing ?? []).some((r: any) => r.side === side)) {
    return NextResponse.json({
      error: `There is already a ${side === 'maintenance' ? 'maintenance' : 'sales and leasing'} account for this customer.`,
    }, { status: 400 });
  }

  const payload: Record<string, any> = {
    side,
    status: 'lead',
    source: 'Linked account',
    assigned_to: src.assigned_to,
    date_of_enquiry: ukToday(),
    parent_customer_id: head,
  };
  for (const f of SHARED_FIELDS) payload[f] = src[f] ?? null;

  let { data: created, error } = await supabase
    .from('crm_contacts').insert(payload).select('id, company_name, side').single();

  if (error && MISSING_COLUMN.test(error.message)) {
    return NextResponse.json({
      error: 'Linked accounts need migration 003 to be run first. Nothing was created, so nothing has to be tidied up.',
    }, { status: 400 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  /* The twin goes wherever the account it was made from goes.

     This used to be one column copied across. A company can be on the
     shared pipeline and on somebody's own list at the same time now, so
     the answer is every membership the source has, not the last one
     written to it. */
  const { data: sourceLists } = await supabase
    .from('crm_list_contacts').select('list_id').eq('contact_id', src.id);
  const rows = ((sourceLists ?? []) as { list_id: string }[])
    .map((r) => ({ list_id: r.list_id, contact_id: (created as any).id }));
  if (rows.length) await supabase.from('crm_list_contacts').insert(rows);

  // If the source was the head and had no link, it stays the head. Nothing
  // to do: the twin already points at it.
  return NextResponse.json({
    ok: true,
    contact: created,
    message: `Created the ${side === 'maintenance' ? 'maintenance' : 'sales and leasing'} account`,
  });
}

/** The whole group: the head record and every twin hanging off it. */
export async function GET(req: NextRequest) {
  // A read. RLS already scopes which contacts come back, so this only
  // needs to know somebody is signed in.
  const gate = await requireUser();
  if (!gate.ok) return gate.response;
  const { supabase } = gate;

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { data: me, error } = await supabase
    .from('crm_contacts').select('id, parent_customer_id').eq('id', id).single();

  if (error && MISSING_COLUMN.test(error.message ?? '')) {
    return NextResponse.json({ available: false, needs: 'migration 003', linked: [] });
  }
  if (!me) return NextResponse.json({ linked: [] });

  const head = (me as any).parent_customer_id ?? id;
  const { data: group } = await supabase
    .from('crm_contacts')
    // Who the other account is, and nothing about what is being pitched
    // to them. A value belongs to a lead now, and reading one off the
    // account would show a figure that stopped being maintained.
    .select('id, company_name, side, status')
    .or(`id.eq.${head},parent_customer_id.eq.${head}`);

  return NextResponse.json({
    available: true,
    head,
    linked: ((group ?? []) as any[]).filter((r) => r.id !== id),
  });
}
