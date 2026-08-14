/* =============================================================
   Carrying out a canonical mutation, on the server, in two passes.

   The path, end to end, with nothing skippable in it:

     raw text
       -> authoritative planner, with THIS actor's vocabulary
       -> canonical Plan
       -> validation, completion, derived permissions, executability
       -> resolveProgramme                     nothing is written
       -> exact preview, and two hashes
       -> a person says yes
       -> the server replans the RAW TEXT and both hashes must match
       -> Store.apply                          one transaction

   THE BROWSER SENDS TEXT AND TWO FINGERPRINTS. NOTHING ELSE.

   Not a plan, not a list of row ids, not the values to write. Every one
   of those would be a client deciding what happens to a record, and the
   two hashes are not tokens: the server plans and resolves again from
   the text either way, and the hashes only decide whether what it
   arrives at is what somebody agreed to. A forged hash buys nothing,
   because the plan it would authorise is the plan the server just built
   for itself.

   TWO HASHES, TWO DIFFERENT KINDS OF DRIFT.

     planHash        the sentence came to MEAN something else, because
                     the vocabulary moved: a word that named nothing now
                     names a make
     programmeHash   the sentence still means the same thing and the
                     WORLD moved: somebody else changed the price, a
                     trailer arrived at Hyde, the customer whose name
                     matched was renamed

   Either one returns a fresh preview and writes nothing.
   ============================================================= */
import type { CommandPlanning } from '../plan';
import { planAuthoritatively, planForExecution, planHash, type Planned, type PlanRequest } from './planner';
import { resolveProgramme, executeProgramme, type Programme } from '../ir/orchestrate';
import type { ExecutionPolicy } from '../ir/orchestrate';
import type { Store } from '../ir/store';
import type { Mutate, Plan } from '../ir/types';
import { WRITABLE_FIELDS, type WritableField } from '../fields';

/* -------------------------------------------------------------
   What a person is shown
   ------------------------------------------------------------- */

export type ChangedField = {
  entity: string;
  field: string;
  label: string;
  caution: string | null;
  /** The capability required to write it, from the dictionary. */
  requires: string;
};

export type RowChange = {
  label: string;
  before: string;
  after: string;
};

export type MutationPreview =
  | {
      ok: true;
      /** Which fields, in the order the plan writes them. */
      fields: ChangedField[];
      /** How many records this will change. */
      count: number;
      /**
       * Per row, up to `sampleSize`.
       *
       * Per row rather than one shared pair, because a bulk change
       * usually starts from different values. "They were outstanding"
       * was true of a set narrowed on the column being written and false
       * of everything else, and a preview that says one thing about
       * eleven rows holding eleven values is a preview that lies.
       */
      rows: RowChange[];
      /** True when every row starts and ends the same, so one line says it. */
      uniform: boolean;
      cautions: string[];
      programmeHash: string;
    }
  | {
      ok: false;
      reason: Extract<Programme, { ok: false }>['reason'] | 'not a mutation';
      why: string;
      /** For a selection that named one record and found several. */
      candidates?: { id: string; label: string }[];
      /** For a symbolic reference that could mean more than one row. */
      referenceCandidates?: { id: string; label: string }[];
    };

/** How many rows to describe individually before summarising. */
export const SAMPLE_SIZE = 8;

/* -------------------------------------------------------------
   Reading the plan back into words
   ------------------------------------------------------------- */

function dictionary(entity: string, key: string): WritableField | null {
  return WRITABLE_FIELDS.find((f) => f.entity === entity && f.key === key) ?? null;
}

function display(spec: WritableField | null, v: unknown): string {
  if (v == null || v === '') return 'empty';
  if (spec?.kind === 'money') {
    return `£${Number(v).toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;
  }
  if (spec?.kind === 'enum') return String(v).replace(/_/g, ' ');
  const s = String(v);
  return s.length > 90 ? `${s.slice(0, 87)}...` : s;
}

/** Every field the plan's mutation steps write, in plan order. */
export function changedFields(plan: Plan): ChangedField[] {
  const out: ChangedField[] = [];
  for (const step of plan.steps) {
    if (step.op !== 'update' && step.op !== 'create') continue;
    for (const a of (step as Mutate).set ?? []) {
      if ('via' in a.field) continue;
      const spec = dictionary(a.field.entity, a.field.field);
      out.push({
        entity: a.field.entity,
        field: a.field.field,
        label: spec?.label ?? a.field.field,
        caution: spec?.caution ?? null,
        requires: spec?.capability ?? '',
      });
    }
  }
  return out;
}

/* -------------------------------------------------------------
   The preview pass. Nothing is written.
   ------------------------------------------------------------- */

export async function previewMutation(
  planning: CommandPlanning,
  store: Store,
  policy?: ExecutionPolicy,
): Promise<MutationPreview> {
  if (planning.kind !== 'mutate') {
    return { ok: false, reason: 'not a mutation', why: 'that sentence is not an instruction' };
  }

  const programme = await resolveProgramme(planning.plan, { store, policy });
  if (!programme.ok) {
    const res = programme.resolution;
    return {
      ok: false,
      reason: programme.reason,
      why: programme.why,
      /* Several matches for a sentence that named one record is a
         question with several answers, and the interface can only ask it
         if the answers come back. The bar never turns them into one. */
      candidates: res && !res.ok
        ? res.candidates?.map((c) => ({ id: c.id, label: c.label }))
        : undefined,
      referenceCandidates: res && !res.ok && res.reference?.state === 'ambiguous'
        ? res.reference.candidates.map((c) => ({ id: c.id, label: c.label }))
        : undefined,
    };
  }

  const fields = changedFields(planning.plan);
  const rows: RowChange[] = [];
  for (const unit of programme.units) {
    for (const p of unit.preview) {
      /* Only the columns this step writes, read off the change itself
         rather than off the row, so the preview and the write cannot
         describe different things. */
      const columns = Object.keys(p.after);
      rows.push({
        label: p.label,
        before: columns.map((c) => display(dictionary(unit.entity, c), p.before[c])).join(', '),
        after: columns.map((c) => display(dictionary(unit.entity, c), p.after[c])).join(', '),
      });
    }
  }

  const uniform = rows.length > 0
    && rows.every((r) => r.before === rows[0].before && r.after === rows[0].after);

  return {
    ok: true,
    fields,
    count: programme.changes.length,
    rows: rows.slice(0, SAMPLE_SIZE),
    uniform,
    cautions: [...new Set(fields.map((f) => f.caution).filter((c): c is string => !!c))],
    programmeHash: programme.hash,
  };
}

/* -------------------------------------------------------------
   The pass that writes
   ------------------------------------------------------------- */

export type MutationOutcome =
  | { ok: true; changed: number; message: string }
  | {
      ok: false;
      reason: 'not understood' | 'meaning changed' | 'not a mutation' | 'refused'
        | 'not permitted' | 'incomplete' | 'drift' | 'failed';
      why: string;
      /** The reading as it stands now, when that is what changed. */
      restated?: Planned;
      /** A fresh preview, when the world moved rather than the meaning. */
      preview?: MutationPreview;
    };

/**
 * Everything again, then the write.
 *
 * Nothing from the preview pass is carried over except the two
 * fingerprints. The actor is authenticated again by the caller, their
 * capabilities are derived again, their vocabulary is loaded again, the
 * text is planned again, and the rows are resolved again. If any of that
 * lands somewhere else, the answer is a new preview.
 */
export async function applyMutation(
  req: PlanRequest & {
    previewPlanHash: string;
    previewProgrammeHash: string;
    store: Store;
    policy?: ExecutionPolicy;
  },
): Promise<MutationOutcome> {
  const agreement = await planForExecution({ ...req, previewHash: req.previewPlanHash });

  if (!agreement.agreed && agreement.reason === 'not understood') {
    return { ok: false, reason: 'not understood', why: 'I could not make anything of that.' };
  }
  if (!agreement.agreed) {
    return {
      ok: false,
      reason: 'meaning changed',
      why: 'what that means has changed since you looked at it',
      restated: agreement.planned,
    };
  }

  const { planning, meaning } = agreement.planned;

  if (planning.kind !== 'mutate') {
    return { ok: false, reason: 'not a mutation', why: 'that sentence is not an instruction' };
  }

  /* THE WHOLE PLAN'S REQUIREMENTS, NOT ONE FIELD'S.
     A plan may write several fields across several steps, and a check
     that looked at one of them would wave the rest through. The
     requirement set is derived from the plan itself, so a step added
     later is covered by the same gate without anybody remembering. */
  if (planning.availability.permitted !== true) {
    return {
      ok: false,
      reason: 'not permitted',
      why: `you do not have ${planning.availability.missingPermissions.join(' or ')}`,
    };
  }
  if (!planning.availability.representable) {
    return { ok: false, reason: 'refused', why: meaning.blocked.join('; ') || 'that plan is not well formed' };
  }
  if (planning.completion.kind !== 'complete') {
    return {
      ok: false,
      reason: 'incomplete',
      why: planning.completion.kind === 'partial'
        ? `I did not read: ${planning.completion.unresolved.join(', ')}`
        : 'that instruction is not complete',
    };
  }
  if (!planning.availability.executable) {
    return { ok: false, reason: 'refused', why: meaning.blocked.join('; ') || 'nothing here performs that' };
  }

  const done = await executeProgramme(planning.plan, {
    store: req.store,
    policy: req.policy,
    agreedHash: req.previewProgrammeHash,
  });

  if (!done.ok && done.reason === 'drift') {
    const fresh = await previewMutation(planning, req.store, req.policy);
    return {
      ok: false,
      reason: 'drift',
      why: done.why,
      preview: fresh,
    };
  }
  if (!done.ok) {
    return { ok: false, reason: done.reason === 'refused' ? 'refused' : 'failed', why: done.why };
  }

  const fields = changedFields(planning.plan);
  const what = fields.map((f) => f.label).join(' and ');
  return {
    ok: true,
    changed: done.changed,
    message: done.changed === 1
      ? `${what} changed on one record.`
      : `${what} changed on ${done.changed.toLocaleString('en-GB')} records.`,
  };
}

/* -------------------------------------------------------------
   One call, for a caller that has a store and a sentence
   ------------------------------------------------------------- */

export type PlannedMutation = {
  planned: Planned;
  preview: MutationPreview | null;
};

/**
 * Plan, and preview if it is an instruction.
 *
 * The preview is the expensive half: it reads rows. A caller that only
 * wants to know what a half typed sentence means passes `preview:
 * false`, which is what the bar does on every keystroke, and asks for
 * the preview once when somebody presses Enter.
 */
export async function planAndPreview(
  req: PlanRequest & { store: Store; preview: boolean; policy?: ExecutionPolicy },
): Promise<PlannedMutation | null> {
  const planned = await planAuthoritatively(req);
  if (!planned) return null;
  if (planned.planning.kind !== 'mutate' || !req.preview) return { planned, preview: null };
  return { planned, preview: await previewMutation(planned.planning, req.store, req.policy) };
}

export { planHash };
