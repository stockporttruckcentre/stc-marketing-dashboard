import { createClient } from '@/lib/supabase/server';
import type { Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user!.id).single();
  const p = (profile as Profile) ?? null;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-head__eyebrow">Admin · Settings</div>
          <h1 className="page-head__title">Settings<span style={{ color: 'var(--stc-red)' }}>.</span></h1>
          <div className="page-head__sub">Account &amp; workspace preferences.</div>
        </div>
      </div>

      <div className="split-2">
        <div className="card">
          <div className="card__head"><h3 style={{ margin: 0 }}>Profile</h3></div>
          <div className="card__body" style={{ paddingTop: 14, paddingBottom: 18 }}>
            <div className="field">
              <div className="field__label">Full name</div>
              <input className="input" defaultValue={p?.full_name ?? ''} disabled />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <div className="field__label">Email</div>
              <input className="input" defaultValue={p?.email ?? ''} disabled />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <div className="field__label">Role</div>
              <span className={`role-badge role-badge--${p?.role ?? 'viewer'}`}>{p?.role ?? 'viewer'}</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card__head"><h3 style={{ margin: 0 }}>Connections</h3></div>
          <div className="card__body" style={{ paddingTop: 10, paddingBottom: 18 }}>
            <div className="row-item">
              <div>
                <div className="row-item__title">Supabase</div>
                <div className="row-item__sub mono">Database, auth, storage</div>
              </div>
              <span className="pill pill--won"><span className="pill__dot" />Connected</span>
            </div>
            <div className="row-item">
              <div>
                <div className="row-item__title">Lusha</div>
                <div className="row-item__sub mono">Server-side proxied</div>
              </div>
              <span className="pill pill--won"><span className="pill__dot" />Connected</span>
            </div>
            <div className="row-item">
              <div>
                <div className="row-item__title">RSS sources</div>
                <div className="row-item__sub mono">Commercial Motor · Fleet News · Transport Engineer</div>
              </div>
              <span className="pill pill--won"><span className="pill__dot" />Connected</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
