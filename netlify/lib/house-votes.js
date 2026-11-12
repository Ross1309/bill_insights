// House roll-call votes from the Congress.gov API, shaped into the `votes` doc schema.
// Shared by netlify/functions/ingest-votes.js (latest few) and scripts/import-votes.js
// (whole-congress backfill).

import { partyBreakdown } from './vote-stats.js';
import { getJson, getText } from './http.js';

const API = 'https://api.congress.gov/v3';
const BILL_TYPES = new Set(['HR', 'S', 'HRES', 'SRES', 'HJRES', 'SJRES', 'HCONRES', 'SCONRES']);
const TALLY_KEYS = { yea: 'yea', aye: 'yea', nay: 'nay', no: 'nay', present: 'present', 'not voting': 'not_voting' };

// The House Clerk's vote record names the measure in <legis-num>, e.g. "H R 2102",
// "H RES 566", "H J RES 7", "S 1234". Congress.gov leaves `legislationType` empty for
// amendment votes (it lists the amendment instead) and fills it in hours late for new
// votes, so the Clerk's record is the fallback. QUORUM / ADJOURN / JOURNAL etc. -> null.
const CLERK_TYPES = { 'H R': 'HR', 'H RES': 'HRES', 'H J RES': 'HJRES', 'H CON RES': 'HCONRES', S: 'S', 'S RES': 'SRES', 'S J RES': 'SJRES', 'S CON RES': 'SCONRES' };

export function legislationFromClerk(xml, congress) {
  const m = /<legis-num>\s*([A-Z ]+?)\s+(\d+)\s*<\/legis-num>/.exec(xml || '');
  const type = m && CLERK_TYPES[m[1].replace(/\s+/g, ' ')];
  if (!type) return null;
  return { legislation: `${type} ${m[2]}`, bill_id: `${type.toLowerCase()}${m[2]}-${congress}` };
}

export async function fetchClerkLegislation(sourceUrl, congress) {
  if (!/^https:\/\/clerk\.house\.gov\//.test(sourceUrl || '')) return null;
  return legislationFromClerk(await getText(sourceUrl, { timeoutMs: 10000, retries: 1 }), congress);
}

export function houseVoteId(congress, session, rollCall) {
  return `${congress}-${session}-house-vote-${rollCall}`;
}

// Every House roll call in a congress, newest first. The list endpoint ignores `sort`
// and returns votes unordered, so fetch all of it (first page, then the rest in
// parallel from its total count) and sort by start time.
export async function listHouseVotes(congress, apiKey) {
  const page = offset => getJson(`${API}/house-vote/${congress}?api_key=${apiKey}&format=json&limit=250&offset=${offset}`);
  const first = await page(0);
  const total = first.pagination?.count ?? 0;
  const offsets = [];
  for (let o = 250; o < total; o += 250) offsets.push(o);
  const rest = await Promise.all(offsets.map(page));
  const all = [first, ...rest].flatMap(p => p.houseRollCallVotes || []);
  return all
    .filter(v => v.sessionNumber && v.rollCallNumber && v.startDate)
    .sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
}

// One list item -> a full `votes` doc (fetches member positions). No timestamps;
// callers add updatedAt.
export async function buildHouseVoteDoc(voteItem, congress, apiKey) {
  const session = voteItem.sessionNumber;
  const voteNumber = voteItem.rollCallNumber;
  const detail = (await getJson(`${API}/house-vote/${congress}/${session}/${voteNumber}/members?api_key=${apiKey}&format=json`))
    .houseRollCallVoteMemberVotes || {};

  const individual_votes = (detail.results || []).map(m => ({
    bioguideId: m.bioguideID,
    name: [m.lastName, m.firstName].filter(Boolean).join(', '),
    state: m.voteState || null,
    party: m.voteParty || null,
    position: m.voteCast || null,
  }));

  // "Aye"/"No" (recorded votes) are counted with "Yea"/"Nay".
  const tallies = individual_votes.reduce((acc, m) => {
    const key = TALLY_KEYS[(m.position || '').toLowerCase()] || 'other';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, { yea: 0, nay: 0, present: 0, not_voting: 0 });

  const legType = (voteItem.legislationType || '').toUpperCase();
  const isBill = BILL_TYPES.has(legType) && voteItem.legislationNumber;
  const id = houseVoteId(congress, session, voteNumber);
  // No measure from Congress.gov (amendment votes, or not filled in yet): ask the Clerk.
  const clerk = legType ? null : await fetchClerkLegislation(voteItem.sourceDataURL, congress).catch(() => null);

  return {
    vote_id: id,
    bill_id: isBill ? `${legType.toLowerCase()}${voteItem.legislationNumber}-${congress}` : clerk?.bill_id || null,
    legislation: legType && voteItem.legislationNumber ? `${legType} ${voteItem.legislationNumber}` : clerk?.legislation || null,
    ...(clerk ? { legislation_source: 'House Clerk' } : {}),
    chamber: 'House',
    congress,
    session,
    roll_call_number: voteNumber,
    date: voteItem.startDate ? new Date(voteItem.startDate).toISOString() : null,
    question: detail.voteQuestion || null,
    vote_type: voteItem.voteType || null,
    result: voteItem.result || null,
    tallies,
    individual_votes,
    party_breakdown: partyBreakdown(individual_votes),
    source_url: voteItem.sourceDataURL || null,
  };
}
