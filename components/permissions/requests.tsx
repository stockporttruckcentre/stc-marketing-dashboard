'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, X, Loader, Clock } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  Button, Card, SectionHead, Badge, EmptyState, Skeleton, Row,
} from '@/components/kit/primitives';
import { TextInput } from '@/components/kit/forms';

/* =============================================================
   What people have asked to be allowed to do.

   From the business, choosing what a blocked button should do rather
   than simply greying out: "Request it, and Sr gets a decision."

   This is where the decision happens, and it is a screen of its own
   rather than a panel inside Admin for a reason that took a wrong turn
   to notice: Sr Sales decides for their own salespeople and does NOT
   hold `admin.users`, so the Admin tab refuses them. A notification
   linking somewhere the recipient cannot open is worse than no
   notification.

   ---- Two lists, and both matter ----

   What people have asked YOU is the work. What YOU have asked is the
   half that stops somebody asking three times because nothing visibly
   happened. `capability_requests` is row level secured so that each
   person sees their own plus, for a lead, their department's, and this
   screen asks for both without having to know which is which.
   ============================================================= */

type Request = {
  id: string;
  asked_by: string;
  capability: string;
  doing: string | null;
  reason: string | null;
  status: 'pending' | 'approved' | 'refused' | 'withdrawn';
  note: string | null;
  expires_at: string | null;
  created_at: string;
  asker: string;
  label: string;
  description: string;
  danger: string;
};

const TONE: Record<string, 'neutral' | 'info' | 'warning' | 'accent'> = {
  pending: 'warning', approved: 'info', refused: 'neutral', withdrawn: 'neutral',
};

const WHEN = (iso: string) => new Date(iso).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

export function AccessRequests({ selfId, mayDecide }: { selfId: string; mayDecide: boolean }) {
  const supabase = createClient();
  const [rows, setRows] = useState<Request[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('capability_requests')
      .select('*, asker:profiles!capability_requests_asked_by_fkey(full_name),'
              + ' cap:capability_catalog!inner(label, description, danger)')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) { setFailed(error.message); setRows([]); return; }

    setRows((data ?? []).map((r) => {
      const row = r as unknown as Record<string, unknown>;
      const asker = row.asker as { full_name?: string } | null;
      const cap = row.cap as { label?: string; description?: string; danger?: string } | null;
      return {
        ...(row as unknown as Request),
        asker: asker?.full_name ?? 'Somebody',
        label: cap?.label ?? String(row.capability),
        description: cap?.description ?? '',
        danger: cap?.danger ?? 'routine',
      };
    }));
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  const decide = useCallback(async (id: string, grant: boolean) => {
    setBusy(id);
    setFailed(null);
    const { error } = await supabase.rpc('decide_capability_request', {
      p_request: id, p_grant: grant, p_note: note[id]?.trim() || null,
    });
    if (error) setFailed(error.message);
    setBusy(null);
    await load();
  }, [supabase, note, load]);

  const withdraw = useCallback(async (id: string) => {
    setBusy(id);
    await supabase.rpc('withdraw_capability_request', { p_request: id });
    setBusy(null);
    await load();
  }, [supabase, load]);

  if (rows === null) {
    return (
      <Card>
        <Skeleton height={18} width="40%" />
        <div style={{ height: 10 }} />
        <Skeleton height={48} />
      </Card>
    );
  }

  const mine = rows.filter((r) => r.asked_by === selfId);
  const theirs = rows.filter((r) => r.asked_by !== selfId);
  const waiting = theirs.filter((r) => r.status === 'pending');
  const done = theirs.filter((r) => r.status !== 'pending');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {failed && (
        <Card>
          <div style={{ color: 'var(--danger, #CF2417)', fontSize: 13 }}>{failed}</div>
        </Card>
      )}

      {mayDecide && (
        <Card>
          <SectionHead
            title="Waiting on you"
            hint={waiting.length === 0
              ? 'Nobody in your departments is waiting for an answer.'
              : `${waiting.length} ${waiting.length === 1 ? 'person is' : 'people are'} waiting for an answer.`}
          />
          {waiting.length === 0 ? (
            <EmptyState
              what="Nothing to decide"
              why="When somebody in a department you run presses a button they cannot use, it arrives here."
            />
          ) : waiting.map((r) => (
            <div key={r.id} style={{ padding: '12px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 14 }}>{r.asker}</strong>
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>asked to</span>
                <strong style={{ fontSize: 14 }}>{r.label.toLowerCase()}</strong>
                {r.danger !== 'routine' && (
                  <Badge tone={r.danger === 'destructive' ? 'accent' : 'warning'}>{r.danger}</Badge>
                )}
                <span style={{ marginLeft: 'auto', color: 'var(--text-subtle)', fontSize: 12 }}>
                  {WHEN(r.created_at)}
                </span>
              </div>

              {/* What they were doing when they hit the wall, which is
                  almost always the whole answer. */}
              {r.doing && (
                <div style={{ fontSize: 13, marginTop: 4 }}>{r.doing}</div>
              )}
              {r.reason && (
                <div style={{ fontSize: 13, marginTop: 2, color: 'var(--text-muted)' }}>
                  {r.reason}
                </div>
              )}
              <div style={{ fontSize: 12.5, marginTop: 6, color: 'var(--text-subtle)' }}>
                {r.description}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                <TextInput
                  value={note[r.id] ?? ''}
                  onChange={(v: string) => setNote((n) => ({ ...n, [r.id]: v }))}
                  placeholder="Why, so the answer is not silence"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => decide(r.id, false)}
                  disabled={busy === r.id}
                >
                  <X size={13} /> Turn down
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => decide(r.id, true)}
                  disabled={busy === r.id}
                >
                  {busy === r.id ? <Loader size={13} className="spin" /> : <Check size={13} />} Allow
                </Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      <Card>
        <SectionHead
          title="What you have asked for"
          hint="Every answer arrives as a notification as well, so this is a record rather than somewhere to wait."
        />
        {mine.length === 0 ? (
          <EmptyState
            what="You have not asked for anything"
            why="A button you cannot press says who can, and asking them is one click."
          />
        ) : mine.map((r) => (
          <Row key={r.id}>
            <Badge tone={TONE[r.status]}>{r.status}</Badge>
            <span style={{ fontSize: 13.5 }}>{r.label}</span>
            {r.expires_at && r.status === 'approved' && (
              <Badge tone="neutral">
                <Clock size={11} /> until {WHEN(r.expires_at)}
              </Badge>
            )}
            {r.note && (
              <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{r.note}</span>
            )}
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-subtle)' }}>
              {WHEN(r.created_at)}
            </span>
            {r.status === 'pending' && (
              <Button size="sm" variant="secondary" onClick={() => withdraw(r.id)} disabled={busy === r.id}>
                Withdraw
              </Button>
            )}
          </Row>
        ))}
      </Card>

      {mayDecide && done.length > 0 && (
        <Card>
          <SectionHead
            title="Already decided"
            hint="Kept, because who was given what and why is the first question anybody asks afterwards."
          />
          {done.map((r) => (
            <Row key={r.id}>
              <Badge tone={TONE[r.status]}>{r.status}</Badge>
              <span style={{ fontSize: 13.5 }}>{r.asker}</span>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{r.label.toLowerCase()}</span>
              {r.note && (
                <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>{r.note}</span>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-subtle)' }}>
                {WHEN(r.created_at)}
              </span>
            </Row>
          ))}
        </Card>
      )}
    </div>
  );
}
