// Rebuild the `stats/overview` doc (Overview tab) from stored votes + directory.
// Reads only small fields of each vote (select), so it's cheap enough to run after
// every ingest: ~1 read per vote, one small write.

import { computeOverview } from './vote-stats.js';

export async function writeOverviewStats(db, admin, { congress } = {}) {
  let query = db.collection('votes');
  if (congress) query = query.where('congress', '==', congress);
  const snap = await query.select('chamber', 'date', 'question', 'result', 'party_breakdown').get();
  const votes = snap.docs.map(d => d.data());
  const missing = votes.filter(v => !v.party_breakdown).length;

  const dir = await db.collection('directory').doc('members').get();
  const members = dir.exists ? dir.data().members || [] : [];

  const overview = computeOverview(votes, members, { congress });
  await db.collection('stats').doc('overview').set({
    ...overview,
    votes_without_party_breakdown: missing,
    generated_at: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { votes: votes.length, missing, weeks: overview.weekly.length, months: overview.monthly.length };
}
