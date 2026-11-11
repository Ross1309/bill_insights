// fetchWithRetry against a throwaway local server: retries 503s, gives up after the
// retry budget, doesn't retry 404s, and masks API keys in error messages.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchWithRetry, getJson, HttpError } from '../netlify/lib/http.js';

let server;
let base;
const hits = {};

before(async () => {
  server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    hits[path] = (hits[path] || 0) + 1;
    if (path === '/flaky' && hits[path] <= 2) { res.writeHead(503); return res.end(); }
    if (path === '/down') { res.writeHead(503); return res.end(); }
    if (path === '/missing') { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, path }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('retries 503 then succeeds', async () => {
  const data = await getJson(`${base}/flaky`, { retries: 2 });
  assert.deepEqual(data, { ok: true, path: '/flaky' });
  assert.equal(hits['/flaky'], 3);
});

test('gives up after the retry budget with the status', async () => {
  await assert.rejects(fetchWithRetry(`${base}/down`, { retries: 1 }), err => err instanceof HttpError && err.status === 503);
  assert.equal(hits['/down'], 2);
});

test('does not retry 404 and masks api_key', async () => {
  await assert.rejects(fetchWithRetry(`${base}/missing?api_key=SECRET123`, { retries: 2 }), err => {
    assert.equal(err.status, 404);
    assert.ok(!err.message.includes('SECRET123'));
    assert.ok(err.message.includes('api_key=***'));
    return true;
  });
  assert.equal(hits['/missing'], 1);
});
