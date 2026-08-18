/* =============================================================
   Looking for companies that are not customers yet.

   The finder screen's search was written in the component and shaped
   again in the route: which industries exist, which city a depot maps
   to, what a result looks like. Three copies of one idea, and a sentence
   could reach none of them.

   WHAT A SEARCH IS, HERE.

   A paid read of somebody else's database. It cannot be rolled back and
   it cannot be repeated for free, which puts it in the same category as
   a Lusha enrichment and not in the same category as a query. So it is
   a preparer: `describe` says exactly what would be searched for and
   what it can cost, `run` does it once, and the rows it produces go
   into the programme's own transaction through the same import the
   spreadsheet uses.

   AN INCOMPLETE SENTENCE COSTS NOTHING.

   "Find waste companies" says what kind and not where. Lusha would
   happily answer it for the whole of the United Kingdom and charge for
   the privilege, so it is refused by name before any call is made. The
   place is the one thing a search cannot be without.
   ============================================================= */
import { DEPOTS } from '@/lib/types';
import { searchCompanies } from '@/lib/lusha';

/* The industry words are `lib/command/params.ts`, which is where every
   other value a sentence carries is read. A second table of them here
   would be the third copy: the component had one and the reader had
   one, and they had already drifted apart on what counts as haulage. */

/**
 * Where to search, as Lusha understands it.
 *
 * Lusha rejects postcodes and radius on its prospecting filter, so each
 * depot maps to the metropolitan city it actually indexes. That is the
 * same mapping the screen makes, and it is why "within 20 miles of
 * Hyde" searches Manchester.
 */
export function placeIn(named: string): { said: string; city: string } | null {
  const wanted = named.trim();
  if (!wanted) return null;
  const depot = DEPOTS.find((d) => d.name.toLowerCase() === wanted.toLowerCase());
  if (depot) return { said: depot.name, city: depot.lushaCity };
  return { said: wanted, city: wanted };
}

export type FoundCompany = {
  name: string;
  employees: number | null;
  location: string;
  distance: number | null;
  domain: string | null;
  industry: string | null;
};

export type FinderSearch = {
  city: string;
  radiusMiles?: number;
  industryIds?: number[];
  minEmployees?: number;
  maxEmployees?: number;
  limit: number;
};

/** What comes back, in the one shape both callers use. */
export function readCompanies(raw: unknown): FoundCompany[] {
  const body = (raw ?? {}) as { data?: unknown[]; companies?: unknown[] };
  const rows = (body.data ?? body.companies ?? []) as Record<string, unknown>[];
  return rows.map((c) => {
    const location = c.location as { city?: string } | string | undefined;
    return {
      name: String(c.name ?? c.companyName ?? '').trim(),
      employees: (c.employees ?? c.companySize ?? null) as number | null,
      location: typeof location === 'string' ? location : String(location?.city ?? c.city ?? ''),
      distance: (c.distanceMiles ?? null) as number | null,
      domain: (c.website ?? c.domain ?? null) as string | null,
      industry: (c.industry ?? null) as string | null,
    };
  }).filter((c) => c.name);
}

/**
 * The one place a company search is actually made.
 *
 * A seam, like `PROVIDER` in `enrich.ts` and for the same reason: a
 * check has to be able to prove the search happened once, and happened
 * not at all for a sentence that was incomplete, without a Lusha key
 * and without spending anything.
 */
export const FINDER = {
  async search(search: FinderSearch): Promise<FoundCompany[]> {
    const raw = await searchCompanies({
      location: search.city,
      radiusMiles: search.radiusMiles,
      industryIds: search.industryIds,
      minEmployees: search.minEmployees,
      maxEmployees: search.maxEmployees,
      limit: search.limit,
    });
    return readCompanies(raw);
  },
};

/** What the finder puts in the CRM, which is what the screen puts there. */
export const FINDER_SOURCE = 'Lusha Company Finder';

/**
 * The finder's results, as customers.
 *
 * The screen writes `fleet_size` from Lusha's employee count. That
 * column is derived from the three vehicle counts by a trigger, so
 * writing it is a write the database undoes, and the allowlist refuses
 * it outright. The number is kept where it can be read instead.
 */
export function asContactRows(companies: FoundCompany[]): Record<string, unknown>[] {
  return companies.map((c) => ({
    company_name: c.name,
    location: c.location,
    source: FINDER_SOURCE,
    status: 'lead',
    notes: [
      c.domain ? `Domain: ${c.domain}` : null,
      c.employees ? `Employees: ${c.employees}` : null,
    ].filter(Boolean).join('. ') || null,
  }));
}
