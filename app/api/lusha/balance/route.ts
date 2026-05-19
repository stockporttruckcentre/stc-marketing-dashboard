import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Lusha credit endpoints we'll try in order. Different plans expose different ones.
const ENDPOINTS = [
  'https://api.lusha.com/usage',
  'https://api.lusha.com/v2/account/credits',
  'https://api.lusha.com/v2/credits/me',
  'https://api.lusha.com/credits',
];

function extractBalance(json: any): number | null {
  if (!json || typeof json !== 'object') return null;
  // Try a bunch of common shapes
  const candidates = [
    json.balance,
    json.credits,
    json.remaining,
    json.creditsRemaining,
    json.credits_remaining,
    json.data?.balance,
    json.data?.credits,
    json.data?.remaining,
    json.account?.credits,
    json.account?.balance,
    json.usage?.remaining,
    json.subscription?.credits,
  ];
  for (const v of candidates) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const key = process.env.LUSHA_API_KEY;
  if (!key) return NextResponse.json({ error: 'LUSHA_API_KEY not set' }, { status: 500 });

  const tried: { url: string; status: number; sample?: any }[] = [];
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, { headers: { api_key: key }, cache: 'no-store' });
      let json: any = null;
      try { json = await res.json(); } catch {}
      tried.push({ url, status: res.status, sample: res.ok ? json : undefined });
      if (!res.ok) continue;
      const balance = extractBalance(json);
      if (balance != null) return NextResponse.json({ balance, source: url });
    } catch (e: any) {
      tried.push({ url, status: -1, sample: e.message });
    }
  }

  // None worked — return a debug response so we can see what Lusha actually exposes for your plan
  return NextResponse.json({ balance: null, error: 'Could not detect balance', tried }, { status: 502 });
}
