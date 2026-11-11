// Syncs the most recently updated bills from Congress.gov into Firestore.
// (Name kept for compatibility with existing scheduling/URLs; it syncs bills.)
//
// For each bill it stores real metadata (type, number, policy area, latest action)
// and, for up to MAX_SUMMARIES bills per run, a plain-language AI summary based on
// the official CRS summary when one exists.

import { getDb, admin } from '../lib/firebase.js';
import {
  FABRICATED_FIELDS,
  billMetadata,
  fetchBillDetail,
  fetchLatestCrsSummary,
  fetchRecentBills,
  generateSummary,
  makeBillId,
  needsSummary,
} from '../lib/bills.js';

const BILLS_PER_RUN = 10;
const MAX_SUMMARIES = 3; // keeps each run inside Netlify's function timeout

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
      const billRef = db.collection('bills').doc(makeBillId(item.type, item.number, item.congress));
      const snap = await billRef.get();
      const existingSummary = snap.exists ? snap.data().ai_summary : null;

      const update = { ...meta, synced_at: FieldValue.serverTimestamp() };
      for (const field of FABRICATED_FIELDS) update[field] = FieldValue.delete();

      if (summarized < MAX_SUMMARIES && existingSummary?.source !== 'crs_summary') {
        const crsSummary = await fetchLatestCrsSummary(meta.congress, meta.type, meta.number, CONGRESS_API_KEY)
          .catch(() => null);

        if (needsSummary(existingSummary, Boolean(crsSummary))) {
          const summary = await generateSummary({ title: meta.title, crsSummary }, OPENAI_API_KEY);
          if (summary) {
            update.ai_summary = summary;
            summarized++;
          }
        }
      }

      await billRef.set(update, { merge: true });
      updated++;
    }

    return json({
      success: true,
      message: `Synced ${updated} bills; generated ${summarized} new summaries.`,
      bills_found_in_api: billsList.length,
    });
  } catch (err) {
    console.error('Fatal sync error:', err);
    return json({ error: err.message }, 500);
  }
};
