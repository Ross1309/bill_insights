// Fill short_title (a bill's common name, e.g. "One Big Beautiful Bill Act" for H.R. 1) on
// stored bills that don't have the field yet. null = checked, no short title. New and
// re-enriched bills get it from fetchBillEnrichment.
//
//   node scripts/backfill-short-titles.js [--limit N]           # dry run
//   node scripts/backfill-short-titles.js --write               # then:
//   node scripts/build-member-votes.js --write                  # vote summaries' bill_title
//   node scripts/build-stats.js                                 # stats, digest, topics, search index
//
// One Congress.gov request per bill (titles), 4 at a time; resumable (skips bills that have it).
// --recheck: also re-check bills that already have a short title (after changing the rule).
// Bills before the 93rd Congress have none on Congress.gov (its API 500s for them).

import 'dotenv/config';
import { getDb, bulkWriter } from '../netlify/lib/firebase.js';
import { getJson } from '../netlify/lib/http.js';
import { pool } from '../netlify/lib/pool.js';
import { parseBillId, pickShortTitle } from '../netlify/lib/bills.js';

const WRITE = process.argv.includes('--write');
const li = process.argv.indexOf('--limit');
const LIMIT = li > 0 ? Number(process.argv[li + 1]) : Infinity;
const KEY = process.env.CONGRESS_API_KEY;

async function main() {
  const db = getDb();
  const snap = await db.collection('bills').select('title', 'short_title').get();
  const RECHECK = process.argv.includes('--recheck');
  const todo = snap.docs.filter(d => d.data().short_title === undefined || (RECHECK && d.data().short_title)).slice(0, LIMIT);
  console.log(`${snap.size} bills stored; ${todo.length} to check${WRITE ? '' : ' (dry run)'}`);
  const found = [], none = [], failed = [];
  await pool(todo, 4, async d => {
    const p = parseBillId(d.id);
    if (!p) return failed.push(d.id);
    if (p.congress < 93) return none.push([d.id, null, d.data().title]);
    try {
      const r = await getJson(`https://api.congress.gov/v3/bill/${p.congress}/${p.type.toLowerCase()}/${p.number}/titles?api_key=${KEY}&format=json&limit=250`, { timeoutMs: 20000, retries: 2 });
      const short = pickShortTitle(r.titles, d.data().title);
      (short ? found : none).push([d.id, short, d.data().title]);
    } catch (err) {
      failed.push(`${d.id}: ${err.message}`);
    }
  });
  console.log(`  ${found.length} get a short title, ${none.length} have none, ${failed.length} failed`);
  for (const [id, short, title] of found.slice(0, 10)) console.log(`  ${id}: ${short}  <-  ${String(title).slice(0, 70)}`);
  failed.slice(0, 5).forEach(f => console.log(`  failed ${f}`));
  if (!WRITE) return console.log('Nothing written. Re-run with --write, then the rebuilds listed at the top of this file.');
  const writer = bulkWriter(db);
  for (const [id, short] of [...found, ...none]) writer.update(db.collection('bills').doc(id), { short_title: short });
  await writer.close();
  console.log(`Updated ${found.length + none.length} bills.${failed.length ? ' Re-run for the failed ones.' : ''}`);
}

main().catch(err => { console.error(err.message); process.exitCode = 1; });
