// POST /api/address-suggest  { "text": "<what the visitor has typed so far>" }
// -> { suggestions: [{ label, lat, lon }] } (street addresses with a house number, up to 5)
//
// Address suggestions while typing, from Geoapify (key in GEOAPIFY_KEY, kept server-side).
// POST keeps the text out of URLs and logs; nothing is logged or stored, nothing cached.
// Suggestions near the visitor rank first: Netlify's estimate of where the connection comes
// from (context.geo, about city level, rounded to ~1 km) goes along as a bias, never stored.
// Without a key, or when Geoapify fails, the answer is simply no suggestions: the
// address box works the same without them.

import { json } from '../lib/http.js';
import { geoapifyKey, suggestAddresses } from '../lib/geoapify.js';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export default async (request, context) => {
  if (request.method !== 'POST') return json({ error: 'Use POST with a JSON body { text }.' }, 405, NO_STORE);
  const text = String((await request.json().catch(() => ({}))).text || '').trim();
  // A house number and a few letters of the street before asking; bare ZIPs don't need it.
  if (text.length < 5 || text.length > 200 || !/\d/.test(text) || !/[a-z]{2}/i.test(text) || !geoapifyKey()) {
    return json({ suggestions: [] }, 200, NO_STORE);
  }
  try {
    const near = { lat: Number(context?.geo?.latitude ?? NaN), lon: Number(context?.geo?.longitude ?? NaN) };
    return json({ suggestions: await suggestAddresses(text, { timeoutMs: 8000, near }) }, 200, NO_STORE);
  } catch (err) {
    console.error(`address-suggest: Geoapify failed (HTTP ${err.status || '?'})`);
    return json({ suggestions: [], unavailable: true }, 200, NO_STORE);
  }
};

export const config = { path: '/api/address-suggest' };
