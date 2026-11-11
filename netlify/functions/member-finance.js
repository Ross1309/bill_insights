// GET /.netlify/functions/member-finance?id={bioguideId}
//
// Campaign finance for a member's principal campaign committee, from the FEC's
// OpenFEC API. Uses the member's `fec_ids` (stored by ingest-votes.js) and the
// election period for their current/next election. Returns only figures the FEC
// reports; nothing is estimated or scored.
//
// Uses an api.data.gov key: FEC_API_KEY if set, otherwise CONGRESS_API_KEY
// (Congress.gov keys are api.data.gov keys and work for OpenFEC too). Under
// `netlify dev` with neither set it falls back to the public, heavily limited DEMO_KEY.

import { getDb } from '../lib/firebase.js';

const FEC = 'https://api.open.fec.gov/v1';

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function fecKey() {
  if (process.env.FEC_API_KEY) return process.env.FEC_API_KEY;
  if (process.env.CONGRESS_API_KEY) return process.env.CONGRESS_API_KEY;
  if (process.env.NETLIFY_DEV === 'true') return 'DEMO_KEY';
  return null;
}

// In-memory cache for warm function instances: FEC data changes with filings
// (monthly/quarterly), and the API key is rate limited per hour.
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const cache = new Map();

async function fec(path, key) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const url = `${FEC}${path}${path.includes('?') ? '&' : '?'}api_key=${key}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(res.status === 429 ? 'FEC rate limit reached' : `FEC API ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  if (cache.size > 500) cache.clear();
  cache.set(path, { at: Date.now(), data });
  return data;
}

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Prefer the candidate id for the chamber the member sits in now.
function pickCandidateId(fecIds, chamber) {
  const prefix = chamber === 'Senate' ? 'S' : 'H';
  return fecIds.find(id => id.startsWith(prefix)) || fecIds[0] || null;
}

// The member's next (or current) election; FEC "election_full" periods run from
// the day after the previous election to the end of that election year.
function pickElectionYear(electionYears) {
  const thisYear = new Date().getFullYear();
  const years = [...new Set(electionYears || [])].sort((a, b) => a - b);
  const upcoming = years.filter(y => y >= thisYear);
  return { primary: upcoming[0] ?? years.at(-1) ?? null, previous: years.filter(y => y < (upcoming[0] ?? Infinity)).at(-1) ?? null };
}

async function loadPeriod(candidateId, year, key) {
  const q = `cycle=${year}&election_full=true`;
  const totals = (await fec(`/candidate/${candidateId}/totals/?${q}`, key)).results?.[0] || null;
  return totals && num(totals.receipts) ? totals : null;
}

export default async (req) => {
  const key = fecKey();
  if (!key) return json({ error: 'Campaign finance data is not configured (no api.data.gov key).' }, 503);

  const id = new URL(req.url).searchParams.get('id') || '';
  if (!/^[A-Z]\d{6}$/.test(id)) return json({ error: 'Invalid bioguide id.' }, 400);

  try {
    const snap = await getDb().collection('members').doc(id).get();
    const member = snap.exists ? snap.data() : null;
    if (!member) return json({ error: 'Member not found.' }, 404);

    const candidateId = pickCandidateId(member.fec_ids || [], member.chamber);
    if (!candidateId) {
      return json({ available: false, reason: 'No FEC candidate id is on file for this member yet.' }, 200,
        { 'Cache-Control': 'public, max-age=3600' });
    }

    const candidate = (await fec(`/candidate/${candidateId}/`, key)).results?.[0] || {};
    const { primary, previous } = pickElectionYear(candidate.election_years);
    if (!primary) {
      return json({ available: false, reason: 'The FEC has no election periods for this candidate.' }, 200);
    }

    // Use the upcoming election period; if nothing has been reported for it yet
    // (e.g. right after an election), fall back to the previous one.
    let year = primary;
    let totals = await loadPeriod(candidateId, year, key);
    if (!totals && previous) {
      year = previous;
      totals = await loadPeriod(candidateId, year, key);
    }
    if (!totals) {
      return json({ available: false, reason: 'No receipts have been reported to the FEC for this period yet.' }, 200,
        { 'Cache-Control': 'public, max-age=3600' });
    }

    const q = `candidate_id=${candidateId}&cycle=${year}&election_full=true`;
    const [bySize, byState] = await Promise.all([
      fec(`/schedules/schedule_a/by_size/by_candidate/?${q}&per_page=20`, key).catch(() => null),
      fec(`/schedules/schedule_a/by_state/by_candidate/?${q}&per_page=100`, key).catch(() => null),
    ]);

    const states = (byState?.results || []).filter(r => num(r.total));
    const stateTotal = states.reduce((sum, r) => sum + r.total, 0);
    const inState = states.filter(r => r.state === member.state).reduce((sum, r) => sum + r.total, 0);

    return json({
      available: true,
      bioguideId: id,
      candidate: {
        id: candidateId,
        name: candidate.name || null,
        office: candidate.office_full || null,
        party: candidate.party_full || null,
        electionYear: year,
      },
      period: {
        start: totals.coverage_start_date?.slice(0, 10) || null,
        end: totals.coverage_end_date?.slice(0, 10) || null,
      },
      totals: {
        receipts: num(totals.receipts),
        disbursements: num(totals.disbursements),
        cashOnHand: num(totals.last_cash_on_hand_end_period),
        debts: num(totals.last_debts_owed_by_committee),
        individual: num(totals.individual_contributions),
        individualItemized: num(totals.individual_itemized_contributions),
        individualUnitemized: num(totals.individual_unitemized_contributions),
        pacs: num(totals.other_political_committee_contributions),
        partyCommittees: num(totals.political_party_committee_contributions),
        candidateSelf: num(totals.candidate_contribution),
        candidateLoans: num(totals.loans_made_by_candidate),
        transfersIn: num(totals.transfers_from_other_authorized_committee),
        otherReceipts: num(totals.other_receipts),
        offsets: num(totals.offsets_to_operating_expenditures),
      },
      // FEC size buckets: 0 = $200 and under, 200 = $200.01–$499.99, 500 = $500–$999.99,
      // 1000 = $1,000–$1,999.99, 2000 = $2,000 and over.
      bySize: bySize
        ? (bySize.results || []).map(r => ({ size: r.size, total: num(r.total), count: r.count ?? null }))
        : null,
      // State is only known for itemized contributions (over $200 in aggregate).
      byState: byState
        ? {
            itemizedTotal: stateTotal,
            homeState: member.state || null,
            inState,
            outOfState: Math.round((stateTotal - inState) * 100) / 100,
            top: states.sort((a, b) => b.total - a.total).slice(0, 5)
              .map(r => ({ state: r.state, name: r.state_full || r.state, total: r.total })),
          }
        : null,
      sourceUrl: `https://www.fec.gov/data/candidate/${candidateId}/?cycle=${year}&election_full=true`,
    }, 200, { 'Cache-Control': 'public, max-age=43200' });
  } catch (err) {
    console.error(`member-finance ${id}:`, err);
    if (err.status === 429) return json({ error: 'The FEC rate limit was reached. Try again later.' }, 503);
    return json({ error: 'Could not load campaign finance data.' }, 502);
  }
};
