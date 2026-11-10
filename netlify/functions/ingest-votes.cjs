const admin = require('firebase-admin');
const fetch = require('node-fetch');

// Initialize Firebase Admin (uses environment variables in Netlify)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Replace escaped newlines from environment variable strings
      privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
    }),
  });
}

const db = admin.firestore();
const CONGRESS_API_KEY = process.env.CONGRESS_API_KEY;
const CONGRESS_NUM = 119; // Current Congress (2025-2026)

exports.handler = async (event, context) => {
  try {
    console.log("Starting Congressional backend data ingestion...");

    // 1. Sync Members by State (e.g., WA)
    await syncMembersByState("WA");

    // 2. Fetch Recent House Roll-Call Votes
    const votesUrl = `https://api.congress.gov/v3/house-vote/${CONGRESS_NUM}?api_key=${CONGRESS_API_KEY}&limit=5`;
    const votesRes = await fetch(votesUrl);
    const votesData = await votesRes.json();

    const votesList = votesData.houseVotes || [];

    for (const voteItem of votesList) {
      const session = voteItem.sessionNumber || 1;
      const voteNumber = voteItem.rollCallNumber;
      const voteId = `${CONGRESS_NUM}-house-vote-${voteNumber}`;

      // Fetch specific vote member breakdowns
      const detailUrl = `https://api.congress.gov/v3/house-vote/${CONGRESS_NUM}/${session}/${voteNumber}/members?api_key=${CONGRESS_API_KEY}`;
      const detailRes = await fetch(detailUrl);
      const detailData = await detailRes.json();

      const memberVotes = (detailData.houseVoteMembers || []).map(m => ({
        bioguideId: m.bioguideId,
        name: m.name,
        state: m.state,
        party: m.party,
        position: m.votePosition // "Yea", "Nay", "Not Voting", "Present"
      }));

      // Calculate Tallies
      const tallies = memberVotes.reduce((acc, m) => {
        const pos = m.position ? m.position.toLowerCase().replace(' ', '_') : 'other';
        acc[pos] = (acc[pos] || 0) + 1;
        return acc;
      }, { yea: 0, nay: 0, not_voting: 0, present: 0 });

      // Upsert Vote Record into Firestore
      await db.collection("votes").doc(voteId).set({
        vote_id: voteId,
        bill_id: voteItem.bill ? `${voteItem.bill.type.toLowerCase()}${voteItem.bill.number}-${CONGRESS_NUM}` : null,
        chamber: "House",
        congress: CONGRESS_NUM,
        roll_call_number: voteNumber,
        date: voteItem.actionDate,
        question: voteItem.voteQuestion || "On Passage",
        result: voteItem.result || "Unknown",
        tallies: tallies,
        individual_votes: memberVotes,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      console.log(`Ingested Roll Call Vote #${voteNumber}`);
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
};

// Helper: Sync members for a given state
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