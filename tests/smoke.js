// Browser smoke test: loads the site in headless Chromium, opens every tab and one
// member, bill and vote detail, and fails on any uncaught error or console error.
//
//   npm run smoke                                   # serves ./public locally
//   (APPCHECK_DEBUG_TOKEN in .env / the environment: a registered App Check debug token)
//   SMOKE_URL=https://congress-watcher.netlify.app npm run smoke   # the live site
//
// Local mode serves public/ only (no Netlify functions), so Campaign Finance and other
// function calls are skipped there and their 404s are ignored. Both modes read the
// real Firestore (~30 reads per run). Needs: npx playwright install chromium

/* global document, location, self */ // used inside page.evaluate / waitForFunction callbacks (run in the browser)
import 'dotenv/config';
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
// In GitHub Actions each failure is also an annotation: readable on the run page and via
// the public check-runs API without signing in (step logs need a login).
const annotate = what => { if (process.env.GITHUB_ACTIONS) console.log(`::error title=Smoke test::${String(what).replace(/\r?\n/g, '%0A').slice(0, 2000)}`); };
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) { failures.push(what); annotate(what); } };

const server = LIVE ? null : await serve('public');
const url = LIVE || `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const page = await browser.newPage();
// App Check (public/data.js): a registered debug token lets this headless browser pass
// without reCAPTCHA. From .env locally, a GitHub secret in CI. Without one, requests go
// unverified (fine until App Check is enforced for Firestore).
if (process.env.APPCHECK_DEBUG_TOKEN) {
  await page.addInitScript(token => { self.FIREBASE_APPCHECK_DEBUG_TOKEN = token; }, process.env.APPCHECK_DEBUG_TOKEN);
}
const errors = [];
// Google's reCAPTCHA script (App Check) is third-party: it throws on a malformed URL
// itself and complains about storage access in headless browsers. Only its errors are
// ignored; anything from our code still fails the run.
// Also Google's own report-only security-policy notices about framing google.com (reCAPTCHA's
// frame): informational, nothing is blocked (seen intermittently in CI, 2026-11).
const fromRecaptcha = text => /\/recaptcha\/|requestStorageAccess/.test(text)
  || (/report-only Content Security Policy/.test(text) && /https:\/\/www\.google\.com\//.test(text));
page.on('pageerror', err => { if (!fromRecaptcha(err.stack || '')) errors.push(`uncaught: ${err.message}`); });
page.on('console', msg => {
  if (msg.type() !== 'error') return;
  const text = msg.text();
  if (fromRecaptcha(text) || fromRecaptcha(msg.location()?.url || '')) return;
  // App Check debug token not registered (yet): requests still work while App Check isn't
  // enforced. Once enforced, Firestore reads fail instead, which the checks catch.
  if (/exchangeDebugToken/.test(msg.location()?.url || '')) return;
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
// Tabs carry a short name for phones and the full one (both in the text), so match by inclusion.
const modalTab = name => page.locator('#modal-root [role="tab"]', { hasText: name }).first().click();
const closeModal = () => page.keyboard.press('Escape');

try {
  console.log(`Smoke test: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // Home: three ways in, key votes in plain language, recent laws, numbers.
  await waitText('#home-hero', /Who represents me\?[\s\S]*(This|Latest) week in Congress[\s\S]*Issues/i, 'Home: the three starting cards');
  await waitText('#home-keyvotes', /Key votes[\s\S]*Details: how each party voted/, 'Home: short key vote cards');
  await page.click('#home-keyvotes details summary');
  await waitText('#home-keyvotes', /Democrats[\s\S]*\d+ Yea · \d+ Nay/, 'Home: a key vote opens to the party split');
  await waitText('#home-laws', /Recently became law[\s\S]*Signed/, 'Home: recent laws');
  await waitText('#home-numbers', /by the numbers[\s\S]*recorded votes/, 'Home: by the numbers');
  await waitText('footer', /Data last updated/, 'Footer shows data freshness');
  await page.click('#home-numbers a[href="#congress"]');
  await waitText('#congress-container', /Congress (so far|in full)[\s\S]*From bill to law/, 'This Congress page renders');
  await waitText('#congress-container', /Is this normal\?[\s\S]*(at this point)/, 'This Congress: compared with past Congresses');
  await waitText('#overview-container', /How busy has Congress been/, 'This Congress: the charts below');
  check(/#congress$/.test(page.url()), 'URL is #congress');
  await page.click('#nav-overview');

  // Header search: a member by name, a bill by number (Enter opens it).
  await page.fill('#site-search-input', 'jayap');
  await waitText('#site-search-results', /Jayapal/, 'Search finds a member');
  await page.fill('#site-search-input', 'HR 2102');
  await waitText('#site-search-results', /H\.R\. 2102/, 'Search finds a bill by number');
  await page.keyboard.press('Enter');
  await waitText('#modal-root', /H\.?R\.? ?2102/, 'Enter opens the bill');
  await closeModal();

  // Weekly digest: from the home card to the full week page, and stepping back a week.
  await page.click('#home-hero a[href^="#week/"]');
  await waitText('#week-container', /What Congress did[\s\S]*recorded votes/, 'Week page opens from the card');
  const firstWeek = await page.evaluate(() => location.hash);
  const earlier = await page.$('#week-container a[href^="#week/"]');
  if (earlier) {
    await earlier.click();
    await page.waitForFunction(h => location.hash !== h, firstWeek, { timeout: 10000 }).catch(() => {});
    await waitText('#week-container', /What Congress did/, 'Earlier week loads');
  }
  await page.click('#nav-overview');

  await page.click('#nav-issues');
  await waitText('#view-issues', /What the \d+(st|nd|rd|th) Congress has done/, 'Issues tab renders');
  await waitText('#view-issues', /Month by month[\s\S]*busiest month/, 'Issues: month by month');
  await page.click('#issue-topics [data-topic="defense"]');
  await waitText('#view-issues', /Defense[\s\S]*Troops & military families[\s\S]*Intelligence & surveillance/, 'Issues: Defense topic');
  await page.click('#issue-topics [data-topic="immigration"]');
  await waitText('#view-issues', /Immigration[\s\S]*Border security[\s\S]*Asylum & refugees/, 'Issues: Immigration topic');
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
  await waitText('#bills-container', /Latest action, [A-Z][a-z]{2} \d{1,2}, \d{4}:/, 'Bills tab lists bills');
  await waitText('#bills-container', /Became law|Passed in the|Agreed to|Sent to the President|Passed both|Vetoed|Failed in the/, 'Bills tab: Moving or passed with stage trackers');
  check(await page.$eval('#bill-scope-filters [data-scope="moving"]', el => el.getAttribute('aria-pressed') === 'true'), 'Moving or passed is the default');
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dates = (await page.$$eval('#bills-container', els => [...els[0].innerText.matchAll(/Latest action, ([A-Z][a-z]{2}) (\d{1,2}), (\d{4}):/g)].map(m => [m[1], m[2], m[3]])))
    .map(([mon, d, y]) => `${y}-${String(MON.indexOf(mon) + 1).padStart(2, '0')}-${d.padStart(2, '0')}`);
  check(dates.length > 0 && dates.every((d, i) => !i || dates[i - 1] >= d), `Bills are newest first (${dates.length} checked)`);
  await page.fill('#search-input', 'HR 1');
  await waitText('#bills-container', /H\.?R\.? ?1\b/, 'Bill-number search finds H.R. 1');
  // Word search reaches every stored bill (stats/bill-titles), not just the loaded pages.
  await page.fill('#search-input', 'border');
  await waitText('#bills-index', /In all [\d,]+ stored bills: [1-9]\d* with “border”[\s\S]*Immigration on Issues/, 'Bill word search covers all stored bills');
  await page.fill('#search-input', '');
  await page.fill('#search-input', '');

  await page.click('#nav-votes');
  await waitText('#votes-container', /(passed|adopted|confirmed|rejected|failed)[\s\S]*roll call/i, 'Votes tab: key votes with plain headlines');
  check(await page.$eval('#view-votes [data-scope="key"]', el => el.getAttribute('aria-pressed') === 'true' || el.classList.contains('active') || /bg-cta/.test(el.className)), 'Key votes is the default');
  await page.click('#view-votes [data-scope="all"]');
  await waitText('#vote-scope-note', /Every recorded vote/, 'All recorded votes filter');
  // Tap-to-explain: an official term opens its plain explanation; Escape closes it.
  const term = page.locator('#votes-container [data-term]').first();
  await term.waitFor({ timeout: 20000 }).catch(() => {});
  if (await term.count()) {
    await term.scrollIntoViewIfNeeded();
    await term.click();
    check(await page.locator('#term-popover').evaluate(e => !e.classList.contains('hidden') && e.textContent.length > 40), `Tapping "${await term.textContent()}" explains it`);
    await page.keyboard.press('Escape');
    check(await page.locator('#term-popover').evaluate(e => e.classList.contains('hidden')), 'Escape closes the explanation');
  } else check(false, 'Votes show tap-to-explain terms');
  await page.click('#view-votes [data-scope="key"]');
  await page.click('#view-votes [data-chamber="Senate"]');
  await waitText('#votes-container', /Senate roll call/, 'Senate chamber filter');
  const houseShown = await page.$eval('#votes-container', el => /House roll call/i.test(el.innerText));
  check(!houseShown, 'Senate filter hides House votes');
  await page.click('#view-votes [data-chamber=""]');

  await page.click('#nav-members');
  await waitText('#members-container', /\w/, 'Legislators tab lists members');
  await waitText('#members-container', /Missed \d+ of \d+ votes \(\d/, 'Member cards show missed votes');
  await page.selectOption('#state-select', 'TX');
  await waitText('#members-container', /Cornyn/, 'State filter shows Texas members');
  check(page.url().endsWith('#legislators/TX'), `URL follows the state filter (${page.url().split('#')[1]})`);
  if (LIVE) {
    // Home address box: your members, then how they voted on the key votes.
    await page.click('#nav-overview');
    await page.fill('#home-address', '400 Broad St, Seattle, WA 98109');
    await page.click('[data-home-find] button[type=submit]');
    await waitText('#home-hero', /Your members for WA-7[\s\S]*Jayapal/, 'Home: find your members by address');
    await waitText('#home-keyvotes', /Your members \(WA-7\)[\s\S]*(Yea|Nay|Not Voting|None of your members)/, 'Home: how your members voted');
    await waitText('#home-hero', /Call 202-\d{3}-\d{4}/, 'Home: your members have a phone number');
    await openDetail('bill', 'hr2102-119');
    await waitText('#modal-root', /Your members \(WA-7\) on this bill[\s\S]*Cosponsor[\s\S]*House passed[^\n]*: Yea/, 'Bill window: your members (cosponsor + final vote)');
    await closeModal();
    await openDetail('member', 'J000298');
    await waitText('#modal-root', /Current term ends[\s\S]*Election for this seat[\s\S]*Committees[\s\S]*Committee on the Judiciary/, 'Member window: term, election date, committees');
    await closeModal();
    await page.click('#nav-members');
    await page.fill('#find-reps-address', '400 Broad St, Seattle, WA 98109');
    await page.click('#find-reps button[type=submit]');
    await waitText('#find-reps-result', /Your representatives: WA-7[\s\S]*Jayapal/, 'Find your representatives (address -> WA-7)');
  }

  // Shared links carry the item's own preview (netlify/functions/share.js); live only.
  if (LIVE) {
    const html = await (await fetch(new URL('bill/hr2102-119', url))).text();
    check(/<meta property="og:title" content="H\.R\. 2102: [^"]+"/.test(html) && /og:image/.test(html), 'Shared bill link has its own preview');
    // Social sites add query strings (fbclid=…): the link must still load (no redirect loop).
    const q = await fetch(new URL('bill/hr2102-119?fbclid=smoke', url), { redirect: 'manual' });
    check(q.status === 200, `Shared link with a query string loads (got ${q.status})`);
    const sitemap = await (await fetch(new URL('sitemap.xml', url))).text();
    check((sitemap.match(/<url>/g) || []).length > 1000, 'Sitemap lists bills and members');
  }
  await openDetail('member', MEMBER);
  await waitText('#modal-root', /Jayapal/, 'Member detail opens');
  await waitText('#modal-root', /Votes this Congress[\s\S]*Missed \d+ of \d+ recorded votes[\s\S]*Typical House member/, 'Member window shows missed votes with context');
  await modalTab('Voting Record');
  await waitText('#modal-root', /In the \d+(st|nd|rd|th) Congress, voted on \d+ of \d+/, 'Member Voting Record renders');
  await waitText('#modal-root', /Month by month[\s\S]*Votes missed[\s\S]*Voted with their party/, 'Member Voting Record: month by month');
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
  await page.click('#nav-bills');
  await page.check('#bills-hide-ceremonial');
  await waitText('#bills-container', /Latest action/, 'Bills tab still lists bills with ceremonial ones hidden');
  check(!(await page.$('#bills-container [data-term="ceremonial"]')), 'Hide ceremonial removes them from the list');
  check(await page.$eval('#votes-hide-ceremonial', el => el.checked), 'Hide ceremonial is one setting for Bills and Votes');
  await page.uncheck('#bills-hide-ceremonial');
  await waitText('#bills-container', /Latest action/, 'Bills tab lists bills again');
  await page.click('footer a[href="#methodology"]');
  await waitText('#view-methodology', /How we count[\s\S]*Party agreement[\s\S]*Campaign finance/, 'Footer link opens How we count');
  await page.click('footer a[href="#how-laws-are-made"]');
  await waitText('#view-process', /How a bill becomes law[\s\S]*Committee[\s\S]*The President[\s\S]*Not everything Congress votes on is a bill/, 'Footer link opens How a bill becomes law');

  if (LIVE) {
    // A law passed without roll calls: the Votes tab says how it passed (not "not synced").
    await page.goto(`${url}?v=1#bill/hr2481-119`, { waitUntil: 'domcontentloaded' });
    await waitText('#modal-root', /H\.?R\.? ?2481/, 'Bill passed by voice vote opens');
    await modalTab('Votes');
    await waitText('#modal-root', /No recorded vote[\s\S]*voice vote[\s\S]*Unanimous Consent/, 'Votes tab explains a voice-vote / unanimous-consent law');
    await closeModal();
  }

  // A malformed link mustn't break startup.
  await page.goto(`${url}?bad=1#bill/%`, { waitUntil: 'domcontentloaded' });
  await waitText('#home-hero', /Who represents me\?/i, 'Malformed link still shows the home page');

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
  await waitText('#votes-container', /roll call/i, 'Votes tab (for history test)');
  await page.locator('#votes-container [data-open="vote"]').first().click();
  await waitText('#modal-root', /Yea|Nay|Aye/, 'Vote opens');
  check(/#vote\//.test(page.url()), 'Opening a vote puts it in the URL');
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector('#modal-root [data-close]'), null, { timeout: 10000 }).catch(() => {});
  check(page.url().endsWith('#votes') && !(await page.$('#modal-root [data-close]')), 'Browser Back closes the vote');
  await page.goForward();
  await waitText('#modal-root', /Yea|Nay|Aye/, 'Browser Forward reopens it');
  await closeModal();

  // Follow: a followed bill shows up on Home ("Since you last looked"); unfollowing clears it.
  await page.goto(`${url}?follow=1#bill/${BILL}`, { waitUntil: 'domcontentloaded' });
  await waitText('#modal-root', /H\.?R\.? ?1\b/, 'Bill opens (follow test)');
  await page.click(`#modal-root [data-follow="bills"][data-id="${BILL}"]`);
  await page.waitForSelector(`#modal-root [data-follow="bills"][aria-pressed="true"]`, { timeout: 10000 }).catch(() => {});
  check(Boolean(await page.$(`#modal-root [data-follow="bills"][aria-pressed="true"]`)), 'Follow button on a bill turns to Following');
  await closeModal();
  await waitText('#home-follows', /Since you last looked[\s\S]*(Nothing new for the 1 thing you follow|changed)/, 'Home shows the followed items');
  await page.click('#home-follows summary');
  await waitText('#home-follows', /Everything you follow \(1\)[\s\S]*H\.R\. 1\b/, 'Home lists the followed bill');
  await page.click(`#home-follows [data-follow="bills"][data-id="${BILL}"]`);
  await waitText('#home-follows', /Tip: use Follow/, 'Unfollowing from Home empties the list');
} catch (err) {
  check(false, `test crashed: ${err.message}`);
} finally {
  check(errors.length === 0, `No page or console errors${errors.length ? `:\n    ${errors.join('\n    ')}` : ''}`);
  await browser.close();
  server?.close();
}

console.log(failures.length ? `\n${failures.length} check(s) failed.` : '\nAll checks passed.');
process.exit(failures.length ? 1 : 0);
