import fetch from 'node-fetch';
import { getDb, admin } from '../lib/firebase.js';
import { STATE_CODES } from '../../public/states.js';
import { fetchLatestSenateVotes } from '../lib/senate-votes.js';
import { listHouseVotes, buildHouseVoteDoc } from '../lib/house-votes.js';
import { writeOverviewStats } from '../lib/overview.js';

const db = getDb();
const CONGRESS_API_KEY = process.env.CONGRESS_API_KEY;
const CONGRESS_NUM = 119;
const API = 'https://api.congress.gov/v3';
const VOTES_PER_RUN = 5;

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Congress API ${res.status} for ${url.replace(/api_key=[^&]+/, 'api_key=***')}`);
  return res.json();
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
    const results = await Promise.allSettled([syncHouseVotes(), syncSenateVotes(legislators)]);
    const failures = results.filter(r => r.status === "rejected").map(r => r.reason?.message || String(r.reason));
    failures.forEach(msg => console.error("Vote sync failed:", msg));

    // 4. Rebuild the Overview tab's precomputed stats (small fields only).
    try {
      const stats = await writeOverviewStats(db, admin, { congress: CONGRESS_NUM });
      console.log(`stats/overview rebuilt from ${stats.votes} votes`);
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

async function syncHouseVotes() {
  const latest = (await listHouseVotes(CONGRESS_NUM, CONGRESS_API_KEY)).slice(0, VOTES_PER_RUN);
  for (const voteItem of latest) {
    const doc = await buildHouseVoteDoc(voteItem, CONGRESS_NUM, CONGRESS_API_KEY);
    await db.collection("votes").doc(doc.vote_id).set({
      ...doc,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`Ingested House Roll Call Vote #${doc.roll_call_number} (${doc.date})`);
  }
}

async function syncSenateVotes(legislators) {
  const lisToBioguide = new Map((legislators || [])
    .filter(l => l.id?.lis && l.id?.bioguide)
    .map(l => [l.id.lis, l.id.bioguide]));

  const votes = await fetchLatestSenateVotes(VOTES_PER_RUN, lisToBioguide);
  for (const { doc, unmapped } of votes) {
    await db.collection("votes").doc(doc.vote_id).set({
      ...doc,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    if (unmapped) console.warn(`Senate vote ${doc.vote_id}: ${unmapped} senator(s) without a bioguide mapping`);
    console.log(`Ingested Senate Roll Call Vote #${doc.roll_call_number} (${doc.date})`);
  }
}

const CHAMBERS = { 'House of Representatives': 'House', 'Senate': 'Senate' };

// Public-domain congress-legislators dataset: maps bioguideId to FEC candidate ids
// and Senate LIS ids (Congress.gov carries neither). Returns null if unavailable.
const LEGISLATORS_URL = 'https://unitedstates.github.io/congress-legislators/legislators-current.json';

async function fetchLegislators() {
  try {
    const res = await fetch(LEGISLATORS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
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
