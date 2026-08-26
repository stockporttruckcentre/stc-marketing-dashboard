'use client';

import { useMemo, useState } from 'react';
import { notFound } from 'next/navigation';
import { Bell } from 'lucide-react';
import type { NotificationAction, NotificationRow } from '@/lib/notifications/types';
import { NotificationCard } from '@/components/notifications/card';
import { Sidebar } from '@/components/Sidebar';
import { Button, RecordHead, Tabs } from '@/components/kit/primitives';
import { Switch } from '@/components/kit/forms';
import { Toasts, useToast } from '@/components/kit/toast';
import type { Profile } from '@/lib/types';

/* =============================================================
   The notification surfaces, drawn against fabricated rows.

   Dev only. It exists for the same reason the diary preview does: the
   real screens need a session and a database, so the only way to look
   at them at a real window size is to render the real components
   against rows made up here.

   Nothing in this file is a mock of a component. The card, the switch,
   the toast, the tabs and the shell are all the shipped ones. Only the
   data is invented, and it is invented to be awkward: a bunch of three,
   a title with no spaces in it, a body four lines long, one of each
   severity, and an invitation that still needs answering.
   ============================================================= */

const ME = '00000000-0000-0000-0000-0000000000aa';

const viewer: Profile = {
  id: ME,
  email: 'alex@stockporttruckcentre.co.uk',
  full_name: 'Alex Ellis',
  role: 'admin',
  theme: 'dark',
  created_at: new Date().toISOString(),
} as Profile;

function row(over: Partial<NotificationRow>): NotificationRow {
  const now = new Date();
  return {
    id: Math.random().toString(36).slice(2),
    user_id: ME,
    kind: 'system.message',
    title: 'Something happened',
    body: null,
    link_path: '/dashboard',
    audience: 'personal',
    severity: 'info',
    group_key: null,
    item_count: 1,
    subject_kind: null,
    subject_id: null,
    payload: {},
    actor_id: null,
    read_at: null,
    dismissed_at: null,
    actioned_at: null,
    action_taken: null,
    due_at: null,
    expires_at: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    ...over,
  };
}

const ROWS: NotificationRow[] = [
  row({
    kind: 'meeting.invited',
    severity: 'attention',
    title: 'Tom Moore has asked you to Site visit, Carrington',
    body: 'Thu 04 Sep, 09:30',
    payload: { inviteId: 'preview' },
    updated_at: new Date(Date.now() - 4 * 60_000).toISOString(),
  }),
  row({
    kind: 'sales.commission',
    severity: 'attention',
    title: 'Confirm your commission on STC143980',
    body: '2021 Cartwright Curtainsider. Sold for £24,500 to Marsden Logistics. '
      + 'Margin £4,100 (16.7%). Your commission works out at £410.00',
    payload: { confirm: true },
    updated_at: new Date(Date.now() - 40 * 60_000).toISOString(),
  }),
  row({
    kind: 'crm.account_assigned',
    severity: 'attention',
    title: '3 accounts were assigned to you',
    item_count: 3,
    group_key: 'account-assigned:tom',
    payload: {
      allLink: '/dashboard/crm?owner=me',
      items: [
        { title: 'Dawson Group is yours', body: 'Carrington, 12 vehicles', link: '/dashboard/crm?id=1', id: null },
        { title: 'Eddie Stobart is yours', body: 'Warrington, 4 vehicles', link: '/dashboard/crm?id=2', id: null },
        { title: 'Wincanton is yours', body: null, link: '/dashboard/crm?id=3', id: null },
      ],
    },
    updated_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
  }),
  row({
    kind: 'fleetsmart.renewal',
    severity: 'attention',
    title: 'FS-31 for Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch Haulage runs out in a month',
    body: 'It ends 26 Sep 2026. £18,400.00 a year, 34 assets. Nothing has been raised to replace it.',
    payload: { allLink: '/dashboard/fleetsmart' },
    updated_at: new Date(Date.now() - 26 * 3600_000).toISOString(),
  }),
  row({
    kind: 'task.overdue',
    severity: 'urgent',
    title: 'Chase the signed order for Marsden',
    body: 'It was due 24 Aug.',
    read_at: new Date().toISOString(),
    updated_at: new Date(Date.now() - 2 * 24 * 3600_000).toISOString(),
  }),
  row({
    kind: 'crm.export_ready',
    title: 'You exported Marsden Logistics as a spreadsheet',
    body: 'Marsden-Logistics.xlsx. Kept here for a month, so you can download it again if you lose it.',
    payload: { fileUrl: '#', kept: true },
    read_at: new Date().toISOString(),
    updated_at: new Date(Date.now() - 5 * 24 * 3600_000).toISOString(),
  }),
  row({
    kind: 'admin.role_changed',
    severity: 'urgent',
    title: 'You are now an administrator',
    body: 'You were Sales user. Changed by Tom Moore. What you can reach has changed with it.',
    actioned_at: new Date().toISOString(),
    action_taken: 'confirmed',
    read_at: new Date().toISOString(),
    updated_at: new Date(Date.now() - 9 * 24 * 3600_000).toISOString(),
  }),
];

export default function NotificationsPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <Toasts>
      <Shell />
    </Toasts>
  );
}

function Shell() {
  const { say } = useToast();
  const [tab, setTab] = useState<'feed' | 'panel' | 'switches'>('feed');
  const [rows, setRows] = useState(ROWS);
  const [on, setOn] = useState<Record<string, boolean>>({
    a: true, b: false, c: true, d: true,
  });

  const waiting = useMemo(
    () => rows.filter((r) => !r.read_at).length,
    [rows],
  );

  const act = (n: NotificationRow, a: NotificationAction) => {
    setRows((rs) => rs.map((r) => (r.id === n.id
      ? { ...r, actioned_at: new Date().toISOString(), action_taken: a.key, read_at: r.read_at ?? new Date().toISOString() }
      : r)));
    say({ tone: 'success', title: 'Noted', body: n.title });
  };

  return (
    <div className="app">
      <Sidebar profile={viewer} pendingPosts={0} emblemUrl={null} />
      <div className="main">
        <div style={{
          height: 52, flex: 'none', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', padding: '0 16px', gap: 16,
        }}>
          <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>Workspace / Notifications</span>
          <span style={{ flex: 1 }} />
          <div className="kit" style={{ width: 380 }}>
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { key: 'feed' as const, label: 'The list' },
                { key: 'panel' as const, label: 'The panel' },
                { key: 'switches' as const, label: 'Switches and toasts' },
              ]}
            />
          </div>
        </div>

        <main className="page">
          <div className="kit" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <RecordHead
              icon={<Bell size={19} />}
              title="Notifications"
              sub={`${waiting} unread. Fabricated rows, real components.`}
            />

            {tab === 'switches' ? (
              <div style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)', padding: '18px 20px',
                display: 'flex', flexDirection: 'column',
              }}>
                {[
                  ['a', 'Somebody asks you to a meeting', 'With accept, decline and suggest another time on the notification itself.'],
                  ['b', 'A post is about to go out', 'An hour before a scheduled post publishes.'],
                  ['c', 'A contract is coming up for renewal', 'A month out, a fortnight out, a week out, and the day it lapses.'],
                  ['d', 'Your role or permissions change', 'Cannot be turned off. It changes what the application will let you do.'],
                ].map(([key, label, blurb], i) => (
                  <div key={key} style={{
                    display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0',
                    borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                  }}>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.45 }}>{blurb}</span>
                    </div>
                    <Switch
                      checked={on[key]}
                      disabled={key === 'd'}
                      lockedReason={key === 'd' ? 'This one cannot be turned off.' : undefined}
                      onChange={(v) => setOn((s) => ({ ...s, [key]: v }))}
                    />
                  </div>
                ))}

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
                  <Button size="sm" variant="accent"
                    onClick={() => say({ tone: 'success', title: 'You are down as coming', body: 'Site visit, Carrington' })}>
                    Success toast
                  </Button>
                  <Button size="sm" variant="secondary"
                    onClick={() => say({ tone: 'danger', title: 'That did not go through', body: 'The invitation has been withdrawn.' })}>
                    Failure toast
                  </Button>
                  <Button size="sm" variant="secondary"
                    onClick={() => say({ tone: 'warning', title: 'Account archived', action: { label: 'Undo', onClick: () => {} } })}>
                    Undo toast
                  </Button>
                  <Button size="sm" variant="ghost"
                    onClick={() => say({ tone: 'info', title: 'Exporting 1,284 rows', pending: true, after: 4000 })}>
                    In flight
                  </Button>
                </div>
              </div>
            ) : (
              <div style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)', overflow: 'hidden',
                width: tab === 'panel' ? 400 : undefined,
                boxShadow: tab === 'panel' ? 'var(--shadow-3)' : undefined,
              }}>
                {rows.map((n) => (
                  <NotificationCard
                    key={n.id} n={n} compact={tab === 'panel'}
                    onAction={act}
                    onOpen={() => say({ tone: 'info', title: 'Would open', body: n.link_path ?? '' })}
                    onDismiss={(x) => setRows((rs) => rs.filter((r) => r.id !== x.id))}
                  />
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
