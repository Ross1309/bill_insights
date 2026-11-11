import admin from 'firebase-admin';
import fetch from 'node-fetch';

if (!admin.apps.length) {
  let serviceAccount;
  const rawKey = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (typeof rawKey === 'string' && rawKey.trim().startsWith('{')) {
    serviceAccount = JSON.parse(rawKey);
  } else if (typeof rawKey === 'object') {
    serviceAccount = rawKey;
  } else {
    serviceAccount = JSON.parse(Buffer.from(rawKey, 'base64').toString('utf8'));
  }

  if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();
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

    // 1. Sync Members by State (e.g., WA)
    await syncMembersByState("WA");

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

async function syncMembersByState(stateCode) {
  const url = `https://api.congress.gov/v3/member/${stateCode}?api_key=${CONGRESS_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();

  const members = data.members || [];
  const batch = db.batch();

  for (const m of members) {
    if (!m.bioguideId) continue;
    const ref = db.collection("members").doc(m.bioguideId);
    batch.set(ref, {
      bioguideId: m.bioguideId,
      name: m.name,
      state: stateCode,
      party: m.partyName,
      chamber: m.terms?.item?.[m.terms?.item?.length - 1]?.chamber || "Unknown",
      district: m.district || null,
      imageUrl: `https://www.congress.gov/img/member/${m.bioguideId.toLowerCase()}.jpg`,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }

  await batch.commit();
  console.log(`Synced members for state: ${stateCode}`);
}