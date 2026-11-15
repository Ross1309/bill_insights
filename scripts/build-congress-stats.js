// Build stats/congress-<n> ("This Congress so far" series) for one Congress.
//
//   node scripts/build-congress-stats.js --congress 118 [--write]   a finished Congress
//   node scripts/build-congress-stats.js [--write]                  the current one: also
//                                         seeds sync_state/congress-<n> for the nightly upkeep
//
// Bills (introduced, first House/Senate passage, law): GovInfo's BILLSTATUS bulk files, one
// zip per bill type (H.R. ~35 MB), cached in the OS temp folder. GovInfo lags (the current
// Congress's files were two weeks old in Nov 2026), so for the current Congress, bills
// introduced after its newest file are read from Congress.gov, and the upkeep's update
// window starts the day before that file (sync-congress-stats then catches up).
// Votes: a finished Congress's roll calls from Congress.gov (House) and senate.gov, with
// party totals from each vote's record (House Clerk XML / senate.gov XML; ~2,000 requests);
// the current Congress's from vote_index. Without --write: prints the totals, writes nothing.

import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { getDb, admin } from '../netlify/lib/firebase.js';
import { getJson, getText } from '../netlify/lib/http.js';
import { currentCongress } from '../netlify/lib/congress.js';
import { pool } from '../netlify/lib/pool.js';
import { easternDate } from '../netlify/lib/vote-stats.js';
import { parseVote } from '../netlify/lib/senate-votes.js';
import { LAW_TYPES, buildCongressDoc, congressStart, currentCongressDoc, dayIndex, houseClerkBreakdown, parseBillStatus, passageDates, probeNewBills, splitOf } from '../netlify/lib/congress-stats.js';

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const WRITE = process.argv.includes('--write');
const CURRENT = currentCongress().congress;
const CONGRESS = Number(arg('congress') || CURRENT);
const FINAL = CONGRESS < CURRENT;
const KEY = process.env.CONGRESS_API_KEY;
const API = 'https://api.congress.gov/v3';
const CACHE = join(tmpdir(), 'cw-billstatus', String(CONGRESS));
const today = new Date().toISOString().slice(0, 10);

// --- Bills from GovInfo BILLSTATUS -----------------------------------------------------
async function billStatus(type) {
  const dir = join(CACHE, type);
  if (!existsSync(dir) || !readdirSync(dir).length) {
    mkdirSync(dir, { recursive: true });
    const zip = join(CACHE, `${type}.zip`);
    const url = `https://www.govinfo.gov/bulkdata/BILLSTATUS/${CONGRESS}/${type}/BILLSTATUS-${CONGRESS}-${type}.zip`;
    console.log(`downloading ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(zip));
    execFileSync('unzip', ['-q', '-o', zip, '-d', dir]);
  }
  const files = readdirSync(dir).filter(f => f.endsWith('.xml'));
  return files.map(f => ({ id: `${type}${/(\d+)\.xml$/.exec(f)[1]}`, number: Number(/(\d+)\.xml$/.exec(f)[1]), ...parseBillStatus(readFileSync(join(dir, f), 'utf8')) }));
}

// GovInfo's newest file for a type (the data's "as of"), from the bulk listing.
async function newestFile(type) {
  const list = await getJson(`https://www.govinfo.gov/bulkdata/json/BILLSTATUS/${CONGRESS}/${type}`, { headers: { Accept: 'application/json' }, timeoutMs: 60000 });
  return (list.files || []).filter(f => f.fileExtension === 'xml').map(f => Date.parse(f.formattedLastModifiedTime)).filter(Number.isFinite).sort((a, b) => b - a)[0] || null;
}

// --- Votes of a finished Congress ------------------------------------------------------------
// Each vote record is fetched once and kept in the cache (re-runs read the disk). House
// Clerk and senate.gov throttle bursts (403/429), so requests are spaced, and a throttled
// one waits and retries a few times before the run gives up.
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function cachedText(url, { gapMs = 0 } = {}) {
  const file = join(CACHE, 'http', createHash('sha1').update(url).digest('hex'));
  if (existsSync(file)) return readFileSync(file, 'utf8');
  mkdirSync(join(CACHE, 'http'), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    if (gapMs) await sleep(gapMs);
    try {
      const text = await getText(url, { timeoutMs: 20000, retries: 1 });
      writeFileSync(file, text);
      return text;
    } catch (err) {
      if (attempt >= 4 || ![403, 429, 503].includes(err.status)) throw err;
      const wait = 15000 * (attempt + 1);
      console.log(`  throttled (${err.status}) on ${url}; waiting ${wait / 1000}s`);
      await sleep(wait);
    }
  }
}

async function finishedVotes() {
  const first = await getJson(`${API}/house-vote/${CONGRESS}?api_key=${KEY}&format=json&limit=250`);
  const pages = [first];
  for (let o = 250; o < (first.pagination?.count || 0); o += 250) pages.push(await getJson(`${API}/house-vote/${CONGRESS}?api_key=${KEY}&format=json&limit=250&offset=${o}`));
  const house = pages.flatMap(p => p.houseRollCallVotes || []).filter(v => v.startDate);
  let done = 0;
  const out = [];
  // The Clerk's server refuses bursts: a few at a time, then the failures one by one. A
  // vote whose party totals can't be read stops the run (it would count as "unclear").
  const houseVote = async v => {
    const xml = await cachedText(v.sourceDataURL, { gapMs: 150 });
    if (!xml.includes('<rollcall-vote')) throw new Error(`not a roll-call record: ${v.sourceDataURL}`);
    // Speaker elections and quorum calls have no Yea/Nay by party: "unclear", correctly.
    const breakdown = houseClerkBreakdown(xml);
    out.push({ date: v.startDate.slice(0, 10), chamber: 'House', split: splitOf(breakdown),
      measure: v.legislationType && v.legislationNumber ? `${v.legislationType}${v.legislationNumber}`.toLowerCase() : null });
    if (++done % 200 === 0) console.log(`  House party totals: ${done}/${house.length}`);
  };
  const failed = [];
  await pool(house, 3, v => houseVote(v).catch(() => failed.push(v)));
  if (failed.length) console.log(`  retrying ${failed.length} House records one at a time`);
  for (const v of failed) { await new Promise(r => setTimeout(r, 500)); await houseVote(v); }
  // Both sessions' vote lists, through the cache (throttled like the records); each must
  // be there, or a whole session would silently be missing.
  const senate = [];
  for (const session of [1, 2]) {
    const xml = await cachedText(`https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_${CONGRESS}_${session}.xml`, { gapMs: 400 });
    const numbers = [...xml.matchAll(/<vote_number>(\d+)<\/vote_number>/g)].map(m => Number(m[1]));
    if (!numbers.length) throw new Error(`no votes in the Senate's session ${session} list`);
    senate.push(...numbers.map(number => ({ congress: CONGRESS, session, number })));
  }
  if (senate.length < 100) throw new Error(`only ${senate.length} Senate votes listed (a session's list missing?)`);
  done = 0;
  await pool(senate, 1, async e => {
    const url = `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${e.congress}${e.session}/vote_${e.congress}_${e.session}_${String(e.number).padStart(5, '0')}.xml`;
    const { doc } = parseVote(await cachedText(url, { gapMs: 400 }), e, new Map());
    out.push({ date: doc.date ? easternDate(doc.date) : null, chamber: 'Senate', split: splitOf(doc.party_breakdown),
      measure: doc.bill_id ? doc.bill_id.split('-')[0] : null });
    if (++done % 200 === 0) console.log(`  Senate votes: ${done}/${senate.length}`);
  });
  const missing = out.filter(v => !v.date).length;
  if (missing) console.warn(`${missing} votes without a date (left out)`);
  return out.filter(v => v.date);
}

// Bills GovInfo doesn't have: numbers missing below its highest (a few exist on
// Congress.gov; the rest are unused numbers) and everything after it.
async function missingBills(type, numbers) {
  const have = new Set(numbers);
  const gaps = []; for (let n = 1; n <= Math.max(0, ...numbers); n++) if (!have.has(n)) gaps.push(n);
  const dates = [], passed = [];
  await pool(gaps, 4, async n => {
    const b = (await getJson(`${API}/bill/${CONGRESS}/${type}/${n}?api_key=${KEY}&format=json`).catch(() => null))?.bill;
    if (!b?.introducedDate) return;
    dates.push(b.introducedDate);
    const actions = (await getJson(`${API}/bill/${CONGRESS}/${type}/${n}/actions?api_key=${KEY}&format=json&limit=250`)).actions || [];
    const p = passageDates(actions);
    if (p.house || p.senate) passed.push({ id: `${type}${n}`, number: n, introduced: b.introducedDate, ...p });
  });
  const after = await probeNewBills(getJson, CONGRESS, type, Math.max(0, ...numbers), KEY);
  return { gapDates: dates, gapPassed: passed, gaps: gaps.length, after };
}

async function main() {
  console.log(`${CONGRESS}th Congress (${FINAL ? 'finished' : 'current'}), starts ${congressStart(CONGRESS)}${WRITE ? '' : ' (dry run: --write to save)'}`);
  const bills = [];
  const max = {};
  for (const t of LAW_TYPES) {
    const list = await billStatus(t);
    bills.push(...list);
    max[t] = Math.max(0, ...list.map(b => b.number));
    console.log(`  ${t}: ${list.length} bills (highest ${max[t]})`);
  }
  const noActions = bills.filter(b => !b.actionCount).length;
  if (noActions) console.warn(`  ${noActions} bills with no actions parsed`);

  const db = getDb();
  if (FINAL) {
    const lawCount = (await getJson(`${API}/law/${CONGRESS}?api_key=${KEY}&format=json&limit=1`)).pagination?.count;
    const lawDates = bills.map(b => b.law).filter(Boolean);
    console.log(`  laws: ${lawDates.length} from BILLSTATUS, ${lawCount} on Congress.gov`);
    const votes = await finishedVotes();
    const lastLaw = lawDates.sort().at(-1);
    const doc = buildCongressDoc({ congress: CONGRESS, asOf: lastLaw > `${1789 + 2 * CONGRESS}-01-03` ? lastLaw : `${1789 + 2 * CONGRESS}-01-03`, final: true,
      introducedDates: bills.map(b => b.introduced), bills: bills.map(b => ({ house: b.house, senate: b.senate })), lawDates, votes });
    report(doc);
    if (WRITE) await db.collection('stats').doc(`congress-${CONGRESS}`).set({ ...doc, generated_at: admin.firestore.FieldValue.serverTimestamp() });
  } else {
    // GovInfo's data date: the update window starts the day before its newest file.
    const newest = Math.min(...(await Promise.all(LAW_TYPES.map(newestFile))).filter(Boolean));
    const lastCheck = new Date(newest - 86400e3).toISOString();
    const start = congressStart(CONGRESS);
    const introduced = new Array(dayIndex(start, today) + 1).fill(0);
    const addIntro = d => { const i = dayIndex(start, d); if (i >= 0 && i < introduced.length) introduced[i]++; };
    bills.forEach(b => b.introduced && addIntro(b.introduced));
    for (const t of LAW_TYPES) {
      const { gapDates, gapPassed, gaps, after } = await missingBills(t, bills.filter(b => b.id.replace(/\d+$/, '') === t).map(b => b.number));
      gapDates.forEach(addIntro);
      bills.push(...gapPassed);
      after.dates.forEach(([, d]) => addIntro(d));
      console.log(`  ${t}: ${gapDates.length} of ${gaps} missing numbers exist on Congress.gov; ${after.dates.length} introduced after GovInfo's data (highest now ${after.max})`);
      max[t] = after.max;
    }
    const passed = {};
    for (const b of bills) if (b.house || b.senate) passed[b.id] = { h: b.house || null, s: b.senate || null };
    const state = { introduced, max, bills: passed, last_check: lastCheck, seeded_from: 'govinfo BILLSTATUS', updated_at: new Date().toISOString() };
    console.log(`  ${Object.keys(passed).length} bills passed a chamber per GovInfo; update window from ${lastCheck} (GovInfo's newest file)`);
    const doc = await currentCongressDoc(db, CONGRESS, state, today);
    report(doc);
    if (WRITE) {
      await db.collection('sync_state').doc(`congress-${CONGRESS}`).set(state);
      await db.collection('stats').doc(`congress-${CONGRESS}`).set({ ...doc, generated_at: admin.firestore.FieldValue.serverTimestamp() });
    }
  }
  console.log(WRITE ? 'written.' : 'dry run: nothing written.');
}

function report(doc) {
  const t = doc.totals;
  console.log(`  totals: introduced ${t.introduced}, passed a chamber ${t.passed_one}, both ${t.passed_both}, laws ${t.laws}, ` +
    `floor-voted ${t.floor_voted}, votes House ${t.votes.House} / Senate ${t.votes.Senate}, ` +
    `split House ${t.split.House.opposed}/${t.split.House.opposed + t.split.House.same}, Senate ${t.split.Senate.opposed}/${t.split.Senate.opposed + t.split.Senate.same}; ` +
    `${doc.days} days, ~${Math.round(JSON.stringify(doc).length / 1024)} KB`);
}

main().catch(err => { console.error(err); process.exitCode = 1; });
