import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { WRITABLE_FIELDS, type WritableField } from '@/lib/command/fields';
import { capabilitiesFor } from '@/lib/crm/permissions';
import type { UserRole } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Writing a single field from the command bar.
 *
 * Runs in two passes on purpose. `preview` resolves what was named and
 * reports the current value beside the proposed one, and writes nothing.
 * Only a second call with `confirm` changes the record. An instruction
 * that edits a row without first showing what it is about to edit is a
 * trap, especially when the record was matched on a partial name.
 *
 * The client sends a field key, never a column. The key is looked up in
 * the same dictionary the parser used, and anything not in it is
 * refused. That is what stops a crafted request writing to a column the
 * bar was never meant to reach.
 */

type Body = {
  entity?: 'trailers' | 'contacts';
  fieldKey?: string;
  op?: 'set' | 'add' | 'subtract' | 'clear';
  value?: string | number | null;
  /** What was typed, before it was resolved. */
  target?: string;
  /** Chosen from the candidates on the second pass. */
  recordId?: string;
  confirm?: boolean;
};

type Candidate = { id: string; label: string; sub?: string };

const TABLES = { trailers: 'stock_trailers', contacts: 'crm_contacts' } as const;

function fieldFor(entity: string, key: string): WritableField | null {
  return WRITABLE_FIELDS.find((f) => f.entity === entity && f.key === key) ?? null;
}

function display(field: WritableField, v: unknown): string {
  if (v == null || v === '') return 'empty';
  if (field.kind === 'money') return `£${Number(v).toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;
  if (field.kind === 'enum') return String(v).replace(/_/g, ' ');
  const s = String(v);
  return s.length > 90 ? `${s.slice(0, 87)}...` : s;
}

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, message: 'Not signed in.' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const entity = body.entity === 'contacts' ? 'contacts' : body.entity === 'trailers' ? 'trailers' : null;
  if (!entity) return NextResponse.json({ ok: false, message: 'I did not understand what to change.' });

  const field = fieldFor(entity, String(body.fieldKey ?? ''));
  if (!field) return NextResponse.json({ ok: false, message: 'That is not a field I can write.' });

  const { data: profile } = await supabase
    .from('profiles').select('role, full_name').eq('id', user.id).single();
  const role = ((profile as { role?: UserRole } | null)?.role ?? 'viewer') as UserRole;
  const caps = capabilitiesFor({ role });

  // The bar already hides what somebody cannot do. This is the check
  // that actually matters, because the bar is only the interface.
  if (!caps.has(field.capability)) {
    return NextResponse.json({ ok: false, message: `You do not have access to change ${field.label.toLowerCase()}.` });
  }

  const op = body.op ?? 'set';
  const table = TABLES[entity];

  /* ---- find the record --------------------------------------------- */
  const titleColumn = entity === 'trailers' ? 'stc_no' : 'company_name';
  const subColumns = entity === 'trailers'
    ? 'make, model, category, location, status'
    : 'contact_name, location, status';

  let record: Record<string, any> | null = null;
  let candidates: Candidate[] = [];

  if (body.recordId) {
    const { data } = await supabase
      .from(table).select(`id, ${titleColumn}, ${subColumns}, ${field.key}`)
      .eq('id', body.recordId).maybeSingle();
    record = (data as any) ?? null;
  } else {
    const term = String(body.target ?? '').trim();
    if (!term) return NextResponse.json({ ok: false, message: 'Name the record to change.' });

    const { data, error } = await supabase
      .from(table).select(`id, ${titleColumn}, ${subColumns}, ${field.key}`)
      .ilike(titleColumn, `%${term}%`).limit(8);
    if (error) return NextResponse.json({ ok: false, message: error.message });

    const hits = (data ?? []) as any[];
    const exact = hits.filter((h) => String(h[titleColumn] ?? '').toLowerCase() === term.toLowerCase());
    if (exact.length === 1) record = exact[0];
    else if (hits.length === 1) record = hits[0];
    else if (hits.length > 1) {
      candidates = hits.map((h) => ({
        id: h.id,
        label: String(h[titleColumn] ?? 'Untitled'),
        sub: subColumns.split(', ').map((c) => h[c.trim()]).filter(Boolean).join(' · '),
      }));
    }
  }

  if (!record && candidates.length) {
    return NextResponse.json({
      ok: false, needsChoice: true,
      message: `More than one match for "${body.target}".`,
      candidates,
    });
  }
  if (!record) {
    return NextResponse.json({
      ok: false,
      message: `Nothing on the ${entity === 'trailers' ? 'stock list' : 'CRM'} matches "${body.target}".`,
    });
  }

  /* ---- work out the new value -------------------------------------- */
  const current = record[field.key] ?? null;
  let next: string | number | null;

  if (op === 'clear') {
    next = null;
  } else if (op === 'add' || op === 'subtract') {
    if (field.kind === 'longtext') {
      const line = String(body.value ?? '').trim();
      if (!line) return NextResponse.json({ ok: false, message: 'Nothing to add.' });
      // Appended on its own line, so the history reads in order rather
      // than turning into one paragraph nobody can unpick.
      next = current ? `${String(current).trimEnd()}\n${line}` : line;
    } else {
      const delta = Number(body.value);
      if (!Number.isFinite(delta)) return NextResponse.json({ ok: false, message: 'That is not a number.' });
      const base = Number(current) || 0;
      next = op === 'add' ? base + delta : base - delta;
    }
  } else {
    next = field.kind === 'money' || field.kind === 'number'
      ? (body.value == null ? null : Number(body.value))
      : (body.value == null ? null : String(body.value));
    if ((field.kind === 'money' || field.kind === 'number') && next != null && !Number.isFinite(next as number)) {
      return NextResponse.json({ ok: false, message: 'That is not a number.' });
    }
  }

  const label = String(record[titleColumn] ?? 'this record');
  const href = entity === 'trailers'
    ? `/dashboard/sales?stock=${record.id}`
    : `/dashboard/crm?contact=${record.id}`;

  /* ---- show it before doing it ------------------------------------- */
  if (!body.confirm) {
    return NextResponse.json({
      ok: true, preview: true,
      recordId: record.id,
      recordLabel: label,
      recordSub: subColumns.split(', ').map((c) => record![c.trim()]).filter(Boolean).join(' · '),
      fieldLabel: field.label,
      before: display(field, current),
      after: display(field, next),
      unchanged: display(field, current) === display(field, next),
      caution: field.caution ?? null,
      link: { href, label: entity === 'trailers' ? 'Open the trailer' : 'Open the record' },
    });
  }

  /* ---- do it -------------------------------------------------------- */
  const { error } = await supabase
    .from(table).update({ [field.key]: next }).eq('id', record.id);
  if (error) return NextResponse.json({ ok: false, message: error.message });

  return NextResponse.json({
    ok: true,
    recordId: record.id,
    message: `${field.label} on ${label} is now ${display(field, next)}.`,
    detail: current == null || current === ''
      ? 'It was empty before.'
      : `It was ${display(field, current)}.`,
    link: { href, label: entity === 'trailers' ? 'Open the trailer' : 'Open the record' },
  });
}
