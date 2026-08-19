/* =============================================================
   Reading the database as it will be, not as it is.

   A programme's file is rendered BEFORE its transaction opens, so a
   renderer that throws leaves nothing written. That ordering is right
   and it introduced a lie:

     move these selected trailers to Hyde and export them to Excel

   is one thing somebody confirmed, and the workbook came out holding
   the old depot, because it was built from rows the move had not
   reached yet.

   THE INVARIANT.

     A Select or an Emit that depends on an earlier effect sees the
     relation as it WILL be once that effect has happened.

   Not by rendering afterwards. Rendering afterwards means a renderer
   that fails leaves the change committed and the file missing, which is
   the partial success this whole layer exists to remove.

   THIS IS A PREDICTIVE READER, NOT A PATCHER.

   The first version of this laid the changes over whatever the ordinary
   query returned, which is only enough when the rows are the same rows
   either way. It could not answer

     move these Carrington trailers to Hyde
     and export all the trailers at Hyde

   because the moved units are not in the pre-state answer to "at Hyde"
   and there was nothing to patch them into. Nor could a created record
   appear anywhere downstream, because an insert has no id to patch.

   So membership is decided against the POST-state:

     read the ordinary matching rows
     add every row this programme touches on that table as a candidate
     apply the staged updates, deletes and inserts
     evaluate the condition against what the row WILL hold
     order and limit only once membership is known

   WHAT IT REFUSES TO GUESS.

   For column writes it knows everything: the resolved programme holds
   the row id and the values. For an operation it knows what the
   capability DECLARES, and a capability declares three things: the
   columns it sets, the columns it changes but cannot predict, and the
   other tables it touches. A downstream read that depends on any of the
   last two is REFUSED before anything is written, rather than answered
   with rows that were true a moment ago.
   ============================================================= */
import { capability } from './registry';
import type { Change, ReadOutcome, ReadRequest, Store } from './store';
import type { Cond, Expr } from './types';

/** A row as it will stand once the transaction commits. */
type Overlaid = {
  table: string;
  id: string;
  /** Columns the programme sets. */
  set?: Record<string, unknown>;
  gone?: boolean;
  /** True when the row does not exist yet. */
  made?: boolean;
};

/**
 * What an operation leaves behind.
 *
 * Declared on the capability rather than worked out here.
 *
 *   set          columns it writes, as constants, its own arguments,
 *                another column of the same row, or a column moved by
 *                the same amount as another one
 *   opaque       columns it writes whose value nothing here can work
 *                out: a commission computed from a rate, a status
 *                cascade onto rows nobody named
 *   alsoTouches  other tables it changes
 *
 * The last two are not decoration. A downstream step that depends on
 * either is refused, which is the only honest answer available: a file
 * showing a stale commission next to a fresh sale price is worse than no
 * file at all.
 */
export type EffectValue =
  | unknown
  | { arg: string }
  | { column: string }
  | { movedWith: { anchor: string; arg: string } };

export type DeclaredEffect = {
  table: string;
  set: Record<string, EffectValue>;
  opaque?: string[];
  alsoTouches?: string[];
  /**
   * What it leaves on the record the SENTENCE named, when that is a
   * different row from the one it operates on.
   *
   * "Mark all the in stock curtainsiders as sold" names trailers and
   * sells the deals against them, and the trailer is changed too. A file
   * of the trailers somebody named has to show them sold.
   */
  via?: { table: string; set: Record<string, EffectValue>; opaque?: string[] };
};

function valueOf(
  v: EffectValue, args: Record<string, unknown>, row: Record<string, unknown>,
): unknown {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('arg' in o) return args[String(o.arg)];
    if ('column' in o) return row[String(o.column)];
    if ('movedWith' in o) {
      /* The same distance the anchor moved. "Move it to 2pm" moves the
         end of the meeting by however much the start moved, which is
         what keeps an hour long meeting an hour long. */
      const spec = o.movedWith as { anchor: string; arg: string };
      const was = Date.parse(String(row[spec.anchor] ?? ''));
      const now = Date.parse(String(args[spec.arg] ?? ''));
      const mine = Date.parse(String(row[spec.anchor === 'start_at' ? 'end_at' : spec.anchor] ?? ''));
      if (!Number.isFinite(was) || !Number.isFinite(now) || !Number.isFinite(mine)) return null;
      return new Date(mine + (now - was)).toISOString();
    }
  }
  return v;
}

export type PlannedEffect =
  | { kind: 'changes'; changes: Change[] }
  | {
      kind: 'invoke';
      capability: string;
      subjects: string[];
      /** The records the sentence named, when they are different rows. */
      via?: string[];
      args: Record<string, unknown>;
    };

export type Staged = {
  /** Rows this programme will change, by table and id. */
  rows: Map<string, Overlaid>;
  /** Capabilities whose effect nothing declares. */
  unknown: string[];
  /** Columns nothing can predict, by table. */
  opaque: Map<string, Set<string>>;
  /** Tables changed in ways nothing here can describe. */
  clouded: Set<string>;
};

/**
 * Everything this programme will do, indexed for reading.
 *
 * The row values an operation's effect depends on are not known here,
 * so an effect that reads a column of the row it changes is resolved
 * later, against the row. That is what `pending` carries.
 */
export function overlayFor(effects: PlannedEffect[]): Staged & {
  pending: { table: string; ids: Set<string>; effect: DeclaredEffect; args: Record<string, unknown> }[];
} {
  const rows = new Map<string, Overlaid>();
  const unknown: string[] = [];
  const opaque = new Map<string, Set<string>>();
  const clouded = new Set<string>();
  const pending: {
    table: string; ids: Set<string>; effect: DeclaredEffect; args: Record<string, unknown>;
  }[] = [];

  const put = (
    table: string, id: string,
    set?: Record<string, unknown>, gone?: boolean, made?: boolean,
  ) => {
    const key = `${table}:${id}`;
    const before = rows.get(key);
    rows.set(key, {
      table,
      id,
      set: gone ? undefined : { ...(before?.set ?? {}), ...(set ?? {}) },
      gone: gone ?? before?.gone,
      made: made ?? before?.made,
    });
  };

  for (const effect of effects) {
    if (effect.kind === 'changes') {
      for (const c of effect.changes) {
        const op = c.op ?? 'update';
        if (!c.id) continue;
        put(c.table, String(c.id), c.set, op === 'delete', op === 'insert');
      }
      continue;
    }

    const declared = capability(effect.capability)?.effect as DeclaredEffect | undefined;
    if (!declared) { unknown.push(effect.capability); continue; }

    for (const table of declared.alsoTouches ?? []) clouded.add(table);
    if (declared.opaque?.length) {
      const held = opaque.get(declared.table) ?? new Set<string>();
      for (const column of declared.opaque) held.add(column);
      opaque.set(declared.table, held);
    }

    /* Constants and arguments can be settled now. Anything that reads
       the row has to wait until the row is in hand. */
    const settled: Record<string, unknown> = {};
    let needsRow = false;
    for (const [column, v] of Object.entries(declared.set)) {
      if (v && typeof v === 'object' && ('column' in (v as object) || 'movedWith' in (v as object))) {
        needsRow = true;
        continue;
      }
      settled[column] = valueOf(v, effect.args, {});
    }
    for (const id of effect.subjects) put(declared.table, id, settled);
    if (needsRow) {
      pending.push({
        table: declared.table,
        ids: new Set(effect.subjects),
        effect: declared,
        args: effect.args,
      });
    }

    /* And what it leaves on the records the sentence named, which for a
       sale is the stock units rather than the deals. */
    if (declared.via && effect.via?.length) {
      const settledVia: Record<string, unknown> = {};
      let viaNeedsRow = false;
      for (const [column, v] of Object.entries(declared.via.set)) {
        if (v && typeof v === 'object' && ('column' in (v as object) || 'movedWith' in (v as object))) {
          viaNeedsRow = true;
          continue;
        }
        settledVia[column] = valueOf(v, effect.args, {});
      }
      for (const id of effect.via) put(declared.via.table, id, settledVia);
      if (declared.via.opaque?.length) {
        const held = opaque.get(declared.via.table) ?? new Set<string>();
        for (const column of declared.via.opaque) held.add(column);
        opaque.set(declared.via.table, held);
      }
      if (viaNeedsRow) {
        pending.push({
          table: declared.via.table,
          ids: new Set(effect.via),
          effect: { table: declared.via.table, set: declared.via.set },
          args: effect.args,
        });
      }
    }
  }

  return { rows, unknown, opaque, clouded, pending };
}

/* -------------------------------------------------------------
   Deciding membership against what a row WILL hold
   ------------------------------------------------------------- */

const asText = (v: unknown) => (v == null ? '' : String(v));

function compare(left: unknown, right: unknown): number | null {
  if (left == null) return null;
  const ln = Number(left); const rn = Number(right);
  if (Number.isFinite(ln) && Number.isFinite(rn)) return ln - rn;
  const ld = Date.parse(String(left)); const rd = Date.parse(String(right));
  if (Number.isFinite(ld) && Number.isFinite(rd)) return ld - rd;
  return String(left).localeCompare(String(right));
}

/** A literal, or nothing this can decide. */
function literalOf(e: Expr): unknown | undefined {
  return e.kind === 'literal' ? e.value : undefined;
}
function columnOf(e: Expr): string | null {
  return e.kind === 'field' && !('via' in e.of) ? e.of.field : null;
}

export type Membership = true | false | 'unknown';

/**
 * Does this row match, once the programme has run?
 *
 * `unknown` for anything this cannot decide, which the caller turns into
 * a refusal rather than a guess. Every condition the store can send to
 * PostgREST is decidable here; the ones that are not are the ones the
 * store refuses too.
 */
export function matches(row: Record<string, unknown>, c: Cond): Membership {
  switch (c.kind) {
    case 'and': {
      let out: Membership = true;
      for (const inner of c.of) {
        const m = matches(row, inner);
        if (m === false) return false;
        if (m === 'unknown') out = 'unknown';
      }
      return out;
    }
    case 'or': {
      let out: Membership = false;
      for (const inner of c.of) {
        const m = matches(row, inner);
        if (m === true) return true;
        if (m === 'unknown') out = 'unknown';
      }
      return out;
    }
    case 'not': {
      const m = matches(row, c.of);
      return m === 'unknown' ? 'unknown' : !m;
    }
    case 'cmp': {
      const column = columnOf(c.left);
      const value = literalOf(c.right);
      if (column === null || value === undefined) return 'unknown';
      const left = row[column];
      switch (c.op) {
        case 'eq': return asText(left) === asText(value);
        case 'neq': return asText(left) !== asText(value);
        case 'contains': return asText(left).toLowerCase().includes(asText(value).toLowerCase());
        case 'startsWith': return asText(left).toLowerCase().startsWith(asText(value).toLowerCase());
        case 'gt': case 'gte': case 'lt': case 'lte': {
          const d = compare(left, value);
          if (d === null) return false;
          return c.op === 'gt' ? d > 0 : c.op === 'gte' ? d >= 0 : c.op === 'lt' ? d < 0 : d <= 0;
        }
        default: return 'unknown';
      }
    }
    case 'in': {
      const column = columnOf(c.of);
      if (column === null || !Array.isArray(c.values)) return 'unknown';
      const values = c.values.map(literalOf);
      if (values.some((v) => v === undefined)) return 'unknown';
      return values.map(asText).includes(asText(row[column]));
    }
    case 'empty': {
      const column = columnOf(c.of);
      if (column === null) return 'unknown';
      const v = row[column];
      return v == null || v === '';
    }
    case 'within': {
      const column = columnOf(c.of);
      if (column === null || c.period.kind !== 'absolute') return 'unknown';
      const at = Date.parse(String(row[column] ?? ''));
      if (!Number.isFinite(at)) return false;
      return at >= Date.parse(c.period.from) && at <= Date.parse(c.period.to);
    }
    default:
      return 'unknown';
  }
}

/** Every column a condition looks at. */
export function columnsIn(c: Cond, out = new Set<string>()): Set<string> {
  switch (c.kind) {
    case 'and': case 'or': c.of.forEach((x) => columnsIn(x, out)); return out;
    case 'not': return columnsIn(c.of, out);
    case 'cmp': {
      const column = columnOf(c.left);
      if (column) out.add(column);
      return out;
    }
    case 'in': case 'empty': case 'within': {
      const column = columnOf(c.of as Expr);
      if (column) out.add(column);
      return out;
    }
    default: return out;
  }
}

/* -------------------------------------------------------------
   The store
   ------------------------------------------------------------- */

/**
 * A store that answers as the database will answer once this programme
 * has committed.
 *
 * Writes go straight through untouched. This is a reading lens, not a
 * second place where anything happens.
 */
export function postState(store: Store, effects: PlannedEffect[]): Store {
  const staged = overlayFor(effects);
  if (!staged.rows.size && !staged.clouded.size && !staged.opaque.size) return store;

  return {
    ...store,
    async read(req: ReadRequest): Promise<ReadOutcome> {
      /* A TABLE THIS PROGRAMME CHANGES IN WAYS NOTHING CAN DESCRIBE.

         Marking a sale flips the stock unit and cascades onto other
         deals against it. Neither is predictable from the registry, so a
         downstream read of those tables is refused before anything is
         written rather than answered with rows that are about to be
         wrong. */
      if (staged.clouded.has(req.table)) {
        return {
          ok: false,
          reason: 'unsupported',
          why: `this command changes ${req.table} in ways it cannot describe in advance, `
            + 'so it cannot also tell you what will be in there afterwards. '
            + 'Ask for the file separately once it has run.',
        };
      }

      const opaque = staged.opaque.get(req.table);
      if (opaque?.size) {
        const wanted = [...req.columns, ...columnsIn(req.where)];
        const clash = wanted.find((c) => opaque.has(c));
        if (clash) {
          return {
            ok: false,
            reason: 'unsupported',
            why: `this command changes ${clash} and cannot work out the new value in advance, `
              + 'so it cannot show you that column afterwards in the same breath.',
          };
        }
      }

      const got = await store.read({ ...req, limit: req.limit, offset: req.offset });
      if (!got.ok) return got;

      /* The rows this programme touches on this table which the ordinary
         read did not return. They may match once the change has
         happened, and a created row is not there at all yet. */
      const here = [...staged.rows.values()].filter((r) => r.table === req.table);
      const seen = new Set(got.rows.map((r) => String(r.id)));
      const absent = here.filter((r) => !seen.has(r.id) && !r.gone);

      const extra: Record<string, unknown>[] = [];
      const needed = absent.filter((r) => !r.made).map((r) => r.id);
      if (needed.length) {
        const read = await store.read({
          table: req.table,
          columns: req.columns,
          where: {
            kind: 'in',
            of: { kind: 'field', of: { entity: req.table, field: 'id' } },
            values: needed.map((id) => ({ kind: 'literal' as const, value: id })),
          },
          limit: needed.length,
        });
        if (!read.ok) return read;
        extra.push(...read.rows);
      }
      /* A row that does not exist yet is exactly what the programme says
         it will be, and nothing more. */
      for (const made of absent.filter((r) => r.made)) {
        extra.push({ id: made.id, ...(made.set ?? {}) });
      }

      /* Effects that depend on the row itself, now that the rows are in
         hand. */
      const after = (row: Record<string, unknown>): Record<string, unknown> => {
        const over = staged.rows.get(`${req.table}:${String(row.id)}`);
        let out = over?.set ? { ...row, ...over.set } : { ...row };
        for (const p of staged.pending) {
          if (p.table !== req.table || !p.ids.has(String(row.id))) continue;
          for (const [column, v] of Object.entries(p.effect.set)) {
            if (!(v && typeof v === 'object'
              && ('column' in (v as object) || 'movedWith' in (v as object)))) continue;
            out = { ...out, [column]: valueOf(v, p.args, row) };
          }
        }
        return out;
      };

      /* WHICH COLUMNS THE QUESTION IS ACTUALLY ABOUT.
         Membership only has to be recomputed when this programme changes
         something the condition reads. */
      const asked = new Set(columnsIn(req.where));

      /* Which rows the database itself returned. Everything else here
         is a CANDIDATE: a row this programme touches that the ordinary
         read did not match, brought in so its membership can be
         reconsidered. The two are not the same and the difference
         decides what happens when nothing needs reconsidering. */
      const answered = new Set(got.rows.map((r) => String(r.id)));

      const out: Record<string, unknown>[] = [];
      for (const row of [...got.rows, ...extra]) {
        const over = staged.rows.get(`${req.table}:${String(row.id)}`);
        if (over?.gone) continue;
        const post = over || staged.pending.length ? after(row) : row;

        /* MEMBERSHIP IS DECIDED AFTER THE CHANGE, FOR ROWS THE CHANGE
           REACHES.

           A row this programme does not touch is in or out on what the
           database already said. A row it does touch is in or out on
           what it will hold, which is how a trailer moved to Hyde turns
           up in "all the trailers at Hyde" and how one moved away from
           it does not. */
        /* A CHANGE THAT CANNOT MOVE A ROW IN OR OUT DOES NOT DECIDE
           MEMBERSHIP.

           The database has already answered which rows match. That
           answer only stops being true when this programme writes a
           column the condition READS. "Put the price up on STC143580,
           then set the book value on the trailers near Hyde" changes a
           price and asks about a location, so the location answer
           stands, and a `near` this reader cannot evaluate is not a
           reason to refuse a question it did not need to re-ask.

           A row this programme MAKES is different: the database never
           saw it, so its membership has to be worked out here or not at
           all. */
        const touchesTheQuestion = over
          && (over.made
            || [...asked].some((c) => (over.set ? c in over.set : false))
            || staged.pending.some((p) => p.table === req.table
              && p.ids.has(String(row.id))
              && Object.keys(p.effect.set).some((c) => asked.has(c))));

        if (touchesTheQuestion) {
          const m = matches(post, req.where);
          if (m === 'unknown') {
            return {
              ok: false,
              reason: 'unsupported',
              why: 'this command cannot work out which records that would leave, '
                + 'so it will not guess. Ask for the file separately once it has run.',
            };
          }
          if (!m) continue;
        } else if (!answered.has(String(row.id))) {
          /* A candidate the database did not match, changed in a way
             that cannot affect whether it matches. It was not in the
             answer and it is not going to be. */
          continue;
        }
        out.push(post);
      }

      /* Ordering and the ceiling apply to the set that will exist, not
         to the one that does. */
      if (req.orderBy?.length) {
        out.sort((a, b) => {
          for (const by of req.orderBy ?? []) {
            const d = compare(a[by.column], b[by.column]) ?? 0;
            if (d !== 0) return by.direction === 'desc' ? -d : d;
          }
          return 0;
        });
      }
      return { ok: true, rows: out.slice(0, req.limit) };
    },
  };
}
