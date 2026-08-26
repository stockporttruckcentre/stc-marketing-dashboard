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
import { isResultRef } from './types';
import { capability, entity as entityDef, RELATIONSHIPS } from './registry';
import type { Store } from './store';
import { runSelect, selectBehind } from './read';
import { resolveReference } from './resolve';

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
  /**
   * The step whose rows this one acts on, when they do not exist yet.
   *
   * "Find 20 waste companies near Hyde and put them on Fleet Prospects"
   * puts twenty rows on a list, and those rows are made by the step in
   * front of it inside the same transaction. There is nothing to
   * resolve here and nothing to preview by id: the plan step is named,
   * and the transaction hands the ids forward.
   */
  fromStep?: string;
  /** Named records this cannot act on, and why. Never silently dropped. */
  missing: InvokeMissing[];
  /** Inputs the operation still needs and nothing supplied. */
  needs: { key: string; label: string }[];
  args: Record<string, unknown>;
};

export type InvokeResolution =
  | { ok: true; plan: InvokePlan }
  | {
      ok: false;
      reason: 'unknown' | 'nothing matched' | 'unresolved' | 'incomplete' | 'too many'
        | 'ambiguous';
      why: string;
      /** Where a sentence naming one record found several. */
      candidates?: { id: string; label: string }[];
    };

/**
 * The most records one operation may run on, if a caller sets one.
 *
 * There is deliberately no number here. A command that names six
 * hundred records means six hundred records, and performing it on five
 * hundred of them is the worst outcome available: it looks like it
 * worked, it is atomic, and it is wrong. Where a ceiling exists it is
 * execution policy, it arrives from the caller, and exceeding it refuses
 * the whole operation before anything runs.
 */
export type InvokeLimits = { maxSubjects?: number };

/** How many keys one lookup carries. A request size, nothing semantic. */
const KEY_PAGE = 200;

function labelOf(row: Record<string, unknown>, title: string | null): string {
  const v = title ? row[title] : null;
  return v == null || v === '' ? String(row.id) : String(v);
}

/**
 * The step that is going to MAKE the rows this one acts on.
 *
 * `null` for everything else, including a reference to a step that acts
 * on rows already here: those can be read, and reading them is what
 * lets the preview say which records before anything runs.
 */
function madeEarlier(plan: Plan, subject: Invoke['subject']): string | null {
  if (!subject || !isResultRef(subject)) return null;
  const ref = subject;
  const step = plan.steps.find((x) => x.id === ref.step);
  if (!step) return null;
  if (step.op === 'create') return step.id ?? null;
  if (step.op !== 'invoke') return null;
  const cap = capability((step as Invoke).capability);
  return cap?.creates ? step.id ?? null : null;
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
  opts: { store: Store; args?: Record<string, unknown>; limits?: InvokeLimits },
): Promise<InvokeResolution> {
  const cap = capability(step.capability);
  if (!cap) return { ok: false, reason: 'unknown', why: `nothing here knows ${step.capability}` };
  if (!cap.handler) {
    return { ok: false, reason: 'unknown', why: cap.needs ?? `nothing performs ${step.capability} yet` };
  }

  /* AN OPERATION THAT MAKES SOMETHING ACTS ON NOTHING.

     Writing a social post starts from the words: the content, the
     platforms and the date are the whole of it, and there is no
     selection to resolve. Everything below is about which records an
     operation runs on, so a capability that declares it creates skips
     to the arguments. */
  if (cap.creates) {
    return resolveArguments(cap, step, [], { store: opts.store, args: opts.args });
  }

  /* ROWS THAT DO NOT EXIST YET.

     "Find 20 waste companies near Hyde and put them on Fleet Prospects"
     acts on rows the step in front of it is about to MAKE. There is
     nothing to read: resolving it would either find nothing or, worse,
     find companies with similar names that were already here. The step
     is named instead and the transaction hands the real ids forward,
     which is the same answer migration 036 gave for a created record.

     Only for a step that makes rows. A reference to something that
     merely acts on rows still resolves, because those rows are there
     to be read. */
  const made = madeEarlier(plan, step.subject);
  if (made) {
    const ready = await resolveArguments(cap, step, [], { store: opts.store, args: opts.args });
    return ready.ok ? { ok: true, plan: { ...ready.plan, fromStep: made } } : ready;
  }

  /* The rows, however the step names them: its own selection, or the
     one a clause before it made. "Create a list from them" carries a
     reference rather than a filter, and resolving it here is what keeps
     the records the list is made from the same records the sentence
     described. */
  const select = selectBehind(plan, step.subject);
  if (!select) {
    return { ok: false, reason: 'unresolved', why: 'that operation does not say which records' };
  }

  const namedEntity = 'entity' in select.from ? (select.from as { entity: string }).entity : null;
  if (!namedEntity) {
    return { ok: false, reason: 'unresolved', why: 'that operation does not say which records' };
  }

  const ceiling = opts.limits?.maxSubjects;

  /* Which entity the operation runs on. A capability that names none
     operates on whatever the sentence named. */
  const wanted = cap.entities?.[0] ?? namedEntity;

  /* THE COLUMNS THE OPERATION NEEDS, ASKED OF THE RIGHT TABLE.

     An input's `from` names a column on the entity the OPERATION runs
     on, which is not always the one the sentence named. "Mark STC143580
     as sold" names a trailer and marks the deal against it sold, and
     `deal.markSold` reads its price from `sale_price` on the deal.
     Adding that column to the read of the trailer asked `stock_trailers`
     for `sale_price`, which does not exist there: the unit carries
     `sales_price`, one letter apart and a different table.

     Postgres said so and the whole command failed with a column name
     nobody typed. Where the operation runs somewhere else, its columns
     are read from there, further down, off the record they belong to. */
  const wantedColumns = wanted === namedEntity
    ? (cap.inputs ?? [])
      /* What a column can do for an input: answer it, or be shown beside
         the answer. Both are read; only the first satisfies it. */
      .flatMap((i) => [i.from, i.shows])
      .filter((c): c is string => !!c)
    : [];
  const read = await runSelect(select, { store: opts.store, ceiling, extraColumns: wantedColumns });
  if (!read.ok) return { ok: false, reason: 'unresolved', why: read.why };

  /* THE SET THE SENTENCE MEANT, OR NOTHING.

     `capped` can only be true where a ceiling was configured and
     exceeded. Carrying on with the rows that came back would perform
     the operation on a subset nobody described. */
  if (read.capped) {
    return {
      ok: false,
      reason: 'too many',
      why: `that names more than ${ceiling?.toLocaleString('en-GB')} records, `
        + 'which is more than this is configured to act on in one go. Narrow it down.',
    };
  }
  if (!read.rows.length) return { ok: false, reason: 'nothing matched', why: 'nothing here matches that' };

  /* ONE MEANS ONE.

     A sentence that named a single record and matched several is a
     question with several answers, and performing the operation on all
     of them is the failure this architecture exists to stop. "Elevate
     Dave to admin" with two Daves promotes neither. */
  if (step.expect === 'one' && read.rows.length > 1) {
    const title = entityDef(namedEntity)?.titleField ?? null;
    return {
      ok: false,
      reason: 'ambiguous',
      why: `${read.rows.length} records match that, so it is not clear which one was meant`,
      candidates: read.rows.slice(0, 20).map((r) => ({
        id: String(r.id), label: labelOf(r, title),
      })),
    };
  }

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
        /* What the record already says about each input: the value that
           answers it, or the one shown beside the answer. */
        values: Object.fromEntries(
          inputs.map((i) => [i.key, i.from ? row[i.from] : i.shows ? row[i.shows] : null])),
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

    /* Paged, like everything else. One key per subject means this read
       is the same size as the selection, and a page size that happened
       to be smaller than it would have dropped the difference. */
    const byKey = new Map<string, Record<string, unknown>>();
    for (let from = 0; from < keys.length; from += KEY_PAGE) {
      const slice = keys.slice(from, from + KEY_PAGE);
      const found = await opts.store.read({
        table: wantedDef.table,
        columns: wantedColumns,
        where: {
          kind: 'in',
          of: { kind: 'field', of: { entity: wanted, field: join.remoteField } },
          values: slice.map((k) => ({ kind: 'literal' as const, value: String(k) })),
        },
        limit: slice.length,
      });
      if (!found.ok) return { ok: false, reason: 'unresolved', why: found.why };
      for (const row of found.rows) byKey.set(String(row[join.remoteField]), row);
    }

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
        values: Object.fromEntries(
          inputs.map((i) => [i.key, i.from ? target[i.from] : i.shows ? target[i.shows] : null])),
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

  return resolveArguments(cap, step, subjects, { store: opts.store, args: opts.args }, missing);
}

/**
 * The declared inputs, and what is still missing by name.
 *
 * An input is satisfied by the sentence or by the record. A required one
 * that is neither is not a thing to guess at: a sale recorded at no
 * price is worse than a sale not recorded.
 */
async function resolveArguments(
  cap: NonNullable<ReturnType<typeof capability>>,
  step: Invoke,
  subjects: InvokeSubject[],
  opts: { store: Store; args?: Record<string, unknown> },
  found: InvokeMissing[] = [],
): Promise<InvokeResolution> {
  const inputs = cap.inputs ?? [];
  const missing = [...found];
  const args = { ...(opts.args ?? {}) };

  /* AN ARGUMENT CAN NAME A ROW WITHOUT SAYING WHICH ROW.

     "Invite Dave to the site visit on Friday" carries "the person whose
     name contains Dave" as the operation's argument. It is resolved
     here, through the same lookup a mutation's values go through, so
     two Daves ask rather than one of them being invited. Literals were
     already lifted out by the caller; this is the other kind. */
  /* SEVERAL NAMES ARE SEVERAL LOOKUPS, AND ALL OF THEM HAVE TO LAND.

     "Share Fleet Prospects with Dave and Tom" carries two references in
     one argument. Each is resolved the same way a single one is, and any
     of them being unknown or ambiguous stops the whole thing: sharing
     with one of two people and reporting both is the failure this layer
     exists to stop. */
  for (const [key, value] of Object.entries(step.args ?? {})) {
    /* THE STEP'S OWN VALUES, NOT THE PROGRAMME'S.

       A literal on this step is what the reader took out of this clause,
       and it is the authority on what this operation was asked for. It
       used to be lifted at the top of the programme, from the first
       operation in it, so a sentence with two operations gave both of
       them the first one's arguments: "find 20 waste companies near
       Hyde and put them on Fleet Prospects" handed the list step the
       search's own arguments and none of its own, and the list name it
       had read went nowhere. */
    if ('kind' in value && value.kind === 'literal') { args[key] = value.value; continue; }
    if (args[key] != null) continue;
    if ('kind' in value && value.kind === 'list') {
      const values: (string | number | boolean | null)[] = [];
      for (const [i, member] of value.of.entries()) {
        if (!('kind' in member) || member.kind !== 'reference') {
          if ('kind' in member && member.kind === 'literal') { values.push(member.value); continue; }
          return {
            ok: false,
            reason: 'unresolved',
            why: 'that argument holds something this cannot look up',
          };
        }
        const one = await resolveReference(opts.store, member, `args.${key}[${i}]`);
        if (one.state === 'ambiguous') {
          return {
            ok: false,
            reason: 'ambiguous',
            why: one.why,
            candidates: one.candidates.map((c) => ({ id: c.id, label: c.label })),
          };
        }
        if (one.state !== 'resolved') return { ok: false, reason: 'unresolved', why: one.why };
        values.push(one.value as string | number | boolean | null);
      }
      args[key] = values as unknown as typeof args[string];
      continue;
    }
    if (!('kind' in value) || value.kind !== 'reference') continue;

    const found = await resolveReference(opts.store, value, `args.${key}`);
    if (found.state === 'ambiguous') {
      return {
        ok: false,
        reason: 'ambiguous',
        why: found.why,
        candidates: found.candidates.map((c) => ({ id: c.id, label: c.label })),
      };
    }
    /* AN OPTIONAL REFERENCE THAT MATCHES NOTHING IS NOT SUPPLIED.

       "Book a call with Dawson on Friday" links the meeting to the
       customer when the CRM holds one by that name. Somebody who is not
       a customer is still somebody to meet, so the link is simply
       absent rather than the whole booking being refused. Two Dawsons
       still ask, because that is a question rather than an absence. */
    if (found.state === 'no match'
      && !inputs.find((i) => i.key === key)?.required) {
      continue;
    }
    if (found.state !== 'resolved') {
      return { ok: false, reason: 'unresolved', why: found.why };
    }
    args[key] = found.value;
  }
  const needs: { key: string; label: string }[] = [];
  for (const input of inputs) {
    if (args[input.key] != null) continue;
    if (!input.required) continue;

    /* An input with no column behind it can only come from the words.
       A list's name is not on any record, so there is nothing to report
       per record: the sentence did not say it. A column that is merely
       SHOWN beside the answer is not behind it either: the role
       somebody holds is what a role change replaces. */
    if (!input.from) {
      needs.push({ key: input.key, label: input.label });
      continue;
    }

    /* An operation that creates has no subjects, so "every subject
       supplied it" is vacuously true and a required input would be
       waved through. It is only satisfied by a record when there is a
       record. */
    const supplied = subjects.filter((s) => s.values[input.key] != null);
    if (subjects.length && supplied.length === subjects.length) continue;
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
