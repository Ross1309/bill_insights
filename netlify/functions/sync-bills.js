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
} from '../lib/bills.js';

const BILLS_PER_RUN = 10;
const MAX_SUMMARIES = 3; // keeps each run inside Netlify's function timeout
const RECHECK_PER_RUN = 5; // waiting bills re-checked for a new CRS summary
const RECHECK_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

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

    for (let i = 0; i < billsList.length; i++) {
      const item = billsList[i];
      const meta = billMetadata(details[i], item);
      // Issue tracker: CRS subjects, stage (keeps "became law" current) and topic tags.
      const enrichment = details[i]?.number
        ? await fetchBillEnrichment(details[i], CONGRESS_API_KEY).catch(err => {
            console.error(`Enrichment failed for ${item.type} ${item.number}: ${err.message}`);
            return {};
          })
        : {};
      const billRef = db.collection('bills').doc(makeBillId(item.type, item.number, item.congress));
      const snap = await billRef.get();
      const existingSummary = snap.exists ? snap.data().ai_summary : null;

      const update = { ...meta, ...enrichment, synced_at: FieldValue.serverTimestamp() };
      for (const field of FABRICATED_FIELDS) update[field] = FieldValue.delete();

      if (summarized < MAX_SUMMARIES) {
        const result = await summaryUpdate(meta, existingSummary, keys);
        Object.assign(update, result.fields);
        if (result.generated) summarized++;
      }

      await billRef.set(update, { merge: true });
      updated++;
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

    return json({
      success: true,
      message: `Synced ${updated} bills; re-checked ${rechecked} waiting bills; generated ${summarized} new summaries.`,
      bills_found_in_api: billsList.length,
    });
  } catch (err) {
    console.error('Fatal sync error:', err);
    return json({ error: err.message }, 500);
  }
};
