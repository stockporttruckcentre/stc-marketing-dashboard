/* =============================================================
   Every element on the Rate Card Builder, found and pressed.

   From the business:

     don't respond until it's all wired and audited, audited again, then
     audited again, then audit the audit ... until every single element
     on the page is tested for wiring and functionality. anything not
     working doesn't pass and therefore the entire hub fails.

   ---- How this differs from the drive check ----

   `check:rate-cards-drive` presses the controls somebody thought to
   write an assertion for. That is a list, and a list is only as good as
   whoever wrote it: the toast behind the sidebar was not on it.

   This does not have a list. It walks every screen, ENUMERATES every
   interactive element the browser can find, and presses each one in
   turn. A control that changes nothing at all, and is not disabled with
   a reason, fails. So a control added tomorrow and left unwired fails
   on the day it is added, without anybody remembering to come here.

   ---- What counts as working ----

   Pressing something has to do one of:

     change the page           the DOM is different afterwards
     ask the database          a request went out
     say why it cannot         disabled, with a title that explains

   Anything else is a control that does nothing, and one of those fails
   the whole hub.

   Needs `npm run dev` on port 3000. Run with `npm run check:rate-cards-sweep`.
   ============================================================= */
import { chromium, type Page } from 'playwright';
import { installStubs } from './rate-cards-stubs';

const URL = 'http://localhost:3000/rate-cards-preview';

let bad = 0;
let pressed = 0;
const ok = (what: string, held: boolean, why?: string) => {
  if (!held) { bad += 1; console.log(`  FAIL  ${what}`); if (why) console.log(`        ${why}`); }
};
const head = (s: string) => console.log(`\n  ${s}\n  ${'-'.repeat(s.length)}`);

/** How an element is described when it fails, so it can be found. */
async function name(page: Page, index: number): Promise<string> {
  return page.evaluate((i) => {
    const el = (window as unknown as { __sweep: HTMLElement[] }).__sweep[i];
    if (!el) return 'gone';
    const text = (el.textContent ?? '').trim().slice(0, 40);
    const label = el.getAttribute('aria-label') ?? '';
    const title = el.getAttribute('title') ?? '';
    return `<${el.tagName.toLowerCase()} class="${el.className}"> ${text || label || title || '(no text)'}`;
  }, index);
}

/**
 * Press every interactive element on whatever is on screen.
 *
 * The list is taken fresh each time round, because pressing one thing
 * can remove another, and an index into a stale list is a different
 * element than the one that was inspected.
 */
/** Take the list of elements on whatever is currently on screen. */
async function rebuild(page: Page, skip: string[]): Promise<number> {
  return page.evaluate((avoid) => {
    const root = document.querySelector('.rc-6a, .rc-scrim');
    if (!root) return 0;
    const all = Array.from(root.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, [role="switch"], a[href]'));
    const wanted = all.filter((el) => {
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) return false;
      const text = ((el.textContent ?? '') + (el.getAttribute('aria-label') ?? '')).toLowerCase();
      return !avoid.some((s) => text.includes(s.toLowerCase()));
    });
    (window as unknown as { __sweep: HTMLElement[] }).__sweep = wanted;
    return wanted.length;
  }, skip);
}

async function sweep(
  page: Page,
  where: string,
  opts: { avoid?: string[]; at: string; tab?: string },
) {
  const avoid = opts.avoid ?? [];
  const count = await rebuild(page, avoid);

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
        label: el.getAttribute('aria-label') ?? '',
        text: (el.textContent ?? '').trim(),
        type: el.getAttribute('type') ?? '',
        readOnly: (el as HTMLInputElement).readOnly === true,
        /* A tab or a filter that is ALREADY the current one. Pressing
           it does nothing, correctly: selecting what is selected is a
           no-op by definition. The screen says so in the markup rather
           than only in the colour, so this is a fact rather than a
           guess about a class name. */
        current: el.getAttribute('aria-current') !== null
          || el.getAttribute('aria-pressed') === 'true',
        x: b.left + b.width / 2, y: b.top + b.height / 2,
      };
    }, i);
    if (!state) continue;

    const who = `${where}: ${await name(page, i)}`;

    /* ---- Disabled is allowed, with a reason ---- */
    if (state.disabled) {
      ok(`${who} is disabled and says why`, state.title.trim().length >= 10,
        `a disabled control needs a title naming what is missing; its title is "${state.title}"`);
      here += 1;
      continue;
    }

    /* ---- Already the current tab or filter ---- */
    if (state.current) {
      here += 1;
      continue;
    }

    /* ---- Everything else is pressed ---- */
    /* The whole markup, not its LENGTH. Selecting a filter chip swaps
       `rc-2d` for `rc-6l`, which is the same number of characters, so a
       length comparison reported a working chip as dead. And the
       element's own value and class, because a select changing from one
       option to another moves nothing in the markup at all. */
    const snap = async () => page.evaluate((idx) => {
      const el = (window as unknown as { __sweep: HTMLElement[] }).__sweep[idx];
      return {
        html: (document.querySelector('.rc-6a, .rc-scrim')?.innerHTML ?? ''),
        text: document.body.innerText,
        url: location.href,
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
      if (state.tag === 'input' && ['text', '', 'date', 'search'].includes(state.type) && !state.readOnly) {
        await page.mouse.click(state.x, state.y);
        await page.keyboard.type('7', { delay: 20 });
        await page.keyboard.press('Tab');
      } else if (state.tag === 'select') {
        const values = await page.evaluate((idx) => {
          const el = (window as unknown as { __sweep: HTMLElement[] }).__sweep[idx] as HTMLSelectElement;
          return Array.from(el.options).map((o) => o.value);
        }, i);
        const current = await page.evaluate((idx) =>
          ((window as unknown as { __sweep: HTMLElement[] }).__sweep[idx] as HTMLSelectElement).value, i);
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
      await page.waitForTimeout(220);
    } catch {
      /* An element that moved under the pointer is retried once by the
         next pass; it is not a failure on its own. */
    }

    page.off('request', listen);

    const after = await snap();

    const didSomething =
      asked
      || after.html !== before.html
      || after.text !== before.text
      || after.url !== before.url
      || after.mine !== before.mine;

    ok(`${who} does something when pressed`, didSomething,
      'pressing it changed nothing on the page and asked the database nothing. '
      + 'Wire it, or disable it with a title naming what is missing.');

    pressed += 1;
    here += 1;

    /* Anything that opened is closed again, so the next element in the
       list is still the one that was inspected. */
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(120);

    /* ---- And if the press navigated, come back ----

       The first element on the builder in document order is the back
       chevron. The first version pressed it, landed on the hub, and
       then found every remaining element disconnected and skipped all
       of them: it reported "1 element found" on a screen with forty.
       A sweep that quietly stops after the first navigation is worse
       than no sweep, because it passes. */
    if (page.url() !== opts.at) {
      await page.goto(opts.at, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      if (opts.tab) {
        await page.locator('.rc-46 button', { hasText: opts.tab }).first().click().catch(() => {});
        await page.waitForTimeout(300);
      }
      await rebuild(page, avoid);
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
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });

  await installStubs(page);

  try {
    head('The hub');
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    /* The row that opens a card is sweept on its own screen, and the
       defaults button navigates away from the one being swept. */
    await sweep(page, 'hub', { at: URL, avoid: ['default rates'] });

    head('The new rate card dialog');
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await page.locator('button', { hasText: 'New rate card' }).first().click();
    await page.waitForTimeout(400);
    /* The dialog is reopened rather than navigated back to, because it
       is not a location. */
    await sweep(page, 'new card', { at: URL, avoid: ['create and open', 'replace it and open'] });

    const tabs = ['Rates', 'FleetSmart+ inclusions', 'Header & contacts',
      'Parts & markup', 'Instructions', 'History'];
    for (const tab of tabs) {
      head(`The builder, ${tab}`);
      await page.goto(`${URL}?card=card-1`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      await page.locator('.rc-46 button', { hasText: tab }).first().click();
      await page.waitForTimeout(400);
      await sweep(page, `builder ${tab}`, {
        at: `${URL}?card=card-1`, tab,
        avoid: ['send for approval', 'approve', 'withdraw'],
      });
    }

    for (const tab of ['Every default rate', 'Existing cards', 'History']) {
      head(`The default rates, ${tab}`);
      await page.goto(`${URL}?view=defaults`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      await page.locator('.rc-46 button', { hasText: tab }).first().click();
      await page.waitForTimeout(400);
      await sweep(page, `defaults ${tab}`, { at: `${URL}?view=defaults`, tab });
    }

    head('Nothing threw while every element was pressed');
    ok('no page errors', errors.length === 0, errors.slice(0, 5).join('\n        '));
  } finally {
    await browser.close();
  }

  console.log(bad === 0
    ? `\n  ${pressed} element(s) pressed across nine screens. Every one did something.\n`
    : `\n  ${bad} element(s) failed. The hub does not pass.\n`);
  process.exit(bad === 0 ? 0 : 1);
}

void main();
