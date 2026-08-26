import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Second half of understanding a command.
 *
 * The parser in lib/command works out what was meant. This works out
 * what it refers to: which Dawson, does STC142345 already exist, is
 * there more than one Dave. It never writes anything.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    intentId?: string;
    slots?: Record<string, any>;
  };
  const slots = body.slots ?? {};
  const out: Record<string, any> = {};

  // --- contact references -------------------------------------------------
  const nameRef = slots.contact;
  if (typeof nameRef === 'string' && nameRef.trim()) {
    const term = nameRef.trim();
    const { data } = await supabase
      .from('crm_contacts')
      .select('id, company_name, contact_name, email, phone, status')
      .or(`company_name.ilike.%${term}%,contact_name.ilike.%${term}%`)
      .limit(8);

    const hits = (data ?? []) as any[];
    // Exact-ish match on either field wins outright.
    const exact = hits.filter((h) =>
      (h.company_name ?? '').toLowerCase() === term.toLowerCase() ||
      (h.contact_name ?? '').toLowerCase() === term.toLowerCase());

    out.contact = {
      term,
      resolved: exact.length === 1 ? exact[0] : (hits.length === 1 ? hits[0] : null),
      candidates: hits.map((h) => ({
        id: h.id,
        label: h.company_name,
        sub: [h.contact_name, h.email].filter(Boolean).join(' · '),
        status: h.status,
      })),
      // Nothing found is a real answer: offer to create it.
      none: hits.length === 0,
    };
  }

  // --- teammates ----------------------------------------------------------
  const personRef = slots.person ?? (typeof slots.contact === 'string' ? slots.contact : null);
  if (typeof personRef === 'string' && personRef.trim()) {
    const { data } = await supabase
      .from('profiles').select('id, full_name, email')
      .ilike('full_name', `%${personRef.trim()}%`).limit(8);
    const people = (data ?? []) as any[];
    if (people.length) {
      out.person = {
        term: personRef.trim(),
        resolved: people.length === 1 ? people[0] : null,
        candidates: people.map((p) => ({ id: p.id, label: p.full_name, sub: p.email })),
      };
    }
  }

  // --- stock number -------------------------------------------------------
  if (typeof slots.stockNo === 'string' && slots.stockNo) {
    const { data } = await supabase
      .from('stock_trailers')
      .select('id, stc_no, make, model, status, category')
      .ilike('stc_no', slots.stockNo).limit(1).maybeSingle();
    out.stockNo = {
      value: slots.stockNo,
      exists: !!data,
      record: data ?? null,
    };
  }

  // --- what a new stock row actually needs --------------------------------
  if (body.intentId === 'create_stock_trailer') {
    // The table only truly requires status, which has a default. These are
    // the fields the stock list is unusable without, so we ask for them.
    out.requiredFields = [
      { key: 'stockNo', label: 'STC number', required: true },
      { key: 'make', label: 'Make', required: true },
      { key: 'model', label: 'Model', required: false },
      { key: 'category', label: 'Category', required: false },
      { key: 'status', label: 'Status', required: false, default: 'in_stock',
        options: ['in_stock', 'new_build', 'sales_order', 'rental', 'sold', 'scrap'] },
    ];
  }

  return NextResponse.json({ ok: true, ...out });
}
