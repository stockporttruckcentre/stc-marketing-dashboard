'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, ExternalLink, Search } from 'lucide-react';
import type { CalendarEvent } from '@/lib/types';
import {
  diaryCounts, filterDiary, groupByDay, toEntries,
  type DiaryInvite, type DiaryPerson,
} from '@/lib/calendar/diary';
import { relativeDay } from '@/lib/calendar/grid';
import { EVENT_KINDS, KIND_CHIP, KIND_PLURAL, type EventKind } from '@/lib/calendar/kind';
import { DiaryRow } from '@/components/calendar/parts';
import {
  Button, Chip, EmptyState, GridHint, Label, PanelHead, SearchInput, StatStrip,
} from '@/components/kit/primitives';
import { Select } from '@/components/kit/forms';

/* =============================================================
   Everything booked, on the Work tab.

   ---- Why it is here as well as on the diary screen ----

   Work is where somebody looks to answer "what is on me". Half the
   answer was tasks and the other half was in a calendar they had to go
   and open, so a person with nothing in their task list and three calls
   booked read as a person with nothing to do.

   ---- Why it is a list and not another calendar ----

   The month grid is on the diary screen and it is good at orientation.
   The question this answers is the other one: what is next, in order,
   with what has not been answered at the top. A second month grid here
   would be the same picture in a smaller box.

   Everything comes through `lib/calendar/diary.ts`, the same module the
   diary screen reads, so the count on this strip and the count on that
   one are the same number by construction rather than by both being
   right.

   Opening a row goes to the diary screen with `?event=`, rather than
   putting a second copy of the entry editor here. One editor, one set
   of invitation buttons, one place where a meeting gets changed.
   ============================================================= */

export function WorkDiary({
  events, invites, people, companies, meId,
}: {
  events: CalendarEvent[];
  invites: DiaryInvite[];
  people: DiaryPerson[];
  companies: { id: string; company_name: string | null }[];
  meId: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [kinds, setKinds] = useState<EventKind[]>([]);
  const [whose, setWhose] = useState<'everything' | 'mine'>('everything');
  const [when, setWhen] = useState<'ahead' | 'all'>('ahead');

  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const companiesById = useMemo(
    () => new Map(companies.map((c) => [c.id, c.company_name ?? 'Unnamed'])),
    [companies],
  );

  const entries = useMemo(
    () => toEntries(events, { meId, invites, people: peopleById, companies: companiesById }),
    [events, invites, peopleById, companiesById, meId],
  );

  const shown = useMemo(() => filterDiary(entries, {
    kinds,
    onlyMine: whose === 'mine',
    fromToday: when === 'ahead',
    search,
  }), [entries, kinds, whose, when, search]);

  const groups = useMemo(() => groupByDay(shown), [shown]);
  const counts = useMemo(() => diaryCounts(entries, meId), [entries, meId]);

  const perKind = useMemo(() => {
    const map = new Map<EventKind, number>();
    for (const e of entries) map.set(e.kind, (map.get(e.kind) ?? 0) + 1);
    return map;
  }, [entries]);

  /* What is being hidden, said out loud. A filter somebody forgot they
     set is a filter that gets blamed on the data. */
  const narrowed = useMemo(() => {
    const bits: string[] = [];
    if (kinds.length) bits.push(`only ${kinds.map((k) => KIND_PLURAL[k].toLowerCase()).join(' and ')}`);
    if (whose === 'mine') bits.push('only what you are on');
    if (when === 'ahead') bits.push('nothing that has already happened');
    if (search.trim()) bits.push(`only what mentions "${search.trim()}"`);
    return bits.length ? bits.join(', ') : null;
  }, [kinds, whose, when, search]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <StatStrip items={[
        { label: 'Today', value: counts.today, note: 'in the diary' },
        { label: 'This week', value: counts.thisWeek, note: 'next seven days' },
        { label: 'Calls', value: counts.calls, note: 'still to make' },
        { label: 'Meetings', value: counts.meetings, note: 'and visits ahead' },
        { label: 'Waiting on you', value: counts.waitingOnMe, note: 'to answer' },
      ]} />

      <div style={{
        display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap',
        padding: '9px 12px', borderRadius: 'var(--r-md)',
        background: 'var(--surface)', border: '1px solid var(--border)',
      }}>
        <Label>Booked across the business</Label>

        <span style={{ flex: 1 }} />

        <div style={{ width: 210, maxWidth: '100%' }}>
          <SearchInput
            value={search} onChange={setSearch}
            placeholder="Title, customer or person"
            icon={<Search size={14} />}
          />
        </div>
        <div style={{ width: 150 }}>
          <Select value={whose} onChange={(v) => setWhose(v as 'everything' | 'mine')}>
            <option value="everything">Everybody</option>
            <option value="mine">Only mine</option>
          </Select>
        </div>
        <div style={{ width: 158 }}>
          <Select value={when} onChange={(v) => setWhen(v as 'ahead' | 'all')}>
            <option value="ahead">From today</option>
            <option value="all">Including past</option>
          </Select>
        </div>

        <Button size="sm" variant="secondary" onClick={() => router.push('/dashboard/calendar')}>
          <CalendarClock size={13} /> Open the diary
        </Button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Chip active={kinds.length === 0} onClick={() => setKinds([])}>Everything</Chip>
        {EVENT_KINDS.filter((k) => k !== 'reminder').map((k) => (
          <Chip
            key={k}
            active={kinds.includes(k)}
            count={perKind.get(k) ?? 0}
            empty={(perKind.get(k) ?? 0) === 0}
            onClick={() => setKinds(kinds.includes(k)
              ? kinds.filter((x) => x !== k)
              : [...kinds, k])}
          >{KIND_CHIP[k]}</Chip>
        ))}
        <span style={{ flex: 1 }} />
        {narrowed && (
          <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
            Showing {narrowed}.
          </span>
        )}
      </div>

      <div style={{
        flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)', overflow: 'hidden',
      }}>
        <PanelHead
          title="Calls, meetings and visits"
          count={shown.length}
          hint={counts.waitingOnMe > 0
            ? `${counts.waitingOnMe} waiting on your answer`
            : undefined}
        />

        {groups.length === 0 ? (
          <div style={{ padding: 24 }}>
            <EmptyState
              what={entries.length === 0 ? 'Nothing is booked' : 'Nothing matches'}
              why={entries.length === 0
                ? 'Calls, meetings, site visits and inspections booked anywhere in the application show up here. Nothing has been yet.'
                : 'Everything in the diary is filtered out by what is set above. Clear the filters to see it.'}
              action={entries.length === 0
                ? (
                  <Button size="sm" variant="secondary"
                    onClick={() => router.push('/dashboard/calendar')}>
                    <CalendarClock size={13} /> Open the diary
                  </Button>
                )
                : (
                  <Button size="sm" variant="ghost"
                    onClick={() => { setKinds([]); setWhose('everything'); setWhen('all'); setSearch(''); }}>
                    Clear the filters
                  </Button>
                )}
            />
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {groups.map((g) => (
              <div key={g.key}>
                <div style={{
                  position: 'sticky', top: 0, zIndex: 1,
                  display: 'flex', alignItems: 'center', gap: 9,
                  height: 30, padding: '0 13px',
                  background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
                }}>
                  <Label>{relativeDay(g.date)}</Label>
                  <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
                    {g.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span style={{
                    fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
                    color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums',
                  }}>{g.entries.length}</span>
                </div>
                {g.entries.map((e) => (
                  <DiaryRow
                    key={e.event.id}
                    entry={e}
                    onOpen={() => router.push(`/dashboard/calendar?event=${e.event.id}`)}
                    trailing={<ExternalLink size={13} style={{ color: 'var(--text-subtle)' }} />}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <GridHint>
        Everything booked anywhere in the application: the diary, a customer record, or the
        command bar. Opening one takes you to it in the diary, where it can be answered or moved.
      </GridHint>
    </div>
  );
}
