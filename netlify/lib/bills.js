// Shared helpers for pulling bill data from the Congress.gov API and
// shaping it into the Firestore `bills` document schema.

const API = 'https://api.congress.gov/v3';

// Fields earlier versions of the bill sync (then sync-votes.js) wrote with placeholder values.
// They must be removed from every bill doc.
export const FABRICATED_FIELDS = ['outcome', 'vote_counts', 'date_voted'];

// Congress.gov policy areas -> the app's filter buckets.
// Anything not listed is "Other"; bills CRS hasn't tagged yet are "Uncategorized".
const CATEGORY_MAP = {
  'Health': 'Healthcare',
  'International Affairs': 'Foreign Affairs',
  'Foreign Trade and International Finance': 'Foreign Affairs',
  'Economics and Public Finance': 'Economy',
  'Finance and Financial Sector': 'Economy',
  'Taxation': 'Economy',
  'Commerce': 'Economy',
  'Labor and Employment': 'Economy',
};

export function categoryFor(policyArea) {
  if (!policyArea) return 'Uncategorized';
  return CATEGORY_MAP[policyArea] || 'Other';
}

// congress.gov URL slugs by bill type
const TYPE_SLUGS = {
  HR: 'house-bill',
  S: 'senate-bill',
  HRES: 'house-resolution',
  SRES: 'senate-resolution',
  HJRES: 'house-joint-resolution',
  SJRES: 'senate-joint-resolution',
  HCONRES: 'house-concurrent-resolution',
  SCONRES: 'senate-concurrent-resolution',
};

function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
}

export function congressGovUrl(congress, type, number) {
  const slug = TYPE_SLUGS[type];
  if (!slug || !congress || !number) return null;
  return `https://www.congress.gov/bill/${ordinal(congress)}-congress/${slug}/${number}`;
}

// "hr1234-119" -> { type: 'HR', number: '1234', congress: 119 }
export function parseBillId(billId) {
  const m = /^([a-z]+)(\d+)-(\d+)$/.exec(billId || '');
  if (!m) return null;
  return { type: m[1].toUpperCase(), number: m[2], congress: Number(m[3]) };
}

export function makeBillId(type, number, congress) {
  return `${String(type).toLowerCase()}${number}-${congress}`;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const safeUrl = url.replace(/api_key=[^&]+/, 'api_key=***');
    throw new Error(`Congress API ${res.status} for ${safeUrl}`);
  }
  return res.json();
}

export async function fetchRecentBills(apiKey, limit = 10) {
  const data = await getJson(`${API}/bill?api_key=${apiKey}&format=json&limit=${limit}&sort=updateDate+desc`);
  return data.bills || [];
}

export async function fetchBillDetail(congress, type, number, apiKey) {
  const data = await getJson(`${API}/bill/${congress}/${type.toLowerCase()}/${number}?api_key=${apiKey}&format=json`);
  return data.bill || {};
}

// Latest official Congressional Research Service summary as plain text, or null.
export async function fetchLatestCrsSummary(congress, type, number, apiKey) {
  const data = await getJson(`${API}/bill/${congress}/${type.toLowerCase()}/${number}/summaries?api_key=${apiKey}&format=json`);
  const list = data.summaries || [];
  if (!list.length) return null;
  const latest = list.reduce((a, b) => ((a.updateDate || '') >= (b.updateDate || '') ? a : b));
  const text = stripHtml(latest.text || '');
  return text || null;
}

export function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// Build the metadata portion of a bill doc from the API's bill-detail
// response, falling back to the list-item shape where detail is missing.
export function billMetadata(detail = {}, fallback = {}) {
  const type = String(detail.type || fallback.type || '').toUpperCase();
  const number = String(detail.number || fallback.number || '');
  const congress = Number(detail.congress || fallback.congress);
  const policyArea = detail.policyArea?.name || null;
  const action = detail.latestAction || fallback.latestAction || null;

  return {
    bill_id: makeBillId(type, number, congress),
    congress,
    type,
    number,
    bill_number: `${type} ${number}`,
    title: detail.title || fallback.title || `${type} ${number}`,
    chamber: detail.originChamber || fallback.originChamber || null,
    policy_area: policyArea,
    category: categoryFor(policyArea),
    introduced_date: detail.introducedDate || null,
    latestAction: action
      ? { actionDate: action.actionDate || null, text: action.text || null }
      : null,
    update_date: detail.updateDate || fallback.updateDate || null,
    congress_gov_url: congressGovUrl(congress, type, number),
  };
}

// Plain-language summary from the official CRS summary when one exists,
// otherwise from the title only (and labeled as such). Returns null on failure.
export async function generateSummary({ title, crsSummary }, openaiKey) {
  const source = crsSummary ? 'crs_summary' : 'title_only';
  const context = crsSummary
    ? `Official Congressional Research Service summary:\n${crsSummary.slice(0, 6000)}`
    : 'No official summary is available yet; only the title is known.';

  const prompt = [
    'You write neutral, non-partisan, plain-language explanations of U.S. legislation.',
    'Using only the information below, give exactly 3 concise bullet points on what this bill would do and who it would affect.',
    'Do not speculate beyond the text, and do not describe the bill as good or bad.',
    'If only the title is available, say only what the title indicates.',
    'Respond with one bullet per line in plain text, with no markdown formatting.',
    '',
    `Title: ${title}`,
    context,
  ].join('\n');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    console.error(`OpenAI request failed (${res.status}) for "${title}"`);
    return null;
  }

  const data = await res.json();
  const bullet_points = (data.choices?.[0]?.message?.content || '')
    .split('\n')
    .map(line => line.replace(/^\s*(?:[•*-]|\d+[.)])\s*/, '').replace(/\*\*|__/g, '').trim())
    .filter(Boolean)
    .slice(0, 3);

  if (!bullet_points.length) return null;

  return {
    bullet_points,
    source,
    model: 'gpt-4o-mini',
    generated_at: new Date().toISOString(),
  };
}

// Decide whether a bill needs a (re)generated summary.
//  - no summary yet                     -> generate
//  - legacy summary (no `source` field) -> regenerate (was title-only, unlabeled)
//  - title_only and a CRS summary now exists -> upgrade
export function needsSummary(existing, crsSummaryAvailable) {
  if (!existing?.bullet_points?.length) return true;
  if (!existing.source) return true;
  if (existing.source === 'title_only' && crsSummaryAvailable) return true;
  return false;
}
