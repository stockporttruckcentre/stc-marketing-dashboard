'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Loader, AlertCircle, CheckCircle } from 'lucide-react';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name: fullName } },
    });
    setLoading(false);
    if (error) { setError(error.message); return; }
    setSuccess(true);
    setTimeout(() => router.push('/login'), 2000);
  }

  return (
    <div className="login-bg">
      <div className="login__card">
        <div className="page-head__eyebrow" style={{ marginBottom: 10 }}>Stockport Truck Centre</div>
        <h2 className="dot-red">Create account</h2>
        <div className="sub">An admin will grant your role after sign-up.</div>

        {success ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <CheckCircle size={40} style={{ color: 'var(--stc-success)', margin: '0 auto 8px' }} />
            <p style={{ color: 'var(--fg-1)', fontWeight: 500 }}>Account created.</p>
            <p className="sub" style={{ marginTop: 6 }}>Check your email to confirm, then sign in.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="login__form">
            <div className="field"><div className="field__label">Full name</div>
              <input className="input" type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
            <div className="field"><div className="field__label">Email</div>
              <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="field"><div className="field__label">Password (min 8)</div>
              <input className="input" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
            {error && (
              <div className="alert alert--danger">
                <AlertCircle size={14} /><span>{error}</span>
              </div>
            )}
            <button type="submit" disabled={loading} className="btn btn--primary btn--lg" style={{ width: '100%' }}>
              {loading ? <Loader size={14} className="spin" /> : null}
              Create account
            </button>
          </form>
        )}

        <div className="login__hint">
          Already have an account? <Link href="/login" style={{ color: 'var(--stc-red)', fontWeight: 500 }}>Sign in</Link>
        </div>
      </div>
    </div>
  );
}
