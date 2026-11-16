// Fill law_type ("Public Law" / "Private Law") and law_date (the "Became Public/Private
// Law" action) on stored laws enriched before those fields existed. Without law_date,
// the signing date comes from latestAction, which a later action would hide.
//
//   node scripts/backfill-law-fields.js            # dry run
//   node scripts/backfill-law-fields.js --write    # then: node scripts/build-stats.js
//
// 2 Congress.gov requests per law missing a field (detail + actions).

import 'dotenv/config';
import { getDb, bulkWriter } from '../netlify/lib/firebase.js';
import { getJson } from '../netlify/lib/http.js';
import { pool } from '../netlify/lib/pool.js';
import { parseBillId } from '../netlify/lib/bills.js';
import { passageDates } from '../netlify/lib/congress-stats.js';

const WRITE = process.argv.includes('--write');
const KEY = process.env.CONGRESS_API_KEY;
const API = 'https://api.congress.gov/v3';

async function main() {
  const db = getDb();
  const snap = await db.collection('bills').where('stage', '==', 'law').select('law_type', 'law_date', 'law_number').get();
  const todo = snap.docs.filter(d => !d.data().law_type || !d.data().law_date);
  console.log(`${snap.size} laws stored; ${todo.length} missing law_type or law_date${WRITE ? '' : ' (dry run)'}`);
  const updates = [], problems = [];
  await pool(todo, 4, async d => {
    const p = parseBillId(d.id);
    const base = `${API}/bill/${p.congress}/${p.type.toLowerCase()}/${p.number}`;
    try {
      const [detail, acts] = await Promise.all([
        getJson(`${base}?api_key=${KEY}&format=json`),
        getJson(`${base}/actions?api_key=${KEY}&format=json&limit=250`),
      ]);
      const law = detail.bill?.laws?.[0];
      const date = passageDates(acts.actions || []).law;
      if (!law?.type || !date) { problems.push(`${d.id}: type ${law?.type} date ${date}`); return; }
      updates.push([d.ref, { law_type: law.type, law_date: date, ...(law.number && law.number !== d.data().law_number ? { law_number: law.number } : {}) }]);
    } catch (err) { problems.push(`${d.id}: ${err.message}`); }
  });
  const byType = {};
  for (const [, u] of updates) byType[u.law_type] = (byType[u.law_type] || 0) + 1;
  console.log(`  ${updates.length} to update ${JSON.stringify(byType)}; ${problems.length} problems`);
  problems.slice(0, 10).forEach(p => console.log(`  ! ${p}`));
  updates.filter(([, u]) => u.law_type !== 'Public Law').forEach(([ref, u]) => console.log(`  ${ref.id}: ${JSON.stringify(u)}`));
  if (!WRITE) return console.log('Nothing written. Re-run with --write, then node scripts/build-stats.js.');
  const writer = bulkWriter(db);
  for (const [ref, u] of updates) writer.update(ref, u);
  await writer.close();
  console.log(`Updated ${updates.length} laws.`);
}

main().catch(err => { console.error(err); process.exitCode = 1; });
