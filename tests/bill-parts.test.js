import test from 'node:test';
import assert from 'node:assert/strict';
import { billParts, decode, tidyHeading } from '../netlify/lib/bill-parts.js';

// A tiny bill in the House/Senate bill XML format: two divisions, a spending title with an
// agency heading and two accounts, a numbered provision without a heading, and a section that
// inserts text (with its own "section" and "title") into another law.
const XML = `<?xml version="1.0"?>
<!DOCTYPE bill PUBLIC "-//US Congress//DTDs/bill.dtd//EN" "bill.dtd">
<bill bill-stage="Enrolled-Bill">
<form><official-title>Making appropriations &amp; for other purposes.</official-title></form>
<legis-body>
<section><enum>1.</enum><header>Short title</header><text>This Act may be cited as the Example Act.</text></section>
<division><enum>A</enum><header>EXAMPLE APPROPRIATIONS ACT, 2026</header>
  <title style="appropriations"><enum>I</enum><header>DEPARTMENT OF AGRICULTURE</header>
    <appropriations-major><header>Agricultural research service</header></appropriations-major>
    <appropriations-intermediate><header>Salaries and expenses</header><text>For necessary expenses, $100.</text></appropriations-intermediate>
    <appropriations-intermediate><header>Buildings and facilities</header><text>For buildings, $5.</text></appropriations-intermediate>
    <section><enum>101.</enum><text>None of the funds may be used for one thing.</text></section>
  </title>
</division>
<division><enum>B</enum><header>Other Matters</header>
  <title><enum>I</enum><header>Extensions</header>
    <section><enum>101.</enum><header>Extension of a program</header>
      <text>Section 5 of another Act is amended by adding:</text>
      <quoted-block><section><enum>6.</enum><header>Inserted section</header><text>Two words.</text></section>
        <title><enum>IX</enum><header>Inserted title</header></title></quoted-block>
      <paragraph><enum>(1)</enum><header>Not a section heading</header><text>Text&#x2014;more.</text></paragraph>
    </section>
  </title>
</division>
</legis-body>
</bill>`;

test('billParts: divisions, titles, sections, spending headings, sizes', () => {
  const r = billParts(XML);
  assert.equal(r.official_title, 'Making appropriations & for other purposes.');
  assert.deepEqual(r.parts.map(p => [p.kind, p.enum, p.heading]), [
    ['division', 'A', 'Example Appropriations Act, 2026'],
    ['division', 'B', 'Other Matters'],
  ]);
  // The bill's own sections only: 1 + 101 + 101 (the quoted "6" is another law's).
  assert.equal(r.sections, 3);
  assert.deepEqual(r.items, [{ kind: 'section', enum: '1', heading: 'Short title' }]);
  const a1 = r.parts[0].parts[0];
  assert.equal(a1.heading, 'Department of Agriculture');
  assert.deepEqual(a1.items.map(i => [i.kind, i.heading]), [
    ['agency', 'Agricultural Research Service'],
    ['account', 'Salaries and Expenses'],
    ['account', 'Buildings and Facilities'],
  ]);
  assert.equal(a1.unheaded, 1);                       // Sec. 101, no heading
  assert.equal(a1.items[1].words, 7);                 // "Salaries and expenses" + "For necessary expenses, $100."
  const b1 = r.parts[1].parts[0];
  assert.deepEqual(b1.items, [{ kind: 'section', enum: '101', heading: 'Extension of a program' }]);
  assert.equal(b1.parts.length, 0);                   // the quoted title isn't one of the bill's parts
  // Sizes add up: every word belongs to the bill, parts are included in their parents.
  assert.equal(r.parts[0].words, r.parts[0].parts.reduce((n, p) => n + p.words, 0) + 5);   // + the division's own heading words
  assert.ok(r.words > r.parts[0].words + r.parts[1].words);
  assert.ok(b1.words >= 20, 'quoted text still counts toward the size');
});

test('billParts: a spending title named only by its first appropriations heading', () => {
  const r = billParts(`<bill><legis-body><division><enum>A</enum><header>Defense</header>
    <title style="appropriations"><enum>II</enum><appropriations-major><header>OPERATION AND MAINTENANCE</header></appropriations-major>
    <appropriations-intermediate><header>Operation and maintenance, army</header><text>For expenses, $1.</text></appropriations-intermediate></title>
  </division></legis-body></bill>`);
  const t = r.parts[0].parts[0];
  assert.equal(t.heading, 'Operation and Maintenance');
  assert.deepEqual(t.items.map(i => [i.kind, i.heading]), [['account', 'Operation and Maintenance, Army']]);
});

test('billParts: resolutions and bills without parts', () => {
  const r = billParts('<resolution><resolution-body><section><enum>1.</enum><text>Resolved, that the House honors it.</text></section></resolution-body></resolution>');
  assert.equal(r.parts.length, 0);
  assert.equal(r.sections, 1);
  assert.equal(r.words, 7);
});

test('tidyHeading / decode', () => {
  assert.equal(tidyHeading('DEPARTMENTS OF LABOR, HEALTH AND HUMAN SERVICES, AND EDUCATION'), 'Departments of Labor, Health and Human Services, and Education');
  assert.equal(tidyHeading('Military construction, defense-Wide', { smallCaps: true }), 'Military Construction, Defense-Wide');
  assert.equal(tidyHeading('Extension of special diabetes programs'), 'Extension of special diabetes programs');
  assert.equal(tidyHeading('TITLE IV—FDA AND NASA'), 'Title IV—FDA and NASA');
  assert.equal(decode('A &amp; B &#x2014; C &#8212; &quot;D&quot;'), 'A & B — C — "D"');
});
