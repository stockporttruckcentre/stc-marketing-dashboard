/* =============================================================
   Carrying out a mutation that has been previewed and agreed to.

   TWO RULES, AND BOTH OF THEM ARE ABOUT THE PREVIEW BEING TRUE.

   1  IT WRITES BY PRIMARY KEY. Never by filter. The preview named a set
      of rows and the person said yes to those rows, so those are the
      rows that change. Re-running the filter at write time would sweep
      up whatever arrived in between, and the preview would have been a
      description of a different set.

   2  IT REFUSES ON DRIFT. The resolution it is given carries a
      fingerprint of the rows and the values the preview was built from.
      This resolves again and compares. Anything moved, and nothing is
      written: the new reading goes back for preview instead.

   The new value is worked out per row from what that row currently
   holds, which is what makes "add £250" mean £250 more on each of them
   rather than the same total on all of them.
   ============================================================= */
import type { Expr, Mutate, Plan } from './types';
import { entity as entityDef, field as fieldDef } from './registry';
import {
  resolveMutation, type Queryable, type ResolvedReference, type Resolution,
} from './resolve';

export type Written = {
  id: string;
  label: string;
  /** Column to the value that was actually sent. */
  set: Record<string, unknown>;
};

export type ApplyResult =
  | { ok: true; written: Written[]; hash: string }
  | { ok: false; reason: 'drift'; why: string; resolution: Resolution }
  | { ok: false; reason: 'refused' | 'failed'; why: string };

/* -------------------------------------------------------------
   Working out the new value
   ------------------------------------------------------------- */

const DAY = 86_400_000;

function shiftDate(iso: unknown, n: number, unit: string, back: boolean): string | null {
  if (iso == null) return null;
  const t = Date.parse(String(iso));
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const step = back ? -n : n;
  switch (unit) {
    case 'day': d.setUTCDate(d.getUTCDate() + step); break;
    case 'week': d.setUTCDate(d.getUTCDate() + step * 7); break;
    case 'month': d.setUTCMonth(d.getUTCMonth() + step); break;
    case 'quarter': d.setUTCMonth(d.getUTCMonth() + step * 3); break;
    case 'year': d.setUTCFullYear(d.getUTCFullYear() + step); break;
    default: return null;
  }
  return d.toISOString().slice(0, 10);
}

export type EvalContext = {
  /** What this row currently holds, for the fields the mutation touches. */
  row: Record<string, unknown>;
  /** References already resolved, keyed by where they appeared. */
  references: Map<string, unknown>;
  now: string;
};

/**
 * The value to write, for one row.
 *
 * `undefined` means the expression could not be worked out, which is a
 * refusal rather than a null: writing an empty column because a sum
 * could not be computed is a data loss dressed as an edit.
 */
export function evaluate(e: Expr, ctx: EvalContext, at = 'to'): unknown {
  switch (e.kind) {
    case 'literal': return e.value;
    case 'field':
      if ('via' in e.of) return undefined;
      return ctx.row[e.of.field] ?? null;
    case 'context':
      return e.slot === 'now' ? ctx.now : undefined;
    case 'reference':
      return ctx.references.has(at) ? ctx.references.get(at) : undefined;
    case 'binary': {
      const left = evaluate(e.left, ctx, `${at}.left`);
      const right = evaluate(e.right, ctx, `${at}.right`);
      const a = Number(left ?? 0);
      const b = Number(right);
      if (!Number.isFinite(b)) return undefined;
      switch (e.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? undefined : a / b;
        case '%': return b === 0 ? undefined : a % b;
        default: return undefined;
      }
    }
    case 'shift': {
      const of = evaluate(e.of, ctx, `${at}.of`);
      return shiftDate(of, e.by.n, e.by.unit, e.direction === 'back') ?? undefined;
    }
    default:
      return undefined;
  }
}

/* -------------------------------------------------------------
   Applying
   ------------------------------------------------------------- */

export type ApplyOptions = {
  supabase: Queryable;
  /** The fingerprint the preview was built from. */
  agreedHash: string;
  /** Rows per statement. The preview is a set; the writes are batched. */
  chunk?: number;
  now?: string;
};

export async function applyMutation(plan: Plan, opts: ApplyOptions): Promise<ApplyResult> {
  const step = plan.steps.find((s) => s.op === 'update') as Mutate | undefined;
  if (!step || step.op !== 'update') {
    return { ok: false, reason: 'refused', why: 'this plan changes no rows' };
  }
  if (!step.set?.length) {
    return { ok: false, reason: 'refused', why: 'this plan says nothing to change' };
  }

  const def = entityDef(step.target.entity);
  if (!def) return { ok: false, reason: 'refused', why: `nothing here holds ${step.target.entity}` };

  /* Resolved again, here, from the plan. The caller's copy is not
     trusted: it is a fingerprint to compare against, not a set of rows
     to write. */
  const fresh = await resolveMutation(plan, { supabase: opts.supabase });
  if (!fresh.ok) {
    return { ok: false, reason: 'drift', why: fresh.why, resolution: fresh };
  }
  if (fresh.hash !== opts.agreedHash) {
    return {
      ok: false,
      reason: 'drift',
      why: 'those records have changed since you looked at them',
      resolution: fresh,
    };
  }

  const references = new Map<string, unknown>(
    fresh.references.map((r: ResolvedReference) => [r.at, r.value]),
  );
  const now = opts.now ?? new Date().toISOString().slice(0, 10);

  /* Worked out per row, because "add £250" is £250 more on each of
     them and not the same total on all of them. */
  const written: Written[] = [];
  for (const row of fresh.rows) {
    const set: Record<string, unknown> = {};
    for (const [i, a] of step.set.entries()) {
      const value = evaluate(a.to, { row: row.before, references, now }, `set[${i}].to`);
      if (value === undefined) {
        return {
          ok: false,
          reason: 'refused',
          why: `the new ${a.field.field} could not be worked out for ${row.label}`,
        };
      }
      if (a.mode === 'append') {
        const existing = row.before[a.field.field];
        set[a.field.field] = existing ? `${String(existing)}\n${String(value)}` : String(value);
      } else {
        set[a.field.field] = value;
      }
    }
    written.push({ id: row.id, label: row.label, set });
  }

  /* Rows whose new values are identical are still written, because the
     preview said they would be and a silent skip is a preview that was
     not true. They are grouped by value so identical writes travel
     together rather than one statement per row. */
  const groups = new Map<string, { set: Record<string, unknown>; ids: string[] }>();
  for (const w of written) {
    const key = JSON.stringify(Object.entries(w.set).sort());
    const g = groups.get(key) ?? { set: w.set, ids: [] };
    g.ids.push(w.id);
    groups.set(key, g);
  }

  const chunk = opts.chunk ?? 200;
  for (const { set, ids } of groups.values()) {
    for (let i = 0; i < ids.length; i += chunk) {
      const batch = ids.slice(i, i + chunk);
      /* BY PRIMARY KEY. The preview named these rows and nothing else
         may be swept in by re-running the filter. */
      const { error } = await opts.supabase.from(def.table).update(set).in('id', batch);
      if (error) {
        return {
          ok: false,
          reason: 'failed',
          why: `${written.length - i} of ${written.length} were not changed: ${error.message ?? error}`,
        };
      }
    }
  }

  return { ok: true, written, hash: fresh.hash };
}
