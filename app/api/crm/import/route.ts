import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { commitImport, prepareImport, IMPORT_CEILING } from '@/lib/import/commit';

export const dynamic = 'force-dynamic';

/* =============================================================
   Committing an import.

   This used to guess the columns itself, from a short list of header
   spellings, and fell back to `company_name: 'Unknown'` when it found
   nothing. That is how a file with the wrong headers produced hundreds
   of records called Unknown and a response saying it had worked.

   Guessing now happens in front of the user and the result is confirmed
   before anything is sent, so this route's job is narrower and stricter.
   The rules themselves are `lib/import/commit.ts`, which the command
   bar's `rows.import` capability uses too: a second copy of "what a
   missing company name means" is how one of them starts inventing
   records again.

   It is still not allowed to trust the client. The allowlist comes from
   the same dictionary the mapping screen matches against, so a hand
   rolled POST cannot write to a column the import was never meant to
   touch.
   ============================================================= */

export async function POST(req: NextRequest) {
  /* Bulk inserting five thousand contacts is exactly the thing a read
     only account should not be able to do. crm.import existed as a
     capability and was never consulted here. */
  const gate = await requireCapability('crm.import');
  if (!gate.ok) return gate.response;
  const { supabase } = gate;

  const body = await req.json().catch(() => ({}));
  const rows: unknown[] = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return NextResponse.json({ error: 'no rows' }, { status: 400 });
  if (rows.length > IMPORT_CEILING) {
    return NextResponse.json({
      error: `That is more than ${IMPORT_CEILING} rows. Split the file and import it in parts.`,
    }, { status: 400 });
  }

  /* The list is not resolved here. The screen has one open and says
     which by id; a request without one lands on the global list, and
     the operation decides that, exactly, inside the transaction. */
  const { records, refused } = prepareImport(rows);

  if (!records.length) {
    return NextResponse.json({
      error: 'None of those rows had a company name, so there was nothing to file them under.',
    }, { status: 400 });
  }

  /* ONE TRANSACTION, THE SAME ONE THE COMMAND BAR USES.

     This used to insert in chunks of five hundred and report how many
     were saved before it failed. That is the honest thing for a route
     that cannot do better, and it meant the screen and a sentence were
     not the same operation: an error on row 4,501 left four thousand
     five hundred customers from one of them and none from the other. */
  const done = await commitImport(supabase, {
    rows: records,
    listId: body.list_id ?? null,
  });
  if (!done.ok) return NextResponse.json({ error: done.why, inserted: 0 }, { status: 500 });

  return NextResponse.json({ inserted: done.inserted, refused });
}
