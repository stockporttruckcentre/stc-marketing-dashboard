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

// ============ Domain utilities ============
/**
 * Strip scheme, www, path, query, hash; lowercase. Returns bare hostname.
 *   "customer.com"                  -> "customer.com"
 *   "https://customer.com/"         -> "customer.com"
 *   "https://www.customer.com/path" -> "customer.com"
 *   "  WWW.Customer.COM  "          -> "customer.com"
 *   ""                              -> ""
 */
export function extractDomain(raw: string | null | undefined): string {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  // Add scheme if missing so URL parser works
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    return u.hostname.replace(/^www\./i, '');
  } catch {
    // Manual fallback if URL constructor fails (unusual chars etc)
    return s.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].split('?')[0].split('#')[0];
  }
}

/**
 * Find a Lusha company by domain. FREE — uses /prospecting/company/search with the
 * supported `domains[]` filter (which the /names[] filter is NOT, hence the 400s).
 * Returns null on no match. Captures size/location/industry like findLushaCompany.
 */
export async function findLushaCompanyByDomain(domain: string): Promise<{ id: string; name: string; matchedVariant: string; size: number | null; location: string | null; industry: string | null; domain: string | null } | null> {
  const r = await findLushaCompanyByDomainDebug(domain);
  return r.match;
}

export async function findLushaCompanyByDomainDebug(domain: string): Promise<{
  match: { id: string; name: string; matchedVariant: string; size: number | null; location: string | null; industry: string | null; domain: string | null } | null;
  attempts: Array<{ shape: string; sent: any; status: number; bodyKeys: string[]; itemCount: number; sample: any }>;
}> {
  const d = extractDomain(domain);
  const attempts: any[] = [];
  if (!d) return { match: null, attempts };

  // Try multiple filter shapes - the Prospecting API has changed names over versions
  const candidates: Array<{ shape: string; body: any }> = [
    { shape: 'domains:[d]', body: { pages: { page: 0, size: 5 }, filters: { companies: { include: { domains: [d] } } } } },
    { shape: 'mainDomains:[d]', body: { pages: { page: 0, size: 5 }, filters: { companies: { include: { mainDomains: [d] } } } } },
    { shape: 'domain:d', body: { pages: { page: 0, size: 5 }, filters: { companies: { include: { domain: d } } } } },
    { shape: 'websites:[d]', body: { pages: { page: 0, size: 5 }, filters: { companies: { include: { websites: [d] } } } } },
    { shape: 'urls:[d]', body: { pages: { page: 0, size: 5 }, filters: { companies: { include: { urls: [d] } } } } },
  ];

  for (const c of candidates) {
    const r = await postJson(`${BASE}/prospecting/company/search`, c.body);
    const items = r.json?.data ?? r.json?.companies ?? r.json?.results ?? [];
    const arr = Array.isArray(items) ? items : (items ? [items] : []);
    const bodyKeys = r.json && typeof r.json === 'object' ? Object.keys(r.json) : [];
    attempts.push({ shape: c.shape, sent: c.body.filters, status: r.status, bodyKeys, itemCount: arr.length, sample: arr.slice(0, 1) });
    if (!r.ok) continue;
    const first = arr[0];
    const id = first?.id ?? first?.companyId ?? null;
    if (id) {
      return {
        match: {
          id,
          name: first?.name ?? first?.companyName ?? d,
          matchedVariant: d,
          size: first?.size ?? first?.employees ?? first?.employeeCount ?? null,
          location: first?.location ?? first?.country ?? first?.city ?? null,
          industry: first?.industry ?? first?.mainIndustry ?? (Array.isArray(first?.industries) ? first.industries[0] : null),
          domain: first?.domain ?? first?.website ?? d,
        },
        attempts,
      };
    }
  }
  return { match: null, attempts };
}

// ============ Free company lookup with progressive name variants ============
/**
 * Build up to 4 candidate names for a single company, progressively trimmed.
 * Order: full input → legal-suffix stripped → first-two-words → first-word.
 * Variants are deduplicated and never include the empty string.
 */
function companyNameVariants(raw: string): string[] {
  const out: string[] = [];
  const add = (v: string) => { const t = v.trim(); if (t && !out.includes(t)) out.push(t); };
  const trimmed = (raw || '').trim();
  if (!trimmed) return [];
  add(trimmed);
  // Strip common legal/entity suffixes (apply repeatedly for stacked ones)
  const sufRe = /\s+(limited|ltd|plc|p\.l\.c|llp|llc|inc|incorporated|corp|corporation|co|company|gmbh|bv|sa|s\.a)\.?$/gi;
  let cleaned = trimmed;
  for (let i = 0; i < 3; i++) {
    const next = cleaned.replace(sufRe, '').trim();
    if (next === cleaned) break;
    cleaned = next;
  }
  cleaned = cleaned.replace(/\s*\(uk\)\s*$/gi, '').replace(/\s*&\s*(sons|co)\.?$/gi, '').trim();
  if (cleaned) add(cleaned);
  // First two words (often the recognisable trading name)
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 2) add(words.slice(0, 2).join(' '));
  // First word only - skip if too short to be meaningful (e.g. "AB Ltd" → "AB" not useful)
  if (words.length >= 1 && words[0].length >= 4) add(words[0]);
  return out;
}

/**
 * Search Lusha's company database with progressively trimmed name variants.
 * /prospecting/company/search is FREE - only counts against daily call quota, not credits.
 * Returns the first matching Lusha company (id, canonical name) or null if none of the variants match.
 */
export async function findLushaCompany(companyName: string): Promise<{ id: string; name: string; matchedVariant: string; size: number | null; location: string | null; industry: string | null; domain: string | null } | null> {
  const result = await findLushaCompanyDebug(companyName);
  return result.match;
}

/**
 * Same as findLushaCompany but exposes the raw debug trail so the UI / logs can show
 * exactly what we sent to Lusha and what came back. No extra credit cost.
 */
export async function findLushaCompanyDebug(companyName: string): Promise<{
  match: { id: string; name: string; matchedVariant: string; size: number | null; location: string | null; industry: string | null; domain: string | null } | null;
  attempts: Array<{ variant: string; filterShape: string; status: number; itemCount: number; rawSample: any }>;
}> {
  const variants = companyNameVariants(companyName);
  const attempts: any[] = [];

  // Try multiple filter shapes per variant - Lusha's prospecting search docs vary.
  // We try names[], then domain-style guesses, then a generic 'keyword' / 'text' search.
  const buildFilters = (variant: string): Array<{ label: string; body: any }> => ([
    { label: 'names[]',        body: { filters: { companies: { include: { names: [variant] } } } } },
    { label: 'keyword',        body: { filters: { companies: { include: { keyword: variant } } } } },
    { label: 'name (single)',  body: { filters: { companies: { include: { name: variant } } } } },
    { label: 'top-keyword',    body: { keyword: variant, filters: { companies: { include: {} } } } },
  ]);

  for (const variant of variants) {
    for (const f of buildFilters(variant)) {
      const r = await postJson(`${BASE}/prospecting/company/search`, {
        pages: { page: 0, size: 5 },
        ...f.body,
      });
      const items = r.json?.data ?? r.json?.companies ?? r.json?.results ?? [];
      const arr = Array.isArray(items) ? items : (items ? [items] : []);
      attempts.push({ variant, filterShape: f.label, status: r.status, itemCount: arr.length, rawSample: arr.slice(0, 2) });
      if (!r.ok) continue;
      const first = arr[0];
      const id = first?.id ?? first?.companyId ?? null;
      if (id) {
        return {
          match: {
            id,
            name: first?.name ?? first?.companyName ?? variant,
            matchedVariant: variant,
            size: first?.size ?? first?.employees ?? first?.employeeCount ?? null,
            location: first?.location ?? first?.country ?? first?.city ?? null,
            industry: first?.industry ?? first?.mainIndustry ?? (Array.isArray(first?.industries) ? first.industries[0] : null),
            domain: first?.domain ?? first?.website ?? null,
          },
          attempts,
        };
      }
    }
  }
  return { match: null, attempts };
}

// ============ Prospecting by resolved company ID ============
/**
 * Given a Lusha company ID (already resolved free via /prospecting/company/search by domain),
 * find the highest-priority sales contact and enrich them.
 *  - search calls: free
 *  - one enrich call: 1 credit (only spent when a matching contact is found)
 */
export async function prospectingByCompanyId(companyId: string): Promise<any | null> {
  const roleGroups: string[][] = [
    ['Sales Director'],
    ['Sales Manager'],
    ['Sales Executive', 'Sales Associate', 'Sales Assistant'],
    ['Head of Sales', 'Business Development Director', 'Business Development Manager'],
    ['Account Manager', 'Account Director', 'Key Account Manager'],
    ['Commercial Director', 'Commercial Manager'],
    ['Managing Director', 'CEO', 'Owner'],
    ['Fleet Manager', 'Transport Manager'],
    ['Operations Director', 'Operations Manager'],
    ['Procurement Manager', 'Procurement Director', 'Buyer'],
    ['Director'],
  ];
  for (const group of roleGroups) {
    const search = await postJson(`${BASE}/prospecting/contact/search`, {
      pages: { page: 0, size: 5 },
      filters: { contacts: { include: { companies: { ids: [companyId] }, jobTitles: { values: group } } } },
    });
    if (!search.ok) continue;
    const found = search.json?.data ?? search.json?.contacts ?? [];
    const ids: string[] = (Array.isArray(found) ? found : []).map((c: any) => c.id ?? c.contactId).filter(Boolean);
    if (!ids.length) continue;
    const enrich = await postJson(`${BASE}/prospecting/contact/enrich`, { contactIds: ids.slice(0, 1) });
    if (!enrich.ok) continue;
    const enriched = enrich.json?.data ?? enrich.json?.contacts ?? null;
    const first = Array.isArray(enriched) ? enriched[0] : enriched;
    if (first) return { data: first, _via: 'prospecting-by-domain', _role: group[0] };
  }
  return null;
}

// ============ Free contact probe (used by pre-flight check route) ============
/**
 * Free probe: does Lusha have a contact matching our role cascade at this company?
 * Uses the SAME role cascade as prospectingByCompanyAndRoles so the pre-check is honest.
 * Returns { found, matchedRole, count } or null on error. No credits spent.
 */
export async function prospectingContactProbe(companyId: string): Promise<{ found: boolean; matchedRole: string; count: number } | null> {
  const roleGroups: string[][] = [
    ['Sales Director'],
    ['Sales Manager'],
    ['Sales Executive', 'Sales Associate', 'Sales Assistant'],
    ['Head of Sales', 'Business Development Director', 'Business Development Manager'],
    ['Account Manager', 'Account Director', 'Key Account Manager'],
    ['Commercial Director', 'Commercial Manager'],
    ['Managing Director', 'CEO', 'Owner'],
    ['Fleet Manager', 'Transport Manager'],
    ['Operations Director', 'Operations Manager'],
    ['Procurement Manager', 'Procurement Director', 'Buyer'],
    ['Director'],
  ];
  for (const group of roleGroups) {
    const r = await postJson(`${BASE}/prospecting/contact/search`, {
      pages: { page: 0, size: 5 },
      filters: { contacts: { include: { companies: { ids: [companyId] }, jobTitles: { values: group } } } },
    });
    if (!r.ok) continue;
    const items = r.json?.data ?? r.json?.contacts ?? [];
    const count = Array.isArray(items) ? items.length : 0;
    if (count > 0) return { found: true, matchedRole: group[0], count };
  }
  return { found: false, matchedRole: '', count: 0 };
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
  // First do a FREE company lookup with progressive name variants so misnamed/suffixed rows still match.
  // E.g. "Chartrange Enviro Limited" → tries that → "Chartrange Enviro" → "Chartrange" until Lusha returns a hit.
  const company = await findLushaCompany(companyName);
  if (!company) return null; // no variant matched - genuinely unknown to Lusha, do NOT burn credits trying name strings

  // Cascade in user's priority order: sales depth first, then closest alternatives
  const roleGroups: string[][] = [
    ['Sales Director'],
    ['Sales Manager'],
    ['Sales Executive', 'Sales Associate', 'Sales Assistant'],
    ['Head of Sales', 'Business Development Director', 'Business Development Manager'],
    ['Account Manager', 'Account Director', 'Key Account Manager'],
    ['Commercial Director', 'Commercial Manager'],
    ['Managing Director', 'CEO', 'Owner'],
    ['Fleet Manager', 'Transport Manager'],
    ['Operations Director', 'Operations Manager'],
    ['Procurement Manager', 'Procurement Director', 'Buyer'],
    ['Director'],
  ];
  for (const group of roleGroups) {
    // Search contacts using the resolved company ID (more reliable than name string)
    const body = {
      pages: { page: 0, size: 5 },
      filters: {
        contacts: {
          include: {
            companies: { ids: [company.id] },
            jobTitles: { values: group },
          },
        },
      },
    };
    const search = await postJson(`${BASE}/prospecting/contact/search`, body);
    if (!search.ok) continue;
    const found = search.json?.data ?? search.json?.contacts ?? [];
    const ids: string[] = (Array.isArray(found) ? found : []).map((c: any) => c.id ?? c.contactId).filter(Boolean);
    if (!ids.length) continue;
    const enrich = await prospectingContactEnrich(ids.slice(0, 1));
    if (!enrich.ok) continue;
    const enriched = enrich.json?.data ?? enrich.json?.contacts ?? null;
    const first = Array.isArray(enriched) ? enriched[0] : enriched;
    if (first) return { data: first, _via: 'prospecting', _role: group.join(' / '), _matched_company: company.matchedVariant };
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
