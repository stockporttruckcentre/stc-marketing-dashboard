import Link from 'next/link';
import { ShieldAlert, AlertTriangle } from 'lucide-react';
import type { Verdict } from '@/lib/platform/permissions/page-guard';

/* =============================================================
   What a page draws when it will not open.

   Two different things, said differently, because they need different
   people to do different things:

   REFUSED. The permission system worked and this person does not hold
   what the page needs. Nothing is broken. It names the capability so
   whoever administers roles can grant it in one move, and it does not
   pretend the page does not exist.

   FAILED. The permission system could not answer. Something is wrong
   with the application or the database, and the person reading this
   has done nothing. It shows what the database actually said, because
   that one line is the difference between a minute of work and an
   evening of it.

   ---- Why not just redirect ----

   Redirecting is what these pages used to do, for both cases, silently.
   From the business:

     if i manually type /dashboard/revenue in the url it takes me to
     /dashboard/ like the page is just gone

   It was not gone. It was refusing, and saying nothing, and looking
   exactly like a routing fault. A screen that states its reason is the
   whole fix for that.
   ============================================================= */

export function NoAccess({ verdict, page, role }: {
  verdict: Extract<Verdict, { state: 'refused' } | { state: 'failed' }>;
  /** What the person was trying to open, in their words, not a route. */
  page: string;
  /** The role they are on, when it is known. */
  role?: string | null;
}) {
  const broken = verdict.state === 'failed';

  return (
    <div className="kit" style={{ maxWidth: 640, margin: '48px auto', padding: '0 20px' }}>
      <div
        style={{
          border: '1px solid var(--border)',
          borderLeft: `3px solid ${broken ? 'var(--danger)' : 'var(--warning)'}`,
          borderRadius: 'var(--r-md)',
          background: 'var(--surface)',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {broken
            ? <AlertTriangle size={20} style={{ color: 'var(--danger)' }} />
            : <ShieldAlert size={20} style={{ color: 'var(--warning)' }} />}
          <h1 style={{ fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 20, letterSpacing: '-0.03em', margin: 0 }}>
            {broken ? `${page} could not be opened` : `You do not have access to ${page}`}
          </h1>
        </div>

        {broken ? (
          <>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
              This is not about your permissions. The application asked the database
              whether you may open this page and the database could not answer, so the
              page will not draw rather than guess.
            </p>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              It was asking about <code>{verdict.capability}</code>. What came back:
            </p>
            <pre
              style={{
                margin: 0, padding: '10px 12px', background: 'var(--bg-subtle)',
                borderRadius: 'var(--r)', fontSize: 12, whiteSpace: 'pre-wrap',
                fontFamily: 'var(--mono)',
              }}
            >{verdict.because}</pre>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Send that line to whoever looks after this application. It names the
              fault exactly.
            </p>
          </>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
              The page is there and working. Your role does not include the permission
              it needs, so it has not been drawn.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted)' }}>
                It needs <code>{verdict.capability}</code>
              </span>
              {role && (
                <span style={{ color: 'var(--text-muted)' }}>
                  You are on <strong>{role}</strong>
                </span>
              )}
            </div>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Anybody who can change roles can grant it on the Roles tab of Admin,
              and it applies to everybody on your role at once.
            </p>
          </>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <Link
            href="/dashboard"
            style={{
              display: 'inline-flex', alignItems: 'center', height: 32, padding: '0 14px',
              background: 'var(--primary)', color: 'var(--primary-fg)',
              border: '1px solid var(--primary)', borderRadius: 'var(--r)',
              fontSize: 13, fontWeight: 600, textDecoration: 'none',
            }}
          >
            Back to the dashboard
          </Link>
          <Link
            href="/dashboard/settings/access"
            style={{
              display: 'inline-flex', alignItems: 'center', height: 32, padding: '0 14px',
              background: 'var(--surface)', color: 'var(--text)',
              border: '1px solid var(--border-strong)', borderRadius: 'var(--r)',
              fontSize: 13, fontWeight: 600, textDecoration: 'none',
            }}
          >
            What can I open?
          </Link>
        </div>
      </div>
    </div>
  );
}
