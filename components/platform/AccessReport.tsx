'use client';

import { useMemo, useState } from 'react';
import { Check, X, AlertTriangle, Search } from 'lucide-react';

/* =============================================================
   The access report, drawn.

   Every number and every verdict on this screen comes from the
   database, not from the browser's idea of what the person can do. That
   is the point: the browser's idea is what was wrong, and the two
   disagreeing silently is what cost an evening.
   ============================================================= */

type Row = { key: string; label: string; area: string; granted: boolean; source: string; scope: string | null };

export function AccessReport({ signedInAs, databaseSees, profile, template, report, spotCheck }: {
  signedInAs: { id: string; email: string | null };
  databaseSees: { actor: string | null; error: string | null };
  profile: { id: string; full_name: string | null; email: string | null; role: string | null; role_template_id: string | null; is_active: boolean } | null;
  template: { name: string; slug: string; is_active: boolean; customised_at: string | null } | null;
  report: { rows: Row[]; error: string | null };
  spotCheck: { capability: string; answer: boolean | null; error: string | null };
}) {
  const [q, setQ] = useState('');

  /* ---- The findings, worked out rather than left to the reader ----

     Anybody can read a list of true and false. What nobody could do on
     the night was look at that list and say which ONE thing was wrong.
     So the page says it. */
  const findings = useMemo(() => {
    const out: { level: 'bad' | 'warn'; what: string; fix: string }[] = [];

    if (databaseSees.error) {
      out.push({
        level: 'bad',
        what: `The database could not say who is asking: ${databaseSees.error}`,
        fix: 'Every permission will answer false until this works. It is the only thing worth fixing first.',
      });
    } else if (!databaseSees.actor) {
      out.push({
        level: 'bad',
        what: 'The database sees no signed-in user, even though this page loaded.',
        fix: 'The session is not reaching the database. Every capability answers false, every gated page bounces, '
           + 'and granting permissions changes nothing. This is an application fault, not a permissions one.',
      });
    } else if (databaseSees.actor !== signedInAs.id) {
      out.push({
        level: 'bad',
        what: `The database thinks you are ${databaseSees.actor}, the application thinks you are ${signedInAs.id}.`,
        fix: 'Permissions resolve against the database’s answer, so they will not match what you expect.',
      });
    }

    if (report.error) {
      out.push({
        level: 'bad',
        what: `The capability report failed: ${report.error}`,
        fix: 'The sidebar falls back to the old role list when this fails, so it will offer pages that then refuse you.',
      });
    }
    if (spotCheck.error) {
      out.push({
        level: 'bad',
        what: `Asking the database a single permission failed: ${spotCheck.error}`,
        fix: 'Page guards call exactly this. While it fails, every guarded page sends you away.',
      });
    }

    if (!profile) {
      out.push({
        level: 'bad',
        what: 'You are signed in but have no profile row.',
        fix: 'Permissions are resolved from the profile, so there is nothing to resolve against.',
      });
    } else if (!profile.role_template_id) {
      out.push({
        level: 'warn',
        what: 'You are not on a role template, so the old four-role list is answering for you.',
        fix: 'Put yourself on a role in the Admin hub. The legacy list is wider than any real role and will disappear.',
      });
    } else if (!template) {
      out.push({
        level: 'bad',
        what: 'Your profile names a role template that does not exist.',
        fix: 'Every capability answers false. Reassign the role in the Admin hub.',
      });
    } else if (!template.is_active) {
      out.push({
        level: 'bad',
        what: `Your role, ${template.name}, is archived.`,
        fix: 'Permission lookups still use it but no seed maintains it, so it can silently lose capabilities. '
           + 'Reactivate it or move onto a live role.',
      });
    }

    const granted = report.rows.filter((r) => r.granted).length;
    if (report.rows.length > 0 && granted === 0) {
      out.push({
        level: 'bad',
        what: 'The database knows of capabilities but grants you none of them.',
        fix: 'Either your role holds nothing, or the lookup is answering false for everything. The rows below say which.',
      });
    }

    /* The two answers that must agree. The report and `command_may` are
       separate functions, and a page guard uses the second. */
    const fromReport = report.rows.find((r) => r.key === spotCheck.capability)?.granted;
    if (fromReport != null && spotCheck.answer != null && fromReport !== spotCheck.answer) {
      out.push({
        level: 'bad',
        what: `The two permission functions disagree about ${spotCheck.capability}: `
            + `the report says ${fromReport}, the page guard says ${spotCheck.answer}.`,
        fix: 'The sidebar and the pages will not match while that is true.',
      });
    }

    return out;
  }, [databaseSees, signedInAs, profile, template, report, spotCheck]);

  const needle = q.trim().toLowerCase();
  const rows = report.rows.filter((r) =>
    needle === '' || r.key.toLowerCase().includes(needle) || r.label.toLowerCase().includes(needle)
    || r.area.toLowerCase().includes(needle));
  const areas = [...new Set(rows.map((r) => r.area))];

  const card: React.CSSProperties = {
    border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
    background: 'var(--surface)', padding: 18, display: 'flex', flexDirection: 'column', gap: 12,
  };
  const label: React.CSSProperties = { fontSize: 11, color: 'var(--text-subtle)', fontFamily: 'var(--mono)', letterSpacing: '.06em' };

  return (
    <div className="kit" style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900 }}>
      <div>
        <div style={{ ...label, marginBottom: 4 }}>SETTINGS</div>
        <h1 style={{ fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 24, letterSpacing: '-0.035em', margin: 0 }}>
          What can I open
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Everything here is the database&rsquo;s answer, not this browser&rsquo;s. If a page will not open, the reason is on this screen.
        </p>
      </div>

      {findings.length === 0 ? (
        <div style={{ ...card, borderLeft: '3px solid var(--success)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 14 }}>
            <Check size={16} style={{ color: 'var(--success)' }} />
            The permission system is answering normally
          </div>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            A page that still refuses you is refusing on a capability below that reads no.
          </span>
        </div>
      ) : findings.map((f, i) => (
        <div key={i} style={{ ...card, borderLeft: `3px solid ${f.level === 'bad' ? 'var(--danger)' : 'var(--warning)'}` }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <AlertTriangle size={16} style={{ color: f.level === 'bad' ? 'var(--danger)' : 'var(--warning)', flex: 'none', marginTop: 2 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{f.what}</span>
              <span style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>{f.fix}</span>
            </div>
          </div>
        </div>
      ))}

      <div style={{ ...card }}>
        <span style={label}>WHO THE DATABASE THINKS YOU ARE</span>
        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '6px 14px', fontSize: 13 }}>
          <span style={{ color: 'var(--text-muted)' }}>Signed in as</span>
          <span>{signedInAs.email ?? signedInAs.id}</span>
          <span style={{ color: 'var(--text-muted)' }}>Database sees</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
            {databaseSees.error ? `error: ${databaseSees.error}` : (databaseSees.actor ?? 'nobody')}
          </span>
          <span style={{ color: 'var(--text-muted)' }}>Role</span>
          <span>{template ? `${template.name}${template.is_active ? '' : ' (archived)'}` : 'no role template'}</span>
          <span style={{ color: 'var(--text-muted)' }}>Old role column</span>
          <span>{profile?.role ?? 'none'}</span>
          <span style={{ color: 'var(--text-muted)' }}>Changed from its template</span>
          <span>{template?.customised_at ? new Date(template.customised_at).toLocaleString('en-GB') : 'no'}</span>
          <span style={{ color: 'var(--text-muted)' }}>Direct check</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
            command_may(&rsquo;{spotCheck.capability}&rsquo;) ={' '}
            {spotCheck.error ? `error: ${spotCheck.error}` : String(spotCheck.answer)}
          </span>
        </div>
      </div>

      <div style={{ ...card }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={label}>EVERY PERMISSION</span>
          <span style={{ flex: 1 }} />
          <div style={{
            display: 'flex', alignItems: 'center', height: 30, gap: 6, padding: '0 10px',
            border: '1px solid var(--border-strong)', borderRadius: 'var(--r)',
          }}>
            <Search size={13} style={{ color: 'var(--text-subtle)' }} />
            <input
              placeholder="Filter"
              onChange={(e) => setQ(e.target.value)}
              style={{ border: 0, outline: 0, background: 'transparent', color: 'var(--text)', fontSize: 12, width: 140 }}
            />
          </div>
        </div>

        {report.rows.length === 0 ? (
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            The database returned no capabilities at all{report.error ? `: ${report.error}` : '.'}
          </span>
        ) : areas.map((area) => (
          <div key={area} style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ ...label, padding: '10px 0 6px' }}>{area.toUpperCase()}</span>
            {rows.filter((r) => r.area === area).map((r) => (
              <div key={r.key} style={{
                display: 'grid', gridTemplateColumns: '1fr 150px 120px', gap: 12,
                alignItems: 'center', padding: '7px 0', borderTop: '1px solid var(--border)', fontSize: 13,
              }}>
                <span>
                  {r.label}
                  <br />
                  <span style={{ fontSize: 11, color: 'var(--text-subtle)', fontFamily: 'var(--mono)' }}>{r.key}</span>
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{r.source}</span>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, height: 22, padding: '0 8px',
                  borderRadius: 'var(--r-sm)', fontSize: 11, fontWeight: 600, justifySelf: 'start',
                  background: r.granted ? 'rgba(31,158,60,.12)' : 'rgba(207,36,23,.10)',
                  color: r.granted ? 'var(--success)' : 'var(--danger)',
                }}>
                  {r.granted ? <Check size={12} /> : <X size={12} />}
                  {r.granted ? 'Yes' : 'No'}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
