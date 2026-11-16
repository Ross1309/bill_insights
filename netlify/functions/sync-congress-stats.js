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

import { getDb, admin } from '../lib/firebase.js';

const { FieldValue } = admin.firestore;
import { getJson, json } from '../lib/http.js';
import { listBillsUpdatedSince, parseBillId } from '../lib/bills.js';
import { currentCongress, outgoingCongress, today as now } from '../lib/congress.js';
import { recordRun } from '../lib/health.js';
import { pool } from '../lib/pool.js';
import { LAW_TYPES, congressStart, currentCongressDoc, dayIndex, maybePassed, passageDates, probeNewBills } from '../lib/congress-stats.js';

const API = 'https://api.congress.gov/v3';
// Production is much slower than local runs (Congress.gov from Netlify's region: a
// 250-bill listing page can take 10+ s), and a run past Netlify's 30 s limit is killed
// and retried, so: one listing page per run, every request with a deadline that fits
// the time left, passage first (it matters most), new bills only with time to spare.
const RUN_BUDGET_MS = 22_000;
const LIST_PAGE = 250;
const MAX_ACTION_FETCHES = 60;

export default async request => {
  const started = Date.now();
  const timeLeft = () => RUN_BUDGET_MS - (Date.now() - started);
  // A request may use the time left minus a margin for the final writes, at most 8 s, no retries.
  const quick = (url, opts = {}) => {
    const ms = Math.min(8000, timeLeft() - 4000);
    if (ms < 1500) return Promise.reject(Object.assign(new Error('out of time'), { status: 0 }));
    return getJson(url, { ...opts, timeoutMs: ms, retries: 0 });
  };
  const scheduled = !process.env.NETLIFY_DEV && Boolean((await request?.json?.().catch(() => null))?.next_run);
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
      // (new bills are found from number 1 on, up to 150 per type per night).
      if (!state && dayIndex(start, today) < 60) state = { introduced: [], max: {}, bills: {}, last_check: `${start}T00:00:00Z`, seeded_from: 'empty (new Congress)' };
      if (!state) { console.warn(`${congress}th: not seeded yet (run scripts/build-congress-stats.js --write)`); continue; }
      const c = { introduced: 0, checked: 0, passed: 0, candidates: 0 };

      // 1. Bills that may have passed a chamber: one page of Congress.gov's update list
      //    (oldest first) per run. A bill checked on or after its update date is skipped
      //    (state.checked), so a busy date can't hold the window forever.
      try {
        const runStart = new Date().toISOString();
        // A busy date can have more than a page of updates, so the position within the
        // window is kept too (list_offset): the same start time, the next page.
        const offset = state.list_offset || 0;
        const { bills: updated, truncated } = await listBillsUpdatedSince(state.last_check, key, LIST_PAGE, { timeoutMs: Math.min(10_000, timeLeft() - 6000), retries: 0 }, offset);
        state.bills ||= {};
        state.checked ||= {};
        const todo = updated.filter(b => {
          const p = parseBillId(b.id);
          if (!p || p.congress !== congress || !LAW_TYPES.includes(p.type.toLowerCase())) return false;
          const k = b.id.split('-')[0];
          const known = state.bills[k];
          if (known?.h && known?.s) return false;
          if (state.checked[k] && b.updateDate && state.checked[k] >= b.updateDate) return false;
          return maybePassed(b);
        });
        c.candidates = todo.length;
        const done = new Set();
        const newlyPassed = [];
        await pool(todo.slice(0, MAX_ACTION_FETCHES), 8, async b => {
          const p = parseBillId(b.id);
          const actions = (await quick(`${API}/bill/${congress}/${p.type.toLowerCase()}/${p.number}/actions?api_key=${key}&format=json&limit=250`).catch(() => null))?.actions;
          if (!actions) return;   // failed or out of time: stays in the window for next run
          const { house, senate } = passageDates(actions);
          const k = b.id.split('-')[0];
          if (house || senate) {
            if (!state.bills[k]) { c.passed++; newlyPassed.push(b.id); }
            state.bills[k] = { h: house, s: senate };
          }
          state.checked[k] = b.updateDate || today;
          done.add(b.id);
        });
        c.checked = done.size;
        // Newly passed bills join the ingest's enrichment queue (stage, subjects, topics), so
        // the Bills tab's "Moving or passed" lists them the next morning.
        if (newlyPassed.length) await db.collection('sync_state').doc('ingest').set({ pending_enrich: FieldValue.arrayUnion(...newlyPassed) }, { merge: true });
        // Window: some candidates left -> stay on this page; a full page all done -> the
        // next page; the last page done -> start fresh from this run's start.
        const left = todo.filter(b => !done.has(b.id));
        if (left.length) state.list_offset = offset;
        // Overlap pages a little: a bill updated again meanwhile moves to the end and shifts
        // the list; already-checked bills are skipped, so the overlap costs nothing.
        else if (truncated) state.list_offset = offset + LIST_PAGE - 25;
        else { state.last_check = runStart; state.list_offset = 0; }
        // Forget checks older than the window (they can't be listed again).
        const keep = state.last_check.slice(0, 10);
        for (const [k, d] of Object.entries(state.checked)) if (d < keep) delete state.checked[k];
        // Work to do but nothing done is a failure the health check must see.
        if (todo.length && !done.size) failedSteps.push('passage');
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
