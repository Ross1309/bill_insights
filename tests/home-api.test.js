// /api/home serializes Firestore Timestamps for JSON.
import test from 'node:test';
import assert from 'node:assert/strict';

test('plain: Timestamps (nested, in arrays) become ISO strings; the rest is unchanged', async () => {
  process.env.FIREBASE_SERVICE_ACCOUNT ||= '{}';
  const { plain } = await import('../netlify/functions/home.js');
  const ts = { toDate: () => new Date('2026-11-19T10:01:26.833Z') };
  assert.deepEqual(plain({ generated_at: ts, weekly: [{ week: '2026-11-16', at: ts }], n: 3, none: null }),
    { generated_at: '2026-11-19T10:01:26.833Z', weekly: [{ week: '2026-11-16', at: '2026-11-19T10:01:26.833Z' }], n: 3, none: null });
});
