import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { readView } from '@/lib/work/views';

export const dynamic = 'force-dynamic';

/* =============================================================
   Saved views.

   The reason a hundred people can run a hundred different workflows in
   one tool is that the view is data, not code. Every view in the rail,
   including the twelve that ship, is a row in `task_views`, and there
   is no code path that renders one of them specially.

   So a view somebody builds here is exactly as capable as one that
   ships: same filter grammar, same layouts, same grouping, same
   columns.

   What a view may contain is `lib/work/views.ts`, shared with the PATCH
   route so the two cannot drift.
   ============================================================= */
export async function POST(req: NextRequest) {
  const gate = await requireCapability('work.views');
  if (!gate.ok) return gate.response;

  const b = await req.json().catch(() => ({}));
  const read = readView(b);
  if ('error' in read) return NextResponse.json({ error: read.error }, { status: 400 });

  /* Where it lands in the rail. Appended rather than inserted, because
     a new view that pushes somebody's existing ones down is a new view
     that moved everything they had learned the position of. */
  const { data: last } = await gate.supabase
    .from('task_views').select('position')
    .order('position', { ascending: false }).limit(1).maybeSingle();

  const { data, error } = await gate.supabase
    .from('task_views')
    .insert({
      ...read.row,
      owner_id: gate.user.id,
      is_system: false,
      position: ((last?.position as number) ?? 0) + 10,
    })
    .select('*').single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
