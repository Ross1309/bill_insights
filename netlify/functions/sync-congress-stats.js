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

import { getDb } from '../lib/firebase.js';
import { getJson, json } from '../lib/http.js';
import { listBillsUpdatedSince, parseBillId } from '../lib/bills.js';
import { currentCongress, outgoingCongress, today as now } from '../lib/congress.js';
import { recordRun } from '../lib/health.js';
import { pool } from '../lib/pool.js';
import { LAW_TYPES, congressStart, currentCongressDoc, dayIndex, maybePassed, passageDates, probeNewBills } from '../lib/congress-stats.js';

const API = 'https://api.congress.gov/v3';
const RUN_BUDGET_MS = 26_000;
const MAX_ACTION_FETCHES = 80;

export default async request => {
  const started = Date.now();
  const timeLeft = () => RUN_BUDGET_MS - (Date.now() - started);
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
      const c = { introduced: 0, checked: 0, passed: 0 };

      // 1. Newly introduced bills.
      try {
        state.introduced ||= [];
        for (const type of LAW_TYPES) {
          if (timeLeft() < 12_000) break;
          // Numbers after the highest known bill (gaps allowed); a failed request stops
          // there and is retried next run.
          const { dates, max } = await probeNewBills(getJson, congress, type, state.max?.[type] || 0, key);
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

      // 2. Bills that may have passed a chamber.
      try {
        const runStart = new Date().toISOString();
        const { bills: updated, truncated } = await listBillsUpdatedSince(state.last_check, key);
        state.bills ||= {};
        const todo = updated.filter(b => {
          const p = parseBillId(b.id);
          if (!p || p.congress !== congress || !LAW_TYPES.includes(p.type.toLowerCase())) return false;
          const known = state.bills[b.id.split('-')[0]];
          return !(known?.h && known?.s) && maybePassed(b);
        });
        const batch = todo.slice(0, MAX_ACTION_FETCHES);
        const done = new Set();
        await pool(batch, 8, async b => {
          if (timeLeft() < 6_000) return;
          const p = parseBillId(b.id);
          const actions = (await getJson(`${API}/bill/${congress}/${p.type.toLowerCase()}/${p.number}/actions?api_key=${key}&format=json&limit=250`)).actions || [];
          const { house, senate } = passageDates(actions);
          const k = b.id.split('-')[0];
          if (house || senate) {
            if (!state.bills[k]) c.passed++;
            state.bills[k] = { h: house, s: senate };
          }
          done.add(b.id);
        });
        c.checked = done.size;
        // Window: past everything if all were checked; otherwise to the oldest unchecked
        // bill's date (a re-check of a bill done today is harmless).
        const left = todo.filter(b => !done.has(b.id));
        state.last_check = left.length ? `${left.map(b => b.updateDate).filter(Boolean).sort()[0]}T00:00:00Z`
          : truncated ? `${updated.at(-1)?.updateDate || today}T00:00:00Z` : runStart;
      } catch (err) {
        console.error('passage:', err.message);
        failedSteps.push('passage');
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
      console.log(`${congress}th: ${c.introduced} new bills, ${c.checked} checked for passage (${c.passed} newly passed a chamber); window -> ${state.last_check}`);
    }
    await recordRun(db, 'congress_stats', { failedSteps, counts, scheduled });
    return json({ ok: !failedSteps.length, failedSteps, counts });
  } catch (err) {
    console.error('Fatal:', err);
    await recordRun(db, 'congress_stats', { failedSteps: ['run'], scheduled });
    return json({ error: err.message }, 500);
  }
};
