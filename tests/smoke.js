// Browser smoke test: loads the site in headless Chromium, opens every tab and one
// member, bill and vote detail, and fails on any uncaught error or console error.
//
//   npm run smoke                                   # serves ./public locally
//   SMOKE_URL=https://congress-watcher.netlify.app npm run smoke   # the live site
//
// Local mode serves public/ only (no Netlify functions), so Campaign Finance and other
// function calls are skipped there and their 404s are ignored. Both modes read the
// real Firestore (~30 reads per run). Needs: npx playwright install chromium

/* global document, location */ // used inside page.evaluate / waitForFunction callbacks (run in the browser)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const LIVE = process.env.SMOKE_URL;
const MEMBER = 'J000298';             // Rep. Pramila Jayapal (WA-7)
const BILL = 'hr1-119';               // One Big Beautiful Bill Act (became law)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function serve(dir) {
  const server = http.createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    try {
      const body = await readFile(join(dir, path.endsWith('/') ? `${path}index.html` : path));
      res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || (path.endsWith('/') ? 'text/html' : 'application/octet-stream') });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const failures = [];
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) failures.push(what); };

const server = LIVE ? null : await serve('public');
const url = LIVE || `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', err => errors.push(`uncaught: ${err.message}`));
page.on('console', msg => {
  if (msg.type() !== 'error') return;
  const text = msg.text();
  // Locally there are no Netlify functions: their 404s (and the modal's handled
  // fallback) are expected.
  if (!LIVE && /404|\/api\/|\.netlify\/functions|Failed to load resource/.test(text)) return;
  errors.push(`console: ${text}`);
});

const text = sel => page.locator(sel).innerText({ timeout: 20000 });
const waitText = async (sel, pattern, what) => {
  try {
    await page.waitForFunction(([s, p]) => new RegExp(p, 'i').test(document.querySelector(s)?.innerText || ''), [sel, pattern.source], { timeout: 20000 });
    check(true, what);
  } catch {
    check(false, `${what} (got: ${(await text(sel).catch(() => '')).slice(0, 120).replace(/\s+/g, ' ')})`);
  }
};
const openDetail = (kind, id) => page.evaluate(([k, i]) => {
  const b = document.createElement('button');
  b.dataset.open = k; b.dataset.id = i;
  document.body.appendChild(b); b.click(); b.remove();
}, [kind, id]);
const modalTab = name => page.locator('#modal-root button', { hasText: new RegExp(`^${name}$`) }).first().click();
const closeModal = () => page.keyboard.press('Escape');

try {
  console.log(`Smoke test: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  await waitText('#overview-container', /How busy has Congress been/, 'Overview charts render');
  await waitText('#headline-stats', /SENATORS[\s\S]*BILLS COVERED[\s\S]*ROLL-CALL VOTES/i, 'Header cards render');
  await waitText('footer', /Data last updated/, 'Footer shows data freshness');

  await page.click('#nav-issues');
  await waitText('#view-issues', /What the \d+(st|nd|rd|th) Congress has done/, 'Issues tab renders');
  // Back from the first tab switch returns to the Overview (it used to leave the site).
  await page.goBack();
  await page.waitForTimeout(500);
  check(!(await page.isHidden('#view-overview')) && !page.url().includes('#issues'), 'Back from Issues returns to the Overview');
  await page.goForward();
  await waitText('#view-issues', /What the \d+(st|nd|rd|th) Congress has done/, 'Forward returns to Issues');
  // Switching topics repeatedly mustn't stack listeners (they threw on watchlist clicks).
  for (const t of ['foreign-affairs', 'economy', 'foreign-affairs']) {
    await page.click(`#issue-topics [data-topic="${t}"]`);
    await page.waitForTimeout(700);
  }
  const watch = await page.$('#issue-container [data-watch]');
  if (watch) await watch.click();
  await waitText('#issue-title', /Foreign Affairs/, 'Topic switching (errors would fail the console check)');

  await page.click('#nav-bills');
  await waitText('#bills-container', /Latest action \(\d{4}-\d{2}-\d{2}\)/, 'Bills tab lists bills');
  const dates = await page.$$eval('#bills-container', els => [...els[0].innerText.matchAll(/Latest action \((\d{4}-\d{2}-\d{2})\)/g)].map(m => m[1]));
  check(dates.length > 0 && dates.every((d, i) => !i || dates[i - 1] >= d), `Bills are newest first (${dates.length} checked)`);
  await page.fill('#search-input', 'HR 1');
  await waitText('#bills-container', /H\.?R\.? ?1\b/, 'Bill-number search finds H.R. 1');
  await page.fill('#search-input', '');

  await page.click('#nav-votes');
  await waitText('#votes-container', /Roll call|roll call/, 'Votes tab lists votes');
  await page.click('#view-votes [data-chamber="Senate"]');
  await waitText('#votes-container', /Senate roll call/, 'Senate chamber filter');
  const houseShown = await page.$eval('#votes-container', el => /House roll call/i.test(el.innerText));
  check(!houseShown, 'Senate filter hides House votes');
  await page.click('#view-votes [data-chamber=""]');

  await page.click('#nav-members');
  await waitText('#members-container', /\w/, 'Legislators tab lists members');
  await page.selectOption('#state-select', 'TX');
  await waitText('#members-container', /Cornyn/, 'State filter shows Texas members');
  check(page.url().endsWith('#legislators/TX'), `URL follows the state filter (${page.url().split('#')[1]})`);
  if (LIVE) {
    await page.fill('#find-reps-address', '400 Broad St, Seattle, WA 98109');
    await page.click('#find-reps button[type=submit]');
    await waitText('#find-reps-result', /Your representatives: WA-7[\s\S]*Jayapal/, 'Find your representatives (address -> WA-7)');
  }

  await openDetail('member', MEMBER);
  await waitText('#modal-root', /Jayapal/, 'Member detail opens');
  await modalTab('Voting Record');
  await waitText('#modal-root', /In the \d+(st|nd|rd|th) Congress, voted on \d+ of \d+/, 'Member Voting Record renders');
  if (LIVE) {
    await modalTab('Campaign Finance');
    await waitText('#modal-root', /RAISED|Raised/, 'Campaign Finance renders');
  }
  await closeModal();

  await openDetail('bill', BILL);
  await waitText('#modal-root', /H\.?R\.? ?1\b/, 'Bill detail opens');
  // A recorded vote from the bill's Votes tab opens on the stack; Back returns.
  await modalTab('Votes');
  await page.locator('#modal-root [data-open="vote"]').first().click({ timeout: 20000 });
  await waitText('#modal-root', /Yea|Nay|Aye/, 'Vote opens inside the bill detail');
  // Keyboard focus stays in the dialog: Tab from the last control wraps to the first.
  const wrapped = await page.evaluate(async () => {
    const d = document.querySelector('#modal-root [role=dialog]');
    const items = [...d.querySelectorAll('a[href], button:not([disabled]), input, select, textarea')].filter(el => el.offsetParent !== null);
    items.at(-1).focus();
    return items.length > 1 && d.contains(document.activeElement);
  });
  await page.keyboard.press('Tab');
  const inDialog = await page.evaluate(() => document.querySelector('#modal-root [role=dialog]').contains(document.activeElement));
  check(wrapped && inDialog, 'Tab focus stays inside the detail window');
  await page.click('#modal-root [data-back]');
  await waitText('#modal-root', /H\.?R\.? ?1\b/, 'Back returns to the bill');
  await closeModal();

  // Newest vote in the Votes tab -> its detail.
  const voteId = await page.$eval('#votes-container [data-open="vote"]', el => el.dataset.id).catch(() => null);
  check(Boolean(voteId), 'A vote link exists');
  if (voteId) {
    await openDetail('vote', voteId);
    await waitText('#modal-root', /Yea|Nay|Aye|No/, 'Vote detail opens');
    await closeModal();
  }
  await page.click('footer a[href="#methodology"]');
  await waitText('#view-methodology', /How we count[\s\S]*Party agreement[\s\S]*Campaign finance/, 'Footer link opens How we count');

  // A malformed link mustn't break startup.
  await page.goto(`${url}?bad=1#bill/%`, { waitUntil: 'domcontentloaded' });
  await waitText('#overview-container', /How busy has Congress been/, 'Malformed link still shows the Overview');

  // Shareable links: a pasted URL opens the right view; Back/Forward move through.
  await page.goto(`${url}#issues/healthcare`, { waitUntil: 'domcontentloaded' });
  await waitText('#issue-title', /Healthcare/, 'Link #issues/healthcare opens that topic');
  await page.goto(`${url}#legislators/WY-AL`, { waitUntil: 'domcontentloaded' });
  await waitText('#find-reps-result', /Your representatives: WY-AL[\s\S]*Hageman/, 'Link #legislators/WY-AL shows that district');
  await page.goto(`${url}?fresh=1#bill/${BILL}`, { waitUntil: 'domcontentloaded' });   // query string = a real page load
  await waitText('#modal-root', /H\.?R\.? ?1\b/, 'Link #bill/… opens the bill');
  await closeModal();
  check(!(await page.evaluate(() => location.hash)), 'Closing a linked detail leaves a clean URL');
  await page.click('#nav-votes');
  await waitText('#votes-container', /Roll call/, 'Votes tab (for history test)');
  await page.locator('#votes-container [data-open="vote"]').first().click();
  await waitText('#modal-root', /Yea|Nay|Aye/, 'Vote opens');
  check(/#vote\//.test(page.url()), 'Opening a vote puts it in the URL');
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector('#modal-root [data-close]'), null, { timeout: 10000 }).catch(() => {});
  check(page.url().endsWith('#votes') && !(await page.$('#modal-root [data-close]')), 'Browser Back closes the vote');
  await page.goForward();
  await waitText('#modal-root', /Yea|Nay|Aye/, 'Browser Forward reopens it');
} catch (err) {
  check(false, `test crashed: ${err.message}`);
} finally {
  check(errors.length === 0, `No page or console errors${errors.length ? `:\n    ${errors.join('\n    ')}` : ''}`);
  await browser.close();
  server?.close();
}

console.log(failures.length ? `\n${failures.length} check(s) failed.` : '\nAll checks passed.');
process.exit(failures.length ? 1 : 0);
