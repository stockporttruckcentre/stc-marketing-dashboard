import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/* =============================================================
   A registered file, served back.

   The composer builds `/api/files/<id>` when somebody picks a picture
   out of the content library. That address had no route behind it, so a
   library picture rendered as a broken image every time, and the post it
   went on carried a URL that would never load.

   It redirects rather than proxying the bytes: the object is in a public
   bucket, the browser can fetch it directly, and streaming it through
   here would put every image on every planner board through the
   application server for no benefit.

   `file_location` checks `crm.view` inside the database, so this route
   does not check it again and cannot drift from it.
   ============================================================= */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  }

  const { data, error } = await supabase.rpc('file_location', { p_file: params.id });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    { bucket: string; object_key: string; mime: string; filename: string } | undefined;
  if (!row) {
    return NextResponse.json({ error: 'No file with that id.' }, { status: 404 });
  }

  const { data: url } = supabase.storage.from(row.bucket).getPublicUrl(row.object_key);
  if (!url?.publicUrl) {
    return NextResponse.json({ error: 'That file has no address.' }, { status: 500 });
  }

  return NextResponse.redirect(url.publicUrl, { status: 307 });
}
