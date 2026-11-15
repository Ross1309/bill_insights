// Missed votes per current member, for member cards, the member window and Home:
// stats/participation (public, one ~12 KB read):
//   { congress, members: { <bioguideId>: [roll calls while serving, missed] },
//     medians: { House|Senate: { missed_share (0-1), members } }, generated_at }
// "Missed" = recorded as Not Voting (Present is not missed). Counts come from member_votes
// (every roll call of the Congress the member was eligible for). Delegates are left out
// of the House median: they may vote only on some amendments, so most roll calls don't
// apply to them, and the page explains that instead of showing a share.
// The record doesn't say why a vote was missed; the page says so.

import { DELEGATE_JURISDICTIONS } from '../../public/states.js';

const DELEGATE = new Set(DELEGATE_JURISDICTIONS.map(([code]) => code));
// Members with fewer roll calls than this (sworn in days ago) aren't part of the median.
const MIN_FOR_MEDIAN = 20;

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// directory: [{ id, chamber, state }] (current members); records: [{ id, congress, totals }]
export function computeParticipation(directory, records, congress) {
  const byId = new Map(records.filter(r => r.congress === congress && r.totals?.votes).map(r => [r.id, r.totals]));
  const members = {};
  const shares = { House: [], Senate: [] };
  for (const m of directory) {
    const t = byId.get(m.id);
    if (!t) continue;
    members[m.id] = [t.votes, t.not_voting || 0];
    if (shares[m.chamber] && !DELEGATE.has(m.state) && t.votes >= MIN_FOR_MEDIAN) shares[m.chamber].push((t.not_voting || 0) / t.votes);
  }
  const medians = Object.fromEntries(Object.entries(shares).map(([ch, s]) => [ch, { missed_share: median(s), members: s.length }]));
  return { congress, members, medians };
}

export async function writeParticipation(db, admin, congress) {
  const dir = (await db.collection('directory').doc('members').get()).data()?.members || [];
  const snap = await db.collection('member_votes').select('congress', 'totals').get();
  const doc = computeParticipation(dir, snap.docs.map(d => ({ id: d.id, ...d.data() })), congress);
  await db.collection('stats').doc('participation').set({ ...doc, generated_at: admin.firestore.FieldValue.serverTimestamp() });
  return { members: Object.keys(doc.members).length, medians: doc.medians };
}
