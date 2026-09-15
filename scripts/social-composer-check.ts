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
