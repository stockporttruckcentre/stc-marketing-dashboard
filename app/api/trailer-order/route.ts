import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { fillOrderForm } from '@/lib/orderform/fill';
import { TEMPLATE_PATH } from '@/lib/orderform/template.generated';
import { fileNameFor, formFor, type DealForForm } from '@/lib/orderform/from-deal';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/* =============================================================
   The order form for one deal, as a .docx.

     GET /api/trailer-order?lead=<id>&variant=order|proposal

   ---- Why this is a route and not a download built in the browser ----

   The document is the author's own .docx with values written into it,
   and the .docx lives in the repository. Shipping 165KB of template to
   every browser that opens a lead, to produce a file the server could
   have produced, is a lot of bytes for a button most people never press.

   ---- What decides whether you get one ----

   `crm.view` opens the route, and then the DEAL has to be one this
   person may see, which is the lead table's own row level policy rather
   than a second copy of it here. A lead somebody cannot read comes back
   as not found, because "you may not see that" and "there is no such
   deal" are the same sentence to somebody who should not know either
   way.

   Nothing here writes. Generating a document is a read, and it stays a
   read so that somebody on a read only role can still take a proposal
   into a meeting.
   ============================================================= */

export async function GET(request: NextRequest) {
  const gate = await requireCapability('crm.view');
  if (!gate.ok) return gate.response;
  const { supabase } = gate;

  const leadId = request.nextUrl.searchParams.get('lead');
  const asked = request.nextUrl.searchParams.get('variant') ?? 'order';

  if (!leadId) {
    return NextResponse.json({ error: 'Say which deal the form is for.' }, { status: 400 });
  }
  if (asked !== 'order' && asked !== 'proposal') {
    return NextResponse.json(
      { error: 'There are two documents: the order form and the proposal.' },
      { status: 400 },
    );
  }

  const { data: lead, error: leadErr } = await supabase
    .from('crm_leads')
    .select(`
      id, what, requirement, new_or_used, dispatch_date, estimated_value, sale_price,
      on_hire_date, off_hire_estimate, term_months, hire_rate, service_cycle,
      maintenance_cover, vendor_id, vendor_rate,
      account:crm_contacts ( company_name, contact_name, email, phone, address, location ),
      vendor:third_party_vendors ( name, maintenance_rate )
    `)
    .eq('id', leadId)
    .maybeSingle();

  if (leadErr) return NextResponse.json({ error: leadErr.message }, { status: 400 });
  if (!lead) {
    return NextResponse.json(
      { error: 'That deal is not there, or it is not one you can open.' },
      { status: 404 },
    );
  }

  const { data: units, error: unitErr } = await supabase
    .from('crm_lead_trailers')
    .select(`
      quantity, rate, position,
      trailer:stock_trailers (
        stc_no, chassis_number, ministry_no, mot_date, make, model, year,
        new_or_used, retail_price, expected_delivery, description
      )
    `)
    .eq('lead_id', leadId)
    .order('position');

  if (unitErr) return NextResponse.json({ error: unitErr.message }, { status: 400 });

  const deal = {
    lead: lead as unknown as DealForForm['lead'],
    account: (lead as Record<string, unknown>).account as DealForForm['account'],
    vendor: (lead as Record<string, unknown>).vendor as DealForForm['vendor'],
    units: (units ?? []) as unknown as DealForForm['units'],
  } satisfies DealForForm;

  let template: Buffer;
  try {
    template = await readFile(resolve(process.cwd(), TEMPLATE_PATH));
  } catch {
    return NextResponse.json(
      { error: 'The order form template is not on this server. Nothing has been generated.' },
      { status: 500 },
    );
  }

  let bytes: Buffer;
  try {
    bytes = await fillOrderForm(template, formFor(deal), asked);
  } catch (e) {
    /* The filler refuses rather than producing a wrong document: a
       moved column, a missing terms boundary. Saying which is the
       difference between a fixable afternoon and a shrug. */
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'The document could not be built.' },
      { status: 500 },
    );
  }

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${fileNameFor(deal, asked)}"`,
      'Cache-Control': 'no-store',
    },
  });
}
