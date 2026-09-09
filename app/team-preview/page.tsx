'use client';

/* =============================================================
   The team directory, with a fixture behind it.

   Same reason as `/analytics-preview`: this mounts the REAL panel, not
   a copy of it, so what is looked at here is what the Team tab draws.
   A mock of the screen proves the mock.

   The pictures are data URIs. A remote image would make this page fail
   differently on a machine with no network, which is the wrong thing
   for a harness to be sensitive to. Two people have one, one person has
   a URL that will never load, and the rest have none. All three states
   have to look right, and the middle one is the one nobody remembers to
   test: a picture that 404s must fall back to initials rather than
   drawing a broken image icon in a 40px circle.

   Not linked from anywhere and not in the command bar.
   ============================================================= */
import { useEffect } from 'react';
import { TeamPanel } from '@/components/TeamPanel';

/* A flat colour and two letters, drawn as an SVG, so the fixture needs
   nothing off the network. Deliberately not the initials the component
   would draw, so it is obvious at a glance which is a picture. */
function face(bg: string, mark: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">` +
    `<rect width="96" height="96" fill="${bg}"/>` +
    `<text x="48" y="62" font-family="Helvetica" font-size="40" font-weight="bold" ` +
    `fill="#ffffff" text-anchor="middle">${mark}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const TEAM = [
  {
    id: '1', full_name: 'Tom Whitfield', email: 'tom@stc.test',
    job_title: 'Managing Director', photo_url: face('#09163A', '★'),
    location: 'Stockport', department: 'Board', manager: null,
    role: 'admin', role_template: 'Administrator', template_slug: 'administrator',
    is_active: true, capabilities: 72, overrides: 0, joined: '2019-03-04',
  },
  {
    id: '2', full_name: 'Dave Hollins', email: 'dave@stc.test',
    job_title: 'Sales Manager', photo_url: face('#CF2417', '●'),
    location: 'Carrington', department: 'Trailer Sales', manager: 'Tom Whitfield',
    role: 'sales', role_template: null, template_slug: null,
    is_active: true, capabilities: 41, overrides: 2, joined: '2021-06-14',
  },
  {
    /* A picture that will never load. The circle must fall back to
       initials rather than showing the browser's broken image icon. */
    id: '3', full_name: 'Alex Rowntree', email: 'alex@stc.test',
    job_title: 'Head of Rentals', photo_url: 'https://example.invalid/gone.jpg',
    location: 'Stockport', department: 'Rentals', manager: 'Tom Whitfield',
    role: 'sales', role_template: null, template_slug: null,
    is_active: true, capabilities: 38, overrides: 0, joined: '2022-01-10',
  },
  {
    id: '4', full_name: 'Rama Devi', email: 'rama@stc.test',
    job_title: 'Accounts', photo_url: null,
    location: 'Stockport', department: 'Finance', manager: 'Tom Whitfield',
    role: 'viewer', role_template: 'Read only', template_slug: 'viewer',
    is_active: true, capabilities: 12, overrides: 0, joined: '2023-09-01',
  },
  {
    id: '5', full_name: 'Gareth Pryce', email: 'gareth@stc.test',
    job_title: 'Workshop Supervisor', photo_url: null,
    location: 'Carrington', department: 'Maintenance', manager: 'Dave Hollins',
    role: 'sales', role_template: null, template_slug: null,
    is_active: true, capabilities: 33, overrides: 1, joined: '2020-11-23',
  },
  {
    id: '6', full_name: 'Molly Fairbrother', email: 'molly@stc.test',
    job_title: 'Marketing', photo_url: null,
    location: 'Stockport', department: 'Marketing', manager: 'Tom Whitfield',
    role: 'marketer', role_template: null, template_slug: null,
    is_active: false, capabilities: 19, overrides: 0, joined: '2024-02-19',
  },
];

export default function TeamPreview() {
  useEffect(() => { document.title = 'Team preview'; }, []);
  return (
    <div className="content">
      <div className="content__inner">
        <TeamPanel selfId="1" mayManage />
      </div>
    </div>
  );
}

/* The panel calls `team_directory` through the browser client on mount,
   so the interception is at module scope: by the time the effect above
   runs, the request has already gone. */
if (typeof window !== 'undefined') {
  const w = window as unknown as { __teamFixture?: boolean };
  if (!w.__teamFixture) {
    w.__teamFixture = true;
    const real = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/rest/v1/rpc/team_directory')) {
        return new Response(JSON.stringify(TEAM), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/rest/v1/rpc/')) {
        return new Response('true', {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      return real(input, init);
    };
  }
}
