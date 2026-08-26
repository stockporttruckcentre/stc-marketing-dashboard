import type { createClient } from '@/lib/supabase/server';

/* =============================================================
   Raising a notification from a route.

   Almost nothing needs this. Migration 066 hangs a trigger off every
   table that matters, because the routes are not the only writers: the
   command bar, the CRM grid, the importer and a person in the SQL
   editor all write the same rows, and a notification wired into one
   route is a notification four of the five ways in never raise.

   What is left is the handful of things that leave no row behind. An
   import finishing is not a row changing. Neither is an export being
   produced. Both happen here and nowhere else, so both say so from
   here.

   Every call is best effort. A notification that will not write must
   never take an import down with it: the import is the thing somebody
   asked for and the notification is the courtesy.
   ============================================================= */

type Client = ReturnType<typeof createClient>;

export async function tell(supabase: Client, n: {
  user: string;
  kind: string;
  title: string;
  body?: string | null;
  link?: string | null;
  actor?: string | null;
  subjectKind?: string | null;
  subjectId?: string | null;
  payload?: Record<string, unknown>;
  groupKey?: string | null;
  dedupeKey?: string | null;
}): Promise<void> {
  try {
    await supabase.rpc('notify', {
      p_user: n.user,
      p_kind: n.kind,
      p_title: n.title,
      p_body: n.body ?? null,
      p_link: n.link ?? null,
      p_actor: n.actor ?? null,
      p_subject_kind: n.subjectKind ?? null,
      p_subject_id: n.subjectId ?? null,
      p_payload: n.payload ?? {},
      p_group_key: n.groupKey ?? null,
      p_dedupe_key: n.dedupeKey ?? null,
      p_due_at: null,
      p_expires_at: null,
    });
  } catch {
    /* Deliberately silent. See the header. */
  }
}

/* -------------------------------------------------------------
   Keeping an export, so it can be fetched again.

   The brief asks for a specific thing: delete the file by accident and
   get it back from the notification. That needs the bytes kept
   somewhere, and until now an export was generated and streamed
   straight to the browser with nothing left behind.

   So the buffer goes into a bucket on the way past, under the id of
   whoever asked for it, and the notification carries the path. The
   route that hands it back mints a short lived signed link rather than
   making the bucket public: an export is a customer's whole record and
   a guessable URL for one is not something to leave lying about.

   ---- What happens when there is no bucket ----

   Nothing breaks. The download fails, this returns null, and the
   notification is still written without a path, saying to run it
   again. An export that reached the person who asked for it has done
   its job whether or not a copy was kept.
   ------------------------------------------------------------- */
export const EXPORT_BUCKET = 'exports';

/** How long a kept export is worth keeping. */
export const EXPORT_KEEP_DAYS = 30;

export async function keepExport(supabase: Client, args: {
  userId: string;
  bytes: ArrayBuffer | Buffer | Uint8Array;
  filename: string;
  contentType: string;
}): Promise<string | null> {
  try {
    /* Under the person's own id, and stamped, so two exports of the
       same customer on the same day are two files rather than one
       overwriting the other. */
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const path = `${args.userId}/${stamp}-${args.filename}`;

    const { error } = await supabase.storage
      .from(EXPORT_BUCKET)
      .upload(path, args.bytes as ArrayBuffer, {
        contentType: args.contentType,
        upsert: false,
      });

    if (error) return null;
    return path;
  } catch {
    return null;
  }
}
