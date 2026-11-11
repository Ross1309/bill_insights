import fetch from 'node-fetch';
import { getDb, admin } from '../lib/firebase.js';
import { STATE_CODES } from '../../public/states.js';

const db = getDb();
const CONGRESS_API_KEY = process.env.CONGRESS_API_KEY;
const CONGRESS_NUM = 119;
const API = 'https://api.congress.gov/v3';
const VOTES_PER_RUN = 5;
const BILL_TYPES = new Set(['HR', 'S', 'HRES', 'SRES', 'HJRES', 'SJRES', 'HCONRES', 'SCONRES']);
const TALLY_KEYS = { yea: 'yea', aye: 'yea', nay: 'nay', no: 'nay', present: 'present', 'not voting': 'not_voting' };

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Congress API ${res.status} for ${url.replace(/api_key=[^&]+/, 'api_key=***')}`);
  return res.json();
}

// The house-vote list endpoint ignores `sort` and returns votes unordered,
// so page through the whole congress and pick the newest by start time.
async function fetchLatestHouseVotes(n) {
  const all = [];
  for (let offset = 0; ; offset += 250) {
    const page = await getJson(`${API}/house-vote/${CONGRESS_NUM}?api_key=${CONGRESS_API_KEY}&format=json&limit=250&offset=${offset}`);
    const items = page.houseRollCallVotes || [];
    all.push(...items);
    if (items.length < 250 || all.length >= (page.pagination?.count ?? 0)) break;
  }
  return all
    .filter(v => v.sessionNumber && v.rollCallNumber && v.startDate)
    .sort((a, b) => new Date(b.startDate) - new Date(a.startDate))
    .slice(0, n);
}

export async function handler(event, context) {
  try {
    console.log("Starting Congressional backend data ingestion...");

    // 1. Sync all current members of Congress
    await syncCurrentMembers();

    // 2. Fetch the most recent House roll-call votes
    const latest = await fetchLatestHouseVotes(VOTES_PER_RUN);

    for (const voteItem of latest) {
      const session = voteItem.sessionNumber;
      const voteNumber = voteItem.rollCallNumber;
      // Roll-call numbers restart each session, so the session is part of the id.
      const voteId = `${CONGRESS_NUM}-${session}-house-vote-${voteNumber}`;

      const detailUrl = `${API}/house-vote/${CONGRESS_NUM}/${session}/${voteNumber}/members?api_key=${CONGRESS_API_KEY}&format=json`;
      const detail = (await getJson(detailUrl)).houseRollCallVoteMemberVotes || {};

      const memberVotes = (detail.results || []).map(m => ({
        bioguideId: m.bioguideID,
        name: [m.lastName, m.firstName].filter(Boolean).join(', '),
        state: m.voteState || null,
        party: m.voteParty || null,
        position: m.voteCast || null,
      }));

      // "Aye"/"No" (recorded votes) are counted with "Yea"/"Nay".
      const tallies = memberVotes.reduce((acc, m) => {
        const key = TALLY_KEYS[(m.position || '').toLowerCase()] || 'other';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, { yea: 0, nay: 0, present: 0, not_voting: 0 });

      const legType = (voteItem.legislationType || '').toUpperCase();
      const isBill = BILL_TYPES.has(legType) && voteItem.legislationNumber;

      await db.collection("votes").doc(voteId).set({
        vote_id: voteId,
        bill_id: isBill ? `${legType.toLowerCase()}${voteItem.legislationNumber}-${CONGRESS_NUM}` : null,
        legislation: legType && voteItem.legislationNumber ? `${legType} ${voteItem.legislationNumber}` : null,
        chamber: "House",
        congress: CONGRESS_NUM,
        session: session,
        roll_call_number: voteNumber,
        date: voteItem.startDate ? new Date(voteItem.startDate).toISOString() : null,
        question: detail.voteQuestion || null,
        vote_type: voteItem.voteType || null,
        result: voteItem.result || null,
        tallies: tallies,
        individual_votes: memberVotes,
        source_url: voteItem.sourceDataURL || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      console.log(`Ingested Roll Call Vote #${voteNumber} (${voteItem.startDate})`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Successfully ingested members and roll-call votes!" }),
    };

  } catch (error) {
    console.error("Ingestion failed:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

const CHAMBERS = { 'House of Representatives': 'House', 'Senate': 'Senate' };

// Writes every sitting member (all states, plus non-voting delegates) and marks
// members already in Firestore who are no longer serving as `current: false`.
async function syncCurrentMembers() {
  const members = [];
  for (let offset = 0; ; offset += 250) {
    const page = await getJson(`${API}/member?api_key=${CONGRESS_API_KEY}&format=json&currentMember=true&limit=250&offset=${offset}`);
    const items = page.members || [];
    members.push(...items);
    if (items.length < 250 || members.length >= (page.pagination?.count ?? 0)) break;
  }

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
