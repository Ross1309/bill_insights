// Backfill the most recently updated bills into `bills` (metadata only: no AI
// summaries, which sync-bills.js adds for new bills, up to 3 per run).
// Resumable: bills already stored with the same update_date are skipped.
//
//   node scripts/import-bills.js                   # dry run: counts what's missing
//   node scripts/import-bills.js --write           # latest 2,000 bills
//   node scripts/import-bills.js --write --limit 5000
//
// One Congress.gov detail request per new/changed bill (policy area lives only on
// the detail endpoint and drives the category filter).

import 'dotenv/config';
import { getDb, admin, bulkWriter } from '../netlify/lib/firebase.js';
import { billMetadata, fetchBillDetail, makeBillId } from '../netlify/lib/bills.js';
import { pool } from '../netlify/lib/pool.js';

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const i = args.indexOf('--limit');
const LIMIT = i >= 0 ? Number(args[i + 1]) : 2000;
const { CONGRESS_API_KEY } = process.env;
if (!CONGRESS_API_KEY) throw new Error('CONGRESS_API_KEY is not set.');

const API = 'https://api.congress.gov/v3';

async function listRecentBills(limit) {
  const out = [];
  for (let offset = 0; out.length < limit; offset += 250) {
    const res = await fetch(`${API}/bill?api_key=${CONGRESS_API_KEY}&format=json&limit=250&offset=${offset}&sort=updateDate+desc`);
    if (!res.ok) throw new Error(`Congress API ${res.status} listing bills at offset ${offset}`);
    const items = (await res.json()).bills || [];
    out.push(...items.filter(b => b.type && b.number && b.congress));
    if (items.length < 250) break;
  }
  return out.slice(0, limit);
}

async function main() {
  const db = getDb();
  const { FieldValue } = admin.firestore;

  const stored = new Map((await db.collection('bills').select('update_date').get()).docs
    .map(d => [d.id, d.data().update_date || null]));
  const recent = await listRecentBills(LIMIT);
  const todo = recent.filter(b => stored.get(makeBillId(b.type, b.number, b.congress)) !== b.updateDate);

  console.log(`${WRITE ? 'WRITING' : 'DRY RUN'}: ${recent.length} most recently updated bills; ${stored.size} stored; ${todo.length} new or changed`);
  if (!WRITE) {
    console.log('Nothing was written. Re-run with --write.');
    return;
  }

  const writer = bulkWriter(db);
  const counts = { written: 0, failed: 0 };
  await pool(todo, 5, async item => {
    try {
      const detail = await fetchBillDetail(item.congress, item.type, item.number, CONGRESS_API_KEY);
      const meta = billMetadata(detail, item);
      // merge: never touches an existing ai_summary
      writer.set(db.collection('bills').doc(meta.bill_id), { ...meta, synced_at: FieldValue.serverTimestamp() }, { merge: true });
      counts.written++;
    } catch (err) {
      console.error(`  ✗ ${item.type} ${item.number}: ${err.message}`);
      counts.failed++;
    }
    const done = counts.written + counts.failed;
    if (done % 100 === 0) console.log(`  ${done}/${todo.length}`);
  });
  await writer.close();
  console.log(`\nDone. ${JSON.stringify(counts)}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
