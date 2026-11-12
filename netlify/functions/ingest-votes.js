import { createHash } from 'node:crypto';
import { getDb, admin } from '../lib/firebase.js';
import { getJson } from '../lib/http.js';
import { STATE_CODES } from '../../public/states.js';
import { listSenateVotes, fetchSenateVote, senateVoteId } from '../lib/senate-votes.js';
import { listHouseVotes, buildHouseVoteDoc, houseVoteId } from '../lib/house-votes.js';
import { writeOverviewStats } from '../lib/overview.js';
import { fetchEnrichedBill, parseBillId } from '../lib/bills.js';
import { currentCongress } from '../lib/congress.js';
import { applyNewMemberVotes } from '../lib/member-votes.js';
import { loadVoteIndex } from '../lib/vote-index.js';
import { recordRun } from '../lib/health.js';
import { markTracked } from '../lib/tracked-bills.js';
import { pool } from '../lib/pool.js';

const db = getDb();
const CONGRESS_API_KEY = process.env.CONGRESS_API_KEY;
// Current Congress from the date (rolls over on January 3 of odd years).
const CONGRESS_NUM = currentCongress().congress;
const API = 'https://api.congress.gov/v3';
// Every vote not yet stored is fetched (newest first), up to this many per chamber
// per run so the scheduled function stays inside its 30 s limit; any remainder is
// picked up the next night. Busy days have had 24 votes in one chamber.
const MAX_NEW_VOTES_PER_CHAMBER = 40;

// Netlify's scheduler sends a body with `next_run`; run-ingest.js doesn't, and `netlify
// dev` (which imitates the scheduler) sets NETLIFY_DEV. Only real scheduled runs count.
const isScheduled = event => {
  if (process.env.NETLIFY_DEV) return false;
  try { return Boolean(JSON.parse(event?.body || "{}").next_run); } catch { return false; }
};

export async function handler(event, context) {
  try {
    console.log("Starting Congressional backend data ingestion...");

    // congress-legislators: bioguide -> FEC ids and Senate LIS ids. Optional.
    const legislators = await fetchLegislators();

    // Last run's health: a failed stats rebuild is retried even on a quiet night.
    const lastRun = (await db.collection("stats").doc("health").get()).data()?.ingest_votes;

    // 1. Sync all current members of Congress (writes only members that changed). On
    //    its own: a members-API problem mustn't stop the vote sync.
    const failures = [];
    let memberChanges = 0;
    try {
      memberChanges = await syncCurrentMembers(legislators);
    } catch (err) {
      failures.push(`members: ${err.message}`);
      console.error("Member sync failed:", err);
    }

    // 2 + 3. Latest House and Senate roll-call votes. Independent, so one source
    // failing doesn't block the other.
    const indexed = new Set((await loadVoteIndex(db, CONGRESS_NUM) || []).map(v => v.id));
    const results = await Promise.allSettled([syncHouseVotes(indexed), syncSenateVotes(legislators, indexed)]);
    results.forEach((r, i) => { if (r.status === "rejected") failures.push(`${["house votes", "senate votes"][i]}: ${r.reason?.message || r.reason}`); });
    failures.forEach(msg => console.error("Sync step failed:", msg));

    // 4. Per-member voting records: count every vote not yet applied (incl. any a
    //    failed earlier run left behind).
    let applied = { votes: 0, members: 0 };
    try {
      applied = await applyNewMemberVotes(db, admin, CONGRESS_NUM);
      if (applied.votes) console.log(`Member records: applied ${applied.votes} votes to ${applied.members} members`);
    } catch (err) {
      failures.push(`member votes: ${err.message}`);
      console.error("Member vote records failed:", err);
    }

    // 5. Issue tracker: enrich the bills these votes are on (sync-bills summarizes them).
    let enriched = 0;
    try {
      const billIds = results.filter(r => r.status === "fulfilled").flatMap(r => r.value || []);
      const n = enriched = await enrichVotedBills(billIds);
      if (n) console.log(`Enriched ${n} newly voted-on bills`);
    } catch (err) {
      failures.push(`enrich: ${err.message}`);
      console.error("Bill enrichment failed:", err);
    }

    // 6. Rebuild the precomputed stats, only when something they show changed (most
    //    nights in a recess nothing did) or the last run didn't finish cleanly.
    const changed = applied.votes || enriched || memberChanges;
    if (!changed && lastRun?.ok) console.log("No new votes, bills or member changes; stats left as they are.");
    else try {
      const stats = await writeOverviewStats(db, admin, { congress: CONGRESS_NUM });
      console.log(`stats rebuilt for the ${stats.congress}th Congress from ${stats.votes} votes`);
    } catch (err) {
      failures.push(`stats: ${err.message}`);
      console.error("Stats rebuild failed:", err);
    }

    await recordRun(db, "ingest_votes", { failedSteps: failures.map(m => m.split(":")[0]), counts: { new_votes: applied.votes }, scheduled: isScheduled(event) });
    return {
      statusCode: results.every(r => r.status === "rejected") ? 500 : 200,
      body: JSON.stringify({
        message: failures.length ? "Ingested with errors." : "Successfully ingested members and roll-call votes!",
        errors: failures,
      }),
    };

  } catch (error) {
    console.error("Ingestion failed:", error);
    await recordRun(db, "ingest_votes", { failedSteps: ["run"], scheduled: isScheduled(event) });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

// House: every roll call in the Congress.gov list that isn't stored yet.
export async function syncHouseVotes(indexed) {
  const all = await listHouseVotes(CONGRESS_NUM, CONGRESS_API_KEY); // newest first
  const id = v => houseVoteId(CONGRESS_NUM, v.sessionNumber, v.rollCallNumber);
  const unstored = await unstoredIds(all.map(id), indexed);
  const missing = all.filter(v => unstored.has(id(v)));
  const todo = missing.slice(0, MAX_NEW_VOTES_PER_CHAMBER);
  if (missing.length > todo.length) console.warn(`House: ${missing.length} missing votes; ingesting ${todo.length}, the rest next run`);
  const billIds = [];
  await pool(todo, 5, async voteItem => {
    const doc = await buildHouseVoteDoc(voteItem, CONGRESS_NUM, CONGRESS_API_KEY);
    if (!doc.individual_votes.length) {
      console.warn(`House ${doc.vote_id}: member positions not published yet; will retry next run`);
      return;
    }
    await db.collection("votes").doc(doc.vote_id).set({ ...doc, members_applied: false, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    if (doc.bill_id) billIds.push(doc.bill_id);
  });
  console.log(`House: ingested ${todo.length} new votes`);
  return billIds;
}

// Senate: every roll call in the senate.gov vote menus that isn't stored yet.
export async function syncSenateVotes(legislators, indexed) {
  const lisToBioguide = new Map((legislators || [])
    .filter(l => l.id?.lis && l.id?.bioguide)
    .map(l => [l.id.lis, l.id.bioguide]));

  // In session 2, last session's vote list is final once January is over (the Senate
  // can still vote in session 1 until January 3), so it's only fetched in January or
  // when none of its votes are indexed yet.
  const { session } = currentCongress();
  const hasSession1 = [...indexed].some(id => id.startsWith(`${CONGRESS_NUM}-1-senate-`));
  const sessions = session === 2 ? (new Date().getUTCMonth() === 0 || !hasSession1 ? [2, 1] : [2]) : [1];
  const entries = await listSenateVotes(CONGRESS_NUM, sessions); // newest first
  const unstored = await unstoredIds(entries.map(senateVoteId), indexed);
  const missing = entries.filter(e => unstored.has(senateVoteId(e)));
  const todo = missing.slice(0, MAX_NEW_VOTES_PER_CHAMBER);
  if (missing.length > todo.length) console.warn(`Senate: ${missing.length} missing votes; ingesting ${todo.length}, the rest next run`);
  const billIds = [];
  await pool(todo, 3, async entry => {
    const { doc, unmapped } = await fetchSenateVote(entry, lisToBioguide);
    await db.collection("votes").doc(doc.vote_id).set({ ...doc, members_applied: false, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    if (unmapped) console.warn(`Senate vote ${doc.vote_id}: ${unmapped} senator(s) without a bioguide mapping`);
    if (doc.bill_id) billIds.push(doc.bill_id);
  });
  console.log(`Senate: ingested ${todo.length} new votes`);
  return billIds;
}

// Vote ids not stored yet. The vote index lists every applied vote, so only ids
// missing from it are looked up (usually a handful; all of them if there's no index
// yet). Votes stored but not yet applied are found by the lookup, so never re-fetched.
async function unstoredIds(ids, indexed) {
  const candidates = ids.filter(id => !indexed.has(id));
  const out = new Set();
  for (let i = 0; i < candidates.length; i += 300) {
    const snaps = await db.getAll(...candidates.slice(i, i + 300).map(id => db.collection("votes").doc(id)), { fieldMask: ["vote_id"] });
    snaps.forEach(s => { if (!s.exists) out.add(s.id); });
  }
  return out;
}

// Bills a new vote refers to: store + enrich them if they aren't yet (stage, subjects,
// topics). No OpenAI here (keeps this run fast): a bill that has never been checked
// for a CRS summary is marked crs_summary_available: null, and sync-bills summarizes
// those first. Already-enriched bills get their stage refreshed by sync-bills when
// they show up as recently updated.
async function enrichVotedBills(ids) {
  const unique = [...new Set(ids)].filter(id => parseBillId(id));
  const snaps = await Promise.all(unique.map(id => db.collection("bills").doc(id).get()));
  const todo = unique.map((id, i) => [id, snaps[i]]).filter(([, s]) => !s.exists || !s.data().enriched_at);
  // One failure mustn't drop the others from the tracker (they'd be enriched but never
  // refreshed), so failures are collected and reported after the rest are tracked.
  const done = [];
  const errors = [];
  await pool(todo, 5, async ([id, snap]) => {
    try {
      const { congress, type, number } = parseBillId(id);
      const fields = await fetchEnrichedBill(congress, type, number, CONGRESS_API_KEY);
      const data = snap.exists ? snap.data() : {};
      const neverChecked = !data.ai_summary && data.crs_summary_available === undefined;
      await db.collection("bills").doc(id).set({
        ...fields,
        ...(neverChecked ? { crs_summary_available: null } : {}),
        synced_at: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      done.push({ id, stage: fields.stage });
    } catch (err) {
      errors.push(`${id}: ${err.message}`);
    }
  });
  await markTracked(db, admin, done);
  if (errors.length) throw new Error(`${errors.length} bill(s) failed (retried next run): ${errors.slice(0, 3).join("; ")}`);
  return todo.length;
}

const CHAMBERS = { 'House of Representatives': 'House', 'Senate': 'Senate' };

// Public-domain congress-legislators dataset: maps bioguideId to FEC candidate ids
// and Senate LIS ids (Congress.gov carries neither). Returns null if unavailable.
const LEGISLATORS_URL = 'https://unitedstates.github.io/congress-legislators/legislators-current.json';

async function fetchLegislators() {
  try {
    return await getJson(LEGISLATORS_URL, { timeoutMs: 20000 });
  } catch (err) {
    console.warn(`congress-legislators unavailable (${err.message}); fec_ids left unchanged, Senate votes unmapped.`);
    return null;
  }
}

// Writes every sitting member (all states, plus non-voting delegates) and marks
// members already in Firestore who are no longer serving as `current: false`.
// A fingerprint of each member's stored fields is kept in sync_state/members (one
// read), so only members whose data changed are written; without it (first run) every
// member is written and retirements come from reading the members collection.
// Returns how many member docs (incl. the directory) were written.
const fingerprint = value => createHash("sha1").update(JSON.stringify(value)).digest("base64").slice(0, 12);

const MIN_CURRENT_MEMBERS = 500;

async function syncCurrentMembers(legislators) {
  const members = [];
  for (let offset = 0; ; offset += 250) {
    const page = await getJson(`${API}/member?api_key=${CONGRESS_API_KEY}&format=json&currentMember=true&limit=250&offset=${offset}`);
    const items = page.members || [];
    members.push(...items);
    const total = page.pagination?.count;
    if (items.length < 250 || (total != null && members.length >= total)) break;
  }
  // A short or empty list (API trouble) would mark everyone missing as retired and wipe
  // the directory. Congress has 535 voting members + 6 delegates, minus vacancies.
  if (members.length < MIN_CURRENT_MEMBERS) {
    throw new Error(`Congress.gov returned only ${members.length} current members (expected ${MIN_CURRENT_MEMBERS}+); left members unchanged`);
  }

  const fecIds = legislators
    ? new Map(legislators.filter(l => l.id?.bioguide).map(l => [l.id.bioguide, l.id.fec || []]))
    : null;

  const ops = [];
  const pending = []; // [bioguideId, fields] for every current member
  const currentIds = new Set();
  const directory = [];
  const unknownStates = new Set();

  for (const m of members) {
    if (!m.bioguideId) continue;
    const state = STATE_CODES[m.state];
    if (!state) unknownStates.add(m.state);

    const terms = [...(m.terms?.item || [])].sort((a, b) => (a.startYear || 0) - (b.startYear || 0));
    const latestChamber = terms.at(-1)?.chamber;

    currentIds.add(m.bioguideId);
    const chamber = CHAMBERS[latestChamber] || latestChamber || null;
    directory.push({
      id: m.bioguideId,
      name: m.name || null,
      state: state || null,
      party: m.partyName || null,
      chamber,
      district: m.district ?? null,
      imageUrl: m.depiction?.imageUrl || null,
    });
    pending.push([m.bioguideId, {
      bioguideId: m.bioguideId,
      name: m.name || null,
      state: state || null,
      state_name: m.state || null,
      party: m.partyName || null,
      chamber,
      district: m.district ?? null,
      imageUrl: m.depiction?.imageUrl || null,
      // Only written when the mapping loaded, so a failed fetch never wipes it.
      ...(fecIds ? { fec_ids: fecIds.get(m.bioguideId) || [] } : {}),
      current: true,
    }]);
  }

  const stateRef = db.collection("sync_state").doc("members");
  const state = (await stateRef.get()).data();
  const prints = { ...(state?.members || {}) };
  const now = admin.firestore.FieldValue.serverTimestamp();
  for (const [id, data] of pending) {
    const print = fingerprint(data);
    if (prints[id] === print) continue;
    ops.push([db.collection("members").doc(id), { ...data, updatedAt: now }]);
    // Without the FEC mapping the write leaves fec_ids alone, so keep the old print.
    if (fecIds || !prints[id]) prints[id] = print;
  }

  // Anyone stored earlier who isn't in the current list has left office.
  const previousIds = state ? Object.keys(state.members || {}) : (await db.collection("members").where("current", "==", true).select().get()).docs.map(d => d.id);
  let retired = 0;
  for (const id of previousIds) {
    if (currentIds.has(id)) continue;
    ops.push([db.collection("members").doc(id), { current: false, updatedAt: now }]);
    delete prints[id];
    retired++;
  }

  for (let i = 0; i < ops.length; i += 450) {
    const batch = db.batch();
    for (const [ref, data] of ops.slice(i, i + 450)) batch.set(ref, data, { merge: true });
    await batch.commit();
  }

  // One compact doc with every current member (~100 KB), so the directory page can
  // search and filter nationwide with a single read instead of ~540.
  directory.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const directoryPrint = fingerprint(directory);
  if (directoryPrint !== state?.directory) {
    await db.collection("directory").doc("members").set({ members: directory, count: directory.length, updatedAt: now });
  }
  await stateRef.set({ members: prints, directory: directoryPrint, updated_at: now });

  if (unknownStates.size) console.warn(`Unmapped state names: ${[...unknownStates].join(', ')}`);
  const directoryChanged = directoryPrint !== state?.directory;
  console.log(`Members: ${currentIds.size} current; wrote ${ops.length - retired} changed, marked ${retired} as no longer serving${directoryChanged ? "; directory updated" : ""}.`);
  return ops.length + (directoryChanged ? 1 : 0);
}
