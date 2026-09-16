/* =============================================================
   What the composer actually SENDS when a post is saved.

   From the business, about the planner going into use today:

     make it so images uploaded to social posts actually save and the
     whole thing is wired end to end

   They did not save, and no amount of looking at the screen would have
   shown it. The composer uploaded the picture, held the URL, drew it in
   its own preview and then left `image_url` out of the body it posted.
   The screen was right at every step. Only the request was wrong.

   So this check watches the request. That is the only place the fault
   was ever visible, and it is the assertion that would have caught it.

   Needs `npm run dev` on port 3000. Run with `npm run check:social-composer`.
   ============================================================= */
import { chromium, type Route } from 'playwright';

const URL = 'http://localhost:3000/composer-preview';

let bad = 0;
const ok = (what: string, held: boolean, why?: string) => {
  console.log(`  ${held ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!held) { bad += 1; if (why) console.log(`        ${why}`); }
};
const head = (s: string) => console.log(`\n  ${s}\n  ${'-'.repeat(s.length)}`);

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  /* Every body the composer posts, kept, so the assertions can be about
     what was sent rather than about what the screen looked like. */
  const sent: { url: string; body: Record<string, unknown> }[] = [];

  await page.route('**/api/content/**', async (route: Route) => {
    const raw = route.request().postData();
    if (raw && route.request().method() !== 'GET') {
      try { sent.push({ url: route.request().url(), body: JSON.parse(raw) }); } catch { /* not JSON */ }
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        post: {
          id: 'post-1', content: 'A post about a truck', status: 'draft',
          image_url: null, author_id: 'u1', scheduled_at: null, hashtags: [],
        },
      }),
    });
  });
  await page.route('**/rest/v1/**', (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: '[]',
  }));

  try {
    head('A post with a picture on it');
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    ok('the composer opens', await page.locator('textarea').first().isVisible());

    await page.locator('textarea').first().fill('A post about a truck');
    await page.waitForTimeout(150);

    /* Attach a picture the way somebody does. */
    const file = await page.locator('input[type="file"]').first();
    await file.setInputFiles({
      name: 'truck.png',
      mimeType: 'image/png',
      /* A one pixel PNG, so it is a real image rather than bytes that
         happen to be named like one. */
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    });
    await page.waitForTimeout(700);

    ok('the picture appears in the composer',
      (await page.locator('img[src*="uploaded"]').count()) > 0,
      'the upload did not put an image on screen');

    /* Pick a channel, or submitting is refused. */
    const channel = page.locator('text=STC LinkedIn').first();
    if (await channel.count()) { await channel.click(); await page.waitForTimeout(200); }

    /* Save it. */
    const save = page.locator('button', { hasText: /save|draft/i }).first();
    await save.click();
    await page.waitForTimeout(900);

    head('And the request carried it');
    const create = sent.find((s) => s.url.includes('/api/content/posts') && !s.url.includes('/variants'));
    ok('the composer posted the new post', create !== undefined,
      `it sent ${sent.length} request(s): ${sent.map((s) => s.url).join(', ')}`);

    ok('and the body carries image_url at all',
      create !== undefined && 'image_url' in create.body,
      `the body had these keys: ${create ? Object.keys(create.body).join(', ') : 'nothing'}`);

    ok('and it is the picture that was uploaded, not null',
      typeof create?.body.image_url === 'string'
      && (create.body.image_url as string).includes('truck.png'),
      `image_url came out as ${JSON.stringify(create?.body.image_url)}`);

    ok('and the words are there too, so nothing else was lost',
      create?.body.content === 'A post about a truck');

    /* =============================================================
       A post that saves and then fails to submit is still a post.

       From the business, using the planner for real:

         drafts aren't saving in the social editor
         [...] the draft now shows after 10 minutes

       They were saving. "Save and send for approval" writes the post
       and then submits it, and when the submission was refused the
       composer returned early with the error and told the screen
       nothing. The row existed, correct, and no list on the screen had
       heard of it until something reloaded the page.

       So: make the submission fail, and assert the post reaches the
       screen anyway.
       ============================================================= */
    head('A post that cannot be submitted is still saved, and still shows');

    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    /* ---- Pick the channel by what the button actually says ----

       The channel button reads "LinkedIn@stc", the network's label and
       the handle, not the display name. Looking for the display name
       found nothing, the channel was never picked, and the composer
       refused the submission with "Pick at least one channel" before it
       sent a single request. Which the check then read as the fault it
       was looking for. */
    /* Registered after the general one, so it wins: Playwright matches
       the most recently added route first. */
    await page.route('**/api/content/posts/*/transition', (route: Route) => route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false, error: 'refused',
        message: 'You wrote this, so somebody else has to approve it.',
      }),
    }));

    await page.locator('textarea').first().fill('A post that will not submit');
    await page.waitForTimeout(150);
    const pick = page.locator('button', { hasText: /^LinkedIn@/ }).first();
    ok('the channel is there to pick', (await pick.count()) > 0,
      'no channel button, so nothing below is testing what it says it is');
    await pick.click();
    await page.waitForTimeout(250);

    const submit = page.locator('button', { hasText: /send for approval/i }).first();
    ok('the submit button is there', (await submit.count()) > 0);
    await submit.click();
    await page.waitForTimeout(1200);

    const told = (await page.locator('[data-told]').first().textContent()) ?? '';

    ok('the screen was told the post exists', told.includes('stored:'),
      `the screen was told: "${told}". A post was written and nothing on the screen heard about it.`);

    ok('and the composer stayed open with the reason',
      (await page.locator('textarea').count()) > 0,
      'the composer closed, so the person never saw why it was not submitted');

    ok('and it says why it was not submitted',
      (await page.locator('body').innerText()).toLowerCase().includes('approve'),
      'no message on screen about the refusal');

    head('Nothing threw while any of that happened');
    ok('no page errors', errors.length === 0, errors.slice(0, 3).join('\n        '));
  } finally {
    await browser.close();
  }

  console.log(bad === 0
    ? '\n  A picture put on a post is in the request that saves it.\n'
    : `\n  ${bad} failed.\n`);
  process.exit(bad === 0 ? 0 : 1);
}

void main();
