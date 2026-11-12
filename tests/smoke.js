// Browser smoke test: loads the site in headless Chromium, opens every tab and one
// member, bill and vote detail, and fails on any uncaught error or console error.
//
//   npm run smoke                                   # serves ./public locally
//   SMOKE_URL=https://congress-watcher.netlify.app npm run smoke   # the live site
//
// Local mode serves public/ only (no Netlify functions), so Campaign Finance and other
// function calls are skipped there and their 404s are ignored. Both modes read the
// real Firestore (~30 reads per run). Needs: npx playwright install chromium

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
  await waitText('#headline-stats', /SENATORS[\s\S]*ROLL-CALL VOTES/i, 'Header cards render');
  await waitText('footer', /Data last updated/, 'Footer shows data freshness');

  await page.click('#nav-issues');
  await waitText('#view-issues', /What the \d+(st|nd|rd|th) Congress has done/, 'Issues tab renders');

  await page.click('#nav-bills');
  await waitText('#bills-container', /Latest action \(\d{4}-\d{2}-\d{2}\)/, 'Bills tab lists bills');
  const dates = await page.$$eval('#bills-container', els => [...els[0].innerText.matchAll(/Latest action \((\d{4}-\d{2}-\d{2})\)/g)].map(m => m[1]));
  check(dates.length > 0 && dates.every((d, i) => !i || dates[i - 1] >= d), `Bills are newest first (${dates.length} checked)`);

  await page.click('#nav-votes');
  await waitText('#votes-container', /Roll call|roll call/, 'Votes tab lists votes');

  await page.click('#nav-members');
  await waitText('#members-container', /\w/, 'Legislators tab lists members');

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
  await closeModal();

  // Newest vote in the Votes tab -> its detail.
  const voteId = await page.$eval('#votes-container [data-open="vote"]', el => el.dataset.id).catch(() => null);
  check(Boolean(voteId), 'A vote link exists');
  if (voteId) {
    await openDetail('vote', voteId);
    await waitText('#modal-root', /Yea|Nay|Aye|No/, 'Vote detail opens');
    await closeModal();
  }
} catch (err) {
  check(false, `test crashed: ${err.message}`);
} finally {
  check(errors.length === 0, `No page or console errors${errors.length ? `:\n    ${errors.join('\n    ')}` : ''}`);
  await browser.close();
  server?.close();
}

console.log(failures.length ? `\n${failures.length} check(s) failed.` : '\nAll checks passed.');
process.exit(failures.length ? 1 : 0);
