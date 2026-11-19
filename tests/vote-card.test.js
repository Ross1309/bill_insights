// The shared vote card: what the bill does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { voteCardHtml } from '../public/vote-card.js';

const vote = { id: 'v1', chamber: 'House', date: '2026-11-12T16:00:00Z', question: 'On Passage', result: 'Passed',
  tallies: { yea: 392, nay: 18 }, party_breakdown: { D: { yea: 210, nay: 0 }, R: { yea: 181, nay: 18 } }, bill_id: 'hr2102-119', legislation: 'HR 2102', bill_title: 'Major Richard Star Act' };

test('a vote card says what the bill does, with its source', () => {
  const html = voteCardHtml({ ...vote, bill_summary: 'The bill allows concurrent pay.' });
  assert.match(html, /What the bill does:<\/span> The bill allows concurrent pay\./);
  assert.match(html, /AI summary of the official CRS summary/);
  assert.doesNotMatch(voteCardHtml({ ...vote, bill_summary: 'X' }, { billSummary: false }), /What the bill does/);
});

test('without a summary it says so; rules and nominations get no line', () => {
  assert.match(voteCardHtml(vote), /No plain-language summary here yet/);
  assert.match(voteCardHtml({ ...vote, bill_id: 'hres5-119', bill_summary: 'It does X.' }), /What the resolution does/);
  const rule = { ...vote, bill_id: 'hres9-119', bill_title: 'Providing for consideration of the bill (H.R. 1)', bill_summary: 'X' };
  assert.doesNotMatch(voteCardHtml(rule), /What the|No plain-language/);
  assert.doesNotMatch(voteCardHtml({ ...vote, bill_id: null, legislation: 'PN 1', question: 'On the Nomination' }), /What the|No plain-language/);
});
