/* =============================================================
   The live vocabulary, on the server, scoped to who is asking.

   A word is a make because it appears in `stock_trailers.make`. That is
   what lets "how many Chereaus at Carrington" work with nothing written
   down, and it is why the server has to read the same values the
   browser did before it plans the same sentence.

   NOT ALL OF THOSE VALUES ARE EVERYBODY'S.

   `stock_trailers`, `social_posts` and `calendar_events` all restrict
   SELECT to `auth.role() = 'authenticated'`. Every signed in person
   sees the same rows, so the values in them are company wide and one
   cached index serves everybody.

   `crm_contacts` does not:

     CREATE POLICY "crm_select" ON crm_contacts FOR SELECT USING (
       auth.role() = 'authenticated' AND (
         list_id IS NULL
         OR EXISTS (SELECT 1 FROM crm_lists l WHERE l.id = crm_contacts.list_id
           AND (l.is_global OR l.owner_id = auth.uid()
                OR EXISTS (SELECT 1 FROM crm_list_members m
                           WHERE m.list_id = l.id AND m.user_id = auth.uid())))
       ));

   Company names, account owners, locations and sources therefore differ
   per person. A single process wide cache built through whoever
   happened to refresh it meant one person's private accounts became
   everybody's vocabulary for the next minute: their sentences would
   resolve a company name they cannot see, which both changes what their
   command means and tells them the value exists.

   A shorter timer does not fix that. It shortens the window on a thing
   that must never happen at all. So the classification is the fix:

     company   every authenticated user genuinely sees the same values,
               so one process cache is correct
     actor     visibility depends on RLS, so the cache is keyed by user
               and one person's snapshot is never another's

   Anything not explicitly listed as company wide is treated as actor
   scoped. A table added later is private until somebody has read its
   policy and said otherwise.

   Nothing here installs anything. It returns an index, and the caller
   installs it immediately before planning, in the same synchronous run.
   ============================================================= */
import { ENTITIES } from '../schema';
import { buildIndex, mergeIndexes, type VocabularyIndex, type VocabularySnapshot } from '../vocab';

/** How long a loaded index is trusted before it is read again. */
const TTL_MS = 60_000;

/** How many people's indexes to keep. Oldest read is evicted first. */
const ACTOR_CACHE_MAX = 200;

export type Visibility = 'company' | 'actor';

/**
 * Tables whose SELECT policy is `auth.role() = 'authenticated'` and
 * nothing else, checked against supabase/schema.sql. Every signed in
 * person sees every row, so the distinct values are the same for
 * everybody and may be cached once.
 *
 * `crm_contacts` is deliberately absent and must stay absent.
 */
const COMPANY_WIDE_TABLES = new Set(['stock_trailers', 'social_posts', 'calendar_events']);

export function visibilityOfTable(table: string): Visibility {
  return COMPANY_WIDE_TABLES.has(table) ? 'company' : 'actor';
}

export function visibilityOfEntity(entityId: string): Visibility {
  const entity = ENTITIES.find((e) => e.id === entityId);
  /* An entity nobody recognises is not assumed harmless. */
  return entity ? visibilityOfTable(entity.table) : 'actor';
}

/**
 * Whatever can produce an index for the actor being planned for.
 *
 * A function rather than a client, so the planner does not import
 * anything that reaches a database and can be exercised against a known
 * vocabulary without one.
 */
export type VocabularySource = () => Promise<VocabularyIndex>;

/** The minimum of Supabase this needs, so nothing here imports a client. */
type Queryable = {
  from: (table: string) => {
    select: (columns: string) => {
      limit: (n: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
    };
  };
};

/**
 * Distinct values for every free text column, for entities in scope.
 *
 * Only declared free text columns are read, so this can never widen
 * what is filterable. Values only, never row contents. Whatever the
 * caller's client can see is what comes back, which is exactly the
 * point: the RLS that hides a row hides its vocabulary too.
 */
export async function buildVocabulary(
  supabase: Queryable,
  scope: Visibility | 'all' = 'all',
): Promise<VocabularySnapshot> {
  const out: VocabularySnapshot = {};

  for (const entity of ENTITIES) {
    if (scope !== 'all' && visibilityOfTable(entity.table) !== scope) continue;

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

/* -------------------------------------------------------------
   Caches. One shared, one per person, and never the two confused.
   ------------------------------------------------------------- */

type Cached = { index: VocabularyIndex; at: number };

let companyCache: Cached | null = null;
let companyInFlight: Promise<VocabularyIndex> | null = null;

/** Keyed by authenticated user id. Insertion order is read order. */
const actorCache = new Map<string, Cached>();
const actorInFlight = new Map<string, Promise<VocabularyIndex>>();

const fresh = (c: Cached | undefined | null, now: number) => !!c && now - c.at < TTL_MS;

async function companyIndex(supabase: Queryable, now: number): Promise<VocabularyIndex> {
  if (fresh(companyCache, now)) return companyCache!.index;
  if (companyInFlight) return companyInFlight;
  companyInFlight = (async () => {
    try {
      const index = buildIndex(await buildVocabulary(supabase, 'company'));
      companyCache = { index, at: Date.now() };
      return index;
    } catch {
      /* A failed read leaves whatever was loaded standing. A stale
         company vocabulary understands more sentences than an empty
         one, and the plan is checked either way. */
      return companyCache?.index ?? buildIndex({});
    } finally {
      companyInFlight = null;
    }
  })();
  return companyInFlight;
}

async function actorIndex(
  supabase: Queryable, actorId: string, now: number,
): Promise<VocabularyIndex> {
  const held = actorCache.get(actorId);
  if (fresh(held, now)) {
    /* Touch, so the least recently used entry is the one evicted. */
    actorCache.delete(actorId);
    actorCache.set(actorId, held!);
    return held!.index;
  }
  const running = actorInFlight.get(actorId);
  if (running) return running;

  const load = (async () => {
    try {
      const index = buildIndex(await buildVocabulary(supabase, 'actor'));
      actorCache.set(actorId, { index, at: Date.now() });
      while (actorCache.size > ACTOR_CACHE_MAX) {
        const oldest = actorCache.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        actorCache.delete(oldest);
      }
      return index;
    } catch {
      return actorCache.get(actorId)?.index ?? buildIndex({});
    } finally {
      actorInFlight.delete(actorId);
    }
  })();
  actorInFlight.set(actorId, load);
  return load;
}

/**
 * The vocabulary valid for one person, right now.
 *
 * Company wide values from the shared cache, RLS sensitive values from
 * theirs, merged into one index that belongs to nobody else. Returned
 * rather than installed: the caller installs it in the same synchronous
 * run as the planning, because an await between the two is exactly
 * where somebody else's request gets to install theirs.
 */
export function vocabularyFor(supabase: Queryable, actorId: string): VocabularySource {
  return async () => {
    const now = Date.now();
    const [company, actor] = await Promise.all([
      companyIndex(supabase, now),
      actorIndex(supabase, actorId, now),
    ]);
    return mergeIndexes(company, actor);
  };
}

/** Forget everything cached, for a check that means to load its own. */
export function resetVocabularyCaches(): void {
  companyCache = null;
  companyInFlight = null;
  actorCache.clear();
  actorInFlight.clear();
}

/** What is currently held, so a check can assert the scoping. */
export function cacheState(): { company: boolean; actors: string[] } {
  return { company: !!companyCache, actors: [...actorCache.keys()] };
}
