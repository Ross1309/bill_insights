// Run health: one public doc, stats/health, with the latest run of each scheduled sync.
//
//   { ingest_votes: { last_run, last_success, last_scheduled_run, last_scheduled_success,
//                     ok, scheduled, failed_steps[], counts {} },
//     sync_bills:   { ... } }
//
// The site shows "data as of <last_success>" and a notice when it's old. The daily
// health check looks at the *scheduled* fields, so a manual run (run-ingest.js, curl
// under netlify dev) can't hide a failed nightly run. Only step names are stored (no
// error messages: the doc is public).

// One line per invocation, to tell Netlify's repeat invocations of a schedule apart: retries
// carry the same next_run. Log timestamps are delivery times, so the real time is in the text.
export function logRunStart(name, nextRun, requestId) {
  console.log(`${name} run start ${new Date().toISOString()}; next_run ${nextRun || 'none'}; request ${requestId || 'unknown'}`);
}

export async function recordRun(db, name, { failedSteps = [], counts = {}, scheduled = false } = {}) {
  const now = new Date().toISOString();
  const ok = failedSteps.length === 0;
  try {
    await db.collection('stats').doc('health').set({
      [name]: {
        last_run: now, ok, scheduled, failed_steps: failedSteps, counts,
        ...(ok ? { last_success: now } : {}),
        ...(scheduled ? { last_scheduled_run: now, last_scheduled_ok: ok } : {}),
        ...(scheduled && ok ? { last_scheduled_success: now } : {}),
      },
    }, { merge: true });
  } catch (err) {
    console.error(`Could not record run health for ${name}:`, err.message);
  }
}
