// Syncs the most recently updated bills from Congress.gov into Firestore.
//
// For each bill it stores real metadata (type, number, policy area, latest action)
// and, for up to MAX_SUMMARIES bills per run, a plain-language AI summary of the
// official CRS summary. Bills without one are marked crs_summary_available: false;
// a few of those are re-checked each run so summaries appear once CRS publishes.

import { getDb, admin } from '../lib/firebase.js';
import {
  FABRICATED_FIELDS,
  billMetadata,
  fetchBillDetail,
  fetchRecentBills,
  makeBillId,
  summaryUpdate,
  fetchBillEnrichment,
  fetchEnrichedBill,
  listBillIdsUpdatedSince,
  listLawBillIds,
  parseBillId,
} from '../lib/bills.js';
import { currentCongress } from '../lib/congress.js';
import { writeOverviewStats } from '../lib/overview.js';

const BILLS_PER_RUN = 10;
const MAX_SUMMARIES = 3; // keeps each run inside Netlify's function timeout
const RECHECK_PER_RUN = 5; // waiting bills re-checked for a new CRS summary
const RECHECK_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_REFRESH = 60; // tracked bills re-enriched per run (stage, subjects, topics)
const FIRST_RUN_LOOKBACK_MS = 26 * 60 * 60 * 1000;

async function pool(items, concurrency, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]);
    }
  }));
}

// Keep the issue tracker current: re-enrich every *tracked* bill (one we've enriched
// before) that Congress.gov changed since the last run, plus any bill on the official
// laws list that we don't have as a law yet. Returns how many were refreshed.
async function refreshTrackedBills(db, admin, apiKey, skipIds) {
  const stateRef = db.collection('sync_state').doc('bills');
  const runStart = new Date().toISOString();
  const state = (await stateRef.get()).data() || {};
  const since = state.last_refresh || new Date(Date.now() - FIRST_RUN_LOOKBACK_MS).toISOString();

  const [updatedIds, lawIds] = await Promise.all([
    listBillIdsUpdatedSince(since, apiKey),
    listLawBillIds(currentCongress().congress, apiKey),
  ]);
  const lawSet = new Set(lawIds);
  const candidates = [...new Set([...updatedIds, ...lawIds])].filter(id => !skipIds.has(id) && parseBillId(id));

  const snaps = [];
  for (let i = 0; i < candidates.length; i += 300) {
    snaps.push(...await db.getAll(...candidates.slice(i, i + 300).map(id => db.collection('bills').doc(id))));
  }
  const todo = snaps.filter(s => {
    const d = s.exists ? s.data() : null;
    if (lawSet.has(s.id)) return !d || d.stage !== 'law';   // newly enacted law
    return d?.enriched_at;                                    // tracked bill that changed
  });

  const batch = todo.slice(0, MAX_REFRESH);
  if (todo.length > batch.length) console.warn(`refresh: ${todo.length} bills to refresh; doing ${batch.length}, rest next run`);
  await pool(batch, 6, async snap => {
    const { congress, type, number } = parseBillId(snap.id);
    const fields = await fetchEnrichedBill(congress, type, number, apiKey);
    const d = snap.exists ? snap.data() : {};
    const neverChecked = !d.ai_summary && d.crs_summary_available === undefined;
    await snap.ref.set({
      ...fields,
      ...(neverChecked ? { crs_summary_available: null } : {}),
      synced_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  // Only advance the window when everything in it was handled.
  if (todo.length <= batch.length) await stateRef.set({ last_refresh: runStart }, { merge: true });
  console.log(`refresh: ${updatedIds.length} bills updated since ${since}; refreshed ${batch.length}`);
  return batch.length;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async () => {
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
      for (const field of FABRICATED_FIELDS) update[field] = FieldValue.delete();

      // Same re-check rule as the backlog: a bill with no CRS summary is asked again
      // at most every 3 days.
      const checkedRecently = existing.crs_summary_available === false
        && Date.now() - Date.parse(existing.crs_checked_at || 0) < RECHECK_AFTER_MS;
      if (summarized < MAX_SUMMARIES && !checkedRecently) {
        const result = await summaryUpdate(meta, existing.ai_summary || null, keys);
        Object.assign(update, result.fields);
        if (result.generated) summarized++;
      }
      writes.push(refs[i].set(update, { merge: true }));
      updated++;
    }
    await Promise.all(writes);

    // Issue tracker freshness: tracked bills that changed + newly enacted laws.
    let refreshed = 0;
    try {
      refreshed = await refreshTrackedBills(db, admin, CONGRESS_API_KEY,
        new Set(billsList.map(item => makeBillId(item.type, item.number, item.congress))));
    } catch (err) {
      console.error('Tracked-bill refresh failed:', err);
    }

    // Backlog: re-check a few bills still waiting for a CRS summary.
    let rechecked = 0;
    if (summarized < MAX_SUMMARIES) {
      const recent = new Set(billsList.map(item => makeBillId(item.type, item.number, item.congress)));
      // Never-checked bills first (enriched by ingest-votes, marked null), then bills
      // that had no CRS summary last time (re-checked at most every 3 days).
      const neverChecked = (await db.collection('bills').where('crs_summary_available', '==', null).limit(RECHECK_PER_RUN).get()).docs
        .filter(d => !recent.has(d.id));
      const stale = (await db.collection('bills').where('crs_summary_available', '==', false).limit(100).get()).docs
        .filter(d => !recent.has(d.id) && Date.now() - Date.parse(d.data().crs_checked_at || 0) > RECHECK_AFTER_MS)
        .sort((a, b) => (a.data().crs_checked_at || '').localeCompare(b.data().crs_checked_at || ''));
      const waiting = [...neverChecked, ...stale].slice(0, RECHECK_PER_RUN);
      for (const d of waiting) {
        if (summarized >= MAX_SUMMARIES) break;
        const result = await summaryUpdate(d.data(), d.data().ai_summary, keys);
        if (Object.keys(result.fields).length) await d.ref.set(result.fields, { merge: true });
        if (result.generated) summarized++;
        rechecked++;
      }
    }

    // Rebuild Overview + Issues stats so today's stage changes show up today.
    let statsNote = '';
    if (refreshed) {
      try {
        const stats = await writeOverviewStats(db, admin, { congress: currentCongress().congress });
        statsNote = ` Stats rebuilt (${stats.congress}th).`;
      } catch (err) {
        console.error('Stats rebuild failed:', err);
      }
    }

    return json({
      success: true,
      message: `Synced ${updated} bills; refreshed ${refreshed} tracked bills; re-checked ${rechecked} waiting bills; generated ${summarized} new summaries.${statsNote}`,
      bills_found_in_api: billsList.length,
    });
  } catch (err) {
    console.error('Fatal sync error:', err);
    return json({ error: err.message }, 500);
  }
};
