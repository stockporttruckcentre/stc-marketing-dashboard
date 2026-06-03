'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Loader, AlertCircle, CheckCircle, X } from 'lucide-react';

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="login-bg" />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get('redirect') || '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForgot, setShowForgot] = useState(false);

  // Supabase password-reset emails redirect back to the Site URL (root) with the
  // recovery session in the URL hash. The root page SSR-redirects to /login,
  // dropping us here with the hash intact. Detect & forward to /reset-password.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const h = window.location.hash;
    if (h && h.includes('type=recovery')) {
      router.replace('/reset-password' + h);
    }
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { setError(error.message); return; }
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <div className="login-bg">
      <div className="login__card">
        <div className="page-head__eyebrow" style={{ marginBottom: 10 }}>Stockport Truck Centre</div>
        <h2 className="dot-red">Sign in</h2>
        <div className="sub">Marketing &amp; sales dashboard.</div>

        <form onSubmit={handleSubmit} className="login__form">
          <div className="field">
            <div className="field__label">Email</div>
            <input
              type="email" required
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@stc-uk.com"
              className="input"
            />
          </div>
          <div className="field">
            <div className="field__label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Password</span>
              <button type="button" onClick={() => setShowForgot(true)}
                style={{ background: 'none', border: 'none', color: 'var(--stc-red)', fontSize: 12, fontWeight: 500, cursor: 'pointer', padding: 0 }}>
                Forgot password?
              </button>
            </div>
            <input
              type="password" required
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="input"
            />
          </div>
          {error && (
            <div className="alert alert--danger">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}
          <button type="submit" disabled={loading} className="btn btn--primary btn--lg" style={{ width: '100%' }}>
            {loading ? <Loader size={14} className="spin" /> : null}
            Sign in
          </button>
        </form>

        <div className="login__hint">
          Need an account? <Link href="/signup" style={{ color: 'var(--stc-red)', fontWeight: 500 }}>Sign up</Link>
        </div>
      </div>

      {showForgot && <ForgotModal initialEmail={email} onClose={() => setShowForgot(false)} />}
    </div>
  );
}

function ForgotModal({ initialEmail, onClose }: { initialEmail: string; onClose: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    if (!email) { setErr('Enter your email first.'); return; }
    setLoading(true); setErr(null);
    const supabase = createClient();
    const origin = window.location.origin;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/reset-password`,
    });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    setSent(true);
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 60,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="login__card" style={{ maxWidth: 420, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 className="dot-red" style={{ margin: 0 }}>Reset your password</h2>
            <div className="sub">We&apos;ll email you a link to set a new one.</div>
          </div>
          <button onClick={onClose} className="btn btn--icon"><X size={16} /></button>
        </div>

        {sent ? (
          <div className="alert alert--info" style={{ marginTop: 16, background: 'rgba(46,160,67,0.15)', color: '#5fb572', display: 'flex', gap: 8, alignItems: 'center' }}>
            <CheckCircle size={14} />
            <span>Email sent. Open it within 1 hour and click the link to set a new password.</span>
          </div>
        ) : (
          <>
            <div className="field" style={{ marginTop: 14 }}>
              <div className="field__label">Email</div>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@stc-uk.com" className="input" autoFocus />
            </div>
            {err && (
              <div className="alert alert--danger" style={{ marginTop: 10 }}>
                <AlertCircle size={14} /><span>{err}</span>
              </div>
            )}
            <button onClick={send} disabled={loading} className="btn btn--primary btn--lg" style={{ width: '100%', marginTop: 12 }}>
              {loading ? <Loader size={14} className="spin" /> : null}
              {loading ? 'Sending…' : 'Send reset email'}
            </button>
            <div className="sub" style={{ marginTop: 12, fontSize: 12 }}>
              If your IT email scanning (e.g. ESET) is consuming the link before you click it, ask your Supabase admin
              to set your password directly from Authentication → Users.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
