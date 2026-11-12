// Per-member voting record logic (no Firestore): entries, party-majority, merging
// into an existing doc, Congress resets, and the latest-50 cap.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entriesByMember, mergeMemberDoc, memberEntry, RECENT_MAX } from '../netlify/lib/member-votes.js';

const vote = (id, date, positions, pb) => ({
  id,
  date,
  chamber: 'House',
  roll_call_number: Number(id.split('-').at(-1)),
  question: 'On Passage',
  result: 'Passed',
  bill_id: 'hr1-119',
  party_breakdown: pb,
  individual_votes: positions,
});

const PB_D_YEA_R_NAY = { D: { yea: 200, nay: 5 }, R: { yea: 3, nay: 210 } };

test('memberEntry: groups positions and party majority', () => {
  const v = vote('119-2-house-vote-1', '2026-01-10T15:00:00Z', [], PB_D_YEA_R_NAY);
  assert.equal(memberEntry(v, { party: 'D', position: 'Yea' }).party_majority, 'yea');
  assert.equal(memberEntry(v, { party: 'R', position: 'Aye' }).group, 'yea');
  assert.equal(memberEntry(v, { party: 'R', position: 'Aye' }).party_majority, 'nay'); // voted against party
  assert.equal(memberEntry(v, { party: 'D', position: 'Not Voting' }).party_majority, null); // only Yea/Nay compared
  assert.equal(memberEntry(v, { party: 'I', position: 'Yea' }).party_majority, null);       // Independents excluded
});

test('entriesByMember + mergeMemberDoc: totals and newest-first recent', () => {
  const votes = [
    vote('119-2-house-vote-1', '2026-01-10T15:00:00Z', [{ bioguideId: 'A1', name: 'A, B', party: 'D', state: 'WA', position: 'Yea' }], PB_D_YEA_R_NAY),
    vote('119-2-house-vote-2', '2026-01-11T15:00:00Z', [{ bioguideId: 'A1', name: 'A, B', party: 'D', state: 'WA', position: 'Nay' }], PB_D_YEA_R_NAY),
    vote('119-2-house-vote-3', '2026-01-12T15:00:00Z', [{ bioguideId: 'A1', name: 'A, B', party: 'D', state: 'WA', position: 'Not Voting' }], PB_D_YEA_R_NAY),
  ];
  const doc = mergeMemberDoc(null, 'A1', 119, entriesByMember(votes).get('A1'));
  assert.deepEqual(doc.totals, { votes: 3, yea: 1, nay: 1, present: 0, not_voting: 1, with_party: 1, party_comparable: 2 });
  assert.deepEqual(doc.recent.map(e => e.id), ['119-2-house-vote-3', '119-2-house-vote-2', '119-2-house-vote-1']);
  assert.equal(doc.state, 'WA');
});

test('mergeMemberDoc: adds to existing totals; new Congress starts fresh', () => {
  const first = mergeMemberDoc(null, 'A1', 119, entriesByMember([
    vote('119-2-house-vote-1', '2026-01-10T15:00:00Z', [{ bioguideId: 'A1', party: 'D', position: 'Yea' }], PB_D_YEA_R_NAY),
  ]).get('A1'));
  const more = entriesByMember([
    vote('119-2-house-vote-2', '2026-01-11T15:00:00Z', [{ bioguideId: 'A1', party: 'D', position: 'Yea' }], PB_D_YEA_R_NAY),
  ]).get('A1');
  assert.equal(mergeMemberDoc(first, 'A1', 119, more).totals.votes, 2);
  const nextCongress = mergeMemberDoc(first, 'A1', 120, more);
  assert.equal(nextCongress.totals.votes, 1);
  assert.equal(nextCongress.congress, 120);
});

test(`mergeMemberDoc: keeps only the latest ${RECENT_MAX}`, () => {
  const votes = Array.from({ length: RECENT_MAX + 10 }, (_, i) =>
    vote(`119-2-house-vote-${i + 1}`, new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), [{ bioguideId: 'A1', party: 'D', position: 'Yea' }], PB_D_YEA_R_NAY));
  const doc = mergeMemberDoc(null, 'A1', 119, entriesByMember(votes).get('A1'));
  assert.equal(doc.recent.length, RECENT_MAX);
  assert.equal(doc.totals.votes, RECENT_MAX + 10);
  assert.equal(doc.recent[0].id, `119-2-house-vote-${RECENT_MAX + 10}`);
});

test('mergeMemberDoc: applying the same votes again changes nothing (retry after a failed run)', () => {
  const votes = [
    vote('119-2-house-vote-1', '2026-01-10T15:00:00Z', [{ bioguideId: 'A1', party: 'D', position: 'Yea' }], PB_D_YEA_R_NAY),
    vote('119-2-house-vote-2', '2026-01-11T15:00:00Z', [{ bioguideId: 'A1', party: 'D', position: 'Nay' }], PB_D_YEA_R_NAY),
  ];
  const once = mergeMemberDoc(null, 'A1', 119, entriesByMember(votes).get('A1'));
  const twice = mergeMemberDoc(once, 'A1', 119, entriesByMember(votes).get('A1'));
  assert.deepEqual(twice.totals, once.totals);
  assert.equal(twice.recent.length, 2);
  assert.deepEqual(twice.applied.sort(), ['2h1', '2h2']);
  // A new vote alongside an old one: only the new one counts.
  const more = [votes[1], vote('119-2-house-vote-3', '2026-01-12T15:00:00Z', [{ bioguideId: 'A1', party: 'D', position: 'Yea' }], PB_D_YEA_R_NAY)];
  assert.equal(mergeMemberDoc(twice, 'A1', 119, entriesByMember(more).get('A1')).totals.votes, 3);
});
