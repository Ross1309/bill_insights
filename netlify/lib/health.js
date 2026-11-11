// Run health: one public doc, stats/health, with the latest run of each scheduled sync.
//
//   { ingest_votes: { last_run, last_success, ok, failed_steps[], counts {} },
//     sync_bills:   { ... } }
//
// The site shows "data as of <last_success>" and a notice when it's old. Only step
// names are stored (no error messages: the doc is public).

export async function recordRun(db, name, { failedSteps = [], counts = {} } = {}) {
  const now = new Date().toISOString();
  const ok = failedSteps.length === 0;
  try {
    await db.collection('stats').doc('health').set({
      [name]: { last_run: now, ok, failed_steps: failedSteps, counts, ...(ok ? { last_success: now } : {}) },
    }, { merge: true });
  } catch (err) {
    console.error(`Could not record run health for ${name}:`, err.message);
  }
}
