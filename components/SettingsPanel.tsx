'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Save, Loader, KeyRound, User } from 'lucide-react';
import type { Profile } from '@/lib/types';

export function SettingsPanel({ profile }: { profile: Profile }) {
  const supabase = createClient();
  const [fullName, setFullName] = useState(profile.full_name);
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState<{ type: 'success' | 'danger'; text: string } | null>(null);

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ type: 'success' | 'danger'; text: string } | null>(null);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setSavingName(true); setNameMsg(null);
    const { error } = await supabase.from('profiles').update({ full_name: fullName }).eq('id', profile.id);
    setSavingName(false);
    if (error) setNameMsg({ type: 'danger', text: error.message });
    else setNameMsg({ type: 'success', text: 'Saved' });
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setSavingPw(true); setPwMsg(null);
    if (newPw !== confirmPw) { setPwMsg({ type: 'danger', text: 'Passwords do not match' }); setSavingPw(false); return; }
    if (newPw.length < 1) { setPwMsg({ type: 'danger', text: 'New password is required' }); setSavingPw(false); return; }

    // Re-auth with current password first to be safe
    const { error: signErr } = await supabase.auth.signInWithPassword({ email: profile.email, password: currentPw });
    if (signErr) { setPwMsg({ type: 'danger', text: 'Current password is incorrect' }); setSavingPw(false); return; }

    const { error } = await supabase.auth.updateUser({ password: newPw });
    setSavingPw(false);
    if (error) { setPwMsg({ type: 'danger', text: error.message }); return; }
    setCurrentPw(''); setNewPw(''); setConfirmPw('');
    setPwMsg({ type: 'success', text: 'Password changed' });
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-head__eyebrow">Admin · Settings</div>
          <h1 className="page-head__title">Settings<span style={{ color: 'var(--stc-red)' }}>.</span></h1>
          <div className="page-head__sub">Manage your profile and password.</div>
        </div>
      </div>

      <div className="split-2">
        <form onSubmit={saveName} className="card">
          <div className="card__head"><h3 style={{ margin: 0 }}><User size={14} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} /> Profile</h3></div>
          <div className="card__body" style={{ paddingTop: 14, paddingBottom: 18 }}>
            <div className="field">
              <div className="field__label">Full name</div>
              <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <div className="field__label">Email (read-only)</div>
              <input className="input" defaultValue={profile.email} disabled />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <div className="field__label">Role</div>
              <span className={`role-badge role-badge--${profile.role}`}>{profile.role}</span>
            </div>
            {nameMsg && <div className={`alert alert--${nameMsg.type}`} style={{ marginTop: 12 }}>{nameMsg.text}</div>}
            <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
              <button type="submit" disabled={savingName} className="btn btn--primary">
                {savingName ? <Loader size={14} className="spin" /> : <Save size={14} />} Save
              </button>
            </div>
          </div>
        </form>

        <form onSubmit={savePassword} className="card">
          <div className="card__head"><h3 style={{ margin: 0 }}><KeyRound size={14} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} /> Password</h3></div>
          <div className="card__body" style={{ paddingTop: 14, paddingBottom: 18 }}>
            <div className="field">
              <div className="field__label">Current password</div>
              <input type="password" className="input" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} required />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <div className="field__label">New password</div>
              <input type="password" className="input" value={newPw} onChange={(e) => setNewPw(e.target.value)} required />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <div className="field__label">Confirm new password</div>
              <input type="password" className="input" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} required />
            </div>
            {pwMsg && <div className={`alert alert--${pwMsg.type}`} style={{ marginTop: 12 }}>{pwMsg.text}</div>}
            <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
              <button type="submit" disabled={savingPw} className="btn btn--primary">
                {savingPw ? <Loader size={14} className="spin" /> : <KeyRound size={14} />} Change password
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
