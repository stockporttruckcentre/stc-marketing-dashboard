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
    .select('id, company_name, contact_name, location, status')
    .or(`company_name.ilike.${like},contact_name.ilike.${like},email.ilike.${like},phone.ilike.${like},location.ilike.${like}`)
    .limit(4);

  const hits = (data ?? []) as any[];

  /* WHICH LIST TO OPEN THE RECORD ON.

     A company sat on exactly one list while membership was a column, so
     naming the list was the same as naming the record. It can be on
     several now: the pipeline everybody shares, plus a list of its own
     that somebody keeps. The pipeline is the right one to land on,
     because it is the one every reader can open. */
  const lists = new Map<string, { id: string; name: string | null }>();
  if (hits.length) {
    const { data: on } = await supabase
      .from('crm_list_contacts')
      .select('contact_id, list_id, crm_lists(name, is_global)')
      .in('contact_id', hits.map((h) => h.id));

    for (const row of ((on ?? []) as any[])) {
      const held = lists.get(row.contact_id);
      // First one wins unless a shared list turns up, which always wins.
      if (held && !row.crm_lists?.is_global) continue;
      lists.set(row.contact_id, { id: row.list_id, name: row.crm_lists?.name ?? null });
    }
  }

  return NextResponse.json({
    contacts: hits.map((r) => ({
      id: r.id,
      list_id: lists.get(r.id)?.id ?? null,
      company_name: r.company_name,
      contact_name: r.contact_name,
      location: r.location,
      status: r.status,
      list_name: lists.get(r.id)?.name ?? null,
    })),
  });
}
