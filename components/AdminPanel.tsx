'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ShieldCheck, ShieldOff, Search, Check, Minus, X, Loader, Power, RotateCcw,
  UserCog, ScrollText, Users,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  Alert, Badge, Button, Card, Chip, EmptyState, Label, PageHead, PanelHead,
  SearchInput, Tabs, type Tone,
} from '@/components/kit/primitives';
import { Field, Select } from '@/components/kit/forms';
import { Toasts, useToast } from '@/components/kit/toast';
import { Avatar } from '@/components/team/avatar';
import {
  byArea, loadCapabilitiesFor, loadTeam, overrideState, roleInWords, setActive,
  setCapability, setRoleTemplate, updateTeamMember, whySource,
  type CapabilityLine, type OverrideState, type TeamMember,
} from '@/lib/platform/team';
import { setRole } from '@/lib/crm/roles';
import type { UserRole } from '@/lib/types';

/* =============================================================
   Roles and permissions, for everybody.

   From the business:

     more a handy page allowing admin to become role/permission
     management hub ... ensure everything perfectly wired up and
     working, no placeholders, role and permission dependent

   The Team tab is the phone list. This is the other half: who can do
   what, and every exception to it.

   ---- Three states, not a checkbox ----

   A permission is not on or off. It is:

     from their role   the normal case, and the one that keeps working
                       when somebody's job changes
     granted           an exception, on purpose
     refused           the opposite exception

   A two state control collapses the first into one of the other two,
   and an admin screen full of explicit grants nobody meant is
   unreadable inside a month. Putting one back to their role removes the
   exception rather than recording the opposite of it, which is what
   makes a mistake here recoverable.

   ---- Nothing in this file decides whether something is allowed ----

   Every refusal comes back from the database as a sentence somebody
   wrote to be read: the last administrator, your own access, a
   prerequisite that is missing. This screen shows them and does not
   predict them. A prediction here would be a second copy of the rule,
   and the copy is the one that goes stale.

   The one thing the browser decides is which controls to draw, from
   `mayManage`, and that is a courtesy rather than a defence: the page
   redirects without `admin.users`, `team_directory()` withholds the
   permission counts, and every write is refused by its own function.
   ============================================================= */

const LEGACY_ROLES: UserRole[] = ['admin', 'marketer', 'sales', 'viewer'];

export function AdminPanel({
  selfId, templates,
}: {
  selfId: string;
  templates: { slug: string; name: string; description: string | null }[];
}) {
  return (
    <Toasts>
      <AdminBody selfId={selfId} templates={templates} />
    </Toasts>
  );
}

function AdminBody({
  selfId, templates,
}: {
  selfId: string;
  templates: { slug: string; name: string; description: string | null }[];
}) {
  const supabase = createClient();
  const router = useRouter();
  const params = useSearchParams();
  const { say } = useToast();

  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [find, setFind] = useState('');
  const [onlyExceptions, setOnlyExceptions] = useState(false);
  const [chosen, setChosen] = useState<string | null>(params.get('person'));

  const reload = useCallback(async () => {
    const done = await loadTeam(supabase);
    if (done.ok) setTeam(done.value); else setFailure(done.why);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { reload(); }, [reload]);

  /* Land on somebody. A deep link from the Team tab names them; failing
     that the first person in the list, because an admin screen whose
     right half is empty until you click looks like it failed to load. */
  useEffect(() => {
    if (!team || team.length === 0) return;
    if (chosen && team.some((m) => m.id === chosen)) return;
    setChosen(team[0]!.id);
  }, [team, chosen]);

  const shown = useMemo(() => {
    const needle = find.trim().toLowerCase();
    return (team ?? []).filter((m) => {
      if (onlyExceptions && (m.overrides ?? 0) === 0) return false;
      if (!needle) return true;
      return [m.full_name, m.email, m.job_title, roleInWords(m)]
        .some((f) => (f ?? '').toLowerCase().includes(needle));
    });
  }, [team, find, onlyExceptions]);

  const member = useMemo(() => (team ?? []).find((m) => m.id === chosen) ?? null, [team, chosen]);

  const totals = useMemo(() => {
    const all = team ?? [];
    return {
      people: all.length,
      admins: all.filter((m) => m.is_active && (m.template_slug === 'administrator' || m.role === 'admin')).length,
      off: all.filter((m) => !m.is_active).length,
      exceptions: all.reduce((n, m) => n + (m.overrides ?? 0), 0),
    };
  }, [team]);

  function open(id: string) {
    setChosen(id);
    /* Kept in the address bar so a link to one person's access can be
       pasted into a message, which is how these conversations actually
       happen. `replace` rather than `push`: clicking six people should
       not put six entries in the back button. */
    router.replace(`/dashboard/admin?person=${id}`, { scroll: false });
  }

  if (failure) return <div className="kit"><Alert tone="danger">{failure}</Alert></div>;

  return (
    <div className="kit">
      <PageHead
        eyebrow="Roles and permissions"
        title={<><UserCog size={26} style={{ color: 'var(--accent)' }} /><span>Admin</span></>}
        sub="What each person can do, and every exception to it. Every change is recorded against your name."
      />

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <Stat label="People" value={totals.people} />
        <Stat label="Administrators" value={totals.admins} tone={totals.admins < 2 ? 'warning' : 'neutral'} />
        <Stat label="Turned off" value={totals.off} />
        <Stat label="Exceptions" value={totals.exceptions} tone={totals.exceptions ? 'warning' : 'neutral'} />
      </div>

      {totals.admins === 1 && (
        <div style={{ marginBottom: 14 }}>
          <Alert tone="warning">
            One person can manage users. If that account is lost, nothing inside this
            application can put it back. Give somebody else the Manage users permission.
          </Alert>
        </div>
      )}

      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* ---- who ---- */}
        <div style={{ flex: '0 0 300px', minWidth: 260, maxWidth: '100%' }}>
          <Card padded={false}>
            <PanelHead title="Who" count={shown.length} />
            <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <SearchInput value={find} onChange={setFind} placeholder="Find somebody" icon={<Search size={14} />} />
              <Chip
                active={onlyExceptions}
                count={(team ?? []).filter((m) => (m.overrides ?? 0) > 0).length}
                onClick={() => setOnlyExceptions((v) => !v)}
                title="People carrying a permission that does not come from their role"
              >
                Only people with exceptions
              </Chip>
            </div>

            {team == null ? (
              <div style={{ padding: 16, fontSize: 12.5, color: 'var(--text-subtle)' }}>Loading.</div>
            ) : shown.length === 0 ? (
              <div style={{ padding: 8 }}>
                <EmptyState what="Nobody matches that" why="Try a different search." />
              </div>
            ) : (
              <div style={{ maxHeight: 560, overflowY: 'auto' }}>
                {shown.map((m, i) => {
                  const on = m.id === chosen;
                  return (
                    <button
                      key={m.id}
                      onClick={() => open(m.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                        textAlign: 'left', cursor: 'pointer', padding: '9px 12px',
                        border: 'none', borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                        borderLeft: `2px solid ${on ? 'var(--accent)' : 'transparent'}`,
                        background: on ? 'var(--bg-subtle)' : 'transparent',
                        opacity: m.is_active ? 1 : 0.6,
                      }}
                    >
                      <Avatar name={m.full_name} url={m.photo_url} size={28} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{
                          display: 'block', fontSize: 13, fontWeight: on ? 600 : 500, color: 'var(--text)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {m.full_name || m.email}{m.id === selfId ? ' (you)' : ''}
                        </span>
                        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-subtle)' }}>
                          {roleInWords(m)}
                          {(m.overrides ?? 0) > 0 && (
                            <span style={{ color: 'var(--warning)' }}>
                              {' · '}{m.overrides} exception{m.overrides === 1 ? '' : 's'}
                            </span>
                          )}
                        </span>
                      </span>
                      <span style={{
                        fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 12,
                        fontVariantNumeric: 'tabular-nums', color: 'var(--text-subtle)', flex: 'none',
                      }}>{m.capabilities ?? 0}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* ---- and what they can do ---- */}
        <div style={{ flex: 1, minWidth: 320 }}>
          {member
            ? <Person
                key={member.id}
                member={member}
                isSelf={member.id === selfId}
                templates={templates}
                onChanged={reload}
                say={say}
              />
            : <Card><EmptyState what="Pick somebody" why="Choose a name on the left." /></Card>}
        </div>
      </div>
    </div>
  );
}

/* =============================================================
   One person
   ============================================================= */

function Person({
  member, isSelf, templates, onChanged, say,
}: {
  member: TeamMember;
  isSelf: boolean;
  templates: { slug: string; name: string; description: string | null }[];
  onChanged: () => Promise<void>;
  say: ReturnType<typeof useToast>['say'];
}) {
  const supabase = createClient();
  const [tab, setTab] = useState<'role' | 'permissions'>('role');
  const [busy, setBusy] = useState(false);

  async function run<T>(
    what: Promise<{ ok: true; value: T } | { ok: false; why: string }>, said: string,
  ) {
    setBusy(true);
    const done = await what;
    setBusy(false);
    if (!done.ok) { say({ tone: 'danger', title: 'Not changed', body: done.why }); return false; }
    say({ tone: 'success', title: said });
    await onChanged();
    return true;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card padded={false}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px' }}>
          <Avatar name={member.full_name} url={member.photo_url} size={40} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
              fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 17,
              letterSpacing: '-0.02em', color: 'var(--text)',
            }}>
              {member.full_name || member.email}
              {isSelf && <Badge tone="neutral">You</Badge>}
              {!member.is_active && <Badge tone="warning">Turned off</Badge>}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 2 }}>
              {[member.job_title, member.department, member.email].filter(Boolean).join(' · ')}
            </div>
          </div>
          <Badge tone={member.is_active ? 'info' : 'neutral'}>{roleInWords(member)}</Badge>
        </div>
        <div style={{ padding: '0 15px' }}>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { key: 'role' as const, label: 'Role and account' },
              { key: 'permissions' as const, label: 'Permissions', count: member.capabilities ?? undefined },
            ]}
          />
        </div>
      </Card>

      {tab === 'role'
        ? <RoleTab member={member} isSelf={isSelf} templates={templates} busy={busy} run={run} supabase={supabase} />
        : <PermissionsTab member={member} supabase={supabase} say={say} onChanged={onChanged} />}
    </div>
  );
}

function RoleTab({
  member, isSelf, templates, busy, run, supabase,
}: {
  member: TeamMember;
  isSelf: boolean;
  templates: { slug: string; name: string; description: string | null }[];
  busy: boolean;
  run: <T>(p: Promise<{ ok: true; value: T } | { ok: false; why: string }>, said: string) => Promise<boolean>;
  supabase: ReturnType<typeof createClient>;
}) {
  const [jobTitle, setJobTitle] = useState(member.job_title ?? '');
  const [location, setLocation] = useState(member.location ?? '');
  const template = templates.find((t) => t.slug === member.template_slug) ?? null;

  return (
    <>
      <Card padded={false}>
        <PanelHead title="Their role" hint="What everything else is measured against" />
        <div style={{ padding: 15, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field
            label="Role"
            hint={template?.description
              ?? 'A role is a starting point. Anything granted or refused to them personally sits on top of it and survives a change here.'}
          >
            <Select
              value={member.template_slug ?? ''}
              onChange={(slug) => run(
                setRoleTemplate(supabase, member.id, slug || null),
                slug ? 'Role changed' : 'Taken off roles, back to the old access',
              )}
            >
              <option value="">On the old access (no role)</option>
              {templates.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
            </Select>
          </Field>

          {!member.template_slug && (
            <Field
              label="Old access"
              hint="Still what answers for anybody not on a role. Putting them on a role above replaces it."
            >
              <Select
                value={member.role}
                onChange={(role) => run(
                  setRole(supabase, member.id, role as UserRole).then((d) => (d.ok
                    ? { ok: true as const, value: d }
                    : { ok: false as const, why: d.why })),
                  'Access changed',
                )}
              >
                {LEGACY_ROLES.map((r) => (
                  <option key={r} value={r}>{roleInWords({ role: r, role_template: null })}</option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </Card>

      <Card padded={false}>
        <PanelHead title="Their details" hint="The directory half. Their name and theme are theirs." />
        <div style={{ padding: 15, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Job title" hint="Saved when you click out of the box. Empty clears it.">
            <input
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              onBlur={() => { if (jobTitle !== (member.job_title ?? '')) {
                run(updateTeamMember(supabase, member.id, { job_title: jobTitle }), 'Job title saved');
              } }}
              style={PLAIN_INPUT}
            />
          </Field>
          <Field label="Where they are based" hint="Saved when you click out of the box. Empty clears it.">
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              onBlur={() => { if (location !== (member.location ?? '')) {
                run(updateTeamMember(supabase, member.id, { location: location }), 'Location saved');
              } }}
              style={PLAIN_INPUT}
            />
          </Field>
        </div>
      </Card>

      <Card padded={false}>
        <PanelHead title="Their account" />
        <div style={{ padding: 15, display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {member.is_active
                ? <ShieldCheck size={15} style={{ color: 'var(--success)' }} />
                : <ShieldOff size={15} style={{ color: 'var(--warning)' }} />}
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                {member.is_active ? 'This account works' : 'This account is turned off'}
              </span>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.5 }}>
              Turning somebody off stops the account and keeps everything they own: their
              leads, their meetings, their notes, and the record of who did what with them.
              There is no delete here, and that is deliberate.
            </p>
          </div>
          <Button
            variant={member.is_active ? 'danger' : 'primary'}
            disabled={busy || isSelf}
            title={isSelf ? 'You cannot turn your own account off' : undefined}
            onClick={() => run(
              setActive(supabase, member.id, !member.is_active),
              member.is_active ? 'Account turned off' : 'Account turned back on',
            )}
          >
            {member.is_active ? <Power size={14} /> : <RotateCcw size={14} />}
            {member.is_active ? 'Turn this account off' : 'Turn it back on'}
          </Button>
        </div>
        {isSelf && (
          <div style={{ padding: '0 15px 15px' }}>
            <Alert tone="warning">
              This is you. You cannot turn your own account off or take your own Manage
              users permission away, because nothing inside this application could put
              either back.
            </Alert>
          </div>
        )}
      </Card>
    </>
  );
}

/* =============================================================
   Every permission, and every exception to their role
   ============================================================= */

function PermissionsTab({
  member, supabase, say, onChanged,
}: {
  member: TeamMember;
  supabase: ReturnType<typeof createClient>;
  say: ReturnType<typeof useToast>['say'];
  onChanged: () => Promise<void>;
}) {
  const [lines, setLines] = useState<CapabilityLine[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [find, setFind] = useState('');
  const [onlyExceptions, setOnlyExceptions] = useState(false);
  const [onlyHeld, setOnlyHeld] = useState(false);
  const [working, setWorking] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const done = await loadCapabilitiesFor(supabase, member.id);
    if (done.ok) { setLines(done.value); setFailure(null); } else setFailure(done.why);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member.id]);

  useEffect(() => { reload(); }, [reload]);

  const exceptions = useMemo(
    () => (lines ?? []).filter((l) => overrideState(l) !== 'role').length,
    [lines],
  );

  const shown = useMemo(() => {
    const needle = find.trim().toLowerCase();
    return byArea((lines ?? []).filter((l) => {
      if (onlyExceptions && overrideState(l) === 'role') return false;
      if (onlyHeld && !l.granted) return false;
      if (!needle) return true;
      return `${l.label} ${l.description} ${l.area} ${l.feature} ${l.key}`.toLowerCase().includes(needle);
    }));
  }, [lines, find, onlyExceptions, onlyHeld]);

  async function change(line: CapabilityLine, to: OverrideState) {
    setWorking(line.key);
    const granted = to === 'granted' ? true : to === 'refused' ? false : null;
    const done = await setCapability(
      supabase, member.id, line.key, granted,
      granted === null ? undefined : 'Set on the Admin screen',
    );
    setWorking(null);
    if (!done.ok) { say({ tone: 'danger', title: 'Not changed', body: done.why }); return; }
    say({
      tone: 'success',
      title: to === 'role' ? `${line.label} is back to their role`
        : to === 'granted' ? `${line.label} granted`
        : `${line.label} refused`,
    });
    await reload();
    await onChanged();
  }

  if (failure) return <Alert tone="danger">{failure}</Alert>;
  if (!lines) return <Alert tone="info">Reading their permissions.</Alert>;

  const held = lines.filter((l) => l.granted).length;

  return (
    <>
      <Card padded={false}>
        <PanelHead
          title="Their permissions"
          hint={`${held} of ${lines.length}${exceptions ? `, ${exceptions} an exception` : ', all from their role'}`}
        />
        <div style={{ padding: 12, display: 'flex', gap: 9, flexWrap: 'wrap', alignItems: 'center' }}>
          <SearchInput value={find} onChange={setFind} placeholder="Find a permission" icon={<Search size={14} />} />
          <Chip active={onlyHeld} count={held} onClick={() => setOnlyHeld((v) => !v)}>Only what they have</Chip>
          <Chip active={onlyExceptions} count={exceptions} onClick={() => setOnlyExceptions((v) => !v)}>
            Only exceptions
          </Chip>
        </div>
        <div style={{ padding: '0 12px 12px' }}>
          <Alert tone="info">
            <span>
              <strong>Role</strong> is the normal state and keeps working when their job
              changes. The tick and the cross are exceptions that override it. Putting one
              back to Role removes the exception rather than recording the opposite of it.
            </span>
          </Alert>
        </div>
      </Card>

      {shown.length === 0 && (
        <Card>
          <EmptyState what={onlyExceptions ? 'No exceptions' : 'Nothing matches that'}
            why={onlyExceptions
              ? 'Everything they can do comes from their role, which is how it should usually read.'
              : 'Try a different search.'}
          />
        </Card>
      )}

      {shown.map((area) => (
        <Card key={area.area} padded={false}>
          <PanelHead title={area.area} />
          {area.features.map((feature, fi) => (
            <div key={feature.feature}>
              <div style={{ padding: '8px 14px 4px', borderTop: fi === 0 ? 0 : '1px solid var(--border)' }}>
                <Label>{feature.feature}</Label>
              </div>
              {feature.items.map((line) => (
                <CapabilityRow
                  key={line.key}
                  line={line}
                  busy={working === line.key}
                  onChange={(to) => change(line, to)}
                />
              ))}
            </div>
          ))}
        </Card>
      ))}
    </>
  );
}

function CapabilityRow({
  line, busy, onChange,
}: { line: CapabilityLine; busy: boolean; onChange: (to: OverrideState) => void }) {
  const state = overrideState(line);

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 11, padding: '9px 14px 11px',
      background: state === 'role' ? 'transparent' : 'var(--bg-subtle)',
    }}>
      <span style={{
        width: 18, height: 18, flex: 'none', marginTop: 1, borderRadius: 'var(--r-full)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '1px solid var(--border)', background: 'var(--surface)',
        color: line.granted ? 'var(--success)' : 'var(--text-subtle)',
      }}>
        {line.granted ? <Check size={11} /> : <Minus size={11} />}
      </span>

      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          fontSize: 13, color: 'var(--text)',
        }}>
          {line.label}
          {line.danger !== 'routine' && (
            <Badge tone={line.danger === 'destructive' ? 'danger' : 'warning'}>{line.danger}</Badge>
          )}
          {state !== 'role' && (
            <Badge tone={state === 'granted' ? 'success' : 'warning'}>{whySource(line)}</Badge>
          )}
        </span>
        <span style={{
          display: 'block', fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.45, marginTop: 2,
        }}>{line.description}</span>
        {line.reason && (
          <span style={{
            display: 'block', fontSize: 11.5, color: 'var(--text-muted)',
            lineHeight: 1.45, marginTop: 3,
          }}>Reason given: {line.reason}</span>
        )}
      </span>

      <span style={{ display: 'flex', gap: 4, flex: 'none' }}>
        {busy ? (
          <span style={{ display: 'flex', alignItems: 'center', padding: '0 10px', color: 'var(--text-subtle)' }}>
            <Loader size={13} className="spin" />
          </span>
        ) : (
          <>
            <StateButton on={state === 'role'} onClick={() => onChange('role')} title="Let their role decide">
              Role
            </StateButton>
            <StateButton on={state === 'granted'} tone="success" onClick={() => onChange('granted')}
              title="Grant it whatever their role says">
              <Check size={12} />
            </StateButton>
            <StateButton on={state === 'refused'} tone="danger" onClick={() => onChange('refused')}
              title="Refuse it whatever their role says">
              <X size={12} />
            </StateButton>
          </>
        )}
      </span>
    </div>
  );
}

/* =============================================================
   Small parts
   ============================================================= */

const PLAIN_INPUT: React.CSSProperties = {
  height: 32, width: '100%', padding: '0 10px', borderRadius: 'var(--r)',
  border: '1px solid var(--border-strong)', background: 'var(--surface)',
  color: 'var(--text)', fontFamily: 'var(--inter)', fontSize: 13, outline: 'none',
};

function StateButton({
  on, tone, onClick, title, children,
}: {
  on: boolean; tone?: 'success' | 'danger'; onClick: () => void;
  title: string; children: React.ReactNode;
}) {
  const colour = tone === 'success' ? 'var(--success)'
    : tone === 'danger' ? 'var(--danger)'
    : 'var(--primary)';
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={on}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        height: 26, minWidth: 30, padding: '0 8px', borderRadius: 'var(--r-sm)',
        border: `1px solid ${on ? colour : 'var(--border)'}`,
        background: on ? colour : 'var(--surface)',
        color: on ? '#FFFFFF' : 'var(--text-muted)',
        fontFamily: 'var(--inter)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
      }}
    >{children}</button>
  );
}

function Stat({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: Tone }) {
  return (
    <div style={{
      padding: '9px 14px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
      background: 'var(--surface)', minWidth: 116,
    }}>
      <Label>{label}</Label>
      <div style={{
        marginTop: 2, fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 20,
        letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums',
        color: tone === 'warning' ? 'var(--warning)' : 'var(--text)',
      }}>{value}</div>
    </div>
  );
}
