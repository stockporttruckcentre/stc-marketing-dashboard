import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ENDPOINT = 'https://api.lusha.com/account/usage';
const CACHE_MS = 45_000; // refresh at most every 45 seconds (well within 5/min limit)

function sumRemaining(usage: any): number | null {
  if (!usage || typeof usage !== 'object') return null;
  let total = 0, found = false;
  for (const v of Object.values(usage)) {
    if (v && typeof v === 'object' && typeof (v as any).remaining === 'number') {
      total += (v as any).remaining;
      found = true;
    }
  }
  return found ? total : null;
}

// Keep cache between warm function invocations (new key 4f87)
const g = globalThis as any;

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const key = process.env.LUSHA_API_KEY;
  if (!key) return NextResponse.json({ error: 'LUSHA_API_KEY not set' }, { status: 500 });

  const now = Date.now();

  /* `?fresh=1` is the Refresh button on the finder, and it is honoured
     rather than obeyed.

     The cache exists because Lusha allows five requests a minute and a
     shared cache is what keeps everybody under it. A refresh that
     ignored it entirely would let one person holding the button take
     the whole allowance of REQUESTS, which is a different allowance
     from the credits and just as easy to exhaust.

     So a refresh shortens the window rather than removing it: after
     five seconds it asks again, and inside five seconds it hands back
     what it has. Nobody pressing a button twice notices the
     difference, and the limit cannot be reached by pressing it. */
  const fresh = req.nextUrl.searchParams.get('fresh') === '1';
  const window = fresh ? 5_000 : CACHE_MS;

  if (g.__lushaCache && now - g.__lushaCache.t < window) {
    return NextResponse.json({ balance: g.__lushaCache.balance, breakdown: g.__lushaCache.breakdown, cached: true });
  }

  try {
    const res = await fetch(ENDPOINT, { headers: { api_key: key }, cache: 'no-store' });
    const json = await res.json().catch(() => null);
    if (res.status === 429) {
      // Rate limited - return stale cache if we have one rather than '—'
      if (g.__lushaCache) {
        return NextResponse.json({ balance: g.__lushaCache.balance, breakdown: g.__lushaCache.breakdown, cached: true, stale: true, rateLimited: true });
      }
      return NextResponse.json({ balance: null, error: 'Rate limited - retrying soon' }, { status: 429 });
    }
    if (!res.ok) {
      return NextResponse.json({ balance: null, error: `Lusha ${res.status}`, raw: json }, { status: 502 });
    }
    const balance = sumRemaining(json?.usage);
    if (balance == null) {
      return NextResponse.json({ balance: null, error: 'No remaining credits field in response', raw: json }, { status: 502 });
    }
    g.__lushaCache = { t: now, balance, breakdown: json?.usage };
    return NextResponse.json({ balance, breakdown: json?.usage });
  } catch (e: any) {
    // Network/transient error: return cached if available
    if (g.__lushaCache) {
      return NextResponse.json({ balance: g.__lushaCache.balance, breakdown: g.__lushaCache.breakdown, cached: true, stale: true, error: e.message });
    }
    return NextResponse.json({ balance: null, error: e.message || 'fetch failed' }, { status: 502 });
  }
}
