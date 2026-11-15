// Per-member voting records: one small `member_votes/{bioguideId}` doc per member
// for the current Congress, so a profile's Voting Record is one ~12 KB read instead
// of downloading 50 full vote docs (~1.5 MB).
//
//   { bioguideId, congress, chamber, name, party, state,
//     totals: { votes, yea, nay, present, not_voting, with_party, party_comparable },
//     recent: [latest RECENT_MAX entries, newest first],
//     monthly: { "2025-03": [roll calls, missed, with party, party-comparable] } (Eastern
//              month of each vote; the member window's trend charts),
//     applied: [voteKey of every vote counted, e.g. "2h323"], updated_at }
//
// Totals cover every vote this Congress. Each vote doc carries `members_applied`
// (false when ingested, true once counted here), so a failed run is picked up by the
// next one and no vote is counted twice in normal operation.

import { updateVoteIndex, writeVoteSummaries } from './vote-index.js';
import { bulkWriter } from './firebase.js';
import { easternDate } from './vote-stats.js';

const POSITION = { yea: 'yea', aye: 'yea', nay: 'nay', no: 'nay', present: 'present', 'not voting': 'not_voting' };
export const RECENT_MAX = 50;

const emptyTotals = () => ({ votes: 0, yea: 0, nay: 0, present: 0, not_voting: 0, with_party: 0, party_comparable: 0 });

// Majority Yea/Nay position of a party on a vote, or null (tie / no votes / Independents).
function partyMajority(vote, party) {
  if (!party || party === 'I') return null;
  const c = vote.party_breakdown?.[party];
  if (!c || c.yea === c.nay) return null;
  return c.yea > c.nay ? 'yea' : 'nay';
}

// One member's entry for one vote.
export function memberEntry(vote, iv) {
  const group = POSITION[(iv.position || '').toLowerCase()] || 'other';
  const majority = group === 'yea' || group === 'nay' ? partyMajority(vote, iv.party) : null;
  return {
    id: vote.id || vote.vote_id,
    date: vote.date || null,
    chamber: vote.chamber || null,
    roll: vote.roll_call_number ?? null,
    question: vote.question || null,
    result: vote.result || null,
    bill_id: vote.bill_id || null,
    legislation: vote.legislation || null,
    position: iv.position || null,
    group,
    party_majority: majority,
  };
}

// [roll calls, missed, with party, party-comparable] for the entry's month.
function addToMonthly(monthly, entry) {
  if (!entry.date) return;
  const m = easternDate(entry.date).slice(0, 7);
  const row = monthly[m] || [0, 0, 0, 0];
  row[0]++;
  if (entry.group === 'not_voting') row[1]++;
  if (entry.party_majority) { row[3]++; if (entry.party_majority === entry.group) row[2]++; }
  monthly[m] = row;
}

function addToTotals(totals, entry) {
  totals.votes++;
  if (totals[entry.group] !== undefined) totals[entry.group]++;
  if (entry.party_majority) {
    totals.party_comparable++;
    if (entry.party_majority === entry.group) totals.with_party++;
  }
}

// Entries per member for a list of full vote docs: Map bioguideId -> { entries, info }.
export function entriesByMember(votes) {
  const out = new Map();
  for (const v of votes) {
    for (const iv of v.individual_votes || []) {
      if (!iv.bioguideId) continue;
      if (!out.has(iv.bioguideId)) out.set(iv.bioguideId, { entries: [], info: {} });
      const m = out.get(iv.bioguideId);
      m.entries.push(memberEntry(v, iv));
      // Latest vote wins for display fields.
      if (!m.info.date || (v.date || '') > m.info.date) {
        m.info = { date: v.date || '', name: iv.name || null, party: iv.party || null, state: iv.state || null, chamber: v.chamber || null };
      }
    }
  }
  return out;
}

// Compact key for a vote within a Congress: "119-2-house-vote-323" -> "2h323".
export function voteKey(id) {
  const m = /^\d+-(\d+)-(house|senate)-vote-(\d+)$/.exec(id || '');
  return m ? `${m[1]}${m[2][0]}${m[3]}` : String(id);
}

// Merge new entries into an existing member doc (or start fresh for a new Congress).
// Idempotent: `applied` lists every vote already counted, so re-applying a vote (a run
// that failed after writing member docs but before flagging the votes) changes nothing.
// Returns null when the doc already belongs to a newer Congress: a late vote of the
// outgoing Congress (applied after January 3) must not reset a member's new record.
export function mergeMemberDoc(existing, bioguideId, congress, { entries, info }) {
  if (existing && Number(existing.congress) > Number(congress)) return null;
  const fresh = !existing || existing.congress !== congress;
  const totals = fresh ? emptyTotals() : { ...emptyTotals(), ...existing.totals };
  const applied = new Set(fresh ? [] : existing.applied || []);
  const monthly = fresh ? {} : Object.fromEntries(Object.entries(existing.monthly || {}).map(([k, v]) => [k, [...v]]));
  const added = [];
  for (const e of entries) {
    const key = voteKey(e.id);
    if (applied.has(key)) continue;
    applied.add(key);
    addToTotals(totals, e);
    addToMonthly(monthly, e);
    added.push(e);
  }
  const seen = new Set(fresh ? [] : (existing.recent || []).map(e => e.id));
  const recent = [...(fresh ? [] : existing.recent || []), ...added.filter(e => !seen.has(e.id))]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, RECENT_MAX);
  return {
    bioguideId,
    congress,
    chamber: info.chamber || existing?.chamber || null,
    name: info.name || existing?.name || null,
    party: info.party || existing?.party || null,
    state: info.state || existing?.state || null,
    totals,
    monthly,
    recent,
    applied: [...applied],
  };
}

// Apply every vote of `congress` not yet counted (members_applied == false) to the
// member docs, the vote index and vote_summaries (vote-index.js), then flag them applied.
// Returns { votes, members }.
export async function applyNewMemberVotes(db, admin, congress) {
  const snap = await db.collection('votes').where('congress', '==', congress).where('members_applied', '==', false).get();
  if (snap.empty) return { votes: 0, members: 0 };
  const votes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const byMember = entriesByMember(votes);

  const ids = [...byMember.keys()];
  const refs = ids.map(id => db.collection('member_votes').doc(id));
  const existing = [];
  for (let i = 0; i < refs.length; i += 300) existing.push(...await db.getAll(...refs.slice(i, i + 300)));

  const now = admin.firestore.FieldValue.serverTimestamp();
  const writer = bulkWriter(db);
  let written = 0;
  ids.forEach((id, i) => {
    const doc = mergeMemberDoc(existing[i].exists ? existing[i].data() : null, id, congress, byMember.get(id));
    if (!doc) return;   // record already moved on to the next Congress
    writer.set(refs[i], { ...doc, updated_at: now });
    written++;
  });
  await writer.close();
  await updateVoteIndex(db, admin, votes);
  await writeVoteSummaries(db, votes);

  const flag = bulkWriter(db);
  for (const d of snap.docs) flag.update(d.ref, { members_applied: true });
  await flag.close();
  return { votes: votes.length, members: written };
}
