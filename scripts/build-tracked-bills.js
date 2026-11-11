// Rebuild sync_state/tracked (the issue tracker's list of enriched bills and stored
// laws; see netlify/lib/tracked-bills.js) from the bills collection.
//
//   node scripts/build-tracked-bills.js --write
//
// Reads ~1 small field set per bill (~2,500 reads). Needed once; after that every
// enrichment keeps the doc current.

import 'dotenv/config';
import { getDb, admin } from '../netlify/lib/firebase.js';
import { rebuildTracked } from '../netlify/lib/tracked-bills.js';

if (!process.argv.includes('--write')) {
  console.log('DRY RUN: would rebuild sync_state/tracked from every bill. Re-run with --write.');
} else {
  rebuildTracked(getDb(), admin)
    .then(r => console.log(`Done. ${r.bills} bills; ${r.tracked} tracked, ${r.laws} laws.`))
    .catch(err => { console.error(err); process.exit(1); });
}
