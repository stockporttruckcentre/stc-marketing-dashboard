import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/* =============================================================
   Records matching what somebody is typing into the command bar.

   This exists so the top bar can carry one input instead of two. The
   old CRM search box did nothing but this, and running it alongside the
   command bar meant two search fields fighting for the same 52px.

   Read only, capped, and it runs on the user's own session, so it
   returns exactly what their row level policies already allow.
   ============================================================= */
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (q.length < 3) return NextResponse.json({ contacts: [] });

  // Escape the wildcards rather than letting a typed % match everything.
  const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;

  const { data } = await supabase
    .from('crm_contacts')
    .select('id, list_id, company_name, contact_name, location, status, crm_lists(name)')
    .or(`company_name.ilike.${like},contact_name.ilike.${like},email.ilike.${like},phone.ilike.${like},location.ilike.${like}`)
    .limit(4);

  return NextResponse.json({
    contacts: (data ?? []).map((r: any) => ({
      id: r.id,
      list_id: r.list_id,
      company_name: r.company_name,
      contact_name: r.contact_name,
      location: r.location,
      status: r.status,
      list_name: r.crm_lists?.name ?? null,
    })),
  });
}
