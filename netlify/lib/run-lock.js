// One working copy of a nightly job at a time. Netlify starts another copy of a scheduled
// function when one hasn't answered within ~15 s (seen 2026-11-19: copies 15 s apart, up to
// three), and the copies ran at the same time over the same saved progress (overwriting each
// other's windows; two could summarize the same bill). Each copy now waits for the lock
// (sync_state/locks.<job>), then works with the time it has left: the copies run one after
// another instead of together, and each picks up the saved progress of the one before.
//
// The lock expires when its holder's 30 s are up, so a copy that crashes can't block the
// next. A copy that can't get the lock with enough time left stops at once and records
// nothing (its predecessor records the run).

const LOCK_DOC = ['sync_state', 'locks'];
const MIN_WORK_MS = 8000;        // default: not worth starting with less time than this
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Pure: may `id` take `name`'s lock now? (cur: the stored lock or undefined)
export const lockFree = (cur, now) => !cur || !(cur.until > now);

// -> { release(), waitedMs } or null when there's no time left to work.
// deadline: ms timestamp when this copy will be stopped (its start + 30 s). minWorkMs: the
// least time this job needs to do anything useful (jobs without their own time checks need
// more). If the lock itself can't be read or written (a Firestore error), the copy runs
// without it: skipping the night would be worse than a rare overlap.
export async function acquireRunLock(db, name, deadline, { now = () => Date.now(), pause = sleep, minWorkMs = MIN_WORK_MS } = {}) {
  try {
    return await takeTurn(db, name, deadline, { now, pause, minWorkMs });
  } catch (err) {
    console.warn(`${name}: run lock unavailable (${err.message}); running without it`);
    return { waitedMs: 0, release: async () => {} };
  }
}

async function takeTurn(db, name, deadline, { now, pause, minWorkMs }) {
  const ref = db.collection(LOCK_DOC[0]).doc(LOCK_DOC[1]);
  const id = `${now()}-${Math.random().toString(36).slice(2, 8)}`;
  let waitedMs = 0;   // time spent waiting for another copy (not the lock's own round trips)
  for (;;) {
    if (deadline - now() < minWorkMs) return null;
    const got = await db.runTransaction(async tx => {
      const cur = (await tx.get(ref)).data()?.[name];
      if (!lockFree(cur, now())) return false;
      tx.set(ref, { [name]: { id, until: deadline, started: new Date(now()).toISOString() } }, { merge: true });
      return true;
    });
    if (got) {
      return {
        waitedMs,
        release: () => db.runTransaction(async tx => {
          const cur = (await tx.get(ref)).data()?.[name];
          if (cur?.id === id) tx.set(ref, { [name]: { ...cur, until: 0, finished: new Date(now()).toISOString() } }, { merge: true });
        }).catch(err => console.warn(`${name}: lock release failed (it expires by itself): ${err.message}`)),
      };
    }
    await pause(1000);
    waitedMs += 1000;
  }
}
