// GET /api/bill-parts?id={bill_id}&v={version}&from={first version}   e.g. id=hr4366-118&v=enr&from=ih
//
// "What's in this bill": the structure of one official text version (parts, headings, sizes;
// netlify/lib/bill-parts.js). `v` and `from` are version codes from bill-detail's
// textVersions; `from` (the earliest version) adds its size and official title, so a bill
// whose number was reused for a different, larger text shows that plainly.
//
// Reads the bill XML from GovInfo (public, no key, so this spends no Congress.gov quota),
// falling back to the same file on Congress.gov. A published version never changes, so
// answers are cached on the CDN for a week.

import { congressGovUrl, parseBillId } from '../lib/bills.js';
import { billParts } from '../lib/bill-parts.js';
import { getText, json } from '../lib/http.js';

const CODE = /^[a-z]{1,6}$/;
const MAX_BYTES = 25_000_000;
const VARY = { 'Netlify-Vary': 'query=id|v|from' };

function sources(ids, code) {
  const stem = `BILLS-${ids.congress}${ids.type.toLowerCase()}${ids.number}${code}`;
  return {
    stem,
    urls: [
      `https://www.govinfo.gov/content/pkg/${stem}/xml/${stem}.xml`,
      `https://www.congress.gov/${ids.congress}/bills/${ids.type.toLowerCase()}${ids.number}/${stem}.xml`,
    ],
  };
}

async function readVersion(ids, code, deadline) {
  const { stem, urls } = sources(ids, code);
  let lastErr;
  for (const url of urls) {
    const timeoutMs = Math.min(6000, deadline - Date.now());
    if (timeoutMs < 500) break;
    try {
      const xml = await getText(url, { timeoutMs, retries: 0 });
      if (xml.length > MAX_BYTES) throw Object.assign(new Error('too large'), { status: 413 });
      if (!/<(legis-body|resolution-body|engrossed-amendment-body)\b/.test(xml)) throw Object.assign(new Error('not bill XML'), { status: 422 });
      return { ...billParts(xml), file: stem, source_url: url };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('timed out');
}

export default async (req) => {
  const params = new URL(req.url).searchParams;
  const billId = params.get('id') || '';
  const v = params.get('v') || '';
  const from = params.get('from') || '';
  const ids = parseBillId(billId);
  if (!ids || !congressGovUrl(ids.congress, ids.type, ids.number) || !CODE.test(v) || (from && !CODE.test(from))) {
    return json({ error: 'Invalid bill id or version.' }, 400);
  }
  const deadline = Date.now() + 8500;
  try {
    const [current, first] = await Promise.all([
      readVersion(ids, v, deadline),
      from && from !== v ? readVersion(ids, from, deadline).catch(() => null) : null,
    ]);
    return json({
      id: billId,
      version: v,
      words: current.words,
      sections: current.sections,
      official_title: current.official_title,
      parts: current.parts,
      items: current.items,
      source_url: current.source_url,
      first: first ? { version: from, words: first.words, sections: first.sections, official_title: first.official_title } : null,
    }, 200, { 'Cache-Control': 'public, max-age=86400', ...VARY, 'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=604800, stale-while-revalidate=86400' });
  } catch (err) {
    console.error(`bill-parts ${billId} ${v}: ${err.status ? `HTTP ${err.status}` : err.message}`);
    if (err.status === 404) return json({ error: "This version's text isn't published yet." }, 404, { ...VARY, 'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=3600' });
    return json({ error: "Couldn't read the bill's text right now." }, 502);
  }
};

// Public and unauthenticated like bill-detail, but it spends no API quota: GovInfo files
// only, cached for a week per id + version. (The plan's two rate-limit rules are in use.)
export const config = { path: '/api/bill-parts' };
