import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Send a stock trailer to the calling user's Sales tracker (creates a new lead, linked to the stock row). */
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { stock_trailer_id?: string };
  if (!body.stock_trailer_id) return NextResponse.json({ error: 'stock_trailer_id required' }, { status: 400 });

  // Caller's tracker list
  const { data: list } = await supabase.from('crm_lists').select('id, name')
    .eq('owner_id', user.id).eq('is_global', false)
    .ilike('name', '%Sales tracker%').limit(1).maybeSingle();
  if (!list) return NextResponse.json({ error: 'You have no Sales tracker list yet. Open the Sales tracker once to auto-create it.' }, { status: 400 });

  // Pull trailer details
  const { data: trailer, error: tErr } = await supabase.from('stock_trailers')
    .select('stc_no, chassis_number, year, make, model, description, location, category, status')
    .eq('id', body.stock_trailer_id).single();
  if (tErr || !trailer) return NextResponse.json({ error: tErr?.message || 'trailer not found' }, { status: 404 });

  // Compose a sensible company_name + description for the lead. The lead is a sales opportunity tied to the trailer.
  const company_name = `Lead — ${trailer.stc_no || trailer.chassis_number || 'Trailer'}`;
  const description = [trailer.year, trailer.make, trailer.model, trailer.description].filter(Boolean).join(' ');

  const today = new Date().toISOString().slice(0, 10);
  const { data: row, error: insErr } = await supabase.from('crm_contacts').insert({
    list_id: list.id,
    side: 'trailer_sales',
    status: 'lead',
    company_name,
    description,
    source: 'From Stock',
    date_of_enquiry: today,
    location: trailer.location,
    stock_trailer_id: body.stock_trailer_id,
  }).select('*').single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, tracker_row_id: row?.id });
}
