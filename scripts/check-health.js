// Did last night's scheduled syncs succeed? Reads the public stats/health doc (no
// credentials) and exits 1 if either sync failed or hasn't succeeded recently.
// Run daily by .github/workflows/health.yml (GitHub emails on a failed run).
//
//   node scripts/check-health.js            # or: npm run health
//
// Syncs run at 10:00 and 10:30 UTC; the workflow checks at 12:00 UTC, so a good night
// is ~2 h old. MAX_AGE_H leaves room for a late manual run without missing a skipped night.

const PROJECT = 'congress-watcher-b0dd3';
const URL = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/stats/health`;
const MAX_AGE_H = Number(process.env.HEALTH_MAX_AGE_H) || 20;
const SYNCS = { ingest_votes: 'Votes + members (ingest-votes, 10:00 UTC)', sync_bills: 'Bills (sync-bills, 10:30 UTC)' };

// Firestore REST values -> plain JS.
function plain(v) {
  if (!v) return null;
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, plain(x)]));
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(plain);
  if ('integerValue' in v) return Number(v.integerValue);
  for (const k of ['stringValue', 'booleanValue', 'doubleValue', 'timestampValue']) if (k in v) return v[k];
  return null;
}

const res = await fetch(URL);
if (!res.ok) {
  console.error(`Could not read stats/health: HTTP ${res.status}`);
  process.exit(1);
}
const doc = plain({ mapValue: { fields: (await res.json()).fields || {} } });

const problems = [];
for (const [key, label] of Object.entries(SYNCS)) {
  const run = doc[key];
  if (!run) { problems.push(`${label}: no run recorded`); continue; }
  const ageH = run.last_success ? (Date.now() - Date.parse(run.last_success)) / 3600e3 : Infinity;
  const line = `${label}: last run ${run.last_run}, ${run.ok ? 'ok' : `FAILED (${(run.failed_steps || []).join(', ')})`}, `
    + `last success ${run.last_success || 'never'}${Number.isFinite(ageH) ? ` (${ageH.toFixed(1)} h ago)` : ''}, counts ${JSON.stringify(run.counts || {})}`;
  console.log(line);
  if (!run.ok) problems.push(`${label}: last run failed (${(run.failed_steps || []).join(', ') || 'unknown step'})`);
  if (ageH > MAX_AGE_H) problems.push(`${label}: no successful run in ${Number.isFinite(ageH) ? `${ageH.toFixed(0)} h` : 'ever'}`);
}

if (problems.length) {
  console.error(`\nProblems:\n- ${problems.join('\n- ')}\n\nCheck the function logs: Netlify -> congress-watcher -> Logs -> Functions,`
    + ' or `netlify logs --function ingest-votes --since 24h`. Re-run with "Run now" on the function page.');
  process.exit(1);
}
console.log('\nBoth nightly syncs are healthy.');
