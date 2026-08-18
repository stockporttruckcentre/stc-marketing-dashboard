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
import { createHash } from 'crypto';
import type { CommandPlanning } from '../plan';
import { planAuthoritatively, planForExecution, planHash, type Planned, type PlanRequest } from './planner';
import { resolveProgramme, executeProgramme, deliverySteps, type Programme } from '../ir/orchestrate';
import type { ExecutionPolicy } from '../ir/orchestrate';
import type { Store } from '../ir/store';
import type { Cond, Emit, Mutate, Plan } from '../ir/types';
import { WRITABLE_FIELDS, type WritableField } from '../fields';
import { capability, destination } from '../ir/registry';
import { nounFor, type FileFormat } from '../output';
import { prepareDelivery, type Prepared } from './emit';
import { postState } from '../ir/overlay';
import { PREPARERS } from './prepare';
import type { CommandContext } from '../context';
import type { TransactionStep } from '../ir/store';
import type { Artefact } from '../render/table';

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

/** A business operation, as the preview describes it. */
export type OperationPreview = {
  capability: string;
  label: string;
  /** True when it makes a record rather than acting on ones that exist. */
  creates: boolean;
  /**
   * What an operation outside the database says it would do.
   *
   * Present for a capability that declares `prepares`. It is the only
   * account of an import anybody gets before agreeing to it: how many
   * customers, what was left out, and what the columns were read as.
   */
  says?: string;
  /** How many records it says it will make. */
  makes?: number;
  /**
   * The records it will run on, by their own names.
   *
   * `values` is what the operation read off each one for its declared
   * inputs. For a role change that is the role the person holds now,
   * which is the half of "sales to admin" the sentence does not say and
   * the half somebody confirming needs most.
   */
  subjects: { label: string; via?: string; values?: Record<string, unknown> }[];
  /** What the sentence named that it cannot act on, and why. */
  skipped: { label: string; why: string }[];
};

/** Something the programme produces and hands over. */
export type DeliveryPreview = {
  /** The capability that permits it, from the registry. */
  capability: string;
  /** In words: "an Excel workbook, downloaded". */
  label: string;
  /** Where it goes, so leaving the company is never silent. */
  destination: string;
  /**
   * Who it goes to, as the sentence named them.
   *
   * By name rather than resolved to people here: the preview says what
   * was asked for, and the executor resolves it and stops if a name
   * fits two colleagues. Showing "shared with colleagues" and not
   * saying which is a confirmation that withholds the only part
   * somebody needs to check.
   */
  recipients: string[];
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
      /** Operations, when the sentence asked for one rather than a write. */
      operations: OperationPreview[];
      /**
       * What the programme hands over once the change has committed.
       *
       * A file is not a database change and cannot be inside the
       * transaction that makes one, but somebody confirming
       * "create a list from them and export it to Excel" is confirming
       * both halves and has to be shown both.
       */
      deliveries: DeliveryPreview[];
      /**
       * How much this needs agreeing to.
       *
       * `destructive` is a plan that removes records, which is the one
       * thing here with no undo. The apply request for one must state
       * the number of records it is agreeing to, so a preview somebody
       * skimmed cannot be confirmed by the same keystroke as a price
       * change.
       */
      severity: 'ordinary' | 'destructive';
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

/**
 * The rows each step of a resolved programme acts on, by step id.
 *
 * What a later clause means by "them". The condition that found them is
 * not it: "move these to Hyde and export them" would ask for the
 * trailers still at Carrington.
 */
function resolvedRows(programme: Programme | null): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!programme?.ok) return out;
  for (const unit of programme.units) {
    if (unit.kind === 'invoke') {
      /* The records the SENTENCE named, which is what a following
         clause is pointing at. */
      out.set(unit.stepId, unit.plan.subjects.map((s) => s.viaId ?? s.id));
      continue;
    }
    const ids = (unit.resolution?.rows ?? []).map((r) => r.id)
      .concat((unit.staged ?? []).map((c) => String(c.id ?? '')).filter(Boolean));
    if (ids.length) out.set(unit.stepId, ids);
  }
  return out;
}

/**
 * The programme hash, plus whatever an operation outside the database
 * decided.
 *
 * A resolved programme covers every row and value the DATABASE part of
 * the command touches. It cannot cover which rows of a spreadsheet turned
 * out to be duplicates of records already here, because that is not in
 * the plan and is not in the resolution either: it is what a preparer
 * worked out. Folding it in here means the confirmation compares the
 * whole decision rather than the half of it the plan can see.
 */
function withPreparation(hash: string, prepared: string[]): string {
  if (!prepared.length) return hash;
  return createHash('sha256')
    .update([hash, ...prepared].join('\n'))
    .digest('hex')
    .slice(0, 32);
}

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

/**
 * The values an invoke step carries, as plain values.
 *
 * The plan holds them as literal expressions, because everything in a
 * plan is an expression. The operation wants numbers.
 */
function invokeArgs(plan: Plan): Record<string, unknown> {
  const step = plan.steps.find((s) => s.op === 'invoke');
  if (!step || step.op !== 'invoke') return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(step.args ?? {})) {
    if (!('kind' in value)) continue;
    if (value.kind === 'literal') out[key] = value.value;
  }
  return out;
}

/**
 * The names a destination carries, read back out of its references.
 *
 * A recipient is stored as "the person whose full name contains Dave",
 * so the name is the literal inside that condition. Reading it back
 * rather than carrying the words separately keeps one source of truth:
 * what the preview says is what the executor will look up.
 */
function namesIn(to: Emit['to']): string[] {
  const refs = to.kind === 'share' ? to.with : to.kind === 'email' ? to.to : [];
  const out: string[] = [];

  const literals = (c: Cond): void => {
    if (c.kind === 'and' || c.kind === 'or') { c.of.forEach(literals); return; }
    if (c.kind === 'not') { literals(c.of); return; }
    if (c.kind === 'cmp' && c.right.kind === 'literal' && c.right.value != null) {
      out.push(String(c.right.value));
    }
  };

  for (const r of refs) if (r.kind === 'reference') literals(r.where);
  return [...new Set(out)];
}

/** What a programme hands over once its change has committed. */
function deliveries(plan: Plan): DeliveryPreview[] {
  return deliverySteps(plan).map((s) => {
    const emit = s as Emit;
    const dest = destination(emit.to.kind);
    const format = emit.output.kind === 'file' ? nounFor(emit.output.format as FileFormat) : null;
    return {
      capability: emit.capability ?? dest?.capability ?? '',
      /* A file is a thing. Access is not, and calling it "a result"
         told somebody they were getting something back when what was
         happening was that somebody else was getting in. */
      label: format
        ? `${/^[aeiou]/i.test(format) ? 'an' : 'a'} ${format}`
        : 'access to those records',
      destination: dest?.label ?? emit.to.kind,
      recipients: namesIn(emit.to),
    };
  });
}

/** What the operation in a plan calls itself. */
function capabilityLabel(plan: Plan): string | null {
  const step = plan.steps.find((s) => s.op === 'invoke');
  return step && step.op === 'invoke' ? capability(step.capability)?.label ?? null : null;
}

/* -------------------------------------------------------------
   The preview pass. Nothing is written.
   ------------------------------------------------------------- */

export async function previewMutation(
  planning: CommandPlanning,
  store: Store,
  policy?: ExecutionPolicy,
  /* What the request carried. An operation whose work is not SQL may
     need it to say what it is going to do: an import describes the file
     the browser is holding, and nothing else can. */
  context: CommandContext = {},
): Promise<MutationPreview> {
  if (planning.kind !== 'mutate') {
    return { ok: false, reason: 'not a mutation', why: 'that sentence is not an instruction' };
  }

  const programme = await resolveProgramme(planning.plan, {
    store, policy, args: invokeArgs(planning.plan),
  });
  if (!programme.ok) {
    const res = programme.resolution;
    return {
      ok: false,
      reason: programme.reason,
      why: programme.why,
      /* Several matches for a sentence that named one record is a
         question with several answers, and the interface can only ask it
         if the answers come back. The bar never turns them into one. */
      /* Several matches for a sentence that named one record is a
         question with several answers, whether the record was being
         written to or operated on. */
      candidates: programme.candidates
        ?? (res && !res.ok
          ? res.candidates?.map((c) => ({ id: c.id, label: c.label }))
          : undefined),
      referenceCandidates: res && !res.ok && res.reference?.state === 'ambiguous'
        ? res.reference.candidates.map((c) => ({ id: c.id, label: c.label }))
        : undefined,
    };
  }

  const fields = changedFields(planning.plan);
  const rows: RowChange[] = [];
  const operations: OperationPreview[] = [];
  /* What each operation outside the database decided, so the programme
     hash covers it. */
  const prepared: string[] = [];

  for (const unit of programme.units) {
    if (unit.kind === 'invoke') {
      /* WHAT AN OPERATION OUTSIDE THE DATABASE WOULD DO.

         Described, never performed. A preview that spent a Lusha credit
         would charge for looking, and a preview that could not say how
         many customers a file holds is not a preview of an import. */
      const named = capability(unit.plan.capability)?.prepares;
      let said: string | null = null;
      let makes = 0;
      if (named) {
        const preparer = PREPARERS[named];
        if (!preparer) {
          return {
            ok: false, reason: 'cannot execute',
            why: `nothing here performs ${unit.plan.capability}`,
          };
        }
        const description = await preparer.describe({
          subjects: unit.plan.subjects, args: unit.plan.args, context, store,
          /* Nothing is bought at preview, so there is no purchase to be
             idempotent about. */
          confirmation: '',
        });
        if (!description.ok) {
          return { ok: false, reason: 'cannot execute', why: description.why };
        }
        said = description.says;
        makes = description.count;
        prepared.push(description.fingerprint);
      }

      operations.push({
        capability: unit.plan.capability,
        label: unit.plan.label,
        creates: capability(unit.plan.capability)?.creates ?? false,
        ...(said ? { says: said, makes } : {}),
        subjects: unit.plan.subjects.map((s) => ({
          label: s.label, via: s.viaLabel, values: s.values,
        })),
        skipped: unit.plan.missing.map((m) => ({ label: m.label, why: m.why })),
      });
      continue;
    }
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

  /* An operation that makes a record changes one record, and it has no
     subjects to count. A preview reading zero would say "this changes
     nothing" about a post it is about to write. */
  const operated = operations.reduce(
    (n, o) => n + (o.makes ?? (o.creates ? 1 : o.subjects.length)), 0);

  return {
    ok: true,
    fields,
    count: programme.changes.length + operated,
    rows: rows.slice(0, SAMPLE_SIZE),
    uniform,
    cautions: [...new Set(fields.map((f) => f.caution).filter((c): c is string => !!c))],
    operations,
    deliveries: deliveries(planning.plan),
    severity: planning.plan.steps.some((s) => s.op === 'delete') ? 'destructive' : 'ordinary',
    programmeHash: withPreparation(programme.hash, prepared),
  };
}

/* -------------------------------------------------------------
   The pass that writes
   ------------------------------------------------------------- */

export type MutationOutcome =
  | {
      ok: true;
      changed: number;
      message: string;
      /**
       * The file the programme also asked for.
       *
       * Absent when the sentence asked for no file. Present, with the
       * row count, when it did: "create a list from them and export it
       * to Excel" is one thing somebody asked for, and handing back the
       * list without the spreadsheet is doing half of it.
       *
       * Rendered BEFORE the transaction, so an `ok` outcome carrying one
       * means the change committed and the file exists. There is no
       * state where one happened and the other did not.
       */
      artefact?: Artefact;
      artefactRows?: number;
    }
  | {
      ok: false;
      reason: 'not understood' | 'meaning changed' | 'not a mutation' | 'refused'
        | 'not permitted' | 'incomplete' | 'drift' | 'failed' | 'not acknowledged';
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
    /** Whose name goes on any file the programme produces. */
    actorName?: string;
    /**
     * The number of records the caller is agreeing to remove.
     *
     * Required for a destructive plan and ignored otherwise. A preview
     * and an Enter is the right weight for a price change and not for a
     * deletion, so the request that removes records has to say how many
     * it means and be right about it. Checked against the freshly
     * resolved set, not against the preview's copy of it.
     */
    acknowledge?: number;
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

  /* A DELETION IS AGREED TO BY NUMBER.

     Everything else here can be put back by typing the old value in.
     Removing records cannot, so a preview and an Enter is the wrong
     weight for it: the request has to say how many records it means and
     be right about it, against the set as it stands NOW rather than
     against the preview's copy of it. Somebody whose screen moved under
     them gets a fresh preview rather than a smaller deletion. */
  if (planning.plan.steps.some((s) => s.op === 'delete' && s.expect === 'many')) {
    const fresh = await previewMutation(planning, req.store, req.policy, req.context ?? {});
    if (!fresh.ok) return { ok: false, reason: 'refused', why: fresh.why };

    if (req.acknowledge == null) {
      return {
        ok: false,
        reason: 'not acknowledged',
        why: `that removes ${fresh.count.toLocaleString('en-GB')} `
          + `${fresh.count === 1 ? 'record' : 'records'} and there is no undo. `
          + 'Confirm the number to go ahead.',
        preview: fresh,
      };
    }
    if (req.acknowledge !== fresh.count) {
      return {
        ok: false,
        reason: 'not acknowledged',
        why: `you agreed to ${req.acknowledge.toLocaleString('en-GB')} but that now removes `
          + `${fresh.count.toLocaleString('en-GB')}. Nothing has been changed.`,
        preview: fresh,
      };
    }
  }

  /* EVERY DELIVERY, PREPARED BEFORE ANYTHING IS WRITTEN.

     The file is rendered here, the people a share names are looked up
     here, and the record an attachment goes on is resolved here. None of
     it writes. What comes back is a set of steps for the SAME
     transaction as the field writes and the operations, so a share that
     fails takes the list with it and a renderer that throws leaves the
     database exactly as it was.

     AND IT SEES THE PROGRAMME'S OWN CHANGES.

     "Move these trailers to Hyde and export them to Excel" is one thing
     somebody confirmed, and a file built from the rows as they stand
     would hold the old depot. The resolved programme already knows
     every change, because that is what makes the preview exact, so the
     renderer reads through a lens that lays them over what comes back.
     An Emit consuming an earlier effect sees the result of that
     effect. */
  const outgoing = deliverySteps(planning.plan);
  const rendered = new Map<string, { artefact: Artefact; rows: number }>();
  const prepared: Prepared[] = [];

  /* Resolving again costs a read, so it happens only where something
     needs it: a delivery to render through the post-state lens, or an
     operation whose work is not SQL and has to be done before the
     transaction opens. Everything else is resolved once, inside
     `executeProgramme`. */
  const outsideOperations = planning.plan.steps.some(
    (s) => s.op === 'invoke' && !!capability(s.capability)?.prepares,
  );
  const resolved = outgoing.length || outsideOperations
    ? await resolveProgramme(planning.plan, {
        store: req.store, policy: req.policy, args: invokeArgs(planning.plan),
      })
    : null;
  if (resolved && !resolved.ok) {
    return { ok: false, reason: 'refused', why: resolved.why };
  }

  /* OPERATIONS WHOSE WORK IS NOT SQL.

     Looking a company up in Lusha is an HTTP call to somebody else's
     service that spends a credit and cannot be rolled back, so it
     cannot be inside the transaction and must not be after it. It runs
     here, where a file is rendered, and what it finds becomes changes
     the transaction writes. */
  const outsideWork: TransactionStep[] = [];
  const outsideSaid: string[] = [];
  const outsidePrepared: string[] = [];

  /* WHAT THIS CONFIRMATION IS.

     The two hashes somebody agreed to, which are the same two on every
     retry of the same confirmed command and different for any other.
     An operation that spends money outside the database keys its
     purchase on this, so retrying after a failed transaction reuses
     what was already bought. */
  const confirmation = `${req.previewPlanHash ?? ''}|${req.previewProgrammeHash ?? ''}`;

  if (resolved?.ok) {
    for (const unit of resolved.units) {
      if (unit.kind !== 'invoke') continue;
      const named = capability(unit.plan.capability)?.prepares;
      if (!named) continue;

      const preparer = PREPARERS[named];
      if (!preparer) {
        return {
          ok: false,
          reason: 'refused',
          why: `nothing here performs ${unit.plan.capability}`,
        };
      }

      /* THE PREPARATION IS AGREED TO AS WELL AS THE PROGRAMME.

         An import's answer depends on what is in the CRM right now: a
         customer that arrived since the preview turns a new record into
         a duplicate, and a list renamed or replaced sends the rows
         somewhere else. Neither is in the plan and neither is in the
         resolution, so the preview folded the preparation's own
         fingerprint into the hash and this rebuilds it and compares.
         Previewing a hundred and importing ninety nine is the thing
         this stops. */
      const now = await preparer.describe({
        subjects: unit.plan.subjects, args: unit.plan.args,
        context: req.context ?? {}, store: req.store, confirmation,
      });
      if (!now.ok) return { ok: false, reason: 'refused', why: now.why };
      outsidePrepared.push(now.fingerprint);

      const ready = await preparer.run({
        subjects: unit.plan.subjects, args: unit.plan.args,
        context: req.context ?? {}, store: req.store, confirmation,
      });
      /* Before the transaction, so there is nothing to undo. */
      if (!ready.ok) return { ok: false, reason: 'refused', why: ready.why };

      outsideWork.push(...ready.steps);
      outsideSaid.push(ready.describe);
    }
  }

  const asItWillBe = resolved?.ok
    ? postState(req.store, resolved.units.map((u) => (u.kind === 'invoke'
      ? {
          kind: 'invoke' as const,
          capability: u.plan.capability,
          subjects: u.plan.subjects.map((x) => x.id),
          /* The records the sentence named, when the operation runs on
             different ones. A sale names units and sells deals. */
          via: u.plan.subjects.map((x) => x.viaId).filter((x): x is string => !!x),
          args: u.plan.args,
        }
      : { kind: 'changes' as const, changes: u.staged ?? u.changes })))
    : req.store;

  for (const step of outgoing) {
    const ready = await prepareDelivery(planning, step as Emit, {
      /* Which rows each earlier step resolved to, so a clause consuming
         one exports those records rather than whatever its condition
         still matches. */
      resolvedIds: resolvedRows(resolved),
      /* The rows as they will be. The record an attachment goes on and
         the people a share names are looked up through the same lens,
         which changes nothing for them: no programme in this
         application moves a person or a stock unit and then attaches to
         the row it moved. */
      store: asItWillBe,
      actorName: req.actorName ?? 'the command bar',
      now: new Date(),
      produced: rendered,
    });
    if (!ready.ok) {
      /* Before the transaction, so there is nothing to undo and nothing
         to warn about. */
      return { ok: false, reason: 'refused', why: ready.why };
    }
    if (ready.prepared.artefact) {
      rendered.set(ready.prepared.stepId, {
        artefact: ready.prepared.artefact, rows: ready.prepared.rows,
      });
    }
    if (ready.prepared.kind === 'download') {
      rendered.set(ready.prepared.stepId, {
        artefact: ready.prepared.artefact, rows: ready.prepared.rows,
      });
    }
    prepared.push(ready.prepared);
  }

  /* What the confirmation agreed to, against what the preparation just
     decided. The programme's own hash is checked by `executeProgramme`
     against its own fresh resolution, so only the preparation half is
     compared here. */
  if (outsidePrepared.length && resolved?.ok) {
    const agreed = withPreparation(resolved.hash, outsidePrepared);
    if (agreed !== req.previewProgrammeHash) {
      const fresh = await previewMutation(planning, req.store, req.policy, req.context ?? {});
      return {
        ok: false,
        reason: 'drift',
        why: 'what that would do has changed since you looked at it. '
          + 'Nothing has been written.',
        preview: fresh,
      };
    }
  }

  const done = await executeProgramme(planning.plan, {
    store: req.store,
    policy: req.policy,
    args: invokeArgs(planning.plan),
    agreedHash: outsidePrepared.length && resolved?.ok
      ? resolved.hash
      : req.previewProgrammeHash,
    deliveries: (indexOf) => [
      ...outsideWork,
      ...prepared
        .filter((p): p is Extract<Prepared, { kind: 'effect' }> => p.kind === 'effect')
        .map((p) => p.step(indexOf)),
    ],
  });

  if (!done.ok && done.reason === 'drift') {
    const fresh = await previewMutation(planning, req.store, req.policy, req.context ?? {});
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
  const operation = planning.plan.steps.find((s) => s.op === 'invoke');
  const what = operation
    ? (capabilityLabel(planning.plan) ?? 'That')
    : fields.map((f) => f.label).join(' and ');

  /* A programme whose only effect is a delivery changed no record, and
     saying " changed on 0 records" in front of what it DID do reads as
     a failure. */
  const changedRecords = operation || fields.length
    ? done.changed
    : 0;
  const message = !operation && !fields.length
    ? ''
    : operation
      ? `${what} on ${changedRecords.toLocaleString('en-GB')} ${changedRecords === 1 ? 'record' : 'records'}.`
      : changedRecords === 1
        ? `${what} changed on one record.`
        : `${what} changed on ${changedRecords.toLocaleString('en-GB')} records.`;

  /* WHAT AN OPERATION REPORTS HAVING DONE.

     Generic: any operation whose result carries a before and an after
     says so. "Change what somebody is allowed to do on 1 record" is
     true and tells nobody which record or what changed, and for a role
     change that is the whole point of the sentence. */
  const said = [...outsideSaid, ...(done.results ?? [])
    .map((r) => r as Record<string, unknown> | null)
    .filter((r): r is Record<string, unknown> => !!r && r.was != null && r.now != null)
    .map((r) => `${r.name ?? 'It'} was ${r.was} and is ${r.now} now.`)];

  /* The file the same sentence asked for, handed back with the outcome.
     It was built before the transaction and the transaction committed,
     so there is no half state to describe. */
  const download = prepared.find((p): p is Extract<Prepared, { kind: 'download' }> => p.kind === 'download');

  return {
    ok: true,
    changed: done.changed,
    message: [message, ...said, ...prepared.map((p) => p.describe)].filter(Boolean).join(' '),
    ...(download ? { artefact: download.artefact, artefactRows: download.rows } : {}),
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
  return {
    planned,
    preview: await previewMutation(planned.planning, req.store, req.policy, req.context ?? {}),
  };
}

export { planHash };
