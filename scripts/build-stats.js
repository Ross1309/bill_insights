// Rebuild stats/overview (the Overview tab's data). ingest-votes.js does this after
// every run; use this script after imports or definition changes.
//
//   node scripts/build-stats.js                 # rebuild stats/overview
//   node scripts/build-stats.js --backfill      # first add party_breakdown to vote
//                                               # docs that lack it (reads full docs)

import 'dotenv/config';
import { getDb, admin } from '../netlify/lib/firebase.js';
import { partyBreakdown } from '../netlify/lib/vote-stats.js';
import { writeOverviewStats } from '../netlify/lib/overview.js';
import { currentCongress } from '../netlify/lib/congress.js';

const BACKFILL = process.argv.includes('--backfill');

async function main() {
  const db = getDb();
  const { congress } = currentCongress();

  if (BACKFILL) {
    const snap = await db.collection('votes').get();
    const writer = db.bulkWriter();
    let added = 0;
    for (const d of snap.docs) {
      const v = d.data();
      if (v.party_breakdown) continue;
      writer.update(d.ref, { party_breakdown: partyBreakdown(v.individual_votes) });
      added++;
    }
    await writer.close();
    console.log(`party_breakdown added to ${added} of ${snap.size} votes`);
  }

  const result = await writeOverviewStats(db, admin, { congress });
  console.log(`stats rebuilt (current: ${congress}th; displayed: ${result.congress}th): ${JSON.stringify(result)}`);
  if (result.missing) console.warn(`${result.missing} votes lack party_breakdown; run with --backfill.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
