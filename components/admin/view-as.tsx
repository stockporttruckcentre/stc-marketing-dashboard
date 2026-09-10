'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, Loader } from 'lucide-react';
import { Button, Alert } from '@/components/kit/primitives';
import { Modal, Select, Field } from '@/components/kit/forms';

/* =============================================================
   The button beside somebody's name that says "show me their screen".

   Draws nothing itself beyond a button and a confirmation. Everything
   that makes it work is in `lib/platform/permissions/view-as.ts`, and
   the two things it is honest about are stated there and repeated to
   the person's face here:

     the interface is theirs, the rows are still yours
     nothing can be written until you stop

   Repeated rather than referenced, because a limitation explained in a
   comment is explained to the wrong audience.
   ============================================================= */

export function ViewAs({ people, selfId }: {
  people: { id: string; name: string; role: string | null }[];
  selfId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const others = people.filter((p) => p.id !== selfId);
  const chosen = others.find((p) => p.id === who) ?? null;

  async function start() {
    if (!who) return;
    setBusy(true);
    setFailed(null);
    const res = await fetch('/api/admin/view-as', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: who }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({})) as { error?: string };
      setFailed(j.error ?? 'That did not work.');
      return;
    }
    setOpen(false);
    /* A full reload rather than `router.refresh()`. The capabilities are
       resolved in the layout, which is a server component above this
       one, and the sidebar has to be rebuilt from them. */
    window.location.href = '/dashboard';
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Eye size={13} /> View as
      </Button>

      {open && (
        <Modal
          title="View the app as somebody else"
          onClose={() => setOpen(false)}
          width={560}
          footer={
            <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
              <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={start} disabled={!who || busy}>
                {busy ? <Loader size={13} className="spin" /> : <Eye size={13} />}
                {' '}Show me {chosen ? chosen.name.split(' ')[0] : 'their'} screen
              </Button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {failed && <Alert tone="danger">{failed}</Alert>}

            <Field label="Who">
              <Select value={who} onChange={setWho}>
                <option value="">Pick somebody</option>
                {others.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.role ? ` (${p.role})` : ''}
                  </option>
                ))}
              </Select>
            </Field>

            <Alert tone="warning">
              <span>
                <strong>Half of this is faithful and half of it is not.</strong>
                {' '}The sidebar, the tabs and every button are drawn from their
                permissions, which is the half you are testing. The rows are still
                yours: the database decides those from the account you signed in
                with, and nothing a browser sends can change that. So a rep whose
                tracker holds nine leads may show you yours.
              </span>
            </Alert>

            <Alert tone="info">
              <span>
                <strong>Nothing can be written while it is on.</strong> Every write
                would go in under your name while the screen says theirs. Stop
                viewing as them and it all comes back.
              </span>
            </Alert>
          </div>
        </Modal>
      )}
    </>
  );
}

/* -------------------------------------------------------------
   The bar across the top while it is on.

   Red, because it is the single most important thing on the screen
   whatever screen it is: somebody who forgets this is on will report a
   bug about data they cannot see. Rendered in the dashboard layout so
   it is above every page rather than only Admin.
   ------------------------------------------------------------- */
export function ViewingAsBanner({ name, roleName }: { name: string; roleName: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function stop() {
    setBusy(true);
    await fetch('/api/admin/view-as', { method: 'DELETE' });
    window.location.href = '/dashboard/admin';
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '0 16px', height: 34, flexShrink: 0,
      background: 'var(--stc-red, #CF2417)', color: '#fff',
      fontFamily: 'var(--inter, inherit)', fontSize: 12.5,
    }}>
      <Eye size={14} style={{ flexShrink: 0 }} />
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <strong>Viewing as {name}{roleName ? `, ${roleName}` : ''}.</strong>
        {' '}Buttons and tabs are theirs. The rows are still yours, and nothing can be saved.
      </span>
      <button
        type="button"
        onClick={stop}
        disabled={busy}
        style={{
          marginLeft: 'auto', flexShrink: 0,
          height: 24, padding: '0 10px', cursor: 'pointer',
          borderRadius: 'var(--r, 4px)',
          border: '1px solid rgba(255,255,255,0.5)',
          background: 'transparent', color: '#fff',
          fontFamily: 'inherit', fontSize: 12,
        }}
      >
        {busy ? 'Stopping' : 'Stop'}
      </button>
    </div>
  );
}
