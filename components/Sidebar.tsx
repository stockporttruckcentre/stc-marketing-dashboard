'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut, ChevronDown, Settings as SettingsIcon } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { NotificationRail } from '@/components/notifications/rail';
import { capabilitiesFor } from '@/lib/crm/permissions';
import { visibleSections } from '@/lib/nav';
import { ICONS } from '@/components/nav-icons';
import { readChoiceList, writeChoiceList } from '@/lib/ui/remember';
import type { Profile } from '@/lib/types';

/** Which parent rows are folded away, remembered per machine. */
const SHUT_KEY = 'sidebar-shut';

/** The one row that is drawn in the footer instead. */
const SETTINGS_HREF = '/dashboard/settings';

/* =============================================================
   The sidebar.

   ---- What it no longer holds ----

   The list of screens. That lives in `lib/nav.ts` now, as plain data,
   because the breadcrumb needs the same list and two copies of it had
   already drifted apart. This file draws whatever that file says.

   ---- Icons resolved by name ----

   The configuration names an icon as a string, so it can one day be
   rows in a table. A React component cannot go in a table. This map is
   the one place the name becomes a component.

   ---- Gated on capability ----

   Not on a list of roles. Turning a permission off now takes the row
   out of the sidebar as well as refusing the screen behind it, so
   nobody is shown a door that will not open.

   ---- Team and Settings under the scroll ----

   Settings is the one thing everybody knows they want by name, and the
   one thing that should never move. It was row twelve of a scrolling
   list. It is pinned now, in its own section, separated by a rule
   rather than by more air: a rule reads as a different kind of thing
   starting, more air reads as the list continuing loosely.

   No heading on that section. Two rows do not need one.
   ============================================================= */


export function Sidebar({
  profile, pendingPosts = 0, emblemUrl = null,
}: {
  profile: Profile;
  pendingPosts?: number;
  emblemUrl?: string | null;
}) {
  const path = usePathname();

  const sections = useMemo(() => {
    const caps = capabilitiesFor(profile);
    return visibleSections((c) => caps.has(c));
  }, [profile]);

  const isActive = (href: string) => (
    href === '/dashboard' ? path === '/dashboard' : path.startsWith(href)
  );

  /* Which parent rows somebody has deliberately folded away.

     Read after the first paint, like the tracker's tab order and for
     the same reason: this component renders on the server too, and
     `localStorage` is not there. See `lib/ui/remember.ts`. */
  const [shut, setShut] = useState<string[]>([]);
  useEffect(() => { setShut(readChoiceList(SHUT_KEY)); }, []);
  const toggle = useCallback((href: string) => {
    setShut((was) => {
      const next = was.includes(href) ? was.filter((h) => h !== href) : [...was, href];
      writeChoiceList(SHUT_KEY, next);
      return next;
    });
  }, []);

  const rows = (items: ReturnType<typeof visibleSections>[number]['items']) => (
    <div className="sidebar__nav">
      {items.map((i) => {
        const Icon = ICONS[i.icon];
        const badge = i.badge === 'content' && pendingPosts > 0 ? String(pendingPosts) : undefined;
        const open = !!i.children?.length && isActive(i.href) && !shut.includes(i.href);

        /* A parent with children is not a link. Revenue redirects to a
           division, so clicking it and landing somewhere the sidebar
           did not name is the kind of small lie that makes people stop
           trusting navigation. It opens instead, and the children are
           the links. */
        if (i.children?.length) {
          return (
            <div key={i.href}>
              <Link
                href={i.children[0]!.href}
                className={`sidebar__item${open ? ' is-active' : ''}`}
                aria-expanded={open}
              >
                <Icon size={16} />
                <span>{i.label}</span>
                {/* THE CHEVRON CLOSES IT, EVEN WHILE YOU ARE IN THERE.

                    From the business: "Make it so i can click to close
                    the revenue sidebar while on one of the pages."

                    It could not be closed at all: `open` was
                    `isActive(i.href)`, so being on a revenue page forced
                    the three children open and the chevron was
                    decoration. It is a button now, inside the link and
                    stopping the click from reaching it, so pressing the
                    row still goes to the division and pressing the arrow
                    only folds the list.

                    Shut stays shut per division: the choice is
                    remembered on the machine, like the tracker's tab
                    order, so somebody who works all day on STC revenue
                    is not scrolling past two rows they never use. */}
                <button
                  type="button"
                  aria-label={open ? `Collapse ${i.label}` : `Expand ${i.label}`}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(i.href); }}
                  style={{
                    marginLeft: 'auto', border: 0, background: 'transparent', padding: 2,
                    display: 'flex', cursor: 'pointer', color: 'inherit', opacity: 0.55,
                  }}
                >
                  <ChevronDown
                    size={13}
                    style={{
                      transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
                      transition: 'transform 120ms ease',
                    }}
                  />
                </button>
              </Link>
              {open && (
                <div style={{ marginLeft: 26, display: 'flex', flexDirection: 'column' }}>
                  {i.children.map((c) => (
                    <Link
                      key={c.href}
                      href={c.href}
                      className={`sidebar__item${path === c.href ? ' is-active' : ''}`}
                    >
                      <span>{c.label}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        }

        return (
          <Link
            key={i.href}
            href={i.href}
            className={`sidebar__item${isActive(i.href) ? ' is-active' : ''}`}
          >
            <Icon size={16} />
            <span>{i.label}</span>
            {badge && <span className="badge badge--alert">{badge}</span>}
          </Link>
        );
      })}
    </div>
  );

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        {emblemUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={emblemUrl} alt="STC" width={38} height={38}
            style={{ borderRadius: 6, objectFit: 'contain' }} />
        ) : (
          <div style={{ width: 38, height: 38, borderRadius: 6, background: 'var(--bg-3)' }} />
        )}
        <div className="sidebar__brand-text">
          <div className="sidebar__brand-title">STC Workspace</div>
          <div className="sidebar__brand-sub">Marketing &amp; Sales</div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sections.filter((s) => !s.atFoot).map((s) => (
          <div key={s.key} className="sidebar__section">
            <div className="sidebar__section-head"><span>{s.label}</span></div>
            {rows(s.items)}
          </div>
        ))}
      </div>

      {/* SETTINGS IS A COG, NOT A ROW.

          From the business: "Change the settings tab to just a cog next
          to light/dark mode."

          It goes to the footer beside the theme toggle, which is where
          somebody looks for it: the two are the same kind of thing, a
          preference about your own account rather than a screen full of
          the company's work. Team and Admin keep their rows, because
          they are screens.

          Filtered out here rather than removed from `lib/nav.ts`. The
          breadcrumb, the command bar and the capability check all read
          that file, and a screen that vanishes from it becomes a screen
          the bar cannot reach and the crumb cannot name. */}
      {sections.filter((s) => s.atFoot).map((s) => {
        const items = s.items.filter((i) => i.href !== SETTINGS_HREF);
        if (!items.length) return null;
        return (
          <div key={s.key} className="sidebar__section sidebar__section--foot">
            {rows(items)}
          </div>
        );
      })}

      <NotificationRail />

      <div className="sidebar__footer">
        {/* The picture if there is one, initials if there is not. The
            initials are not a placeholder to be replaced later: most
            people will never upload one, and a grey circle would be
            worse than the two letters that are there today. */}
        {profile.photo_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={profile.photo_url} alt="" width={28} height={28} className="avatar"
            style={{ objectFit: 'cover', padding: 0 }} />
        ) : (
          <div className="avatar">
            {profile.full_name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
          </div>
        )}
        <div className="sidebar__user">
          <div className="sidebar__user-name">{profile.full_name}</div>
          <div className="sidebar__user-role">{profile.role}</div>
        </div>
        <ThemeToggle profileId={profile.id} initialTheme={profile.theme ?? 'dark'} />
        <Link
          href={SETTINGS_HREF}
          title="Settings"
          aria-label="Settings"
          className={`btn btn--icon${path.startsWith(SETTINGS_HREF) ? ' is-active' : ''}`}
        >
          <SettingsIcon size={14} />
        </Link>
        <form action="/auth/signout" method="post">
          <button type="submit" title="Sign out" className="btn btn--icon" aria-label="Sign out">
            <LogOut size={14} />
          </button>
        </form>
      </div>
    </aside>
  );
}
