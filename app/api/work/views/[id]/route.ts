import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { readView } from '@/lib/work/views';

export const dynamic = 'force-dynamic';

/* =============================================================
   Changing a saved view.

   `views_update` in migration 056 decides who may: the owner, somebody
   the view was shared with who can edit it, or somebody holding
   work.manageSystemViews for one that ships. So editing a view that
   ships is possible and is a permission, rather than being impossible
   and forcing everybody to copy it.
   ============================================================= */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireCapability('work.views');
  if (!gate.ok) return gate.response;

  const b = await req.json().catch(() => ({}));
  const read = readView(b);
  if ('error' in read) return NextResponse.json({ error: read.error }, { status: 400 });

  const { data, error } = await gate.supabase
    .from('task_views').update(read.row).eq('id', params.id).select('*').single();

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json(
        { error: 'That view is not yours to change. Save a copy instead.' },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data);
}
