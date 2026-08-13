import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { lushaLockResponse } from '@/lib/crm/lusha-gate';
import { findLushaCompanyByDomain, findLushaCompanyByDomainDebug, extractDomain, prospectingContactProbe } from '@/lib/lusha';

export const dynamic = 'force-dynamic';

/**
 * Pre-flight check for the enrich modal. FREE (0 credits).
 * Lookup strategy:
 *  - If row has email, we can't verify without burning a credit -> just say "will use email"
 *  - Else we need a website URL on the row. Extract domain, hit /prospecting/company/search
 *    with domains[] filter (the only name-like filter Lusha actually supports for free),
 *    then probe contacts.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const locked = lushaLockResponse();
  if (locked) return locked;

  const body = await req.json().catch(() => ({})) as { company_name?: string; email?: string; website_url?: string };
  const companyName = (body.company_name || '').trim();
  const email = (body.email || '').trim();
  const websiteUrl = (body.website_url || '').trim();

  if (email) {
    return NextResponse.json({
      found: true,
      strategy: 'email',
      lushaName: null,
      availableFields: { contact_name: true, email: true, phone: true, employee_count: true, location: true },
      message: `Will look up by email: ${email}`,
    });
  }

  if (!websiteUrl) {
    return NextResponse.json({
      found: false,
      strategy: 'requires_website',
      message: 'Website URL required to enrich without email. Add a Website link in the contact full view.',
    });
  }

  const domain = extractDomain(websiteUrl);
  if (!domain) {
    return NextResponse.json({ found: false, strategy: 'bad_url', message: `Could not extract a domain from "${websiteUrl}".` });
  }

  const dbg = await findLushaCompanyByDomainDebug(domain);
  const company = dbg.match;
  if (!company) {
    return NextResponse.json({
      found: false,
      strategy: 'domain',
      domainTried: domain,
      message: `Lusha has no record at domain "${domain}". 0 credits would be spent.`,
      debug: { attempts: dbg.attempts },
    });
  }

  const contactInfo = await prospectingContactProbe(company.id);
  return NextResponse.json({
    found: true,
    strategy: 'domain',
    domainTried: domain,
    lushaName: company.name,
    matchedVariant: domain,
    availableFields: {
      employee_count: !!company.size,
      location: !!company.location,
      contact_name: !!contactInfo?.found,
      email:        !!contactInfo?.found,
      phone:        !!contactInfo?.found,
    },
    matchedRole: contactInfo?.matchedRole ?? null,
    contactCount: contactInfo?.count ?? 0,
    contactDebug: (contactInfo as any)?.debug ?? null,
    message: contactInfo?.found
      ? `Lusha has "${company.name}" with at least one ${contactInfo.matchedRole}.`
      : `Lusha has "${company.name}" but no contact matches your role list.`,
  });
}
