'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  Plus, X, Check, Trash2, Upload, Merge, Clock, CalendarDays, AlertTriangle,
} from 'lucide-react';
import {
  DAY_LABEL, whenLabel,
  type Channel, type LibraryItem, type Network, type NetworkKey, type Post,
  type Tag, type Template, type Variant,
} from '@/lib/content/types';
import type { Capability } from '@/lib/platform/permissions/catalog';
import {
  Alert, Badge, Button, Chip, EmptyState, IconButton, Label,
} from '@/components/kit/primitives';
import { Drawer, Field, Segmented, Select, Split, TextArea, TextInput } from '@/components/kit/forms';

/* =============================================================
   The tabs that are not the planner: the queue, the library, the
   templates, the tags and the channels.

   All five are the same shape, so they live together: a list of one
   kind of thing, and the small number of edits that thing takes. Each
   is gated on its own capability, so a marketer sees the library and
   the templates and does not see a control for connecting an account.

   Drawn from `components/kit` and semantic tokens throughout. The
   package this came in with brought its own stylesheet; none of it is
   used here.
   ============================================================= */

const PANEL: CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 'var(--r-md)', overflow: 'hidden',
};
const BAR: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap',
  padding: '10px 14px', ...PANEL,
};
const TH: CSSProperties = {
  textAlign: 'left', padding: '0 12px', height: 32,
  background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
  fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 11,
  letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-subtle)',
  whiteSpace: 'nowrap',
};
const TD: CSSProperties = {
  padding: '0 12px', height: 36, borderBottom: '1px solid var(--border)',
  fontSize: 13, color: 'var(--text-muted)',
};

/** A titled box. Rules carry the structure, not shadows. */
function Panel({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section style={PANEL}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 7,
        height: 32, padding: '0 14px',
        background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
      }}>
        {icon && <span style={{ color: 'var(--text-subtle)', display: 'flex' }}>{icon}</span>}
        <Label>{title}</Label>
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </section>
  );
}

/** One line of guidance above a table. Never a heading. */
function Note({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 12, color: 'var(--text-subtle)', maxWidth: '68ch' }}>{children}</span>;
}

/* Where the posting times a channel uses may be. A UK haulage business
   posts on UK time, so London leads and is the default the database
   also carries. The rest are here because a future account aimed at a
   different market should not have to share this one's clock. */
const ZONES: { value: string; label: string }[] = [
  { value: 'Europe/London', label: 'London' },
  { value: 'Europe/Dublin', label: 'Dublin' },
  { value: 'Europe/Paris', label: 'Paris' },
  { value: 'Europe/Amsterdam', label: 'Amsterdam' },
  { value: 'UTC', label: 'UTC' },
];

/* -------------------------------------------------------------
   The queue.

   From the business:

     'next free slot' in socials, have this push it to the next
     available day where nothing is scheduled, at 3pm.

   So the queue has one setting, the time of day, and one rule that is
   not a setting: the next day with nothing scheduled on it, anywhere.
   `content_next_slot` in migration 122 is that rule, and this screen
   shows what it would do rather than describing it.

   ---- What was here ----

   A per channel week grid: tick Monday 09:00, Monday 13:00, Tuesday
   09:00 and the queue fills them in turn. Nobody at STC ever filled it
   in, so `content_next_slot` answered null, and "Next free slot" did
   nothing at all while this screen looked finished. The table is still
   in the database and nothing reads it.
   ------------------------------------------------------------- */
export function Queue({
  channels, networks, posts, variants, canEdit, queueTime, onQueueTime,
}: {
  channels: Channel[];
  networks: Network[];
  posts: Post[];
  variants: Variant[];
  canEdit: boolean;
  /** 'HH:MM:SS', as the setting holds it. */
  queueTime: string;
  onQueueTime: (at: string) => Promise<string | null>;
}) {
  const [open, setOpen] = useState<string | null>(channels[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState(queueTime.slice(0, 5));

  useEffect(() => { setTime(queueTime.slice(0, 5)); }, [queueTime]);

  const byKey = useMemo(() => new Map(networks.map((n) => [n.key, n])), [networks]);
  const channel = channels.find((c) => c.id === open);

  const queued = useMemo(() => {
    const ids = new Set(
      variants.filter((v) => v.channel_id === open && v.state === 'scheduled').map((v) => v.post_id),
    );
    return posts.filter((p) => ids.has(p.id))
      .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''));
  }, [variants, posts, open]);

  /* The next seven days the queue would take, in order, so somebody can
     see the rule rather than read a sentence about it. Worked out the
     same way `content_next_slot` works it out: a day is free when
     nothing at all is scheduled on it. */
  const coming = useMemo(() => {
    const zone = channel?.timezone ?? 'Europe/London';
    const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: zone });
    const busyDays = new Set<string>();
    for (const p of posts) {
      if (p.status !== 'scheduled' && p.status !== 'publishing') continue;
      if (p.scheduled_at) busyDays.add(dayOf(p.scheduled_at));
      else if (p.scheduled_date) busyDays.add(p.scheduled_date);
    }
    for (const v of variants) {
      if (v.state !== 'pending' && v.state !== 'scheduled' && v.state !== 'publishing') continue;
      if (v.scheduled_at) busyDays.add(dayOf(v.scheduled_at));
    }

    const out: string[] = [];
    const now = new Date();
    for (let i = 0; i < 90 && out.length < 7; i += 1) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const key = d.toLocaleDateString('en-CA');
      if (busyDays.has(key)) continue;
      const at = new Date(`${key}T${time.length === 5 ? time : time.slice(0, 5)}:00`);
      if (at <= now) continue;
      out.push(at.toISOString());
    }
    return out;
  }, [posts, variants, channel, time]);

  async function save() {
    setBusy(true); setError(null);
    const why = await onQueueTime(time);
    setBusy(false);
    if (why) setError(why);
  }

  if (!channels.length) {
    return (
      <EmptyState
        what="No channels yet"
        why="The queue puts a post on the next day with nothing on it. Add an account under Channels and it has somewhere to go."
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Note>
        Next free slot puts a post on the next day that has nothing scheduled on it, at the time
        below. A day with a post on any channel is not a free day, so posts come out one a day.
      </Note>

      <Panel title="What time the queue posts" icon={<Clock size={12} />}>
        <div style={{ padding: 12, display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <Field label="Time of day">
            <input
              type="time"
              value={time}
              disabled={!canEdit}
              onChange={(e) => setTime(e.target.value)}
              aria-label="What time of day the queue posts"
              style={{
                height: 32, width: 92, padding: '0 8px',
                borderRadius: 'var(--r-sm)', border: '1px solid var(--border-strong)',
                background: 'var(--surface)', color: 'var(--text)',
                fontFamily: 'var(--inter)', fontSize: 13, outline: 0,
              }}
            />
          </Field>
          <Button
            size="sm"
            variant="secondary"
            disabled={!canEdit || busy || time.slice(0, 5) === queueTime.slice(0, 5)}
            title={canEdit
              ? 'Save the time the queue posts at'
              : 'You do not have permission to change the channels and the queue'}
            onClick={() => { void save(); }}
          >{busy ? 'Saving' : 'Save'}</Button>
          <Note>Everybody sees this. It is one time for the whole company.</Note>
        </div>
        {error && <div style={{ padding: '0 12px 12px' }}><Alert tone="danger">{error}</Alert></div>}
      </Panel>

      <Panel title="The next seven days it would take" icon={<CalendarDays size={12} />}>
        <div style={{ padding: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {coming.length === 0
            ? <Note>Every day for the next three months already has a post on it.</Note>
            : coming.map((iso) => (
              <span key={iso} style={{
                display: 'inline-flex', alignItems: 'center', height: 24, padding: '0 9px',
                borderRadius: 'var(--r-sm)', background: 'var(--bg-subtle)',
                border: '1px solid var(--border)', fontSize: 12, color: 'var(--text)',
              }}>
                {whenLabel(iso, channel?.timezone ?? 'Europe/London')}
              </span>
            ))}
        </div>
      </Panel>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {channels.map((c) => (
          <Chip
            key={c.id}
            active={open === c.id}
            count={variants.filter((v) => v.channel_id === c.id && v.state === 'scheduled').length}
            onClick={() => setOpen(c.id)}
          >
            {byKey.get(c.network_key)?.label ?? c.network_key}
          </Chip>
        ))}
      </div>

      {channel && (
        <Panel title="In this queue" icon={<Clock size={12} />}>
          {queued.length === 0 ? (
            <Note>Nothing is waiting on this channel. Approved posts go in from the planner.</Note>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {queued.map((p) => {
                  const v = variants.find((x) => x.post_id === p.id && x.channel_id === open);
                  return (
                    <tr key={p.id}>
                      <td style={{ ...TD, color: 'var(--text-subtle)', width: 190, whiteSpace: 'nowrap' }}>
                        {whenLabel(v?.scheduled_at ?? p.scheduled_at, channel.timezone)}
                      </td>
                      <td style={TD}>
                        {p.content.length > 76 ? `${p.content.slice(0, 76)}...` : p.content}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
      )}
    </div>
  );
}

/* -------------------------------------------------------------
   Channels.
   ------------------------------------------------------------- */
export function Channels({
  channels, networks, canEdit, onAdd, onPatch,
}: {
  channels: Channel[];
  networks: Network[];
  canEdit: boolean;
  onAdd: (body: { network_key: NetworkKey; handle: string; display_name: string; timezone: string }) => Promise<string | null>;
  onPatch: (body: { id: string; display_name?: string; timezone?: string; is_active?: boolean }) => Promise<string | null>;
}) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{
    network_key: NetworkKey; handle: string; display_name: string; timezone: string;
  }>({
    network_key: networks[0]?.key ?? 'linkedin',
    handle: '',
    display_name: '',
    timezone: 'Europe/London',
  });

  const byKey = useMemo(() => new Map(networks.map((n) => [n.key, n])), [networks]);

  async function add() {
    setBusy(true); setError(null);
    const why = await onAdd(form);
    setBusy(false);
    if (why) { setError(why); return; }
    setAdding(false);
    setForm({ ...form, handle: '', display_name: '' });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={BAR}>
        <Note>The accounts Stockport Truck Centre already owns.</Note>
        <span style={{ flex: 1 }} />
        {canEdit && (
          <Button size="sm" variant="primary" onClick={() => setAdding((a) => !a)}>
            <Plus size={13} /> Add an account
          </Button>
        )}
      </div>

      {/* ---- Why there is no Connect button ----

          Publishing needs each network's app registration, and several
          need review before they grant a posting scope. None of that
          has happened, so there is nothing behind a Connect button and
          a control that appears and then refuses teaches people the
          tool is unreliable.

          Saying so once, here, is the honest version. ---- */}
      <Alert tone="warning">
        <AlertTriangle size={13} style={{ flex: 'none', marginTop: 1 }} />
        <span>
          Nothing here posts on its own yet. Each network needs its own app registration
          before this product can publish, and several review those before granting it.
          Until then an account is <strong>plan only</strong>: schedule into it, report on it,
          and record what went out by hand.
        </span>
      </Alert>

      {adding && (
        <Panel title="Add an account you own">
          <Split>
            <Field label="Network">
              <Select
                value={form.network_key}
                onChange={(v) => setForm({ ...form, network_key: v as NetworkKey })}
              >
                {networks.map((n) => <option key={n.key} value={n.key}>{n.label}</option>)}
              </Select>
            </Field>
            <Field label="Handle" hint="As it appears on the network">
              <TextInput
                value={form.handle}
                onChange={(v) => setForm({ ...form, handle: v })}
                placeholder="stockporttruckcentre"
              />
            </Field>
            <Field label="Shown as">
              <TextInput
                value={form.display_name}
                onChange={(v) => setForm({ ...form, display_name: v })}
                placeholder="Stockport Truck Centre"
              />
            </Field>
            <Field label="Posting times are in">
              <Select value={form.timezone} onChange={(v) => setForm({ ...form, timezone: v })}>
                {ZONES.map((z) => <option key={z.value} value={z.value}>{z.label}</option>)}
              </Select>
            </Field>
          </Split>
          {error && <Alert tone="danger">{error}</Alert>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Note>This records the account. It does not sign in to it.</Note>
            <span style={{ flex: 1 }} />
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" variant="primary" disabled={busy || !form.handle.trim()} onClick={add}>
              {busy ? 'Adding' : 'Add'}
            </Button>
          </div>
        </Panel>
      )}

      {channels.length === 0 ? (
        <EmptyState
          what="No accounts recorded yet"
          why="Add the accounts this company posts from. Everything else here, planning, approving, scheduling and reporting, works from the moment one exists."
          action={canEdit
            ? <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
                <Plus size={13} /> Add an account
              </Button>
            : undefined}
        />
      ) : (
        <div style={{ ...PANEL, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH}>Network</th><th style={TH}>Handle</th><th style={TH}>Shown as</th>
                <th style={TH}>Times in</th><th style={TH}>State</th><th style={TH} />
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.id}>
                  <td style={{ ...TD, fontWeight: 600, color: 'var(--text)' }}>
                    {byKey.get(c.network_key)?.label ?? c.network_key}
                  </td>
                  <td style={{ ...TD, color: 'var(--text-subtle)' }}>@{c.handle}</td>
                  <td style={TD}>{c.display_name}</td>
                  <td style={{ ...TD, color: 'var(--text-subtle)' }}>{c.timezone.replace(/_/g, ' ')}</td>
                  <td style={TD}>
                    {c.state === 'connected'
                      ? <Badge tone="success" dot>Connected</Badge>
                      : c.state === 'needs_reauth'
                        ? <Badge tone="warning"><AlertTriangle size={10} /> Needs signing in again</Badge>
                        : <Badge tone="neutral">Plan only</Badge>}
                  </td>
                  <td style={{ ...TD, textAlign: 'right' }}>
                    {canEdit && (
                      <Button
                        size="sm" variant="secondary"
                        onClick={() => onPatch({ id: c.id, is_active: !c.is_active })}
                      >
                        {c.is_active ? 'Hide' : 'Show'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------
   Templates.
   ------------------------------------------------------------- */
export function Templates({
  templates, networks, caps, onUse, onSave, onArchive,
}: {
  templates: Template[];
  networks: Network[];
  caps: Set<Capability>;
  onUse: (t: Template) => void;
  onSave: (body: { name: string; body: string; description?: string; is_shared: boolean }) => Promise<string | null>;
  onArchive: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', body: '', description: '', is_shared: true });
  const byKey = useMemo(() => new Map(networks.map((n) => [n.key, n])), [networks]);
  const canShare = caps.has('social.templates') || caps.has('marketing.edit');

  async function save() {
    setBusy(true); setError(null);
    const why = await onSave(form);
    setBusy(false);
    if (why) { setError(why); return; }
    setAdding(false);
    setForm({ name: '', body: '', description: '', is_shared: true });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={BAR}>
        <Note>
          What everybody starts from. A template keeps its own words: editing a post you made
          from one does not change it.
        </Note>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="primary" onClick={() => setAdding((a) => !a)}>
          <Plus size={13} /> New template
        </Button>
      </div>

      {adding && (
        <Panel title="New template">
          <Field label="Name">
            <TextInput
              value={form.name}
              onChange={(v) => setForm({ ...form, name: v })}
              placeholder="New arrival on the yard"
            />
          </Field>
          <Field label="The post">
            <TextArea
              value={form.body}
              onChange={(v) => setForm({ ...form, body: v })}
              rows={4}
              placeholder="What the template starts you with."
            />
          </Field>
          <Field
            label="Who it is for"
            hint={canShare ? undefined : 'Sharing a template with the team needs more access.'}
          >
            <Segmented
              value={form.is_shared ? 'team' : 'me'}
              onChange={(v) => {
                if (v === 'team' && !canShare) return;
                setForm({ ...form, is_shared: v === 'team' });
              }}
              options={[
                { value: 'team', label: 'The team' },
                { value: 'me', label: 'Just me' },
              ]}
            />
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button
              size="sm" variant="primary"
              disabled={busy || !form.name.trim() || !form.body.trim()}
              onClick={save}
            >
              {busy ? 'Saving' : 'Save'}
            </Button>
          </div>
        </Panel>
      )}

      {templates.length === 0 ? (
        <EmptyState
          what="Nothing saved yet"
          why="A template is the shape of a post you write often. Save one from here, or from any post you have already written."
        />
      ) : (
        <div style={{ ...PANEL, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH}>Name</th><th style={TH}>Starts with</th><th style={TH}>For</th>
                <th style={{ ...TH, textAlign: 'right' }}>Used</th><th style={TH} />
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id}>
                  <td style={{ ...TD, fontWeight: 600, color: 'var(--text)' }}>{t.name}</td>
                  <td style={{ ...TD, color: 'var(--text-subtle)' }}>
                    {t.body.length > 64 ? `${t.body.slice(0, 64)}...` : t.body}
                    {t.network_keys.length > 0 && (
                      <span style={{ marginLeft: 8 }}>
                        {t.network_keys.map((k) => byKey.get(k as never)?.label ?? k).join(', ')}
                      </span>
                    )}
                  </td>
                  <td style={TD}>{t.is_shared ? 'The team' : 'Just you'}</td>
                  <td style={{ ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {t.use_count}
                  </td>
                  <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Button size="sm" variant="secondary" onClick={() => onUse(t)}>Use</Button>
                    {canShare && (
                      <span style={{ marginLeft: 6, display: 'inline-flex', verticalAlign: 'middle' }}>
                        <IconButton label="Archive this template" onClick={() => onArchive(t.id)}>
                          <Trash2 size={12} />
                        </IconButton>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------
   Tags.

   No colours. The kit's rule is that colour never carries data on its
   own, a tag palette is exactly that, and it stops working past about
   eight tags anyway. Tags are words.
   ------------------------------------------------------------- */
export function Tags({
  tags, canEdit, onAdd, onMerge, onArchive,
}: {
  tags: Tag[];
  canEdit: boolean;
  onAdd: (name: string) => Promise<string | null>;
  onMerge: (id: string, into: string) => Promise<string | null>;
  onArchive: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [merging, setMerging] = useState<string | null>(null);

  async function add() {
    if (!name.trim()) return;
    setBusy(true); setError(null);
    const why = await onAdd(name.trim());
    setBusy(false);
    if (why) { setError(why); return; }
    setName('');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={BAR}>
        <Note>
          How content is grouped, and how it is reported on. Tag analytics answers how
          recruitment posts do against stock posts.
        </Note>
        <span style={{ flex: 1 }} />
        {canEdit && (
          <>
            <div style={{ width: 190 }}>
              <TextInput
                value={name}
                onChange={setName}
                placeholder="New tag"
                onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
              />
            </div>
            <Button size="sm" variant="primary" disabled={busy || !name.trim()} onClick={add}>
              <Plus size={13} /> {busy ? 'Adding' : 'Add'}
            </Button>
          </>
        )}
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      {tags.length === 0 ? (
        <EmptyState
          what="Nothing tagged yet"
          why="Tags are how a report can compare recruitment posts with stock posts. Add the few the company actually uses rather than every word."
        />
      ) : (
        <div style={{ ...PANEL, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={TH}>Tag</th><th style={TH}>Key</th><th style={TH} /></tr></thead>
            <tbody>
              {tags.map((t) => (
                <tr key={t.id}>
                  <td style={{ ...TD, fontWeight: 600, color: 'var(--text)' }}>{t.name}</td>
                  <td style={{ ...TD, color: 'var(--text-subtle)' }}>{t.slug}</td>
                  <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {canEdit && merging === t.id ? (
                      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', width: 260 }}>
                        <Select
                          value=""
                          onChange={async (v) => {
                            if (!v) return;
                            const why = await onMerge(t.id, v);
                            setMerging(null);
                            if (why) setError(why);
                          }}
                        >
                          <option value="">Fold into...</option>
                          {tags.filter((x) => x.id !== t.id).map((x) => (
                            <option key={x.id} value={x.id}>{x.name}</option>
                          ))}
                        </Select>
                        <Button size="sm" variant="ghost" onClick={() => setMerging(null)}>Cancel</Button>
                      </span>
                    ) : canEdit ? (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => setMerging(t.id)}>
                          <Merge size={12} /> Merge
                        </Button>
                        <span style={{ marginLeft: 6, display: 'inline-flex', verticalAlign: 'middle' }}>
                          <IconButton label="Archive this tag" onClick={() => onArchive(t.id)}>
                            <Trash2 size={12} />
                          </IconButton>
                        </span>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------
   The library.
   ------------------------------------------------------------- */
export function Library({
  items, caps, onUpload, onPatch,
}: {
  items: LibraryItem[];
  caps: Set<Capability>;
  onUpload: (file: File, name: string) => Promise<string | null>;
  onPatch: (body: { id: string; approve?: boolean; is_active?: boolean; alt_text?: string }) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<LibraryItem | null>(null);
  const [alt, setAlt] = useState('');

  const canEdit = caps.has('social.library') || caps.has('marketing.edit');
  const canApprove = caps.has('social.approve') || caps.has('marketing.approve');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={BAR}>
        <Note>
          Pictures the company keeps, not attachments on one post. An asset nobody has signed
          off says so, so it does not reach a public account because somebody found it in a
          folder.
        </Note>
        <span style={{ flex: 1 }} />
        {canEdit && (
          <label style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            height: 28, padding: '0 10px', borderRadius: 'var(--r)', cursor: 'pointer',
            background: 'var(--primary)', color: 'var(--primary-fg)',
            border: '1px solid var(--primary)',
            fontFamily: 'var(--inter)', fontSize: 12.5, fontWeight: 600,
          }}>
            <Upload size={13} /> {busy ? 'Adding' : 'Add'}
            <input type="file" accept="image/*" hidden onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              setBusy(true); setError(null);
              const why = await onUpload(f, f.name.replace(/\.[^.]+$/, ''));
              setBusy(false);
              if (why) setError(why);
            }} />
          </label>
        )}
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      {items.length === 0 ? (
        <EmptyState
          what="The library is empty"
          why="Add the pictures used more than once. Everything here can be dropped into a post without hunting for the file again."
        />
      ) : (
        <div style={{
          display: 'grid', gap: 10,
          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        }}>
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => { setOpen(item); setAlt(item.alt_text ?? ''); }}
              style={{
                display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left',
                padding: 0, cursor: 'pointer', overflow: 'hidden', ...PANEL,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/files/${item.file_id}`}
                alt={item.alt_text ?? ''}
                style={{ width: '100%', height: 108, objectFit: 'cover', display: 'block' }}
              />
              <span style={{
                padding: '0 9px', fontSize: 12.5, fontWeight: 600, color: 'var(--text)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{item.name}</span>
              <span style={{ padding: '0 9px 9px', fontSize: 11, color: 'var(--text-subtle)' }}>
                {item.approved_at ? 'Signed off' : 'Not signed off'}
                {item.use_count > 0 && ` · used ${item.use_count}`}
              </span>
            </button>
          ))}
        </div>
      )}

      {open && (
        <Drawer
          eyebrow="Library"
          title={open.name}
          onClose={() => setOpen(null)}
          width={520}
          footer={
            <>
              {canEdit && (
                <Button size="sm" variant="secondary" onClick={async () => {
                  const why = await onPatch({ id: open.id, alt_text: alt });
                  if (why) setError(why); else setOpen(null);
                }}>Save</Button>
              )}
              {canApprove && (
                <Button size="sm" variant="primary" onClick={async () => {
                  const why = await onPatch({ id: open.id, approve: !open.approved_at });
                  if (why) setError(why); else setOpen(null);
                }}>
                  <Check size={13} /> {open.approved_at ? 'Withdraw sign off' : 'Sign this off'}
                </Button>
              )}
              <span style={{ flex: 1 }} />
              {canEdit && (
                <Button size="sm" variant="ghost" onClick={async () => {
                  if (!confirm('Take this out of the library? Posts already using it keep it.')) return;
                  const why = await onPatch({ id: open.id, is_active: false });
                  if (why) setError(why); else setOpen(null);
                }}>
                  <Trash2 size={12} /> Remove
                </Button>
              )}
            </>
          }
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/files/${open.file_id}`}
            alt={open.alt_text ?? ''}
            style={{
              width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r)',
              display: 'block',
            }}
          />
          <Field label="Alt text" hint="What a screen reader says">
            <TextInput value={alt} onChange={setAlt} readOnly={!canEdit} />
          </Field>
          <Note>
            {open.approved_at
              ? `Signed off ${whenLabel(open.approved_at)}.`
              : 'Nobody has signed this off.'}
            {open.last_used_at && ` Last used ${whenLabel(open.last_used_at)}.`}
          </Note>
        </Drawer>
      )}
    </div>
  );
}
