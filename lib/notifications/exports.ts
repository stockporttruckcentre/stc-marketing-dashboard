import type { createClient } from '@/lib/supabase/server';
import { keepExport, tell } from '@/lib/notifications/server';

/* =============================================================
   An export, kept and mentioned.

   Both export routes do exactly this and it is four lines with a
   corner in each of them, so it is one function rather than two copies
   that will disagree the first time one of them grows a case.

   The corner: whether the file was actually kept changes what the
   notification is for. Kept, and it is a way to get the file back.
   Not kept, and it is a note saying which export was run and where to
   run it again, which is still worth having and is not a lie about a
   download that would fail.
   ============================================================= */

type Client = ReturnType<typeof createClient>;

export async function keepAndTell(
  supabase: Client,
  userId: string,
  args: {
    bytes: ArrayBuffer;
    filename: string;
    contentType: string;
    company: string;
    contactId: string;
    /** "a spreadsheet" or "a document". Goes into the sentence. */
    what: string;
  },
): Promise<void> {
  const path = await keepExport(supabase, {
    userId,
    bytes: args.bytes,
    filename: args.filename,
    contentType: args.contentType,
  });

  await tell(supabase, {
    user: userId,
    kind: 'crm.export_ready',
    title: `You exported ${args.company} as ${args.what}`,
    body: path
      ? `${args.filename}. Kept here for a month, so you can download it again if you lose it.`
      : `${args.filename}. The copy could not be kept, so this is a note rather than the file. `
        + 'Open the record to run it again.',
    /* The export page, not the CRM grid. It pointed at the grid, which
       does nothing visible except re-sort itself around the row, so the
       notification read as broken. This is the screen the export came
       from and the one place it can be run again. */
    link: `/export/crm/${args.contactId}`,
    actor: userId,
    subjectKind: 'account',
    subjectId: args.contactId,
    payload: path
      ? { fileUrl: `/api/notifications/export?path=${encodeURIComponent(path)}`,
          filename: args.filename, kept: true }
      : { filename: args.filename, kept: false },
  });
}
