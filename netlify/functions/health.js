// GET /api/health -> the stats/health doc (latest run of each nightly sync), read with
// server credentials. scripts/check-health.js (the daily GitHub check) uses this rather
// than Firestore's public REST API, which App Check enforcement blocks for anything that
// isn't the website itself. Cached 5 minutes at the CDN, so callers can't drive reads.

import { getDb } from '../lib/firebase.js';
import { json } from '../lib/http.js';

const CACHE = { 'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=300', 'Cache-Control': 'public, max-age=60' };

export default async () => {
  try {
    const snap = await getDb().collection('stats').doc('health').get();
    if (!snap.exists) return json({ error: 'No run recorded yet.' }, 404, CACHE);
    return json(snap.data(), 200, CACHE);
  } catch (err) {
    console.error('health: read failed', err.message);
    return json({ error: 'Health record unavailable right now.' }, 502, { 'Cache-Control': 'no-store' });
  }
};

export const config = { path: '/api/health' };
