import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { searchCompanies } from '@/lib/lusha';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  let raw: any = null;
  try {
    raw = await searchCompanies({
      location: body.location,
      radiusMiles: body.radiusMiles,
      industry: body.industry,
      minEmployees: body.minEmployees,
      maxEmployees: body.maxEmployees,
      limit: body.limit ?? 25,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Lusha error' }, { status: 502 });
  }

  // Lusha returns a list under data[] or companies[] depending on endpoint version
  const companies = (raw?.data ?? raw?.companies ?? []).map((c: any) => ({
    name: c.name ?? c.companyName ?? '—',
    employees: c.employees ?? c.companySize ?? null,
    location: c.location?.city ?? c.city ?? c.location ?? '',
    distance: c.distanceMiles ?? null,
    domain: c.website ?? c.domain ?? null,
    industry: c.industry ?? null,
  }));

  // Cost: 1 credit per result returned (Lusha company search billing is per-result)
  const cost = companies.length;
  const { data: credit } = await supabase.from('lusha_credits').select('id, balance').limit(1).single();
  if (credit) {
    await supabase
      .from('lusha_credits')
      .update({ balance: Math.max(0, credit.balance - cost), updated_at: new Date().toISOString() })
      .eq('id', credit.id);
  }

  return NextResponse.json({ companies, cost });
}
