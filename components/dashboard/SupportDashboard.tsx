'use client';

import { useRouter } from 'next/navigation';
import { Card, Kpi, Label, SectionHead, EmptyState, Button } from '@/components/kit/primitives';
import { Calendar, ImageIcon, TrendingUp } from 'lucide-react';
import type { Profile } from '@/lib/types';

/**
 * Marketer and support view.
 *
 * The meeting notes say "different again, minimal, specifics not agreed".
 * So this is deliberately a small, honest shell rather than an invented
 * dashboard: the marketing work that already exists in the app, and a
 * clear statement that the rest is still to be decided. Filling it in
 * with guesses would be worse than leaving the question visible.
 */
export function SupportDashboard({ profile }: { profile: Profile }) {
  const router = useRouter();
  const firstName = (profile.full_name || '').split(' ')[0] || 'there';

  return (
    <div className="kit" style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 40 }}>
      <div>
        <Label>Workspace</Label>
        <h1 style={{
          margin: '6px 0 0', fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 30,
          lineHeight: 1.15, letterSpacing: '-0.03em', color: 'var(--text)',
        }}>Hello, {firstName}</h1>
        <div style={{ fontSize: 13, color: 'var(--text-subtle)', marginTop: 4 }}>
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        <Card>
          <SectionHead title="Social planner" />
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
            Drafts waiting for approval, and what is scheduled to go out.
          </div>
          <Button variant="secondary" onClick={() => router.push('/dashboard/social')}>
            <Calendar size={14} /> Open planner
          </Button>
        </Card>
        <Card>
          <SectionHead title="Brand kit" />
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
            Logos, fonts and colour swatches for anything going out the door.
          </div>
          <Button variant="secondary" onClick={() => router.push('/dashboard/brand')}>
            <ImageIcon size={14} /> Open brand kit
          </Button>
        </Card>
        <Card>
          <SectionHead title="Industry news" />
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
            Trade press, plus insolvency notices matched against our own customers.
          </div>
          <Button variant="secondary" onClick={() => router.push('/dashboard/news')}>
            <TrendingUp size={14} /> Open news
          </Button>
        </Card>
      </div>

      <Card>
        <SectionHead title="The rest of this view" />
        <EmptyState
          what="What a marketer or support user needs here has not been agreed yet."
          why="The meeting left this one open. Rather than guess at widgets and have them quietly become the spec, the question is left visible until somebody decides what belongs here."
        />
      </Card>
    </div>
  );
}
