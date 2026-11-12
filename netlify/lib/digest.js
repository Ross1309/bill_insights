// "What Congress did this week": one stats/week-<Monday> doc per week of a Congress,
// plus stats/weeks (the list, for navigation) and a short `this_week` summary embedded in
// stats/overview (so the Overview card costs no extra read). Weeks run Monday-Sunday,
// Eastern time, like the Overview's activity chart.
//
// Everything is rule-based from stored records, and the page prints the rules:
//  - Became law: bills whose latest action is "Became Public Law" with a date in the week
//  - Passed / failed: roll calls whose question is passage of a bill or resolution
//    (voteCategory 'passage'), by official result
//  - Closest votes: the smallest Yea-Nay margins among passage, cloture, nomination and
//    amendment votes (procedural motions left out)
//  - Nominations: Senate votes on a nomination, with the nominee from the vote record
//  - Party agreement: partyAlignment of every roll call that week
// Bills that pass by voice vote or unanimous consent have no roll call; they appear
// here when they become law.

import { easternDate, weekStart, addDays, voteCategory, voteOutcome, partyAlignment } from './vote-stats.js';

const CLOSE_CATEGORIES = new Set(['passage', 'cloture', 'nomination', 'amendment']);
export const CLOSEST_N = 3;

const LAW_ACTION = /^Became (Public|Private) Law No:?\s*([\d-]+)/i;

const billLabel = (b, fallback) => b?.bill_number || fallback || null;

// D and R Yea/Nay (the table shows Independents only in the vote detail).
function parties(pb) {
  const out = {};
  for (const p of ['D', 'R', 'I']) if (pb?.[p]) out[p] = { yea: pb[p].yea || 0, nay: pb[p].nay || 0 };
  return out;
}

function voteItem(v, billsById) {
  const bill = v.bill_id ? billsById.get(v.bill_id) : null;
  return {
    id: v.id,
    chamber: v.chamber,
    date: v.date,
    question: v.question || null,
    result: v.result || null,
    outcome: voteOutcome(v.result || ''),
    yea: v.tallies?.yea ?? null,
    nay: v.tallies?.nay ?? null,
    parties: parties(v.party_breakdown),
    alignment: partyAlignment(v.party_breakdown),
    bill: v.bill_id ? { id: v.bill_id, label: billLabel(bill, v.legislation), title: bill?.title || null } : null,
    legislation: v.legislation || null,
    document_title: v.document_title || null,
  };
}

// Laws: bill docs with stage 'law'. The signing date is `law_date` (from the action
// history, set at enrichment), else the latest action's date when that is the "Became
// Public/Private Law" action (it normally stays the latest action).
export function lawSigning(bill) {
  if (bill.law_date) return bill.law_date;
  const a = bill.latestAction;
  if (!a?.actionDate || !LAW_ACTION.test(a.text || '')) return null;
  return a.actionDate;
}

// votes: vote-index shaped entries ({ id, chamber, date, question, result, bill_id,
// legislation, document_title, tallies, party_breakdown }); laws: bill docs with
// stage 'law'; billsById: titles for vote bills. Returns Map(monday -> week doc).
export function computeWeeks(votes, laws, billsById, { congress, onlyWeeks } = {}) {
  const weeks = new Map();
  const week = monday => {
    if (!weeks.has(monday)) {
      weeks.set(monday, {
        week: monday, week_end: addDays(monday, 6), congress: congress ?? null,
        counts: { votes: { House: 0, Senate: 0 }, passed: 0, failed: 0, laws: 0, confirmed: 0, nominations: 0, same: 0, opposed: 0 },
        laws: [], passage: [], closest: [], nominations: [],
      });
    }
    return weeks.get(monday);
  };

  const byWeek = new Map();
  for (const v of votes) {
    if (!v.date) continue;
    const monday = weekStart(easternDate(v.date));
    if (onlyWeeks && !onlyWeeks.has(monday)) continue;
    if (!byWeek.has(monday)) byWeek.set(monday, []);
    byWeek.get(monday).push(v);
  }

  for (const [monday, list] of byWeek) {
    const w = week(monday);
    list.sort((a, b) => a.date.localeCompare(b.date));
    for (const v of list) {
      if (w.counts.votes[v.chamber] !== undefined) w.counts.votes[v.chamber]++;
      const align = partyAlignment(v.party_breakdown);
      if (align === 'same' || align === 'opposed') w.counts[align]++;
      const cat = voteCategory(v.question || '');
      const outcome = voteOutcome(v.result || '');
      if (cat === 'passage' && outcome !== 'other') {
        w.passage.push(voteItem(v, billsById));
        w.counts[outcome === 'succeeded' ? 'passed' : 'failed']++;
      }
      if (cat === 'nomination') {
        w.nominations.push(voteItem(v, billsById));
        w.counts.nominations++;
        if (outcome === 'succeeded') w.counts.confirmed++;
      }
    }
    w.closest = list
      .filter(v => CLOSE_CATEGORIES.has(voteCategory(v.question || '')) && Number.isFinite(v.tallies?.yea) && Number.isFinite(v.tallies?.nay))
      .map(v => ({ v, margin: Math.abs(v.tallies.yea - v.tallies.nay) }))
      .sort((a, b) => a.margin - b.margin || b.v.date.localeCompare(a.v.date))
      .slice(0, CLOSEST_N)
      .map(({ v, margin }) => ({ ...voteItem(v, billsById), margin }));
  }

  for (const b of laws) {
    const signed = lawSigning(b);
    if (!signed) continue;
    const monday = weekStart(signed);
    if (onlyWeeks && !onlyWeeks.has(monday)) continue;
    const w = week(monday);
    w.laws.push({
      id: b.id, label: billLabel(b), title: b.title || null, law_number: b.law_number || null, signed,
      summary: b.ai_summary?.source === 'crs_summary' ? b.ai_summary.bullet_points || null : null,
      sponsor: b.sponsor ? { name: b.sponsor.name || null, party: b.sponsor.party || null, state: b.sponsor.state || null, bioguideId: b.sponsor.bioguideId || null } : null,
    });
    w.counts.laws++;
  }
  for (const w of weeks.values()) w.laws.sort((a, b) => (a.signed || '').localeCompare(b.signed || '') || (a.law_number || '').localeCompare(b.law_number || '', undefined, { numeric: true }));
  return weeks;
}

const active = w => w.counts.votes.House + w.counts.votes.Senate + w.counts.laws > 0;

// Compact entry for stats/weeks (navigation) and the Overview card.
export function weekSummary(w) {
  return {
    week: w.week, week_end: w.week_end,
    votes: w.counts.votes, passed: w.counts.passed, failed: w.counts.failed, laws: w.counts.laws,
    confirmed: w.counts.confirmed, nominations: w.counts.nominations, same: w.counts.same, opposed: w.counts.opposed,
  };
}

// The Overview card: the latest week with any activity, with a few named items.
// A House "rule" (H.Res. "Providing for consideration of the bill (H.R. X)...") sets the
// terms of debate for another bill: a procedural step, not a measure of its own.
export const isRuleVote = v => /^Providing for consideration of/i.test(v.bill?.title || '');

const KEY_VOTES_N = 4;

// The Overview/home card: the latest week with activity, with a few named items.
// key_votes: the latest final votes on bills/resolutions (rules left out) and
// nominations, newest first, with the party split (for plain-language cards).
export function thisWeek(w) {
  if (!w) return null;
  const finals = [...w.passage.filter(p => !isRuleVote(p)), ...w.nominations]
    .sort((a, b) => b.date.localeCompare(a.date));
  return {
    ...weekSummary(w),
    laws: w.laws.slice(0, 3).map(l => ({ id: l.id, label: l.label, title: l.title })),
    law_count: w.counts.laws,
    passed_items: w.passage.filter(p => p.outcome === 'succeeded' && !isRuleVote(p)).slice(-3).reverse()
      .map(p => ({ id: p.id, chamber: p.chamber, bill: p.bill, yea: p.yea, nay: p.nay, parties: p.parties, alignment: p.alignment })),
    key_votes: finals.slice(0, KEY_VOTES_N).map(v => ({
      id: v.id, chamber: v.chamber, date: v.date, question: v.question, result: v.result, outcome: v.outcome,
      yea: v.yea, nay: v.nay, parties: v.parties, alignment: v.alignment, bill: v.bill,
      document_title: v.document_title, legislation: v.legislation,
    })),
    final_votes: finals.length,
  };
}

// The latest `n` laws of the Congress (by signing date), for the home page.
export function recentLaws(laws, n = 4) {
  return laws.map(b => ({ b, signed: lawSigning(b) })).filter(x => x.signed)
    .sort((a, b) => b.signed.localeCompare(a.signed) || (b.b.law_number || '').localeCompare(a.b.law_number || '', undefined, { numeric: true }))
    .slice(0, n)
    .map(({ b, signed }) => ({
      id: b.id, label: b.bill_number || null, title: b.title || null, law_number: b.law_number || null, signed,
      summary: b.ai_summary?.source === 'crs_summary' ? (b.ai_summary.bullet_points || [])[0] || null : null,
    }));
}

export const isActiveWeek = active;
