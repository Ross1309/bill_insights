// ZIP code -> congressional district(s), from the Census tables built by
// scripts/build-zip-districts.js (ZIP Code Tabulation Areas x the Congress's district map).

import zips119 from './zip-districts-119.js';
import zips120 from './zip-districts-120.js';
import { STATE_CODES } from '../../public/states.js';

const TABLES = { 119: zips119, 120: zips120 };

// Territories with no ZCTAs in the 2020 tables: each is one delegate district.
const TERRITORY_PREFIXES = [[/^008/, 'VI'], [/^9691/, 'GU'], [/^9692/, 'GU'], [/^9693/, 'GU'], [/^9695/, 'MP'], [/^96799$/, 'AS']];

// "98109", "98109-4607" or text ending in a ZIP -> "98109" (null if none).
export function zipIn(text) {
  const m = String(text).match(/\b(\d{5})(?:-\d{4})?\s*(?:,?\s*(?:USA|US|United States))?\s*$/i);
  return m ? m[1] : null;
}
export function isZipOnly(text) {
  return /^\s*\d{5}(?:-\d{4})?\s*$/.test(String(text));
}

// "Apt 4B", "Unit 12", "Suite 300", "#5", "Floor 2" (not "Fl": Florida): the Census geocoder matches buildings and
// often rejects an address with one of these.
const UNIT = /(?:,\s*|\s+)(?:(?:apt|apartment|unit|ste|suite|floor|rm|room|bldg|lot|trlr)\b\.?\s*#?\s*|#\s*)(?!\d{5}\b)[a-z0-9-]+(?=[\s,]|$)/gi;
export const withoutUnit = address => address.replace(UNIT, '').replace(/\s{2,}/g, ' ').trim();

const parse = code => ({ state: code.slice(0, 2), district: Number(code.slice(2)) });

// -> { districts: [{ state, district, share }] (largest land share first), exact: true }
//    | { districts: [one], exact: false } (a ZIP with no area, e.g. PO boxes, whose neighbors
//      (same first three digits) all lie in one district)
//    | { state, districts: [], exact: false } (those neighbors are all in one state) | null
export function zipDistricts(zip, congress) {
  const table = TABLES[congress];
  if (!table || !/^\d{5}$/.test(zip)) return null;
  const territory = TERRITORY_PREFIXES.find(([re]) => re.test(zip));
  if (territory) return { districts: [{ state: territory[1], district: 0, share: 100 }], exact: true };
  const entry = table.zips[zip];
  if (entry) {
    const districts = entry.split(',').map(part => {
      const [code, share] = part.split(':');
      return { ...parse(code), share: share ? Number(share) : 100 };
    });
    return { districts, exact: true };
  }
  // Not a ZIP area (PO boxes, single buildings): judge by the ZIP areas sharing its first three digits.
  const codes = new Set();
  for (const [z, v] of Object.entries(table.zips)) {
    if (z.startsWith(zip.slice(0, 3))) v.split(',').forEach(p => codes.add(p.split(':')[0]));
  }
  const states = new Set([...codes].map(c => c.slice(0, 2)));
  if (states.size !== 1) return null;
  // One district for all of them (at-large states): that's the answer, just less certain.
  if (codes.size === 1) return { districts: [{ ...parse([...codes][0]), share: 100 }], exact: false };
  return { state: [...states][0], districts: [], exact: false };
}

// The state named at the end of the text ("Seattle, WA", "Cheyenne Wyoming"), or null.
// Codes count only in capitals: "or", "in" and "me" are words too.
export function stateAtEnd(text) {
  const t = String(text).trim().replace(/[.,\s]+$/, '').replace(/,?\s*(USA|US|United States)$/i, '')
    .replace(/(^|[\s,])D\.\s?C$/i, '$1DC');
  const code = t.match(/(?:^|[\s,])([A-Z]{2})$/)?.[1];
  if (code && Object.values(STATE_CODES).includes(code)) return code;
  const lower = t.toLowerCase();
  const name = Object.keys(STATE_CODES).sort((a, b) => b.length - a.length)
    .find(n => lower === n.toLowerCase() || lower.endsWith(` ${n.toLowerCase()}`) || lower.endsWith(`,${n.toLowerCase()}`));
  return name ? STATE_CODES[name] : null;
}

// A state alone: its single district if it has one seat (at-large states, DC, territories),
// else just the state (senators known, House member not).
export function stateDistricts(state, congress) {
  const table = TABLES[congress];
  if (!table) return null;
  const codes = new Set();
  for (const v of Object.values(table.zips)) {
    for (const p of v.split(',')) if (p.startsWith(state)) codes.add(p.split(':')[0]);
  }
  if (codes.size === 1) return { districts: [{ ...parse([...codes][0]), share: 100 }] };
  if (!codes.size && ['VI', 'GU', 'MP', 'AS'].includes(state)) return { districts: [{ state, district: 0, share: 100 }] };
  return { state, districts: [] };
}
