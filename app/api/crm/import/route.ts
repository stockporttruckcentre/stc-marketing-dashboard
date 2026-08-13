import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { CRM_CONTACTS } from '@/lib/import/dictionary';
import { ukToday } from '@/lib/format/date';
import type { ContactStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

/* =============================================================
   Committing an import.

   This used to guess the columns itself, from a short list of header
   spellings, and fell back to `company_name: 'Unknown'` when it found
   nothing. That is how a file with the wrong headers produced hundreds
   of records called Unknown and a response saying it had worked.

   Guessing now happens in the browser, in front of the user, and the
   result is confirmed before anything is sent. So this route's job is
   narrower and stricter: take rows that are already mapped, throw away
   anything that is not a real column, and refuse a row with no company
   name rather than inventing one.

   It is still not allowed to trust the client. The whitelist is built
   from the same dictionary the UI maps against, so a hand rolled POST
   cannot write to a column the import was never meant to touch.
   ============================================================= */

const VALID_STATUSES: ContactStatus[] = ['lead', 'contacted', 'quoted', 'won', 'customer', 'lost'];

/** Every column the dictionary can legitimately produce. Nothing else lands. */
const ALLOWED = new Set(
  CRM_CONTACTS.fields.map((f) => f.target).filter((t): t is string => Boolean(t)),
);

/** Columns the dictionary names but the contacts table does not hold directly. */
const SYNTHETIC = new Set(['website']);

export async function POST(req: NextRequest) {
  /* Bulk inserting five thousand contacts is exactly the thing a read
     only account should not be able to do. crm.import existed as a
     capability and was never consulted here. */
  const gate = await requireCapability('crm.import');
  if (!gate.ok) return gate.response;
  const { supabase } = gate;

  const body = await req.json().catch(() => ({}));
  const rows: any[] = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return NextResponse.json({ error: 'no rows' }, { status: 400 });
  if (rows.length > 5000) {
    return NextResponse.json({ error: 'That is more than 5000 rows. Split the file and import it in parts.' }, { status: 400 });
  }

  let listId = body.list_id;
  if (!listId) {
    const { data: globalList } = await supabase.from('crm_lists').select('id').eq('is_global', true).single();
    listId = globalList?.id;
  }

  const records: Record<string, any>[] = [];
  let refused = 0;

  for (const row of rows) {
    if (!row || typeof row !== 'object') { refused++; continue; }

    const company = String(row.company_name ?? '').trim();
    // No name, no record. The old fallback to "Unknown" is the single
    // worst thing an import can do: it succeeds loudly and leaves rows
    // nobody can identify or clean up.
    if (!company) { refused++; continue; }

    const rec: Record<string, any> = {
      list_id: listId,
      company_name: company.slice(0, 255),
      source: typeof row.source === 'string' && row.source.trim() ? row.source.trim().slice(0, 120) : 'Spreadsheet import',
      status: VALID_STATUSES.includes(row.status) ? row.status : 'lead',
      date_of_enquiry: row.date_of_enquiry ?? ukToday(),
    };

    for (const [key, value] of Object.entries(row)) {
      if (!ALLOWED.has(key) || SYNTHETIC.has(key)) continue;
      if (key in rec) continue;
      if (value === null || value === undefined || value === '') continue;
      rec[key] = value;
    }

    // A website came through the dictionary as its own field, but the
    // table keeps links as one JSON column.
    if (typeof row.website === 'string' && row.website.trim()) {
      rec.links = [{
        id: crypto.randomUUID(),
        label: 'Website',
        url: row.website.trim(),
        kind: 'website',
      }];
    }

    records.push(rec);
  }

  if (!records.length) {
    return NextResponse.json({
      error: 'None of those rows had a company name, so there was nothing to file them under.',
    }, { status: 400 });
  }

  let inserted = 0;
  for (let i = 0; i < records.length; i += 500) {
    const chunk = records.slice(i, i + 500);
    const { error, count } = await supabase.from('crm_contacts').insert(chunk, { count: 'exact' });
    if (error) {
      return NextResponse.json({
        error: `${error.message}. ${inserted} were saved before this happened.`,
        inserted,
      }, { status: 500 });
    }
    inserted += count ?? chunk.length;
  }

  return NextResponse.json({ inserted, refused });
}
