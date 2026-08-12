'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Plus, Crosshair, Loader, MapPin } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button, Label, Badge, Alert } from '@/components/kit/primitives';
import type { ContactAddress } from '@/lib/types';
import 'leaflet/dist/leaflet.css';

/* =============================================================
   Sites on a map.

   Leaflet with OpenStreetMap tiles, and geocoding proxied through
   /api/geo so the provider can be swapped in one place. No API key is
   needed to run this, which is the whole reason for the choice; see
   docs/maps.md for when that stops being true.

   Leaflet is imported dynamically because it reaches for `window` at
   module scope and would break server rendering.
   ============================================================= */

type Pin = ContactAddress & { lat?: number | null; lng?: number | null };

// Bredbury, so an empty map opens over the yard rather than the Atlantic.
const HOME: [number, number] = [53.4225, -2.1289];

export function AddressMap({
  contactId, addresses, canEdit, onClose, onChanged,
}: {
  contactId: string;
  addresses: ContactAddress[];
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const supabase = useRef(createClient()).current;
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const markers = useRef<Map<string, any>>(new Map());
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  /** Save a pin, then rewrite the address from where it landed. */
  async function persist(id: string, lat: number, lng: number, rewriteAddress: boolean) {
    setBusy(true);
    let patch: any = { lat, lng, geo_source: 'manual', geo_updated_at: new Date().toISOString() };

    if (rewriteAddress) {
      const rev = await fetch(`/api/geo/reverse?lat=${lat}&lng=${lng}`).then((r) => r.json()).catch(() => null);
      if (rev?.address) { patch.address = rev.address; patch.city = rev.city ?? null; }
    }

    let { error } = await supabase.from('contact_addresses').update(patch).eq('id', id);
    // The geo columns only exist once migration 002 has run.
    if (error && /lat|lng|geo_source|geo_updated_at/.test(error.message)) {
      const { lat: _a, lng: _b, geo_source: _c, geo_updated_at: _d, ...rest } = patch;
      if (Object.keys(rest).length) await supabase.from('contact_addresses').update(rest).eq('id', id);
      setStatus('Pin position needs migration 002. The address text was still updated.');
    } else if (error) {
      setStatus(error.message);
    } else {
      setStatus('Saved');
      setTimeout(() => setStatus((s) => (s === 'Saved' ? null : s)), 1800);
    }
    setBusy(false);
    onChanged();
  }

  // ---- build the map once ----
  useEffect(() => {
    let killed = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (killed || !holder.current || map.current) return;

      const m = L.map(holder.current, { zoomControl: true, attributionControl: true }).setView(HOME, 9);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(m);
      map.current = m;
      setReady(true);
    })();
    return () => {
      killed = true;
      if (map.current) { map.current.remove(); map.current = null; }
    };
  }, []);

  // ---- put the sites on it ----
  useEffect(() => {
    if (!ready || !map.current) return;
    let killed = false;

    (async () => {
      const L = (await import('leaflet')).default;
      if (killed || !map.current) return;

      for (const mk of markers.current.values()) mk.remove();
      markers.current.clear();

      const bounds: [number, number][] = [];

      for (const a of addresses as Pin[]) {
        let lat = a.lat != null ? Number(a.lat) : null;
        let lng = a.lng != null ? Number(a.lng) : null;

        // No stored position, so look it up once from the written address.
        if ((lat == null || lng == null) && a.address?.trim()) {
          const hit = await fetch(`/api/geo/search?q=${encodeURIComponent(a.address.replace(/\n/g, ', '))}`)
            .then((r) => r.json()).catch(() => null);
          const first = hit?.results?.[0];
          if (first) {
            lat = first.lat; lng = first.lng;
            await supabase.from('contact_addresses')
              .update({ lat, lng, geo_source: 'geocoded', geo_updated_at: new Date().toISOString() })
              .eq('id', a.id).then(() => {}, () => {});
          }
        }
        if (lat == null || lng == null) continue;

        const marker = L.marker([lat, lng], {
          draggable: canEdit,
          icon: L.divIcon({
            className: '',
            html: pinHtml(a.is_primary, a.label),
            iconSize: [26, 34],
            iconAnchor: [13, 34],
          }),
        }).addTo(map.current);

        marker.on('click', () => setSelected(a.id));
        marker.on('dragend', async () => {
          const p = marker.getLatLng();
          setSelected(a.id);
          await persist(a.id, p.lat, p.lng, true);
        });

        markers.current.set(a.id, marker);
        bounds.push([lat, lng]);
      }

      if (bounds.length === 1) map.current.setView(bounds[0], 15);
      else if (bounds.length > 1) map.current.fitBounds(bounds, { padding: [50, 50] });
    })();

    return () => { killed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, addresses, canEdit]);

  // ---- click to drop a new site ----
  useEffect(() => {
    if (!ready || !map.current) return;
    const m = map.current;

    async function onClick(e: any) {
      if (!adding) return;
      setAdding(false);
      setBusy(true);
      const { lat, lng } = e.latlng;
      const rev = await fetch(`/api/geo/reverse?lat=${lat}&lng=${lng}`).then((r) => r.json()).catch(() => null);

      const payload: any = {
        contact_id: contactId,
        label: rev?.city ? `${rev.city} site` : 'New site',
        address: rev?.address ?? '',
        city: rev?.city ?? null,
        is_primary: addresses.length === 0,
        lat, lng, geo_source: 'manual', geo_updated_at: new Date().toISOString(),
      };
      let { error } = await supabase.from('contact_addresses').insert(payload);
      if (error && /lat|lng|geo_source|geo_updated_at/.test(error.message)) {
        const { lat: _a, lng: _b, geo_source: _c, geo_updated_at: _d, ...rest } = payload;
        ({ error } = await supabase.from('contact_addresses').insert(rest));
        setStatus('Site added. Run migration 002 to keep the pin position.');
      }
      if (error) setStatus(error.message);
      setBusy(false);
      onChanged();
    }

    m.on('click', onClick);
    m.getContainer().style.cursor = adding ? 'crosshair' : '';
    return () => { m.off('click', onClick); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, adding, addresses.length, contactId]);

  const positioned = (addresses as Pin[]).filter((a) => a.lat != null);

  return (
    <div className="kit" style={{
      position: 'fixed', inset: 0, zIndex: 950, display: 'flex',
      background: 'rgba(5, 13, 38, 0.55)',
    }} onClick={onClose}>
      {/* The panel sits left of the drawer, over a shaded CRM. */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          marginRight: 'min(660px, 100%)', flex: 1, minWidth: 0,
          display: 'flex', flexDirection: 'column',
          background: 'var(--bg)', borderRight: '1px solid var(--border)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '13px 18px', borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
        }}>
          <MapPin size={17} style={{ color: 'var(--accent)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 16,
              letterSpacing: '-0.02em', color: 'var(--text)',
            }}>Sites</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
              {positioned.length} of {addresses.length} placed
              {canEdit ? '. Drag a pin to correct it and the address rewrites itself.' : ''}
            </div>
          </div>
          {canEdit && (
            <Button variant={adding ? 'accent' : 'secondary'} onClick={() => setAdding((v) => !v)} disabled={busy}>
              {adding ? <Crosshair size={14} /> : <Plus size={14} />}
              {adding ? 'Click the map' : 'Add address'}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} aria-label="Close map">
            <X size={16} />
          </Button>
        </div>

        {(status || busy) && (
          <div style={{ padding: '10px 18px 0' }}>
            <Alert tone={status && status !== 'Saved' ? 'warning' : 'info'}>
              {busy ? <><Loader size={13} className="spin" /> Working</> : status}
            </Alert>
          </div>
        )}

        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          <div ref={holder} style={{ position: 'absolute', inset: 0 }} />
          {!ready && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
              justifyContent: 'center', color: 'var(--text-subtle)', fontSize: 13,
            }}>Loading the map</div>
          )}
        </div>

        {addresses.length > 0 && (
          <div style={{
            display: 'flex', gap: 8, padding: '10px 18px', flexWrap: 'wrap',
            borderTop: '1px solid var(--border)', background: 'var(--surface)',
          }}>
            {(addresses as Pin[]).map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  const mk = markers.current.get(a.id);
                  if (mk && map.current) { map.current.setView(mk.getLatLng(), 16); setSelected(a.id); }
                }}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  height: 28, padding: '0 11px', borderRadius: 'var(--r)',
                  border: `1px solid ${selected === a.id ? 'var(--border-emphasis)' : 'var(--border)'}`,
                  background: selected === a.id ? 'var(--bg-subtle)' : 'transparent',
                  color: a.lat != null ? 'var(--text)' : 'var(--text-subtle)',
                  fontSize: 12.5, cursor: 'pointer', fontFamily: 'var(--inter)',
                }}
              >
                {a.is_primary && <span style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--accent)' }} />}
                {a.label}
                {a.lat == null && <Badge tone="warning">not placed</Badge>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Pin drawn as markup so it uses kit colours and needs no image asset. */
function pinHtml(primary: boolean, label: string) {
  const fill = primary ? 'var(--accent)' : 'var(--navy-500, #3D5290)';
  return `
    <div style="position:relative;width:26px;height:34px;filter:drop-shadow(0 2px 3px rgba(9,22,58,.35))">
      <svg viewBox="0 0 26 34" width="26" height="34" aria-label="${label.replace(/"/g, '')}">
        <path d="M13 0C5.8 0 0 5.8 0 13c0 9.2 13 21 13 21s13-11.8 13-21C26 5.8 20.2 0 13 0z" fill="${fill}"/>
        <circle cx="13" cy="12.5" r="4.6" fill="#fff"/>
      </svg>
    </div>`;
}
