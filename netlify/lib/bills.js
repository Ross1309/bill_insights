// Shared helpers for pulling bill data from the Congress.gov API and
// shaping it into the Firestore `bills` document schema.

import { getJson, fetchWithRetry } from './http.js';
import { ordinal } from './congress.js';
import { topicTags } from './topics.js';

const API = 'https://api.congress.gov/v3';

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

// Bills updated since an ISO time, OLDEST first: { bills: [{ id, updateDate }], truncated }.
// `updateDate` is a date ("2026-11-12"; the list has no time). Oldest first so a capped
// list is a prefix of the window, which callers can advance past.
export async function listBillsUpdatedSince(sinceIso, apiKey, max = 1000) {
  const since = new Date(sinceIso).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const bills = [];
  let truncated = false;
  for (let offset = 0; ; offset += 250) {
    if (offset >= max) { truncated = true; break; }
    const data = await getJson(`${API}/bill?api_key=${apiKey}&format=json&limit=250&offset=${offset}&sort=updateDate+asc&fromDateTime=${since}`);
    const items = data.bills || [];
    bills.push(...items.filter(b => b.type && b.number && b.congress)
      .map(b => ({ id: makeBillId(b.type, b.number, b.congress), updateDate: b.updateDate || null })));
    if (items.length < 250) break;
  }
  return { bills, truncated };
}

// Ids of every bill that became law in a Congress (official laws list).
export async function listLawBillIds(congress, apiKey) {
  const ids = [];
  for (let offset = 0; ; offset += 250) {
    const data = await getJson(`${API}/law/${congress}?api_key=${apiKey}&format=json&limit=250&offset=${offset}`);
    const items = data.bills || [];
    ids.push(...items.map(b => makeBillId(b.type, b.number, b.congress)));
    if (items.length < 250) break;
  }
  return ids;
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
    // Top-level copy for ordering the Bills tab by latest action (Firestore indexes
    // and orderBy work best on top-level fields). null still sorts (last, descending).
    latest_action_date: action?.actionDate || null,
    update_date: detail.updateDate || fallback.updateDate || null,
    congress_gov_url: congressGovUrl(congress, type, number),
  };
}

// Plain-language summary of the official CRS summary. Policy: no CRS summary ->
// no AI summary (title-only summaries speculated), so `crsSummary` is required.
export async function generateSummary({ title, crsSummary }, openaiKey) {
  if (!crsSummary) return null;
  const source = 'crs_summary';
  const context = `Official Congressional Research Service summary:\n${crsSummary.slice(0, 6000)}`;

  const prompt = [
    'You write neutral, non-partisan, plain-language explanations of U.S. legislation.',
    'Using only the information below, give exactly 3 concise bullet points on what this bill would do and who it would affect.',
    'Do not speculate beyond the text, and do not describe the bill as good or bad.',
    'Respond with one bullet per line in plain text, with no markdown formatting.',
    '',
    `Title: ${title}`,
    context,
  ].join('\n');

  let res;
  try {
    res = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
      // Short and no retry: sync-bills has a 30 s budget; a failed summary is retried
      // on a later run.
      timeoutMs: 12000,
      retries: 0,
      method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    }),
    });
  } catch (err) {
    console.error(`OpenAI request failed (${err.status || err.message}) for "${title}"`);
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

// The bill's latest CRS summary text, or null if CRS hasn't published one. CRS bill
// summaries start with the 93rd Congress (1973); older records (which Congress.gov
// sometimes re-touches) have none, and their endpoint can error. Throws on API errors.
export async function checkCrsSummary(bill, congressKey) {
  if (Number(bill.congress) < 93) return null;
  return fetchLatestCrsSummary(bill.congress, bill.type, bill.number, congressKey);
}

// Fields once the CRS check is done (`crs` = text or null): no CRS -> mark waiting (and
// drop any old title-only/legacy summary); CRS -> generate from it (OpenAI).
export async function summaryFromCrs(bill, crs, existingSummary, { openaiKey, deleteField }) {
  const checked = { crs_checked_at: new Date().toISOString() };
  if (!crs) {
    const fields = { ...checked, crs_summary_available: false };
    if (existingSummary) fields.ai_summary = deleteField();
    return { fields, generated: false, status: 'no_crs' };
  }
  const summary = await generateSummary({ title: bill.title, crsSummary: crs }, openaiKey);
  if (!summary) return { fields: {}, generated: false, status: 'error', error: 'OpenAI request failed' };
  return { fields: { ...checked, crs_summary_available: true, ai_summary: summary }, generated: true, status: 'generated' };
}

// Summary fields to write for one bill (CRS-only policy):
//  - already has a CRS-based summary         -> nothing to do
//  - CRS summary exists                      -> generate from it
//  - no CRS summary yet                      -> mark crs_summary_available: false (and
//                                               drop any old title-only/legacy summary)
//  - CRS or OpenAI request failed            -> nothing written; retried next time
// `deleteField` is admin.firestore.FieldValue.delete().
export async function summaryUpdate(bill, existingSummary, keys) {
  if (existingSummary?.source === 'crs_summary') return { fields: {}, generated: false, status: 'has_summary' };
  let crs;
  try {
    crs = await checkCrsSummary(bill, keys.congressKey);
  } catch (err) {
    return { fields: {}, generated: false, status: 'error', error: err.message };
  }
  return summaryFromCrs(bill, crs, existingSummary, keys);
}

// --- Issue-tracker enrichment: CRS subjects, legislative stage, sponsor, topics ---

// Stages in order. Concurrent/simple resolutions stop at passed_both / passed_one.
// (introduced -> committee -> passed_one -> passed_both -> to_president -> law)

// Stage from the action history. Library of Congress action text starts with
// "Passed/agreed to in House: …" on success and "Failed of passage/not agreed to in
// House: …" on failure, so match at the start (a substring test confuses the two).
export function stageFromActions(actions = [], { isLaw = false } = {}) {
  const texts = actions.map(a => (a.text || '').trim().toLowerCase());
  const has = re => texts.some(t => re.test(t));
  const passedHouse = has(/^passed\/agreed to in house/);
  const passedSenate = has(/^passed\/agreed to in senate/);
  let stage = 'introduced';
  if (has(/referred to/)) stage = 'committee';
  if (passedHouse || passedSenate) stage = 'passed_one';
  if (passedHouse && passedSenate) stage = 'passed_both';
  if (has(/presented to president/)) stage = 'to_president';
  if (isLaw || has(/became public law/)) stage = 'law';
  return {
    stage,
    passed_house: passedHouse,
    passed_senate: passedSenate,
    failed_house: has(/^failed of passage\/not agreed to in house/),
    failed_senate: has(/^failed of passage\/not agreed to in senate/),
    vetoed: has(/vetoed by president/),
  };
}

// Extra fields for the issue tracker (3 Congress.gov requests: detail is passed in,
// plus subjects and actions). `detail` is the bill-detail response's `bill`.
export async function fetchBillEnrichment(detail, apiKey) {
  const congress = detail.congress;
  const type = String(detail.type || '').toLowerCase();
  const number = detail.number;
  const base = `${API}/bill/${congress}/${type}/${number}`;
  const [subjects, actions] = await Promise.all([
    getJson(`${base}/subjects?api_key=${apiKey}&format=json&limit=250`),
    getJson(`${base}/actions?api_key=${apiKey}&format=json&limit=250`),
  ]);
  const subjectNames = (subjects.subjects?.legislativeSubjects || []).map(s => s.name).filter(Boolean);
  const lawNumber = detail.laws?.[0]?.number || null;
  const sponsor = detail.sponsors?.[0];
  const policyArea = detail.policyArea?.name || subjects.subjects?.policyArea?.name || null;
  return {
    subjects: subjectNames,
    subject_count: subjectNames.length,
    law_number: lawNumber,
    sponsor: sponsor
      ? { bioguideId: sponsor.bioguideId || null, name: [sponsor.firstName, sponsor.lastName].filter(Boolean).join(' ') || null, party: sponsor.party || null, state: sponsor.state || null }
      : null,
    cosponsors_count: detail.cosponsors?.count ?? null,
    ...stageFromActions(actions.actions || [], { isLaw: Boolean(lawNumber) }),
    ...topicTags({ policy_area: policyArea, subjects: subjectNames, title: detail.title || '' }),
    enriched_at: new Date().toISOString(),
  };
}

// Full doc fields for one bill: metadata + enrichment (4 requests).
export async function fetchEnrichedBill(congress, type, number, apiKey) {
  const detail = await fetchBillDetail(congress, type, number, apiKey);
  const meta = billMetadata(detail, { congress, type, number });
  return { ...meta, ...(await fetchBillEnrichment({ ...detail, congress, type, number }, apiKey)) };
}
