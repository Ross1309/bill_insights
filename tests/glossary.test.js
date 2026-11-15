// Tap-to-explain: terms are marked in already-escaped official text, longest phrase first,
// once per term, without breaking the escaping.
import test from 'node:test';
import assert from 'node:assert/strict';
import { termize, TERMS } from '../public/glossary.js';

const terms = html => [...html.matchAll(/data-term="([a-z_]+)"/g)].map(m => m[1]);

test('termize marks vote questions', () => {
  assert.deepEqual(terms(termize('On Motion to Suspend the Rules and Pass, as Amended')), ['suspension']);
  assert.deepEqual(terms(termize('On Cloture on the Motion to Proceed')), ['cloture', 'proceed']);
  assert.deepEqual(terms(termize('On Motion to Table the Motion to Recommit')), ['table', 'recommit']);   // not "table" twice
  assert.deepEqual(terms(termize('Majority required: 3/5')), ['two_thirds']);
});

test('termize marks bill actions, first mention only, keeps the text', () => {
  const t = 'Passed Senate without amendment by Unanimous Consent. Received in the House. Held at the desk. Unanimous Consent again.';
  const out = termize(t);
  assert.deepEqual(terms(out), ['amendment', 'unanimous_consent', 'desk']);
  assert.equal(out.replace(/<[^>]+>/g, ''), t);   // same words, only wrapped
});

test('termize keeps escaping intact and honors skip', () => {
  const out = termize('Committee on Ways &amp; Means &lt;b&gt;');
  assert.ok(out.includes('&amp;') && out.includes('&lt;b&gt;') && !out.includes('<b>'));
  assert.deepEqual(terms(termize('On the Nomination', { skip: ['nomination'] })), []);
  assert.equal(termize(null), '');
});

test('every term has a label and a definition', () => {
  for (const [key, [label, def]] of Object.entries(TERMS)) assert.ok(label && def && def.length > 20, key);
});
