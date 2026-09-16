/* =============================================================
   Every element on the social planner, found and pressed.

   From the business, about the planner going into use today:

     make it so images uploaded to social posts actually save and the
     whole thing is wired end to end, using it from today for social
     post approvals

   The picture was one fault, and `check:social-composer` holds it. "The
   whole thing" is nine tabs, and the only honest way to say every
   control on them works is to press every control on them.

   ---- Why this has no list in it ----

   A list of controls to test is only as good as whoever wrote it, and
   whoever wrote the dead control is the same person writing the list.
   So this does not have one. It walks each tab, ENUMERATES every
   interactive element the browser can find, and presses each in turn.
   A control added tomorrow and left unwired fails on the day it is
   added, with nobody remembering to come here.

   ---- What counts as working ----

     change the page       the markup is different afterwards
     ask the database      a request went out
     say why it cannot     disabled, with a title that explains

   Anything else is a control that does nothing.

   Needs `npm run dev` on port 3000. Run with `npm run check:social-sweep`.
   ============================================================= */
import { chromium, type Page, type Route } from 'playwright';

const URL = 'http://localhost:3000/social-preview';

const TABS = [
  'Planner', 'Calendar', 'List', 'Queue', 'Library',
  'Templates', 'Tags', 'Channels', 'Activity',
];

let bad = 0;
let pressed = 0;
const ok = (what: string, held: boolean, why?: string) => {
  if (!held) { bad += 1; console.log(`  FAIL  ${what}`); if (why) console.log(`        ${why}`); }
};
const head = (s: string) => console.log(`\n  ${s}\n  ${'-'.repeat(s.length)}`);

/* -------------------------------------------------------------
   A backend that always answers.

   Every write the planner makes goes through `/api/content/**`, and the
   answers below are the shapes those routes really return. The point is
   not to test the routes: `check:social-approval` does that against
   real PostgreSQL. The point is that a control which asks the database
   gets far enough to change the screen, so "it did nothing" means it
   did nothing rather than "the stub refused it".
   ------------------------------------------------------------- */
async function stubs(page: Page) {
  const post = {
    id: 'post-new', content: 'A post', caption: null, first_comment: null,
    hashtags: [], platform: ['LinkedIn'], image_url: null, status: 'draft',
    scheduled_date: '2026-09-15', scheduled_at: null, from_queue: false,
    author_id: 'user-1', created_by: 'Dana Drafter', reviewed_by: null,
    approved_by_id: null, submitted_at: null, approved_at: null,
    rejected_at: null, rejection_note: null, published_at: null,
    failed_at: null, failure_reason: null, campaign_id: null,
    template_id: null, board_column_id: 'col-1', board_position: 0,
    link_url: null, utm_source: null, utm_medium: null, utm_campaign: null,
    utm_content: null, internal_note: null, lint_severity: 'clean',
    lint_findings: [], lint_hash: null, lint_checked_at: null,
    classification: 'internal', is_sensitive: false,
    created_at: '2026-09-15T08:00:00Z', updated_at: '2026-09-15T08:00:00Z',
  };

  await page.route('**/api/content/**', (route: Route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      post,
      posts: [post],
      variants: [],
      item: {
        id: `made-${Math.random().toString(36).slice(2, 8)}`,
        file_id: '00000000-0000-0000-0000-0000000000a3',
        name: 'A new picture', description: null, alt_text: null,
        approved_at: null, approved_by: null, use_count: 0,
        last_used_at: null, is_active: true, created_at: '2026-09-15T08:00:00Z',
      },
      template: {
        id: `tpl-${Math.random().toString(36).slice(2, 8)}`, name: 'A template',
        description: null, body: 'Words', first_comment: null,
        network_keys: ['linkedin'], hashtags: [], is_shared: true,
        use_count: 0, created_by: 'user-1', is_active: true,
      },
      tag: {
        id: `tag-${Math.random().toString(36).slice(2, 8)}`, name: 'A tag',
        slug: 'a_tag', description: null, position: 9, is_active: true,
      },
      channel: {
        id: `chan-${Math.random().toString(36).slice(2, 8)}`, network_key: 'linkedin',
        handle: 'new', display_name: 'A channel', avatar_file_id: null,
        profile_url: null, entity_id: null, timezone: 'Europe/London',
        state: 'connected', last_error: null, position: 9, is_active: true,
      },
      /* What the queue's own setting route answers. One time of day for
         the company, per migration 122. */
      at: '16:00:00',
      queue: [],
    }),
  }));

  /* PostgREST and storage, for anything that talks to Supabase
     directly rather than through a route of ours. */
  await page.route('**/rest/v1/**', (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: '[]',
  }));
  await page.route('**/storage/v1/**', (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: '{"Key":"brand-assets/x"}',
  }));
}

/** How an element is described when it fails, so it can be found. */
async function name(page: Page, index: number): Promise<string> {
  return page.evaluate((i) => {
    const el = (window as unknown as { __sweep: HTMLElement[] }).__sweep[i];
    if (!el) return 'gone';
    const text = (el.textContent ?? '').trim().slice(0, 40);
    const label = el.getAttribute('aria-label') ?? '';
    const title = el.getAttribute('title') ?? '';
    return `<${el.tagName.toLowerCase()}> ${text || label || title || '(no text)'}`;
  }, index);
}

/**
 * The list of elements on whatever is currently on screen.
 *
 * `root` matters when a drawer is open. The tabs and the New post
 * button are still IN the document behind an open drawer, and still
 * have a size, but nothing reaches them: the backdrop is over the top.
 * Sweeping the whole body with a drawer open therefore pressed the
 * backdrop at the New post button's coordinates and called that button
 * dead. What is reachable is what is inside the drawer, so that is what
 * is swept.
 */
async function rebuild(page: Page, skip: string[], root = 'body'): Promise<number> {
  return page.evaluate(([avoid, sel]) => {
    const scope = document.querySelector(sel as string) ?? document.body;
    const all = Array.from(scope.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, [role="switch"], a[href]'));
    const wanted = all.filter((el) => {
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) return false;
      /* The tab strip is driven deliberately, one tab at a time, so it
         is not swept as part of a tab's own contents: pressing a tab
         mid sweep would leave every element after it on a different
         screen than the one being reported. */
      if (el.getAttribute('aria-selected') !== null) return false;
      const text = ((el.textContent ?? '') + (el.getAttribute('aria-label') ?? '')).toLowerCase();
      return (avoid as string[]).some((s) => text.includes(s.toLowerCase())) === false;
    });
    (window as unknown as { __sweep: HTMLElement[] }).__sweep = wanted;
    return wanted.length;
  }, [skip, root] as [string[], string]);
}

/**
 * Press the button whose own text is exactly this.
 *
 * Playwright's `hasText` matches a SUBSTRING against the element and
 * its children, so on this screen `/new post/i` also matches the post
 * cards that contain those words, and `.first()` then picked one of
 * them. The composer never opened, the sweep ran over the planner
 * again, and it reported a pass. Exact text, and it says so if nothing
 * matched.
 */
async function press(page: Page, exact: string): Promise<boolean> {
  return page.evaluate((want) => {
    const el = Array.from(document.querySelectorAll('button'))
      .find((b) => (b.textContent ?? '').trim() === want);
    if (!el) return false;
    el.click();
    return true;
  }, exact);
}

async function openTab(page: Page, tab: string) {
  await page.locator('button[aria-selected]', { hasText: new RegExp(`^${tab}`) })
    .first().click().catch(() => {});
  await page.waitForTimeout(350);
}

async function sweep(
  page: Page,
  where: string,
  opts: {
    /** The tab that must still be the selected one afterwards. */
    tab: string;
    avoid?: string[];
    /** What is reachable. A drawer's own element when one is open. */
    root?: string;
    /* ---- How to get the screen back ----

       Half the controls in a drawer close it: Cancel, Save, the X. Once
       one of them is pressed every element after it in the list is
       disconnected and skipped, and the sweep then reports the one
       element it managed to press as a pass. That is how "composer: 1
       element" came out of a composer with nineteen controls in it. So
       a screen that can close says how to open it again. */
    reopen?: () => Promise<void>;
  },
) {
  const { tab, reopen } = opts;
  const avoid = opts.avoid ?? [];
  const root = opts.root ?? 'body';
  const count = await rebuild(page, avoid, root);
  let here = 0;

  for (let i = 0; i < count; i += 1) {
    const state = await page.evaluate((idx) => {
      const el = (window as unknown as { __sweep: HTMLElement[] }).__sweep[idx];
      if (!el || !el.isConnected) return null;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) return null;
      return {
        tag: el.tagName.toLowerCase(),
        disabled: (el as HTMLButtonElement).disabled === true,
        title: el.getAttribute('title') ?? '',
        text: (el.textContent ?? '').trim(),
        type: el.getAttribute('type') ?? '',
        readOnly: (el as HTMLInputElement).readOnly === true,
        current: el.getAttribute('aria-current') !== null
          || el.getAttribute('aria-pressed') === 'true',
        x: b.left + b.width / 2, y: b.top + b.height / 2,
      };
    }, i);
    if (!state) continue;

    const who = `${where}: ${await name(page, i)}`;

    if (state.disabled) {
      ok(`${who} is disabled and says why`, state.title.trim().length >= 10,
        `a disabled control needs a title naming what is missing; its title is "${state.title}"`);
      here += 1;
      continue;
    }
    if (state.current) { here += 1; continue; }

    /* The whole markup and the element's own value, because a select
       moving from one option to another changes nothing in the page's
       html at all. */
    const snap = async () => page.evaluate((idx) => {
      const el = (window as unknown as { __sweep: HTMLElement[] }).__sweep[idx];
      return {
        html: document.body.innerHTML,
        text: document.body.innerText,
        mine: el && el.isConnected
          ? `${el.className}|${(el as HTMLInputElement).value ?? ''}|${el.getAttribute('aria-checked') ?? ''}`
          : 'gone',
      };
    }, i);

    const before = await snap();
    let asked = false;
    const listen = () => { asked = true; };
    page.on('request', listen);

    try {
      if (state.tag === 'textarea'
        || (state.tag === 'input'
          && ['text', '', 'search', 'url', 'date', 'time', 'datetime-local'].includes(state.type)
          && !state.readOnly)) {
        await page.mouse.click(state.x, state.y);
        await page.keyboard.type('7', { delay: 20 });
        await page.keyboard.press('Tab');
      } else if (state.tag === 'select') {
        const [values, current] = await page.evaluate((idx) => {
          const el = (window as unknown as { __sweep: HTMLElement[] }).__sweep[idx] as HTMLSelectElement;
          return [Array.from(el.options).map((o) => o.value), el.value] as [string[], string];
        }, i);
        const other = values.find((v) => v !== current);
        if (other !== undefined) {
          await page.evaluate(([idx, v]) => {
            const el = (window as unknown as { __sweep: HTMLElement[] }).__sweep[idx as number] as HTMLSelectElement;
            el.value = v as string;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }, [i, other] as [number, string]);
        }
      } else {
        await page.mouse.click(state.x, state.y);
      }
      await page.waitForTimeout(260);
    } catch {
      /* Moved under the pointer. Not a failure on its own. */
    }

    page.off('request', listen);
    const after = await snap();

    const didSomething =
      asked
      || after.html !== before.html
      || after.text !== before.text
      || after.mine !== before.mine;

    ok(`${who} does something when pressed`, didSomething,
      'pressing it changed nothing on the page and asked the database nothing. '
      + 'Wire it, or disable it with a title naming what is missing.');

    pressed += 1;
    here += 1;

    /* Anything that opened is closed again, so the next element in the
       list is still the one that was inspected. */
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(140);

    /* ---- And if the press changed the tab, come back ----

       A control inside a tab can send somebody to another one, and the
       rate card sweep's own first version stopped dead at the first
       such press and still reported a pass. Checked every time rather
       than assumed. */
    const still = await page.evaluate((t) => {
      const on = Array.from(document.querySelectorAll('button[aria-selected="true"]'))
        .map((el) => (el.textContent ?? '').trim());
      return on.some((s) => s.startsWith(t));
    }, tab);
    if (!still) {
      await openTab(page, tab);
      await rebuild(page, avoid, root);
    }

    /* ---- And if the press closed the screen, open it again ---- */
    if (reopen) {
      const there = await page.locator(root).count();
      if (there === 0) {
        await reopen();
        await page.waitForTimeout(300);
        await rebuild(page, avoid, root);
      }
    }
  }

  console.log(`  ok    ${where}: ${here} element(s) found, every one wired or explained`);
}

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1080 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  /* Delete asks first. Saying yes is the interesting path, and a
     dialog nobody answers stops the whole sweep. */
  page.on('dialog', (d) => { void d.accept(); });

  await stubs(page);

  try {
    for (const tab of TABS) {
      head(`The ${tab.toLowerCase()} tab`);
      await page.goto(URL, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      await openTab(page, tab);
      await sweep(page, tab.toLowerCase(), { tab });
    }

    /* ---------------------------------------------------------
       The queue's own setting, end to end from the screen.

       From the business:

         'next free slot' in socials, have this push it to the next
         available day where nothing is scheduled, at 3pm.

       The sweep above only asks whether pressing it does anything. This
       asks whether the right thing goes to the right place: the rule
       itself is proved against real PostgreSQL by `npm run
       check:next-slot`, and this is the wire between the two.
       --------------------------------------------------------- */
    head('The queue posts at the time the screen says');
    {
      await page.goto(URL, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      await openTab(page, 'Queue');
      await page.waitForTimeout(300);

      const field = page.locator('input[aria-label="What time of day the queue posts"]');
      ok('the queue has a time on it', await field.count() === 1);
      ok('and it starts at the setting the page was given',
        (await field.inputValue()) === '15:00', `it reads ${await field.inputValue()}`);

      const save = page.locator('button', { hasText: 'Save' }).first();
      ok('Save is refused until the time is actually different',
        await save.isDisabled(),
        'a Save that saves what is already saved teaches people to press it for nothing');

      await field.fill('16:00');
      await page.waitForTimeout(150);
      ok('and offered once it is', !(await save.isDisabled()));

      let sent: { method: string; url: string; body: string } | null = null;
      const watch = (r: { method(): string; url(): string; postData(): string | null }) => {
        if (r.url().includes('/api/content/queue/settings')) {
          sent = { method: r.method(), url: r.url(), body: r.postData() ?? '' };
        }
      };
      page.on('request', watch);
      await save.click();
      await page.waitForTimeout(500);
      page.off('request', watch);

      const put = sent as { method: string; url: string; body: string } | null;
      ok('pressing Save sends the time to the queue\u2019s own route',
        put !== null && put.method === 'PUT',
        put === null ? 'nothing was sent anywhere' : `it sent ${put.method} ${put.url}`);
      ok('and sends the time that is on the screen',
        put !== null && put.body.includes('16:00'),
        put === null ? '' : `it sent ${put.body}`);

      /* The field shows what the SERVER said, not what was typed. The
         two are the same here because the stub agrees, and the point is
         that the screen is reading the answer rather than assuming it
         worked. */
      ok('and the field then shows what came back',
        (await field.inputValue()) === '16:00', `it reads ${await field.inputValue()}`);
    }

    head('The composer, opened from the planner');
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const openComposer = async () => {
      if ((await page.locator('[role="dialog"]').count()) > 0) return;
      await press(page, 'New post');
      await page.waitForTimeout(700);
      /* Leaving a half typed post behind asks before it closes. Saying
         yes is what gets back to a clean composer. */
      await press(page, 'Discard it');
      await page.waitForTimeout(200);
      if ((await page.locator('[role="dialog"]').count()) === 0) {
        await press(page, 'New post');
        await page.waitForTimeout(700);
      }
    };
    ok('New post is there to press', await press(page, 'New post'));
    await page.waitForTimeout(900);
    ok('and it opens the composer', (await page.locator('[role="dialog"] textarea').count()) > 0,
      'no composer on screen after pressing New post');
    await sweep(page, 'composer', {
      tab: 'Planner', root: '[role="dialog"]', reopen: openComposer,
    });

    head('What a post will look like, from the list');
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await openTab(page, 'List');
    const openPreview = async () => {
      if ((await page.locator('[role="dialog"]').count()) > 0) return;
      await page.locator('button[aria-label="Preview this post"]').first()
        .click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
    };
    await openPreview();
    ok('Preview this post opens the preview', (await page.locator('[role="dialog"]').count()) > 0,
      'pressing Preview this post on the list opened nothing');
    await sweep(page, 'post preview', {
      tab: 'List', root: '[role="dialog"]', reopen: openPreview,
    });

    /* ---- And the post's own drawer ----

       A different screen from the preview above, reached by pressing
       the card rather than the eye beside it, and the one that carries
       Approve, Reject, Schedule, the channel table and the timeline.
       The first version of this check swept the preview, saw one
       control in it, and reported a pass: the drawer with all the
       controls in it was never opened at all. */
    head('A post opened from the board');
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const openDrawer = async () => {
      if ((await page.locator('[role="dialog"]').count()) > 0) return;
      await page.locator('button', { hasText: 'Waiting on a yes from Business Development' })
        .first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
    };
    await openDrawer();
    ok('pressing a card opens the post', (await page.locator('[role="dialog"]').count()) > 0,
      'pressing a post card on the board opened nothing');
    ok('and it is the post itself, not the preview of it',
      (await page.locator('[role="dialog"]').innerText()).includes('CHANNELS'),
      'the drawer that opened is not the post drawer');
    /* The two controls the business asked about by name. A post
       somebody else submitted is waiting on exactly these. */
    for (const control of ['Approve', 'Send back']) {
      ok(`and ${control} is on a post waiting for review`,
        (await page.locator('[role="dialog"] button', { hasText: control }).count()) > 0,
        `no ${control} button on a post in pending review written by somebody else`);
    }
    await sweep(page, 'post drawer', {
      tab: 'Planner', root: '[role="dialog"]', reopen: openDrawer,
    });

    head('Nothing threw while every element was pressed');
    ok('no page errors', errors.length === 0, errors.slice(0, 5).join('\n        '));
  } finally {
    await browser.close();
  }

  console.log(bad === 0
    ? `\n  ${pressed} element(s) pressed across nine tabs. Every one did something.\n`
    : `\n  ${bad} failed out of ${pressed} pressed.\n`);
  process.exit(bad === 0 ? 0 : 1);
}

void main();
