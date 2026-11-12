// Did last night's scheduled syncs succeed? Reads the stats/health doc through the site's
// /api/health function (no credentials; App Check blocks Firestore's public API for
// non-browser callers) and exits 1 if either sync failed or hasn't succeeded recently.
// HEALTH_URL overrides the endpoint (e.g. http://localhost:8888/api/health).
// Run daily by .github/workflows/health.yml (GitHub emails on a failed run).
//
//   node scripts/check-health.js            # or: npm run health
//
// Syncs run at 10:00 and 10:30 UTC; the workflow checks at 12:00 UTC, so a good night
// is ~2 h old. MAX_AGE_H leaves room for a late manual run without missing a skipped night.

const URL = process.env.HEALTH_URL || 'https://congress-watcher.netlify.app/api/health';
const MAX_AGE_H = Number(process.env.HEALTH_MAX_AGE_H) || 20;
const SYNCS = { ingest_votes: 'Votes + members (ingest-votes, 10:00 UTC)', sync_bills: 'Bills (sync-bills, 10:30 UTC)' };

const res = await fetch(URL);
if (!res.ok) {
  console.error(`Could not read the health record (${URL}): HTTP ${res.status}`);
  process.exit(1);
}
const doc = await res.json();

const problems = [];
for (const [key, label] of Object.entries(SYNCS)) {
  const run = doc[key];
  if (!run) { problems.push(`${label}: no run recorded`); continue; }
  // Judge the *scheduled* runs: a manual run (run-ingest.js, curl) mustn't mask a failed
  // nightly one. Records written before scheduled runs were tracked fall back to the
  // plain fields.
  const tracked = 'last_scheduled_run' in run;
  const lastSuccess = tracked ? run.last_scheduled_success : run.last_success;
  const ok = tracked ? run.last_scheduled_ok : run.ok;
  const ageH = lastSuccess ? (Date.now() - Date.parse(lastSuccess)) / 3600e3 : Infinity;
  const line = `${label}: last ${tracked ? 'scheduled ' : ''}run ${tracked ? run.last_scheduled_run : run.last_run}, ${ok ? 'ok' : 'FAILED'}, `
    + `last success ${lastSuccess || 'never'}${Number.isFinite(ageH) ? ` (${ageH.toFixed(1)} h ago)` : ''}`
    + `; latest run of any kind ${run.last_run} (${run.scheduled ? 'scheduled' : 'manual'}, ${run.ok ? 'ok' : `failed: ${(run.failed_steps || []).join(', ')}`})`;
  console.log(line);
  if (!ok) problems.push(`${label}: last ${tracked ? 'scheduled ' : ''}run failed`);
  if (ageH > MAX_AGE_H) problems.push(`${label}: no successful run in ${Number.isFinite(ageH) ? `${ageH.toFixed(0)} h` : 'ever'}`);
}

if (problems.length) {
  console.error(`\nProblems:\n- ${problems.join('\n- ')}\n\nCheck the function logs: Netlify -> congress-watcher -> Logs -> Functions,`
    + ' or `netlify logs --function ingest-votes --since 24h`. Re-run with "Run now" on the function page.');
  process.exit(1);
}
console.log('\nBoth nightly syncs are healthy.');
