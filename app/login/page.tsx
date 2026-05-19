'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Loader, AlertCircle } from 'lucide-react';

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
            <div className="field__label">Password</div>
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
    </div>
  );
}
