'use client';

/* =============================================================
   The action row on a CRM record. Dev only.

   ---- Why this exists ----

   From the business, asking for the Reminder button:

     It should fit without pushing the other buttons to a new row by
     default as we have room left.

   "It fits" is a claim about pixels, and pixels are the one thing that
   cannot be asserted from the source: the row is `flexWrap: 'wrap'`, so
   a button too wide by four points does not error, it silently starts a
   second line and the drawer grows. Whether it wraps depends on the
   real `Button`, the real gap, the real drawer width and the real
   font, and the only honest way to know is to lay it out and measure.

   So this is the row, at the drawer's own width, with the real
   components. `scripts/crm-record-check.ts` points a headless browser
   at it and reads the tops of the buttons back: one line means every
   button shares a top edge.

   The full drawer is not mounted, because it opens a Supabase client
   in six effects and would need a database to render at all. The row
   is what the question is about.

   `notFound()` in production, like the harnesses next door, so it is
   never reachable on a deployment.
   ============================================================= */

import { notFound } from 'next/navigation';
import {
  Bell, CalendarPlus, FileText, MoreHorizontal, Share2,
} from 'lucide-react';
import { Button } from '@/components/kit/primitives';

/* The drawer is `min(660px, 100%)` with 22px of padding either side.
   Both numbers come from `ContactDrawer`; the harness is worth nothing
   if it measures a row that is wider than the real one. */
const DRAWER = 660;
const PAD = 22;

export default function CrmRecordPreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className="kit" style={{ padding: 24, background: 'var(--bg)', minHeight: '100vh' }}>
      <p style={{ fontFamily: 'var(--inter)', fontSize: 12, color: 'var(--text-subtle)', margin: '0 0 12px' }}>
        The record header&rsquo;s action row, at the drawer&rsquo;s own width. Dev only.
      </p>

      {/* Two states, because the row used to change length as a deal
          progressed: DocuSign appeared at "quoted" and the row grew by a
          button. It does not any more, and that is worth measuring
          rather than asserting, so both are laid out and compared. */}
      {[
        { id: 'row-plain', label: 'A fresh prospect' },
        { id: 'row-signable', label: 'A quoted deal, which is the same five actions' },
      ].map(({ id, label }) => (
        <div key={id} style={{ marginBottom: 26 }}>
          <div style={{
            fontFamily: 'var(--inter)', fontSize: 11.5, color: 'var(--text-subtle)', marginBottom: 6,
          }}>{label}</div>
          <div style={{
            width: DRAWER, padding: `14px ${PAD}px`,
            background: 'var(--surface)', border: '1px solid var(--border)',
          }}>
            <div id={id} style={{ display: 'flex', gap: 7, flexWrap: 'wrap', position: 'relative' }}>
              <Button size="sm" variant="accent"><FileText size={13} /> Generate proposal</Button>
              <Button size="sm" variant="secondary"><Bell size={13} /> Reminder</Button>
              <Button size="sm" variant="secondary"><CalendarPlus size={13} /> Schedule</Button>
              <Button size="sm" variant="secondary"><Share2 size={13} /> Export</Button>
              <Button size="sm" variant="ghost" aria-label="More actions">
                <MoreHorizontal size={15} />
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
