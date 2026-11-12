// POST /api/find-district  { "address": "<one line US address>" }
// (POST so the address stays out of URLs: request logs, CDN keys, browser history)
// -> { state: "WA", district: 7 (0 = at-large / delegate), congress: 119, matched_address }
//
// Uses the U.S. Census Bureau geocoder (free, no key; it sends no CORS headers, so the
// browser can't call it directly). The address is passed through and never logged
// or stored, and responses are not cached by the CDN.
//
// District maps change between Congresses (several states redrew for the 2026
// election), so we ask for the layer of the *current* Congress's districts, trying
// vintages until one has it: today ACS2025 has the 119th, while Current_Current
// already has the 120th, which takes office Jan 3, 2027.

import { getJson, json } from '../lib/http.js';
import { currentCongress, ordinal } from '../lib/congress.js';

const GEOCODER = 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress';
// Newest map last: until Jan 3, 2027 the first one answers (1 request per lookup).
const VINTAGES = ['ACS2025_Current', 'ACS2026_Current', 'Current_Current'];
const CD_LAYER = 54;   // "<nth> Congressional Districts" in each of these vintages
const NO_STORE = { 'Cache-Control': 'private, no-store' };

// State FIPS code -> USPS code (states, DC, territories with a delegate).
const FIPS = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC',
  '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY',
  '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT',
  '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
  '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
  '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY',
  '60': 'AS', '66': 'GU', '69': 'MP', '72': 'PR', '78': 'VI',
};

// One geocoder answer -> { match, cd } for the wanted layer name, or null if the
// vintage doesn't have that Congress's districts.
async function lookup(address, vintage, layerName) {
  const url = `${GEOCODER}?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&vintage=${vintage}&layers=${CD_LAYER}&format=json`;
  const data = await getJson(url, { timeoutMs: 8000, retries: 1 });
  const match = data.result?.addressMatches?.[0];
  if (!match) return { match: null };
  const cd = match.geographies?.[layerName]?.[0];
  return cd ? { match, cd } : null;
}

export default async request => {
  if (request.method !== 'POST') return json({ error: 'Use POST with a JSON body { address }.' }, 405, NO_STORE);
  const address = String((await request.json().catch(() => ({}))).address || '').trim();
  if (address.length < 5 || address.length > 200) {
    return json({ error: 'Enter a street address, city and state (or ZIP code).' }, 400, NO_STORE);
  }
  const { congress } = currentCongress();
  const layerName = `${ordinal(congress)} Congressional Districts`;
  try {
    for (const vintage of VINTAGES) {
      const found = await lookup(address, vintage, layerName);
      if (!found) continue;                       // vintage lacks this Congress's map
      if (!found.match) {
        return json({ error: "We couldn't find that address. Try the full street address with city and state, or add the ZIP code." }, 404, NO_STORE);
      }
      const { match, cd } = found;
      const state = FIPS[cd.STATE];
      if (!state) return json({ error: 'That address is outside the states and territories with a member of Congress.' }, 404, NO_STORE);
      const n = Number(cd.BASENAME);
      return json({
        state,
        district: Number.isFinite(n) ? n : 0,   // "Congressional District (at Large)", "Delegate District (at Large)"
        congress,
        matched_address: match.matchedAddress || null,
        source: 'U.S. Census Bureau Geocoder',
      }, 200, NO_STORE);
    }
    console.error(`find-district: no vintage has ${layerName}`);
    return json({ error: "The Census Bureau's district map for this Congress isn't available right now." }, 502, NO_STORE);
  } catch (err) {
    // err.message has the URL with the address in it; don't log that.
    console.error(`find-district: geocoder request failed (HTTP ${err.status || '?'})`);
    return json({ error: "The Census Bureau's address lookup isn't responding. Please try again in a minute." }, 502, NO_STORE);
  }
};

export const config = { path: '/api/find-district' };
