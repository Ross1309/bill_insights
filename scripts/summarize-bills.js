// Generate plain-language summaries for stored bills that have an official CRS
// summary but no AI summary yet. Bills without a CRS summary are marked
// crs_summary_available: false (any old title-only summary is removed); sync-bills
// re-checks those over time.
// Resumable: bills already summarized from CRS, or checked within --recheck-days,
// are skipped.
//
//   node scripts/summarize-bills.js                  # dry run: counts candidates
//   node scripts/summarize-bills.js --write          # check CRS + summarize all
//   node scripts/summarize-bills.js --write --limit 200
//   node scripts/summarize-bills.js --write --recheck-days 0   # re-check everyone

import 'dotenv/config';
import { getDb, admin } from '../netlify/lib/firebase.js';
import { summaryUpdate } from '../netlify/lib/bills.js';
import { pool } from '../netlify/lib/pool.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : fallback;
};
const WRITE = args.includes('--write');
const LIMIT = opt('limit', Infinity);
const RECHECK_MS = opt('recheck-days', 3) * 24 * 60 * 60 * 1000;
const { CONGRESS_API_KEY, OPENAI_API_KEY } = process.env;
if (!CONGRESS_API_KEY) throw new Error('CONGRESS_API_KEY is not set.');
if (WRITE && !OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required with --write.');

async function main() {
  const db = getDb();
  const { FieldValue } = admin.firestore;
  const snap = await db.collection('bills').get();

  const candidates = snap.docs.filter(d => {
    const b = d.data();
    if (b.ai_summary?.source === 'crs_summary') return false;
    if (b.crs_summary_available === false && Date.now() - Date.parse(b.crs_checked_at || 0) < RECHECK_MS) return false;
    return b.type && b.number && b.congress;
  });
  const todo = candidates.slice(0, LIMIT);
  console.log(`${WRITE ? 'WRITING' : 'DRY RUN'}: ${snap.size} bills; ${todo.length} to check for a CRS summary`);
  if (!WRITE) {
    console.log('Nothing was written. Re-run with --write.');
    return;
  }

  const keys = { congressKey: CONGRESS_API_KEY, openaiKey: OPENAI_API_KEY, deleteField: () => FieldValue.delete() };
  const counts = { generated: 0, no_crs: 0, error: 0, removed_title_only: 0 };
  await pool(todo, 4, async d => {
    const b = d.data();
    const result = await summaryUpdate(b, b.ai_summary, keys);
    if (Object.keys(result.fields).length) await d.ref.set(result.fields, { merge: true });
    if (result.status === 'no_crs' && b.ai_summary) counts.removed_title_only++;
    counts[result.status] = (counts[result.status] || 0) + 1;
    if (result.status === 'error') console.error(`  ✗ ${d.id}: ${result.error}`);
    const done = counts.generated + counts.no_crs + counts.error;
    if (done % 100 === 0) console.log(`  ${done}/${todo.length} ${JSON.stringify(counts)}`);
  });
  console.log(`\nDone. ${JSON.stringify(counts)}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
