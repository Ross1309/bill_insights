// Term end and election dates for a seat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { electionDay, termFacts } from '../public/terms.js';
import { memberTerm } from '../netlify/lib/member-term.js';

test('election day: Tuesday after the first Monday in November', () => {
  assert.equal(electionDay(2026).toISOString().slice(0, 10), '2026-11-03');
  assert.equal(electionDay(2028).toISOString().slice(0, 10), '2028-11-07');
  assert.equal(electionDay(2030).toISOString().slice(0, 10), '2030-11-05');
  assert.equal(electionDay(2032).toISOString().slice(0, 10), '2032-11-02');   // Nov 1 is a Monday: not the 1st Tuesday
});

test('termFacts: upcoming vs already held, never who won', () => {
  const now = new Date('2026-11-16T12:00:00Z');
  assert.deepEqual(termFacts({ end: '2029-01-03', class: 3 }, now), { termEnds: 'January 3, 2029', election: 'November 7, 2028', held: false, class: 3 });
  assert.deepEqual(termFacts({ end: '2027-01-03', class: null }, now), { termEnds: 'January 3, 2027', election: 'November 3, 2026', held: true, class: null });
  assert.equal(termFacts(null, now), null);
  // After January 3 the dataset may still list the old term: show nothing rather than a past date.
  assert.equal(termFacts({ end: '2027-01-03' }, new Date('2027-01-04T15:00:00Z')), null);
  assert.equal(termFacts({ end: '2027-01-03' }, new Date('2027-01-02T15:00:00Z')).held, true);
  assert.deepEqual(memberTerm({ type: 'sen', start: '2023-01-03', end: '2029-01-03', class: 3 }), { start: '2023-01-03', end: '2029-01-03', class: 3 });
  assert.equal(memberTerm({}), null);
});
