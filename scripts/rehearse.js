// Dry run of the nightly jobs as of a chosen date: reads go to the real Firestore and
// the real sources (Congress.gov, senate.gov, ...), but nothing is written. Every write is
// recorded and summarized instead, and OpenAI is never called. Made for the Congress
// rollover (January 3 of odd years), useful for any risky change to a nightly job.
//
//   node scripts/rehearse.js --date 2027-01-04T12:00:00Z ingest
//   node scripts/rehearse.js --date 2027-01-04T12:00:00Z sync-bills
//   node scripts/rehearse.js --date 2027-01-04T12:00:00Z congress-stats
//   node scripts/rehearse.js --date 2027-01-04T12:00:00Z stats
//   ... --show stats/overview      print what a write to that doc would contain
//
// The date only moves the Congress/session logic (CW_TODAY, public/congress.js); token
// expiry, retry timers etc. keep the real clock.

import 'dotenv/config';
import { DocumentReference, WriteBatch, BulkWriter, Transaction } from 'firebase-admin/firestore';

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const date = arg('date');
const job = process.argv.at(-1);
const show = arg('show');
if (!date || !['ingest', 'sync-bills', 'congress-stats', 'stats'].includes(job)) {
  console.error('usage: node scripts/rehearse.js --date <ISO date> [--show <collection/doc>] ingest|sync-bills|congress-stats|stats');
  process.exit(2);
}
process.env.CW_TODAY = date;

// --- Capture every write --------------------------------------------------------------
const realDelete = DocumentReference.prototype.delete;
const writes = [];
const record = (op, ref, data) => {
  writes.push({ op, path: ref.path, data });
  return Promise.resolve({ writeTime: null });
};
for (const op of ['set', 'update', 'create', 'delete']) {
  DocumentReference.prototype[op] = function (data) { return record(op, this, data); };
  WriteBatch.prototype[op] = function (ref, data) { record(op, ref, data); return this; };
  BulkWriter.prototype[op] = function (ref, data) { return record(op, ref, data); };
  Transaction.prototype[op] = function (ref, data) { record(op, ref, data); return this; };   // run locks
}
WriteBatch.prototype.commit = () => Promise.resolve([]);
BulkWriter.prototype.close = () => Promise.resolve();
BulkWriter.prototype.flush = () => Promise.resolve();

// --- No OpenAI calls -----------------------------------------------------------------------
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => /api\.openai\.com/.test(String(url))
  ? Promise.resolve(new Response(JSON.stringify({ error: { message: 'dry run: OpenAI not called' } }), { status: 503 }))
  : realFetch(url, opts);
process.env.OPENAI_API_KEY ||= 'dry-run';

// --- Safety check: a write through the patched path must not reach Firestore ----------------
{
  const { getDb } = await import('../netlify/lib/firebase.js');
  const canary = getDb().collection('sync_state').doc('rehearsal-canary');
  await canary.set({ at: new Date().toISOString() });
  if ((await canary.get()).exists) {
    await realDelete.call(canary);
    console.error('ABORT: a test write reached Firestore, so writes are not being captured. Nothing else ran.');
    process.exit(1);
  }
  writes.length = 0;
}

// --- Run the job ---------------------------------------------------------------------------
const { currentCongress, outgoingCongress } = await import('../netlify/lib/congress.js');
console.log(`Rehearsal as of ${date}: current ${currentCongress().congress}th Congress, session ${currentCongress().session}` +
  `${outgoingCongress() ? `; also finishing the ${outgoingCongress()}th` : ''}. Writes are recorded, not sent.\n`);

let result;
if (job === 'ingest') {
  const { handler } = await import('../netlify/functions/ingest-votes.js');
  result = await handler({}, {});
} else if (job === 'sync-bills') {
  const { default: run } = await import('../netlify/functions/sync-bills.js');
  const res = await run(null);
  result = { status: res.status, body: await res.text() };
} else if (job === 'congress-stats') {
  const { default: run } = await import('../netlify/functions/sync-congress-stats.js');
  const res = await run(null);
  result = { status: res.status, body: await res.text() };
} else {
  const { getDb, admin } = await import('../netlify/lib/firebase.js');
  result = await (await import('../netlify/lib/overview.js')).writeOverviewStats(getDb(), admin, { congress: currentCongress().congress });
}

// --- Report ------------------------------------------------------------------------------
console.log('\nResult:', typeof result === 'object' ? JSON.stringify(result).slice(0, 1500) : result);
const byCollection = new Map();
for (const w of writes) {
  const key = `${w.op} ${w.path.split('/')[0]}`;
  byCollection.set(key, (byCollection.get(key) || 0) + 1);
}
console.log(`\n${writes.length} write(s) that would have been sent:`);
for (const [k, n] of [...byCollection].sort()) console.log(`  ${k}: ${n}`);
const notable = writes.filter(w => /^(stats\/(overview|weeks|health|congress-\d+)|sync_state\/)/.test(w.path));
for (const w of notable) {
  const d = w.data || {};
  const brief = { congress: d.congress, generated_at: d.generated_at ? '(timestamp)' : undefined,
    weeks: Array.isArray(d.weeks) ? `${d.weeks.length} weeks, last ${d.weeks.at(-1)?.week}` : undefined,
    this_week: d.this_week ? d.this_week.week : undefined, laws_total: d.laws_total };
  console.log(`  -> ${w.path}: ${JSON.stringify(Object.fromEntries(Object.entries(brief).filter(([, v]) => v !== undefined)))}`);
}
if (show) {
  const hit = writes.filter(w => w.path === show).at(-1);
  console.log(`\n${show}:`, hit ? JSON.stringify(hit.data, null, 1).slice(0, 6000) : '(not written)');
}
process.exit(0);
