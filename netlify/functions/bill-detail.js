// GET /.netlify/functions/bill-detail?id={bill_id}   e.g. id=hr9612-119
//
// Server-side proxy to Congress.gov for a bill's sponsor, cosponsor count, latest
// official CRS summary and action history. Works for bills that aren't in our
// `bills` collection too (votes often reference those). Only sourced fields;
// anything missing is null.

import { billMetadata, congressGovUrl, parseBillId, stripHtml } from '../lib/bills.js';

const API = 'https://api.congress.gov/v3';
const ACTIONS_LIMIT = 100;

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`Congress API ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

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
    }, 200, { 'Cache-Control': 'public, max-age=3600' });
  } catch (err) {
    console.error(`bill-detail ${billId}:`, err);
    const notFound = err.status === 404;
    return json({ error: notFound ? 'Bill not found.' : 'Could not load bill details.' }, notFound ? 404 : 502);
  }
};
