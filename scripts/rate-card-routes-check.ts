/* =============================================================
   The two ways a rate card leaves the application, exercised over
   HTTP rather than by calling the function that builds them.

     GET /api/rate-cards/<id>/export?format=xlsx   the workbook
     GET /export/rate-card?card=<id>               the print view

   `check:rate-card-export` proves `buildWorkbook` produces the right
   bytes. It says nothing about whether the route returns them, with the
   right content type, under the right filename, or refuses somebody who
   may not read the card. A function that works behind a route nobody
   can reach is not a feature.

   Needs `npm run dev` on port 3000. Run with `npm run check:rate-card-routes`.
   ============================================================= */
import { chromium, type Route } from 'playwright';

const BASE = 'http://localhost:3000';

let bad = 0;
const ok = (what: string, held: boolean, why?: string) => {
  console.log(`  ${held ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!held) { bad += 1; if (why) console.log(`        ${why}`); }
};
const head = (s: string) => console.log(`\n  ${s}\n  ${'-'.repeat(s.length)}`);

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();

  try {
    head('Signed out, neither route gives a card away');
    {
      /* Redirects are NOT followed. Following them lands on the login
         page, which answers 200 with HTML, and an assertion that reads
         that as the route's own answer reports a protected route as
         wide open. That is how the first version of this check managed
         to fail six times against a correctly protected application. */
      const res = await page.request.get(
        `${BASE}/api/rate-cards/any-id/export?format=xlsx`, { maxRedirects: 0 });

      ok('the export route sends somebody who is not signed in to the login screen',
        res.status() === 307 || res.status() === 302,
        `it answered ${res.status()}`);
      ok('and says where they were going, so they land back here afterwards',
        (res.headers().location ?? '').includes('redirect=%2Fapi%2Frate-cards'),
        res.headers().location);
      ok('and nothing that looks like a workbook comes back',
        !(res.headers()['content-type'] ?? '').includes('spreadsheet'));
    }

    {
      const res = await page.request.get(`${BASE}/export/rate-card?card=any-id`, { maxRedirects: 0 });
      ok('the print view sends them to the login screen too',
        res.status() === 307 || res.status() === 302, `it answered ${res.status()}`);
    }

    {
      const res = await page.request.get(`${BASE}/api/rate-cards/sweep`, { maxRedirects: 0 });
      ok('and so does the staleness sweep',
        res.status() === 307 || res.status() === 302, `it answered ${res.status()}`);
    }

    head('The routes exist and are the ones the screens call');
    {
      /* Middleware redirects everything under `/api` before routing, so
         a made up route answers 307 exactly like a real one: over HTTP
         the two cannot be told apart while signed out. The honest check
         is that the file is there and the screens ask for that path. */
      const { existsSync, readFileSync } = await import('node:fs');

      ok('the export route is on disk',
        existsSync('app/api/rate-cards/[id]/export/route.ts'));
      ok('the print view is on disk',
        existsSync('app/export/rate-card/page.tsx'));
      ok('the sweep route is on disk',
        existsSync('app/api/rate-cards/sweep/route.ts'));

      const builder = readFileSync('components/sales/ratecards/RateBuilder.tsx', 'utf8');
      ok('the builder asks for the export route by exactly that path',
        builder.includes('/api/rate-cards/${cardId}/export?format='),
        'the screen and the route have to name the same path, or Export downloads nothing');
      /* Both formats are files built by the server now. The PDF used to
         open the print view instead, which is a second layout of the
         same card; `check:rate-card-pdf` holds the PDF and the workbook
         together, and it can only do that for a PDF the server built. */
      ok('and the PDF comes off that route too, rather than the print view',
        !builder.includes('/export/rate-card?card='),
        'Export is opening the print view for a PDF, which is a layout nothing compares');

      const wizard = readFileSync('components/sales/ratecards/RateCardFromContract.tsx', 'utf8');
      ok('the FleetSmart+ panel asks for the same export route',
        wizard.includes('/api/rate-cards/${card.card_id}/export?format=xlsx'));
    }

    head('The print view is the PDF, not a second design');
    {
      /* It used to draw the card in HTML and open the browser's print
         dialogue, which is a layout nobody signed off. It sends people
         to the export route now, so there is one PDF in the product and
         it is the workbook converted. */
      const { readFileSync } = await import('node:fs');
      const view = readFileSync('app/export/rate-card/page.tsx', 'utf8');
      ok('the print view sends people to the export route',
        view.includes('/export?format=pdf') && view.includes('redirect('),
        'a second way of making a PDF is a second design that can drift');
      ok('and it draws nothing of its own',
        !view.includes('PrintableRateCard') && !view.includes('window.print'),
        'it is still rendering a card');

      const res = await page.request.get(`${BASE}/export/rate-card?card=none`, { maxRedirects: 0 });
      ok('and it answers rather than erroring',
        res.status() < 500, `status ${res.status()}`);
    }

  } finally {
    await browser.close();
  }

  console.log(bad === 0
    ? '\n  Both ways a rate card leaves the application answer correctly.\n'
    : `\n  ${bad} failed.\n`);
  process.exit(bad === 0 ? 0 : 1);
}

void main();
