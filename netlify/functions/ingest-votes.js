import { getDb, admin } from '../lib/firebase.js';
import { getJson } from '../lib/http.js';
import { STATE_CODES } from '../../public/states.js';
import { listSenateVotes, fetchSenateVote, senateVoteId } from '../lib/senate-votes.js';
import { listHouseVotes, buildHouseVoteDoc, houseVoteId } from '../lib/house-votes.js';
import { writeOverviewStats } from '../lib/overview.js';
import { fetchEnrichedBill, parseBillId } from '../lib/bills.js';
import { currentCongress } from '../lib/congress.js';
import { applyNewMemberVotes } from '../lib/member-votes.js';

const db = getDb();
const CONGRESS_API_KEY = process.env.CONGRESS_API_KEY;
// Current Congress from the date (rolls over on January 3 of odd years).
const CONGRESS_NUM = currentCongress().congress;
const API = 'https://api.congress.gov/v3';
// Every vote not yet stored is fetched (newest first), up to this many per chamber
// per run so the scheduled function stays inside its 30 s limit; any remainder is
// picked up the next night. Busy days have had 24 votes in one chamber.
const MAX_NEW_VOTES_PER_CHAMBER = 40;

async function pool(items, concurrency, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]);
    }
  }));
}

export async function handler(event, context) {
  try {
    console.log("Starting Congressional backend data ingestion...");

    // congress-legislators: bioguide -> FEC ids and Senate LIS ids. Optional.
    const legislators = await fetchLegislators();

    // 1. Sync all current members of Congress
    await syncCurrentMembers(legislators);

    // 2 + 3. Latest House and Senate roll-call votes. Independent, so one source
    // failing doesn't block the other.
    const stored = new Set((await db.collection("votes").where("congress", "==", CONGRESS_NUM).select().get()).docs.map(d => d.id));
    const results = await Promise.allSettled([syncHouseVotes(stored), syncSenateVotes(legislators, stored)]);
    const failures = results.filter(r => r.status === "rejected").map(r => r.reason?.message || String(r.reason));
    failures.forEach(msg => console.error("Vote sync failed:", msg));

    // 4. Per-member voting records: count every vote not yet applied (incl. any a
    //    failed earlier run left behind).
    try {
      const applied = await applyNewMemberVotes(db, admin, CONGRESS_NUM);
      if (applied.votes) console.log(`Member records: applied ${applied.votes} votes to ${applied.members} members`);
    } catch (err) {
      failures.push(`member votes: ${err.message}`);
      console.error("Member vote records failed:", err);
    }

    // 5. Issue tracker: enrich the bills these votes are on (sync-bills summarizes them).
    try {
      const billIds = results.filter(r => r.status === "fulfilled").flatMap(r => r.value || []);
      const n = await enrichVotedBills(billIds);
      if (n) console.log(`Enriched ${n} newly voted-on bills`);
    } catch (err) {
      failures.push(`enrich: ${err.message}`);
      console.error("Bill enrichment failed:", err);
    }

    // 6. Rebuild the Overview tab's precomputed stats (small fields only).
    try {
      const stats = await writeOverviewStats(db, admin, { congress: CONGRESS_NUM });
      console.log(`stats rebuilt for the ${stats.congress}th Congress from ${stats.votes} votes`);
    } catch (err) {
      failures.push(`stats: ${err.message}`);
      console.error("Stats rebuild failed:", err);
    }

    return {
      statusCode: results.every(r => r.status === "rejected") ? 500 : 200,
      body: JSON.stringify({
        message: failures.length ? "Ingested with errors." : "Successfully ingested members and roll-call votes!",
        errors: failures,
      }),
    };

  } catch (error) {
    console.error("Ingestion failed:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

// House: every roll call in the Congress.gov list that isn't stored yet.
export async function syncHouseVotes(stored) {
  const all = await listHouseVotes(CONGRESS_NUM, CONGRESS_API_KEY); // newest first
  const missing = all.filter(v => !stored.has(houseVoteId(CONGRESS_NUM, v.sessionNumber, v.rollCallNumber)));
  const todo = missing.slice(0, MAX_NEW_VOTES_PER_CHAMBER);
  if (missing.length > todo.length) console.warn(`House: ${missing.length} missing votes; ingesting ${todo.length}, the rest next run`);
  const billIds = [];
  await pool(todo, 5, async voteItem => {
    const doc = await buildHouseVoteDoc(voteItem, CONGRESS_NUM, CONGRESS_API_KEY);
    await db.collection("votes").doc(doc.vote_id).set({ ...doc, members_applied: false, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    if (doc.bill_id) billIds.push(doc.bill_id);
  });
  console.log(`House: ingested ${todo.length} new votes`);
  return billIds;
}

// Senate: every roll call in the senate.gov vote menus that isn't stored yet.
export async function syncSenateVotes(legislators, stored) {
  const lisToBioguide = new Map((legislators || [])
    .filter(l => l.id?.lis && l.id?.bioguide)
    .map(l => [l.id.lis, l.id.bioguide]));

  const { session } = currentCongress();
  const entries = await listSenateVotes(CONGRESS_NUM, session === 2 ? [2, 1] : [1]); // newest first
  const missing = entries.filter(e => !stored.has(senateVoteId(e)));
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

// Bills a new vote refers to: store + enrich them if they aren't yet (stage, subjects,
// topics). No OpenAI here (keeps this run fast): a bill that has never been checked
// for a CRS summary is marked crs_summary_available: null, and sync-bills summarizes
// those first. Already-enriched bills get their stage refreshed by sync-bills when
// they show up as recently updated.
async function enrichVotedBills(ids) {
  const unique = [...new Set(ids)].filter(id => parseBillId(id));
  const snaps = await Promise.all(unique.map(id => db.collection("bills").doc(id).get()));
  const todo = unique.map((id, i) => [id, snaps[i]]).filter(([, s]) => !s.exists || !s.data().enriched_at);
  await Promise.all(todo.map(async ([id, snap]) => {
    const { congress, type, number } = parseBillId(id);
    const fields = await fetchEnrichedBill(congress, type, number, CONGRESS_API_KEY);
    const data = snap.exists ? snap.data() : {};
    const neverChecked = !data.ai_summary && data.crs_summary_available === undefined;
    await db.collection("bills").doc(id).set({
      ...fields,
      ...(neverChecked ? { crs_summary_available: null } : {}),
      synced_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }));
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
async function syncCurrentMembers(legislators) {
  const members = [];
  for (let offset = 0; ; offset += 250) {
    const page = await getJson(`${API}/member?api_key=${CONGRESS_API_KEY}&format=json&currentMember=true&limit=250&offset=${offset}`);
    const items = page.members || [];
    members.push(...items);
    if (items.length < 250 || members.length >= (page.pagination?.count ?? 0)) break;
  }

  const fecIds = legislators
    ? new Map(legislators.filter(l => l.id?.bioguide).map(l => [l.id.bioguide, l.id.fec || []]))
    : null;

  const ops = [];
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
    ops.push([db.collection("members").doc(m.bioguideId), {
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
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }]);
  }

  // Anyone stored earlier who isn't in the current list has left office.
  const existing = await db.collection("members").select().get();
  let retired = 0;
  for (const doc of existing.docs) {
    if (currentIds.has(doc.id)) continue;
    ops.push([doc.ref, { current: false, updatedAt: admin.firestore.FieldValue.serverTimestamp() }]);
    retired++;
  }

  for (let i = 0; i < ops.length; i += 450) {
    const batch = db.batch();
    for (const [ref, data] of ops.slice(i, i + 450)) batch.set(ref, data, { merge: true });
    await batch.commit();
  }

  // One compact doc with every current member (~100 KB), so the directory page can
  // search and filter nationwide with a single read instead of ~540.
  await db.collection("directory").doc("members").set({
    members: directory.sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    count: directory.length,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  if (unknownStates.size) console.warn(`Unmapped state names: ${[...unknownStates].join(', ')}`);
  console.log(`Synced ${currentIds.size} current members; marked ${retired} as no longer serving.`);
}
