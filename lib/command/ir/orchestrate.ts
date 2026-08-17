/* =============================================================
   Carrying out a whole plan, or none of it.

   A canonical Plan is a program. It may hold a select, two updates, an
   invoke and an emit, and a command is only carried out when every one
   of them is. The version this replaces called `plan.steps.find(...)`
   and executed the first mutation it came across, which meant a plan
   with two updates in it silently performed one and reported success.

   THE SHAPE, AND WHY IT EXTENDS.

     1  PLAN      every effect step is listed, in order. A step this
                  cannot completely carry out refuses the whole plan
                  rather than the plan running without it.
     2  RESOLVE   every step is resolved BEFORE anything is written, so
                  the preview describes the whole command.
     3  POLICY    how much this is allowed to change, which is
                  configuration and not a property of the language.
     4  APPLY     every change from every step, in ONE transaction.

   `Select -> Update -> Update -> Invoke -> Emit` needs no new shape for
   this: a select is not an effect and resolves as a step's `match`, two
   updates are two units in the same programme, and an invoke and an
   emit become units whose apply is a capability handler rather than a
   table write. What is missing today is the handlers, not the design,
   and each is a `Unit` kind with a `resolve` and an `apply`.

   ATOMICITY IS THE DATABASE'S JOB, AND IT COVERS THE WHOLE PROGRAMME.

   Several PostgREST calls are several transactions, so a plan whose
   third statement fails has already changed the CRM twice. Undoing that
   from here means writing compensating updates that can themselves
   fail, which is a worse version of the same problem. So every database
   effect one programme has goes to one `command_perform` call, which is
   one function, which is one transaction: it commits entirely or it
   leaves nothing behind.

   That includes the effects that used to run afterwards. Sharing a list
   and attaching a file are database writes, and running them after the
   transaction had committed meant a share that failed left a list
   nobody asked for and reported success with a note about the rest not
   happening.

   That function validates every table and column against an allowlist
   held in the database and generated from this registry, so a crafted
   payload cannot reach a column the command bar was never meant to
   write, even if something upstream of it is wrong.
   ============================================================= */
import type { Mutate, Plan, Step } from './types';
import { entity as entityDef, capability } from './registry';
import { evaluate, type EvalContext } from './evaluate';
import { resolveMutation, resolutionHash, type Resolution, type ResolvedReference } from './resolve';
import type { Change, Store, TransactionStep } from './store';
import { resolveInvoke, type InvokePlan } from './invoke';
import { dependencesAmong, overlappingRows } from './dependence';

/* -------------------------------------------------------------
   Which steps have an effect
   ------------------------------------------------------------- */

/**
 * Every step that changes something or sends something.
 *
 * A select changes nothing and is not one. An emit to the screen
 * changes nothing either; an emit anywhere else does.
 */
export function effectSteps(plan: Plan): Step[] {
  return plan.steps.filter((s) => {
    if (s.op === 'create' || s.op === 'update' || s.op === 'delete') return true;
    if (s.op === 'invoke') return true;
    if (s.op === 'emit') return s.to.kind !== 'display';
    return false;
  });
}

/**
 * The steps that produce something and hand it over.
 *
 * Some of them are database writes and go into the same transaction as
 * everything else: a share is a row in `crm_list_members` and an
 * attachment is a row in `record_attachments`. A download is not a
 * database effect at all, and the FILE for either is rendered before
 * the transaction opens, so a renderer that throws leaves nothing
 * written.
 */
export function deliverySteps(plan: Plan): Step[] {
  return plan.steps.filter((s) => s.op === 'emit' && s.to.kind !== 'display');
}

/**
 * The effects this file resolves for itself.
 *
 * Deliveries are resolved by the emit layer, which is the only thing
 * that can render a file, and arrive back through `ExecuteOptions.
 * deliveries` as steps in the same transaction.
 */
function transactionalSteps(plan: Plan): Step[] {
  return effectSteps(plan).filter((s) => s.op !== 'emit');
}

/** What the executor can carry out today. Everything else refuses. */
function executableKind(s: Step): { ok: true } | { ok: false; why: string } {
  if (s.op === 'update' || s.op === 'create' || s.op === 'delete') return { ok: true };
  if (s.op === 'invoke') {
    const cap = capability(s.capability);
    if (!cap?.handler) return { ok: false, why: `nothing performs ${s.capability} yet` };
    return { ok: true };
  }
  return { ok: false, why: `nothing here performs an ${s.op} yet` };
}

/* -------------------------------------------------------------
   A resolved programme
   ------------------------------------------------------------- */

export type { Change } from './store';

export type UpdateUnit = {
  stepId: string;
  /**
   * Which way a row's life is changing.
   *
   * One shape for all three, because the preview, the overlap check and
   * the transaction are the same for each: a create resolves nothing
   * because there is no row yet, and a delete resolves rows and sets no
   * columns, and both of those are properties of the change rather than
   * reasons for a second code path.
   */
  kind: 'update' | 'create' | 'delete';
  entity: string;
  table: string;
  resolution: Extract<Resolution, { ok: true }> | null;
  /** What the preview shows, and exactly what will be written. */
  changes: Change[];
  /** Row label to before and after, for the preview. */
  preview: { id: string; label: string; before: Record<string, unknown>; after: Record<string, unknown> }[];
};

/**
 * A business operation, resolved to the records it will run on.
 *
 * Separate from an update because it is not one. Nothing about it is a
 * column and a value: it is a job the database performs, and the only
 * things this layer decides are which records and whether the operation
 * has what it needs.
 */
export type InvokeUnit = {
  stepId: string;
  kind: 'invoke';
  plan: InvokePlan;
};

export type Unit = UpdateUnit | InvokeUnit;

export type Programme =
  | { ok: true; units: Unit[]; changes: Change[]; hash: string }
  | {
      ok: false;
      reason: 'nothing to do' | 'cannot execute' | 'dependent steps' | 'unresolved'
        | 'blocked by policy' | 'incomplete';
      why: string;
      /** The step that stopped it, when one did. */
      stepId?: string;
      /** The resolution that failed, so the caller can ask the question it raises. */
      resolution?: Resolution;
    };

/**
 * How much this is allowed to change.
 *
 * Execution policy, not language. A command over a thousand records is
 * representable and may be permitted; whether it runs without a further
 * word is a decision for whoever configures this, and a plan blocked
 * here is blocked with `blocked by policy` rather than being reported
 * as something the application could not understand.
 *
 * No default. A caller that says nothing gets no ceiling, because a
 * number invented here would become the answer by accident.
 */
export type ExecutionPolicy = {
  /** Refuse above this many rows in one command. Absent means no ceiling. */
  maxRows?: number;
  /** Require a stronger confirmation above this many. Absent means never. */
  confirmAbove?: number;
};

export type OrchestrateOptions = {
  store: Store;
  /**
   * Values a business operation needs that the records do not hold.
   *
   * Read out of the sentence by the reader and passed through, so this
   * layer never invents one. See `CapabilityDef.inputs`.
   */
  args?: Record<string, unknown>;
  policy?: ExecutionPolicy;
  now?: string;
  readCap?: number;
};

/* -------------------------------------------------------------
   Resolving the whole plan
   ------------------------------------------------------------- */

export async function resolveProgramme(
  plan: Plan, opts: OrchestrateOptions,
): Promise<Programme> {
  /* Everything that goes into the transaction. A file this programme
     also produces is built afterwards, by the emit executor, from the
     rows as they stand once the change has committed. */
  const effects = transactionalSteps(plan);
  if (!effects.length) {
    /* A PROGRAMME CAN HAVE AN EFFECT AND NO TRANSACTION.

       "Export the sold curtainsiders as a PDF and attach it to
       STC143580" writes no column and performs no operation from here:
       it produces a file and leaves it on a record, which happens after
       the transaction that does not exist. Refusing it as "this plan
       changes nothing" was reading the absence of a transaction as the
       absence of an effect, and an attachment on a customer record is
       plainly an effect. */
    if (deliverySteps(plan).length) {
      return { ok: true, units: [], changes: [], hash: programmeHash([]) };
    }
    return { ok: false, reason: 'nothing to do', why: 'this plan changes nothing' };
  }

  /* Every step, before any of them. A plan containing one thing this
     can do and one it cannot is refused whole: running the half it
     understands is the failure the whole architecture exists to stop. */
  for (const s of effects) {
    const can = executableKind(s);
    if (!can.ok) {
      return { ok: false, reason: 'cannot execute', why: can.why, stepId: s.id };
    }
    if (!s.id) {
      return { ok: false, reason: 'cannot execute', why: 'a step with no id cannot be resolved or reported on' };
    }
  }

  /* STEPS THAT NEED EACH OTHER ARE REFUSED, NOT RESHUFFLED.

     Everything below computes each step's changes from the rows as they
     stand now, and hands all of them over together. That is right for
     steps that have nothing to do with each other and wrong for a step
     that was meant to run after another: it would read the old value,
     write a number that was never true, and report success. */
  const dependent = dependencesAmong(effects);
  if (dependent.length) {
    const d = dependent[0];
    return {
      ok: false,
      reason: 'dependent steps',
      why: `"${d.stepId}" depends on "${d.needs}": ${d.why}. `
        + 'Ask for them one at a time.',
      stepId: d.stepId,
    };
  }

  /* ONE TRANSACTION IS ONE KIND OF THING.

     A set of column writes goes to one database function and a business
     operation goes to another, and there is no way to put both inside
     one transaction from here. A plan holding both is refused rather
     than run as two, because two transactions is exactly the promise
     the preview does not make.

     Asked of the plan, before anything is read. Finding this out after
     resolving half of it would report whichever half failed first
     rather than the thing that is actually wrong. */
  const shapes = new Set(effects.map((s) => (s.op === 'invoke' ? 'operation' : 'write')));
  if (shapes.size > 1) {
    return {
      ok: false,
      reason: 'cannot execute',
      why: 'that mixes changing fields with performing an operation, and the two cannot be done in one go. Ask for them one at a time.',
    };
  }

  const now = opts.now ?? new Date().toISOString().slice(0, 10);
  const units: Unit[] = [];

  for (const s of effects) {
    /* A business operation, resolved to the records it will run on.
       Nothing about it is a column and a value, so it does not go
       through the mutation resolver at all. */
    if (s.op === 'invoke') {
      const resolved = await resolveInvoke(plan, s, { store: opts.store, args: opts.args });
      if (!resolved.ok) {
        return {
          ok: false,
          reason: resolved.reason === 'incomplete' ? 'incomplete' : 'unresolved',
          why: resolved.why,
          stepId: s.id,
        };
      }
      units.push({ stepId: s.id ?? '?', kind: 'invoke', plan: resolved.plan });
      continue;
    }

    /* A row that does not exist yet has nothing to resolve. Everything
       an insert needs is in the step: the columns and their values. */
    if (s.op === 'create') {
      const step = s as Mutate & { id: string };
      const def = entityDef(step.target.entity);
      if (!def) {
        return { ok: false, reason: 'cannot execute', why: `nothing here holds ${step.target.entity}`, stepId: step.id };
      }

      const set: Record<string, unknown> = {};
      const ctx: EvalContext = { row: {}, references: new Map(), now };
      for (const [i, a] of (step.set ?? []).entries()) {
        const value = evaluate(a.to, ctx, `set[${i}].to`);
        if (!value.ok) {
          return { ok: false, reason: 'unresolved', why: value.why, stepId: step.id };
        }
        set[a.field.field] = value.value;
      }
      if (!Object.keys(set).length) {
        return { ok: false, reason: 'incomplete', why: 'that says nothing about the record to create', stepId: step.id };
      }

      units.push({
        stepId: step.id, kind: 'create', entity: step.target.entity, table: def.table,
        changes: [{ op: 'insert', table: def.table, set }],
        preview: [{ id: '', label: 'a new record', before: {}, after: set }],
        resolution: null,
      });
      continue;
    }

    const step = s as Mutate & { id: string };
    const resolution = await resolveMutation(plan, {
      store: opts.store, stepId: step.id, readCap: opts.readCap,
    });
    if (!resolution.ok) {
      return { ok: false, reason: 'unresolved', why: resolution.why, stepId: step.id, resolution };
    }

    const def = entityDef(step.target.entity);
    if (!def) {
      return { ok: false, reason: 'cannot execute', why: `nothing here holds ${step.target.entity}`, stepId: step.id };
    }

    const references = new Map<string, unknown>(
      resolution.references.map((r: ResolvedReference) => [r.at, r.value]),
    );

    const changes: Change[] = [];
    const preview: UpdateUnit['preview'] = [];

    for (const row of resolution.rows) {
      const set: Record<string, unknown> = {};
      const ctx: EvalContext = { row: row.before, references, now };

      for (const [i, a] of (step.set ?? []).entries()) {
        const value = evaluate(a.to, ctx, `set[${i}].to`);
        if (!value.ok) {
          return {
            ok: false,
            reason: 'unresolved',
            why: `${row.label}: ${value.why}`,
            stepId: step.id,
          };
        }
        if (a.mode === 'append') {
          const existing = row.before[a.field.field];
          set[a.field.field] = existing ? `${String(existing)}\n${String(value.value)}` : String(value.value);
        } else {
          set[a.field.field] = value.value;
        }
      }

      changes.push(step.op === 'delete'
        ? { op: 'delete', table: def.table, id: row.id }
        : { table: def.table, id: row.id, set });
      preview.push({ id: row.id, label: row.label, before: row.before, after: set });
    }

    units.push({
      stepId: step.id, kind: step.op === 'delete' ? 'delete' : 'update',
      entity: step.target.entity,
      table: def.table, resolution, changes, preview,
    });
  }

  /* The same question as above, asked of the rows rather than of the
     plan. Two updates over the same entity usually pick out different
     rows and are independent; it is only when the conditions actually
     overlap that one row would receive two changes in one call. */
  const overlap = overlappingRows(units.filter((u): u is UpdateUnit => u.kind !== 'invoke'));
  if (overlap) {
    return {
      ok: false,
      reason: 'dependent steps',
      why: `"${overlap.stepId}" and "${overlap.needs}" ${overlap.why}. Ask for them one at a time.`,
      stepId: overlap.stepId,
    };
  }

  const changes = units.flatMap((u) => (u.kind === 'invoke' ? [] : u.changes));

  const operated = units.reduce((n, u) => n + (u.kind === 'invoke' ? u.plan.subjects.length : 0), 0);

  const max = opts.policy?.maxRows;
  if (max != null && changes.length + operated > max) {
    return {
      ok: false,
      reason: 'blocked by policy',
      why: `that would change ${(changes.length + operated).toLocaleString('en-GB')} records, and this is configured to stop above ${max.toLocaleString('en-GB')}`,
    };
  }

  return { ok: true, units, changes, hash: programmeHash(units) };
}

/**
 * One fingerprint for the whole programme.
 *
 * Every step's resolution, in step order, so a plan whose second
 * mutation drifts is refused as surely as one whose first does.
 */
export function programmeHash(units: Unit[]): string {
  const updates = units.filter((u): u is UpdateUnit => u.kind !== 'invoke');
  const invokes = units.filter((u): u is InvokeUnit => u.kind === 'invoke');

  return resolutionHash(
    [
      /* A create resolves nothing, so it contributes the values it is
         about to write instead. Two identical creates in one plan are
         genuinely identical and hash the same, which is right: nothing
         about the world decides what a new row will hold. */
      ...updates.flatMap((u) => (u.resolution
        ? u.resolution.rows.map((r) => ({ ...r, id: `${u.stepId}:${r.id}` }))
        : u.changes.map((c, i) => ({
            id: `${u.stepId}:new:${i}`,
            label: 'a new record',
            before: (c.set ?? {}) as Record<string, unknown>,
          })))),
      /* An operation's subjects go in as rows, with the values it read
         off them. A deal whose price changed between the preview and
         the confirmation is drift for the same reason a trailer whose
         price changed is: the number that would be written is not the
         number somebody was shown. */
      ...invokes.flatMap((u) => u.plan.subjects.map((sub) => ({
        id: `${u.stepId}:${sub.id}`,
        label: sub.label,
        before: sub.values,
      }))),
    ],
    updates.flatMap((u) => (u.resolution?.references ?? []).map((r) => ({ ...r, at: `${u.stepId}:${r.at}` }))),
    [
      ...updates.flatMap((u) => (u.resolution?.fields ?? []).map((f) => `${u.stepId}:${f}`)),
      ...invokes.flatMap((u) => [
        `${u.stepId}:${u.plan.capability}`,
        ...Object.entries(u.plan.args).map(([k, v]) => `${u.stepId}:arg:${k}=${String(v)}`),
      ]),
    ],
  );
}

/* -------------------------------------------------------------
   Carrying it out
   ------------------------------------------------------------- */

export type ExecuteResult =
  | { ok: true; changed: number; changes: Change[]; hash: string }
  | { ok: false; reason: 'drift'; why: string; programme: Programme }
  | { ok: false; reason: 'refused' | 'failed'; why: string; programme?: Programme };

export type ExecuteOptions = OrchestrateOptions & {
  /** The fingerprint the preview was built from. */
  agreedHash: string;
  /**
   * Everything else this programme does to the database, appended to the
   * same transaction.
   *
   * Sharing a list and attaching a file are database effects and used to
   * run after the transaction had already committed, so a share that
   * failed left a list nobody asked for and reported success with a
   * sentence about the rest not happening. They arrive here instead.
   *
   * A callback rather than a list, because a step that shares the list
   * an earlier step CREATED has to name that step's position, and the
   * positions are not known until the resolved units are laid out.
   */
  deliveries?: (indexOf: (planStepId: string) => number | null) => TransactionStep[];
};

/**
 * The resolved programme, as the ordered database effects it is.
 *
 * Field writes go in as one `changes` step because `command_apply`
 * already takes the whole set; operations go in one at a time in plan
 * order. `indexOf` says where a plan step landed, so a later step can
 * refer to what it produced.
 */
function transactionFor(units: Unit[]): {
  steps: TransactionStep[];
  indexOf: (planStepId: string) => number | null;
} {
  const steps: TransactionStep[] = [];
  const at = new Map<string, number>();

  const changes = units
    .filter((u): u is UpdateUnit => u.kind !== 'invoke')
    .flatMap((u) => u.changes);
  if (changes.length) {
    for (const u of units) if (u.kind !== 'invoke') at.set(u.stepId, steps.length);
    steps.push({ op: 'changes', changes });
  }

  for (const u of units) {
    if (u.kind !== 'invoke') continue;
    at.set(u.stepId, steps.length);
    steps.push({
      op: 'invoke',
      capability: u.plan.capability,
      subjects: u.plan.subjects.map((s) => s.id),
      args: u.plan.args,
    });
  }

  return { steps, indexOf: (id) => at.get(id) ?? null };
}

/**
 * Resolve again, check nothing moved, then write everything at once.
 *
 * The caller's copy of the programme is never trusted: it is a
 * fingerprint to compare against, not a set of rows to write.
 */
export async function executeProgramme(
  plan: Plan, opts: ExecuteOptions,
): Promise<ExecuteResult> {
  const fresh = await resolveProgramme(plan, opts);
  if (!fresh.ok) {
    return fresh.reason === 'unresolved' || fresh.reason === 'nothing to do'
      ? { ok: false, reason: 'drift', why: fresh.why, programme: fresh }
      : { ok: false, reason: 'refused', why: fresh.why, programme: fresh };
  }
  if (fresh.hash !== opts.agreedHash) {
    return {
      ok: false,
      reason: 'drift',
      why: 'those records have changed since you looked at them',
      programme: fresh,
    };
  }

  /* ONE CALL, FOR THE WHOLE PROGRAMME.

     Every database effect it has, in order, through `command_perform`,
     which is one plpgsql function and therefore one transaction. Handing
     them over a kind at a time is what made a share that failed leave a
     list behind, and it is not something this layer can put right
     afterwards: a compensating delete can fail too. */
  const laid = transactionFor(fresh.units);
  const steps = [...laid.steps, ...(opts.deliveries?.(laid.indexOf) ?? [])];

  if (!steps.length) {
    return { ok: true, changed: 0, changes: [], hash: fresh.hash };
  }

  const done = await opts.store.perform(steps);
  if (!done.ok) return { ok: false, reason: 'failed', why: done.why, programme: fresh };

  return { ok: true, changed: done.changed, changes: fresh.changes, hash: fresh.hash };
}
