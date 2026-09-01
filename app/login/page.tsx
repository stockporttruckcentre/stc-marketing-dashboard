'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Loader, LogIn } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Alert, Button } from '@/components/kit/primitives';
import { Field, Modal, TextInput } from '@/components/kit/forms';

/* =============================================================
   Signing in, in the STC kit.

   The first screen anybody sees, and the last one still on the old
   styling: `.login-bg`, `.login__card`, `.input`, `.btn--primary`.

   ---- The four rules, on a screen with one job ----

   NAVY ACTS, RED POINTS. Sign in is navy, because it is the primary
   action and there is only one. Red appears twice: the stop after the
   wordmark, and an error. Making the button red would have made the
   most ordinary action on the screen look like a warning.

   DENSITY IS A FEATURE. The kit's 32px control, not a taller one. A
   login is the easiest place to talk yourself into 48px inputs because
   there is space, and then it is the only screen in the product with
   its own sizing.

   BORDERS BEFORE SHADOWS. One hairline card on the page ground. It
   genuinely does not float above anything.

   PANTON EARNS ITS SIZE. On the wordmark and on "Sign in". Everything
   read at length is Inter.

   ---- Why `.kit` is on the outer div ----

   The kit's tokens are at `:root` already, but globals.css redefines
   `--bg`, `--accent` and `--border` for the old dark theme and wins
   there. `.kit` is what opts a surface into the kit's own three. See
   the header of app/kit-tokens.css.
   ============================================================= */

export default function LoginPage() {
  return (
    <Suspense fallback={<Ground />}>
      <LoginForm />
    </Suspense>
  );
}

/**
 * The page ground, on its own, so the Suspense fallback is not a flash
 * of white.
 *
 * `stc-force-dark` because there is no person here yet. The theme comes
 * from a cookie set once somebody has signed in and chosen one, so on
 * this screen it is either absent or it is the last person's, and
 * neither is a preference worth honouring on the front door. Dark is
 * the brand and the sign in screen is where it should be least
 * negotiable.
 */
function Ground({ children }: { children?: React.ReactNode }) {
  return (
    <div className="kit stc-force-dark" style={{
      minHeight: '100vh', background: 'var(--bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>{children}</div>
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

  /* Supabase password reset emails come back to the site root with the
     recovery session in the URL hash. The root redirects here, hash
     intact, so this forwards it on rather than showing somebody a sign
     in form when they have just clicked "set a new password". */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const h = window.location.hash;
    if (h && h.includes('type=recovery')) router.replace('/reset-password' + h);
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: refused } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (refused) {
      /* Supabase says "Invalid login credentials", which reads as a
         system error rather than as the ordinary thing that just
         happened. Everything else it says is passed through unchanged,
         because a rewritten error is a rewritten error. */
      setError(/invalid login credentials/i.test(refused.message)
        ? 'That email and password do not match an account.'
        : refused.message);
      return;
    }
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <Ground>
      <div style={{ width: '100%', maxWidth: 392, display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* ---- who this belongs to ---- */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/assets/stc-logo-emblem.png"
            alt="Stockport Truck Centre"
            style={{ height: 44, width: 'auto' }}
          />
          {/* The platform's name, not a description of it. Panton at the
              size the wordmark can carry, because this is the one place
              somebody reads what the thing is called. */}
          <div style={{
            fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 19,
            letterSpacing: '-0.02em', color: 'var(--text)', lineHeight: 1,
          }}>
            STC Workspace
          </div>
        </div>

        {/* ---- the form ---- */}
        <form
          onSubmit={handleSubmit}
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            padding: 22,
            display: 'flex', flexDirection: 'column', gap: 15,
          }}
        >
          <div>
            <h1 style={{
              margin: 0, fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 22,
              letterSpacing: '-0.025em', color: 'var(--text)',
            }}>
              Sign in<span style={{ color: 'var(--accent)' }}>.</span>
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--text-subtle)' }}>
              Use the account your work email is on.
            </p>
          </div>

          <Field label="Email">
            <TextInput
              type="email" value={email} onChange={setEmail}
              placeholder="you@stc-uk.com"
              name="email" autoComplete="email" required autoFocus id="email"
            />
          </Field>

          <Field label="Password">
            <TextInput
              type="password" value={password} onChange={setPassword}
              name="password" autoComplete="current-password" required id="password"
            />
          </Field>

          {error && (
            <Alert tone="danger">
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertCircle size={14} style={{ flex: 'none' }} />
                <span>{error}</span>
              </span>
            </Alert>
          )}

          <Button
            type="submit"
            variant="primary"
            disabled={loading || !email || !password}
            style={{ width: '100%' }}
          >
            {loading ? <Loader size={14} className="spin" /> : <LogIn size={14} />}
            {loading ? 'Signing you in' : 'Sign in'}
          </Button>

          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 10, paddingTop: 3, fontSize: 12,
          }}>
            <button
              type="button"
              onClick={() => setShowForgot(true)}
              style={{
                background: 'none', border: 0, padding: 0, cursor: 'pointer',
                fontFamily: 'var(--inter)', fontSize: 12, fontWeight: 600,
                color: 'var(--text-muted)', textDecoration: 'underline', textUnderlineOffset: 3,
              }}
            >Forgotten your password?</button>

            <span style={{ color: 'var(--text-subtle)' }}>
              No account?{' '}
              <Link href="/signup" style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
                Sign up
              </Link>
            </span>
          </div>
        </form>
      </div>

      {showForgot && <ForgotModal initialEmail={email} onClose={() => setShowForgot(false)} />}
    </Ground>
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
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    setSent(true);
  }

  return (
    <Modal
      title="Reset your password"
      description={sent ? undefined : 'We will email you a link to set a new one.'}
      onClose={onClose}
      width={430}
      footer={sent
        ? <Button variant="primary" onClick={onClose}>Done</Button>
        : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={send} disabled={loading || !email}>
              {loading ? <Loader size={14} className="spin" /> : null}
              {loading ? 'Sending' : 'Send the link'}
            </Button>
          </>
        )}
    >
      {sent ? (
        <Alert tone="success">
          <span style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <CheckCircle2 size={14} style={{ flex: 'none', marginTop: 2 }} />
            <span>
              Sent to {email}. Open it within the hour and click the link to set a new
              password.
            </span>
          </span>
        </Alert>
      ) : (
        <>
          <Field label="Email">
            <TextInput
              type="email" value={email} onChange={setEmail}
              placeholder="you@stc-uk.com"
              name="email" autoComplete="email" autoFocus
            />
          </Field>
          {err && (
            <Alert tone="danger">
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertCircle size={14} style={{ flex: 'none' }} />
                <span>{err}</span>
              </span>
            </Alert>
          )}
          {/* Kept from the old screen because it is real and it has cost
              somebody an afternoon: link scanners follow the link, which
              spends it, and the person clicking gets an expired one. */}
          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.5 }}>
            If your email scanning follows links before you do, the link will already have
            been used by the time it reaches you. An administrator can set your password
            directly from Supabase, under Authentication and then Users.
          </p>
        </>
      )}
    </Modal>
  );
}
