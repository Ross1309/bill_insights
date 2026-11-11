// GET /.netlify/functions/member-profile?id={bioguideId}
//
// Server-side proxy to Congress.gov for a member's profile and their most recent
// sponsored legislation (the API key can't be exposed to the browser). Returns
// only fields taken from the source; anything missing is null.

import { congressGovUrl, makeBillId, stripHtml } from '../lib/bills.js';
import { getJson, json } from '../lib/http.js';
import { ordinal } from '../lib/congress.js';

const API = 'https://api.congress.gov/v3';
const SPONSORED_LIMIT = 10;
const CHAMBERS = { 'House of Representatives': 'House', Senate: 'Senate' };

const AMENDMENT_TYPES = { samdt: ['S.Amdt.', 'senate-amendment'], hamdt: ['H.Amdt.', 'house-amendment'], suamdt: ['S.UP.Amdt.', 'senate-amendment'] };

function shapeSponsored(item) {
  // Amendments come back without type/number; their kind is only in the API url
  // (e.g. .../amendment/119/samdt/6783).
  if (!item.type || !item.number) {
    const m = /\/amendment\/(\d+)\/([a-z]+)\/(\d+)/.exec(item.url || '');
    const kind = m && AMENDMENT_TYPES[m[2]];
    return {
      kind: 'amendment',
      label: kind ? `${kind[0]} ${m[3]}` : `Amendment ${item.amendmentNumber || ''}`.trim(),
      title: item.title || null,
      introducedDate: item.introducedDate || null,
      latestAction: item.latestAction
        ? { actionDate: item.latestAction.actionDate || null, text: item.latestAction.text || null }
        : null,
      policyArea: null,
      bill_id: null,
      url: kind ? `https://www.congress.gov/amendment/${ordinal(Number(m[1]))}-congress/${kind[1]}/${m[3]}` : null,
    };
  }
  const type = String(item.type).toUpperCase();
  return {
    kind: 'bill',
    label: `${type} ${item.number}`,
    title: item.title || null,
    introducedDate: item.introducedDate || null,
    latestAction: item.latestAction
      ? { actionDate: item.latestAction.actionDate || null, text: item.latestAction.text || null }
      : null,
    policyArea: item.policyArea?.name || null,
    bill_id: makeBillId(type, item.number, item.congress),
    url: congressGovUrl(Number(item.congress), type, item.number),
  };
}

export default async (req) => {
  const apiKey = process.env.CONGRESS_API_KEY;
  if (!apiKey) return json({ error: 'Missing CONGRESS_API_KEY.' }, 500);

  const id = new URL(req.url).searchParams.get('id') || '';
  if (!/^[A-Z]\d{6}$/.test(id)) return json({ error: 'Invalid bioguide id.' }, 400);

  try {
    const [detail, sponsored] = await Promise.all([
      getJson(`${API}/member/${id}?api_key=${apiKey}&format=json`),
      getJson(`${API}/member/${id}/sponsored-legislation?api_key=${apiKey}&format=json&limit=${SPONSORED_LIMIT}`)
        .catch(err => { console.error(`Sponsored fetch failed for ${id}: ${err.message}`); return null; }),
    ]);

    const m = detail.member || {};
    const terms = [...(m.terms || [])].sort((a, b) => (a.startYear || 0) - (b.startYear || 0));
    const current = terms.at(-1) || null;
    const address = m.addressInformation || {};

    return json({
      bioguideId: id,
      name: m.directOrderName || null,
      birthYear: m.birthYear || null,
      party: m.partyHistory?.at(-1)?.partyName || null,
      currentMember: m.currentMember ?? null,
      firstTermStart: terms[0]?.startYear || null,
      currentTerm: current
        ? {
            chamber: CHAMBERS[current.chamber] || current.chamber || null,
            memberType: current.memberType || null,
            congress: current.congress || null,
            startYear: current.startYear || null,
            stateCode: current.stateCode || null,
            district: current.district ?? null,
          }
        : null,
      leadership: (m.leadership || []).filter(l => l.current).map(l => l.type).filter(Boolean),
      website: m.officialWebsiteUrl || null,
      office: {
        address: address.officeAddress ? address.officeAddress.replace(/\s+/g, ' ').trim() : null,
        phone: address.phoneNumber || null,
      },
      imageUrl: m.depiction?.imageUrl || null,
      imageAttribution: m.depiction?.attribution ? stripHtml(m.depiction.attribution) : null,
      sponsoredCount: m.sponsoredLegislation?.count ?? null,
      cosponsoredCount: m.cosponsoredLegislation?.count ?? null,
      sponsored: sponsored ? (sponsored.sponsoredLegislation || []).map(shapeSponsored) : null,
      bioguideUrl: `https://bioguide.congress.gov/search/bio/${id}`,
    }, 200, { 'Cache-Control': 'public, max-age=3600', 'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=21600, stale-while-revalidate=86400' });
  } catch (err) {
    console.error(`member-profile ${id}:`, err);
    if (err.status === 404) return json({ error: 'Member not found.' }, 404, { 'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=3600' });
    return json({ error: 'Could not load member profile.' }, 502);
  }
};

// Public, unauthenticated, and each call spends Congress.gov quota: cache answers on
// Netlify's CDN (durable, shared across edge nodes; the ?id= query is part of the
// cache key) and rate-limit per visitor. Rate-limited functions need an explicit
// path, so this function is served at /api/member-profile (not /.netlify/functions/…).
export const config = {
  path: '/api/member-profile',
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
