// Shared helpers for pulling bill data from the Congress.gov API and
// shaping it into the Firestore `bills` document schema.

import { getJson, fetchWithRetry } from './http.js';
import { ordinal } from './congress.js';
import { topicTags, TOPICS } from './topics.js';
import { stageFromActions } from '../../public/stage.js';

export { stageFromActions };

const API = 'https://api.congress.gov/v3';

// Congress.gov policy areas -> the Bills tab's category chips: the Issues topics'
// policy areas (topics.js), so the two never drift apart. Anything else is "Other"; bills
// CRS hasn't tagged yet are "Uncategorized". Changing topics? Run retag-topics.js --write,
// which also updates stored categories.
const CATEGORY_MAP = Object.fromEntries(Object.values(TOPICS).flatMap(t => t.policyAreas.map(a => [a, t.label])));

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
// fetchOpts: getJson options (timeoutMs, retries) for callers on a tight time budget.
export async function listBillsUpdatedSince(sinceIso, apiKey, max = 1000, fetchOpts = undefined, startOffset = 0) {
  const since = new Date(sinceIso).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const bills = [];
  let truncated = false;
  for (let offset = startOffset; ; offset += 250) {
    if (offset - startOffset >= max) { truncated = true; break; }
    const data = await getJson(`${API}/bill?api_key=${apiKey}&format=json&limit=250&offset=${offset}&sort=updateDate+asc&fromDateTime=${since}`, fetchOpts);
    const items = data.bills || [];
    bills.push(...items.filter(b => b.type && b.number && b.congress)
      .map(b => ({ id: makeBillId(b.type, b.number, b.congress), updateDate: b.updateDate || null, latestAction: b.latestAction || null, originChamber: b.originChamber || null })));
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

// What the model reads from a CRS summary, at most ~6,000 characters. A long, structured
// one (reconciliation, appropriations, defense: "TITLE I--…", "TITLE II--…") becomes its
// overview plus the opening of every title, so the whole bill is represented; the first
// 6,000 characters alone covered only Title I of the 119th's H.R. 1 (SNAP).
export function summaryContext(text, max = 6000) {
  if (text.length <= max) return text;
  const heads = [...text.matchAll(/TITLE [IVXLC]+--/g)].map(m => m.index);
  if (heads.length < 3) return text.slice(0, max);
  const overview = text.slice(0, Math.min(heads[0], 1800));
  const per = Math.floor((max - overview.length) / heads.length);
  const parts = heads.map((at, i) => text.slice(at, Math.min(at + per, heads[i + 1] ?? text.length)).trim());
  return [overview.trim(), ...parts].join('\n\n').slice(0, max);
}

// Plain-language summary of the official CRS summary. Policy: no CRS summary ->
// no AI summary (title-only summaries speculated), so `crsSummary` is required.
export async function generateSummary({ title, crsSummary }, openaiKey) {
  if (!crsSummary) return null;
  const source = 'crs_summary';
  const context = `Official Congressional Research Service summary${crsSummary.length > 6000 ? ' (shortened from a longer summary)' : ''}:\n${summaryContext(crsSummary)}`;

  const prompt = [
    'You write neutral, non-partisan, plain-language explanations of U.S. legislation.',
    'Using only the information below, give exactly 3 concise bullet points on what this bill would do and who it would affect.',
    // Big bills (reconciliation, appropriations, defense) cover many subjects: three bullets
    // about one section would mislead by omission (H.R. 1 of the 119th read as a SNAP bill).
    'If the bill covers several major subjects, the bullets together must cover the most significant ones across the whole bill (start with the overview), not details of a single section.',
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

// Stage + flags from the action history: shared with the page (public/stage.js).

// Extra fields for the issue tracker (3 Congress.gov requests: detail is passed in,
// plus subjects and actions). `detail` is the bill-detail response's `bill`.
// The bill's common name from Congress.gov's titles list ("One Big Beautiful Bill Act" for
// H.R. 1, whose display title is "An act to provide for reconciliation …"), or null when
// it has none. Only for display titles that are a sentence ("To …", "An act …"): when
// Congress.gov already displays a name ("PROOF Act"), that's kept, not swapped for the
// spelled-out version. The latest stage's short title wins;
// short titles of only part of a bill ("… for portions of this bill") and CRS's informal
// "Popular Titles" are never used.
const SHORT_TITLE_ORDER = [/as Enacted/i, /\bENR\b|Enrolled/i, /as Passed/i, /as Reported/i, /\bPCS\b|Placed on/i, /as Introduced/i, /./];
const SENTENCE_TITLE = /^(to|an act|a bill|a joint resolution|a concurrent resolution|a resolution|making|providing for|authorizing)\b/i;
export function pickShortTitle(titles, displayTitle) {
  if (!SENTENCE_TITLE.test(String(displayTitle || '').trim())) return null;
  const short = (titles || []).filter(t => /^Short Title/i.test(t.titleType || '') && !/portion/i.test(t.titleType || '') && String(t.title || '').trim());
  for (const re of SHORT_TITLE_ORDER) {
    const hit = short.find(t => re.test(t.titleType));
    if (hit) {
      const name = hit.title.trim().replace(/\s+/g, ' ');
      return name.toLowerCase() === String(displayTitle || '').trim().toLowerCase() ? null : name;
    }
  }
  return null;
}

export async function fetchBillEnrichment(detail, apiKey) {
  const congress = detail.congress;
  const type = String(detail.type || '').toLowerCase();
  const number = detail.number;
  const base = `${API}/bill/${congress}/${type}/${number}`;
  const [subjects, actions, titles] = await Promise.all([
    getJson(`${base}/subjects?api_key=${apiKey}&format=json&limit=250`),
    getJson(`${base}/actions?api_key=${apiKey}&format=json&limit=250`),
    // Optional: a failed titles fetch leaves the stored short title alone.
    getJson(`${base}/titles?api_key=${apiKey}&format=json&limit=250`).catch(() => null),
  ]);
  const subjectNames = (subjects.subjects?.legislativeSubjects || []).map(s => s.name).filter(Boolean);
  const lawNumber = detail.laws?.[0]?.number || null;
  // "Public Law" or "Private Law" (private laws are numbered separately: Private Law 119-1
  // is not Public Law 119-1).
  const lawType = detail.laws?.[0]?.type || null;
  const sponsor = detail.sponsors?.[0];
  const policyArea = detail.policyArea?.name || subjects.subjects?.policyArea?.name || null;
  return {
    subjects: subjectNames,
    subject_count: subjectNames.length,
    law_number: lawNumber,
    law_type: lawType,
    sponsor: sponsor
      ? { bioguideId: sponsor.bioguideId || null, name: [sponsor.firstName, sponsor.lastName].filter(Boolean).join(' ') || null, party: sponsor.party || null, state: sponsor.state || null }
      : null,
    cosponsors_count: detail.cosponsors?.count ?? null,
    ...stageFromActions(actions.actions || [], { isLaw: Boolean(lawNumber) }),
    ...topicTags({ policy_area: policyArea, subjects: subjectNames, title: detail.title || '' }),
    ...(titles ? { short_title: pickShortTitle(titles.titles, detail.title) } : {}),
    enriched_at: new Date().toISOString(),
  };
}

// Full doc fields for one bill: metadata + enrichment (4 requests).
export async function fetchEnrichedBill(congress, type, number, apiKey) {
  const detail = await fetchBillDetail(congress, type, number, apiKey);
  const meta = billMetadata(detail, { congress, type, number });
  return { ...meta, ...(await fetchBillEnrichment({ ...detail, congress, type, number }, apiKey)) };
}
