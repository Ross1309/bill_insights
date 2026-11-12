// Precomputed issue-tracker pages: one `stats/topic-<slug>` doc per topic in
// topics.js, built from enriched bills + light vote fields. The page reads only this
// doc (plus the few full vote docs behind "Your members").
//
// A topic's "measures" are bills tagged with the topic that became law or got a
// recorded floor vote. Bills that never reached the floor aren't counted.

import { TOPICS } from './topics.js';
import { partyAlignment } from './vote-stats.js';
import { ordinal } from './congress.js';

const LABELS = { HR: 'H.R.', S: 'S.', HRES: 'H.Res.', SRES: 'S.Res.', HJRES: 'H.J.Res.', SJRES: 'S.J.Res.', HCONRES: 'H.Con.Res.', SCONRES: 'S.Con.Res.' };
const PASSAGE_Q = /passage|pass the bill|suspend the rules and (pass|agree|concur)|agreeing to the resolution|^on the (joint |concurrent )?resolution|concur in/i;
const isPassed = r => /passed|agreed|confirmed|adopted|sustained/i.test(r || '') && !/not agreed|failed|rejected|defeated|not sustained/i.test(r || '');

const billLabel = b => `${LABELS[b.type] || b.type} ${b.number}`;

function compactBill(b) {
  return {
    id: b.id,
    label: billLabel(b),
    title: b.title || null,
    stage: b.stage || null,
    passed_house: !!b.passed_house,
    passed_senate: !!b.passed_senate,
    failed_house: !!b.failed_house,
    failed_senate: !!b.failed_senate,
    law_number: b.law_number || null,
    sponsor: b.sponsor || null,
    cosponsors_count: b.cosponsors_count ?? null,
    subject_count: b.subject_count ?? null,
    summary: b.ai_summary?.bullet_points?.length ? b.ai_summary.bullet_points : null,
    crs_summary_available: b.crs_summary_available ?? null,
  };
}

const compactVote = v => ({
  id: v.id,
  chamber: v.chamber,
  date: v.date,
  question: v.question || null,
  result: v.result || null,
  passed: isPassed(v.result),
  yea: v.tallies?.yea ?? null,
  nay: v.tallies?.nay ?? null,
});

// Latest passage-type vote in each chamber, or null (passed by voice/UC or no vote).
function chamberVotes(bill, votes) {
  const out = {};
  for (const ch of ['House', 'Senate']) {
    const v = votes.filter(x => x.chamber === ch && PASSAGE_Q.test(x.question || '')).at(-1);
    out[ch] = v ? { yea: v.tallies?.yea ?? null, nay: v.tallies?.nay ?? null, result: v.result || null } : null;
  }
  return out;
}

function stageCounts(measures) {
  const law = measures.filter(b => b.stage === 'law').length;
  const both = measures.filter(b => b.stage === 'passed_both' || b.stage === 'to_president').length;
  const one = measures.filter(b => b.stage === 'passed_one').length;
  return { measures: measures.length, law, passed_both: both, passed_one: one, none: measures.length - law - both - one };
}

// bills: enriched bill docs ({ id, ...data }); votesByBill: Map bill_id -> votes (sorted by date)
export function computeTopicStats(slug, bills, votesByBill, overallAlignment, { congress } = {}) {
  const t = TOPICS[slug];
  const reached = b => b.stage === 'law' || (votesByBill.get(b.id) || []).length > 0;
  const measures = bills.filter(b => (b.topics || []).includes(slug) && reached(b));
  // Votes without a date (unparseable source time) can't be placed in time; skip them
  // here, as computeOverview does.
  const topicVotes = measures.flatMap(b => votesByBill.get(b.id) || []).filter(v => v.date).sort((a, b) => a.date.localeCompare(b.date));

  const agreement = { House: { same: 0, opposed: 0 }, Senate: { same: 0, opposed: 0 } };
  for (const v of topicVotes) {
    const a = partyAlignment(v.party_breakdown);
    if (a !== 'unclear' && agreement[v.chamber]) agreement[v.chamber][a]++;
  }

  const laws = measures.filter(b => b.stage === 'law')
    .map(b => ({ ...compactBill(b), chamber_votes: chamberVotes(b, votesByBill.get(b.id) || []) }))
    .sort((a, b) => (b.law_number || '').localeCompare(a.law_number || '', undefined, { numeric: true }));

  const billOf = new Map(measures.map(b => [b.id, b]));
  const keyVotes = [...topicVotes].reverse().slice(0, 5).map(v => ({
    ...compactVote(v),
    tallies: v.tallies || null,
    party_breakdown: v.party_breakdown || null,
    bill: { id: v.bill_id, label: billLabel(billOf.get(v.bill_id)), title: billOf.get(v.bill_id)?.title || null },
  }));

  const watchlists = {};
  for (const [wslug, w] of Object.entries(t.watchlists)) {
    const inList = bills.filter(b => (b.topics || []).includes(wslug) && reached(b));
    const focused = inList.filter(b => b.topic_focus?.[wslug]);
    const broad = inList.filter(b => !b.topic_focus?.[wslug]);
    const lastActivity = b => (votesByBill.get(b.id) || []).at(-1)?.date || b.latestAction?.actionDate || '';
    watchlists[wslug] = {
      label: w.label,
      intro: w.intro,
      subjects: w.subjects,
      counts: { ...stageCounts(focused), broad: broad.length, votes: focused.reduce((n, b) => n + (votesByBill.get(b.id) || []).length, 0) },
      focused: focused.sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)))
        .map(b => ({ ...compactBill(b), votes: (votesByBill.get(b.id) || []).map(compactVote) })),
      broad: broad.sort((a, b) => (b.subject_count || 0) - (a.subject_count || 0)).map(b => ({
        id: b.id, label: billLabel(b), title: b.title || null, stage: b.stage || null, subject_count: b.subject_count ?? null,
        passed_house: !!b.passed_house, passed_senate: !!b.passed_senate, failed_house: !!b.failed_house, failed_senate: !!b.failed_senate,
      })),
    };
  }

  return {
    slug,
    label: t.label,
    intro: t.intro.replace('{congress}', congress ? ordinal(congress) : 'current'),
    policy_areas: t.policyAreas,
    explainers: t.explainers,
    counts: { ...stageCounts(measures), votes: topicVotes.length },
    laws,
    key_votes: keyVotes,
    agreement,
    overall_agreement: overallAlignment || null,
    watchlists,
    // Firestore returns map keys alphabetically; keep the config order explicitly.
    watchlist_order: Object.keys(t.watchlists),
  };
}
