/**
 * Lusha API helpers - server-side only.
 * Three enrichment strategies, in cost/accuracy order:
 *   1) enrichByEmail   - GET /v2/person?email=...        (1 credit, most accurate)
 *   2) enrichByName    - GET /v2/person?firstName=&...   (1 credit, accurate when name+company known)
 *   3) prospectingByCompanyAndRoles - 2-step: search (free) then enrich (1 credit/contact)
 *
 * Docs: https://docs.lusha.com/
 */
const BASE = 'https://api.lusha.com';

function authHeaders() {
  const key = process.env.LUSHA_API_KEY;
  if (!key) throw new Error('LUSHA_API_KEY is not set');
  return { api_key: key, 'Content-Type': 'application/json' };
}

async function getJson(url: URL | string) {
  const res = await fetch(url, { headers: authHeaders(), cache: 'no-store' });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { ok: res.ok, status: res.status, json, text };
}

async function postJson(url: string, body: any) {
  const res = await fetch(url, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body), cache: 'no-store' });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { ok: res.ok, status: res.status, json, text };
}

// ============ Strategy 1: by email ============
export async function enrichByEmail(email: string) {
  const url = new URL(`${BASE}/v2/person`);
  url.searchParams.set('email', email);
  const r = await getJson(url);
  if (!r.ok) throw new Error(`Lusha enrich-by-email failed: ${r.status} ${r.text}`);
  return r.json;
}

// ============ Strategy 2: by name + company ============
export async function enrichByName(firstName: string, lastName: string, companyName: string) {
  const url = new URL(`${BASE}/v2/person`);
  url.searchParams.set('firstName', firstName);
  url.searchParams.set('lastName', lastName);
  url.searchParams.set('companyName', companyName);
  const r = await getJson(url);
  if (!r.ok) throw new Error(`Lusha enrich-by-name failed: ${r.status} ${r.text}`);
  return r.json;
}

// ============ Strategy 3: prospecting (company + role fallback) ============
// Step 3a: search for contact IDs at a company filtered by job titles
async function prospectingContactSearch(companyName: string, jobTitles: string[], size = 5) {
  const body = {
    pages: { page: 0, size },
    filters: {
      contacts: {
        include: {
          companies: { names: [companyName] },
          jobTitles: { values: jobTitles },
        },
      },
    },
  };
  return postJson(`${BASE}/prospecting/contact/search`, body);
}

// Step 3b: enrich a list of contact IDs (real PII)
async function prospectingContactEnrich(contactIds: string[]) {
  return postJson(`${BASE}/prospecting/contact/enrich`, { contactIds });
}

/**
 * Try multiple role fallbacks for the company until we get a contact back.
 * Returns the first enriched person we find.
 */
export async function prospectingByCompanyAndRoles(companyName: string): Promise<any | null> {
  const roleGroups: string[][] = [
    ['Sales Director', 'Sales Manager', 'Head of Sales'],
    ['Managing Director', 'CEO', 'Owner'],
    ['Fleet Manager', 'Transport Manager', 'Operations Director', 'Operations Manager'],
    ['Procurement Manager', 'Procurement Director', 'Buyer'],
    ['Director'],
  ];
  for (const group of roleGroups) {
    const search = await prospectingContactSearch(companyName, group, 5);
    if (!search.ok) continue;
    const found = search.json?.data ?? search.json?.contacts ?? [];
    const ids: string[] = (Array.isArray(found) ? found : []).map((c: any) => c.id ?? c.contactId).filter(Boolean);
    if (!ids.length) continue;
    // Enrich the first ID (cheapest — 1 credit, finds someone matching)
    const enrich = await prospectingContactEnrich(ids.slice(0, 1));
    if (!enrich.ok) continue;
    const enriched = enrich.json?.data ?? enrich.json?.contacts ?? null;
    const first = Array.isArray(enriched) ? enriched[0] : enriched;
    if (first) return { data: first, _via: 'prospecting', _role: group.join(' / ') };
  }
  return null;
}

// ============ Company search (used by Company Finder, not enrich) ============
export async function searchCompanies(opts: {
  location?: string;
  radiusMiles?: number;
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
  const r = await postJson(`${BASE}/prospecting/company/search`, {
    pages: { page: 0, size: opts.limit ?? 25 },
    filters: { companies: { include } },
  });
  if (!r.ok) throw new Error(`Lusha company search failed: ${r.status} ${r.text}`);
  return r.json;
}
