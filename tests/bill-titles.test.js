// Bills' common names: the short title picked from Congress.gov's titles list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickShortTitle } from '../netlify/lib/bills.js';
import { billName } from '../public/util.js';

const HR1 = [
  { titleType: 'Display Title', title: 'An act to provide for reconciliation pursuant to title II of H. Con. Res. 14.' },
  { titleType: 'Short Titles as Enacted for portions of this bill', title: 'FEHB Protection Act of 2025' },
  { titleType: 'Popular Titles', title: 'One Big Beautiful Bill Act' },
  { titleType: 'Short Title(s) as Reported to House', title: 'One Big Beautiful Bill Act' },
  { titleType: 'Short Title(s) as Passed House', title: 'One Big Beautiful Bill Act' },
];

test('picks the latest stage short title, never a portion of the bill', () => {
  assert.equal(pickShortTitle(HR1, HR1[0].title), 'One Big Beautiful Bill Act');
  assert.equal(pickShortTitle([
    { titleType: 'Short Title(s) as Introduced', title: 'Old Name Act' },
    { titleType: 'Short Title(s) as Passed Senate', title: 'New Name Act' },
  ], 'To do something.'), 'New Name Act');
});

test('null when the display title is already the short title, or there is none', () => {
  assert.equal(pickShortTitle([{ titleType: 'Short Title(s) as Passed Senate', title: 'Laken Riley Act' }], 'Laken Riley Act'), null);
  assert.equal(pickShortTitle([{ titleType: 'Official Title as Introduced', title: 'Providing for congressional disapproval …' }], 'Providing for congressional disapproval …'), null);
  assert.equal(pickShortTitle([{ titleType: 'Popular Titles', title: 'Nickname Act' }], 'To do something.'), null);   // CRS nicknames aren't used
  assert.equal(pickShortTitle(undefined, 'To do x.'), null);
  // Congress.gov already displays a name: keep it, don't spell out the acronym.
  assert.equal(pickShortTitle([{ titleType: 'Short Title(s) as Introduced', title: 'Preventing Rip-offs and Obtaining Oversight of Funds Act' }], 'PROOF Act'), null);
});

test('billName prefers the short title', () => {
  assert.equal(billName({ title: 'An act to provide …', short_title: 'One Big Beautiful Bill Act' }), 'One Big Beautiful Bill Act');
  assert.equal(billName({ title: 'Laken Riley Act', short_title: null }), 'Laken Riley Act');
  assert.equal(billName(null), null);
});

test('disapproval resolutions read as what they overturn', () => {
  const cra = 'Providing for congressional disapproval under chapter 8 of title 5, United States Code, of the rule submitted by the Bureau of Land Management relating to "Miles City Field Office Record of Decision and Approved Resource Management Plan Amendment".';
  assert.equal(billName({ title: cra }), 'Overturning the Bureau of Land Management rule "Miles City Field Office Record of Decision and Approved Resource Management Plan Amendment"');
  assert.equal(billName({ title: 'Providing for congressional disapproval under chapter 8 of title 5, United States Code, of the rule issued by the Environmental Protection Agency relating to the "California State Nonroad Engine Pollution Control Standards".' }),
    'Overturning the Environmental Protection Agency rule "California State Nonroad Engine Pollution Control Standards"');
  assert.equal(billName({ title: 'A joint resolution providing for congressional disapproval of the proposed foreign military sale to the Government of Israel of certain defense articles and services.' }),
    'Disapproving the proposed foreign military sale to the Government of Israel of certain defense articles and services');
  assert.equal(billName({ title: 'Major Richard Star Act' }), 'Major Richard Star Act');
  // A House rule that names such resolutions keeps its own title.
  const rule = 'Providing for consideration of the joint resolution (H.J. Res. 60) providing for congressional disapproval under chapter 8 of title 5, United States Code, of the rule submitted by the National Park Service relating to "Glen Canyon"; and for other purposes';
  assert.equal(billName({ title: rule }), rule);
});

test('formatDay writes dates by hand', async () => {
  const { formatDay } = await import('../public/util.js');
  assert.equal(formatDay('2025-05-20'), 'May 20, 2025');
  assert.equal(formatDay('2026-09-04T00:00:00Z'), 'Sep 4, 2026');
  assert.equal(formatDay(''), '');
  assert.equal(formatDay('not a date'), 'not a date');
});
