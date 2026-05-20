import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { searchCompanies } from '@/lib/lusha';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  // Accept either a single id, array of ids, or string for back-compat
  let industryIds: number[] | undefined;
  if (Array.isArray(body.industryIds)) {
    industryIds = body.industryIds.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n));
  } else if (body.industryId != null) {
    const n = Number(body.industryId);
    if (Number.isFinite(n)) industryIds = [n];
  }

  let raw: any = null;
  try {
    raw = await searchCompanies({
      location: body.location,
      radiusMiles: body.radiusMiles,
      industryIds,
      minEmployees: body.minEmployees,
      maxEmployees: body.maxEmployees,
      limit: body.limit ?? 25,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Lusha error' }, { status: 502 });
  }

  const companies = (raw?.data ?? raw?.companies ?? []).map((c: any) => ({
    name: c.name ?? c.companyName ?? '—',
    employees: c.employees ?? c.companySize ?? null,
    location: c.location?.city ?? c.city ?? c.location ?? '',
    distance: c.distanceMiles ?? null,
    domain: c.website ?? c.domain ?? null,
    industry: c.industry ?? null,
  }));

  return NextResponse.json({ companies });
}
