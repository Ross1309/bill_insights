// Rebuild precomputed stats docs from stored votes + bills + directory:
//  - stats/overview         (Overview tab; includes `this_week` for the digest card)
//  - stats/topic-<slug>     (Issues tab, one per topic in topics.js)
//  - stats/week-<Monday>    (weekly digest, digest.js) + stats/weeks (their list)
// Votes come from the compact vote index (4 reads per Congress); if a Congress has
// no index yet it falls back to reading small fields of every vote (1 read each).
// Plus 1 read per topic bill and a few small writes.

import { computeOverview } from './vote-stats.js';
import { computeTopicStats } from './topic-stats.js';
import { TOPICS } from './topics.js';
import { MIN_VOTES_TO_DISPLAY } from './congress.js';
import { loadVoteIndex } from './vote-index.js';
import { computeWeeks, weekSummary, thisWeek, isActiveWeek } from './digest.js';
import { easternDate, weekStart, addDays } from './vote-stats.js';

// Nightly rebuilds recompute only the weeks that can still change (new votes, new laws).
const RECENT_WEEKS = 3;

const VOTE_FIELDS = ['chamber', 'date', 'question', 'result', 'party_breakdown', 'tallies', 'bill_id', 'roll_call_number', 'session', 'legislation', 'document_title'];
const BILL_FIELDS = ['type', 'number', 'congress', 'title', 'stage', 'passed_house', 'passed_senate', 'failed_house', 'failed_senate',
  'law_number', 'sponsor', 'cosponsors_count', 'subject_count', 'topics', 'topic_focus', 'ai_summary', 'crs_summary_available', 'latestAction'];

// `congress` is the current Congress. Until it has MIN_VOTES_TO_DISPLAY votes (early
// January of odd years), the stats describe the previous Congress instead, and say so.
export async function writeOverviewStats(db, admin, { congress, allWeeks = false } = {}) {
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
  // Header card totals (all Congresses), so the page needn't run count queries per visit.
  const [billCount, voteCount] = await Promise.all(['bills', 'votes'].map(c => db.collection(c).count().get().then(s => s.data().count)));
  overview.headline.bills = billCount;
  overview.headline.votes = voteCount;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const digest = await writeDigest(db, now, votes, congress, allWeeks);
  await db.collection('stats').doc('overview').set({ ...overview, this_week: digest.thisWeek, votes_without_party_breakdown: missing, generated_at: now });

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

  return { congress, votes: votes.length, missing, weeks: overview.weekly.length, months: overview.monthly.length, topicBills: bills.length, topics, digestWeeks: digest.written };
}

// Weekly digest. `allWeeks`: recompute every week of the Congress (scripts); otherwise
// only the last RECENT_WEEKS (nightly), merged into the existing stats/weeks list.
// Reads: the Congress's laws (~140, small fields) + titles of the bills voted on in
// the recomputed weeks. Returns { written, thisWeek }.
async function writeDigest(db, now, votes, congress, allWeeks) {
  const today = weekStart(easternDate(new Date().toISOString()));
  const onlyWeeks = allWeeks ? null : new Set(Array.from({ length: RECENT_WEEKS }, (_, i) => addDays(today, -7 * i)));
  const inScope = v => v.date && (!onlyWeeks || onlyWeeks.has(weekStart(easternDate(v.date))));

  const lawSnap = await db.collection('bills').where('stage', '==', 'law')
    .select('bill_number', 'title', 'law_number', 'law_date', 'latestAction', 'ai_summary', 'sponsor', 'congress').get();
  const laws = lawSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(b => Number(b.congress) === congress);

  const billIds = [...new Set(votes.filter(inScope).map(v => v.bill_id).filter(Boolean))];
  const billsById = new Map();
  for (let i = 0; i < billIds.length; i += 300) {
    const snaps = await db.getAll(...billIds.slice(i, i + 300).map(id => db.collection('bills').doc(id)), { fieldMask: ['bill_number', 'title'] });
    snaps.forEach(s => { if (s.exists) billsById.set(s.id, s.data()); });
  }

  const weeks = computeWeeks(votes, laws, billsById, { congress, onlyWeeks });
  for (const w of weeks.values()) await db.collection('stats').doc(`week-${w.week}`).set({ ...w, generated_at: now });

  // The list of weeks: recomputed ones replace their old entries.
  const listRef = db.collection('stats').doc('weeks');
  const old = allWeeks ? [] : ((await listRef.get()).data()?.weeks || []).filter(e => !weeks.has(e.week) && e.congress === congress);
  const list = [...old, ...[...weeks.values()].filter(isActiveWeek).map(w => ({ ...weekSummary(w), congress }))]
    .sort((a, b) => a.week.localeCompare(b.week));
  await listRef.set({ congress, weeks: list, generated_at: now });

  // Overview card: the latest week with activity (from this run, or its stored doc).
  const latest = list.at(-1);
  let latestDoc = latest ? weeks.get(latest.week) : null;
  if (latest && !latestDoc) latestDoc = (await db.collection('stats').doc(`week-${latest.week}`).get()).data() || null;
  return { written: weeks.size, thisWeek: thisWeek(latestDoc) };
}
