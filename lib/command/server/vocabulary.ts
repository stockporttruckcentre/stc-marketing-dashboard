/* =============================================================
   The live vocabulary, on the server.

   The bar has always loaded this: a word in `stock_trailers.make` IS a
   make, and the day somebody stocks a Chereau the sentence works with
   nothing written down. What the server did not do was load the same
   thing before planning the same sentence.

   That was the hole. The browser understood "how many Chereaus at
   Carrington" as a filter on make, because the browser had read the
   make column. The server planned the same text with an empty index,
   read nothing that named a make, and produced a different plan. The
   summary somebody agreed to and the query that ran were then two
   different questions, and nothing in the system could tell.

   So there is one builder, here, and both sides use it. The route that
   feeds the browser is a wrapper over `buildVocabulary`, and the server
   planner reads the same function through `supabaseVocabulary`.

   THE CACHE IS PROCESS WIDE AND THAT IS DELIBERATE.

   `lib/command/vocab.ts` holds a module level index, in the browser and
   here. On the server that means one index per running instance, shared
   by every request it serves. This is a cache of what the database
   contains, which is the same for everybody, so sharing it is correct
   rather than merely convenient. Nothing per user or per role goes near
   it: the values are makes, models, depots, customers and reps, and the
   permission decisions are made from the plan, not from the index.

   It is refreshed on a timer rather than per request, because reading
   twenty thousand rows on every keystroke would be its own defect.
   ============================================================= */
import { ENTITIES } from '../schema';
import { applyVocabulary, type VocabularySnapshot } from '../vocab';

/** How long a loaded index is trusted before it is read again. */
const TTL_MS = 60_000;

/**
 * Whatever can produce a snapshot.
 *
 * A function rather than a client, so the planner does not import
 * anything that reaches a database and can be exercised against a
 * known vocabulary without one.
 */
export type VocabularySource = () => Promise<VocabularySnapshot>;

/** The minimum of Supabase this needs, so nothing here imports a client. */
type Queryable = {
  from: (table: string) => {
    select: (columns: string) => {
      limit: (n: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
    };
  };
};

/**
 * Distinct values for every free text column an entity declares.
 *
 * Only declared free text columns are read, so this can never widen
 * what is filterable. Values only, never row contents.
 */
export async function buildVocabulary(supabase: Queryable): Promise<VocabularySnapshot> {
  const out: VocabularySnapshot = {};

  for (const entity of ENTITIES) {
    const columns = entity.filters.filter((f) => f.freeText).map((f) => f.column);
    if (!columns.length) continue;

    /* One read per entity rather than one per column. Distinct values
       are counted here instead of in the database because PostgREST has
       no group-by, and the alternative is a view per column. */
    const { data, error } = await supabase
      .from(entity.table)
      .select(columns.join(', '))
      .limit(20_000);
    if (error || !data) continue;

    const counts: Record<string, Map<string, number>> = {};
    for (const c of columns) counts[c] = new Map();
    for (const row of data as Record<string, unknown>[]) {
      for (const c of columns) {
        const v = String(row[c] ?? '').trim();
        if (v.length < 2 || v.length > 60) continue;
        counts[c].set(v, (counts[c].get(v) ?? 0) + 1);
      }
    }

    out[entity.id] = {};
    for (const c of columns) {
      out[entity.id][c] = [...counts[c].entries()]
        .map(([value, rows]) => ({ value, rows }))
        /* Commonest first, capped. A column with ten thousand distinct
           customer names does not need all of them in the browser to
           make the common ones reachable. */
        .sort((a, b) => b.rows - a.rows)
        .slice(0, 1200);
    }
  }

  return out;
}

export function supabaseVocabulary(supabase: Queryable): VocabularySource {
  return () => buildVocabulary(supabase);
}

/* -------------------------------------------------------------
   Loading it, once, for everybody
   ------------------------------------------------------------- */

let loadedAt = 0;
let inFlight: Promise<void> | null = null;

/**
 * Make sure the index reflects the database before anything is planned.
 *
 * Concurrent callers share one read. A failed read leaves whatever was
 * already loaded standing, because a stale vocabulary understands more
 * sentences than an empty one and the plan is checked either way.
 */
export async function ensureVocabulary(
  source: VocabularySource,
  now: number = Date.now(),
): Promise<void> {
  if (loadedAt && now - loadedAt < TTL_MS) return;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      applyVocabulary(await source());
      loadedAt = Date.now();
    } catch {
      /* Left standing on purpose. See above. */
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Forget when it was last loaded, so the next call reads again. */
export function invalidateVocabulary(): void {
  loadedAt = 0;
}
