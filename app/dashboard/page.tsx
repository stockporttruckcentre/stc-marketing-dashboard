import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { ArrowRight, Calendar, Plus } from 'lucide-react';
import type { Profile, CRMContact, SocialPost, DEPOTS as _ } from '@/lib/types';
import { DEPOTS } from '@/lib/types';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  lead: 'Lead', contacted: 'Contacted', quoted: 'Quoted', won: 'Won', lost: 'Lost',
};

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default async function DashboardHome() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user!.id).single();
  const p = profile as Profile | null;

  const [{ data: recentContacts }, { data: recentPosts }, { count: pending }, { data: lusha }] = await Promise.all([
    supabase.from('crm_contacts').select('*').order('updated_at', { ascending: false }).limit(6),
    supabase.from('social_posts').select('*').order('updated_at', { ascending: false }).limit(6),
    supabase.from('social_posts').select('*', { count: 'exact', head: true }).eq('status', 'pending_review'),
    supabase.from('lusha_credits').select('balance').limit(1).single(),
  ]);

  const { data: allContacts } = await supabase.from('crm_contacts').select('status');
  const counts: Record<string, number> = { lead: 0, contacted: 0, quoted: 0, won: 0, lost: 0 };
  (allContacts ?? []).forEach((c: any) => { counts[c.status] = (counts[c.status] ?? 0) + 1; });
  const totalOpen = counts.lead + counts.contacted + counts.quoted;

  const { count: scheduled } = await supabase
    .from('social_posts').select('*', { count: 'exact', head: true }).eq('status', 'scheduled');

  const firstName = (p?.full_name ?? '').split(' ')[0] || 'there';
  const dateStr = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-head__eyebrow">Workspace · Overview</div>
          <h1 className="page-head__title">{greeting()}, {firstName}<span style={{ color: 'var(--stc-red)' }}>.</span></h1>
          <div className="page-head__sub">{dateStr} · 6 depots online · 24/7 breakdown active</div>
        </div>
        <div className="row">
          <button className="btn"><Calendar size={14} /> This week</button>
          <Link href="/dashboard/crm" className="btn btn--primary"><Plus size={14} /> New contact</Link>
        </div>
      </div>

      <div className="stats-grid">
        <Stat label="Pipeline · Open"     value={totalOpen.toString()}     accent="red"     sub={`${counts.lead} leads · ${counts.contacted} contacted · ${counts.quoted} quoted`} />
        <Stat label="Closed · Won"        value={counts.won.toString()}    accent="success" sub={`${counts.lost} lost`} />
        <Stat label="Posts pending"       value={(pending ?? 0).toString()} accent="warning" sub={`${scheduled ?? 0} scheduled`} />
        <Stat label="Lusha credits"       value={(lusha?.balance ?? 0).toLocaleString()} accent="lusha" sub="Server-side proxied" />
      </div>

      <div className="split-2" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="card__head">
            <div className="row" style={{ gap: 10 }}>
              <span className="card__dot card__dot--red" />
              <h3 style={{ margin: 0 }}>Sales</h3>
              <span className="mono" style={{ color: 'var(--fg-3)', fontSize: 11 }}>RECENT</span>
            </div>
            <Link href="/dashboard/crm" className="btn btn--sm btn--ghost">Open CRM <ArrowRight size={12} /></Link>
          </div>
          <div className="card__body">
            {(recentContacts ?? []).map((c: any) => (
              <div key={c.id} className="row-item">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row-item__title">{c.company_name}</div>
                  <div className="row-item__sub">
                    {c.location || '—'} · {c.fleet_size ? `${c.fleet_size} units` : 'fleet size unknown'}
                    {c.assigned_to ? ` · ${c.assigned_to}` : ''}
                  </div>
                </div>
                <span className={`pill pill--${c.status}`}>
                  <span className="pill__dot" />{STATUS_LABEL[c.status] ?? c.status}
                </span>
              </div>
            ))}
            {(!recentContacts || recentContacts.length === 0) && <Empty msg="No contacts yet — import a Lusha CSV from the CRM tab." />}
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <div className="row" style={{ gap: 10 }}>
              <span className="card__dot card__dot--blue" />
              <h3 style={{ margin: 0 }}>Marketing</h3>
              <span className="mono" style={{ color: 'var(--fg-3)', fontSize: 11 }}>APPROVAL QUEUE</span>
            </div>
            <Link href="/dashboard/social" className="btn btn--sm btn--ghost">Open planner <ArrowRight size={12} /></Link>
          </div>
          <div className="card__body">
            {(recentPosts ?? []).map((p: any) => (
              <div key={p.id} className="row-item">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row-item__title" style={{ whiteSpace: 'normal', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {p.content}
                  </div>
                  <div className="row-item__sub">
                    {(p.platform ?? []).join(' · ')} · {p.scheduled_date}
                  </div>
                </div>
                <span className={`pill pill--${p.status}`}>
                  <span className="pill__dot" />
                  {p.status.replace('_', ' ')}
                </span>
              </div>
            ))}
            {(!recentPosts || recentPosts.length === 0) && <Empty msg="No posts yet — draft one in the Social planner." />}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div className="eyebrow-row" style={{ marginBottom: 10 }}>Depot network · Live</div>
        <div className="depot-grid">
          {DEPOTS.map((d) => (
            <div key={d.name} className="depot">
              <div className="depot__head">
                <span className="depot__dot" />
                <h4 style={{ margin: 0 }}>{d.name}</h4>
              </div>
              <div className="depot__sub">Lat {d.lat.toFixed(3)}, Lng {d.lng.toFixed(3)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: 'red'|'success'|'warning'|'info'|'lusha' }) {
  return (
    <div className={`stat ${accent ? `stat--${accent}` : ''}`}>
      <div className="stat__bar" />
      <div className="stat__label">{label}</div>
      <div className="stat__value tnum">{value}</div>
      {sub && <div className="stat__sub">{sub}</div>}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div style={{ padding: '20px 4px', color: 'var(--fg-3)', fontSize: 12.5 }}>{msg}</div>;
}
