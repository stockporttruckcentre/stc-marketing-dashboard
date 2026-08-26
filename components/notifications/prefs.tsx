'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellOff, Lock, RotateCcw } from 'lucide-react';
import {
  CATEGORIES, type NotificationChoice, type NotificationSettings,
} from '@/lib/notifications/types';
import { Alert, Badge, Button, Label } from '@/components/kit/primitives';
import { Select, Switch } from '@/components/kit/forms';
import { useToast } from '@/components/kit/toast';

/* =============================================================
   What you get told.

   Recreated from the settings layout in
   `design-system/reference/06-patterns.html`: a 190px rail down the
   left with a 2px accent marker on whichever section is open, and the
   rows on the right as label, hint, switch, separated by a rule rather
   than by cards.

   ---- Why switches and not checkboxes ----

   The kit is explicit: a switch takes effect the moment it moves, and
   anything needing a Save button is a checkbox. There is nothing to
   save here. Every toggle is one row written to `notification_prefs`,
   and a Save button over thirty of them is a way to lose twenty nine
   changes by navigating away.

   ---- Why the list is not in this file ----

   It comes from `notification_choices`, which is the catalogue in the
   database joined to this person's preferences and filtered by what
   they hold. So a kind added to the catalogue turns up here on its
   own, and a viewer never sees a toggle for approving posts they
   cannot approve.
   ============================================================= */

export function NotificationPrefs() {
  const { say } = useToast();
  const [choices, setChoices] = useState<NotificationChoice[]>([]);
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [section, setSection] = useState<string>('diary');
  const [loading, setLoading] = useState(true);
  const [provisioned, setProvisioned] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch('/api/notifications/settings', { cache: 'no-store' });
    const json = await res.json();
    setLoading(false);
    if (!json.ok) return;
    setProvisioned(json.provisioned !== false);
    setChoices(json.choices ?? []);
    setSettings(json.settings ?? null);
  }, []);

  useEffect(() => { load(); }, [load]);

  const byCategory = useMemo(() => {
    const map = new Map<string, NotificationChoice[]>();
    for (const c of choices) {
      const list = map.get(c.category) ?? [];
      list.push(c);
      map.set(c.category, list);
    }
    return map;
  }, [choices]);

  /* Only the groups this person actually has anything in. A rail with
     three empty sections is a rail that makes somebody click through
     three empty sections. */
  const rail = useMemo(
    () => CATEGORIES.filter((c) => (byCategory.get(c.key)?.length ?? 0) > 0),
    [byCategory],
  );

  useEffect(() => {
    if (rail.length > 0 && !rail.some((r) => r.key === section)) setSection(rail[0].key);
  }, [rail, section]);

  const setKind = useCallback(async (kind: string, enabled: boolean) => {
    setChoices((cs) => cs.map((c) => (c.key === kind ? { ...c, enabled, is_default: false } : c)));
    const res = await fetch('/api/notifications/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ do: 'kind', kind, enabled }),
    });
    const json = await res.json();
    if (!json.ok) {
      say({ tone: 'danger', title: 'That did not save', body: json.message });
      load();
    }
  }, [load, say]);

  const setCategory = useCallback(async (category: string, enabled: boolean) => {
    setChoices((cs) => cs.map((c) => (
      c.category === category && c.may_mute ? { ...c, enabled, is_default: false } : c
    )));
    await fetch('/api/notifications/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ do: 'category', category, enabled }),
    });
  }, []);

  const saveSettings = useCallback(async (patch: Partial<NotificationSettings>) => {
    const next = { ...(settings ?? { quiet_from: 0, quiet_to: 0, bundle_minutes: 10, muted_until: null }), ...patch };
    setSettings(next);
    await fetch('/api/notifications/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        do: 'settings',
        quietFrom: next.quiet_from, quietTo: next.quiet_to,
        bundleMinutes: next.bundle_minutes,
      }),
    });
  }, [settings]);

  const mute = useCallback(async (hours: number | null) => {
    const res = await fetch('/api/notifications/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ do: 'mute', muteHours: hours }),
    });
    const json = await res.json();
    if (json.ok) {
      setSettings(json.settings);
      say(hours
        ? { tone: 'success', title: `Quiet for ${hours === 24 ? 'a day' : `${hours} hours`}`, body: 'Nothing will come through until then.' }
        : { tone: 'success', title: 'Back on', body: 'Notifications are coming through again.' });
    }
  }, [say]);

  if (loading) {
    return <div style={{ fontSize: 13, color: 'var(--text-subtle)' }}>Looking.</div>;
  }

  if (!provisioned) {
    return (
      <Alert tone="warning">
        The notification tables are not in this database yet. Run migrations 065 and 066.
      </Alert>
    );
  }

  const here = byCategory.get(section) ?? [];
  const meta = CATEGORIES.find((c) => c.key === section);
  const allOn = here.filter((c) => c.may_mute).every((c) => c.enabled);
  const muted = settings?.muted_until != null && new Date(settings.muted_until) > new Date();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {muted && (
        <Alert tone="warning">
          <BellOff size={13} />
          <span style={{ flex: 1 }}>
            Everything is muted until {new Date(settings!.muted_until!).toLocaleString('en-GB', {
              weekday: 'short', hour: '2-digit', minute: '2-digit',
            })}. The ones that cannot be turned off still come through.
          </span>
          <Button size="sm" variant="secondary" onClick={() => mute(null)}>
            <RotateCcw size={13} /> Turn it back on
          </Button>
        </Alert>
      )}

      {/* ---- the rail and the panel ---- */}
      <div style={{
        display: 'flex', minHeight: 320,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)', overflow: 'hidden',
      }}>
        <div style={{
          flex: 'none', width: 190, borderRight: '1px solid var(--border)',
          padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 1,
        }}>
          {rail.map((c) => {
            const on = c.key === section;
            const off = (byCategory.get(c.key) ?? []).filter((k) => k.may_mute && !k.enabled).length;
            return (
              <button
                key={c.key}
                onClick={() => setSection(c.key)}
                style={{
                  position: 'relative', textAlign: 'left', border: 'none',
                  padding: '7px 11px', borderRadius: 'var(--r)',
                  fontFamily: 'var(--inter)', fontSize: 12.5,
                  fontWeight: on ? 600 : 500,
                  color: on ? 'var(--text)' : 'var(--text-subtle)',
                  background: on ? 'var(--bg-subtle)' : 'transparent',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}
              >
                {on && (
                  <span style={{
                    position: 'absolute', left: 0, top: 7, bottom: 7, width: 2,
                    borderRadius: 1, background: 'var(--accent)',
                  }} />
                )}
                <span style={{ flex: 1 }}>{c.label}</span>
                {off > 0 && (
                  <span style={{
                    fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10,
                    color: 'var(--text-subtle)',
                  }}>{off} off</span>
                )}
              </button>
            );
          })}
        </div>

        <div style={{
          flex: 1, minWidth: 0, padding: '18px 20px',
          display: 'flex', flexDirection: 'column', gap: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{
                fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 17,
                letterSpacing: '-0.025em', color: 'var(--text)',
              }}>{meta?.label}</span>
              <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>{meta?.blurb}</span>
            </div>
            <Button
              size="sm" variant="ghost"
              onClick={() => setCategory(section, !allOn)}
            >{allOn ? 'Turn the lot off' : 'Turn the lot on'}</Button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {here.map((c, i) => (
              <div
                key={c.key}
                style={{
                  display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0',
                  borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    fontSize: 13, fontWeight: 600, color: 'var(--text)',
                  }}>
                    {c.label}
                    {c.severity === 'urgent' && <Badge tone="danger">Urgent</Badge>}
                    {!c.may_mute && (
                      <span title="This one cannot be turned off"
                        style={{ color: 'var(--text-subtle)', display: 'flex' }}>
                        <Lock size={11} />
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.45 }}>
                    {c.blurb}
                  </span>
                </div>
                <Switch
                  checked={c.enabled}
                  disabled={!c.may_mute}
                  lockedReason={!c.may_mute ? 'This one cannot be turned off.' : undefined}
                  onChange={(v) => setKind(c.key, v)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ---- the three that are not per kind ---- */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)', padding: '16px 20px',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{
            fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 17,
            letterSpacing: '-0.025em', color: 'var(--text)',
          }}>How loud</span>
          <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>
            The same notifications, arriving differently.
          </span>
        </div>

        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 210 }}>
            <Label>Quiet hours</Label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Select
                value={String(settings?.quiet_from ?? 0)}
                onChange={(v) => saveSettings({ quiet_from: Number(v) })}
              >
                {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </Select>
              <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>to</span>
              <Select
                value={String(settings?.quiet_to ?? 0)}
                onChange={(v) => saveSettings({ quiet_to: Number(v) })}
              >
                {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </Select>
            </div>
            <span style={{ fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.45 }}>
              {settings && settings.quiet_from === settings.quiet_to
                ? 'Set both the same for no quiet hours, which is how it is now.'
                : 'Anything that is not urgent waits until the end of them. Nothing is lost.'}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 210 }}>
            <Label>Bunching</Label>
            <Select
              value={String(settings?.bundle_minutes ?? 10)}
              onChange={(v) => saveSettings({ bundle_minutes: Number(v) })}
            >
              <option value="0">Never bunch anything</option>
              <option value="5">Within five minutes</option>
              <option value="10">Within ten minutes</option>
              <option value="30">Within half an hour</option>
              <option value="120">Within two hours</option>
            </Select>
            <span style={{ fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.45 }}>
              Two accounts handed to you at once arrive as one notification saying two, with both
              of them in it.
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 210 }}>
            <Label>Everything off, for a bit</Label>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              <Button size="sm" variant="secondary" onClick={() => mute(2)}>Two hours</Button>
              <Button size="sm" variant="secondary" onClick={() => mute(24)}>A day</Button>
              <Button size="sm" variant="secondary" onClick={() => mute(24 * 7)}>A week</Button>
            </div>
            <span style={{ fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.45 }}>
              Better than turning thirty toggles off and trying to remember which were on.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function hourLabel(h: number): string {
  if (h === 0) return 'midnight';
  if (h === 12) return 'midday';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}
