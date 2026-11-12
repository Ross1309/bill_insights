// Recompute every enriched bill's topic + watchlist tags (`topics`, `topic_focus`) from
// its stored policy area, CRS subjects and title, using the current netlify/lib/topics.js.
// Run after adding or changing a topic or watchlist; no Congress.gov calls needed.
//
//   node scripts/retag-topics.js            # dry run: what would change
//   node scripts/retag-topics.js --write
//   node scripts/build-stats.js             # then rebuild the Issues pages

import 'dotenv/config';
import { getDb, bulkWriter } from '../netlify/lib/firebase.js';
import { topicTags } from '../netlify/lib/topics.js';

const WRITE = process.argv.includes('--write');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sortedKeys = o => Object.fromEntries(Object.entries(o || {}).sort(([a], [b]) => a.localeCompare(b)));

async function main() {
  const db = getDb();
  const snap = await db.collection('bills').select('enriched_at', 'policy_area', 'subjects', 'title', 'topics', 'topic_focus').get();
  const changes = [];
  const added = new Map();
  for (const d of snap.docs) {
    const b = d.data();
    if (!b.enriched_at) continue;
    const tags = topicTags({ policy_area: b.policy_area, subjects: b.subjects || [], title: b.title || '' });
    if (same([...(b.topics || [])].sort(), [...tags.topics].sort()) && same(sortedKeys(b.topic_focus), sortedKeys(tags.topic_focus))) continue;
    changes.push([d.ref, tags]);
    for (const t of tags.topics) if (!(b.topics || []).includes(t)) added.set(t, (added.get(t) || 0) + 1);
  }
  console.log(`${WRITE ? 'WRITING' : 'DRY RUN'}: ${changes.length} of ${snap.size} bills get new tags`);
  for (const [t, n] of [...added].sort()) console.log(`  +${n} ${t}`);
  if (!WRITE) return console.log('Nothing was written. Re-run with --write, then node scripts/build-stats.js.');

  const writer = bulkWriter(db);
  for (const [ref, tags] of changes) writer.update(ref, tags);
  await writer.close();
  console.log(`Updated ${changes.length} bills. Now run: node scripts/build-stats.js`);
}

main().catch(err => { console.error(err); process.exit(1); });
