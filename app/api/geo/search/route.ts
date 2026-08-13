import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Address to coordinates.
 *
 * Proxied through the server rather than called from the browser for
 * three reasons: Nominatim requires an identifying User-Agent, it asks
 * for no more than one request a second, and going through here means
 * swapping to a paid geocoder later is a change to this file only.
 *
 * See docs/maps.md for the provider decision and what changes if the
 * volume outgrows the free tier.
 */
const UA = 'StockportTruckCentre-CRM/1.0 (internal tool; contact IT)';
const g = globalThis as any;

async function rateLimit() {
  const gap = 1100;
  const last = g.__geoLast ?? 0;
  const wait = Math.max(0, last + gap - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  g.__geoLast = Date.now();
}

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q) return NextResponse.json({ results: [] });

  g.__geoCache ??= new Map<string, any>();
  const key = q.toLowerCase();
  if (g.__geoCache.has(key)) return NextResponse.json(g.__geoCache.get(key));

  await rateLimit();
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('countrycodes', 'gb');
  url.searchParams.set('limit', '5');

  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store' });
    if (!res.ok) return NextResponse.json({ results: [], error: `geocoder ${res.status}` });
    const json = await res.json();
    const payload = {
      results: (json ?? []).map((r: any) => ({
        label: r.display_name,
        lat: Number(r.lat),
        lng: Number(r.lon),
        city: r.address?.city ?? r.address?.town ?? r.address?.village ?? r.address?.suburb ?? null,
        postcode: r.address?.postcode ?? null,
      })),
      attribution: '© OpenStreetMap contributors',
    };
    g.__geoCache.set(key, payload);
    return NextResponse.json(payload);
  } catch (e: any) {
    return NextResponse.json({ results: [], error: e.message });
  }
}
