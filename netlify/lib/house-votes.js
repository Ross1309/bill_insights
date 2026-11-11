// House roll-call votes from the Congress.gov API, shaped into the `votes` doc schema.
// Shared by netlify/functions/ingest-votes.js (latest few) and scripts/import-votes.js
// (whole-congress backfill).

import { partyBreakdown } from './vote-stats.js';
import { getJson } from './http.js';

const API = 'https://api.congress.gov/v3';
const BILL_TYPES = new Set(['HR', 'S', 'HRES', 'SRES', 'HJRES', 'SJRES', 'HCONRES', 'SCONRES']);
const TALLY_KEYS = { yea: 'yea', aye: 'yea', nay: 'nay', no: 'nay', present: 'present', 'not voting': 'not_voting' };

export function houseVoteId(congress, session, rollCall) {
  return `${congress}-${session}-house-vote-${rollCall}`;
}

// Every House roll call in a congress, newest first. The list endpoint ignores `sort`
// and returns votes unordered, so page through all of it and sort by start time.
export async function listHouseVotes(congress, apiKey) {
  const all = [];
  for (let offset = 0; ; offset += 250) {
    const page = await getJson(`${API}/house-vote/${congress}?api_key=${apiKey}&format=json&limit=250&offset=${offset}`);
    const items = page.houseRollCallVotes || [];
    all.push(...items);
    if (items.length < 250 || all.length >= (page.pagination?.count ?? 0)) break;
  }
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

  return {
    vote_id: id,
    bill_id: isBill ? `${legType.toLowerCase()}${voteItem.legislationNumber}-${congress}` : null,
    legislation: legType && voteItem.legislationNumber ? `${legType} ${voteItem.legislationNumber}` : null,
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
