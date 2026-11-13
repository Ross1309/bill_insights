// Compact vote index (no Firestore): doc grouping, merge by id, and expansion.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entriesByIndexDoc, indexDocId, indexVotes, mergeIndex } from '../netlify/lib/vote-index.js';

const v = (id, date, chamber = 'House', session = 2) => ({
  id, date, chamber, session, congress: 119, roll_call_number: 7, question: 'On Passage',
  result: 'Passed', bill_id: null, tallies: { yea: 1, nay: 0 }, party_breakdown: { D: { yea: 1, nay: 0 } },
  individual_votes: [{ bioguideId: 'A1' }],
});

test('entriesByIndexDoc: one doc per congress/session/chamber, compact entries', () => {
  const groups = entriesByIndexDoc([v('a', '2026-01-02'), v('b', '2026-01-01', 'Senate'), v('c', '2025-05-01', 'House', 1)]);
  assert.deepEqual([...groups.keys()].sort(), ['119-1-house', '119-2-house', '119-2-senate']);
  const e = groups.get('119-2-house').entries[0];
  assert.equal(e.roll, 7);
  assert.equal(e.individual_votes, undefined); // the heavy field stays out
  assert.equal(indexDocId(119, 2, 'Senate'), '119-2-senate');
});

test('mergeIndex: replaces by id and sorts oldest first', () => {
  const merged = mergeIndex([{ id: 'b', date: '2026-01-02', result: 'old' }], [{ id: 'a', date: '2026-01-01' }, { id: 'b', date: '2026-01-02', result: 'new' }]);
  assert.deepEqual(merged.map(e => e.id), ['a', 'b']);
  assert.equal(merged[1].result, 'new');
});

test('indexVotes: restores the fields stats code reads', () => {
  const [out] = indexVotes({ congress: 119, session: 2, chamber: 'Senate', entries: [{ id: 'x', roll: 12, date: '2026-01-01' }] });
  assert.equal(out.chamber, 'Senate');
  assert.equal(out.roll_call_number, 12);
  assert.equal(out.congress, 119);
});

test('voteSummary: drops member positions and bookkeeping, keeps the rest', async () => {
  const { voteSummary } = await import('../netlify/lib/vote-index.js');
  const s = voteSummary({
    id: 'v', vote_id: 'v', chamber: 'Senate', question: 'On the Nomination', tallies: { yea: 51, nay: 49 },
    party_breakdown: { R: { yea: 51, nay: 0 } }, individual_votes: Array(100).fill({}), members_applied: true, updatedAt: 1,
  });
  assert.equal(s.member_count, 100);
  assert.equal(s.individual_votes, undefined);
  assert.equal(s.members_applied, undefined);
  assert.equal(s.vote_id, 'v');
  assert.deepEqual(s.tallies, { yea: 51, nay: 49 });
});

test('voteKind / voteSummary: final votes, nominations, rules, procedural', async () => {
  const { voteKind, voteSummary } = await import('../netlify/lib/vote-index.js');
  assert.equal(voteKind('On Passage', 'Major Richard Star Act'), 'passage');
  assert.equal(voteKind('On Agreeing to the Resolution', 'Providing for consideration of the bill (H.R. 1013)'), 'rule');
  assert.equal(voteKind('On the Nomination', null), 'nomination');
  assert.equal(voteKind('On Ordering the Previous Question', null), 'procedural');
  assert.equal(voteKind('On the Cloture Motion', null), 'cloture');
  const s = voteSummary({ id: 'v', question: 'On Passage', individual_votes: [{}] }, 'Some Act');
  assert.equal(s.bill_title, 'Some Act');
  assert.equal(s.kind, 'passage');
});
