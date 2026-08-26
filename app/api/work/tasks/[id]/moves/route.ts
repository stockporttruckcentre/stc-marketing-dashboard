import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* =============================================================
   What this person can do to this task right now.

   Read by the drawer so it offers only the moves that will work. The
   command bar's rule applies to every surface, not just the bar: an
   action that appears and then refuses teaches people the tool is
   unreliable, and they stop trusting the ones that would have worked.
   ============================================================= */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireCapability('work.view');
  if (!gate.ok) return gate.response;

  const { data, error } = await gate.supabase.rpc('work_available_moves', { p_task: params.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}
