import admin from 'firebase-admin';

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

export default async (req, context) => {
  const CONGRESS_API_KEY = process.env.CONGRESS_API_KEY;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  if (!CONGRESS_API_KEY || !OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: "Missing API keys." }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    console.log("Starting vote sync batch...");

    // Increased limit to 15 to ensure we capture valid policy areas
    const congressRes = await fetch(
      `https://api.congress.gov/v3/house-vote?api_key=${CONGRESS_API_KEY}&limit=15`
    );
    
    if (!congressRes.ok) {
      throw new Error(`Congress API error: ${congressRes.status}`);
    }

    const voteData = await congressRes.json();
    const votes = voteData.houseVotes || voteData.votes || [];

    let processedCount = 0;

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

      const billRef = db.collection('bills').doc(billId);
      const billSnap = await billRef.get();
      if (billSnap.exists) {
        continue; // Skip if already cached
      }

      const billDetailRes = await fetch(
        `https://api.congress.gov/v3/bill/${congress}/${billType}/${billNumber}?api_key=${CONGRESS_API_KEY}`
      );
      
      let mappedCategory = 'Economy'; // Default fallback so nothing gets dropped
      let billTitle = vote.bill.title || `Bill ${billId.toUpperCase()}`;

      if (billDetailRes.ok) {
        const billDetailData = await billDetailRes.json();
        const billInfo = billDetailData.bill || {};
        const rawPolicy = billInfo.policyArea?.name || '';
        if (rawPolicy && policyMap[rawPolicy]) {
          mappedCategory = policyMap[rawPolicy];
        }
        if (billInfo.title) {
          billTitle = billInfo.title;
        }
      }

      // Fast AI summary generation
      const aiPrompt = `Summarize the direct practical impacts of this bill on everyday American citizens in exactly 3 short bullet points. Avoid political spin.\n\nTitle: ${billTitle}`;

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
          bullet_points: bulletPoints.length ? bulletPoints : ["Impact summary processing."],
          generated_at: new Date().toISOString()
        }
      });

      processedCount++;
      
      // Stop after successfully processing 3 new bills to keep well clear of timeouts
      if (processedCount >= 3) break;
    }

    return new Response(JSON.stringify({ 
      success: true, 
      message: `Batch sync complete. Processed ${processedCount} new bills.` 
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("Sync error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};