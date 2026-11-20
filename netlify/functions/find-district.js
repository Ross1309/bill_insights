// POST /api/find-district  { "address": "<one line US address or ZIP>", lat?, lon? }
// (POST so the address stays out of URLs: request logs, CDN keys, browser history)
// -> { state, district (0 = at-large / delegate; null = not known), congress, how, ... }
//    how: "address"  the Census geocoder matched the street address
//         "location" Geoapify found the building (or the visitor picked a suggestion) and
//                    the Census Bureau's map gave the district for that point
//         "zip"      from the ZIP code alone: `districts` [{ state, district, share }] lists
//                    every district the ZIP area reaches (share = % of its land); district is
//                    set only when there's exactly one
//         "state"    only the state was found (e.g. "Seattle, WA"): senators known; the House
//                    district only in states with one seat
//
// Steps, cheapest and most exact first, all within the function's 10 s:
// 1. A bare ZIP -> the Census ZIP-area tables (netlify/lib/zip-districts.js), no request.
// 2. The Census geocoder on the text (again without apartment/suite numbers, which it
//    often can't match).
// 3. If a suggestion was picked: its coordinates -> the Census map. Otherwise Geoapify's
//    location for the text, if it found that building in the ZIP / city the visitor typed.
// 4. The ZIP in the text, if any.
// The address is never logged or stored, and responses are not cached.
//
// District maps change between Congresses (several states redrew for the 2026
// election), so we ask for the layer of the *current* Congress's districts, trying
// vintages until one has it: today ACS2025 has the 119th, while Current_Current
// already has the 120th, which takes office Jan 3, 2027.

import { getJson, json } from '../lib/http.js';
import { currentCongress, ordinal } from '../lib/congress.js';
import { geoapifyKey, locateAddress } from '../lib/geoapify.js';
import { isZipOnly, stateAtEnd, stateDistricts, withoutUnit, zipDistricts, zipIn } from '../lib/zip-districts.js';

const CENSUS = 'https://geocoding.geo.census.gov/geocoder/geographies';
// Newest map last: until Jan 3, 2027 the first one answers (1 request per lookup).
const VINTAGES = ['ACS2025_Current', 'ACS2026_Current', 'Current_Current'];
const CD_LAYER = 54;   // "<nth> Congressional Districts" in each of these vintages
const NO_STORE = { 'Cache-Control': 'private, no-store' };
const BUDGET_MS = 8500;

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

// One Census answer for the current Congress's layer: { cd, matched } | { cd: null } (no
// match) | null (this vintage lacks that Congress's map: try the next).
async function census(kind, params, layerName, deadline) {
  for (const vintage of VINTAGES) {
    const timeoutMs = Math.min(3000, deadline - Date.now());
    if (timeoutMs < 500) throw Object.assign(new Error('out of time'), { status: 0 });
    const url = `${CENSUS}/${kind}?${params}&benchmark=Public_AR_Current&vintage=${vintage}&layers=${CD_LAYER}&format=json`;
    const data = await getJson(url, { timeoutMs, retries: 0 });
    if (kind === 'onelineaddress') {
      const match = data.result?.addressMatches?.[0];
      if (!match) return { cd: null };
      const cd = match.geographies?.[layerName]?.[0];
      if (cd) return { cd, matched: match.matchedAddress || null };
    } else {
      const geo = data.result?.geographies;
      if (!geo) return { cd: null };
      const cd = geo[layerName]?.[0];
      if (cd) return { cd, matched: null };
    }
  }
  return null;
}

const fromCd = cd => {
  const n = Number(cd.BASENAME);
  // "Congressional District (at Large)", "Delegate District (at Large)" -> 0
  return { state: FIPS[cd.STATE] || null, district: Number.isFinite(n) ? n : 0 };
};

// A Census call that may fail: { ok: result } or { failed: true } (logged without the address).
async function tryCensus(...args) {
  try { return { ok: await census(...args) }; } catch (err) {
    console.error(`find-district: Census geocoder failed (HTTP ${err.status || '?'})`);
    return { failed: true };
  }
}

function zipAnswer(zip, congress, extra = {}) {
  const found = zipDistricts(zip, congress);
  if (!found) return null;
  const { districts, exact } = found;
  const one = districts.length === 1 ? districts[0] : null;
  return {
    state: one?.state || found.state || districts[0]?.state,
    district: one ? one.district : null,
    districts,
    zip,
    zip_exact: exact,     // false: a ZIP with no area of its own (PO boxes), judged by its neighbors
    congress,
    how: 'zip',
    source: 'U.S. Census Bureau ZIP code areas and district maps',
    ...extra,
  };
}

export default async request => {
  if (request.method !== 'POST') return json({ error: 'Use POST with a JSON body { address }.' }, 405, NO_STORE);
  const body = await request.json().catch(() => ({}));
  const address = String(body.address || '').trim();
  if (address.length < 5 || address.length > 200) {
    return json({ error: 'Enter a street address with city and state, or a ZIP code.' }, 400, NO_STORE);
  }
  const lat = Number(body.lat), lon = Number(body.lon);
  const picked = body.lat != null && body.lon != null && Number.isFinite(lat) && Number.isFinite(lon)
    && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const { congress } = currentCongress();
  const layerName = `${ordinal(congress)} Congressional Districts`;
  const deadline = Date.now() + BUDGET_MS;
  const outside = () => json({ error: 'That address is outside the states and territories with a member of Congress.' }, 404, NO_STORE);

  // 1. Just a ZIP code.
  if (isZipOnly(address)) {
    const answer = zipAnswer(zipIn(address), congress);
    return answer ? json(answer, 200, NO_STORE)
      : json({ error: "We don't have that ZIP code. Check it, or enter your street address, city and state." }, 404, NO_STORE);
  }

  // 2. The Census geocoder on the text, then without an apartment or suite number.
  let censusDown = false;
  const variants = [...new Set([address, withoutUnit(address)])].filter(a => a.length >= 5);
  for (const text of variants) {
    const r = await tryCensus('onelineaddress', `address=${encodeURIComponent(text)}`, layerName, deadline);
    if (r.failed) { censusDown = true; break; }
    if (r.ok === null) {
      console.error(`find-district: no vintage has ${layerName}`);
      censusDown = true; break;
    }
    if (r.ok.cd) {
      const { state, district } = fromCd(r.ok.cd);
      if (!state) return outside();
      return json({ state, district, congress, how: 'address', matched_address: r.ok.matched, source: 'U.S. Census Bureau Geocoder' }, 200, NO_STORE);
    }
  }

  // 3. A location: the picked suggestion's, or Geoapify's for the typed text.
  let point = picked ? { lat, lon, label: address } : null;
  if (!point && !censusDown && geoapifyKey() && deadline - Date.now() > 2500) {
    try {
      point = await locateAddress(address, { timeoutMs: Math.min(3000, deadline - Date.now() - 1500) });
    } catch (err) {
      console.error(`find-district: Geoapify failed (HTTP ${err.status || '?'})`);
    }
  }
  if (point && !censusDown) {
    const r = await tryCensus('coordinates', `x=${point.lon}&y=${point.lat}`, layerName, deadline);
    if (r.ok?.cd) {
      const { state, district } = fromCd(r.ok.cd);
      if (!state) return outside();
      return json({ state, district, congress, how: 'location', matched_address: point.label, source: 'Geoapify (OpenStreetMap) location, U.S. Census Bureau district map' }, 200, NO_STORE);
    }
    if (r.failed) censusDown = true;
  }

  // 4. The ZIP code in the text.
  const zip = zipIn(address);
  const answer = zip && zipAnswer(zip, congress, { address_not_found: !censusDown, census_unavailable: censusDown });
  if (answer) return json(answer, 200, NO_STORE);
  const state = !zip && stateAtEnd(address);
  const inState = state && stateDistricts(state, congress);
  if (inState) {
    const one = inState.districts.length === 1 ? inState.districts[0] : null;
    return json({ state, district: one ? one.district : null, districts: inState.districts, congress, how: 'state',
      address_not_found: !censusDown, census_unavailable: censusDown, source: 'U.S. Census Bureau district maps' }, 200, NO_STORE);
  }

  if (censusDown) {
    return json({ error: "The Census Bureau's address lookup isn't responding. Please try again in a minute, or enter just your ZIP code." }, 502, NO_STORE);
  }
  return json({ error: "We couldn't find that address. Check the street and city, pick one of the suggestions, or enter just your ZIP code." }, 404, NO_STORE);
};

export const config = { path: '/api/find-district' };
