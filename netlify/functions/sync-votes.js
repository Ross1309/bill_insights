import admin from 'firebase-admin';

// Initialize Firebase Admin SDK using service account environment variable
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

export const handler = async (event, context) => {
  const CONGRESS_API_KEY = process.env.CONGRESS_API_KEY;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  if (!CONGRESS_API_KEY || !OPENAI_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Missing required API keys in environment variables." })
    };
  }

  try {
    console.log("Starting Congressional Vote Sync...");

    // 1. Fetch recent House & Senate roll call votes (limit 15 for execution speed)
    const congressRes = await fetch(
      `https://api.congress.gov/v3/house-vote?api_key=${CONGRESS_API_KEY}&limit=15`
    );
    
    if (!congressRes.ok) {
      throw new Error(`Congress API returned status ${congressRes.status}`);
    }

    const voteData = await congressRes.json();
    const votes = voteData.houseVotes || voteData.votes || [];

    let processedCount = 0;

    // Standardized Policy Area Mapping to our 3 core pillars
    const policyMap = {
      'Health': 'Healthcare',
      'Economics and Public Finance': 'Economy',
      'Taxation': 'Economy',
      'Finance and Financial Sector': 'Economy',
      'International Affairs': 'Foreign Affairs',
      'Foreign Trade and International Finance': 'Foreign Affairs'
    };

    for (const vote of votes) {
      if (!vote.bill || !vote.bill.number) continue;

      const congress = vote.congress || 119;
      const billType = vote.bill.type.toLowerCase();
      const billNumber = vote.bill.number;
      const billId = `${billType}${billNumber}-${congress}`;

      // Check Firestore first to save OpenAI API costs and prevent execution timeout
      const billRef = db.collection('bills').doc(billId);
      const billSnap = await billRef.get();
      if (billSnap.exists) {
        console.log(`Skipping ${billId} - already in database.`);
        continue;
      }

      // 2. Fetch specific Bill details for policy category & official summary
      const billDetailRes = await fetch(
        `https://api.congress.gov/v3/bill/${congress}/${billType}/${billNumber}?api_key=${CONGRESS_API_KEY}`
      );
      
      if (!billDetailRes.ok) continue;

      const billDetailData = await billDetailRes.json();
      const billInfo = billDetailData.bill || {};
      const rawPolicy = billInfo.policyArea?.name || '';
      const mappedCategory = policyMap[rawPolicy];

      // Skip any bill not strictly categorized as Healthcare, Economy, or Foreign Affairs
      if (!mappedCategory) {
        console.log(`Skipping ${billId} - Policy area '${rawPolicy}' outside scope.`);
        continue;
      }

      const billTitle = billInfo.title || vote.bill.title || `Bill ${billId.toUpperCase()}`;
      const officialSummary = billInfo.summary?.text || billTitle;

      // 3. Generate Non-Partisan 3-Bullet AI Summary via OpenAI
      console.log(`Generating AI summary for ${billId}...`);
      const aiPrompt = `Summarize the direct practical impacts of this bill on everyday American citizens in exactly 3 bullet points. 
Focus strictly on economic, healthcare, or foreign policy realities. Avoid all political spin, framing, or partisan commentary.

Bill Title: ${billTitle}
Official Text/Summary: ${officialSummary}`;

      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: aiPrompt }],
          temperature: 0.2
        })
      });

      const aiData = await openaiRes.json();
      const rawAiText = aiData.choices?.[0]?.message?.content || "";
      const bulletPoints = rawAiText
        .split('\n')
        .map(line => line.replace(/^[\s•*-]+/, '').trim())
        .filter(line => line.length > 0)
        .slice(0, 3);

      // 4. Write Bill Document to Firestore
      await billRef.set({
        bill_id: billId,
        congress: congress,
        bill_number: `${billType.toUpperCase()} ${billNumber}`,
        title: billTitle,
        category: mappedCategory,
        chamber: vote.chamber || 'House',
        date_voted: vote.date || new Date().toISOString().split('T')[0],
        outcome: vote.result || 'Passed',
        vote_counts: {
          yea: vote.yeaCount || 0,
          nay: vote.nayCount || 0
        },
        ai_summary: {
          bullet_points: bulletPoints,
          generated_at: new Date().toISOString()
        }
      });

      // 5. Write Roll Call Member Position Document to Firestore
      if (vote.memberVotes) {
        const positionsMap = {};
        vote.memberVotes.forEach(mv => {
          if (mv.bioguideId) {
            positionsMap[mv.bioguideId] = mv.voteCast; // e.g. "YEA", "NAY", "NOT VOTING"
          }
        });

        await db.collection('votes').doc(billId).set({
          bill_id: billId,
          chamber: vote.chamber || 'House',
          positions: positionsMap
        });
      }

      processedCount++;
      console.log(`Successfully ingested and summarized ${billId}`);
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Sync complete.",
        new_bills_processed: processedCount
      })
    };

  } catch (err) {
    console.error("Error running vote sync function:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};