// Rebuild precomputed stats docs from stored votes + bills + directory:
//  - stats/overview         (Overview tab)
//  - stats/topic-<slug>     (Issues tab, one per topic in topics.js)
// Votes come from the compact vote index (4 reads per Congress); if a Congress has
// no index yet it falls back to reading small fields of every vote (1 read each).
// Plus 1 read per topic bill and a few small writes.

import { computeOverview } from './vote-stats.js';
import { computeTopicStats } from './topic-stats.js';
import { TOPICS } from './topics.js';
import { MIN_VOTES_TO_DISPLAY } from './congress.js';
import { loadVoteIndex } from './vote-index.js';

const VOTE_FIELDS = ['chamber', 'date', 'question', 'result', 'party_breakdown', 'tallies', 'bill_id', 'roll_call_number', 'session'];
const BILL_FIELDS = ['type', 'number', 'congress', 'title', 'stage', 'passed_house', 'passed_senate', 'failed_house', 'failed_senate',
  'law_number', 'sponsor', 'cosponsors_count', 'subject_count', 'topics', 'topic_focus', 'ai_summary', 'crs_summary_available', 'latestAction'];

// `congress` is the current Congress. Until it has MIN_VOTES_TO_DISPLAY votes (early
// January of odd years), the stats describe the previous Congress instead, and say so.
export async function writeOverviewStats(db, admin, { congress } = {}) {
  const load = async c => (await loadVoteIndex(db, c))
    ?? (await db.collection('votes').where('congress', '==', c).select(...VOTE_FIELDS).get()).docs.map(d => ({ id: d.id, ...d.data() }));
  let votes = await load(congress);
  if (votes.length < MIN_VOTES_TO_DISPLAY) {
    const previous = await load(congress - 1);
    if (previous.length > votes.length) { votes = previous; congress -= 1; }
  }
  const missing = votes.filter(v => !v.party_breakdown).length;

  const dir = await db.collection('directory').doc('members').get();
  const members = dir.exists ? dir.data().members || [] : [];

  const overview = computeOverview(votes, members, { congress });
  const now = admin.firestore.FieldValue.serverTimestamp();
  await db.collection('stats').doc('overview').set({ ...overview, votes_without_party_breakdown: missing, generated_at: now });

  // Issue tracker: bills tagged with any topic or watchlist slug.
  const slugs = Object.entries(TOPICS).flatMap(([slug, t]) => [slug, ...Object.keys(t.watchlists)]);
  const billSnap = await db.collection('bills').where('topics', 'array-contains-any', slugs.slice(0, 30)).select(...BILL_FIELDS).get();
  const bills = billSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(b => Number(b.congress) === congress);

  const votesByBill = new Map();
  for (const v of [...votes].sort((a, b) => (a.date || '').localeCompare(b.date || ''))) {
    if (!v.bill_id) continue;
    if (!votesByBill.has(v.bill_id)) votesByBill.set(v.bill_id, []);
    votesByBill.get(v.bill_id).push(v);
  }

  const topics = {};
  for (const slug of Object.keys(TOPICS)) {
    const stats = computeTopicStats(slug, bills, votesByBill, overview.alignment_totals, { congress });
    await db.collection('stats').doc(`topic-${slug}`).set({ ...stats, congress: congress ?? null, generated_at: now });
    topics[slug] = stats.counts.measures;
  }

  return { congress, votes: votes.length, missing, weeks: overview.weekly.length, months: overview.monthly.length, topicBills: bills.length, topics };
}
