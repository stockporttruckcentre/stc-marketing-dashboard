/* =============================================================
   Why nothing matched.

   "nothing here matches that" is true and useless. It is the same
   sentence whether the stock list is empty, the unit was sold last
   year, the number was typed with a digit out of place, or the whole
   command runtime is broken, and somebody looking at it cannot tell
   which. That is worse than a wrong answer: it makes a working tool
   look broken and a broken one look like a typo.

   This says three things instead, in the order somebody would ask:

     what was looked for      the stock number STC145505
     where                    among the trailers
     what is near it          STC145501, STC145515, and 3 more

   The near matches are the whole point. A stock number typed off by a
   digit is the commonest way to reach this message, and showing the
   real ones next to it turns a dead end into a correction.

   Costs one extra read, only on the path where the answer is already
   "nothing", so it never slows down a command that works.
   ============================================================= */
import type { Cond, Expr } from './types';
import type { Store } from './store';

/** The plain column an expression names, or null if it is computed. */
function columnOf(e: Expr): string | null {
  return e.kind === 'field' ? e.of.field : null;
}

function literalOf(e: Expr): string | null {
  return e.kind === 'literal' && (typeof e.value === 'string' || typeof e.value === 'number')
    ? String(e.value)
    : null;
}

/**
 * The one thing a sentence named, when it named one.
 *
 * A command about a particular record almost always says so with a
 * single text comparison: a stock number, a company name. Anything more
 * complicated than that is a description rather than a name, and
 * "nothing matches" is a fair answer to a description.
 */
export function namedValue(where: Cond | undefined): { column: string; value: string } | null {
  if (!where) return null;

  if (where.kind === 'cmp' && (where.op === 'eq' || where.op === 'contains' || where.op === 'startsWith')) {
    const column = columnOf(where.left);
    const value = literalOf(where.right);
    return column && value ? { column, value } : null;
  }

  /* One name, plus whatever else narrowed it. `and` is how a screen's
     own scope gets added to a sentence, and the name is still the name. */
  if (where.kind === 'and') {
    const named = where.of.map(namedValue).filter((n): n is { column: string; value: string } => !!n);
    return named.length === 1 ? named[0] : null;
  }

  return null;
}

/**
 * The shorter thing to search for, given what was asked for.
 *
 * An identifier and a name go wrong differently. STC145509 for
 * STC145505 is one character out at the end, so dropping the last
 * couple of characters finds its neighbours. "Wilson Haulage Ltd" for
 * "Wilson Transport" is right at the start and wrong after it, so the
 * first word is what finds the company.
 */
function stem(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length < 4) return null;

  const firstWord = trimmed.split(/\s+/)[0];
  if (trimmed.includes(' ') && firstWord.length >= 4) return firstWord;

  return trimmed.slice(0, Math.max(4, trimmed.length - 2));
}

/** Records whose identifier looks like the one that was asked for. */
async function nearby(
  store: Store,
  table: string,
  column: string,
  value: string,
  title: string | null,
): Promise<string[]> {
  const like = stem(value);
  if (!like) return [];

  const read = await store.read({
    table,
    columns: [...new Set(['id', column, ...(title ? [title] : [])])],
    where: {
      kind: 'cmp', op: 'contains',
      left: { kind: 'field', of: { entity: '', field: column } },
      right: { kind: 'literal', value: like },
    },
    limit: 6,
  });
  if (!read.ok) return [];

  return read.rows
    .map((r) => String(r[column] ?? r[title ?? 'id'] ?? '').trim())
    .filter(Boolean);
}

/** How many records the table holds at all, capped and cheap. */
async function anyAtAll(store: Store, table: string): Promise<boolean> {
  const read = await store.read({
    table, columns: ['id'], where: { kind: 'and', of: [] }, limit: 1,
  });
  return read.ok && read.rows.length > 0;
}

/**
 * The refusal, in the words somebody can act on.
 *
 * `label` is what one of these records is called in conversation: a
 * trailer, a customer. `field` is what the column is called on screen.
 */
export async function whyNothingMatched(opts: {
  store: Store;
  table: string;
  where: Cond | undefined;
  titleField: string | null;
  label: string;
  fieldLabel?: (column: string) => string;
}): Promise<string> {
  const { store, table, where, titleField, label } = opts;
  const named = namedValue(where);

  if (!named) {
    return (await anyAtAll(store, table))
      ? `nothing among the ${label} matches that`
      : `there are no ${label} here at all yet`;
  }

  /* Lower cased: the label is written for a column heading, and this
     is the middle of a sentence. */
  const label0 = opts.fieldLabel?.(named.column) ?? named.column.replace(/_/g, ' ');
  const what = label0.charAt(0).toLowerCase() + label0.slice(1);
  const head = `no ${label.replace(/s$/, '')} here has the ${what} ${named.value}`;

  if (!(await anyAtAll(store, table))) {
    return `${head}, because there are no ${label} here at all yet`;
  }

  const close = (await nearby(store, table, named.column, named.value, titleField))
    .filter((c) => c.toLowerCase() !== named.value.toLowerCase());

  if (!close.length) {
    return `${head}, and nothing here is close to it.`;
  }

  const shown = close.slice(0, 3);
  const more = close.length - shown.length;
  return `${head}. The closest ${shown.length === 1 ? 'is' : 'are'} `
    + shown.join(', ')
    + (more > 0 ? `, and ${more} more` : '')
    + '.';
}
