// Geoapify (OpenStreetMap-based geocoding; key in GEOAPIFY_KEY): address suggestions while
// typing, and a fallback location for addresses the Census geocoder can't match (new
// buildings, typos). Only the typed text goes to Geoapify; nothing is logged or stored here.

import { getJson } from './http.js';

const BASE = 'https://api.geoapify.com/v1/geocode';
// The states, DC and the territories with a delegate.
const COUNTRIES = 'countrycode:us,pr,gu,vi,as,mp';

export const geoapifyKey = () => process.env.GEOAPIFY_KEY || '';

function url(kind, text, extra = '') {
  return `${BASE}/${kind}?text=${encodeURIComponent(text)}&filter=${COUNTRIES}&format=json&lang=en${extra}&apiKey=${encodeURIComponent(geoapifyKey())}`;
}

// "400 Broad Street, Seattle, WA 98109" (no building names: the Census geocoder reads this form).
export function label(r) {
  const place = [r.city || r.town || r.village || r.county, [r.state_code, r.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  if (r.housenumber && r.street) return `${r.housenumber} ${r.street}, ${place}`;
  return [r.address_line1, r.address_line2].filter(Boolean).join(', ').replace(/, (United States of America|United States)$/, '') || r.formatted;
}

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Does Geoapify's result agree with where the visitor said the address is? Its ZIP, or its
// city plus its state (code in capitals or the state's name). A partial address like
// "1600 Pennsylvania" otherwise "matches" a house in some other state.
export function agrees(r, text) {
  const typed = norm(text);
  const zip = String(text).match(/\b(\d{5})(?:-\d{4})?\b/)?.[1];
  if (zip && r.postcode && String(r.postcode).slice(0, 5) === zip) return true;
  const city = norm(r.city || r.town || r.village);
  const cityTyped = city && ` ${typed} `.includes(` ${city} `);
  const stateTyped = (r.state_code && new RegExp(`\\b${r.state_code}\\b`).test(String(text)))
    || (r.state && ` ${typed} `.includes(` ${norm(r.state)} `));
  return Boolean(cityTyped && stateTyped);
}

// Typed text -> up to 5 { label, lat, lon }: addresses with a house number only (a street
// or town can span districts; a bare ZIP is looked up directly).
// near: { lat, lon } to rank nearby addresses first (else Geoapify ranks near the caller:
// our server, not the visitor).
export async function suggestAddresses(text, { timeoutMs = 3000, near = null } = {}) {
  const bias = near && Number.isFinite(near.lat) && Number.isFinite(near.lon)
    ? `&bias=proximity:${near.lon.toFixed(2)},${near.lat.toFixed(2)}` : '&bias=countrycode:us';
  const data = await getJson(url('autocomplete', text, `&limit=5${bias}`), { timeoutMs, retries: 0 });
  const seen = new Set();
  return (data.results || []).map(r => ({
    label: label(r),
    lat: r.lat,
    lon: r.lon,
    house: Boolean(r.housenumber && r.street),
  })).filter(s => s.house && s.label && Number.isFinite(s.lat) && Number.isFinite(s.lon) && !seen.has(s.label) && seen.add(s.label))
    .map(({ label, lat, lon }) => ({ label, lat, lon }));
}

// A full address -> { lat, lon, label } only when Geoapify found that building (a house
// number match with good confidence, in the ZIP or city + state typed): a street or town
// alone can span districts.
export async function locateAddress(text, { timeoutMs = 3000 } = {}) {
  const data = await getJson(url('search', text, '&limit=1'), { timeoutMs, retries: 0 });
  const r = data.results?.[0];
  if (!r || !r.housenumber || !['building', 'amenity'].includes(r.result_type)) return null;
  if ((r.rank?.confidence ?? 0) < 0.8 || !agrees(r, text)) return null;
  return { lat: r.lat, lon: r.lon, label: label(r) };
}
