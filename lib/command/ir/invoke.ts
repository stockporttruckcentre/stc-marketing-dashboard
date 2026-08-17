/* =============================================================
   Carrying out a business operation.

   A field write changes a column. An operation does a job: marking a
   deal sold raises a commission line, flips the stock unit and tells
   every other rep chasing that unit it is gone. Writing the status
   column is one third of that, and the third that looks like all of it.

   WHY THIS IS NOT A HANDLER PER OPERATION.

   Everything below is derived. The capability says which entity it
   operates on and what values it needs; the registry says how to get
   from the entity a sentence named to the entity the operation wants;
   the store says which database function performs it. Adding an
   operation is a capability with `inputs`, a relationship if it operates
   on something other than what people name, and one row in the store's
   function map.

   THE SENTENCE NAMES UNITS AND THE OPERATION WANTS DEALS.

   "Mark all the in stock curtainsiders as sold" selects trailers.
   Selling happens on the deal that trailer is being sold on, which the
   database has always known through `crm_contacts.stock_trailer_id`.
   That link is now a declared relationship, so the traversal is a
   registry lookup rather than a special case, and a unit with no deal on
   it is reported by name rather than silently dropped.

   MISSING BUSINESS INFORMATION IS NAMED, NOT GUESSED.

   A sale needs a price. Almost always the deal has one, which is what
   the input's `from` column is for. Where neither the deal nor the
   sentence supplies one, this refuses and says which deals, because a
   sale recorded at nothing is worse than a sale not recorded.
   ============================================================= */
import type { Invoke, Plan, Select } from './types';
import { capability, entity as entityDef, RELATIONSHIPS } from './registry';
import type { Store } from './store';
import { runSelect } from './read';

export type InvokeSubject = {
  /** The row the operation will run on. */
  id: string;
  label: string;
  /** The row the sentence named, when that is a different record. */
  viaId?: string;
  viaLabel?: string;
  /** Values read off the subject for the capability's declared inputs. */
  values: Record<string, unknown>;
};

export type InvokeMissing = {
  /** What the sentence named that cannot be operated on. */
  label: string;
  why: string;
};

export type InvokePlan = {
  capability: string;
  label: string;
  subjects: InvokeSubject[];
  /** Named records this cannot act on, and why. Never silently dropped. */
  missing: InvokeMissing[];
  /** Inputs the operation still needs and nothing supplied. */
  needs: { key: string; label: string }[];
  args: Record<string, unknown>;
};

export type InvokeResolution =
  | { ok: true; plan: InvokePlan }
  | { ok: false; reason: 'unknown' | 'nothing matched' | 'unresolved' | 'incomplete'; why: string };

/** How many rows one invocation reads. */
const SUBJECT_CAP = 500;

function labelOf(row: Record<string, unknown>, title: string | null): string {
  const v = title ? row[title] : null;
  return v == null || v === '' ? String(row.id) : String(v);
}

/**
 * Resolve an invoke step into the rows it will act on.
 *
 * Nothing is performed. This is the preview: which records, which of
 * them cannot be acted on and why, and what the operation still needs.
 */
export async function resolveInvoke(
  plan: Plan,
  step: Invoke,
  opts: { store: Store; args?: Record<string, unknown> },
): Promise<InvokeResolution> {
  const cap = capability(step.capability);
  if (!cap) return { ok: false, reason: 'unknown', why: `nothing here knows ${step.capability}` };
  if (!cap.handler) {
    return { ok: false, reason: 'unknown', why: `nothing performs ${step.capability} yet` };
  }

  const subject = step.subject;
  if (!subject || !('op' in subject)) {
    return { ok: false, reason: 'unresolved', why: 'that operation does not say which records' };
  }

  const select = subject as Select;
  const namedEntity = 'entity' in select.from ? (select.from as { entity: string }).entity : null;
  if (!namedEntity) {
    return { ok: false, reason: 'unresolved', why: 'that operation does not say which records' };
  }

  const read = await runSelect(select, { store: opts.store, cap: SUBJECT_CAP });
  if (!read.ok) return { ok: false, reason: 'unresolved', why: read.why };
  if (!read.rows.length) return { ok: false, reason: 'nothing matched', why: 'nothing here matches that' };

  /* Which entity the operation runs on. A capability that names none
     operates on whatever the sentence named. */
  const wanted = cap.entities?.[0] ?? namedEntity;
  const namedDef = entityDef(namedEntity);
  const wantedDef = entityDef(wanted);
  if (!wantedDef) return { ok: false, reason: 'unknown', why: `nothing here holds ${wanted}` };

  const inputs = cap.inputs ?? [];
  const subjects: InvokeSubject[] = [];
  const missing: InvokeMissing[] = [];

  if (wanted === namedEntity) {
    for (const row of read.rows) {
      subjects.push({
        id: String(row.id),
        label: labelOf(row, namedDef?.titleField ?? null),
        values: Object.fromEntries(inputs.map((i) => [i.key, i.from ? row[i.from] : null])),
      });
    }
  } else {
    /* Across the declared relationship, in one read rather than one per
       row. A join nobody declared is not a join this will invent. */
    const edge = RELATIONSHIPS.find(
      (r) => r.from === namedEntity && r.to === wanted && r.join.via === 'key',
    );
    const join = edge && edge.join.via === 'key' ? edge.join : null;
    if (!edge || !join) {
      return {
        ok: false, reason: 'unresolved',
        /* A relationship joined by matching names is not a link an
           operation may run down. "The customer who bought it" is a
           guess at a company name, and selling something on the
           strength of a guess is not a thing to do. */
        why: `nothing declares a key from ${namedEntity} to ${wanted}`,
      };
    }

    const keys = read.rows.map((r) => r[join.localField]).filter((v) => v != null);
    if (!keys.length) {
      return { ok: false, reason: 'nothing matched', why: `those ${namedDef?.label ?? namedEntity} have nothing to act on` };
    }

    const wantedColumns = [...new Set([
      'id',
      ...(wantedDef.titleField ? [wantedDef.titleField] : []),
      join.remoteField,
      ...inputs.map((i) => i.from).filter((c): c is string => !!c),
    ])];

    const found = await opts.store.read({
      table: wantedDef.table,
      columns: wantedColumns,
      where: {
        kind: 'in',
        of: { kind: 'field', of: { entity: wanted, field: join.remoteField } },
        values: keys.map((k) => ({ kind: 'literal' as const, value: String(k) })),
      },
      limit: SUBJECT_CAP + 1,
    });
    if (!found.ok) return { ok: false, reason: 'unresolved', why: found.why };

    const byKey = new Map<string, Record<string, unknown>>();
    for (const row of found.rows) byKey.set(String(row[join.remoteField]), row);

    for (const row of read.rows) {
      const key = String(row[join.localField]);
      const target = byKey.get(key);
      const label = labelOf(row, namedDef?.titleField ?? null);
      if (!target) {
        missing.push({ label, why: `${label} has no ${wantedDef.labelOne} on it` });
        continue;
      }
      subjects.push({
        id: String(target.id),
        label: labelOf(target, wantedDef.titleField ?? null),
        viaId: String(row.id),
        viaLabel: label,
        values: Object.fromEntries(inputs.map((i) => [i.key, i.from ? target[i.from] : null])),
      });
    }
  }

  if (!subjects.length) {
    return {
      ok: false,
      reason: 'incomplete',
      why: missing.length
        ? `none of those can be acted on: ${missing.slice(0, 5).map((m) => m.why).join('; ')}`
        : 'nothing here matches that',
    };
  }

  /* WHAT IS STILL MISSING, BY NAME.

     An input is satisfied by the sentence or by the record. A required
     one that is neither is not a thing to guess at: a sale recorded at
     no price is worse than a sale not recorded. */
  const args = { ...(opts.args ?? {}) };
  const needs: { key: string; label: string }[] = [];
  for (const input of inputs) {
    if (args[input.key] != null) continue;
    if (!input.required) continue;

    /* An input with no column behind it can only come from the words.
       A list's name is not on any record, so there is nothing to report
       per record: the sentence did not say it. */
    if (!input.from) {
      needs.push({ key: input.key, label: input.label });
      continue;
    }

    const supplied = subjects.filter((s) => s.values[input.key] != null);
    if (supplied.length === subjects.length) continue;
    const without = subjects.filter((s) => s.values[input.key] == null);
    needs.push({ key: input.key, label: input.label });
    missing.push(...without.map((s) => ({
      label: s.label,
      why: `${s.label} has no ${input.label}, and the instruction did not give one`,
    })));
  }

  if (needs.length) {
    const what = needs.map((n) => n.label).join(' and ');
    /* Named, and said in terms of the thing that is missing rather than
       in terms of a sale. A capability declares its inputs and this
       reports whichever of them nobody supplied. */
    const where = missing.length
      ? `on ${missing.length} ${missing.length === 1 ? 'record' : 'records'}: `
        + `${missing.slice(0, 5).map((m) => m.label).join(', ')}`
        + `${missing.length > 5 ? ` and ${missing.length - 5} more` : ''}`
      : 'and nothing supplied it';
    return {
      ok: false,
      reason: 'incomplete',
      why: `${what} missing ${where}. Say the ${needs[0].label} in the instruction, `
        + 'or set it on the records first.',
    };
  }

  return {
    ok: true,
    plan: {
      capability: cap.id,
      label: cap.label,
      subjects,
      missing,
      needs,
      args,
    },
  };
}
