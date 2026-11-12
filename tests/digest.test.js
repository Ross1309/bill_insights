// Weekly digest (no Firestore): week boundaries, categories, closest votes, laws.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWeeks, lawSigning, thisWeek } from '../netlify/lib/digest.js';

const pb = (dy, dn, ry, rn) => ({ D: { yea: dy, nay: dn }, R: { yea: ry, nay: rn } });
const v = (id, date, chamber, question, result, yea, nay, extra = {}) =>
  ({ id, date, chamber, question, result, tallies: { yea, nay }, party_breakdown: pb(...(extra.pb || [0, 0, 0, 0])), ...extra });

const votes = [
  // Monday Nov 9, 2026, 9 pm Eastern = Nov 10 02:00 UTC: still that week.
  v('h1', '2026-11-10T02:00:00Z', 'House', 'On Passage', 'Passed', 218, 214, { bill_id: 'hr1-119', pb: [0, 212, 218, 2] }),
  v('h2', '2026-11-11T15:00:00Z', 'House', 'On Motion to Suspend the Rules and Pass', 'Failed', 250, 170, { bill_id: 'hr2-119', pb: [200, 10, 50, 160] }),
  v('h3', '2026-11-11T16:00:00Z', 'House', 'On Ordering the Previous Question', 'Passed', 216, 215),   // procedural: not "closest"
  v('s1', '2026-11-12T18:00:00Z', 'Senate', 'On the Nomination', 'Confirmed', 51, 49, { legislation: 'PN 12', document_title: 'Jane Doe, of Ohio, to be a Judge', pb: [0, 47, 51, 2] }),
  v('s2', '2026-11-12T19:00:00Z', 'Senate', 'On the Cloture Motion', 'Rejected', 55, 45),
  // Sunday Nov 15, 11 pm Eastern = Nov 16 04:00 UTC: still the week of Nov 9.
  v('h4', '2026-11-16T04:00:00Z', 'House', 'On Agreeing to the Resolution', 'Agreed to', 400, 2, { bill_id: 'hres5-119' }),
  // Next week.
  v('h5', '2026-11-17T15:00:00Z', 'House', 'On Passage', 'Passed', 300, 100, { bill_id: 'hr3-119' }),
];
const laws = [
  { id: 'hr9-119', bill_number: 'HR 9', title: 'A Law', law_number: '119-60', latestAction: { actionDate: '2026-11-13', text: 'Became Public Law No: 119-60.' } },
  { id: 'hr8-119', bill_number: 'HR 8', title: 'Old', law_number: '119-1', latestAction: { actionDate: '2026-11-13', text: 'Presented to President.' } },
];
const titles = new Map([['hr1-119', { bill_number: 'HR 1', title: 'One Act' }]]);

test('computeWeeks: Monday-Sunday weeks in Eastern time', () => {
  const weeks = computeWeeks(votes, laws, titles, { congress: 119 });
  assert.deepEqual([...weeks.keys()].sort(), ['2026-11-09', '2026-11-16']);
  const w = weeks.get('2026-11-09');
  assert.deepEqual(w.counts.votes, { House: 4, Senate: 2 });
  assert.equal(w.week_end, '2026-11-15');
});

test('computeWeeks: passage, nominations, laws and closest votes', () => {
  const w = computeWeeks(votes, laws, titles, { congress: 119 }).get('2026-11-09');
  assert.equal(w.counts.passed, 2);    // h1 On Passage, h4 resolution agreed to
  assert.equal(w.counts.failed, 1);    // h2 suspension failed
  assert.equal(w.passage.find(p => p.id === 'h1').bill.label, 'HR 1');
  assert.equal(w.passage.find(p => p.id === 'h1').alignment, 'opposed');
  assert.equal(w.counts.confirmed, 1);
  assert.equal(w.nominations[0].document_title, 'Jane Doe, of Ohio, to be a Judge');
  // Closest: h1 (4) and s1 (2) and s2 (10); the 1-vote procedural h3 is left out.
  assert.deepEqual(w.closest.map(c => c.id), ['s1', 'h1', 's2']);
  // Laws: only bills whose latest action is "Became Public Law".
  assert.deepEqual(w.laws.map(l => l.id), ['hr9-119']);
  assert.equal(w.counts.laws, 1);
});

test('computeWeeks: onlyWeeks limits the work; lawSigning; thisWeek', () => {
  const only = computeWeeks(votes, laws, titles, { onlyWeeks: new Set(['2026-11-16']) });
  assert.deepEqual([...only.keys()], ['2026-11-16']);
  assert.equal(lawSigning({ latestAction: { actionDate: '2026-01-02', text: 'Became Public Law No: 119-3.' } }), '2026-01-02');
  assert.equal(lawSigning({ latestAction: { actionDate: '2026-01-02', text: 'Signed by President.' } }), null);
  assert.equal(lawSigning({ latestAction: { actionDate: '2026-03-26', text: 'Became Private Law No: 119-1.' } }), '2026-03-26');
  assert.equal(lawSigning({ law_date: '2026-02-01', latestAction: { actionDate: '2026-02-11', text: 'Committee filed written report.' } }), '2026-02-01');
  const card = thisWeek(computeWeeks(votes, laws, titles).get('2026-11-09'));
  assert.equal(card.law_count, 1);
  assert.deepEqual(card.passed_items.map(p => p.id), ['h4', 'h1']);
});
