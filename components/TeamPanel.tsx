'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Users, Search, Mail, MapPin, Building2, Clock, Briefcase, UserCog, ShieldOff,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  Alert, Badge, Button, Card, Chip, EmptyState, Label, PageHead, PanelHead,
  SearchInput, type Tone,
} from '@/components/kit/primitives';
import { Drawer, Field, Split, TextInput } from '@/components/kit/forms';
import { Avatar } from '@/components/team/avatar';
import { loadTeam, roleInWords, type TeamMember } from '@/lib/platform/team';

/* =============================================================
   Who works here.

   From the business:

     turn Team into a generic team member overview with their details,
     more a handy page allowing admin to become role/permission
     management hub

   Two things, and they are now two tabs. This is the first one: a
   directory, open to anybody signed in, with the details somebody
   actually looks a colleague up for. What they do, where they sit,
   their hours, who they report to, how to reach them.

   The permission half is the Admin tab. It is a different question
   asked by a different person for a different reason, and putting the
   two on one screen made a phone list feel like an access review.

   ---- Why there is no capability check in this file ----

   Because there is nothing here to gate. `team_directory()` fills the
   permission columns only for somebody who may manage users, so a read
   only viewer never has those numbers on the wire. Everything this
   screen renders is a name, a job title and a location, which is the
   noticeboard by the kettle.

   An administrator gets one extra thing: a way through to the Admin
   tab with that person already open, because looking somebody up and
   then wanting to change what they can do is one thought, not two.
   ============================================================= */

type Filter = 'here' | 'off' | 'everybody';

export function TeamPanel({
  selfId, mayManage,
}: { selfId: string; mayManage: boolean }) {
  const supabase = createClient();
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [find, setFind] = useState('');
  const [filter, setFilter] = useState<Filter>('here');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadTeam(supabase).then((done) => {
      if (!alive) return;
      if (done.ok) setTeam(done.value); else setFailure(done.why);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    const all = team ?? [];
    return {
      here: all.filter((m) => m.is_active).length,
      off: all.filter((m) => !m.is_active).length,
      everybody: all.length,
    };
  }, [team]);

  const shown = useMemo(() => {
    const needle = find.trim().toLowerCase();
    return (team ?? []).filter((m) => {
      if (filter === 'here' && !m.is_active) return false;
      if (filter === 'off' && m.is_active) return false;
      if (!needle) return true;
      return [m.full_name, m.email, m.job_title, m.department, m.location, roleInWords(m)]
        .some((f) => (f ?? '').toLowerCase().includes(needle));
    });
  }, [team, find, filter]);

  const member = useMemo(() => (team ?? []).find((m) => m.id === open) ?? null, [team, open]);

  if (failure) return <div className="kit"><Alert tone="danger">{failure}</Alert></div>;

  return (
    <div className="kit">
      <PageHead
        eyebrow="The people here"
        title={<><Users size={26} style={{ color: 'var(--accent)' }} /><span>Team</span></>}
        sub="Who works here, what they look after and how to reach them."
        action={mayManage ? (
          <Link href="/dashboard/admin" style={{ textDecoration: 'none' }}>
            <Button variant="secondary"><UserCog size={14} /> Roles and permissions</Button>
          </Link>
        ) : undefined}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', marginBottom: 12 }}>
        <SearchInput
          value={find}
          onChange={setFind}
          placeholder="Find somebody by name, email, job title, department or where they are"
          icon={<Search size={14} />}
        />
        <Chip active={filter === 'here'} count={counts.here} onClick={() => setFilter('here')}>Here</Chip>
        <Chip active={filter === 'off'} count={counts.off} onClick={() => setFilter('off')}>Turned off</Chip>
        <Chip active={filter === 'everybody'} count={counts.everybody} onClick={() => setFilter('everybody')}>
          Everybody
        </Chip>
      </div>

      {team == null ? (
        <Card><span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>Loading the team.</span></Card>
      ) : shown.length === 0 ? (
        <Card>
          <EmptyState what="Nobody matches that"
            why="Try a different search, or widen the filter to everybody."
          />
        </Card>
      ) : (
        <div style={{
          display: 'grid', gap: 12,
          gridTemplateColumns: 'repeat(auto-fill, minmax(276px, 1fr))',
        }}>
          {shown.map((m) => (
            <button
              key={m.id}
              onClick={() => setOpen(m.id)}
              style={{
                display: 'flex', gap: 12, alignItems: 'flex-start', textAlign: 'left',
                padding: 14, cursor: 'pointer',
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)', opacity: m.is_active ? 1 : 0.62,
              }}
            >
              <Avatar name={m.full_name} url={m.photo_url} size={40} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{
                  display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap',
                  fontSize: 13.5, fontWeight: 600, color: 'var(--text)',
                }}>
                  {m.full_name || m.email}
                  {m.id === selfId && <Badge tone="neutral">You</Badge>}
                </span>
                <span style={{
                  display: 'block', marginTop: 2, fontSize: 12, color: 'var(--text-muted)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {m.job_title || 'No job title yet'}
                </span>
                <span style={{
                  display: 'block', marginTop: 6, fontSize: 11.5, color: 'var(--text-subtle)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {[m.department, m.location].filter(Boolean).join(' · ') || m.email}
                </span>
                <span style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  <Badge tone={roleTone(m)}>{roleInWords(m)}</Badge>
                  {!m.is_active && <Badge tone="warning">Turned off</Badge>}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {member && (
        <PersonDrawer
          member={member}
          isSelf={member.id === selfId}
          mayManage={mayManage}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function PersonDrawer({
  member, isSelf, mayManage, onClose,
}: { member: TeamMember; isSelf: boolean; mayManage: boolean; onClose: () => void }) {
  const supabase = createClient();
  const [extra, setExtra] = useState<{
    timezone: string | null; working_hours: string | null;
    responsibilities: string | null; skills: string[] | null;
  } | null>(null);

  /* The columns the directory function does not carry, read for the one
     person somebody opened rather than for all of them. A list of forty
     people does not need everybody's responsibilities paragraph on the
     wire to render forty cards. */
  useEffect(() => {
    let alive = true;
    supabase
      .from('profiles')
      .select('timezone, working_hours, responsibilities, skills')
      .eq('id', member.id)
      .single()
      .then(({ data }) => {
        if (alive && data) setExtra(data as typeof extra);
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member.id]);

  const skills = extra?.skills ?? [];

  return (
    <Drawer
      eyebrow={roleInWords(member)}
      title={member.full_name || member.email || 'This person'}
      icon={<Avatar name={member.full_name} url={member.photo_url} size={36} />}
      onClose={onClose}
      width={640}
      footer={
        <>
          <span style={{ flex: 1, fontSize: 11.5, color: 'var(--text-subtle)' }}>
            {isSelf
              ? 'This is you. Your own details are yours to change on Settings.'
              : mayManage
                ? 'Their role and permissions are on the Admin tab.'
                : 'Their details are set by them and by an administrator.'}
          </span>
          {isSelf && (
            <Link href="/dashboard/settings" style={{ textDecoration: 'none' }}>
              <Button variant="primary">Edit my details</Button>
            </Link>
          )}
          {!isSelf && mayManage && (
            <Link href={`/dashboard/admin?person=${member.id}`} style={{ textDecoration: 'none' }}>
              <Button variant="primary"><UserCog size={14} /> Manage their access</Button>
            </Link>
          )}
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      {!member.is_active && (
        <Alert tone="warning">
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldOff size={14} /> This account is turned off. Everything they own is
            still here and still theirs.
          </span>
        </Alert>
      )}

      <Card padded={false}>
        <PanelHead title="How to reach them" />
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 13 }}>
          <Split cols={2}>
            <Field label="Email">
              <TextInput value={member.email ?? ''} readOnly trailing={<Mail size={13} />} />
            </Field>
            <Field label="Where they are based">
              <TextInput value={member.location ?? ''} readOnly placeholder="Not recorded" trailing={<MapPin size={13} />} />
            </Field>
          </Split>
          <Split cols={2}>
            <Field label="Working hours">
              <TextInput value={extra?.working_hours ?? ''} readOnly placeholder="Not recorded" trailing={<Clock size={13} />} />
            </Field>
            <Field label="Time zone">
              <TextInput value={extra?.timezone ?? ''} readOnly placeholder="Not recorded" />
            </Field>
          </Split>
        </div>
      </Card>

      <Card padded={false}>
        <PanelHead title="What they do" />
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 13 }}>
          <Split cols={2}>
            <Field label="Job title">
              <TextInput value={member.job_title ?? ''} readOnly placeholder="Not recorded" trailing={<Briefcase size={13} />} />
            </Field>
            <Field label="Department">
              <TextInput value={member.department ?? ''} readOnly placeholder="Not recorded" trailing={<Building2 size={13} />} />
            </Field>
          </Split>
          <Split cols={2}>
            <Field label="Reports to">
              <TextInput value={member.manager ?? ''} readOnly placeholder="Nobody recorded" />
            </Field>
            <Field label="Joined">
              <TextInput
                value={member.joined ? new Date(member.joined).toLocaleDateString('en-GB') : ''}
                readOnly
              />
            </Field>
          </Split>

          <Field label="What they look after">
            <div style={{
              minHeight: 32, padding: '9px 10px', borderRadius: 'var(--r)',
              border: '1px solid var(--border)', background: 'var(--surface-sunken)',
              fontSize: 12.5, color: extra?.responsibilities ? 'var(--text-muted)' : 'var(--text-subtle)',
              lineHeight: 1.5,
            }}>
              {extra?.responsibilities || 'Nothing recorded yet.'}
            </div>
          </Field>

          <div>
            <Label>Skills</Label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {skills.length === 0
                ? <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>None recorded yet.</span>
                : skills.map((s) => <Badge key={s} tone="neutral">{s}</Badge>)}
            </div>
          </div>
        </div>
      </Card>
    </Drawer>
  );
}

function roleTone(member: TeamMember): Tone {
  if (!member.is_active) return 'neutral';
  if (member.template_slug === 'administrator' || member.role === 'admin') return 'accent';
  if (member.role === 'viewer' && !member.template_slug) return 'neutral';
  return 'info';
}
