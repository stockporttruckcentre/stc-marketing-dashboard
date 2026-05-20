/**
 * Lusha API helpers - server-side only.
 * NEVER import this from a client component.
 */
const BASE = 'https://api.lusha.com';

function authHeaders() {
  const key = process.env.LUSHA_API_KEY;
  if (!key) throw new Error('LUSHA_API_KEY is not set');
  return { api_key: key, 'Content-Type': 'application/json' };
}

export async function enrichByEmail(email: string) {
  const url = new URL(`${BASE}/v2/person`);
  url.searchParams.set('email', email);
  const res = await fetch(url, { headers: authHeaders(), cache: 'no-store' });
  if (!res.ok) throw new Error(`Lusha enrich failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function searchCompanies(opts: {
  location?: string;
  radiusMiles?: number;
  /** LinkedIn-style numeric industry IDs (Lusha uses these) */
  industryIds?: number[];
  minEmployees?: number;
  maxEmployees?: number;
  limit?: number;
}) {
  const include: any = {};
  if (opts.location) include.locations = [{ country: 'United Kingdom', city: opts.location }];
  if (opts.industryIds && opts.industryIds.length) include.mainIndustriesIds = opts.industryIds;
  if (opts.minEmployees != null && opts.maxEmployees != null) {
    include.sizes = [{ min: opts.minEmployees, max: opts.maxEmployees }];
  }
  const body: any = {
    pages: { page: 0, size: opts.limit ?? 25 },
    filters: { companies: { include } },
  };
  const res = await fetch(`${BASE}/prospecting/company/search`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Lusha company search failed: ${res.status} ${await res.text()}`);
  return res.json();
}
