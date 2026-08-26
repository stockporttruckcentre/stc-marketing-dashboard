import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { EXPORT_BUCKET } from '@/lib/notifications/server';

export const dynamic = 'force-dynamic';

/* =============================================================
   Fetching a kept export again.

   A signed link that lasts a minute, rather than a public bucket. An
   export is a customer's whole record, and a URL that works forever
   for anybody who has it is the wrong shape for that even on a network
   only staff can reach.

   The path is checked against the caller's own id before anything is
   signed. Storage policies should stop a cross person read on their
   own, and this does not rely on that being true: the path begins with
   the owner's id by construction, so the check is one comparison and
   it closes the case where the bucket has been created without them.
   ============================================================= */

export async function GET(req: NextRequest) {
  const gate = await requireCapability('crm.export');
  if (!gate.ok) return gate.response;
  const { supabase, user } = gate;

  const path = new URL(req.url).searchParams.get('path') ?? '';
  if (!path) {
    return NextResponse.json(
      { ok: false, error: 'bad_request', message: 'Which export.' }, { status: 400 },
    );
  }

  if (!path.startsWith(`${user.id}/`)) {
    return NextResponse.json(
      { ok: false, error: 'forbidden', message: 'That export is not yours.' }, { status: 403 },
    );
  }

  const { data, error } = await supabase.storage
    .from(EXPORT_BUCKET)
    .createSignedUrl(path, 60);

  if (error || !data?.signedUrl) {
    return NextResponse.json({
      ok: false,
      error: 'gone',
      message: 'That file is no longer kept. Run the export again.',
    }, { status: 404 });
  }

  return NextResponse.redirect(data.signedUrl);
}
