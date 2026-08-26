import { NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { EXPORT_BUCKET, EXPORT_KEEP_DAYS } from '@/lib/notifications/server';

export const dynamic = 'force-dynamic';

/* =============================================================
   What exports you still have.

   ---- Why this reads the bucket and not the notifications ----

   The obvious version of this list is a query over notifications of
   kind `crm.export_ready`, because they already carry the path. It is
   the wrong source for two reasons and both bite quickly.

   A notification can be cleared. Clearing one is how somebody tidies
   the bell, and it must not also be how they lose the file: the file is
   still sitting there for its month whether or not the card that
   announced it is still on screen.

   And a notification can outlive the file. The month is enforced by
   pruning the bucket, so a card from five weeks ago would still offer a
   Download button pointing at something that has gone.

   The bucket is the truth about what exists. This lists it.

   ---- Why the download goes through a route ----

   The bucket is private, so there is no URL to hand out. Each row
   carries a link to `/api/notifications/export`, which mints a signed
   one that lasts a minute against the caller's own session.
   ============================================================= */

export async function GET() {
  const gate = await requireCapability('crm.export');
  if (!gate.ok) return gate.response;
  const { supabase, user } = gate;

  const { data, error } = await supabase.storage
    .from(EXPORT_BUCKET)
    .list(user.id, {
      limit: 100,
      sortBy: { column: 'created_at', order: 'desc' },
    });

  if (error) {
    /* No bucket, or no policy on it. Neither is a failure worth an
       error page: the list is simply empty and says why, which is what
       the panel draws. */
    return NextResponse.json({
      ok: true, provisioned: false, items: [], keepDays: EXPORT_KEEP_DAYS,
      why: error.message,
    });
  }

  const items = (data ?? [])
    /* The store returns a placeholder row for an empty folder. It has
       no size and no id and is not a file anybody exported. */
    .filter((f) => f.name && f.name !== '.emptyFolderPlaceholder')
    .map((f) => {
      const size = (f.metadata as { size?: unknown } | null)?.size;
      return {
        path: `${user.id}/${f.name}`,
        /* The stored name is `<timestamp>-<company>.xlsx`. The stamp is
           what keeps two exports of one customer on one day apart, and
           it is noise to read, so the list shows the part a person
           recognises and keeps the date in its own column. */
        name: f.name.replace(/^\d{4}-\d\d-\d\dT[\d-]+Z?-/, ''),
        createdAt: f.created_at ?? null,
        bytes: typeof size === 'number' ? size : null,
        url: `/api/notifications/export?path=${encodeURIComponent(`${user.id}/${f.name}`)}`,
      };
    });

  return NextResponse.json({
    ok: true, provisioned: true, items, keepDays: EXPORT_KEEP_DAYS,
  });
}
