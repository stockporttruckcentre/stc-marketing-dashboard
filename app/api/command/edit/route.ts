import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { WRITABLE_FIELDS, type WritableField, type WritableEntity } from '@/lib/command/fields';
import { capabilitiesFor } from '@/lib/crm/permissions';
import type { Condition } from '@/lib/command/select';
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
 * The client sends a field key, never a column. The key is looked up in
 * the same dictionary the parser used, and anything not in it is
 * refused. That is what stops a crafted request writing to a column the
 * bar was never meant to reach.
 */

type TargetIn =
  | { kind: 'stock' | 'company'; text: string }
  | { kind: 'filter'; column: string; value: string; label?: string }
  /**
   * A composed set of rows: "every customer in Manchester with no owner
   * nobody has rung in a month". Every condition narrows the last, and
   * the preview counts what matched before anything is written.
   */
  | { kind: 'selection'; conditions: Condition[]; label?: string };

type Body = {
  entity?: WritableEntity;
  fieldKey?: string;
  op?: 'set' | 'add' | 'subtract' | 'clear';
  value?: string | number | null;
  /** One target, or several. Both accepted so older callers still work. */
  target?: string;
  targets?: TargetIn[];
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

  const targets: TargetIn[] = body.targets?.length
    ? body.targets
    : (body.target ? [{ kind: 'stock', text: body.target }] : []);

  /* ---- a composed set of rows --------------------------------------- */
  const selection = targets.find((t) => t.kind === 'selection') as
    Extract<TargetIn, { kind: 'selection' }> | undefined;

  if (selection) {
    return applySelection(supabase, {
      entity, field, table, titleColumn, select,
      conditions: selection.conditions,
      label: selection.label ?? 'those records',
      op, value: body.value ?? null, confirm: !!body.confirm,
    });
  }

  /* ---- a description of rows, rather than named ones ---------------- */
  const bulk = targets.find((t) => t.kind === 'filter') as
    Extract<TargetIn, { kind: 'filter' }> | undefined;

  if (bulk) {
    if (!fieldFor(entity, bulk.column)) {
      return NextResponse.json({ ok: false, message: 'I cannot narrow on that.' });
    }
    const { data, error } = await supabase
      .from(table).select(select).eq(bulk.column, bulk.value).limit(500);
    if (error) return NextResponse.json({ ok: false, message: error.message });

    const rows = (data ?? []) as any[];
    if (!rows.length) {
      return NextResponse.json({ ok: false, message: `Nothing is ${bulk.label ?? bulk.value} right now.` });
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
        before: display(field, bulk.value),
        after: display(field, body.value ?? null),
        caution: field.caution ?? null,
        link: { href: hrefFor(entity, rows[0].id), label: 'Open the screen' },
      });
    }

    const { error: writeErr } = await supabase
      .from(table).update({ [field.key]: body.value ?? null }).eq(bulk.column, bulk.value);
    if (writeErr) return NextResponse.json({ ok: false, message: writeErr.message });

    return NextResponse.json({
      ok: true,
      message: `${rows.length} ${entity === 'posts' ? 'social post' : 'record'}${rows.length === 1 ? '' : 's'} set to ${display(field, body.value ?? null)}.`,
      detail: `They were ${display(field, bulk.value)}.`,
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
    if (!targets.length) return NextResponse.json({ ok: false, message: 'Name the record to change.' });

    for (const t of targets) {
      if (t.kind === 'filter' || t.kind === 'selection') continue;
      const term = String(t.text ?? '').trim();
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


/**
 * Apply one field to every row a composed selector picks out.
 *
 * The conditions are rebuilt server side against an allowlist of the
 * columns this entity declares, so a crafted request cannot narrow on a
 * column the parser would never have produced, and cannot use the
 * selector as a way to read one.
 *
 * Nothing is written on the preview pass. It reports the count and a
 * sample, because "every customer in Manchester nobody has rung" is a
 * number somebody should see before it becomes an edit.
 */
async function applySelection(
  supabase: ReturnType<typeof createClient>,
  o: {
    entity: WritableEntity; field: WritableField; table: string;
    titleColumn: string; select: string;
    conditions: Condition[]; label: string;
    op: 'set' | 'add' | 'subtract' | 'clear';
    value: string | number | null; confirm: boolean;
  },
) {
  const allowed = new Set(
    WRITABLE_FIELDS.filter((f) => f.entity === o.entity).map((f) => f.key),
  );
  // Columns a selector may narrow on but nobody writes.
  for (const extra of ['links', 'fleet_size', 'profit', 'profit_pct', 'total_nbv',
                       'created_at', 'updated_at', 'last_activity_at']) allowed.add(extra);

  const usable = o.conditions.filter((c) => c.kind === 'owner' || allowed.has(c.column));
  if (!usable.length) {
    return NextResponse.json({ ok: false, message: 'I could not narrow that down safely.' });
  }

  let q: any = supabase.from(o.table).select(o.select);
  for (const c of usable) {
    switch (c.kind) {
      case 'eq': q = q.eq(c.column, c.value); break;
      case 'ilike': q = q.ilike(c.column, `%${c.value}%`); break;
      case 'empty': q = q.is(c.column, null); break;
      case 'present': q = q.not(c.column, 'is', null); break;
      case 'gte': q = q.gte(c.column, c.value); break;
      case 'lte': q = q.lte(c.column, c.value); break;
      case 'before': q = q.lt(c.column, c.value); break;
      case 'after': q = q.gte(c.column, c.value); break;
      case 'owner':
        q = c.value === null
          ? q.is('assigned_to', null)
          : q.ilike('assigned_to', `%${c.value}%`);
        break;
    }
  }

  const { data, error } = await q.limit(1000);
  if (error) return NextResponse.json({ ok: false, message: error.message });

  const rows = (data ?? []) as any[];
  if (!rows.length) {
    return NextResponse.json({ ok: false, message: `Nothing matches ${o.label}.` });
  }

  const next = o.op === 'clear' ? null
    : (o.field.kind === 'money' || o.field.kind === 'number')
      ? Number(o.value) : o.value;

  if (!o.confirm) {
    return NextResponse.json({
      ok: true, preview: true, bulk: true,
      count: rows.length,
      recordIds: rows.map((r) => r.id),
      recordLabel: `${rows.length} ${rows.length === 1 ? 'record' : 'records'}`,
      recordSub: `${o.label}. ${rows.slice(0, 3).map((r) => labelOf(o.entity, r)).join(', ')}`
        + (rows.length > 3 ? ` and ${rows.length - 3} more` : ''),
      fieldLabel: o.field.label,
      before: 'as they are',
      after: display(o.field, next),
      caution: rows.length > 50
        ? `That is ${rows.length} records in one go. Worth reading the list first.`
        : (o.field.caution ?? null),
      link: { href: hrefFor(o.entity, rows[0].id), label: 'Open the first one' },
    });
  }

  const ids = rows.map((r) => r.id);
  const { error: writeErr } = await supabase
    .from(o.table).update({ [o.field.key]: next }).in('id', ids);
  if (writeErr) return NextResponse.json({ ok: false, message: writeErr.message });

  return NextResponse.json({
    ok: true,
    message: `${o.field.label} set on ${ids.length} ${ids.length === 1 ? 'record' : 'records'}.`,
    detail: o.label,
    link: { href: hrefFor(o.entity, ids[0]), label: 'Open the first one' },
  });
}
