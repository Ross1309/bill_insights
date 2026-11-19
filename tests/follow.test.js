import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billBaseline, billChange, memberBaseline, memberChange, topicBaseline, topicChange } from '../public/follow.js';

const bill = { id: 'hr1-119', bill_number: 'HR 1', title: 'A bill', type: 'HR', stage: 'passed_one',
  latest_action_date: '2025-05-22', latestAction: { actionDate: '2025-05-22', text: 'Received in the Senate.' } };

test('bill: no change, new action, new stage', () => {
  const base = billBaseline(bill);
  assert.equal(base.label, 'H.R. 1: A bill');
  assert.equal(billChange(base, bill), null);
  const acted = { ...bill, latest_action_date: '2025-06-01', latestAction: { actionDate: '2025-06-01', text: 'Motion to proceed.' } };
  assert.deepEqual(billChange(base, acted), { what: 'New action', detail: '2025-06-01: Motion to proceed.' });
  const passed = { ...acted, stage: 'passed_both' };
  assert.match(billChange(base, passed).what, /^Now: /);
  assert.equal(billChange(base, null), null);
});

const rec = (votes, missed, recent = [], congress = 119) => ({ congress, name: 'Doe, Jane', chamber: 'House', state: 'WA',
  totals: { votes, not_voting: missed }, recent });

test('member: counts new votes and misses since the baseline', () => {
  const base = memberBaseline({ name: 'Doe, Jane', chamber: 'House', state: 'WA' }, rec(100, 3, [{ date: '2025-06-01T15:00:00Z' }]));
  assert.equal(base.label, 'Jane Doe');
  assert.equal(memberChange(base, rec(100, 3)), null);
  const later = rec(102, 4, [
    { id: '119-1-house-vote-5', date: '2025-06-03T15:00:00Z', chamber: 'House', question: 'On Passage', result: 'Passed', position: 'Yea', bill_id: 'hr5-119', legislation: 'HR 5' },
    { id: '119-1-house-vote-4', date: '2025-06-02T15:00:00Z', chamber: 'House', question: 'On Passage', result: 'Failed', position: 'Not Voting' },
    { id: '119-1-house-vote-3', date: '2025-06-01T15:00:00Z', chamber: 'House', question: 'On Passage', result: 'Passed', position: 'Yea' },
  ]);
  const c = memberChange(base, later);
  assert.equal(c.what, '2 new recorded votes, 1 missed');
  assert.deepEqual(c.votes.map(v => v.id), ['119-1-house-vote-5', '119-1-house-vote-4']);
  assert.ok(c.votes.every(v => typeof v.headline === 'string' && v.headline));
});

test('member: a new Congress counts every vote as new', () => {
  const base = memberBaseline(null, rec(700, 10));
  assert.equal(memberChange(base, rec(5, 0, [], 120)).what, '5 new recorded votes');
});

test('topic: new laws and measures only when they grew', () => {
  const base = topicBaseline({ label: 'Economy', law: 10, measures: 40 });
  assert.equal(topicChange(base, { law: 10, measures: 40 }), null);
  assert.equal(topicChange(base, { law: 11, measures: 42 }).what, '1 new law, 2 more bills or resolutions voted on or enacted');
});
