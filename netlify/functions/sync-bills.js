// Syncs the most recently updated bills from Congress.gov into Firestore.
//
// For each bill it stores real metadata (type, number, policy area, latest action)
// and, for up to MAX_SUMMARIES bills per run, a plain-language AI summary of the
// official CRS summary. Bills without one are marked crs_summary_available: false;
// a few of those are re-checked each run so summaries appear once CRS publishes.

import { getDb, admin } from '../lib/firebase.js';
import { json } from '../lib/http.js';
import {
  billMetadata,
  fetchBillDetail,
  fetchRecentBills,
  makeBillId,
  summaryUpdate,
  checkCrsSummary,
  summaryFromCrs,
  fetchBillEnrichment,
  fetchEnrichedBill,
  listBillsUpdatedSince,
  listLawBillIds,
  parseBillId,
} from '../lib/bills.js';
import { currentCongress } from '../lib/congress.js';
import { writeOverviewStats } from '../lib/overview.js';
import { recordRun } from '../lib/health.js';
import { loadTracked, markTracked } from '../lib/tracked-bills.js';
import { pool } from '../lib/pool.js';

const BILLS_PER_RUN = 10;
const MAX_SUMMARIES = 6; // new AI summaries per run (also capped by the time budget)
const RECHECK_PER_RUN = 25; // waiting bills re-checked for a new CRS summary (~1 s each, 5 at a time)
const RECHECK_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_REFRESH = 60; // tracked bills re-enriched per run (stage, subjects, topics)
const FIRST_RUN_LOOKBACK_MS = 26 * 60 * 60 * 1000;

// Keep the issue tracker current: re-enrich every *tracked* bill (one we've enriched
// before) that Congress.gov changed since the last run, plus any bill on the official
// laws list that we don't have as a law yet. Returns how many were refreshed.
//
// Congress.gov lists changed bills oldest first, with dates only (no time). Up to
// MAX_REFRESH bills are done per run, stopping early if the run's time is nearly up.
// When some are left, the window advances to the start of the last processed bill's
// date, and a bill already enriched on or after its update date is skipped, so every
// run makes progress (a busy day can't stall the queue) and nothing is skipped over.
async function refreshTrackedBills(db, admin, apiKey, skipIds, timeLeft) {
  const stateRef = db.collection('sync_state').doc('bills');
  const runStart = new Date().toISOString();
  const state = (await stateRef.get()).data() || {};
  const since = state.last_refresh || new Date(Date.now() - FIRST_RUN_LOOKBACK_MS).toISOString();

  const [{ bills: updated, truncated }, lawIds] = await Promise.all([
    listBillsUpdatedSince(since, apiKey),
    listLawBillIds(currentCongress().congress, apiKey),
  ]);
  const updateDateOf = new Map(updated.map(b => [b.id, b.updateDate]));
  const lawSet = new Set(lawIds);
  // New laws first (few, and the most important change), then changed bills oldest first.
  let candidates = [...new Set([...lawIds, ...updated.map(b => b.id)])].filter(id => !skipIds.has(id) && parseBillId(id));

  // The tracked-bills doc (1 read) narrows the candidates to bills we follow, so only
  // those are read. Without it, every candidate is read and checked.
  const tracked = await loadTracked(db);
  if (tracked) candidates = candidates.filter(id => lawSet.has(id) ? !tracked.laws.has(id) : tracked.ids.has(id));

  const snaps = [];
  for (let i = 0; i < candidates.length; i += 300) {
    snaps.push(...await db.getAll(...candidates.slice(i, i + 300).map(id => db.collection('bills').doc(id))));
  }
  const todo = snaps.filter(s => {
    const d = s.exists ? s.data() : null;
    if (lawSet.has(s.id)) return !d || d.stage !== 'law';               // newly enacted law
    if (!d?.enriched_at) return false;                                   // not tracked
    const changed = updateDateOf.get(s.id);
    return !changed || d.enriched_at.slice(0, 10) < changed;             // not yet refreshed since that change
  });

  const batch = todo.slice(0, MAX_REFRESH);
  const done = [];
  const errors = [];
  await pool(batch, 6, async snap => {
    if (timeLeft() < 6000) return;                                       // out of time: next run
    try {
      const { congress, type, number } = parseBillId(snap.id);
      const fields = await fetchEnrichedBill(congress, type, number, apiKey);
      const d = snap.exists ? snap.data() : {};
      const neverChecked = !d.ai_summary && d.crs_summary_available === undefined;
      await snap.ref.set({
        ...fields,
        ...(neverChecked ? { crs_summary_available: null } : {}),
        synced_at: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      done.push({ id: snap.id, stage: fields.stage, waiting: d.crs_summary_available === false });
    } catch (err) {
      errors.push(`${snap.id}: ${err.message}`);
    }
  });
  await markTracked(db, admin, done);

  // Advance the window. All handled (and the list wasn't capped): up to this run's start.
  // Otherwise only past the dates fully handled: to the start of the earliest date that
  // still has an unhandled bill (the skip rule above keeps already-done bills of that
  // date from being redone).
  const doneIds = new Set(done.map(b => b.id));
  const pending = todo.filter(s => !doneIds.has(s.id) && updateDateOf.has(s.id)).map(s => updateDateOf.get(s.id)).sort();
  let next = null;
  if (pending.length) next = `${pending[0]}T00:00:00Z`;
  else if (truncated) next = updated.length ? `${updated.at(-1).updateDate}T00:00:00Z` : null;
  else if (done.length === todo.length) next = runStart;
  if (next && next > since) await stateRef.set({ last_refresh: next }, { merge: true });

  console.log(`refresh: ${updated.length}${truncated ? '+' : ''} bills updated since ${since}; ${todo.length} to refresh; refreshed ${done.length}`
    + `${errors.length ? `; ${errors.length} failed` : ''}; window -> ${next && next > since ? next : 'unchanged'}`);
  if (errors.length) console.error(`refresh: ${errors.length} failed (retried next run): ${errors.slice(0, 3).join('; ')}`);
  // Bills that just changed and still lack a CRS summary are the likeliest to have a new
  // one: the backlog step checks them first.
  return { refreshed: done.length, failed: errors.length, waitingIds: done.filter(b => b.waiting).map(b => b.id) };
}

// Scheduled functions get 30 s. Steps check the time left and stop early (what's left
// is picked up next run) instead of being killed mid-write.
const RUN_BUDGET_MS = 28000;
const SUMMARY_NEEDS_MS = 14000;   // one CRS fetch + one OpenAI call (12 s timeout)
const OPENAI_NEEDS_MS = 13000;    // one OpenAI call (CRS text already fetched)

// Bills with no CRS summary yet, longest since their last check first. Needs the
// (crs_summary_available ASC, crs_checked_at ASC) index; without it, falls back to the
// first 100 by id (which can starve the rest, hence the index).
async function waitingBills(db, n) {
  const q = db.collection('bills').where('crs_summary_available', '==', false);
  try {
    return (await q.orderBy('crs_checked_at').limit(n).get()).docs;
  } catch (err) {
    if (err.code !== 9) throw err;   // 9 = FAILED_PRECONDITION: index missing
    console.warn('waitingBills: (crs_summary_available, crs_checked_at) index missing; using unordered fallback');
    return (await q.limit(100).get()).docs
      .sort((a, b) => (a.data().crs_checked_at || '').localeCompare(b.data().crs_checked_at || '')).slice(0, n);
  }
}

export default async request => {
  const started = Date.now();
  const timeLeft = () => RUN_BUDGET_MS - (Date.now() - started);
  // Netlify's scheduler posts { next_run }. `netlify dev` imitates that locally, hence
  // the NETLIFY_DEV check: only real scheduled runs count as scheduled.
  const scheduled = !process.env.NETLIFY_DEV && Boolean((await request?.json?.().catch(() => null))?.next_run);
  const CONGRESS_API_KEY = process.env.CONGRESS_API_KEY;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  if (!CONGRESS_API_KEY || !OPENAI_API_KEY) {
    return json({ error: 'Missing API keys in environment variables.' }, 500);
  }

  try {
    const db = getDb();
    const { FieldValue } = admin.firestore;
    const keys = { congressKey: CONGRESS_API_KEY, openaiKey: OPENAI_API_KEY, deleteField: () => FieldValue.delete() };

    const billsList = (await fetchRecentBills(CONGRESS_API_KEY, BILLS_PER_RUN))
      .filter(item => item.type && item.number && item.congress);

    if (billsList.length === 0) {
      await recordRun(db, 'sync_bills', { failedSteps: ['bill list'], scheduled });
      return json({ success: false, message: 'Congress API returned 0 bills.' });
    }

    // Bill detail calls in parallel (policy area lives only on the detail endpoint).
    const details = await Promise.all(
      billsList.map(item =>
        fetchBillDetail(item.congress, item.type, item.number, CONGRESS_API_KEY).catch(err => {
          console.error(`Detail fetch failed for ${item.type} ${item.number}: ${err.message}`);
          return {};
        })
      )
    );

    let updated = 0;
    let summaryErrors = 0;
    let summarized = 0;

    // Issue-tracker enrichment (subjects, stage, topics) and existing docs, all in
    // parallel; only the summary step below runs one at a time (OpenAI budget).
    const refs = billsList.map(item => db.collection('bills').doc(makeBillId(item.type, item.number, item.congress)));
    const [enrichments, snaps] = await Promise.all([
      Promise.all(billsList.map((item, i) => (details[i]?.number
        ? fetchBillEnrichment(details[i], CONGRESS_API_KEY).catch(err => {
            console.error(`Enrichment failed for ${item.type} ${item.number}: ${err.message}`);
            return {};
          })
        : {}))),
      db.getAll(...refs),
    ]);

    const writes = [];
    for (let i = 0; i < billsList.length; i++) {
      const meta = billMetadata(details[i], billsList[i]);
      const existing = snaps[i].exists ? snaps[i].data() : {};
      const update = { ...meta, ...enrichments[i], synced_at: FieldValue.serverTimestamp() };

      // Same re-check rule as the backlog: a bill with no CRS summary is asked again
      // at most every 3 days.
      const checkedRecently = existing.crs_summary_available === false
        && Date.now() - Date.parse(existing.crs_checked_at || 0) < RECHECK_AFTER_MS;
      if (summarized < MAX_SUMMARIES && !checkedRecently && timeLeft() > SUMMARY_NEEDS_MS) {
        const result = await summaryUpdate(meta, existing.ai_summary || null, keys);
        if (result.status === 'error') summaryErrors++;
        Object.assign(update, result.fields);
        if (result.generated) summarized++;
      }
      writes.push(refs[i].set(update, { merge: true }));
      updated++;
    }
    await Promise.all(writes);
    await markTracked(db, admin, refs.map((r, i) => ({ id: r.id, stage: enrichments[i]?.enriched_at ? enrichments[i].stage : null }))
      .filter((b, i) => enrichments[i]?.enriched_at));

    // Issue tracker freshness: tracked bills that changed + newly enacted laws.
    const failedSteps = [];
    let refreshed = 0;
    let changedWaiting = [];
    try {
      const r = await refreshTrackedBills(db, admin, CONGRESS_API_KEY,
        new Set(billsList.map(item => makeBillId(item.type, item.number, item.congress))), timeLeft);
      refreshed = r.refreshed;
      changedWaiting = r.waitingIds;
      if (r.failed) failedSteps.push('refresh');
    } catch (err) {
      failedSteps.push('refresh');
      console.error('Tracked-bill refresh failed:', err);
    }

    // Backlog: bills still waiting for a CRS summary (~1,000). The CRS checks are cheap
    // and run in parallel; only bills that now have a summary need OpenAI, one at a time
    // within the time budget (those left over stay first in line for the next run).
    // Order: tracked bills that just changed (likeliest to have a new summary), never-
    // checked bills, then the longest since their last check (each at most every 3 days).
    let rechecked = 0;
    {
      const recent = new Set(billsList.map(item => makeBillId(item.type, item.number, item.congress)));
      const byLastCheck = (a, b) => (a.data().crs_checked_at || '').localeCompare(b.data().crs_checked_at || '');
      const changed = changedWaiting.length ? (await db.getAll(...changedWaiting.map(id => db.collection('bills').doc(id)))).filter(d => d.exists) : [];
      const neverChecked = (await db.collection('bills').where('crs_summary_available', '==', null).limit(RECHECK_PER_RUN).get()).docs.sort(byLastCheck);
      const stale = (await waitingBills(db, RECHECK_PER_RUN * 2))
        .filter(d => Date.now() - Date.parse(d.data().crs_checked_at || 0) > RECHECK_AFTER_MS);
      const seen = new Set();
      const waiting = [...changed, ...neverChecked, ...stale]
        .filter(d => !recent.has(d.id) && !seen.has(d.id) && seen.add(d.id))
        .slice(0, RECHECK_PER_RUN);

      // A failed check still gets crs_checked_at, so it moves to the back of the queue.
      const failed = d => { summaryErrors++; return d.ref.set({ crs_checked_at: new Date().toISOString(), crs_check_errors: FieldValue.increment(1) }, { merge: true }); };
      const ready = [];
      await pool(waiting, 5, async d => {
        if (timeLeft() < 8000) return;
        let crs;
        try {
          crs = await checkCrsSummary(d.data(), CONGRESS_API_KEY);
        } catch {
          return failed(d);
        }
        rechecked++;
        if (crs) ready.push({ d, crs });
        else await d.ref.set((await summaryFromCrs(d.data(), null, d.data().ai_summary, keys)).fields, { merge: true });
      });
      for (const { d, crs } of ready) {
        if (summarized >= MAX_SUMMARIES || timeLeft() < OPENAI_NEEDS_MS) break;
        const result = await summaryFromCrs(d.data(), crs, d.data().ai_summary, keys);
        if (result.status === 'error') { await failed(d); continue; }
        await d.ref.set(result.fields, { merge: true });
        summarized++;
      }
      if (ready.length) console.log(`backlog: ${ready.length} waiting bills now have a CRS summary; summarized ${summarized}`);
    }

    // Rebuild Overview + Issues stats so today's stage changes show up today.
    // Every summary attempt failing (e.g. a revoked OpenAI key, a CRS outage) must show in
    // the health check, or summaries would quietly stop.
    if (summaryErrors && !summarized) failedSteps.push('summaries');

    let statsNote = '';
    if (refreshed) {
      try {
        const stats = await writeOverviewStats(db, admin, { congress: currentCongress().congress });
        statsNote = ` Stats rebuilt (${stats.congress}th).`;
      } catch (err) {
        console.error('Stats rebuild failed:', err);
        failedSteps.push('stats');
      }
    }
    await recordRun(db, 'sync_bills', { failedSteps, counts: { bills: updated, refreshed, summarized }, scheduled });

    return json({
      success: true,
      message: `Synced ${updated} bills; refreshed ${refreshed} tracked bills; re-checked ${rechecked} waiting bills; generated ${summarized} new summaries.${statsNote}`,
      bills_found_in_api: billsList.length,
    });
  } catch (err) {
    console.error('Fatal sync error:', err);
    try { await recordRun(getDb(), 'sync_bills', { failedSteps: ['run'], scheduled }); } catch { /* no Firestore */ }
    return json({ error: err.message }, 500);
  }
};
