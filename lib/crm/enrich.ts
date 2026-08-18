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
      /** Columns to write on the customer. */
      fields: Record<string, unknown>;
      /** Which strategy answered, for the preview and the audit. */
      strategy: string;
      attempts: EnrichAttempt[];
      /** Things that hang off the record rather than on it. */
      address: string | null;
      website: string | null;
    }
  | { ok: false; why: string; attempts: EnrichAttempt[] };

/**
 * The strategy chain, in order, until one answers.
 *
 * Email first because it is exact. Name and company second because it
 * is nearly exact. Prospecting by domain last because it returns
 * somebody at the company rather than the person asked for, which is
 * useful and is not the same thing.
 *
 * SPENDS A CREDIT. Nothing here writes to this application's database.
 */
export async function lookUpInLusha(input: EnrichInput): Promise<EnrichResult> {
  const email = (input.email ?? '').trim();
  const companyName = (input.companyName ?? '').trim();
  const contactName = (input.contactName ?? '').trim();
  const domain = extractDomain((input.websiteUrl ?? '').trim());

  const attempts: EnrichAttempt[] = [];
  if (!email && !domain) {
    return {
      ok: false,
      why: 'Lusha needs either an email address or a website on the record to work from.',
      attempts,
    };
  }

  const answered = (r: any) => !!(r?.data || (r && (r.firstName || r.lastName || r.company)));
  let found: any = null;
  let strategy = '';

  if (email) {
    try {
      const r = await enrichByEmail(email);
      if (answered(r)) { found = r; strategy = 'email'; }
      attempts.push({ strategy: 'email', ok: true });
    } catch (e: any) {
      attempts.push({ strategy: 'email', ok: false, error: e.message });
    }
  }

  if (!found && contactName && companyName) {
    const parts = contactName.split(/\s+/);
    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ');
    if (firstName && lastName) {
      try {
        const r = await enrichByName(firstName, lastName, companyName);
        if (answered(r)) { found = r; strategy = 'name+company'; }
        attempts.push({ strategy: 'name+company', ok: true });
      } catch (e: any) {
        attempts.push({ strategy: 'name+company', ok: false, error: e.message });
      }
    }
  }

  if (!found && domain) {
    try {
      const company = await findLushaCompanyByDomain(domain);
      const r = company ? await prospectingByCompanyId(company.id) : null;
      if (r) { found = r; strategy = `prospecting (${r._role})`; }
      attempts.push({ strategy: 'prospecting', ok: !!r });
    } catch (e: any) {
      attempts.push({ strategy: 'prospecting', ok: false, error: e.message });
    }
  }

  if (!found) {
    return {
      ok: false,
      why: 'Lusha could not find a contact using what is on that record.',
      attempts,
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
  fields.source = `Lusha (${strategy})`;

  /* Only what the caller asked for, when it asked. `source` always
     goes, because a record nobody can trace back to a lookup is a
     record nobody can audit. */
  if (Array.isArray(input.onlyFields) && input.onlyFields.length) {
    const allowed = new Set([...input.onlyFields, 'source']);
    for (const k of Object.keys(fields)) if (!allowed.has(k)) delete fields[k];
  }

  return {
    ok: true,
    fields,
    strategy,
    attempts,
    address: company?.address ?? null,
    website: company?.website ?? null,
  };
}
