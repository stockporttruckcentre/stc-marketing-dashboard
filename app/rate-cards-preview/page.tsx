'use client';

import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { RateCardsScreen } from '@/components/sales/ratecards/RateCardsScreen';

/* =============================================================
   The Rate Card Builder, inside the application's own shell, for
   driving. Dev only.

   ---- Why the shell is here ----

   The first version of this harness mounted the screen on a bare page.
   Everything passed, and then from the business:

     toasts are loading under the sidebar when you create one.

   The harness could not have caught it. `.main` is a stacking context
   at z-index 1 and `.sidebar` is its sibling at 2, so nothing rendered
   inside the page can rise above the sidebar however high its z-index.
   With no sidebar on the page there was nothing to be under.

   So the harness reproduces the shell: the same `.app`, `.sidebar`,
   `.main` and `.page` elements the dashboard layout renders, with the
   same classes and therefore the same stacking contexts and the same
   box model. The sidebar is a plain block rather than the real
   component, because what matters is that it is there, is a sibling of
   `.main`, and carries `.sidebar`.

   A layout fault that only shows up beside real chrome is now a fault
   the drive check can see.

   `notFound()` in production, like the harnesses next door.
   ============================================================= */
export default function RateCardsPreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className="app">
      <div className="sidebar" data-preview-sidebar>
        <div className="sidebar__brand">
          <span className="sidebar__brand-title">STC</span>
        </div>
        <nav className="sidebar__nav">
          {['Dashboard', 'CRM portfolio', 'Sales tracker', 'FleetSmart+', 'Rate Card Builder']
            .map((label) => (
              <span key={label} className={`sidebar__item${label === 'Rate Card Builder' ? ' is-active' : ''}`}>
                {label}
              </span>
            ))}
        </nav>
      </div>
      <div className="main">
        <div className="topbar" />
        <main className="page">
          <Suspense fallback={null}>
            <RateCardsScreen caps={{ view: true, build: true, labour: true, approve: true }} />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
