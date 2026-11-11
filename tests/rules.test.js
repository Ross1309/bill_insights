// Unit tests for the small rule functions the site's numbers depend on.
// Run: npm test   (Node's built-in test runner; no dependencies)
//
// Several cases are regressions for real bugs: "Not agreed to" contains "agreed to",
// "Concurrent Resolution" contains "concur", Senate times are Eastern with DST, and a
// new Congress starts on January 3, not January 1.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { stageFromActions } from '../netlify/lib/bills.js';
import { partyBreakdown, partyAlignment, voteCategory, voteOutcome } from '../netlify/lib/vote-stats.js';
import { parseSenateDate } from '../netlify/lib/senate-votes.js';
import { currentCongress, ordinal } from '../netlify/lib/congress.js';
import { topicTags } from '../netlify/lib/topics.js';
import { explainQuestion } from '../public/issues.js';

const acts = (...texts) => texts.map(text => ({ text }));

test('stageFromActions: failed House vote is not "passed"', () => {
  const s = stageFromActions(acts(
    'Referred to the House Committee on Foreign Affairs.',
    'Failed of passage/not agreed to in House: On agreeing to the resolution Failed by the Yeas and Nays: 212 - 219.',
  ));
  assert.equal(s.stage, 'committee');
  assert.equal(s.passed_house, false);
  assert.equal(s.failed_house, true);
});

test('stageFromActions: passed House, failed Senate', () => {
  const s = stageFromActions(acts(
    'Passed/agreed to in House: On agreeing to the resolution Agreed to by the Yeas and Nays: 214 - 208.',
    'Failed of passage/not agreed to in Senate: Concurrent Resolution rejected by Yea-Nay Vote. 49 - 50.',
  ));
  assert.equal(s.stage, 'passed_one');
  assert.equal(s.passed_house, true);
  assert.equal(s.failed_senate, true);
});

test('stageFromActions: both chambers, president, law', () => {
  assert.equal(stageFromActions(acts('Passed/agreed to in House: x', 'Passed/agreed to in Senate: y')).stage, 'passed_both');
  assert.equal(stageFromActions(acts('Passed/agreed to in House: x', 'Passed/agreed to in Senate: y', 'Presented to President.')).stage, 'to_president');
  assert.equal(stageFromActions(acts('Became Public Law No: 119-45.')).stage, 'law');
  assert.equal(stageFromActions([], { isLaw: true }).stage, 'law');
});

test('partyBreakdown + partyAlignment', () => {
  const pb = partyBreakdown([
    { party: 'D', position: 'Yea' }, { party: 'D', position: 'Nay' }, { party: 'D', position: 'Yea' },
    { party: 'R', position: 'No' }, { party: 'R', position: 'Nay' }, { party: 'R', position: 'Not Voting' },
    { party: 'I', position: 'Aye' },
  ]);
  assert.deepEqual(pb.D, { yea: 2, nay: 1, present: 0, not_voting: 0 });
  assert.deepEqual(pb.R, { yea: 0, nay: 2, present: 0, not_voting: 1 });
  assert.equal(partyAlignment(pb), 'opposed');
  assert.equal(partyAlignment({ D: { yea: 200, nay: 5 }, R: { yea: 210, nay: 3 } }), 'same');
  assert.equal(partyAlignment({ D: { yea: 5, nay: 5 }, R: { yea: 1, nay: 2 } }), 'unclear');
});

test('voteCategory', () => {
  assert.equal(voteCategory('On Cloture on the Motion to Proceed'), 'cloture');
  assert.equal(voteCategory('On the Nomination'), 'nomination');
  assert.equal(voteCategory('On Motion to Suspend the Rules and Pass, as Amended'), 'passage');
  assert.equal(voteCategory('On the Concurrent Resolution'), 'passage');
  assert.equal(voteCategory('On Motion to Concur in the Senate Amendment'), 'passage');
  assert.equal(voteCategory('On Agreeing to the Amendment'), 'amendment');
  assert.equal(voteCategory('On Ordering the Previous Question'), 'procedural');
});

test('voteOutcome: negatives win over "agreed"', () => {
  assert.equal(voteOutcome('Passed'), 'succeeded');
  assert.equal(voteOutcome('Nomination Confirmed'), 'succeeded');
  assert.equal(voteOutcome('Concurrent Resolution Rejected'), 'failed');
  assert.equal(voteOutcome('Motion Not Agreed to'), 'failed');
  assert.equal(voteOutcome('Decision of Chair Not Sustained'), 'failed');
});

test('parseSenateDate: Eastern time with DST', () => {
  assert.equal(parseSenateDate('November 10, 2026, 07:37 PM'), '2026-11-11T00:37:00.000Z'); // EST
  assert.equal(parseSenateDate('July 15, 2026, 10:05 AM'), '2026-07-15T14:05:00.000Z');     // EDT
  assert.equal(parseSenateDate('not a date'), null);
});

test('currentCongress: starts January 3', () => {
  assert.deepEqual(currentCongress(new Date('2026-11-11T12:00:00Z')), { congress: 119, session: 2 });
  assert.deepEqual(currentCongress(new Date('2027-01-02T23:00:00Z')), { congress: 119, session: 2 });
  assert.deepEqual(currentCongress(new Date('2027-01-03T18:00:00Z')), { congress: 120, session: 1 });
  assert.deepEqual(currentCongress(new Date('2028-03-01T12:00:00Z')), { congress: 120, session: 2 });
  assert.equal([119, 121, 122, 123, 111, 112, 113].map(ordinal).join(' '), '119th 121st 122nd 123rd 111th 112th 113th');
});

test('topicTags: title rule, focused rule, aid pattern', () => {
  const sanctions = topicTags({ policy_area: 'International Affairs', subjects: new Array(30).fill('x'), title: 'Sanctioning Russia and Iran Act' });
  assert.deepEqual(sanctions.topics, ['foreign-affairs', 'iran']);
  assert.equal(sanctions.topic_focus.iran, true);

  const omnibus = topicTags({ policy_area: 'Economics and Public Finance', subjects: [...new Array(248).fill('x'), 'Israel'], title: 'Consolidated Appropriations Act, 2026' });
  assert.deepEqual(omnibus.topics, ['economy', 'israel']);
  assert.equal(omnibus.topic_focus.israel, false);

  const disaster = topicTags({ policy_area: 'Emergency Management', subjects: ['Disaster relief'], title: 'Disaster Assistance Improvement Act' });
  assert.deepEqual(disaster.topics, []);
});

test('explainQuestion: concur vs concurrent, cloture vs motion to proceed', () => {
  assert.match(explainQuestion('On Motion to Concur in the Senate Amendments'), /other chamber's version/);
  assert.match(explainQuestion('On the Concurrent Resolution'), /adopts the resolution/);
  assert.match(explainQuestion('On Cloture on the Motion to Proceed'), /60 of 100/);
  assert.match(explainQuestion('On the Motion to Proceed'), /start debating/);
  assert.match(explainQuestion('On the Nomination'), /confirm/);
});

test('headlineCounts: seat types and party split', async () => {
  const { headlineCounts } = await import('../netlify/lib/vote-stats.js');
  const h = headlineCounts([
    { chamber: 'Senate', party: 'Republican', state: 'TX' },
    { chamber: 'Senate', party: 'Independent', state: 'VT' },
    { chamber: 'House', party: 'Democratic', state: 'WA' },
    { chamber: 'House', party: 'Democratic', state: 'DC' },
  ]);
  assert.deepEqual(h.senate, { count: 2, parties: { Republican: 1, Independent: 1 } });
  assert.deepEqual(h.house, { count: 1, parties: { Democratic: 1 } });
  assert.equal(h.delegates.count, 1);
});
