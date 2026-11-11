// GET /.netlify/functions/bill-detail?id={bill_id}   e.g. id=hr9612-119
//
// Server-side proxy to Congress.gov for a bill's sponsor, cosponsor count, latest
// official CRS summary and action history. Works for bills that aren't in our
// `bills` collection too (votes often reference those). Only sourced fields;
// anything missing is null.

import { billMetadata, congressGovUrl, parseBillId, stripHtml } from '../lib/bills.js';
import { getJson, json } from '../lib/http.js';

const API = 'https://api.congress.gov/v3';
const ACTIONS_LIMIT = 100;

function shapeActions(list) {
  const seen = new Set();
  const out = [];
  for (const a of list) {
    const text = (a.text || '').trim();
    const key = `${a.actionDate}|${text}`;
    if (!text || seen.has(key)) continue; // same action reported by two source systems
    seen.add(key);
    out.push({
      actionDate: a.actionDate || null,
      actionTime: a.actionTime || null,
      text,
      type: a.type || null,
      source: a.sourceSystem?.name || null,
      // Lets the UI link an action to our vote doc: {congress}-{session}-house-vote-{roll}
      recordedVotes: (a.recordedVotes || []).map(v => ({
        chamber: v.chamber || null,
        congress: v.congress || null,
        session: v.sessionNumber || null,
        rollNumber: v.rollNumber || null,
        url: v.url || null,
      })),
    });
  }
  return out;
}

export default async (req) => {
  const apiKey = process.env.CONGRESS_API_KEY;
  if (!apiKey) return json({ error: 'Missing CONGRESS_API_KEY.' }, 500);

  const billId = new URL(req.url).searchParams.get('id') || '';
  const ids = parseBillId(billId);
  if (!ids || !congressGovUrl(ids.congress, ids.type, ids.number)) {
    return json({ error: 'Invalid bill id.' }, 400);
  }
  const base = `${API}/bill/${ids.congress}/${ids.type.toLowerCase()}/${ids.number}`;
  const q = `api_key=${apiKey}&format=json`;

  try {
    const [detailRes, actionsRes, summariesRes] = await Promise.all([
      getJson(`${base}?${q}`),
      getJson(`${base}/actions?${q}&limit=${ACTIONS_LIMIT}`).catch(err => {
        console.error(`Actions fetch failed for ${billId}: ${err.message}`);
        return null;
      }),
      getJson(`${base}/summaries?${q}`).catch(err => {
        console.error(`Summaries fetch failed for ${billId}: ${err.message}`);
        return null;
      }),
    ]);

    const detail = detailRes.bill || {};
    const meta = billMetadata(detail, ids);
    const sponsor = detail.sponsors?.[0] || null;

    let crsSummary = null;
    const summaries = summariesRes?.summaries || [];
    if (summaries.length) {
      const latest = summaries.reduce((a, b) => ((a.updateDate || '') >= (b.updateDate || '') ? a : b));
      const text = stripHtml(latest.text || '');
      if (text) {
        crsSummary = {
          text,
          version: latest.actionDesc || null,
          actionDate: latest.actionDate || null,
        };
      }
    }

    return json({
      ...meta,
      sponsor: sponsor
        ? {
            bioguideId: sponsor.bioguideId || null,
            name: [sponsor.lastName, sponsor.firstName].filter(Boolean).join(', ') || null,
            label: sponsor.fullName || null,
            party: sponsor.party || null,
            state: sponsor.state || null,
            district: sponsor.district ?? null,
          }
        : null,
      cosponsorsCount: detail.cosponsors?.count ?? null,
      crsSummary,
      actionsCount: detail.actions?.count ?? null,
      actions: actionsRes ? shapeActions(actionsRes.actions || []) : null,
    }, 200, { 'Cache-Control': 'public, max-age=3600', 'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=21600, stale-while-revalidate=86400' });
  } catch (err) {
    console.error(`bill-detail ${billId}:`, err);
    if (err.status === 404) return json({ error: 'Bill not found.' }, 404, { 'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=3600' });
    return json({ error: 'Could not load bill details.' }, 502);
  }
};

// Public, unauthenticated, and each call spends Congress.gov quota: cache answers on
// Netlify's CDN (durable, shared across edge nodes; the ?id= query is part of the
// cache key) and rate-limit per visitor. Rate-limited functions need an explicit
// path, so this function is served at /api/bill-detail (not /.netlify/functions/…).
export const config = {
  path: '/api/bill-detail',
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
