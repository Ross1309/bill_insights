// Re-read stored Senate votes whose record had more than the old parser kept: amendment
// votes not linked to their bill (<amendment_to_document_number>), and Vice President
// tie-breaks (<tie_breaker>). Updates only bill_id, legislation and tie_breaker on the
// `votes` docs; then rebuild the derived collections.
//
//   node scripts/repair-senate-votes.js [--congress 119]           # dry run: what would change
//   node scripts/repair-senate-votes.js --write
//   node scripts/build-member-votes.js --write                      # summaries, index, records
//   node scripts/import-topic-bills.js --write                      # enrich newly linked bills
//   node scripts/build-stats.js
//
// senate.gov refuses bursts: one request at a time, spaced, each record cached on disk
// (OS temp folder), and a refused request stops the run (re-run later; nothing is lost).

import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, admin, bulkWriter } from '../netlify/lib/firebase.js';
import { getText } from '../netlify/lib/http.js';
import { loadVoteIndex } from '../netlify/lib/vote-index.js';
import { parseVote } from '../netlify/lib/senate-votes.js';
import { currentCongress } from '../netlify/lib/congress.js';

const WRITE = process.argv.includes('--write');
const i = process.argv.indexOf('--congress');
const CONGRESS = i > 0 ? Number(process.argv[i + 1]) : currentCongress().congress;
const CACHE = join(tmpdir(), 'cw-senate-xml', String(CONGRESS));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function record(e) {
  const file = join(CACHE, `${e.session}-${e.number}.xml`);
  if (existsSync(file)) return readFileSync(file, 'utf8');
  await sleep(500);
  const padded = String(e.number).padStart(5, '0');
  const xml = await getText(`https://www.senate.gov/legislative/LIS/roll_call_votes/vote${CONGRESS}${e.session}/vote_${CONGRESS}_${e.session}_${padded}.xml`, { timeoutMs: 20000, retries: 1 });
  if (!xml.includes('<roll_call_vote')) throw new Error(`not a vote record: ${e.session}-${e.number}`);
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, xml);
  return xml;
}

async function main() {
  const db = getDb();
  const index = (await loadVoteIndex(db, CONGRESS)) || [];
  // Nominations (PN …) can't gain a bill: only re-read them for a possible tie-break.
  const todo = index.filter(v => v.chamber === 'Senate' && ((!v.bill_id && !/^PN/i.test(v.legislation || '')) || v.tallies?.yea === v.tallies?.nay));
  console.log(`${CONGRESS}th: ${todo.length} Senate votes to re-read (no linked bill, or a tie)${WRITE ? '' : ' (dry run)'}`);
  const changes = [];
  for (const v of todo) {
    const xml = await record({ session: v.session, number: v.roll_call_number });
    const { doc } = parseVote(xml, { congress: CONGRESS, session: v.session, number: v.roll_call_number }, new Map());
    const update = {};
    if (doc.bill_id && doc.bill_id !== v.bill_id) Object.assign(update, { bill_id: doc.bill_id, legislation: doc.legislation });
    if (doc.tie_breaker) update.tie_breaker = doc.tie_breaker;
    if (Object.keys(update).length) changes.push([v.id, update]);
  }
  const linked = changes.filter(([, u]) => u.bill_id).length, ties = changes.filter(([, u]) => u.tie_breaker).length;
  console.log(`  ${linked} votes get their bill, ${ties} get a tie-breaker`);
  for (const [id, u] of changes.slice(0, 8)) console.log(`  ${id}: ${JSON.stringify(u)}`);
  if (!WRITE) return console.log('Nothing written. Re-run with --write, then the rebuilds listed at the top of this file.');
  const writer = bulkWriter(db);
  for (const [id, u] of changes) writer.update(db.collection('votes').doc(id), { ...u, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  await writer.close();
  console.log(`Updated ${changes.length} votes. Next: build-member-votes.js --write, import-topic-bills.js --write, build-stats.js`);
}

main().catch(err => { console.error(err.message); process.exitCode = 1; });
