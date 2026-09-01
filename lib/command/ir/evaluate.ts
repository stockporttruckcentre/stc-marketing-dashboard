/* =============================================================
   Working out what a value comes to, for one row.

   EVERY FAILURE IS TYPED. There is no result that means both "the
   answer is nothing" and "I could not work it out". `null` is a value a
   column can hold; not knowing is not.

   The version this replaces read `Number(left ?? 0)`, which quietly
   decided that adding £250 to a row whose refurb cost is empty makes it
   £250. That is an assumption about the business dressed as arithmetic:
   an empty column may mean nobody has filled it in yet, and turning
   that into a zero writes a figure nobody stated. If a fallback is
   wanted it has to be in the plan, where somebody can see it, rather
   than in the evaluator where nobody can.
   ============================================================= */
import type { Expr } from './types';

export type Evaluated =
  | { ok: true; value: string | number | boolean | null }
  | { ok: false; why: string };

export type EvalContext = {
  /** What this row currently holds, for the fields the mutation touches. */
  row: Record<string, unknown>;
  /** References already resolved, keyed by where in the plan they appeared. */
  references: Map<string, unknown>;
  now: string;
};

const DAY_UNITS: Record<string, (d: Date, n: number) => void> = {
  day: (d, n) => d.setUTCDate(d.getUTCDate() + n),
  week: (d, n) => d.setUTCDate(d.getUTCDate() + n * 7),
  month: (d, n) => d.setUTCMonth(d.getUTCMonth() + n),
  quarter: (d, n) => d.setUTCMonth(d.getUTCMonth() + n * 3),
  year: (d, n) => d.setUTCFullYear(d.getUTCFullYear() + n),
};

function shiftDate(iso: unknown, n: number, unit: string, back: boolean): Evaluated {
  if (iso == null) return { ok: false, why: 'there is no date there to move' };
  const t = Date.parse(String(iso));
  if (!Number.isFinite(t)) return { ok: false, why: `"${String(iso)}" is not a date` };
  const step = DAY_UNITS[unit];
  if (!step) return { ok: false, why: `${unit} is not a span this can move a date by` };
  const d = new Date(t);
  step(d, back ? -n : n);
  return { ok: true, value: d.toISOString().slice(0, 10) };
}

/**
 * A number, or a stated reason why not.
 *
 * A word is not a number, and an empty column is usually not a number
 * either, because the alternative is writing a figure the instruction
 * never contained.
 *
 * `emptyIsZero` is the one exception, and it is narrow on purpose. See
 * the note in the binary case below.
 */
function numeric(
  v: unknown, where: string, emptyIsZero = false,
): { ok: true; n: number } | { ok: false; why: string } {
  if (v === null || v === undefined || v === '') {
    if (emptyIsZero) return { ok: true, n: 0 };
    return { ok: false, why: `${where} is empty, so there is nothing to calculate from` };
  }
  if (typeof v === 'boolean') return { ok: false, why: `${where} is not a number` };
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return { ok: false, why: `${where} is not a number` };
  return { ok: true, n };
}

/** A column on the row being written, as opposed to a literal or a hop. */
function isRowField(e: Expr): boolean {
  return e.kind === 'field' && !('via' in e.of);
}

function describe(e: Expr): string {
  switch (e.kind) {
    case 'field': return 'via' in e.of ? e.of.field : e.of.field;
    case 'literal': return `"${String(e.value)}"`;
    case 'reference': return `the ${e.entity} it names`;
    default: return 'that part of the sum';
  }
}

export function evaluate(e: Expr, ctx: EvalContext, at = 'to'): Evaluated {
  switch (e.kind) {
    case 'literal':
      return { ok: true, value: e.value };

    case 'field':
      if ('via' in e.of) return { ok: false, why: 'a value across a relationship cannot be read here' };
      return { ok: true, value: (ctx.row[e.of.field] ?? null) as Evaluated extends { ok: true; value: infer V } ? V : never };

    case 'context':
      if (e.slot === 'now') return { ok: true, value: ctx.now };
      return { ok: false, why: `nothing fills "${e.slot}" here` };

    case 'reference':
      return ctx.references.has(at)
        ? { ok: true, value: ctx.references.get(at) as string | number | boolean | null }
        : { ok: false, why: 'that reference was never resolved' };

    case 'binary': {
      const left = evaluate(e.left, ctx, `${at}.left`);
      if (!left.ok) return left;
      const right = evaluate(e.right, ctx, `${at}.right`);
      if (!right.ok) return right;

      /* AN EMPTY ACCUMULATOR IS ZERO, AND ONLY UNDER + AND -.

         "Add £1,000 refurb to 143074" on a trailer with nothing in
         `refurb_costs` means the refurb cost is now £1,000. It was
         being refused with "refurb_costs is empty, so there is nothing
         to calculate from", which is the rule above applied one step
         too widely: an empty column is genuinely not a number you can
         take five per cent OF, and it is obviously a number you can
         add TO. Every trailer starts with no refurb on it, so the
         commonest instruction in the whole vocabulary was the one that
         could never run.

         Still refused for * / and %, because a percentage of an
         unknown base is a figure the instruction never contained,
         which is the thing the original rule exists to prevent.

         Only for a column on this row, never for a literal or a value
         read across a relationship. A missing literal is a parse
         failure and should still say so. */
      const accumulating = e.op === '+' || e.op === '-';

      const a = numeric(left.value, describe(e.left), accumulating && isRowField(e.left));
      if (!a.ok) return { ok: false, why: a.why };
      const b = numeric(right.value, describe(e.right), accumulating && isRowField(e.right));
      if (!b.ok) return { ok: false, why: b.why };

      if ((e.op === '/' || e.op === '%') && b.n === 0) {
        return { ok: false, why: 'that would divide by zero' };
      }

      const value =
        e.op === '+' ? a.n + b.n
          : e.op === '-' ? a.n - b.n
            : e.op === '*' ? a.n * b.n
              : e.op === '/' ? a.n / b.n
                : e.op === '%' ? a.n % b.n
                  : NaN;

      /* Both operands were finite and the result may still not be:
         a huge multiplication overflows to Infinity, and writing that
         into a money column is worse than refusing. */
      if (!Number.isFinite(value)) {
        return { ok: false, why: 'that sum does not come to a number' };
      }
      return { ok: true, value };
    }

    case 'shift': {
      const of = evaluate(e.of, ctx, `${at}.of`);
      if (!of.ok) return of;
      if (!Number.isFinite(e.by.n)) return { ok: false, why: 'that is not a span of time' };
      return shiftDate(of.value, e.by.n, e.by.unit, e.direction === 'back');
    }

    default:
      return { ok: false, why: `a ${e.kind} cannot be worked out for a single row` };
  }
}
