/* =============================================================
   Reading the database as it will be, not as it is.

   A programme's file is rendered BEFORE its transaction opens, so a
   renderer that throws leaves nothing written. That ordering is right
   and it introduced a lie:

     move these selected trailers to Hyde and export them to Excel

   is one thing somebody confirmed, and the workbook came out holding
   the old depot, because it was built from rows the move had not
   reached yet. The same applies to every chained sentence:

     change Dave's role to sales and export him to CSV
     mark these as sold and export the result
     set the retail price to 24995 and export them to Word

   THE INVARIANT.

     An Emit consuming a previous effect sees the POST-EFFECT result of
     that step.

   Not by rendering afterwards. Rendering afterwards means a renderer
   that fails leaves the change committed and the file missing, which is
   the partial success this whole layer exists to remove.

   So the rows are read through this: an ordinary `Store` with the
   programme's resolved changes laid over the top. The changes are
   already known before anything is written, because that is what makes
   the preview exact, and the same knowledge makes the file exact.

   WHAT IT KNOWS, AND WHAT IT REFUSES TO GUESS.

   For column writes it knows everything: the resolved programme holds
   the row id and the values. For an operation it knows what the
   capability DECLARES it does, which is a registry entry rather than an
   inference, and a capability that declares nothing gets no overlay at
   all. A guess about what an operation leaves behind would be worse
   than the old rows: at least those were true once.
   ============================================================= */
import { capability } from './registry';
import type { Change, ReadOutcome, ReadRequest, Store } from './store';

/** A row as it will stand once the transaction commits. */
type Overlaid = {
  table: string;
  id: string;
  /** Columns the programme sets. Absent means the row is going. */
  set?: Record<string, unknown>;
  gone?: boolean;
};

/**
 * What an operation leaves on its subjects.
 *
 * Declared on the capability rather than worked out here. `deal.markSold`
 * writes a status and a commission; `user.setRole` writes a role. The
 * values may be constants or the operation's own arguments, which is
 * what `{ arg: 'role' }` means.
 */
export type DeclaredEffect = {
  /** Which table the subjects live in. */
  table: string;
  set: Record<string, unknown | { arg: string }>;
};

function valueOf(v: unknown, args: Record<string, unknown>): unknown {
  if (v && typeof v === 'object' && 'arg' in (v as Record<string, unknown>)) {
    return args[String((v as { arg: string }).arg)];
  }
  return v;
}

export type PlannedEffect =
  | { kind: 'changes'; changes: Change[] }
  | {
      kind: 'invoke';
      capability: string;
      subjects: string[];
      args: Record<string, unknown>;
    };

/**
 * The rows a programme will leave behind, by table and id.
 *
 * `null` for a step whose effect nothing declares, which the caller
 * treats as "do not claim to know".
 */
export function overlayFor(effects: PlannedEffect[]): {
  rows: Map<string, Overlaid>;
  /** Steps whose result is not declared, so nothing can be predicted. */
  unknown: string[];
} {
  const rows = new Map<string, Overlaid>();
  const unknown: string[] = [];

  const put = (table: string, id: string, set?: Record<string, unknown>, gone?: boolean) => {
    const key = `${table}:${id}`;
    const before = rows.get(key);
    rows.set(key, {
      table,
      id,
      set: gone ? undefined : { ...(before?.set ?? {}), ...(set ?? {}) },
      gone: gone ?? before?.gone,
    });
  };

  for (const effect of effects) {
    if (effect.kind === 'changes') {
      for (const c of effect.changes) {
        const op = c.op ?? 'update';
        if (op === 'insert') continue;      // no id to overlay yet
        if (!c.id) continue;
        put(c.table, String(c.id), c.set, op === 'delete');
      }
      continue;
    }

    const declared = capability(effect.capability)?.effect;
    if (!declared) { unknown.push(effect.capability); continue; }

    const set: Record<string, unknown> = {};
    for (const [column, v] of Object.entries(declared.set)) {
      set[column] = valueOf(v, effect.args);
    }
    for (const id of effect.subjects) put(declared.table, id, set);
  }

  return { rows, unknown };
}

/**
 * A store that answers as the database will answer once this programme
 * has committed.
 *
 * Reads go to the real store and the overlay is applied to what comes
 * back. Deleted rows disappear, changed columns hold the new value, and
 * a row that no longer matches the condition it was selected by is
 * still returned, because the selection was made before the change and
 * that is the set somebody agreed to.
 *
 * Writes go straight through untouched. This is a reading lens, not a
 * second place where anything happens.
 */
export function postState(store: Store, effects: PlannedEffect[]): Store {
  const { rows } = overlayFor(effects);
  if (!rows.size) return store;

  return {
    ...store,
    async read(req: ReadRequest): Promise<ReadOutcome> {
      const got = await store.read(req);
      if (!got.ok) return got;

      const out: Record<string, unknown>[] = [];
      for (const row of got.rows) {
        const over = rows.get(`${req.table}:${String(row.id)}`);
        if (over?.gone) continue;
        out.push(over?.set ? { ...row, ...over.set } : row);
      }
      return { ok: true, rows: out };
    },
  };
}
