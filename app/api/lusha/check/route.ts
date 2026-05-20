import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { findLushaCompany, findLushaCompanyDebug, prospectingContactProbe } from '@/lib/lusha';

export const dynamic = 'force-dynamic';

/**
 * Pre-flight check for the enrich modal. Uses ONLY free endpoints:
 *   - /prospecting/company/search  (free)  – does Lusha have this company?
 *   - /prospecting/contact/search  (free)  – do they have a relevant contact?
 *
 * Returns which fields will actually populate so the UI can disable the rest.
 * Cost: 0 credits. Burns a few daily calls only.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { company_name?: string; email?: string };
  const companyName = (body.company_name || '').trim();
  const email = (body.email || '').trim();

  // Email-based enrichment can't be pre-checked without burning a credit on /v2/person.
  if (email) {
    return NextResponse.json({
      found: true,
      strategy: 'email',
      lushaName: null,
      availableFields: { contact_name: true, email: true, phone: true, employee_count: true, location: true },
      message: `Will look up by email: ${email}`,
    });
  }

  if (!companyName) {
    return NextResponse.json({ found: false, strategy: 'none', message: 'No email or company name on this row.' });
  }

  // Step 1: free company search with progressive variants - use debug version so we can see
  // exactly what Lusha returned when nothing matched (helps diagnose filter-shape mismatches).
  const dbg = await findLushaCompanyDebug(companyName);
  const company = dbg.match;
  if (!company) {
    return NextResponse.json({
      found: false,
      strategy: 'company',
      message: `Lusha has no record matching "${companyName}". 0 credits would be spent.`,
      debug: { attempts: dbg.attempts },
    });
  }

  // Step 2: probe for contacts using free /prospecting/contact/search with our role cascade.
  // Reports which role tier matched (if any) so the UI can say "found Sales Director" etc.
  const contactInfo = await prospectingContactProbe(company.id);

  return NextResponse.json({
    found: true,
    strategy: 'company',
    lushaName: company.name,
    matchedVariant: company.matchedVariant,
    availableFields: {
      // Company-level fields are present iff Lusha returned that data
      employee_count: !!company.size,
      location: !!company.location,
      // Contact-level fields come only if a contact was found
      contact_name: !!contactInfo?.found,
      email:        !!contactInfo?.found,
      phone:        !!contactInfo?.found, // phone-specifically isn't guaranteed, but probable when person exists
    },
    matchedRole: contactInfo?.matchedRole ?? null,
    contactCount: contactInfo?.count ?? 0,
    message: contactInfo?.found
      ? `Lusha has "${company.name}" with at least one ${contactInfo.matchedRole} contact.`
      : `Lusha has "${company.name}" but no contact matches your role list.`,
  });
}
