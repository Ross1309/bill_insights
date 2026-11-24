import test from 'node:test';
import assert from 'node:assert/strict';
import { glance, topics } from '../public/bill-contents.js';

const part = (kind, en, heading, words, extra = {}) => ({ kind, enum: en, heading, words, sections: 1, unheaded: 0, parts: [], items: [], ...extra });
const sec = heading => ({ kind: 'section', enum: '1', heading });

// H.R. 2882 (118th) in miniature: spending divisions + "Other Matters", first published as a
// 104-word bill under another title.
const package2882 = {
  words: 183000, sections: 651, version: 'enr', official_title: 'Making further consolidated appropriations.',
  parts: [
    part('division', 'A', 'Department of Defense Appropriations Act, 2024', 27000),
    part('division', 'B', 'Financial Services and General Government Appropriations Act, 2024', 154700),
    part('division', 'G', 'Other Matters', 1300, { parts: [
      part('title', 'I', 'Extensions and Other Matters', 700, { items: [sec('National Flood Insurance Program'), sec('E-verify')] }),
      part('title', 'II', 'Udall Foundation Reauthorization', 220, { items: [sec('Short title'), sec('Investment earnings')] }),
      part('title', 'IV', 'Budgetary Effects', 236),
    ] }),
  ],
  items: [],
  first: { version: 'ih', words: 104, sections: 2, official_title: 'To reauthorize the Morris K. Udall and Stewart L. Udall Trust Fund, and for other purposes.' },
};
const versions = { latest: { code: 'enr', type: 'Enrolled Bill', date: null }, first: { code: 'ih', type: 'Introduced in House', date: '2023-04-26' } };

test('glance: spending package with other matters', () => {
  const g = glance(package2882, versions);
  assert.equal(g[0], '2 regular spending bills (appropriations) for fiscal year 2024, 99% of the text, plus Division G, <q>Other Matters</q> (under 1%).');
  // Catch-all titles open into their sections; named titles stay as they are; routine ones drop.
  assert.equal(g[1], 'Division G covers National Flood Insurance Program, E-verify and Udall Foundation Reauthorization.');
  assert.equal(g[2], 'When first published (Introduced in House, Apr 26, 2023), it was 104 words long, titled <q>To reauthorize the Morris K. Udall and Stewart L. Udall Trust Fund, and for other purposes</q>.');
});

test('glance: other bills name their largest parts; similar first versions are left out', () => {
  const c = { words: 1000, sections: 9, version: 'enr', official_title: 'X.', items: [],
    parts: [part('title', 'I', 'Taxes', 600), part('title', 'II', 'Health <care>', 300), part('title', 'III', 'Trade', 100)],
    first: { version: 'ih', words: 900, sections: 8, official_title: 'X.' } };
  assert.deepEqual(glance(c, versions), ['3 titles. The largest: Title I, <q>Taxes</q> (60%); Title II, <q>Health &lt;care&gt;</q> (30%); Title III, <q>Trade</q> (10%).']);
  assert.deepEqual(glance({ words: 300, sections: 4, parts: [], items: [] }, null), ['4 sections.']);
});

test('topics: section headings for catch-alls, without routine sections', () => {
  assert.deepEqual(topics(package2882.parts[2]), ['National Flood Insurance Program', 'E-verify', 'Udall Foundation Reauthorization']);
});
