// Rebuild every member_votes doc, the vote index (vote_index docs) and vote_summaries for a Congress
// from scratch (full vote docs), and mark those votes members_applied: true. The nightly ingest keeps them current after
// this; run it again only to repair or after changing the doc format.
//
//   node scripts/build-member-votes.js              # dry run: counts only
//   node scripts/build-member-votes.js --write
//   node scripts/build-member-votes.js --write --congress 118
//
// Reads every vote doc in full (~30 KB each, ~50 MB per Congress): fine locally,
// too heavy for a scheduled function.

import 'dotenv/config';
import { getDb, admin } from '../netlify/lib/firebase.js';
import { entriesByMember, mergeMemberDoc } from '../netlify/lib/member-votes.js';
import { currentCongress } from '../netlify/lib/congress.js';
import { updateVoteIndex, writeVoteSummaries } from '../netlify/lib/vote-index.js';

const WRITE = process.argv.includes('--write');
const i = process.argv.indexOf('--congress');
const CONGRESS = i >= 0 ? Number(process.argv[i + 1]) : currentCongress().congress;

async function main() {
  const db = getDb();
  const snap = await db.collection('votes').where('congress', '==', CONGRESS).get();
  const votes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const byMember = entriesByMember(votes);
  console.log(`${WRITE ? 'WRITING' : 'DRY RUN'}: ${votes.length} votes in the ${CONGRESS}th Congress -> ${byMember.size} members`);
  if (!WRITE) return console.log('Nothing was written. Re-run with --write.');

  const now = admin.firestore.FieldValue.serverTimestamp();
  const writer = db.bulkWriter();
  let bytes = 0;
  for (const [id, data] of byMember) {
    const doc = mergeMemberDoc(null, id, CONGRESS, data);
    bytes = Math.max(bytes, JSON.stringify(doc).length);
    writer.set(db.collection('member_votes').doc(id), { ...doc, updated_at: now });
  }
  await writer.close();
  const indexDocs = await updateVoteIndex(db, admin, votes, { replace: true });
  await writeVoteSummaries(db, votes);
  const flag = db.bulkWriter();
  for (const d of snap.docs) flag.update(d.ref, { members_applied: true });
  await flag.close();
  console.log(`Done. ${byMember.size} member docs (largest ${(bytes / 1024).toFixed(1)} KB); ${indexDocs} vote index docs; ${votes.length} vote summaries; ${votes.length} votes marked applied.`);
}

main().catch(err => { console.error(err); process.exit(1); });
