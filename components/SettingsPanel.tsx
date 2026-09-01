'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Settings, KeyRound, Sun, Moon, ShieldCheck, Check, Minus, Loader, Save,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { NotificationPrefs } from '@/components/notifications/prefs';
import {
  Alert, Badge, Button, Card, Label, PageHead, PanelHead, Tabs,
} from '@/components/kit/primitives';
import { Field, Split, TextArea, TextInput } from '@/components/kit/forms';
import { Toasts, useToast } from '@/components/kit/toast';
import {
  byArea, loadMyCapabilities, roleInWords, updateMyProfile,
  type ResolvedCapability,
} from '@/lib/platform/team';
import type { Profile } from '@/lib/types';

/* =============================================================
   Your own account, and nothing about anybody else's.

   From the business:

     This settings should cover everything a user needs to manage in
     their own accounts ... ensure only admins can see all settings and
     other roles see settings and admin features relative to their role

   ---- Where the line falls, and why it is not a role check ----

   There is no capability gate anywhere on this screen, deliberately.
   Everything here is about the person reading it: their name, their
   password, their theme, what the application tells them, and what they
   are allowed to do. None of that is privileged information about them,
   and a settings page that hid a person's own permissions from them
   would answer "why can I not see the tracker" with silence.

   The permission dependence is the other way round: this screen shows
   the same five tabs to everybody and the CONTENT of the last one
   differs, because it is read from `my_capabilities()` and that answers
   for whoever is asking. Somebody in a read only role opens Access and
   sees which twelve of the seventy they hold, which is exactly the
   question they came to ask.

   Managing anybody else lives on the Team screen and is gated there, on
   `admin.users`, in the database.

   ---- Why the profile fields go through an RPC ----

   `profiles` is writable by row level security for your own row, which
   is how the old version of this screen saved a name. That same policy
   let a person write `role_template_id` on themselves until migration
   073, because the trigger guarding it was written before that column
   existed. `update_my_profile` names the nine columns somebody owns, so
   the reachable set is a signature rather than a policy.
   ============================================================= */

type Tab = 'profile' | 'password' | 'appearance' | 'notifications' | 'access';

export function SettingsPanel({
  profile, openTab = 'profile',
}: { profile: Profile & Record<string, unknown>; openTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(openTab);

  return (
    <Toasts>
      <div className="kit">
        <PageHead
          eyebrow="Your account"
          title={<><Settings size={26} style={{ color: 'var(--accent)' }} /><span>Settings</span></>}
          sub="Your details, how you sign in, how this looks, what it tells you, and what you are allowed to do."
        />

        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'profile' as Tab, label: 'Profile' },
            { key: 'password' as Tab, label: 'Password' },
            { key: 'appearance' as Tab, label: 'Appearance' },
            { key: 'notifications' as Tab, label: 'Notifications' },
            { key: 'access' as Tab, label: 'What you can do' },
          ]}
        />

        <div style={{ marginTop: 16 }}>
          {tab === 'profile' && <ProfileTab profile={profile} />}
          {tab === 'password' && <PasswordTab email={profile.email} />}
          {tab === 'appearance' && <AppearanceTab profile={profile} />}
          {tab === 'notifications' && <NotificationPrefs />}
          {tab === 'access' && <AccessTab profile={profile} />}
        </div>
      </div>
    </Toasts>
  );
}

/* =============================================================
   Profile
   ============================================================= */

function ProfileTab({ profile }: { profile: Profile & Record<string, unknown> }) {
  const supabase = createClient();
  const { say } = useToast();
  const [saving, setSaving] = useState(false);

  const text = (key: string) => String((profile[key] as string | null) ?? '');

  const [form, setForm] = useState({
    full_name: profile.full_name ?? '',
    job_title: text('job_title'),
    location: text('location'),
    timezone: text('timezone'),
    working_hours: text('working_hours'),
    responsibilities: text('responsibilities'),
    skills: (Array.isArray(profile.skills) ? (profile.skills as string[]) : []).join(', '),
  });

  const set = (key: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [key]: v }));

  async function save() {
    if (!form.full_name.trim()) {
      say({ tone: 'danger', title: 'A name is how everybody else finds you', body: 'It cannot be blank.' });
      return;
    }
    setSaving(true);
    const done = await updateMyProfile(supabase, {
      full_name: form.full_name,
      job_title: form.job_title,
      location: form.location,
      timezone: form.timezone,
      working_hours: form.working_hours,
      responsibilities: form.responsibilities,
      /* An empty box means no skills, not "leave them alone". Splitting
         an empty string in JavaScript gives `['']`, which would save one
         blank skill and show as an empty chip on the team screen. */
      skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean),
    });
    setSaving(false);
    if (!done.ok) { say({ tone: 'danger', title: 'Not saved', body: done.why }); return; }
    say({ tone: 'success', title: 'Saved', body: 'Your details are on the team directory now.' });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 820 }}>
      <Card padded={false}>
        <PanelHead title="Who you are" hint="Everybody on the team can see this" />
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Split cols={2}>
            <Field label="Full name" hint="How you appear on leads, meetings and the team list">
              <TextInput value={form.full_name} onChange={set('full_name')} />
            </Field>
            <Field label="Job title" hint="Leave it empty to remove it">
              <TextInput value={form.job_title} onChange={set('job_title')} placeholder="Sales Manager" />
            </Field>
          </Split>

          <Split cols={2}>
            <Field label="Where you are based">
              <TextInput value={form.location} onChange={set('location')} placeholder="Stockport" />
            </Field>
            <Field label="Working hours" hint="So nobody books you at seven in the morning">
              <TextInput value={form.working_hours} onChange={set('working_hours')} placeholder="Mon to Fri, 8am to 5pm" />
            </Field>
          </Split>

          <Field label="What you look after" hint="A line or two. It shows on your card in the team list.">
            <TextArea
              value={form.responsibilities}
              onChange={set('responsibilities')}
              rows={3}
              placeholder="Maintenance contracts and the Carrington depot."
            />
          </Field>

          <Field label="Skills" hint="Separated by commas">
            <TextInput value={form.skills} onChange={set('skills')} placeholder="Curtainsiders, FleetSmart+, Tail lifts" />
          </Field>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
          borderTop: '1px solid var(--border)', background: 'var(--bg-subtle)',
        }}>
          <span style={{ flex: 1, fontSize: 11.5, color: 'var(--text-subtle)' }}>
            An empty box clears that field. Nothing else on your account changes.
          </span>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? <Loader size={14} className="spin" /> : <Save size={14} />} Save
          </Button>
        </div>
      </Card>

      <Card padded={false}>
        <PanelHead title="Set for you" hint="An administrator changes these on the Team screen" />
        <div style={{ padding: 16 }}>
          <Split cols={2}>
            <Field label="Email" hint="This is how you sign in">
              <TextInput value={profile.email} readOnly />
            </Field>
            <Field label="Your role" hint="What this decides is on the Access tab">
              <div style={{ display: 'flex', alignItems: 'center', height: 32 }}>
                <Badge tone="info">
                  {roleInWords({
                    role: profile.role,
                    role_template: (profile.role_template as string | null) ?? null,
                  })}
                </Badge>
              </div>
            </Field>
          </Split>
        </div>
      </Card>
    </div>
  );
}

/* =============================================================
   Password
   ============================================================= */

function PasswordTab({ email }: { email: string }) {
  const supabase = createClient();
  const { say } = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [saving, setSaving] = useState(false);

  /* Supabase's own floor. Named here so somebody reads it before
     typing rather than after being refused. */
  const TOO_SHORT = 6;

  async function change() {
    if (next !== again) {
      say({ tone: 'danger', title: 'Those two do not match', body: 'Type the new one again.' });
      return;
    }
    if (next.length < TOO_SHORT) {
      say({ tone: 'danger', title: 'Too short', body: `A password needs at least ${TOO_SHORT} characters.` });
      return;
    }
    setSaving(true);

    /* Signing in again first, with the password they typed. Supabase
       will change a password on a live session without asking for the
       old one, which means an unattended machine is a takeover. */
    const { error: wrong } = await supabase.auth.signInWithPassword({ email, password: current });
    if (wrong) {
      setSaving(false);
      say({ tone: 'danger', title: 'That is not your current password', body: 'Nothing has changed.' });
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: next });
    setSaving(false);
    if (error) { say({ tone: 'danger', title: 'Not changed', body: error.message }); return; }
    setCurrent(''); setNext(''); setAgain('');
    say({ tone: 'success', title: 'Password changed', body: 'Use the new one next time you sign in.' });
  }

  return (
    <div style={{ maxWidth: 520 }}>
      <Card padded={false}>
        <PanelHead title="Change your password" />
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Current password">
            <TextInput type="password" value={current} onChange={setCurrent} />
          </Field>
          <Field label="New password" hint={`At least ${TOO_SHORT} characters`}>
            <TextInput type="password" value={next} onChange={setNext} />
          </Field>
          <Field label="New password again">
            <TextInput type="password" value={again} onChange={setAgain} />
          </Field>
          <Alert tone="info">
            You are asked for the current one because changing a password on a signed in
            session without it would make any unattended screen a way in.
          </Alert>
        </div>
        <div style={{
          display: 'flex', justifyContent: 'flex-end', padding: '12px 16px',
          borderTop: '1px solid var(--border)', background: 'var(--bg-subtle)',
        }}>
          <Button variant="primary" onClick={change} disabled={saving || !current || !next}>
            {saving ? <Loader size={14} className="spin" /> : <KeyRound size={14} />} Change password
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* =============================================================
   Appearance
   ============================================================= */

function AppearanceTab({ profile }: { profile: Profile }) {
  const supabase = createClient();
  const { say } = useToast();
  const [theme, setTheme] = useState<'dark' | 'light'>(profile.theme ?? 'dark');

  async function apply(t: 'dark' | 'light') {
    const was = theme;
    setTheme(t);

    /* Three places, and all three are needed. The attribute is this tab
       right now, the cookie is the server render on the next navigation
       so the page does not flash the old theme, and the column is every
       other device. Setting one of the three is the bug where a theme
       changes and then changes back on reload. */
    document.documentElement.setAttribute('data-theme', t);
    document.cookie = `stc_theme=${t}; path=/; max-age=${60 * 60 * 24 * 365}`;

    const done = await updateMyProfile(supabase, { theme: t });
    if (!done.ok) {
      setTheme(was);
      document.documentElement.setAttribute('data-theme', was);
      say({ tone: 'danger', title: 'Not saved', body: done.why });
    }
  }

  return (
    <div style={{ maxWidth: 520 }}>
      <Card padded={false}>
        <PanelHead title="Theme" />
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 9 }}>
            <Button variant={theme === 'dark' ? 'primary' : 'secondary'} onClick={() => apply('dark')}>
              <Moon size={14} /> Dark
            </Button>
            <Button variant={theme === 'light' ? 'primary' : 'secondary'} onClick={() => apply('light')}>
              <Sun size={14} /> Light
            </Button>
          </div>
          <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
            Saved to your account, so it follows you onto any machine you sign in on.
          </span>
        </div>
      </Card>
    </div>
  );
}

/* =============================================================
   What you can do

   Read only, and complete. Both halves matter: somebody looking at this
   is usually asking why a button is not there, and a list of only what
   they hold cannot answer that.
   ============================================================= */

function AccessTab({ profile }: { profile: Profile & Record<string, unknown> }) {
  const supabase = createClient();
  const [lines, setLines] = useState<ResolvedCapability[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    loadMyCapabilities(supabase).then((done) => {
      if (!alive) return;
      if (done.ok) setLines(done.value); else setFailure(done.why);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const held = useMemo(() => (lines ?? []).filter((l) => l.granted).length, [lines]);
  const shown = useMemo(
    () => byArea((lines ?? []).filter((l) => showAll || l.granted)),
    [lines, showAll],
  );

  if (failure) return <Alert tone="danger">{failure}</Alert>;
  if (!lines) return <Alert tone="info">Working out what you can do.</Alert>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 820 }}>
      <Card padded={false}>
        <PanelHead
          title="Your access"
          hint={`${held} of ${lines.length} permissions`}
          action={
            <Button size="sm" variant={showAll ? 'primary' : 'secondary'} onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Only what you have' : 'Show everything'}
            </Button>
          }
        />
        <div style={{ padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 11 }}>
          <ShieldCheck size={16} style={{ color: 'var(--accent)', flex: 'none' }} />
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            You are on {roleInWords({
              role: profile.role,
              role_template: (profile.role_template as string | null) ?? null,
            })}. Most of what you can do comes from that. Anything granted or refused
            to you personally is marked, and only an administrator can change either.
          </span>
        </div>
      </Card>

      {shown.map((area) => (
        <Card key={area.area} padded={false}>
          <PanelHead
            title={area.area}
            count={area.features.reduce((n, f) => n + f.items.filter((i) => i.granted).length, 0)}
          />
          {area.features.map((feature, fi) => (
            <div key={feature.feature}>
              <div style={{
                padding: '8px 16px 6px',
                borderTop: fi === 0 ? 0 : '1px solid var(--border)',
              }}>
                <Label>{feature.feature}</Label>
              </div>
              {feature.items.map((item) => (
                <div
                  key={item.key}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 11,
                    padding: '8px 16px 10px',
                    opacity: item.granted ? 1 : 0.55,
                  }}
                >
                  <span style={{
                    width: 18, height: 18, flex: 'none', marginTop: 1,
                    borderRadius: 'var(--r-full)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: item.granted ? 'var(--success-bg, var(--bg-subtle))' : 'var(--bg-subtle)',
                    color: item.granted ? 'var(--success)' : 'var(--text-subtle)',
                    border: '1px solid var(--border)',
                  }}>
                    {item.granted ? <Check size={11} /> : <Minus size={11} />}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{
                      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                      fontSize: 13, color: 'var(--text)',
                    }}>
                      {item.label}
                      {item.source.includes('specifically') && (
                        <Badge tone={item.granted ? 'success' : 'warning'}>{item.source}</Badge>
                      )}
                    </span>
                    <span style={{
                      display: 'block', fontSize: 11.5, color: 'var(--text-subtle)',
                      lineHeight: 1.45, marginTop: 2,
                    }}>{item.description}</span>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </Card>
      ))}

      {shown.length === 0 && (
        <Alert tone="warning">
          You hold no permissions at all, which is almost certainly wrong. Ask an
          administrator to look at your role on the Team screen.
        </Alert>
      )}
    </div>
  );
}
