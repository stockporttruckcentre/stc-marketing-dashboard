import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Coordinates to address, used when a pin is dragged.
 *
 * Same proxy reasoning as the search route: identifying User-Agent, one
 * request a second, and one place to change when the geocoder changes.
 */
const UA = 'StockportTruckCentre-CRM/1.0 (internal tool; contact IT)';
const g = globalThis as any;

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const lat = Number(req.nextUrl.searchParams.get('lat'));
  const lng = Number(req.nextUrl.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'lat and lng required' }, { status: 400 });
  }

  const last = g.__geoLast ?? 0;
  const wait = Math.max(0, last + 1100 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  g.__geoLast = Date.now();

  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lng));
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');

  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store' });
    if (!res.ok) return NextResponse.json({ error: `geocoder ${res.status}` });
    const r = await res.json();
    const a = r.address ?? {};
    // Rebuild it the way a UK address is actually written.
    const lines = [
      [a.house_number, a.road].filter(Boolean).join(' '),
      a.neighbourhood ?? a.suburb ?? null,
      a.town ?? a.city ?? a.village ?? null,
      a.county ?? null,
      a.postcode ?? null,
    ].filter(Boolean);
    return NextResponse.json({
      address: lines.join('\n'),
      city: a.city ?? a.town ?? a.village ?? a.suburb ?? null,
      postcode: a.postcode ?? null,
      label: r.display_name,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message });
  }
}
