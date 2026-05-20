import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Lusha account usage endpoint (confirmed via docs.lusha.com/apis/openapi/account-management).
// Response shape: { usage: { bulkCredits: { total, used, remaining }, ... } }
// Rate limit: 5 requests / minute.
const ENDPOINT = 'https://api.lusha.com/account/usage';

function sumRemaining(usage: any): number | null {
  if (!usage || typeof usage !== 'object') return null;
  // Sum 'remaining' across all credit types (bulkCredits, contactCredits, etc.)
  let total = 0;
  let found = false;
  for (const v of Object.values(usage)) {
    if (v && typeof v === 'object' && typeof (v as any).remaining === 'number') {
      total += (v as any).remaining;
      found = true;
    }
  }
  return found ? total : null;
}

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const key = process.env.LUSHA_API_KEY;
  if (!key) return NextResponse.json({ error: 'LUSHA_API_KEY not set' }, { status: 500 });

  try {
    const res = await fetch(ENDPOINT, { headers: { api_key: key }, cache: 'no-store' });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      return NextResponse.json({ balance: null, error: `Lusha ${res.status}`, raw: json }, { status: 502 });
    }
    const balance = sumRemaining(json?.usage);
    if (balance == null) {
      return NextResponse.json({ balance: null, error: 'No remaining credits field in response', raw: json }, { status: 502 });
    }
    // Return breakdown for the tooltip too
    return NextResponse.json({ balance, breakdown: json?.usage });
  } catch (e: any) {
    return NextResponse.json({ balance: null, error: e.message || 'fetch failed' }, { status: 502 });
  }
}
