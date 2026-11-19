// Nightly upkeep of stats/congress-<n> for the current Congress (and the outgoing one for
// a few weeks after January 3): the "This Congress so far" page's daily series.
// Seeded once by scripts/build-congress-stats.js (GovInfo bulk data), then each night:
//   1. Bills introduced since the last run (numbers are assigned in order; each new
//      bill's introduction date from Congress.gov).
//   2. Bills Congress.gov changed since the last run that may have passed a chamber
//      (maybePassed: not just a referral in their own chamber): their actions are read
//      and the first House/Senate passage recorded. Resumable like sync-bills: with
//      more than fit, the window moves only to the oldest bill not yet checked.
//   3. The stats doc rebuilt from that state + vote_index + laws in `bills`.
// Everything stops early near the time budget; the next run carries on.

import { acquireRunLock } from '../lib/run-lock.js';
import { getDb, admin } from '../lib/firebase.js';

const { FieldValue } = admin.firestore;
import { getJson, json } from '../lib/http.js';
import { currentCongress, outgoingCongress, today as now } from '../lib/congress.js';
import { logRunStart, recordRun } from '../lib/health.js';
import { pool } from '../lib/pool.js';
import { LAW_TYPES, congressStart, currentCongressDoc, dayIndex, maybePassed, passageDates, probeNewBills } from '../lib/congress-stats.js';

const API = 'https://api.congress.gov/v3';
// Production is much slower than local runs (Congress.gov from Netlify's region: a
// 250-bill listing page can take 10+ s), and a run past Netlify's 30 s limit is killed
// and retried, so: one listing page per run, every request with a deadline that fits
// the time left, passage first (it matters most), new bills only with time to spare.
const RUN_BUDGET_MS = 25_000;   // Netlify stops functions at 30 s; the final writes take ~2 s
const LIST_PAGE = 250;   // this Congress's bills only (/bill/{congress}), as many pages as time allows
const MAX_ACTION_FETCHES = 60;

async function syncCongressStats(request, started) {
  const timeLeft = () => RUN_BUDGET_MS - (Date.now() - started);
  // A request may use the time left minus a margin for the final writes, at most 8 s, no retries.
  const quick = (url, { maxMs = 8000, ...opts } = {}) => {
    const ms = Math.min(maxMs, timeLeft() - 4000);
    if (ms < 1500) return Promise.reject(Object.assign(new Error('out of time'), { status: 0 }));
    return getJson(url, { ...opts, timeoutMs: ms, retries: 0 });
  };
  const nextRun = (await request?.json?.().catch(() => null))?.next_run;
  const scheduled = !process.env.NETLIFY_DEV && Boolean(nextRun);
  logRunStart('sync-congress-stats', nextRun, request?.headers?.get?.('x-nf-request-id'));
  const key = process.env.CONGRESS_API_KEY;
  const db = getDb();
  const failedSteps = [];
  const counts = {};
  try {
    for (const congress of [currentCongress().congress, outgoingCongress()].filter(Boolean)) {
      const ref = db.collection('sync_state').doc(`congress-${congress}`);
      const today = now().toISOString().slice(0, 10);
      const start = congressStart(congress);
      let state = (await ref.get()).data();
      // A new Congress starts from nothing: its first nights begin the state themselves
      // (new bills are found from number 1 on, up to 40 per type per night).
      if (!state && dayIndex(start, today) < 60) state = { introduced: [], max: {}, bills: {}, last_check: `${start}T00:00:00Z`, seeded_from: 'empty (new Congress)' };
      if (!state) { console.warn(`${congress}th: not seeded yet (run scripts/build-congress-stats.js --write)`); continue; }
      const c = { introduced: 0, checked: 0, passed: 0, candidates: 0 };

      // 1. Bills that may have passed a chamber, from this Congress's update list (oldest
      //    first; dates only, no times). Pages are read while time remains; a bill counts
      //    as checked only if that happened on a LATER day than its update (an update on
      //    the day of a check, e.g. a passage that afternoon, is checked again). A bill
      //    whose actions keep failing is given up after 3 tries (counted). The window moves
      //    only past finished work; while its start date is unchanged, the page position is
      //    kept (with a 50-row overlap: re-updated bills move to the end of the list).
      try {
        const runStart = new Date().toISOString();
        state.bills ||= {};
        state.checked ||= {};
        state.fails ||= {};
        const since = state.last_check;
        let offset = state.list_from === since ? Math.max(0, (state.list_offset || 0) - 50) : 0;
        const candidates = [];
        let listedAll = false, lastListedDate = null;
        // Stop listing once there's a run's worth of candidates, or only checking time is left.
        while (timeLeft() > 16_000 && candidates.length < MAX_ACTION_FETCHES) {
          // Listing pages are slow from Netlify (10+ s seen): they get a longer deadline.
          const page = (await quick(`${API}/bill/${congress}?api_key=${key}&format=json&limit=${LIST_PAGE}&offset=${offset}&sort=updateDate+asc&fromDateTime=${new Date(since).toISOString().replace(/\.\d{3}Z$/, 'Z')}`, { maxMs: 15_000 })).bills || [];
          for (const b of page) {
            const type = String(b.type || '').toLowerCase();
            if (!LAW_TYPES.includes(type) || !b.number) continue;
            const k = `${type}${b.number}`;
            lastListedDate = b.updateDate || lastListedDate;
            const known = state.bills[k];
            if (known?.h && known?.s) continue;
            if (state.checked[k] && b.updateDate && state.checked[k] > b.updateDate) continue;
            if (maybePassed(b)) candidates.push({ id: `${k}-${congress}`, k, updateDate: b.updateDate, type, number: b.number });
          }
          offset += page.length;
          if (page.length < LIST_PAGE) { listedAll = true; break; }
        }
        c.candidates = candidates.length;
        const done = new Set();
        const newlyPassed = [];
        await pool(candidates.slice(0, MAX_ACTION_FETCHES), 8, async b => {
          const actions = (await quick(`${API}/bill/${congress}/${b.type}/${b.number}/actions?api_key=${key}&format=json&limit=250`).catch(() => null))?.actions;
          if (!actions) {
            if (timeLeft() > 3000) {   // a real failure, not just out of time
              state.fails[b.k] = (state.fails[b.k] || 0) + 1;
              if (state.fails[b.k] >= 3) { state.checked[b.k] = today; delete state.fails[b.k]; c.gave_up = (c.gave_up || 0) + 1; done.add(b.id); }
            }
            return;
          }
          const { house, senate } = passageDates(actions);
          if (house || senate) {
            if (!state.bills[b.k]) { c.passed++; newlyPassed.push(b.id); }
            state.bills[b.k] = { h: house, s: senate };
          }
          state.checked[b.k] = today;
          delete state.fails[b.k];
          done.add(b.id);
        });
        c.checked = done.size;
        // Newly passed bills join the ingest's enrichment queue (stage, subjects, topics), so
        // the Bills tab's "Moving or passed" lists them the next morning.
        if (newlyPassed.length) await db.collection('sync_state').doc('ingest').set({ pending_enrich: FieldValue.arrayUnion(...newlyPassed) }, { merge: true });
        // Window: everything listed and checked -> from this run's start. Otherwise from the
        // start of the earliest date still open (an unchecked candidate, or the last listed
        // date when the list wasn't finished), keeping the position if that date is unchanged.
        const open = candidates.filter(b => !done.has(b.id)).map(b => b.updateDate).filter(Boolean);
        if (!listedAll && lastListedDate) open.push(lastListedDate);
        if (!open.length && listedAll) { state.last_check = runStart; state.list_offset = 0; state.list_from = null; }
        else if (open.length) {
          const next = `${open.sort()[0]}T00:00:00Z`;
          state.list_offset = next === since ? offset : 0;
          state.list_from = next;
          state.last_check = next;
        }
        // Forget checks older than the window (they can't be listed again).
        const keep = state.last_check.slice(0, 10);
        for (const [k, d] of Object.entries(state.checked)) if (d < keep) delete state.checked[k];
        // Work waiting but nothing done is a failure the health check must see.
        if (candidates.length && !done.size) failedSteps.push('passage');
      } catch (err) {
        console.error('passage:', err.message);
        failedSteps.push('passage');
      }

      // 2. Newly introduced bills, with the time left.
      try {
        state.introduced ||= [];
        for (const type of LAW_TYPES) {
          if (timeLeft() < 9_000) break;
          // Numbers after the highest known bill (gaps allowed); a failed or timed-out
          // request stops there and is retried next run.
          const { dates, max } = await probeNewBills(quick, congress, type, state.max?.[type] || 0, key, { limit: 40 });
          for (const [, date] of dates) {
            const d = dayIndex(start, date);
            if (d >= 0) { while (state.introduced.length <= d) state.introduced.push(0); state.introduced[d]++; }
            c.introduced++;
          }
          state.max = { ...state.max, [type]: max };
        }
      } catch (err) {
        console.error('introduced:', err.message);
        failedSteps.push('introduced');
      }

      // 3. The stats doc.
      try {
        state.updated_at = new Date().toISOString();
        await ref.set(state);
        const doc = await currentCongressDoc(db, congress, state, today);
        await db.collection('stats').doc(`congress-${congress}`).set({ ...doc, generated_at: new Date().toISOString() });
      } catch (err) {
        console.error('write:', err.message);
        failedSteps.push('write');
      }
      counts[congress] = c;
      console.log(`${congress}th: ${c.introduced} new bills, ${c.checked} of ${c.candidates} checked for passage (${c.passed} newly passed a chamber); window -> ${state.last_check} +${state.list_offset || 0}`);
    }
    await recordRun(db, 'congress_stats', { failedSteps, counts, scheduled });
    return json({ ok: !failedSteps.length, failedSteps, counts });
  } catch (err) {
    console.error('Fatal:', err);
    await recordRun(db, 'congress_stats', { failedSteps: ['run'], scheduled });
    return json({ error: err.message }, 500);
  }
};

// Netlify starts another copy of a scheduled function after ~15 s without an answer: copies
// take turns (run-lock.js), each with the time it has left out of its own 30 s.
export default async request => {
  const started = Date.now();
  const lock = await acquireRunLock(getDb(), 'sync-congress-stats', started + 30_000);
  if (!lock) {
    console.log('sync-congress-stats: an earlier copy is still working and this one has too little time left; stopping');
    return json({ skipped: 'an earlier copy is still working' });
  }
  if (lock.waitedMs) console.log(`sync-congress-stats: waited ${Math.round(lock.waitedMs / 1000)} s for the copy before`);
  try {
    return await syncCongressStats(request, started);
  } finally {
    await lock.release();
  }
};
