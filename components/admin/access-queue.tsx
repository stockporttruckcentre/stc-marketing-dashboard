'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check, X, Loader, Mail, Clock, AlertTriangle, Copy, UserPlus,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  Alert, Badge, Button, Card, Chip, EmptyState, Label, PanelHead,
} from '@/components/kit/primitives';
import { Field, Modal, Select, TextInput } from '@/components/kit/forms';
import { useToast } from '@/components/kit/toast';
import type { UserRole } from '@/lib/types';

/* =============================================================
   Who has asked for an account.

   From the business:

     make it a request access button where they type their email
     address. Then I should see this come through to the admin centre
     where I can approve and create the account and it'll email them
     their login details (default password of 123)

   ---- The email, honestly ----

   This application has no outbound email transport. Its own capability
   registry says so at `rows.email`, and FleetSmart's "send" opens the
   person's own mail client for the same reason.

   So approving makes the account, and then hands over a message ready
   to send: the address, the subject, and the body with their sign in
   details in it, with one button that opens it in whatever they use for
   email. It is one click short of automatic and it is the truth.

   The business has said the automatic half arrives with SSO. When it
   does, the send replaces the last dialog here and nothing else
   changes, because the account already exists by the time it is on
   screen.
   ============================================================= */

type Request = {
  id: string;
  email: string;
  said: string | null;
  requested_at: string;
  status: 'pending' | 'approved' | 'declined';
  decided_by: string | null;
  decided_at: string | null;
  decided_note: string | null;
  already_has_one: boolean;
  declined_before: number;
};

/** What an approved account is given until they change it themselves. */
const DEFAULT_PASSWORD = '123';

const ROLES: { value: UserRole; label: string; blurb: string }[] = [
  { value: 'viewer',   label: 'Read only',     blurb: 'Looks, changes nothing' },
  { value: 'sales',    label: 'Sales',         blurb: 'Their own pipeline and the tracker' },
  { value: 'marketer', label: 'Marketing',     blurb: 'Updates records and content' },
  { value: 'admin',    label: 'Administrator', blurb: 'Everything, including this screen' },
];

export function AccessQueue({ onCount }: { onCount?: (n: number) => void }) {
  const supabase = createClient();
  const { say } = useToast();
  const [rows, setRows] = useState<Request[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [showing, setShowing] = useState<'pending' | 'everything'>('pending');
  const [approving, setApproving] = useState<Request | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [madeOne, setMadeOne] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data, error } = await supabase.rpc('access_requests_waiting');
    if (error) { setFailure(error.message); return; }
    const list = (data ?? []) as Request[];
    setRows(list);
    setFailure(null);
    onCount?.(list.filter((r) => r.status === 'pending').length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const pending = useMemo(() => (rows ?? []).filter((r) => r.status === 'pending'), [rows]);
  const shown = useMemo(
    () => (showing === 'pending' ? pending : (rows ?? [])),
    [rows, pending, showing],
  );

  async function decline(r: Request) {
    const why = window.prompt(
      `Turn down ${r.email}?\n\nA note for the record. They are not told what it says.`);
    if (why === null) return;
    setBusy(r.id);
    const { error } = await supabase.rpc('decline_access_request', {
      p_request: r.id, p_why: why || null,
    });
    setBusy(null);
    if (error) { say({ tone: 'danger', title: 'Not changed', body: error.message }); return; }
    say({ tone: 'success', title: `${r.email} turned down` });
    await reload();
  }

  if (failure) return <Alert tone="danger">{failure}</Alert>;

  return (
    <>
      <Card padded={false}>
        <PanelHead
          title="Asked for an account"
          count={pending.length}
          hint={pending.length ? 'Approving makes the account there and then' : 'Nothing waiting'}
          action={
            <Chip
              active={showing === 'everything'}
              onClick={() => setShowing((v) => (v === 'pending' ? 'everything' : 'pending'))}
            >
              {showing === 'pending' ? 'Show answered too' : 'Only what is waiting'}
            </Chip>
          }
        />

        {rows == null ? (
          <div style={{ padding: 16, fontSize: 12.5, color: 'var(--text-subtle)' }}>Loading.</div>
        ) : shown.length === 0 ? (
          <div style={{ padding: 10 }}>
            <EmptyState
              what={showing === 'pending' ? 'Nobody is waiting' : 'Nobody has asked yet'}
              why="People ask from the Request access link on the sign in page, and it arrives here."
            />
          </div>
        ) : (
          <div>
            {shown.map((r, i) => (
              <div
                key={r.id}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12,
                  padding: '12px 14px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                  opacity: r.status === 'pending' ? 1 : 0.62,
                }}
              >
                <span style={{
                  width: 28, height: 28, flex: 'none', borderRadius: 'var(--r-full)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--bg-subtle)', color: 'var(--text-subtle)',
                }}>
                  <Mail size={13} />
                </span>

                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                    fontSize: 13.5, fontWeight: 600, color: 'var(--text)',
                  }}>
                    {r.email}
                    {r.status === 'approved' && <Badge tone="success">Approved</Badge>}
                    {r.status === 'declined' && <Badge tone="neutral">Turned down</Badge>}
                    {r.status === 'pending' && r.already_has_one && (
                      <Badge tone="warning">Already has an account</Badge>
                    )}
                    {r.status === 'pending' && r.declined_before > 0 && (
                      <Badge tone="warning">
                        Turned down {r.declined_before} time{r.declined_before === 1 ? '' : 's'} before
                      </Badge>
                    )}
                  </span>

                  {r.said && (
                    <span style={{
                      display: 'block', marginTop: 3, fontSize: 12.5,
                      color: 'var(--text-muted)', lineHeight: 1.5,
                    }}>{r.said}</span>
                  )}

                  <span style={{
                    display: 'flex', alignItems: 'center', gap: 6, marginTop: 5,
                    fontSize: 11.5, color: 'var(--text-subtle)', flexWrap: 'wrap',
                  }}>
                    <Clock size={11} />
                    {new Date(r.requested_at).toLocaleString('en-GB', {
                      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                    {r.decided_by && <span>· answered by {r.decided_by}</span>}
                    {r.decided_note && <span>· {r.decided_note}</span>}
                  </span>
                </span>

                {r.status === 'pending' && (
                  <span style={{ display: 'flex', gap: 6, flex: 'none' }}>
                    {busy === r.id ? (
                      <span style={{
                        display: 'flex', alignItems: 'center', padding: '0 10px',
                        color: 'var(--text-subtle)',
                      }}><Loader size={13} className="spin" /></span>
                    ) : (
                      <>
                        <Button size="sm" variant="primary" onClick={() => setApproving(r)}>
                          <Check size={13} /> Approve
                        </Button>
                        <Button size="sm" onClick={() => decline(r)}>
                          <X size={13} /> Turn down
                        </Button>
                      </>
                    )}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {approving && (
        <ApproveDialog
          request={approving}
          onClose={() => setApproving(null)}
          onMade={async (email) => { setApproving(null); setMadeOne(email); await reload(); }}
        />
      )}

      {madeOne && <TellThemDialog email={madeOne} onClose={() => setMadeOne(null)} />}
    </>
  );
}

/* -------------------------------------------------------------
   Approving: what they get, said before it happens.
   ------------------------------------------------------------- */
function ApproveDialog({
  request, onClose, onMade,
}: { request: Request; onClose: () => void; onMade: (email: string) => void }) {
  const supabase = createClient();
  const { say } = useToast();
  const [role, setRole] = useState<UserRole>('sales');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function make() {
    setBusy(true);
    const { error } = await supabase.rpc('approve_access_request', {
      p_request: request.id,
      p_password: DEFAULT_PASSWORD,
      p_role: role,
      p_name: name.trim() || null,
    });
    setBusy(false);
    if (error) { say({ tone: 'danger', title: 'Not created', body: error.message }); return; }
    say({ tone: 'success', title: `${request.email} can sign in now` });
    onMade(request.email);
  }

  return (
    <Modal
      title="Approve and create the account"
      description={request.email}
      onClose={onClose}
      width={470}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={make} disabled={busy}>
            {busy ? <Loader size={14} className="spin" /> : <UserPlus size={14} />}
            {busy ? 'Creating' : 'Create the account'}
          </Button>
        </>
      }
    >
      {request.already_has_one && (
        <Alert tone="warning">
          <span style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <AlertTriangle size={14} style={{ flex: 'none', marginTop: 2 }} />
            <span>
              That address already has an account. Approving resets its password to{' '}
              <strong>{DEFAULT_PASSWORD}</strong> rather than making a second one, which is
              usually what somebody asking again actually needs.
            </span>
          </span>
        </Alert>
      )}

      <Field label="Their name" hint="Optional. Left empty, the part of the address before the @ is used.">
        <TextInput value={name} onChange={setName} placeholder="Tom Moore" autoFocus />
      </Field>

      <Field label="What they can do" hint="Changeable afterwards, on their Role and account tab.">
        <Select value={role} onChange={(v) => setRole(v as UserRole)}>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}: {r.blurb}</option>
          ))}
        </Select>
      </Field>

      <Alert tone="info">
        <span>
          Their password will be <strong>{DEFAULT_PASSWORD}</strong>. Nothing is sent
          automatically yet, so the next screen hands you the message. They can change the
          password themselves once they are in, on Settings.
        </span>
      </Alert>
    </Modal>
  );
}

/* -------------------------------------------------------------
   The message, ready to send.

   The account exists by the time this is on screen, so nothing here can
   fail in a way that leaves a half made person. It is a message and two
   ways to get it out of the browser.
   ------------------------------------------------------------- */
function TellThemDialog({ email, onClose }: { email: string; onClose: () => void }) {
  const { say } = useToast();
  const [origin, setOrigin] = useState('');
  useEffect(() => { setOrigin(window.location.origin); }, []);

  const subject = 'Your STC Workspace login';
  const body = [
    'Hello,',
    '',
    'Your STC Workspace account is ready.',
    '',
    `Sign in at: ${origin}/login`,
    `Email:      ${email}`,
    `Password:   ${DEFAULT_PASSWORD}`,
    '',
    'Please change the password once you are in, from Settings and then Password.',
    '',
    'Thanks',
  ].join('\n');

  const mailto = `mailto:${encodeURIComponent(email)}`
    + `?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <Modal
      title="Send them their details"
      description="The account is already made. This is the only step left."
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button onClick={onClose}>Done</Button>
          <Button onClick={() => {
            navigator.clipboard?.writeText(body).then(
              () => say({ tone: 'success', title: 'Copied' }), () => {},
            );
          }}><Copy size={14} /> Copy the message</Button>
          <Button variant="primary" onClick={() => { window.location.href = mailto; }}>
            <Mail size={14} /> Open in your mail app
          </Button>
        </>
      }
    >
      <Alert tone="info">
        Nothing is emailed automatically yet. This application has no outbound mail of its
        own, so the message opens in whatever you use for email and you press send.
      </Alert>

      <div>
        <Label>To</Label>
        <div style={{ marginTop: 4 }}>
          <TextInput value={email} readOnly />
        </div>
      </div>

      <div>
        <Label>The message</Label>
        <pre style={{
          margin: '4px 0 0', padding: '11px 13px', borderRadius: 'var(--r)',
          border: '1px solid var(--border)', background: 'var(--surface-sunken)',
          fontFamily: 'var(--inter)', fontSize: 12.5, lineHeight: 1.55,
          color: 'var(--text-muted)', whiteSpace: 'pre-wrap', overflowX: 'auto',
        }}>{body}</pre>
      </div>
    </Modal>
  );
}
