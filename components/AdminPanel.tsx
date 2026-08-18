'use client';

import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { setRole } from '@/lib/crm/roles';
import type { Profile, UserRole } from '@/lib/types';

const ROLES: UserRole[] = ['admin', 'marketer', 'sales', 'viewer'];

export function AdminPanel({ team, selfId }: { team: Profile[]; selfId: string }) {
  const supabase = createClient();
  const [members, setMembers] = useState<Profile[]>(team);
  const [msg, setMsg] = useState<string | null>(null);

  /* The same operation the command bar performs. This used to update
     `profiles` straight from the browser, so the most dangerous write in
     the application went through row level security and nothing else:
     no capability asked for by name, no guard against removing the last
     administrator, and no audit line saying who did it. */
  async function changeRole(id: string, role: UserRole) {
    setMsg(null);
    const done = await setRole(supabase, id, role);
    if (!done.ok) { setMsg(done.why); return; }
    setMembers((ms) => ms.map((m) => (m.id === id ? { ...m, role } : m)));
    setMsg(`${done.who || members.find((m) => m.id === id)?.full_name} is now ${done.now}`);
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-head__eyebrow">Admin · Roles &amp; approvals</div>
          <h1 className="page-head__title"><ShieldCheck size={26} style={{ color: 'var(--stc-red)' }} /><span>Team<span style={{ color: 'var(--stc-red)' }}>.</span></span></h1>
          <div className="page-head__sub">{members.length} members. Promote a sign-up to marketer/sales/admin here.</div>
        </div>
      </div>

      {msg && <div className="alert alert--info" style={{ marginBottom: 12 }}>{msg}</div>}

      <div className="card">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Name</th><th>Email</th><th>Role</th><th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td style={{ color: 'var(--fg-1)', fontWeight: 500 }}>
                  {m.full_name}{m.id === selfId && <span className="mono" style={{ color: 'var(--fg-4)', marginLeft: 8 }}>YOU</span>}
                </td>
                <td className="mono" style={{ color: 'var(--fg-2)' }}>{m.email}</td>
                <td>
                  {m.id === selfId ? (
                    <span className={`role-badge role-badge--${m.role}`}>{m.role}</span>
                  ) : (
                    <select
                      value={m.role}
                      onChange={(e) => changeRole(m.id, e.target.value as UserRole)}
                      className="input"
                      style={{ height: 28, padding: '0 8px', fontSize: 12 }}
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  )}
                </td>
                <td className="mono" style={{ color: 'var(--fg-3)', fontSize: 11.5 }}>
                  {new Date(m.created_at).toLocaleDateString('en-GB')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
