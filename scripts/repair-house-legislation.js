// Link stored House votes that have no measure to the bill/resolution named in the
// House Clerk's vote record (see legislationFromClerk in netlify/lib/house-votes.js).
// Congress.gov leaves amendment votes unlinked and fills in new votes late; votes stored
// before the ingest learned the Clerk fallback (2026-11-12) need this once.
//
//   node scripts/repair-house-legislation.js            # dry run: what would change
//   node scripts/repair-house-legislation.js --write
//
// Afterwards, rebuild what's derived from votes:
//   node scripts/build-member-votes.js --write   # vote_summaries, vote_index, member_votes
//   node scripts/import-topic-bills.js --write   # store + enrich newly linked bills
//   node scripts/build-stats.js                  # overview + Issues pages

import 'dotenv/config';
import { getDb } from '../netlify/lib/firebase.js';
import { fetchClerkLegislation } from '../netlify/lib/house-votes.js';

const WRITE = process.argv.includes('--write');

async function main() {
  const db = getDb();
  const snap = await db.collection('votes').where('chamber', '==', 'House').where('legislation', '==', null).get();
  console.log(`${WRITE ? 'WRITING' : 'DRY RUN'}: ${snap.size} House votes without a measure`);
  const linked = [];
  let none = 0, failed = 0;
  for (const d of snap.docs) {
    const v = d.data();
    try {
      const found = await fetchClerkLegislation(v.source_url, v.congress);
      if (!found) { none++; continue; }
      linked.push([d, found]);
      console.log(`  ${d.id}  ${v.question}  ->  ${found.legislation}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${d.id}: ${err.message}`);
    }
  }
  console.log(`\n${linked.length} can be linked, ${none} have no measure (quorum calls, adjournment...), ${failed} failed.`);
  if (!WRITE) return console.log('Nothing was written. Re-run with --write.');

  const writer = db.bulkWriter();
  for (const [d, found] of linked) writer.update(d.ref, { ...found, legislation_source: 'House Clerk' });
  await writer.close();
  console.log(`Updated ${linked.length} votes. Now run the rebuild steps listed at the top of this script.`);
}

main().catch(err => { console.error(err); process.exit(1); });
