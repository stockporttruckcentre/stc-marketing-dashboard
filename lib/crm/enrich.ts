/* =============================================================
   Looking a company up in Lusha.

   This was the body of `app/api/lusha/enrich`, which meant the command
   bar could reach it only by somebody writing the strategy chain a
   second time. Three strategies, tried in order, each with its own idea
   of what counts as a hit: a second copy would drift on the first one
   Lusha changed.

   TWO HALVES, AND THEY ARE DIFFERENT KINDS OF THING.

     look up      an HTTP call to somebody else's service that SPENDS A
                  CREDIT and cannot be undone
     write down   ordinary column writes on a customer

   Everything else in the command runtime goes into one transaction. A
   spent credit cannot join one and cannot be rolled back, so the lookup
   happens BEFORE the transaction opens, in exactly the place a file is
   rendered, and what it found becomes changes the transaction writes.
   That ordering is the honest one: if the write fails, a credit has
   gone and nothing was recorded, which is a wasted lookup rather than a
   customer holding half of somebody else's details.

   Nothing here decides permission. Both callers gate on `crm.enrich`
   first, and the global Lusha lock is checked by both.
   ============================================================= */
import {
  enrichByEmail, enrichByName, extractDomain, findLushaCompanyByDomain,
  prospectingByCompanyId,
} from '@/lib/lusha';

/* -------------------------------------------------------------
   Reading Lusha's answer

   Every one of these exists because Lusha returns the same fact under
   several names depending on which endpoint answered.
   ------------------------------------------------------------- */

export function pickPhone(p: any): string | null {
  if (!p) return null;
  if (Array.isArray(p.phoneNumbers) && p.phoneNumbers.length) {
    const f = p.phoneNumbers[0];
    return typeof f === 'string' ? f : (f?.number ?? f?.phone ?? null);
  }
  return p.phone ?? null;
}

export function pickEmail(p: any): string | null {
  if (!p) return null;
  if (Array.isArray(p.emailAddresses) && p.emailAddresses.length) {
    const f = p.emailAddresses[0];
    return typeof f === 'string' ? f : (f?.email ?? f?.address ?? null);
  }
  return p.email ?? null;
}

export function pickCompany(p: any) {
  const c = p?.company ?? p?.companyData ?? null;
  if (!c) return { name: p?.companyName, location: p?.location } as Record<string, any>;
  const addr = c.address;
  let addressStr: string | undefined; let city: string | undefined;
  if (addr && typeof addr === 'object') {
    city = addr.city ?? addr.locality;
    addressStr = [addr.street, city, addr.state, addr.country, addr.postalCode]
      .filter(Boolean).join(', ');
  } else if (typeof addr === 'string') addressStr = addr;
  return {
    name: c.name ?? c.companyName,
    location: city ?? c.city ?? c.location ?? p?.location,
    size: typeof c.size === 'number' ? c.size : (typeof c.employees === 'number' ? c.employees : null),
    address: addressStr,
    website: c.fqdn ? `https://${c.fqdn}` : (c.website ?? null),
  };
}

/** What the row already holds, which decides which strategies can run. */
export type EnrichInput = {
  email?: string | null;
  companyName?: string | null;
  contactName?: string | null;
  websiteUrl?: string | null;
  /** Restrict what gets written. `source` is always allowed. */
  onlyFields?: string[];
};

export type EnrichAttempt = { strategy: string; ok: boolean; error?: string };

export type EnrichResult =
  | {
      ok: true;
      /** Which paid strategy was used. Exactly one is. */
      tried: EnrichStrategy;
      /** Strategies the record could still support, each another credit. */
      remaining: EnrichStrategy[];
      /** Columns to write on the customer. */
      fields: Record<string, unknown>;
      /** Which strategy answered, for the preview and the audit. */
      strategy: string;
      attempts: EnrichAttempt[];
      /** Things that hang off the record rather than on it. */
      address: string | null;
      website: string | null;
    }
  | {
      ok: false;
      why: string;
      attempts: EnrichAttempt[];
      /** Which paid strategy was spent, when one was. */
      tried: EnrichStrategy | null;
      remaining: EnrichStrategy[];
    };

/* -------------------------------------------------------------
   Which paid call, and only one of them
   ------------------------------------------------------------- */

/**
 * The provider, as a value.
 *
 * A seam, not an abstraction: tests need to count how many times a
 * purchased call is made, and an ES module namespace cannot be
 * substituted. Production reads `PROVIDER.lookUp` and gets the function
 * below.
 */
export const PROVIDER: {
  lookUp: (input: EnrichInput & { strategy?: EnrichStrategy }) => Promise<EnrichResult>;
} = {
  lookUp: (input) => lookUpInLusha(input),
};

/**
 * The ways a record can be looked up, and what each costs.
 *
 * Every one of these ends in a purchased call. `prospecting` searches
 * for free first and then buys one contact, so its free half can fail
 * without costing anything, but it is still one credit at most.
 */
export type EnrichStrategy = 'email' | 'name+company' | 'prospecting';

export const STRATEGY_ORDER: EnrichStrategy[] = ['email', 'name+company', 'prospecting'];

/** Which strategies this record actually has the details for. */
export function strategiesFor(input: EnrichInput): EnrichStrategy[] {
  const email = (input.email ?? '').trim();
  const companyName = (input.companyName ?? '').trim();
  const contactName = (input.contactName ?? '').trim();
  const domain = extractDomain((input.websiteUrl ?? '').trim());

  const out: EnrichStrategy[] = [];
  if (email) out.push('email');
  if (contactName.split(/\s+/).filter(Boolean).length >= 2 && companyName) out.push('name+company');
  if (domain) out.push('prospecting');
  return out;
}

/**
 * The strategy this lookup will use, or nothing it can try.
 *
 * `after` names a strategy that has already been paid for and missed, so
 * the next one down can be offered. Offering it is not trying it: a
 * second purchase is a second confirmation.
 */
export function nextStrategy(
  input: EnrichInput, after?: EnrichStrategy | null,
): EnrichStrategy | null {
  const available = strategiesFor(input);
  if (!after) return available[0] ?? null;
  const from = STRATEGY_ORDER.indexOf(after);
  return available.find((s) => STRATEGY_ORDER.indexOf(s) > from) ?? null;
}

/**
 * ONE PAID LOOKUP. NO CHAINING.
 *
 * This used to try email, then name and company, then prospecting, all
 * behind a single confirmation, and every one of those is a purchased
 * call. Somebody agreeing to "look one customer up" could be charged
 * three times, and the preview said one.
 *
 * So the strategy is chosen before anything is spent, exactly one paid
 * call is made, and a miss comes back saying which strategy was tried
 * and which remains. Trying the next one is another sentence and another
 * confirmation, because it is another credit.
 *
 * SPENDS ONE CREDIT AT MOST. Nothing here writes to this application's
 * database.
 */
export async function lookUpInLusha(
  input: EnrichInput & { strategy?: EnrichStrategy },
): Promise<EnrichResult> {
  const email = (input.email ?? '').trim();
  const companyName = (input.companyName ?? '').trim();
  const contactName = (input.contactName ?? '').trim();
  const domain = extractDomain((input.websiteUrl ?? '').trim());

  const attempts: EnrichAttempt[] = [];
  const strategy = input.strategy ?? nextStrategy(input);
  if (!strategy) {
    return {
      ok: false,
      why: 'Lusha needs either an email address, or a name and a company, or a website '
        + 'on the record to work from.',
      attempts,
      tried: null,
      remaining: [],
    };
  }

  const remaining = strategiesFor(input)
    .filter((s) => STRATEGY_ORDER.indexOf(s) > STRATEGY_ORDER.indexOf(strategy));

  let found: any = null;
  const answered = (r: any) => !!(r?.data || (r && (r.firstName || r.lastName || r.company)));

  try {
    if (strategy === 'email') {
      const r = await enrichByEmail(email);
      if (answered(r)) found = r;
      attempts.push({ strategy, ok: true });
    } else if (strategy === 'name+company') {
      const parts = contactName.split(/\s+/).filter(Boolean);
      const r = await enrichByName(parts[0], parts.slice(1).join(' '), companyName);
      if (answered(r)) found = r;
      attempts.push({ strategy, ok: true });
    } else {
      /* The company search is free. Only the contact enrich costs, and
         `prospectingByCompanyId` makes exactly one of those. */
      const company = await findLushaCompanyByDomain(domain);
      const r = company ? await prospectingByCompanyId(company.id) : null;
      if (r) found = r;
      attempts.push({ strategy, ok: !!r });
    }
  } catch (e: any) {
    attempts.push({ strategy, ok: false, error: e.message });
    return {
      ok: false,
      why: `Lusha refused the ${strategy} lookup: ${e.message}`,
      attempts, tried: strategy, remaining,
    };
  }

  if (!found) {
    return {
      ok: false,
      why: remaining.length
        ? `Lusha found nothing by ${strategy}. ${remaining.join(' or ')} could be tried, `
          + 'and that is another credit.'
        : `Lusha found nothing by ${strategy}, and there is nothing else on the record to try.`,
      attempts, tried: strategy, remaining,
    };
  }

  const person = found?.data ?? found;
  const company = pickCompany(person);
  const fields: Record<string, unknown> = {};
  const fullName = [person?.firstName, person?.lastName].filter(Boolean).join(' ');

  if (fullName) fields.contact_name = fullName;
  const gotEmail = pickEmail(person);
  if (gotEmail) fields.email = gotEmail;
  const gotPhone = pickPhone(person);
  if (gotPhone) fields.phone = gotPhone;
  if (company?.name) fields.company_name = company.name;
  if (company?.location) fields.location = company.location;
  if (company?.size != null) {
    fields.employee_count = company.size;
    fields.fleet_size = company.size;
  }
  const via = strategy === 'prospecting' && found?._role
    ? `prospecting (${found._role})`
    : strategy;
  fields.source = `Lusha (${via})`;

  /* Only what the caller asked for, when it asked. `source` always goes,
     because a record nobody can trace back to a lookup is a record
     nobody can audit. */
  if (Array.isArray(input.onlyFields) && input.onlyFields.length) {
    const allowed = new Set([...input.onlyFields, 'source']);
    for (const k of Object.keys(fields)) if (!allowed.has(k)) delete fields[k];
  }

  return {
    ok: true,
    fields,
    strategy: via,
    attempts,
    tried: strategy,
    remaining,
    address: company?.address ?? null,
    website: company?.website ?? null,
  };
}
