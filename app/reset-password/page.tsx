'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader, AlertCircle, CheckCircle, Lock } from 'lucide-react';

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="login-bg" />}>
      <ResetForm />
    </Suspense>
  );
}

function ResetForm() {
  const router = useRouter();
  const supabase = createClient();
  const [ready, setReady] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    if (hash && hash.includes('type=recovery')) {
      const params = new URLSearchParams(hash.slice(1));
      const access_token = params.get('access_token');
      const refresh_token = params.get('refresh_token');
      if (!access_token || !refresh_token) {
        setError('Reset link is missing tokens. Request a new password reset.');
        return;
      }
      supabase.auth.setSession({ access_token, refresh_token }).then(({ error }) => {
        if (error) setError(`Reset link is invalid or expired: ${error.message}`);
        else {
          setReady(true);
          window.history.replaceState(null, '', window.location.pathname);
        }
      });
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
      else setError('No active password-reset session. Click the link in your reset email again to start over.');
    });
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw.length < 1) { setError('Enter a new password.'); return; }
    if (pw !== pw2) { setError("Passwords don't match."); return; }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setLoading(false);
    if (error) { setError(error.message); return; }
    setSuccess(true);
    setTimeout(() => { router.push('/dashboard'); router.refresh(); }, 1500);
  }

  return (
    <div className="login-bg">
      <div className="login__card">
        <div className="page-head__eyebrow" style={{ marginBottom: 10 }}>Stockport Truck Centre</div>
        <h2 className="dot-red" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Lock size={18} /> Set a new password
        </h2>
        <div className="sub">Choose your new dashboard password.</div>

        {!ready && !error && (
          <div className="sub" style={{ marginTop: 14 }}>Verifying your reset link…</div>
        )}
        {error && (
          <div className="alert alert--danger" style={{ marginTop: 14 }}>
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="alert alert--info" style={{ marginTop: 14, background: 'rgba(46,160,67,0.15)', color: '#5fb572' }}>
            <CheckCircle size={14} />
            <span>Password updated — signing you in…</span>
          </div>
        )}
        {ready && !success && (
          <form onSubmit={handleSubmit} className="login__form">
            <div className="field">
              <div className="field__label">New password</div>
              <input type="password" autoFocus autoComplete="new-password"
                value={pw} onChange={(e) => setPw(e.target.value)} className="input" />
            </div>
            <div className="field">
              <div className="field__label">Confirm new password</div>
              <input type="password" autoComplete="new-password"
                value={pw2} onChange={(e) => setPw2(e.target.value)} className="input" />
            </div>
            <button type="submit" disabled={loading} className="btn btn--primary btn--lg" style={{ width: '100%' }}>
              {loading ? <Loader size={14} className="spin" /> : null}
              {loading ? 'Saving…' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
