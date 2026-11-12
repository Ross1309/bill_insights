// Per-vote derived fields and the precomputed `stats/overview` doc behind the
// Overview tab. Everything here is counted from official roll-call data; the
// definitions are spelled out so the UI can print them next to the charts.

const POSITION = { yea: 'yea', aye: 'yea', nay: 'nay', no: 'nay', present: 'present', 'not voting': 'not_voting' };

// { D: { yea, nay, present, not_voting }, R: {...}, I: {...} } from individual_votes.
export function partyBreakdown(individualVotes = []) {
  const out = {};
  for (const v of individualVotes) {
    const party = v.party || '?';
    const key = POSITION[(v.position || '').toLowerCase()];
    if (!key) continue;
    out[party] ??= { yea: 0, nay: 0, present: 0, not_voting: 0 };
    out[party][key]++;
  }
  return out;
}

// How the two major parties lined up, by majority of each party's Yea/Nay votes:
//  - 'same'     majorities of Democrats and Republicans voted the same way
//  - 'opposed'  a majority of Democrats voted against a majority of Republicans
//  - 'unclear'  a party tied, or one party cast no Yea/Nay votes
export function partyAlignment(breakdown = {}) {
  const side = p => {
    const c = breakdown[p];
    if (!c || c.yea + c.nay === 0 || c.yea === c.nay) return null;
    return c.yea > c.nay ? 'yea' : 'nay';
  };
  const d = side('D');
  const r = side('R');
  if (!d || !r) return 'unclear';
  return d === r ? 'same' : 'opposed';
}

// Kind of question, from the official question text (order matters).
export const CATEGORY_LABELS = {
  cloture: 'Cloture (end debate)',
  nomination: 'Nominations',
  passage: 'Passage of bills & resolutions',
  amendment: 'Amendments',
  procedural: 'Procedural motions',
  other: 'Other',
};

export function voteCategory(question = '') {
  const q = question.toLowerCase();
  if (q.includes('cloture')) return 'cloture';
  if (q.includes('nomination')) return 'nomination';
  if (/passage|suspend the rules and (pass|agree|concur)|agreeing to the resolution|^on the (joint |concurrent )?resolution|concur in|objections of the president/.test(q)) return 'passage';
  if (q.includes('amendment')) return 'amendment';
  if (/motion|previous question|point of order|decision of the chair|consideration of|call of the house|call by states/.test(q)) return 'procedural';
  return 'other';
}

// 'succeeded' | 'failed' | 'other', from the official result text.
export function voteOutcome(result = '') {
  const r = result.toLowerCase();
  if (/failed|rejected|defeated|not sustained|not agreed|not well taken/.test(r)) return 'failed';
  if (/passed|agreed|confirmed|adopted|sustained|well taken/.test(r)) return 'succeeded';
  return 'other';
}

// Calendar date of a vote in Eastern time (where Congress votes), "YYYY-MM-DD".
export function easternDate(iso) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// Monday of the week containing a "YYYY-MM-DD" date.
export function weekStart(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function nextMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

const CHAMBERS = ['House', 'Senate'];
const DELEGATE_CODES = new Set(['DC', 'PR', 'GU', 'VI', 'AS', 'MP']);

// Header cards: current members per seat type with party split (party names as in
// `members`, e.g. { Republican: 53, Democratic: 45, Independent: 2 }).
export function headlineCounts(members) {
  const out = { senate: { count: 0, parties: {} }, house: { count: 0, parties: {} }, delegates: { count: 0, parties: {} } };
  for (const m of members || []) {
    const seat = m.chamber === 'Senate' ? out.senate
      : m.chamber === 'House' ? (DELEGATE_CODES.has(m.state) ? out.delegates : out.house) : null;
    if (!seat) continue;
    seat.count++;
    const p = m.party || 'Unknown';
    seat.parties[p] = (seat.parties[p] || 0) + 1;
  }
  return out;
}
const PARTY_ABBR = { Democratic: 'D', Republican: 'R', Independent: 'I' };

// Build the overview from lightweight vote fields + the member directory.
// `votes`: [{ chamber, date, question, result, party_breakdown }]
// `members`: directory/members `members` array.
export function computeOverview(votes, members, { congress } = {}) {
  const dated = votes.filter(v => v.date && CHAMBERS.includes(v.chamber));
  dated.sort((a, b) => a.date.localeCompare(b.date));

  const totals = { House: 0, Senate: 0 };
  const weekly = new Map();
  const monthly = new Map();
  const alignmentTotals = { House: { same: 0, opposed: 0, unclear: 0 }, Senate: { same: 0, opposed: 0, unclear: 0 } };
  const outcomes = { House: {}, Senate: {} };

  for (const v of dated) {
    const day = easternDate(v.date);
    const week = weekStart(day);
    const month = day.slice(0, 7);
    totals[v.chamber]++;

    if (!weekly.has(week)) weekly.set(week, { week, House: 0, Senate: 0 });
    weekly.get(week)[v.chamber]++;

    const align = partyAlignment(v.party_breakdown);
    if (!monthly.has(month)) {
      monthly.set(month, { month, House: { same: 0, opposed: 0, unclear: 0 }, Senate: { same: 0, opposed: 0, unclear: 0 } });
    }
    monthly.get(month)[v.chamber][align]++;
    alignmentTotals[v.chamber][align]++;

    const cat = voteCategory(v.question || '');
    outcomes[v.chamber][cat] ??= { succeeded: 0, failed: 0, other: 0 };
    outcomes[v.chamber][cat][voteOutcome(v.result || '')]++;
  }

  // Continuous weeks/months (zeros for recesses), so gaps are visible.
  const weeks = [];
  const months = [];
  if (dated.length) {
    const firstDay = easternDate(dated[0].date);
    const lastDay = easternDate(dated.at(-1).date);
    for (let w = weekStart(firstDay); w <= weekStart(lastDay); w = addDays(w, 7)) {
      weeks.push(weekly.get(w) || { week: w, House: 0, Senate: 0 });
    }
    for (let m = firstDay.slice(0, 7); m <= lastDay.slice(0, 7); m = nextMonth(m)) {
      months.push(monthly.get(m) || { month: m, House: { same: 0, opposed: 0, unclear: 0 }, Senate: { same: 0, opposed: 0, unclear: 0 } });
    }
  }

  const delegations = {};
  for (const m of members || []) {
    if (!m.state) continue;
    const d = (delegations[m.state] ??= { D: 0, R: 0, I: 0, other: 0, senators: 0, representatives: 0, delegate: DELEGATE_CODES.has(m.state) });
    d[PARTY_ABBR[m.party] || 'other']++;
    if (m.chamber === 'Senate') d.senators++;
    else d.representatives++;
  }

  return {
    congress: congress ?? null,
    headline: headlineCounts(members),
    first_vote_date: dated[0]?.date || null,
    last_vote_date: dated.at(-1)?.date || null,
    totals,
    weekly: weeks,
    monthly: months,
    alignment_totals: alignmentTotals,
    outcomes,
    delegations,
  };
}
