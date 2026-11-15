// Link previews: share.js swaps the home page's preview tags for the item's, escaped,
// one of each, and keeps the app's script path absolute (the page is served at /bill/...).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withMeta } from '../netlify/functions/share.js';

const shell = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('withMeta replaces title, description and preview tags, escaped and once each', () => {
  const out = withMeta(shell, { title: 'H.R. 1: <A> & "B" — Congress Watcher', description: 'Passed the House.', url: 'https://x.test/bill/hr1-119', image: 'https://x.test/og.png' });
  const head = out.split('</head>')[0];
  for (const tag of ['og:title', 'og:description', 'og:url', 'og:image"', 'twitter:card', 'rel="canonical"']) {
    assert.equal(head.split(tag).length - 1, 1, tag);
  }
  assert.match(head, /<title>H\.R\. 1: &lt;A&gt; &amp; &quot;B&quot; — Congress Watcher<\/title>/);
  assert.match(head, /og:url" content="https:\/\/x\.test\/bill\/hr1-119"/);
  assert.match(head, /name="description" content="Passed the House\."/);
  assert.doesNotMatch(head, /congress-watcher\.netlify\.app\/" \/>/);   // the home canonical is gone
});

test('the page loads its script and styles by absolute path', () => {
  assert.match(shell, /src="\/app\.js"/);
  assert.match(shell, /href="\/styles\.css"/);
});
