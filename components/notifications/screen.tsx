'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, Filter, Search } from 'lucide-react';
import { useNotifications } from '@/lib/notifications/client';
import {
  CATEGORIES, type NotificationAction, type NotificationRow,
} from '@/lib/notifications/types';
import { NotificationCard } from '@/components/notifications/card';
import { NotificationPrefs } from '@/components/notifications/prefs';
import {
  Badge, Button, Chip, EmptyState, RecordHead, SearchInput, TabShell, Tabs,
} from '@/components/kit/primitives';
import { useToast } from '@/components/kit/toast';

/* =============================================================
   Everything, on its own screen.

   The panel in the top bar is for glancing. This is for the times
   somebody has been away for a week and wants to work through it: the
   whole list, searchable, with the ones still waiting on them first.

   Three tabs and not four. Yours, the business, and the settings,
   because "what am I being told" and "what do I want to be told" are
   the same question asked in two directions and splitting them across
   two screens means finding the second one.
   ============================================================= */

type Tab = 'personal' | 'team' | 'settings';

export function NotificationScreen({ openTab = 'personal' }: { openTab?: Tab }) {
  const router = useRouter();
  const { say } = useToast();
  const [tab, setTab] = useState<Tab>(openTab);
  const [search, setSearch] = useState('');
  const [onlyWaiting, setOnlyWaiting] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);

  const feed = useNotifications('all');
  const {
    items, counts, loading, provisioned,
    markRead, markAllRead, dismiss, acted, answerInvite,
  } = feed;

  const mine = useMemo(
    () => items.filter((n) => n.audience === (tab === 'team' ? 'team' : 'personal')),
    [items, tab],
  );

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return mine.filter((n) => {
      if (onlyWaiting && (n.actioned_at || !['urgent', 'attention'].includes(n.severity))) return false;
      if (categories.length > 0 && !categories.includes(categoryOf(n.kind))) return false;
      if (!needle) return true;
      return `${n.title} ${n.body ?? ''}`.toLowerCase().includes(needle);
    });
  }, [mine, search, onlyWaiting, categories]);

  /* Which groups are actually represented, so the chip row is not
     eight chips over a list of two things. */
  const present = useMemo(() => {
    const seen = new Map<string, number>();
    for (const n of mine) {
      const c = categoryOf(n.kind);
      seen.set(c, (seen.get(c) ?? 0) + 1);
    }
    return CATEGORIES.filter((c) => seen.has(c.key))
      .map((c) => ({ ...c, count: seen.get(c.key) ?? 0 }));
  }, [mine]);

  const go = useCallback((n: NotificationRow) => {
    if (!n.read_at) markRead([n.id]);
    if (n.link_path) router.push(n.link_path);
  }, [markRead, router]);

  const doAction = useCallback(async (n: NotificationRow, a: NotificationAction) => {
    if (a.does === 'open') { go(n); return; }

    if (a.does === 'done') {
      await acted(n.id, a.key);
      say({ tone: 'success', title: 'Noted', body: n.title });
      return;
    }

    if (a.does === 'download') {
      const url = (n.payload as { fileUrl?: unknown } | null)?.fileUrl;
      if (typeof url === 'string') {
        await acted(n.id, 'download');
        window.location.href = url;
      } else {
        say({ tone: 'warning', title: 'That file has gone', body: 'Run the export again.' });
      }
      return;
    }

    const done = await answerInvite(n, a);
    say(done.ok
      ? {
        tone: 'success',
        title: a.key === 'accept' ? 'You are down as coming' : 'They know you cannot make it',
        body: n.title,
      }
      : { tone: 'danger', title: 'That did not go through', body: done.message });
  }, [acted, answerInvite, go, say]);

  return (
    <TabShell>
      <RecordHead
        icon={<Bell size={19} />}
        title="Notifications"
        badges={tab === 'settings' ? undefined : (
          <>
            {counts.waiting > 0 && (
              <Badge tone="warning" dot>
                {counts.waiting === 1 ? '1 waiting on you' : `${counts.waiting} waiting on you`}
              </Badge>
            )}
            {(counts.personal + counts.team) > 0 && (
              <Badge tone="neutral">{counts.personal + counts.team} unread</Badge>
            )}
          </>
        )}
        sub={tab === 'settings'
          ? 'Every kind of thing this application can tell you, and whether it does.'
          : 'Anything asking something of you sits at the top, whatever order it arrived in.'}
        actions={tab !== 'settings' && (counts.personal + counts.team) > 0 ? (
          <Button size="sm" variant="secondary" onClick={() => markAllRead(tab)}>
            <CheckCheck size={13} /> Mark them read
          </Button>
        ) : undefined}
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'personal' as const, label: 'Yours', count: counts.personal },
          { key: 'team' as const, label: 'The business', count: counts.team },
          { key: 'settings' as const, label: 'What you get told' },
        ]}
      />

      {tab === 'settings' ? (
        <div style={{ marginTop: 14 }}><NotificationPrefs /></div>
      ) : (
        <>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'nowrap',
            margin: '14px 0 12px', minWidth: 0,
          }}>
            <div style={{ flex: '0 1 280px', minWidth: 160 }}>
              <SearchInput
                value={search} onChange={setSearch}
                placeholder="Find one"
                icon={<Search size={13} />}
              />
            </div>

            <Chip
              active={onlyWaiting}
              onClick={() => setOnlyWaiting((v) => !v)}
            >
              <Filter size={12} /> Waiting on me
            </Chip>

            {/* The groups present, scrolling rather than wrapping, so
                the list underneath never gets pushed down the page. */}
            <div style={{
              display: 'flex', gap: 7, overflowX: 'auto', flex: 1, minWidth: 0,
              paddingBottom: 2,
              maskImage: 'linear-gradient(to right, black calc(100% - 24px), transparent)',
            }}>
              {present.map((c) => (
                <Chip
                  key={c.key}
                  active={categories.includes(c.key)}
                  onClick={() => setCategories((cs) => (
                    cs.includes(c.key) ? cs.filter((k) => k !== c.key) : [...cs, c.key]
                  ))}
                  count={c.count}
                >{c.label}</Chip>
              ))}
            </div>
          </div>

          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)', overflow: 'hidden',
            flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
              {!provisioned ? (
                <div style={{ padding: 16 }}>
                  <EmptyState
                    what="Not wired up yet"
                    why="The notification tables are not in this database. Run migrations 065 and 066."
                  />
                </div>
              ) : loading && shown.length === 0 ? (
                <div style={{ padding: '22px 16px', fontSize: 12.5, color: 'var(--text-subtle)' }}>
                  Looking.
                </div>
              ) : shown.length === 0 ? (
                <div style={{ padding: 16 }}>
                  <EmptyState
                    what={mine.length === 0
                      ? (tab === 'personal' ? 'Nothing waiting on you' : 'Nothing from the business')
                      : 'Nothing matches that'}
                    why={mine.length === 0
                      ? (tab === 'personal'
                        ? 'Invitations, tasks, commission to confirm and anything else that needs you turns up here.'
                        : 'Deals landing, contracts signed and monthly figures. All off by default: turn on what you want under What you get told.')
                      : 'Clear the search or the filters above.'}
                    action={mine.length > 0 ? (
                      <Button size="sm" variant="secondary" onClick={() => {
                        setSearch(''); setOnlyWaiting(false); setCategories([]);
                      }}>Clear them</Button>
                    ) : undefined}
                  />
                </div>
              ) : (
                shown.map((n) => (
                  <NotificationCard
                    key={n.id} n={n}
                    onAction={doAction}
                    onOpen={go}
                    onDismiss={(x) => dismiss(x.id)}
                  />
                ))
              )}
            </div>
          </div>
        </>
      )}
    </TabShell>
  );
}

/** The catalogue's category, from the kind, without a second round trip. */
function categoryOf(kind: string): string {
  const head = kind.split('.')[0];
  switch (head) {
    case 'meeting': case 'call': case 'diary': case 'guest': return 'diary';
    case 'task': return 'work';
    case 'crm': return 'crm';
    case 'content': return 'content';
    case 'sales': return 'sales';
    case 'fleetsmart': return 'fleetsmart';
    case 'team': return 'team';
    default: return 'admin';
  }
}
