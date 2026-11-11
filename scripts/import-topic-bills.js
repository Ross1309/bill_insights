// Issue tracker backfill: store + enrich (CRS subjects, stage, sponsor, topic tags)
// every bill that became law this congress and every bill that got a recorded vote.
// Resumable: bills already enriched are skipped unless --force.
//
//   node scripts/import-topic-bills.js            # dry run
//   node scripts/import-topic-bills.js --write
//   node scripts/import-topic-bills.js --write --force   # re-enrich everything
//
// 4 Congress.gov requests per bill (detail, subjects, actions + list pages).
// Never touches ai_summary; run scripts/summarize-bills.js --write afterwards.

import 'dotenv/config';
import { getDb, admin } from '../netlify/lib/firebase.js';
import { fetchEnrichedBill, parseBillId } from '../netlify/lib/bills.js';
import { currentCongress } from '../netlify/lib/congress.js';
import { markTracked } from '../netlify/lib/tracked-bills.js';

const WRITE = process.argv.includes('--write');
const FORCE = process.argv.includes('--force');
const { CONGRESS_API_KEY } = process.env;
if (!CONGRESS_API_KEY) throw new Error('CONGRESS_API_KEY is not set.');
const API = 'https://api.congress.gov/v3';

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k]); } }));
}

async function listLaws(congress) {
  const out = [];
  for (let offset = 0; ; offset += 250) {
    const res = await fetch(`${API}/law/${congress}?api_key=${CONGRESS_API_KEY}&format=json&limit=250&offset=${offset}`);
    if (!res.ok) throw new Error(`Congress API ${res.status} listing laws`);
    const items = (await res.json()).bills || [];
    out.push(...items);
    if (items.length < 250) break;
  }
  return out.map(b => `${String(b.type).toLowerCase()}${b.number}-${b.congress}`);
}

async function main() {
  const db = getDb();
  const { congress } = currentCongress();
  const lawIds = await listLaws(congress);
  const votedIds = (await db.collection('votes').select('bill_id').get()).docs.map(d => d.data().bill_id).filter(Boolean);
  const ids = [...new Set([...lawIds, ...votedIds])].filter(id => parseBillId(id));

  const enriched = new Set((await db.collection('bills').select('enriched_at').get()).docs
    .filter(d => d.data().enriched_at).map(d => d.id));
  const todo = FORCE ? ids : ids.filter(id => !enriched.has(id));
  console.log(`${WRITE ? 'WRITING' : 'DRY RUN'}: ${lawIds.length} laws + ${new Set(votedIds).size} voted bills = ${ids.length}; ${todo.length} to enrich`);
  if (!WRITE) return console.log('Nothing was written. Re-run with --write.');

  const writer = db.bulkWriter();
  const counts = { written: 0, failed: 0 };
  const done = [];
  await pool(todo, 5, async id => {
    const { congress: c, type, number } = parseBillId(id);
    try {
      const fields = await fetchEnrichedBill(c, type, number, CONGRESS_API_KEY);
      writer.set(db.collection('bills').doc(id), { ...fields, synced_at: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      done.push({ id, stage: fields.stage });
      counts.written++;
    } catch (err) {
      console.error(`  ✗ ${id}: ${err.message}`);
      counts.failed++;
    }
    const done = counts.written + counts.failed;
    if (done % 100 === 0) console.log(`  ${done}/${todo.length}`);
  });
  await writer.close();
  for (let i = 0; i < done.length; i += 500) await markTracked(db, admin, done.slice(i, i + 500));
  console.log(`\nDone. ${JSON.stringify(counts)}`);
}

main().catch(err => { console.error(err); process.exit(1); });
