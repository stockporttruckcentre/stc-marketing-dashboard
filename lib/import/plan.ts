/* =============================================================
   What the import is actually going to do, worked out before it does it.

   Nothing here writes. It produces a plan the user confirms, and the
   plan is the same object the commit walks. That is deliberate: a review
   screen computed one way and an import executed another is how a
   preview ends up lying.
   ============================================================= */
import { fold, type Dictionary } from './dictionary';
import { coerce, type ColumnMatch } from './match';

export type RowIssue = { column: string; value: string; why: string };

export type PlannedRow = {
  index: number;
  values: Record<string, any>;
  /** Left as-is for the "compared against" line in the review. */
  display: string;
  issues: RowIssue[];
  /** An existing record this looks like. */
  duplicateOf?: { id: string; label: string; matchedOn: string };
  /** Another row in the same file. */
  duplicateInFile?: number;
  decision: 'import' | 'skip' | 'merge';
};

export type ImportPlan = {
  columns: ColumnMatch[];
  rows: PlannedRow[];
  /** Columns understood and knowingly not imported. */
  dropped: { header: string; why: string }[];
  /** Columns nothing could be made of. */
  unknown: string[];
};

/** Something a person recognises the row by, for the duplicate list. */
function labelFor(values: Record<string, any>, dict: Dictionary): string {
  return String(values[dict.required] ?? values.email ?? values.contact_name ?? 'Unnamed row');
}

/** A row already in the target table, as its own columns. */
export type ExistingRow = { id: string } & Record<string, any>;

export function buildPlan(
  columns: ColumnMatch[],
  rawRows: Record<string, any>[],
  existing: ExistingRow[],
  dict: Dictionary,
): ImportPlan {
  const mapped = columns.filter((c) => c.target);

  /**
   * One index per duplicate key, built from the dictionary rather than
   * from a fixed pair of column names.
   *
   * This was hardcoded to email and company, which worked for contacts
   * and meant the stock import had to pass its stock number in the slot
   * called `company_name`. That is a pun, not a design: it reads as a
   * bug to anybody who finds it later, and it breaks the moment a
   * dictionary wants a third key.
   */
  const indexes = new Map<string, Map<string, ExistingRow>>();
  for (const key of dict.duplicateKeys) {
    const m = new Map<string, ExistingRow>();
    for (const e of existing) {
      const v = e[key];
      if (v != null && String(v).trim() !== '') m.set(fold(String(v)), e);
    }
    indexes.set(key, m);
  }

  /** What the dictionary calls a field, for saying how two rows matched. */
  const labelOf = (key: string) =>
    dict.fields.find((f) => f.target === key)?.label.toLowerCase() ?? key.replace(/_/g, ' ');

  const seenInFile = new Map<string, number>();
  const rows: PlannedRow[] = [];

  rawRows.forEach((raw, index) => {
    const values: Record<string, any> = {};
    const issues: RowIssue[] = [];

    for (const col of mapped) {
      const rawVal = raw[col.header];
      const text = String(rawVal ?? '').trim();
      if (!text) continue;
      const kind = col.field?.kind ?? 'text';
      const parsed = coerce(kind, text);
      if (parsed === null) {
        // Coercion failed on a non-empty cell, which means the value is
        // not what the column claims. Kept out of the record and shown,
        // rather than written as a string into a numeric column.
        issues.push({
          column: col.header,
          value: text.slice(0, 40),
          why: kind === 'date' ? 'not a date we could read'
            : kind === 'status' ? 'not a status we recognise'
            : `not a ${kind} value`,
        });
        continue;
      }
      values[col.target as string] = parsed;
    }

    // Every row needs the one field without which the record is nothing.
    const required = values[dict.required];
    if (!required || !String(required).trim()) {
      rows.push({
        index, values, display: labelFor(values, dict),
        issues: [...issues, {
          column: 'Row',
          value: '',
          // Named after the field, not the database column, because the
          // person reading this is looking at a spreadsheet.
          why: `missing a ${dict.required.replace(/_/g, ' ')}, so there is nothing to file it under`,
        }],
        decision: 'skip',
      });
      return;
    }

    const planned: PlannedRow = {
      index, values, display: labelFor(values, dict), issues, decision: 'import',
    };

    // Against what is already in the list, then against earlier rows in
    // this same file, because spreadsheets repeat themselves too.
    for (const key of dict.duplicateKeys) {
      const v = values[key];
      if (!v) continue;
      const hit = indexes.get(key)?.get(fold(String(v)));
      if (hit) {
        planned.duplicateOf = {
          id: hit.id,
          label: labelFor(hit, dict),
          matchedOn: labelOf(key),
        };
        planned.decision = 'skip';
        break;
      }
    }
    if (!planned.duplicateOf) {
      for (const key of dict.duplicateKeys) {
        const v = values[key];
        if (!v) continue;
        const k = `${key}:${fold(String(v))}`;
        const earlier = seenInFile.get(k);
        if (earlier !== undefined) {
          planned.duplicateInFile = earlier;
          planned.decision = 'skip';
          break;
        }
        seenInFile.set(k, index);
      }
    }

    rows.push(planned);
  });

  return {
    columns,
    rows,
    dropped: columns
      .filter((c) => c.target === null && c.field)
      .map((c) => ({ header: c.header, why: c.field!.ignoredBecause ?? 'not relevant here' })),
    unknown: columns.filter((c) => c.target === undefined).map((c) => c.header),
  };
}

export type PlanCounts = {
  create: number; skip: number; merge: number; withIssues: number;
  duplicates: number; dropped: number; unknown: number;
};

export function countPlan(plan: ImportPlan): PlanCounts {
  return {
    create: plan.rows.filter((r) => r.decision === 'import').length,
    skip: plan.rows.filter((r) => r.decision === 'skip').length,
    merge: plan.rows.filter((r) => r.decision === 'merge').length,
    withIssues: plan.rows.filter((r) => r.issues.length > 0).length,
    duplicates: plan.rows.filter((r) => r.duplicateOf || r.duplicateInFile !== undefined).length,
    dropped: plan.dropped.length,
    unknown: plan.unknown.length,
  };
}
