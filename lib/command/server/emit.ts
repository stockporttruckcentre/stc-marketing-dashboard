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
import type { Store } from '../ir/store';
import type { Emit, Plan, Select } from '../ir/types';
import { entity as entityDef } from '../ir/registry';
import { runSelect } from '../ir/read';
import { buildTable, type Artefact, type TableColumn } from '../render/table';
import { renderCsv } from '../render/csv';
import { renderXlsx } from '../render/xlsx';
import { renderDocx } from '../render/docx';
import { renderPdf } from '../render/pdf';
import type { FileFormat } from '../output';

/** How many rows one file carries. Reported when it bites, never silent. */
export const EXPORT_CAP = 5000;

export type EmitOutcome =
  | { ok: true; artefact: Artefact; rows: number; capped: boolean }
  | { ok: false; reason: 'not an emit' | 'unsupported' | 'failed'; why: string };

/** The emit step of a plan, if it has one. */
export function emitStep(plan: Plan): Emit | null {
  return (plan.steps.find((s) => s.op === 'emit') as Emit | undefined) ?? null;
}

/** The select an emit reads from. */
function sourceSelect(plan: Plan, emit: Emit): Select | null {
  const from = emit.from;
  if ('ref' in from) {
    const step = plan.steps.find((s) => s.id === from.step);
    return step && step.op === 'select' ? (step as Select) : null;
  }
  if ('op' in from) return from as Select;
  return null;
}

export async function runEmit(
  planning: CommandPlanning,
  opts: { store: Store; actorName: string; now: Date },
): Promise<EmitOutcome> {
  const emit = emitStep(planning.plan);
  if (!emit) return { ok: false, reason: 'not an emit', why: 'that sentence asks for nothing to be produced' };

  if (emit.output.kind !== 'file') {
    return { ok: false, reason: 'unsupported', why: 'only a file can be produced from here yet' };
  }
  if (emit.to.kind !== 'download') {
    /* Share, email and attach are declared in the registry and have no
       handler. Saying which one is missing is better than a five
       hundred from a route that was never written. */
    return { ok: false, reason: 'unsupported', why: `nothing here ${emit.to.kind}s a file yet` };
  }

  const select = sourceSelect(planning.plan, emit);
  if (!select) return { ok: false, reason: 'unsupported', why: 'that emit has no rows to work from' };

  const read = await runSelect(select, { store: opts.store, cap: EXPORT_CAP });
  if (!read.ok) return { ok: false, reason: 'failed', why: read.why };

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

  const format = emit.output.format as FileFormat;
  const artefact = format === 'csv' ? renderCsv(table)
    : format === 'pdf' ? renderPdf(table)
      : format === 'xlsx' ? await renderXlsx(table)
        : await renderDocx(table);

  return { ok: true, artefact, rows: table.count, capped: table.capped };
}
