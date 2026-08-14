import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { WRITABLE_FIELDS, type WritableField, type WritableEntity } from '@/lib/command/fields';
import { capabilitiesFor } from '@/lib/crm/permissions';
import { applyCond } from '@/lib/command/ir/resolve';
import type { Cond } from '@/lib/command/ir/types';
import type { UserRole } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Writing from the command bar.
 *
 * Runs in two passes on purpose. `preview` resolves what was named and
 * reports the current value beside the proposed one, and writes nothing.
 * Only a second call with `confirm` changes anything. An instruction that
 * edits a record without first showing what it is about to edit is a
 * trap, especially when the record was matched on a partial name.
 *
 * Three shapes of target, because that is what people type:
 *
 *   one record     "add £1k refurb to STC143980"
 *   several        "mark STC143580 and 144504 as sold"
 *   a description  "mark all outstanding social posts as approved"
 *
 * The third counts the rows before it touches them, because "all" is a
 * word worth being sure about.
 *
 * A description arrives as the same `Cond` a question is answered from,
 * and is narrowed by the same `applyCond` a read uses. It used to arrive
 * as one column and one value, which is why "every available
 * curtainsider at Hyde" could not be typed as an instruction: the
 * instruction side could only select on the field it was writing.
 *
 * The client sends a field key, never a column. The key is looked up in
 * the same dictionary the parser used, and anything not in it is
 * refused. That is what stops a crafted request writing to a column the
 * bar was never meant to reach.
 */

type Body = {
  entity?: WritableEntity;
  fieldKey?: string;
  op?: 'set' | 'add' | 'subtract' | 'clear';
  value?: string | number | null;
  /** One named record, still accepted so older callers work. */
  target?: string;
  /**
   * Which rows, in the two forms an instruction can name them.
   *
   * `named` is what the sentence called each record, matched loosely
   * because people type the last few digits of a stock number. `match`
   * is the canonical condition the reader produced, and for a described
   * set it is the only thing that says which rows. There used to be a
   * third form here, a `{column, value}` filter, and it could carry one
   * enum and nothing else.
   */
  named?: string[];
  match?: Cond | null;
  /** How many rows the sentence named, never how many matched. */
  expect?: 'one' | 'many';
  /** Chosen from the candidates on the second pass. */
  recordId?: string;
  recordIds?: string[];
  confirm?: boolean;
  /** Understood here, carried out elsewhere. Never writes. */
  handoff?: 'markSold';
};

type Candidate = { id: string; label: string; sub?: string };

const TABLES: Record<WritableEntity, string> = {
  trailers: 'stock_trailers',
  contacts: 'crm_contacts',
  posts: 'social_posts',
  meetings: 'calendar_events',
};

const TITLE: Record<WritableEntity, string> = {
  trailers: 'stc_no',
  contacts: 'company_name',
  posts: 'content',
  meetings: 'title',
};

const SUBS: Record<WritableEntity, string[]> = {
  trailers: ['make', 'model', 'category', 'location', 'status'],
  contacts: ['contact_name', 'location', 'status'],
  posts: ['scheduled_date', 'status'],
  meetings: ['start_at', 'visibility'],
};

/** Where a record lives, so the bar never leaves somebody to go and find it. */
function hrefFor(entity: WritableEntity, id: string): string {
  switch (entity) {
    case 'trailers': return `/dashboard/sales?stock=${id}`;
    case 'contacts': return `/dashboard/crm?contact=${id}`;
    case 'posts': return '/dashboard/social';
    case 'meetings': return `/dashboard/calendar?event=${id}`;
  }
}

const SCREEN_NAME: Record<WritableEntity, string> = {
  trailers: 'stock list', contacts: 'CRM', posts: 'planner', meetings: 'calendar',
};

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

function labelOf(entity: WritableEntity, row: Record<string, any>): string {
  const raw = String(row[TITLE[entity]] ?? '').trim();
  if (!raw) return 'Untitled';
  // A post's title is its body, which is a paragraph.
  return raw.length > 60 ? `${raw.slice(0, 57)}...` : raw;
}

function subOf(entity: WritableEntity, row: Record<string, any>): string {
  return SUBS[entity].map((c) => row[c]).filter(Boolean).join(' · ');
}

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, message: 'Not signed in.' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const entity = (['trailers', 'contacts', 'posts', 'meetings'] as const).find((e) => e === body.entity) ?? null;
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
  const titleColumn = TITLE[entity];
  const select = ['id', titleColumn, ...SUBS[entity], field.key].filter(
    (c, i, a) => a.indexOf(c) === i,
  ).join(', ');

  const named: string[] = body.named?.length
    ? body.named
    : (body.target ? [body.target] : []);

  /* ---- a description of rows, rather than named ones ---------------- */
  /* Only where the sentence said every match. A loose match on a name
     that happens to fit forty accounts is an ambiguity to raise, which
     is the named path below, not permission to write forty. */
  if (!named.length && body.match && body.expect === 'many') {
    const narrowed = applyCond(supabase.from(table).select(select), body.match);
    if (narrowed.unsupported) {
      return NextResponse.json({ ok: false, message: 'I could not narrow that down safely.' });
    }
    const { data, error } = await narrowed.q.limit(500);
    if (error) return NextResponse.json({ ok: false, message: error.message });

    const rows = (data ?? []) as any[];
    if (!rows.length) {
      return NextResponse.json({ ok: false, message: 'Nothing matches that right now.' });
    }

    if (!body.confirm) {
      return NextResponse.json({
        ok: true, preview: true, bulk: true,
        count: rows.length,
        recordIds: rows.map((r) => r.id),
        recordLabel: `${rows.length} ${entity === 'posts' ? 'social post' : 'record'}${rows.length === 1 ? '' : 's'}`,
        recordSub: rows.slice(0, 3).map((r) => labelOf(entity, r)).join(' · ')
          + (rows.length > 3 ? ` and ${rows.length - 3} more` : ''),
        fieldLabel: field.label,
        /* What they are now, read off the rows themselves. The old shape
           printed the one value it had narrowed on, which was only ever
           right because it could only narrow on the field being written. */
        before: [...new Set(rows.map((r) => display(field, r[field.key])))].slice(0, 3).join(', '),
        after: display(field, body.value ?? null),
        caution: field.caution ?? null,
        link: { href: hrefFor(entity, rows[0].id), label: 'Open the screen' },
      });
    }

    /* By id, not by re-running the condition. The rows above are the
       rows the person was shown, and narrowing again would write to
       whatever matches now. */
    const { error: writeErr } = await supabase
      .from(table).update({ [field.key]: body.value ?? null }).in('id', rows.map((r) => r.id));
    if (writeErr) return NextResponse.json({ ok: false, message: writeErr.message });

    return NextResponse.json({
      ok: true,
      message: `${rows.length} ${entity === 'posts' ? 'social post' : 'record'}${rows.length === 1 ? '' : 's'} set to ${display(field, body.value ?? null)}.`,
      link: { href: hrefFor(entity, rows[0].id), label: 'Open the screen' },
    });
  }

  /* ---- named records ------------------------------------------------ */
  const ids = body.recordIds?.length ? body.recordIds : (body.recordId ? [body.recordId] : []);
  const found: Record<string, any>[] = [];
  let candidates: Candidate[] = [];
  let ambiguousTerm = '';

  if (ids.length) {
    const { data } = await supabase.from(table).select(select).in('id', ids);
    found.push(...((data ?? []) as any[]));
  } else {
    if (!named.length) return NextResponse.json({ ok: false, message: 'Name the record to change.' });

    for (const t of named) {
      const term = String(t ?? '').trim();
      if (!term) continue;

      /* A trailer answers to more than one name. Somebody types the
         stock number, the digits without the prefix, or the chassis
         number off the plate, and all three have to land on the unit. */
      let q = supabase.from(table).select(select);
      q = entity === 'trailers'
        ? q.or(`stc_no.ilike.%${term}%,chassis_number.ilike.%${term}%`)
        : q.ilike(titleColumn, `%${term}%`);

      const { data, error } = await q.limit(8);
      if (error) return NextResponse.json({ ok: false, message: error.message });

      const hits = (data ?? []) as any[];
      const exact = hits.filter((h) => String(h[titleColumn] ?? '').toLowerCase() === term.toLowerCase());

      if (exact.length === 1) found.push(exact[0]);
      else if (hits.length === 1) found.push(hits[0]);
      else if (hits.length > 1) {
        ambiguousTerm = term;
        candidates = hits.map((h) => ({ id: h.id, label: labelOf(entity, h), sub: subOf(entity, h) }));
        break;
      } else {
        return NextResponse.json({
          ok: false,
          message: `Nothing on the ${SCREEN_NAME[entity]} matches "${term}".`,
        });
      }
    }
  }

  if (candidates.length) {
    return NextResponse.json({
      ok: false, needsChoice: true,
      message: `More than one match for "${ambiguousTerm}".`,
      candidates,
    });
  }
  if (!found.length) return NextResponse.json({ ok: false, message: 'I could not find that record.' });

  /* ---- understood here, carried out elsewhere ----------------------- */
  if (body.handoff === 'markSold') {
    return NextResponse.json({
      ok: true, preview: true, handoff: 'markSold',
      recordIds: found.map((r) => r.id),
      recordLabel: found.map((r) => labelOf(entity, r)).join(' and '),
      recordSub: found.map((r) => subOf(entity, r)).filter(Boolean).join(' · '),
      fieldLabel: 'Status',
      before: found.map((r) => display(field, r[field.key])).join(', '),
      after: 'sold',
      caution: 'Selling needs a price and raises the commission line on the tracker, so it finishes on the stock list rather than here.',
      link: { href: hrefFor(entity, found[0].id), label: found.length > 1 ? 'Open the first one' : 'Open the trailer' },
    });
  }

  /* ---- work out the new value for each ------------------------------ */
  const changes = found.map((record) => {
    const current = record[field.key] ?? null;
    let next: string | number | null;

    if (body.op === 'clear') {
      next = null;
    } else if (body.op === 'add' || body.op === 'subtract') {
      if (field.kind === 'longtext') {
        const line = String(body.value ?? '').trim();
        // Appended on its own line, so the history reads in order rather
        // than turning into one paragraph nobody can unpick.
        next = current ? `${String(current).trimEnd()}\n${line}` : line;
      } else {
        const delta = Number(body.value);
        const base = Number(current) || 0;
        next = body.op === 'add' ? base + delta : base - delta;
      }
    } else {
      next = field.kind === 'money' || field.kind === 'number'
        ? (body.value == null ? null : Number(body.value))
        : (body.value == null ? null : String(body.value));
    }
    return { record, current, next };
  });

  if (body.op !== 'clear') {
    if (field.kind === 'longtext' && !String(body.value ?? '').trim()) {
      return NextResponse.json({ ok: false, message: 'Nothing to add.' });
    }
    if ((field.kind === 'money' || field.kind === 'number')
      && changes.some((c) => !Number.isFinite(Number(c.next)))) {
      return NextResponse.json({ ok: false, message: 'That is not a number.' });
    }
  }

  const first = changes[0];
  const many = changes.length > 1;

  /* ---- show it before doing it -------------------------------------- */
  if (!body.confirm) {
    return NextResponse.json({
      ok: true, preview: true,
      recordId: first.record.id,
      recordIds: changes.map((c) => c.record.id),
      recordLabel: changes.map((c) => labelOf(entity, c.record)).join(' and '),
      recordSub: many
        ? `${changes.length} records`
        : subOf(entity, first.record),
      fieldLabel: field.label,
      before: changes.map((c) => display(field, c.current)).join(', '),
      after: changes.map((c) => display(field, c.next)).join(', '),
      unchanged: changes.every((c) => display(field, c.current) === display(field, c.next)),
      caution: field.caution ?? null,
      link: { href: hrefFor(entity, first.record.id), label: many ? 'Open the first one' : 'Open the record' },
    });
  }

  /* ---- do it --------------------------------------------------------- */
  for (const c of changes) {
    const { error } = await supabase
      .from(table).update({ [field.key]: c.next }).eq('id', c.record.id);
    if (error) return NextResponse.json({ ok: false, message: error.message });
  }

  return NextResponse.json({
    ok: true,
    recordId: first.record.id,
    message: many
      ? `${field.label} set on ${changes.length} records.`
      : `${field.label} on ${labelOf(entity, first.record)} is now ${display(field, first.next)}.`,
    detail: many
      ? changes.map((c) => `${labelOf(entity, c.record)}: ${display(field, c.next)}`).join(', ')
      : (first.current == null || first.current === ''
          ? 'It was empty before.'
          : `It was ${display(field, first.current)}.`),
    link: { href: hrefFor(entity, first.record.id), label: many ? 'Open the first one' : 'Open the record' },
  });
}
