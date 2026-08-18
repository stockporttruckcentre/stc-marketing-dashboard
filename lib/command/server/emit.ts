/* =============================================================
   Carrying out an Emit.

   The step says: take what step `s1` produced, put it in a file of this
   format, and hand it over. Nothing in it names an entity, and nothing
   here does either. That is what makes

     export the sold curtainsiders as a Word document
     export customers in Manchester to Excel
     give me a pdf of every proposal quoted this quarter

   one implementation rather than three, and what makes the next entity
   somebody adds to the registry exportable without a line being written.

   THE FILE HOLDS THE SELECTION, NOT A SECOND READING OF THE SENTENCE.

   The rows come from the `Select` the emit points at, resolved through
   the same `Store` everything else reads through, so what the file
   contains and what the preview counted cannot differ. An export that
   re-reads the sentence is an export that can quietly answer a
   different question.

   DOWNLOADING IS NOT A DESTRUCTIVE ACT.

   `download` changes nothing and leaves nothing behind, so it does not
   ask twice. Sharing and emailing do, and they are gated by their own
   capabilities in the registry rather than by anything here.
   ============================================================= */
import type { CommandPlanning } from '../plan';
import type { Store, TransactionStep } from '../ir/store';
import type { Cond, Emit, Expr, Plan, Select } from '../ir/types';
import { entity as entityDef } from '../ir/registry';
import { runSelect, selectBehind } from '../ir/read';
import { buildTable, type Artefact, type Table, type TableColumn } from '../render/table';
import { renderCsv } from '../render/csv';
import { renderXlsx } from '../render/xlsx';
import { renderDocx } from '../render/docx';
import { renderPdf } from '../render/pdf';
import { nounFor, type FileFormat } from '../output';

/**
 * The most rows each format can genuinely hold.
 *
 * Not a policy and not a comfort limit. A spreadsheet has 1,048,576
 * rows including the header and the title block, and asking ExcelJS for
 * more produces a file Excel will not open. The other three have no
 * technical maximum at all: a CSV is text, and a PDF and a Word document
 * paginate.
 *
 * There used to be a flat five thousand here, applied to every format,
 * which turned "export all 8,412 customers" into a file holding five
 * thousand of them. A file that says it is everything and is not is the
 * worst artefact this application could produce, so where a real
 * maximum bites the export REFUSES and says so rather than trimming.
 */
/**
 * Which renderer produces which format.
 *
 * A lookup rather than a chain of ternaries, so a format added to
 * `output.ts` fails to compile here until something renders it.
 */
export const RENDERERS: Record<FileFormat, (t: Table) => Artefact | Promise<Artefact>> = {
  csv: renderCsv,
  xlsx: renderXlsx,
  pdf: renderPdf,
  docx: renderDocx,
};

export const FORMAT_MAXIMUM: Record<FileFormat, number | null> = {
  csv: null,
  pdf: null,
  docx: null,
  /* 1,048,576 rows, less the title, the subtitle, the spacer, the
     header and the footer this writes around the data. */
  xlsx: 1_048_576 - 6,
};

export type EmitOutcome =
  /** A file, handed over. Nothing was written to produce it. */
  | { ok: true; kind: 'artefact'; artefact: Artefact; rows: number; capped: boolean }
  | {
      ok: false;
      reason: 'not an emit' | 'unsupported' | 'failed' | 'too large' | 'unresolved';
      why: string;
      /** Where a name matched more than one person, so the caller can ask. */
      candidates?: { id: string; label: string }[];
    };

/** The emit step of a plan, if it has one. */
export function emitStep(plan: Plan): Emit | null {
  return (plan.steps.find((s) => s.op === 'emit') as Emit | undefined) ?? null;
}


/**
 * The people a destination names, as rows.
 *
 * Each recipient is a `reference` expression in the plan: "the person
 * called Dave", not a row id. Resolving here rather than at planning
 * time is what keeps the plan's meaning independent of who happens to
 * be in the profiles table at the moment it was typed.
 */
async function resolvePeople(
  store: Store, refs: Expr[],
): Promise<
  | { ok: true; people: { id: string; label: string }[] }
  | { ok: false; why: string; candidates?: { id: string; label: string }[] }
> {
  const def = entityDef('people');
  if (!def) return { ok: false, why: 'nothing here holds people' };
  const title = def.titleField ?? 'id';

  const people: { id: string; label: string }[] = [];
  for (const ref of refs) {
    if (ref.kind !== 'reference') return { ok: false, why: 'that does not name anybody' };
    const read = await store.read({
      table: def.table,
      columns: [...new Set(['id', title, 'email'])],
      where: ref.where,
      limit: 20,
    });
    if (!read.ok) return { ok: false, why: read.why };
    if (!read.rows.length) return { ok: false, why: 'nobody here matches that name' };
    if (read.rows.length > 1) {
      /* Two people called Dave is a real possibility, and granting the
         wrong one access to the CRM is not a thing to guess at. */
      return {
        ok: false,
        why: `${read.rows.length} people match that name, so it is not clear who was meant`,
        candidates: read.rows.map((r) => ({
          id: String(r.id), label: String(r[title] ?? r.email ?? r.id),
        })),
      };
    }
    const row = read.rows[0];
    people.push({ id: String(row.id), label: String(row[title] ?? row.email ?? row.id) });
  }
  return { ok: true, people };
}

/* =============================================================
   Preparing a delivery, which is not the same as performing one

   A share is a row in `crm_list_members` and an attachment is a row in
   `record_attachments`. Both are database writes and both used to run
   after the programme's transaction had already committed, so a share
   that failed left a list nobody asked for and reported success with a
   sentence about the rest not happening.

   So nothing here writes. Each delivery is prepared: the people are
   resolved, the record is resolved, the FILE IS RENDERED, and what comes
   back is a step for the programme's one transaction. A renderer that
   throws therefore stops the command before any of it has committed,
   which is the order somebody confirming it would assume.
   ============================================================= */

export type Prepared =
  /** Handed to the browser afterwards. Not a database effect at all. */
  | { kind: 'download'; stepId: string; artefact: Artefact; rows: number; describe: string }
  /** A database effect, for the programme's transaction. */
  | {
      kind: 'effect';
      stepId: string;
      /** Built late, because a step may refer to one earlier in the same transaction. */
      step: (indexOf: (planStepId: string) => number | null) => TransactionStep;
      describe: string;
      rows: number;
      /** The file this effect carries, when it carries one. */
      artefact?: Artefact;
    };

export type PrepareOutcome =
  | { ok: true; prepared: Prepared }
  | {
      ok: false;
      reason: 'unsupported' | 'failed' | 'too large' | 'unresolved';
      why: string;
      candidates?: { id: string; label: string }[];
    };

/**
 * The step in this programme that puts the rows on a list.
 *
 * Sharing what a clause just created cannot name the list, because the
 * list does not exist until the transaction runs. Finding the step that
 * makes it lets the share refer to its result by position instead.
 */
/**
 * The rows an earlier step resolved to, as a selection by id.
 *
 * `null` when the source is not a reference to a step with known rows,
 * which leaves the caller to fall back to that step's own condition.
 */
function rowsBehind(
  plan: Plan, from: Emit['from'], resolved?: Map<string, string[]>,
): Select | null {
  if (!resolved?.size || !from || typeof from !== 'object') return null;
  if (!('ref' in from)) return null;

  const ids = resolved.get(from.step);
  if (!ids?.length) return null;

  const step = plan.steps.find((x) => x.id === from.step);
  const behind = selectBehind(plan, from);
  const entity = (step && 'target' in step && (step as { target?: { entity?: string } }).target?.entity)
    ?? (behind && 'entity' in behind.from ? (behind.from as { entity: string }).entity : null);
  if (!entity) return null;

  return {
    op: 'select',
    from: { entity },
    where: {
      kind: 'in',
      of: { kind: 'field', of: { entity, field: 'id' } },
      values: ids.map((id) => ({ kind: 'literal' as const, value: id })),
    },
    /* The shaping the original selection asked for still applies: a
       file of "the five cheapest, moved to Hyde" is five rows. */
    ...(behind?.shape ? { shape: behind.shape } : {}),
  } as Select;
}

function listStepBehind(plan: Plan, from: Emit['from']): string | null {
  const seen = new Set<string>();
  const walk = (source: Emit['from'] | undefined): string | null => {
    if (!source || !('ref' in source)) return null;
    if (seen.has(source.step)) return null;
    seen.add(source.step);
    const step = plan.steps.find((x) => x.id === source.step);
    if (!step) return null;
    if (step.op === 'invoke') {
      if (step.capability === 'list.create' || step.capability === 'list.add') return step.id ?? null;
      return walk(step.subject as Emit['from']);
    }
    if (step.op === 'emit') return walk(step.from);
    if (step.op === 'update' || step.op === 'delete' || step.op === 'create') {
      return walk(step.match as Emit['from']);
    }
    return null;
  };
  return walk(from);
}

/**
 * How many records are on a list, all of them.
 *
 * Paged rather than limited. A ceiling inside a check whose meaning is
 * "the complete list" would let a list one row longer than the ceiling
 * read as complete, which is the same class of mistake as an export
 * that trims.
 */
async function countOn(
  store: Store, table: string, list: string,
): Promise<{ ok: true; total: number } | { ok: false; why: string }> {
  const where: Cond = {
    kind: 'cmp', op: 'eq',
    left: { kind: 'field', of: { entity: 'contacts', field: 'list_id' } },
    right: { kind: 'literal', value: list },
  };

  let total = 0;
  let offset = 0;
  const page = 1000;
  for (;;) {
    const read = await store.read({ table, columns: ['id'], where, limit: page, offset });
    if (!read.ok) return { ok: false, why: read.why };
    total += read.rows.length;
    if (read.rows.length < page) return { ok: true, total };
    offset += read.rows.length;
  }
}

/**
 * Granting colleagues access to what a sentence selected.
 *
 * SHARING THE LIST IS NOT SHARING A HANDFUL OF ROWS ON IT.
 *
 * The unit of sharing in this schema is the whole list, so "share the
 * customers in Hyde with Dave" over a list of a hundred, two of which
 * are in Hyde, would hand Dave the other ninety eight. There is no
 * record level grant to do the narrow thing with, so the narrow thing is
 * refused: the selection has to BE the list, or be the list this
 * programme is about to make out of exactly those records.
 *
 * The database checks it again, because a caller that validates its own
 * payload validates nothing.
 */
async function prepareShare(
  planning: CommandPlanning, emit: Emit, select: Select, store: Store,
): Promise<PrepareOutcome> {
  if (emit.to.kind !== 'share') {
    return { ok: false, reason: 'unsupported', why: 'that is not a share' };
  }

  const who = await resolvePeople(store, emit.to.with);
  if (!who.ok) return { ok: false, reason: 'unresolved', why: who.why, candidates: who.candidates };

  const read = await runSelect(select, { store });
  if (!read.ok) return { ok: false, reason: 'failed', why: read.why };
  if (!read.rows.length) return { ok: false, reason: 'failed', why: 'nothing here matches that' };
  if (read.entity !== 'contacts') {
    return {
      ok: false,
      reason: 'unsupported',
      why: `sharing works on customer lists, and that is a selection of ${read.entity}`,
    };
  }

  const ids = read.rows.map((r) => String(r.id));
  const names = who.people.map((p) => p.label);
  const users = who.people.map((p) => p.id);

  /* The list this programme is about to make, when there is one. Its id
     does not exist yet, so the step refers to the position of the step
     that makes it. */
  const madeBy = listStepBehind(planning.plan, emit.from);

  if (!madeBy) {
    /* An existing list. Which one, and is this every record on it. */
    const def = entityDef('contacts');
    const mine = await store.read({
      table: def?.table ?? 'crm_contacts',
      columns: ['id', 'list_id'],
      where: select.where ?? { kind: 'and', of: [] },
      limit: read.rows.length,
    });
    if (!mine.ok) return { ok: false, reason: 'failed', why: mine.why };

    const lists = [...new Set(mine.rows.map((r) => r.list_id).filter((v) => v != null))].map(String);
    if (lists.length !== 1) {
      return {
        ok: false,
        reason: 'unsupported',
        why: lists.length === 0
          ? 'those records are not on a list, so there is nothing to give anybody access to. '
            + 'Make a list from them first.'
          : `those records are spread across ${lists.length} lists, so it is not clear which one to share`,
      };
    }

    /* EVERY record on that list, paged until the pages stop coming.
       A limit here would be an implementation cap inside a check whose
       whole meaning is "the complete list", and a list one row longer
       than the cap would read as complete and share everything on it.
       The database checks it exactly as well; this exists so the
       refusal has the real numbers in it. */
    const whole = await countOn(store, def?.table ?? 'crm_contacts', lists[0]);
    if (!whole.ok) return { ok: false, reason: 'failed', why: whole.why };

    if (whole.total !== ids.length) {
      return {
        ok: false,
        reason: 'unsupported',
        why: `sharing here grants a whole list, and that is ${ids.length} of the `
          + `${whole.total} records on it. Everybody it is shared with would get all `
          + `${whole.total}. Make a list of just these first, then share that.`,
      };
    }

    const list = lists[0];
    return {
      ok: true,
      prepared: {
        kind: 'effect',
        stepId: emit.id ?? 'e',
        rows: ids.length,
        describe: `${names.join(' and ')} can now see those `
          + `${ids.length.toLocaleString('en-GB')} ${ids.length === 1 ? 'record' : 'records'}.`,
        step: () => ({
          op: 'invoke', capability: 'rows.share', subjects: ids, args: { list, users },
        }),
      },
    };
  }

  return {
    ok: true,
    prepared: {
      kind: 'effect',
      stepId: emit.id ?? 'e',
      rows: ids.length,
      describe: `${names.join(' and ')} can now see those `
        + `${ids.length.toLocaleString('en-GB')} ${ids.length === 1 ? 'record' : 'records'}.`,
      step: (indexOf) => {
        const at = indexOf(madeBy);
        if (at === null) throw new Error('the list this shares was not made in this programme');
        return {
          op: 'invoke',
          capability: 'rows.share',
          subjects: ids,
          args: { list: { $from: { step: at, key: 'listId' } }, users },
        };
      },
    },
  };
}

/**
 * Leaving a file on a record instead of handing it over.
 *
 * The record is a selection of one, resolved through the same store
 * everything else reads through. Several matches is a question rather
 * than a choice made here: "attach it to Dawson" where the CRM holds two
 * Dawsons must not put a customer list on whichever came back first.
 */
async function prepareAttach(
  planning: CommandPlanning, emit: Emit, artefact: Artefact, rows: number, store: Store,
): Promise<PrepareOutcome> {
  if (emit.to.kind !== 'attach') {
    return { ok: false, reason: 'unsupported', why: 'that is not an attachment' };
  }

  const target = selectBehind(planning.plan, emit.to.to);
  if (!target) {
    return { ok: false, reason: 'unresolved', why: 'nothing said which record to attach it to' };
  }

  const found = await runSelect(target, { store });
  if (!found.ok) return { ok: false, reason: 'failed', why: found.why };

  const def = entityDef(found.entity);
  const title = def?.titleField ?? 'id';
  if (!found.rows.length) {
    return { ok: false, reason: 'unresolved', why: 'that record is not here' };
  }
  if (found.rows.length > 1) {
    return {
      ok: false,
      reason: 'unresolved',
      why: `${found.rows.length} records match that, so it is not clear which one to attach it to`,
      candidates: found.rows.slice(0, 20).map((r) => ({
        id: String(r.id), label: String(r[title] ?? r.id),
      })),
    };
  }

  const row = found.rows[0];
  const onto = String(row[title] ?? row.id);

  return {
    ok: true,
    prepared: {
      kind: 'effect',
      stepId: emit.id ?? 'e',
      rows,
      artefact,
      describe: `${artefact.filename} is on ${onto}, holding `
        + `${rows.toLocaleString('en-GB')} ${rows === 1 ? 'row' : 'rows'}.`,
      step: () => ({
        op: 'invoke',
        capability: 'record.attach',
        subjects: [String(row.id)],
        args: {
          table: def?.table,
          filename: artefact.filename,
          mime: artefact.mime,
          base64: Buffer.from(artefact.bytes).toString('base64'),
          describedAs: planning.presentation.summary,
        },
      }),
    },
  };
}

/** The file a selection describes, rendered. Nothing is written. */
async function render(
  planning: CommandPlanning, emit: Emit, select: Select,
  opts: { store: Store; actorName: string; now: Date },
): Promise<{ ok: true; artefact: Artefact; rows: number; capped: boolean } | Extract<PrepareOutcome, { ok: false }>> {
  if (emit.output.kind !== 'file') {
    return { ok: false, reason: 'unsupported', why: 'only a file can be produced from here yet' };
  }

  const format = emit.output.format as FileFormat;
  const maximum = FORMAT_MAXIMUM[format] ?? undefined;

  /* Every row the selection describes. The ceiling below is the
     format's own, and reaching it refuses rather than trims. */
  const read = await runSelect(select, { store: opts.store, ceiling: maximum });
  if (!read.ok) return { ok: false, reason: 'failed', why: read.why };

  if (read.capped) {
    return {
      ok: false,
      reason: 'too large',
      why: `that is more rows than a ${nounFor(format)} can hold. `
        + 'Narrow the request, or ask for it as a CSV.',
    };
  }

  const def = entityDef(read.entity);
  const kinds = new Map((def?.fields ?? []).map((f) => [f.field, f.kind]));
  const columns: TableColumn[] = read.columns.map((c, i) => ({
    key: c,
    label: read.labels[i],
    kind: kinds.get(c) ?? 'text',
  }));

  const table = buildTable({
    title: planning.presentation.summary,
    subtitle: `Exported by ${opts.actorName} on ${opts.now.toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric',
    })}`,
    columns,
    rows: read.rows,
    capped: read.capped,
  });

  try {
    const artefact = await RENDERERS[format](table);
    return { ok: true, artefact, rows: table.count, capped: table.capped };
  } catch (e) {
    /* Rendering happens before the transaction opens precisely so this
       can be a refusal rather than a note attached to a change that has
       already committed. */
    return {
      ok: false,
      reason: 'failed',
      why: `the ${nounFor(format)} could not be produced: ${(e as Error).message}`,
    };
  }
}

/**
 * One delivery, resolved and rendered, ready for the transaction.
 *
 * Nothing here writes. See the banner above.
 */
export async function prepareDelivery(
  planning: CommandPlanning,
  emit: Emit,
  opts: {
    store: Store; actorName: string; now: Date;
    /**
     * Files earlier steps in this programme already rendered, by step id.
     *
     * "Export the sold curtainsiders as a PDF and attach it to
     * STC143580" is one file, produced once and then put somewhere.
     * Without this the attaching clause rendered a second file of its
     * own, in whatever format it defaulted to, so the PDF was
     * downloaded and a spreadsheet was attached.
     */
    produced?: Map<string, { artefact: Artefact; rows: number }>;
    /**
     * Which rows each earlier step actually resolved to, by step id.
     *
     * A clause that consumes an earlier step means THOSE records. The
     * condition that found them may no longer hold once the step has
     * run, which is exactly the case a chained export is for.
     */
    resolvedIds?: Map<string, string[]>;
  },
): Promise<PrepareOutcome> {
  const from = emit.from;
  if (emit.to.kind === 'attach' && 'ref' in from && from.ref === 'artefact') {
    const already = opts.produced?.get(from.step);
    if (already) return prepareAttach(planning, emit, already.artefact, already.rows, opts.store);
  }

  /* THE ROWS THAT STEP ACTED ON, BY ID.

     "Move these to Hyde and export them" points at what the move
     touched. Re-running the move's own condition would ask for the
     trailers at Carrington, which is where they no longer are, so the
     rows are read by the ids the programme already resolved. Falling
     back to the condition is right for anything with no resolved rows
     behind it, like a bare selection nothing has acted on. */
  const select = rowsBehind(planning.plan, emit.from, opts.resolvedIds)
    ?? selectBehind(planning.plan, emit.from);
  if (!select) return { ok: false, reason: 'unsupported', why: 'that emit has no rows to work from' };

  /* Sharing produces nothing. It grants access to records somebody
     already described, so no file is rendered for it. */
  if (emit.to.kind === 'share') return prepareShare(planning, emit, select, opts.store);

  if (emit.to.kind !== 'download' && emit.to.kind !== 'attach') {
    /* Email is declared in the registry with no handler and with the
       exact reason why. `executability` refuses it before anything gets
       here, off the registry's own record, so this is the last line
       rather than the gate. */
    return { ok: false, reason: 'unsupported', why: `nothing here ${emit.to.kind}s a file yet` };
  }

  const built = await render(planning, emit, select, opts);
  if (!built.ok) return built;

  if (emit.to.kind === 'attach') {
    return prepareAttach(planning, emit, built.artefact, built.rows, opts.store);
  }

  return {
    ok: true,
    prepared: {
      kind: 'download',
      stepId: emit.id ?? 'e',
      artefact: built.artefact,
      rows: built.rows,
      describe: `${built.rows.toLocaleString('en-GB')} `
        + `${built.rows === 1 ? 'row' : 'rows'} in ${built.artefact.filename}.`,
    },
  };
}

/**
 * The file a read-only sentence asks for.
 *
 * The download path and nothing else: no database effect, so no
 * transaction to be part of. A sentence whose delivery writes goes
 * through `applyMutation`, which puts it in the programme's transaction.
 */
export async function runEmit(
  planning: CommandPlanning,
  opts: { store: Store; actorName: string; now: Date },
): Promise<EmitOutcome> {
  const emit = emitStep(planning.plan);
  if (!emit) return { ok: false, reason: 'not an emit', why: 'that sentence asks for nothing to be produced' };

  const ready = await prepareDelivery(planning, emit, opts);
  if (!ready.ok) return ready;
  if (ready.prepared.kind !== 'download') {
    return {
      ok: false,
      reason: 'unsupported',
      why: 'that changes records as well as producing something, so it has to be confirmed first',
    };
  }
  return {
    ok: true,
    kind: 'artefact',
    artefact: ready.prepared.artefact,
    rows: ready.prepared.rows,
    capped: false,
  };
}
