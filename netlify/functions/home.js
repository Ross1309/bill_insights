// GET /api/home -> the four small stats docs Home is built from (overview, health, floor
// schedule, participation), read with server credentials and cached at the CDN. The page
// can then show Home without loading Firebase or App Check's reCAPTCHA (~600 KB of script);
// those load only when a visitor opens something that reads Firestore directly. If this
// fails, the page reads the same docs from Firestore (public/data.js getHome).

import { getDb } from '../lib/firebase.js';
import { json } from '../lib/http.js';

// Docs change nightly (and when an owner runs a script): 5 minutes at the CDN, served stale
// for up to an hour while it refreshes, 1 minute in browsers.
// Query strings are left out of the cache key (Netlify-Vary on a parameter nobody sends), so
// /api/home?x=1 can't force a fresh function run and Firestore reads.
const CACHE = { 'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=300, stale-while-revalidate=3600', 'Cache-Control': 'public, max-age=60', 'Netlify-Vary': 'query=cw-no-param' };
const DOCS = ['overview', 'health', 'floor', 'participation'];

// Firestore Timestamps -> ISO strings (JSON has no timestamp type).
export function plain(value) {
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  return value;
}

export default async () => {
  try {
    const db = getDb();
    const snaps = await db.getAll(...DOCS.map(id => db.collection('stats').doc(id)));
    const body = Object.fromEntries(DOCS.map((id, i) => [id, snaps[i].exists ? plain(snaps[i].data()) : null]));
    if (!body.overview) return json({ error: 'Home data not built yet.' }, 404, { 'Cache-Control': 'no-store' });
    return json(body, 200, CACHE);
  } catch (err) {
    console.error('home: read failed', err.message);
    return json({ error: 'Home data unavailable right now.' }, 502, { 'Cache-Control': 'no-store' });
  }
};

export const config = { path: '/api/home' };
