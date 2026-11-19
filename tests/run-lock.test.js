// Nightly jobs: one working copy at a time; later copies wait, then continue.
import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireRunLock, lockFree } from '../netlify/lib/run-lock.js';

// A tiny in-memory stand-in for the Firestore calls the lock makes.
function fakeDb() {
  const store = {};
  const ref = { get: async () => ({ data: () => store.locks }) };
  return {
    store,
    collection: () => ({ doc: () => ref }),
    runTransaction: async fn => fn({
      get: r => r.get(),
      set: (_r, data) => { store.locks = { ...store.locks, ...data }; },
    }),
  };
}

test('lockFree: no lock, or one whose holder has run out of time', () => {
  assert.equal(lockFree(undefined, 100), true);
  assert.equal(lockFree({ until: 50 }, 100), true);
  assert.equal(lockFree({ until: 0 }, 100), true);
  assert.equal(lockFree({ until: 150 }, 100), false);
});

test('a second copy waits until the first releases, then works', async () => {
  const db = fakeDb();
  let t = 0;
  const clock = { now: () => t, pause: async ms => { t += ms; if (t === 10_000) await first.release(); } };
  const first = await acquireRunLock(db, 'sync-bills', 30_000, clock);
  assert.ok(first);
  t = 1_000;
  const second = await acquireRunLock(db, 'sync-bills', 31_000, clock);
  assert.ok(second, 'got the lock once the first released it');
  assert.equal(second.waitedMs, 9_000);
  assert.equal(db.store.locks['sync-bills'].until, 31_000);
});

test('a copy without enough time left stops; other jobs are not blocked; expired locks free', async () => {
  const db = fakeDb();
  let t = 0;
  const clock = { now: () => t, pause: async ms => { t += ms; } };
  await acquireRunLock(db, 'sync-bills', 30_000, clock);
  assert.ok(await acquireRunLock(db, 'ingest-votes', 30_000, clock), 'a different job has its own lock');
  t = 5_000;
  assert.equal(await acquireRunLock(db, 'sync-bills', 20_000, clock), null, 'gave up: under 8 s left');
  t = 30_001;
  assert.ok(await acquireRunLock(db, 'sync-bills', 60_000, clock), 'the crashed holder\'s lock expired');
});
