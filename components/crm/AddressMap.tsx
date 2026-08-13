'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Plus, Crosshair, Loader, MapPin, AlertTriangle,
  Undo2, Redo2, Star, Trash2, LocateFixed,
} from 'lucide-react';
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

   The whole panel goes through a portal to document.body, and that is
   not a stylistic choice. `.main` in globals.css is `position: relative;
   z-index: 1` and `.sidebar` is `z-index: 2`, so `.main` opens a
   stacking context that everything inside it is trapped in. A child of
   it painted at z-index 950 still sits below a sibling of `.main` at 2,
   and no amount of raising the number fixes that. The drawer gets away
   with it because it hugs the right edge and never overlaps the nav.
   This panel starts at the left edge, so it went straight under it.
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

  /**
   * Coordinates worked out for addresses that were saved as text only.
   *
   * Held here rather than resolved inside the marker effect. That effect
   * re-runs whenever the address list changes, and it used to do the
   * geocoding inline: a lookup takes over a second because the proxy
   * rate limits itself, so any re-render during that window killed the
   * run and the pin never appeared. Nothing an address typed into the
   * drawer was ever going to survive.
   *
   * Keyed by address id, so a lookup happens once and then it is a fact
   * the markers can be drawn from as many times as needed.
   */
  const [resolved, setResolved] = useState<Record<string, { lat: number; lng: number }>>({});
  /** Screen position of the selected pin, so its card can follow it. */
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [locating, setLocating] = useState(false);

  /**
   * Moving a pin changes two things: where it is, and what the address
   * says, because a drag reverse geocodes and rewrites the text. So undo
   * has to restore both, which means a move is recorded as a before and
   * an after of the whole site rather than a pair of coordinates.
   */
  type Snapshot = { lat: number | null; lng: number | null; address: string; city: string | null };
  type Move = { id: string; label: string; from: Snapshot; to: Snapshot };

  const [past, setPast] = useState<Move[]>([]);
  const [future, setFuture] = useState<Move[]>([]);
  const dragFrom = useRef<Snapshot | null>(null);

  function snapshotOf(a: Pin): Snapshot {
    const at = coordsOf(a);
    return { lat: at?.lat ?? null, lng: at?.lng ?? null, address: a.address ?? '', city: a.city ?? null };
  }

  /** Write a whole snapshot back, degrading if migration 002 has not run. */
  async function writeSnapshot(id: string, snap: Snapshot, note?: string) {
    setBusy(true);
    const patch: any = {
      lat: snap.lat, lng: snap.lng,
      geo_source: 'manual', geo_updated_at: new Date().toISOString(),
      address: snap.address, city: snap.city,
    };

    let { error } = await supabase.from('contact_addresses').update(patch).eq('id', id);
    if (error && /lat|lng|geo_source|geo_updated_at/.test(error.message)) {
      const { lat: _a, lng: _b, geo_source: _c, geo_updated_at: _d, ...rest } = patch;
      await supabase.from('contact_addresses').update(rest).eq('id', id);
      setStatus('Pin positions need migration 002. The address text was still saved.');
    } else if (error) {
      setStatus(error.message);
    } else {
      setStatus(note ?? 'Saved');
      setTimeout(() => setStatus((x) => (x === (note ?? 'Saved') ? null : x)), 1800);
    }

    if (snap.lat != null && snap.lng != null) {
      setResolved((r) => ({ ...r, [id]: { lat: snap.lat as number, lng: snap.lng as number } }));
    }
    setBusy(false);
    onChanged();
  }

  /** Where a dragged pin ended up, with the address rewritten to match. */
  async function snapshotAt(lat: number, lng: number, fallback: Snapshot): Promise<Snapshot> {
    const rev = await fetch(`/api/geo/reverse?lat=${lat}&lng=${lng}`).then((r) => r.json()).catch(() => null);
    return {
      lat, lng,
      address: rev?.address ?? fallback.address,
      city: rev?.city ?? fallback.city,
    };
  }

  async function undo() {
    const move = past[past.length - 1];
    if (!move) return;
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [...f, move]);
    await writeSnapshot(move.id, move.from, `Put ${move.label} back`);
  }

  async function redo() {
    const move = future[future.length - 1];
    if (!move) return;
    setFuture((f) => f.slice(0, -1));
    setPast((p) => [...p, move]);
    await writeSnapshot(move.id, move.to, `Moved ${move.label} again`);
  }

  // Ctrl+Z and Ctrl+Shift+Z, because on a map that is what hands expect.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [past, future]);

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

  /**
   * Find anything that has no position yet.
   *
   * Tried longest first: the whole address, then the last two lines,
   * then just the town. A geocoder that cannot find "Unit 4, Meadow
   * Industrial Estate, Bredbury" will usually still find "Bredbury",
   * and a pin in the right town beats no pin at all.
   */
  useEffect(() => {
    const missing = (addresses as Pin[]).filter(
      (a) => a.lat == null && !resolved[a.id] && !failed.includes(a.id) && (a.address?.trim() || a.city?.trim()),
    );
    if (!missing.length) return;

    let killed = false;
    (async () => {
      setLocating(true);
      for (const a of missing) {
        const lines = (a.address ?? '').split(/\n|,/).map((s) => s.trim()).filter(Boolean);
        const attempts = [
          lines.join(', '),
          lines.slice(-2).join(', '),
          a.city?.trim() ?? lines[lines.length - 1] ?? '',
        ].filter((q, i, all) => q && all.indexOf(q) === i);

        let hit: { lat: number; lng: number } | null = null;
        for (const q of attempts) {
          const res = await fetch(`/api/geo/search?q=${encodeURIComponent(q)}`)
            .then((r) => r.json()).catch(() => null);
          const first = res?.results?.[0];
          if (first && Number.isFinite(first.lat) && Number.isFinite(first.lng)) {
            hit = { lat: Number(first.lat), lng: Number(first.lng) };
            break;
          }
        }
        if (killed) return;

        if (hit) {
          setResolved((r) => ({ ...r, [a.id]: hit! }));
          // Best effort. The columns only exist once migration 002 has
          // run, and the pin is already on screen either way.
          supabase.from('contact_addresses')
            .update({ ...hit, geo_source: 'geocoded', geo_updated_at: new Date().toISOString() })
            .eq('id', a.id).then(() => {}, () => {});
        } else {
          setFailed((f) => (f.includes(a.id) ? f : [...f, a.id]));
        }
      }
      if (!killed) setLocating(false);
    })();

    return () => { killed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addresses]);

  /** Where a site actually is: stored, or worked out since. */
  function coordsOf(a: Pin): { lat: number; lng: number } | null {
    if (a.lat != null && a.lng != null) return { lat: Number(a.lat), lng: Number(a.lng) };
    return resolved[a.id] ?? null;
  }

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
        const at = coordsOf(a);
        if (!at) continue;

        const marker = L.marker([at.lat, at.lng], {
          draggable: canEdit,
          icon: L.divIcon({
            className: '',
            html: pinHtml(a.is_primary, a.label),
            iconSize: [26, 34],
            iconAnchor: [13, 34],
          }),
        }).addTo(map.current);

        marker.on('click', () => setSelected(a.id));
        marker.on('dragstart', () => { dragFrom.current = snapshotOf(a); });
        marker.on('dragend', async () => {
          const p = marker.getLatLng();
          setSelected(a.id);
          const from = dragFrom.current ?? snapshotOf(a);
          const to = await snapshotAt(p.lat, p.lng, from);
          // A dragged pin is the truth from now on, whatever the
          // geocoder originally thought.
          setPast((h) => [...h, { id: a.id, label: a.label, from, to }]);
          // A new move ends any forward history, which is how undo stacks
          // work everywhere else and is the only behaviour that is not
          // surprising.
          setFuture([]);
          await writeSnapshot(a.id, to, `Moved ${a.label}`);
        });

        markers.current.set(a.id, marker);
        bounds.push([at.lat, at.lng]);
      }

      if (bounds.length === 1) map.current.setView(bounds[0], 15);
      else if (bounds.length > 1) map.current.fitBounds(bounds, { padding: [50, 50] });
    })();

    return () => { killed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, addresses, resolved, canEdit]);

  // ---- click to drop a new site ----
  useEffect(() => {
    if (!ready || !map.current) return;
    const m = map.current;

    async function onClick(e: any) {
      // A click on open water closes whatever card is open, which is what
      // clicking away from a thing does everywhere else.
      if (!adding) { setSelected(null); return; }
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


  /**
   * Keep the selected pin's card over its pin.
   *
   * A Leaflet popup would be less code and would fight the kit for every
   * colour, corner and font. Positioning our own card from the map's own
   * projection keeps it a normal React component, so it can use the same
   * buttons as everything else.
   */
  useEffect(() => {
    if (!ready || !map.current) return;
    const m = map.current;

    function place() {
      const a = (addresses as Pin[]).find((x) => x.id === selected);
      const at = a ? coordsOf(a) : null;
      if (!at) { setAnchor(null); return; }
      const p = m.latLngToContainerPoint([at.lat, at.lng]);
      setAnchor({ x: p.x, y: p.y });
    }

    place();
    m.on('move zoom resize', place);
    return () => { m.off('move zoom resize', place); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selected, addresses, resolved]);

  const selectedSite = (addresses as Pin[]).find((a) => a.id === selected) ?? null;

  /** Make this the primary site, which is the one the record shows. */
  async function makePrimary(id: string) {
    setBusy(true);
    await supabase.from('contact_addresses').update({ is_primary: false }).eq('contact_id', contactId);
    const { error } = await supabase.from('contact_addresses').update({ is_primary: true }).eq('id', id);
    setStatus(error ? error.message : 'Primary site changed');
    setBusy(false);
    onChanged();
  }

  async function removeSite(id: string, label: string) {
    if (!confirm(`Remove ${label}? The site and its pin go with it.`)) return;
    setBusy(true);
    const { error } = await supabase.from('contact_addresses').delete().eq('id', id);
    if (error) setStatus(error.message);
    else { setStatus(`Removed ${label}`); setSelected(null); }
    setBusy(false);
    onChanged();
  }

  /** Snap a pin back onto whatever its written address resolves to. */
  async function reGeocode(a: Pin) {
    setBusy(true);
    const q = (a.address ?? '').split(/\n|,/).map((x) => x.trim()).filter(Boolean).join(', ');
    const res = await fetch(`/api/geo/search?q=${encodeURIComponent(q)}`).then((r) => r.json()).catch(() => null);
    const first = res?.results?.[0];
    setBusy(false);
    if (!first) { setStatus('That address still cannot be found. Drag the pin instead.'); return; }
    const from = snapshotOf(a);
    const to: Snapshot = { lat: Number(first.lat), lng: Number(first.lng), address: a.address ?? '', city: a.city ?? null };
    setPast((h) => [...h, { id: a.id, label: a.label, from, to }]);
    setFuture([]);
    await writeSnapshot(a.id, to, `Moved ${a.label} to its address`);
  }

  const positioned = (addresses as Pin[]).filter((a) => coordsOf(a) !== null);

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  return createPortal(
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
              {locating
                ? 'Looking up where these addresses are'
                : `${positioned.length} of ${addresses.length} placed`}
              {!locating && canEdit ? '. Click a pin for its options.' : ''}
            </div>
          </div>
          {canEdit && (
            <div style={{
              display: 'inline-flex', alignItems: 'center',
              border: '1px solid var(--border-strong)', borderRadius: 'var(--r)',
              overflow: 'hidden', background: 'var(--surface)',
            }}>
              <IconAction
                label={past.length ? `Undo moving ${past[past.length - 1].label}` : 'Nothing to undo'}
                onClick={undo} disabled={busy || past.length === 0}
              ><Undo2 size={14} /></IconAction>
              <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)' }} />
              <IconAction
                label={future.length ? `Redo moving ${future[future.length - 1].label}` : 'Nothing to redo'}
                onClick={redo} disabled={busy || future.length === 0}
              ><Redo2 size={14} /></IconAction>
            </div>
          )}
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

        {/* Say so, rather than leaving somebody staring at an empty map
            wondering whether it is broken or their address is. */}
        {!locating && failed.length > 0 && (
          <div style={{ padding: '10px 18px 0' }}>
            <Alert tone="warning">
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>
                  {failed.length === 1 ? 'One site could not be placed' : `${failed.length} sites could not be placed`}
                  {' from what is written on the record: '}
                  <strong>
                    {failed.map((id) => addresses.find((a) => a.id === id)?.label).filter(Boolean).join(', ')}
                  </strong>.
                  {canEdit
                    ? ' Press Add address and click where it should be, or correct the address on the record.'
                    : ' The address may need correcting on the record.'}
                </span>
              </div>
            </Alert>
          </div>
        )}

        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          <div ref={holder} style={{ position: 'absolute', inset: 0 }} />

          {selectedSite && anchor && (
            <PinCard
              site={selectedSite}
              x={anchor.x}
              y={anchor.y}
              canEdit={canEdit}
              busy={busy}
              onClose={() => setSelected(null)}
              onPrimary={() => makePrimary(selectedSite.id)}
              onRemove={() => removeSite(selectedSite.id, selectedSite.label)}
              onSnapToAddress={() => reGeocode(selectedSite)}
            />
          )}
          {!ready && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
              justifyContent: 'center', color: 'var(--text-subtle)', fontSize: 13,
            }}>Loading the map</div>
          )}
        </div>

        {addresses.length > 0 && (
          <div style={{
            padding: '11px 18px 13px',
            borderTop: '1px solid var(--border)', background: 'var(--surface)',
          }}>
            {/* This row was a line of quiet outlines that people scanned
                straight past. It is the fastest way to get to a site, so
                it says what it is and the buttons look like buttons. */}
            <div style={{
              fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 11,
              letterSpacing: '0.13em', textTransform: 'uppercase',
              color: 'var(--text-subtle)', marginBottom: 8,
            }}>Jump to a site</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(addresses as Pin[]).map((a) => {
                const on = selected === a.id;
                const placed = coordsOf(a) !== null;
                return (
                  <button
                    key={a.id}
                    disabled={!placed}
                    onClick={() => {
                      const at = coordsOf(a);
                      if (at && map.current) { map.current.setView([at.lat, at.lng], 16); setSelected(a.id); }
                    }}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                      height: 34, padding: '0 13px', borderRadius: 'var(--r)',
                      cursor: placed ? 'pointer' : 'not-allowed',
                      border: `1px solid ${on ? 'var(--primary)' : 'var(--border-strong)'}`,
                      background: on ? 'var(--primary)' : 'var(--bg-subtle)',
                      color: on ? 'var(--primary-fg)' : placed ? 'var(--text)' : 'var(--text-subtle)',
                      opacity: placed ? 1 : 0.6,
                      fontFamily: 'var(--inter)', fontSize: 13, fontWeight: 600,
                      letterSpacing: '-0.01em',
                    }}
                  >
                    <MapPin size={13} style={{ color: a.is_primary && !on ? 'var(--accent)' : 'currentColor' }} />
                    {a.label}
                    {a.is_primary && (
                      <span style={{
                        fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
                        color: on ? 'rgba(255,255,255,0.75)' : 'var(--text-subtle)',
                      }}>Primary</span>
                    )}
                    {!placed && <Badge tone="warning">not placed</Badge>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** A square control for a paired action, where a label would be noise. */
function IconAction({ label, onClick, disabled, children }: {
  label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 30, height: 30, border: 'none', background: 'transparent',
        color: disabled ? 'var(--text-subtle)' : 'var(--text)',
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >{children}</button>
  );
}

/* =============================================================
   The card over a selected pin.

   Positioned from the map's own projection rather than being a Leaflet
   popup. A popup would be less code and would then need every colour,
   corner, font and shadow fighting back out of Leaflet's stylesheet.
   This is an ordinary React component, so it uses the same buttons as
   the rest of the product.

   It flips below the pin when there is no room above, which happens as
   soon as somebody zooms into a site near the top of the panel.
   ============================================================= */
function PinCard({ site, x, y, canEdit, busy, onClose, onPrimary, onRemove, onSnapToAddress }: {
  site: Pin;
  x: number; y: number;
  canEdit: boolean;
  busy: boolean;
  onClose: () => void;
  onPrimary: () => void;
  onRemove: () => void;
  onSnapToAddress: () => void;
}) {
  const WIDTH = 260;
  const below = y < 220;
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: Math.max(8, x - WIDTH / 2),
        top: below ? y + 12 : undefined,
        bottom: below ? undefined : `calc(100% - ${y - 40}px)`,
        width: WIDTH, zIndex: 500,
        background: 'var(--surface-raised)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-3)', overflow: 'hidden',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 8,
        padding: '11px 12px 9px', borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 14,
              letterSpacing: '-0.02em', color: 'var(--text)',
            }}>{site.label}</span>
            {site.is_primary && <Badge tone="accent">Primary</Badge>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 3, lineHeight: 1.45 }}>
            {site.address?.trim() || 'No address written down'}
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" style={{
          border: 'none', background: 'transparent', color: 'var(--text-subtle)',
          cursor: 'pointer', display: 'flex', padding: 2,
        }}><X size={14} /></button>
      </div>

      {canEdit ? (
        <div style={{ display: 'flex', flexDirection: 'column', padding: 5 }}>
          {!site.is_primary && (
            <CardAction icon={<Star size={13} />} label="Make this the primary site" onClick={onPrimary} disabled={busy} />
          )}
          <CardAction
            icon={<LocateFixed size={13} />}
            label="Snap back to the address"
            onClick={onSnapToAddress}
            disabled={busy || !site.address?.trim()}
          />
          <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
          <CardAction icon={<Trash2 size={13} />} label="Remove this site" onClick={onRemove} disabled={busy} danger />
          <div style={{ padding: '6px 8px 4px', fontSize: 11, color: 'var(--text-subtle)', lineHeight: 1.45 }}>
            Drag the pin to move it. The address rewrites itself, and undo puts both back.
          </div>
        </div>
      ) : (
        <div style={{ padding: '9px 12px', fontSize: 12, color: 'var(--text-subtle)' }}>
          You do not have permission to change sites on this record.
        </div>
      )}
    </div>
  );
}

function CardAction({ icon, label, onClick, disabled, danger }: {
  icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
        border: 'none', background: 'transparent', padding: '7px 8px',
        borderRadius: 'var(--r-sm)', fontFamily: 'var(--inter)', fontSize: 13,
        color: disabled ? 'var(--text-subtle)' : danger ? 'var(--danger)' : 'var(--text)',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'var(--surface-sunken)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ display: 'flex', flexShrink: 0, opacity: 0.8 }}>{icon}</span>
      {label}
    </button>
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
