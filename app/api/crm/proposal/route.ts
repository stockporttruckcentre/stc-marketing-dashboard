import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { ukToday } from '@/lib/format/date';

export const dynamic = 'force-dynamic';

/**
 * Raise a proposal against a customer and say where to go next.
 *
 * Trailer sales and maintenance have a home already: a row on the rep's
 * own tracker, on the right side of the business. Rental and refurb have
 * no dedicated tool yet, so they land in the same place rather than
 * disappearing, and the caller is told the tool is still to be built.
 */
const KIND_SIDE: Record<string, 'trailer_sales' | 'maintenance'> = {
  trailer_sales: 'trailer_sales',
  maintenance: 'maintenance',
  rental: 'trailer_sales',
  refurb: 'maintenance',
};

export async function POST(req: NextRequest) {
  /* Raising a proposal writes a quoted row onto a tracker. crm.proposal
     existed as a capability and was never consulted. */
  const gate = await requireCapability('crm.proposal');
  if (!gate.ok) return gate.response;
  const { supabase, user } = gate;

  const { contact_id, kind } = await req.json().catch(() => ({})) as { contact_id?: string; kind?: string };
  if (!contact_id || !kind || !(kind in KIND_SIDE)) {
    return NextResponse.json({ error: 'need a contact and a proposal type' }, { status: 400 });
  }

  const { data: contact, error: cErr } = await supabase
    .from('crm_contacts').select('*').eq('id', contact_id).single();
  if (cErr || !contact) return NextResponse.json({ error: 'contact not found' }, { status: 404 });

  const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).single();
  const fullName = (profile as any)?.full_name ?? user.email;

  // The rep's own tracker is where a live proposal belongs.
  const { data: list } = await supabase.from('crm_lists').select('id')
    .eq('owner_id', user.id).eq('is_global', false)
    .ilike('name', '%Sales tracker%').limit(1).maybeSingle();
  if (!list) {
    return NextResponse.json({
      error: 'You have no sales tracker yet. Opening the tracker once creates it.',
    }, { status: 400 });
  }

  const c: any = contact;
  const payload: Record<string, any> = {
    list_id: (list as any).id,
    side: KIND_SIDE[kind],
    status: 'quoted',
    source: 'CRM proposal',
    company_name: c.company_name,
    contact_name: c.contact_name,
    email: c.email,
    phone: c.phone,
    location: c.location,
    assigned_to: fullName,
    // Carried across so the dashboard can split proposals to prospects
    // from proposals to existing customers, which was the whole point of
    // recording it. Falls back to prospect when migration 004 has not run.
    relationship: c.relationship ?? 'prospect',
    requirement: kind.replace('_', ' '),
    date_of_enquiry: ukToday(),
    last_contact: ukToday(),
  };

  let { data: row, error } = await supabase.from('crm_contacts')
    .insert(payload).select('id').single();

  // `relationship` arrives with migration 004. Without it the proposal
  // still has to be raised: losing the split is a reporting gap, losing
  // the proposal is somebody's afternoon.
  if (error && /relationship/.test(error.message)) {
    const { relationship: _dropped, ...withoutRelationship } = payload;
    ({ data: row, error } = await supabase.from('crm_contacts')
      .insert(withoutRelationship).select('id').single());
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    href: `/dashboard/leads?contact=${(row as any).id}`,
    kind,
    toolReady: kind === 'trailer_sales' || kind === 'maintenance',
  });
}
