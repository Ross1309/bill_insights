// One-off cleanup for bill docs written by the old sync script.
//
//   node scripts/backfill-bills.js            # dry run: shows what would change
//   node scripts/backfill-bills.js --write    # apply metadata fixes
//   node scripts/backfill-bills.js --write --summaries
//                                            # also regenerate unlabeled/title-only
//                                            # AI summaries (calls OpenAI)
//
// For every doc in `bills` it:
//   - removes the placeholder fields (outcome, vote_counts, date_voted)
//   - refetches real metadata from Congress.gov (type, number, policy area,
//     category, latest action, congress.gov link)

import 'dotenv/config';
import { getDb, admin } from '../netlify/lib/firebase.js';
import {
  FABRICATED_FIELDS,
  billMetadata,
  fetchBillDetail,
  fetchLatestCrsSummary,
  generateSummary,
  needsSummary,
  parseBillId,
} from '../netlify/lib/bills.js';

const WRITE = process.argv.includes('--write');
const SUMMARIES = process.argv.includes('--summaries');
const { CONGRESS_API_KEY, OPENAI_API_KEY } = process.env;

if (!CONGRESS_API_KEY) throw new Error('CONGRESS_API_KEY is not set.');
if (SUMMARIES && !OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required with --summaries.');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const db = getDb();
  const { FieldValue } = admin.firestore;
  const snapshot = await db.collection('bills').get();

  console.log(`${WRITE ? 'WRITING' : 'DRY RUN'} — ${snapshot.size} bill docs${SUMMARIES ? ', regenerating summaries' : ''}\n`);

  const counts = { updated: 0, skipped: 0, failed: 0, summarized: 0 };

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const ids = parseBillId(doc.id) || parseBillId(data.bill_id);
    if (!ids) {
      console.warn(`  ? ${doc.id}: can't parse bill id, skipping`);
      counts.skipped++;
      continue;
    }

    try {
      const detail = await fetchBillDetail(ids.congress, ids.type, ids.number, CONGRESS_API_KEY);
      const meta = billMetadata(detail, ids);
      const update = { ...meta, synced_at: FieldValue.serverTimestamp() };
      const removed = FABRICATED_FIELDS.filter(f => f in data);
      for (const f of FABRICATED_FIELDS) update[f] = FieldValue.delete();

      let summaryNote = '';
      if (SUMMARIES && data.ai_summary?.source !== 'crs_summary') {
        const crs = await fetchLatestCrsSummary(ids.congress, ids.type, ids.number, CONGRESS_API_KEY).catch(() => null);
        if (needsSummary(data.ai_summary, Boolean(crs))) {
          summaryNote = ` | summary: ${crs ? 'from CRS' : 'title only'}`;
          if (WRITE) {
            const summary = await generateSummary({ title: meta.title, crsSummary: crs }, OPENAI_API_KEY);
            if (summary) { update.ai_summary = summary; counts.summarized++; }
          }
        }
      }

      console.log(
        `  ✓ ${meta.bill_number.padEnd(12)} category: ${data.category ?? '—'} -> ${meta.category}` +
        (removed.length ? ` | removing: ${removed.join(', ')}` : '') +
        summaryNote
      );

      if (WRITE) await doc.ref.set(update, { merge: true });
      counts.updated++;
    } catch (err) {
      console.error(`  ✗ ${doc.id}: ${err.message}`);
      counts.failed++;
    }

    await sleep(250); // stay well under Congress.gov's rate limit
  }

  console.log(`\nDone. ${JSON.stringify(counts)}`);
  if (!WRITE) console.log('Nothing was written. Re-run with --write to apply.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
