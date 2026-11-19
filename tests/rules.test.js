// Unit tests for the small rule functions the site's numbers depend on.
// Run: npm test   (Node's built-in test runner; no dependencies)
//
// Several cases are regressions for real bugs: "Not agreed to" contains "agreed to",
// "Concurrent Resolution" contains "concur", Senate times are Eastern with DST, and a
// new Congress starts on January 3, not January 1.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { stageFromActions } from '../netlify/lib/bills.js';
import { partyBreakdown, partyAlignment, voteCategory, voteOutcome } from '../netlify/lib/vote-stats.js';
import { parseSenateDate } from '../netlify/lib/senate-votes.js';
import { currentCongress, ordinal } from '../netlify/lib/congress.js';
import { topicTags } from '../netlify/lib/topics.js';
import { explainQuestion } from '../public/issues.js';

const acts = (...texts) => texts.map(text => ({ text }));

test('stageFromActions: failed House vote is not "passed"', () => {
  const s = stageFromActions(acts(
    'Referred to the House Committee on Foreign Affairs.',
    'Failed of passage/not agreed to in House: On agreeing to the resolution Failed by the Yeas and Nays: 212 - 219.',
  ));
  assert.equal(s.stage, 'committee');
  assert.equal(s.passed_house, false);
  assert.equal(s.failed_house, true);
});

test('stageFromActions: passed House, failed Senate', () => {
  const s = stageFromActions(acts(
    'Passed/agreed to in House: On agreeing to the resolution Agreed to by the Yeas and Nays: 214 - 208.',
    'Failed of passage/not agreed to in Senate: Concurrent Resolution rejected by Yea-Nay Vote. 49 - 50.',
  ));
  assert.equal(s.stage, 'passed_one');
  assert.equal(s.passed_house, true);
  assert.equal(s.failed_senate, true);
});

test('stageFromActions: both chambers, president, law', () => {
  assert.equal(stageFromActions(acts('Passed/agreed to in House: x', 'Passed/agreed to in Senate: y')).stage, 'passed_both');
  assert.equal(stageFromActions(acts('Passed/agreed to in House: x', 'Passed/agreed to in Senate: y', 'Presented to President.')).stage, 'to_president');
  assert.equal(stageFromActions(acts('Became Public Law No: 119-45.')).stage, 'law');
  assert.equal(stageFromActions([], { isLaw: true }).stage, 'law');
});

test('partyBreakdown + partyAlignment', () => {
  const pb = partyBreakdown([
    { party: 'D', position: 'Yea' }, { party: 'D', position: 'Nay' }, { party: 'D', position: 'Yea' },
    { party: 'R', position: 'No' }, { party: 'R', position: 'Nay' }, { party: 'R', position: 'Not Voting' },
    { party: 'I', position: 'Aye' },
  ]);
  assert.deepEqual(pb.D, { yea: 2, nay: 1, present: 0, not_voting: 0 });
  assert.deepEqual(pb.R, { yea: 0, nay: 2, present: 0, not_voting: 1 });
  assert.equal(partyAlignment(pb), 'opposed');
  assert.equal(partyAlignment({ D: { yea: 200, nay: 5 }, R: { yea: 210, nay: 3 } }), 'same');
  assert.equal(partyAlignment({ D: { yea: 5, nay: 5 }, R: { yea: 1, nay: 2 } }), 'unclear');
});

test('voteCategory', () => {
  assert.equal(voteCategory('On Cloture on the Motion to Proceed'), 'cloture');
  assert.equal(voteCategory('On the Nomination'), 'nomination');
  assert.equal(voteCategory('On Motion to Suspend the Rules and Pass, as Amended'), 'passage');
  assert.equal(voteCategory('On the Concurrent Resolution'), 'passage');
  assert.equal(voteCategory('On Motion to Concur in the Senate Amendment'), 'passage');
  assert.equal(voteCategory('On Agreeing to the Amendment'), 'amendment');
  assert.equal(voteCategory('On Ordering the Previous Question'), 'procedural');
});

test('voteOutcome: negatives win over "agreed"', () => {
  assert.equal(voteOutcome('Passed'), 'succeeded');
  assert.equal(voteOutcome('Nomination Confirmed'), 'succeeded');
  assert.equal(voteOutcome('Concurrent Resolution Rejected'), 'failed');
  assert.equal(voteOutcome('Motion Not Agreed to'), 'failed');
  assert.equal(voteOutcome('Decision of Chair Not Sustained'), 'failed');
});

test('parseSenateDate: Eastern time with DST', () => {
  assert.equal(parseSenateDate('November 10, 2026, 07:37 PM'), '2026-11-11T00:37:00.000Z'); // EST
  assert.equal(parseSenateDate('July 15, 2026, 10:05 AM'), '2026-07-15T14:05:00.000Z');     // EDT
  assert.equal(parseSenateDate('not a date'), null);
});

test('currentCongress: starts January 3', () => {
  assert.deepEqual(currentCongress(new Date('2026-11-11T12:00:00Z')), { congress: 119, session: 2 });
  assert.deepEqual(currentCongress(new Date('2027-01-02T23:00:00Z')), { congress: 119, session: 2 });
  assert.deepEqual(currentCongress(new Date('2027-01-03T18:00:00Z')), { congress: 120, session: 1 });
  assert.deepEqual(currentCongress(new Date('2028-03-01T12:00:00Z')), { congress: 120, session: 2 });
  assert.equal([119, 121, 122, 123, 111, 112, 113].map(ordinal).join(' '), '119th 121st 122nd 123rd 111th 112th 113th');
});

test('topicTags: title rule, focused rule, aid pattern', () => {
  const sanctions = topicTags({ policy_area: 'International Affairs', subjects: new Array(30).fill('x'), title: 'Sanctioning Russia and Iran Act' });
  assert.deepEqual(sanctions.topics, ['foreign-affairs', 'iran']);
  assert.equal(sanctions.topic_focus.iran, true);

  const omnibus = topicTags({ policy_area: 'Economics and Public Finance', subjects: [...new Array(248).fill('x'), 'Israel'], title: 'Consolidated Appropriations Act, 2026' });
  assert.deepEqual(omnibus.topics, ['economy', 'israel']);
  assert.equal(omnibus.topic_focus.israel, false);

  const disaster = topicTags({ policy_area: 'Emergency Management', subjects: ['Disaster relief'], title: 'Disaster Assistance Improvement Act' });
  assert.deepEqual(disaster.topics, []);
});

test('explainQuestion: concur vs concurrent, cloture vs motion to proceed', () => {
  assert.match(explainQuestion('On Motion to Concur in the Senate Amendments'), /other chamber's version/);
  assert.match(explainQuestion('On the Concurrent Resolution'), /adopts the resolution/);
  assert.match(explainQuestion('On Cloture on the Motion to Proceed'), /60 of 100/);
  assert.match(explainQuestion('On the Motion to Proceed'), /start debating/);
  assert.match(explainQuestion('On the Nomination'), /confirm/);
});

test('headlineCounts: seat types and party split', async () => {
  const { headlineCounts } = await import('../netlify/lib/vote-stats.js');
  const h = headlineCounts([
    { chamber: 'Senate', party: 'Republican', state: 'TX' },
    { chamber: 'Senate', party: 'Independent', state: 'VT' },
    { chamber: 'House', party: 'Democratic', state: 'WA' },
    { chamber: 'House', party: 'Democratic', state: 'DC' },
  ]);
  assert.deepEqual(h.senate, { count: 2, parties: { Republican: 1, Independent: 1 } });
  assert.deepEqual(h.house, { count: 1, parties: { Democratic: 1 } });
  assert.equal(h.delegates.count, 1);
});

test('legislationFromClerk: House Clerk <legis-num> -> bill id', async () => {
  const { legislationFromClerk } = await import('../netlify/lib/house-votes.js');
  const x = n => `<rollcall-vote><vote-metadata><legis-num>${n}</legis-num></vote-metadata></rollcall-vote>`;
  assert.deepEqual(legislationFromClerk(x('H R 2102'), 119), { legislation: 'HR 2102', bill_id: 'hr2102-119' });
  assert.deepEqual(legislationFromClerk(x('H RES 566'), 119), { legislation: 'HRES 566', bill_id: 'hres566-119' });
  assert.deepEqual(legislationFromClerk(x('H J RES 7'), 119), { legislation: 'HJRES 7', bill_id: 'hjres7-119' });
  assert.deepEqual(legislationFromClerk(x('S 1234'), 119), { legislation: 'S 1234', bill_id: 's1234-119' });
  assert.equal(legislationFromClerk(x('QUORUM'), 119), null);
  assert.equal(legislationFromClerk(x('ADJOURN'), 119), null);
  assert.equal(legislationFromClerk('', 119), null);
});

test('topicTags: Healthcare and Economy watchlists reach beyond the policy area', async () => {
  const { topicTags } = await import('../netlify/lib/topics.js');
  // A veterans' bill (other policy area) lands in Veterans' health, focused (title).
  const va = topicTags({ policy_area: 'Armed Forces and National Security', subjects: ["Veterans' medical care"], title: "Veterans' Health Care Improvement Act" });
  assert.ok(va.topics.includes('veterans-health') && !va.topics.includes('healthcare'));
  assert.equal(va.topic_focus['veterans-health'], true);
  // A big bill with many subjects is broad.
  const big = topicTags({ policy_area: 'Economics and Public Finance', subjects: ['Medicare', ...Array.from({ length: 40 }, (_, i) => `s${i}`)], title: 'Consolidated Appropriations Act' });
  assert.equal(big.topic_focus.coverage, false);
  // Title patterns use word boundaries: "Trademark" isn't trade, "Taxi" isn't tax.
  assert.ok(!topicTags({ title: 'Trademark Modernization Act' }).topics.includes('tariffs'));
  assert.ok(!topicTags({ title: 'Taxi Safety Act' }).topics.includes('taxes'));
  assert.ok(topicTags({ title: 'Reciprocal Trade Act' }).topics.includes('tariffs'));
});

test('fillUnmappedSenators: LIS map first, then unique name + state', async () => {
  const { fillUnmappedSenators, senatorNameIndex } = await import('../netlify/lib/senate-votes.js');
  const index = senatorNameIndex([
    { id: 'C000127', name: 'Cantwell, Maria', state: 'WA' },
    { id: 'X1', name: 'Smith, Ann', state: 'MN' },
    { id: 'X2', name: 'Smith, Bob', state: 'MN' },          // ambiguous: left out
    { id: 'L000570', name: 'Luján, Ben Ray', state: 'NM' },
  ]);
  const lis = new Map([['S100', 'B000001']]);
  const ivs = [
    { bioguideId: null, lis_member_id: 'S100', name: 'Old, Senator', state: 'OH' },  // from the LIS map
    { bioguideId: null, lis_member_id: 'S999', name: 'Cantwell, Maria', state: 'WA' }, // by name + state
    { bioguideId: null, lis_member_id: 'S998', name: 'Lujan, Ben', state: 'NM' },      // accent-insensitive
    { bioguideId: null, lis_member_id: 'S997', name: 'Smith, Ann', state: 'MN' },      // ambiguous: stays
    { bioguideId: 'K1', lis_member_id: 'S1', name: 'Known, A', state: 'TX' },
  ];
  assert.equal(fillUnmappedSenators(ivs, lis, index), 1);
  assert.deepEqual(ivs.map(v => v.bioguideId), ['B000001', 'C000127', 'L000570', null, 'K1']);
  assert.equal(lis.get('S999'), 'C000127');   // learned for later votes
});

test('stageFromActions: law_date from the Became Public/Private Law action', async () => {
  const { stageFromActions } = await import('../netlify/lib/bills.js');
  const r = stageFromActions([
    { actionDate: '2026-02-11', text: 'By Senator Lee from Committee filed written report.' },
    { actionDate: '2026-02-01', text: 'Became Public Law No: 119-68.' },
    { actionDate: '2026-01-20', text: 'Presented to President.' },
  ]);
  assert.equal(r.stage, 'law');
  assert.equal(r.law_date, '2026-02-01');
  assert.equal(stageFromActions([{ actionDate: '2026-03-26', text: 'Became Private Law No: 119-1.' }]).law_date, '2026-03-26');
  assert.equal(stageFromActions([{ actionDate: '2026-01-01', text: 'Referred to committee.' }]).law_date, null);
});

test('resultWord: rules are agreed to, nominations confirmed, bills passed', async () => {
  const { resultWord } = await import('../public/plain.js');
  const rule = { outcome: 'succeeded', bill: { id: 'hres1650-119', title: 'Providing for consideration of the bill (H.R. 1013) to amend...' } };
  assert.equal(resultWord(rule), 'Agreed to');
  assert.equal(resultWord({ ...rule, outcome: 'failed' }), 'Rejected');
  assert.equal(resultWord({ outcome: 'succeeded', kind: 'rule', bill: { id: 'hres1-119' } }), 'Agreed to');
  assert.equal(resultWord({ outcome: 'succeeded', question: 'On Passage', bill: { id: 'hr1-119', title: 'An Act' } }), 'Passed');
  assert.equal(resultWord({ outcome: 'succeeded', question: 'On Motion to Adjourn', bill: { id: 'hr1-119' } }), 'Agreed to');   // not a passage
  assert.equal(resultWord({ outcome: 'other', question: 'Election of the Speaker', result: 'Elected', bill: null }), 'Speaker elected');
  assert.equal(resultWord({ outcome: 'succeeded', bill: null, question: 'On the Nomination' }), 'Confirmed');
});

test('stageSteps: bills, resolutions, failures, vetoes', async () => {
  const { stageSteps } = await import('../public/stage.js');
  const states = s => s.steps.map(x => x.state[0]).join('');
  const b = stageSteps({ type: 'HR', chamber: 'House', stage: 'passed_one', passed_house: true });
  assert.deepEqual(b.steps.map(x => x.label), ['Introduced', 'Committee', 'Passed House', 'Passed Senate', 'To the President', 'Law']);
  assert.equal(states(b), 'dddttt');
  assert.equal(b.status, 'Passed in the House; next: the Senate');
  // Senate bill: Senate first.
  assert.equal(stageSteps({ type: 'S', chamber: 'Senate', stage: 'committee' }).steps[2].label, 'Passed Senate');
  assert.equal(stageSteps({ type: 'S', chamber: 'Senate', stage: 'committee' }).status, 'In committee');
  const law = stageSteps({ type: 'HR', chamber: 'House', stage: 'law', passed_house: true, passed_senate: true });
  assert.equal(states(law), 'dddddd'); assert.equal(law.status, 'Became law'); assert.ok(law.final);
  // Simple resolution: one chamber, final once agreed to.
  const res = stageSteps({ type: 'HRES', chamber: 'House', stage: 'passed_one', passed_house: true });
  assert.deepEqual(res.steps.map(x => x.label), ['Introduced', 'Committee', 'Agreed to in House']);
  assert.equal(res.status, 'Agreed to in the House'); assert.ok(res.final);
  // Concurrent resolution: both chambers, no President.
  assert.equal(stageSteps({ type: 'SCONRES', chamber: 'Senate', stage: 'passed_both', passed_house: true, passed_senate: true }).status, 'Agreed to by both chambers');
  // Failed in the House.
  const f = stageSteps({ type: 'HR', chamber: 'House', stage: 'committee', failed_house: true });
  assert.equal(f.steps[2].label, 'Failed in House'); assert.equal(f.steps[2].state, 'failed'); assert.equal(f.status, 'Failed in the House');
  // Vetoed.
  const v = stageSteps({ type: 'HJRES', chamber: 'House', stage: 'to_president', passed_house: true, passed_senate: true, vetoed: true });
  assert.equal(v.steps[4].label, 'Vetoed'); assert.equal(v.status, 'Vetoed by the President');
  // Constitutional amendment: no President; final after both chambers.
  const am = stageSteps({ type: 'HJRES', chamber: 'House', title: 'Proposing an amendment to the Constitution of the United States to ...', stage: 'passed_both', passed_house: true, passed_senate: true });
  assert.equal(am.steps.length, 4); assert.equal(am.status, 'Passed both chambers; goes to the states for ratification'); assert.ok(am.final);
  // No stage data -> no tracker (never guessed).
  assert.equal(stageSteps({ type: 'HR' }), null);
});

test('voteHeadline: only final votes say a measure passed', async () => {
  const { voteHeadline, resultWord } = await import('../public/plain.js');
  const bill = { id: 'hr4-119', label: 'HR 4', title: 'Rescissions Act of 2025' };
  const h = (chamber, question, outcome, extra = {}) => voteHeadline({ chamber, question, outcome, bill, ...extra });
  assert.equal(h('Senate', 'On the Cloture Motion', 'succeeded'), 'Senate voted to end debate on the Rescissions Act');
  assert.equal(h('Senate', 'On the Motion to Proceed', 'failed'), 'Senate voted not to take up the Rescissions Act');
  assert.equal(h('Senate', 'On the Amendment', 'failed'), 'Senate rejected an amendment to the Rescissions Act');
  assert.equal(h('House', 'On Motion to Recommit', 'failed'), 'House voted not to send the Rescissions Act back to committee');
  assert.equal(voteHeadline({ chamber: 'House', question: 'On Motion to Refer', outcome: 'succeeded', bill: { id: 'hres1655-119', label: 'H.Res. 1655', title: 'Censuring Representative X' } }), 'House sent H.Res. 1655 to committee');
  assert.equal(h('House', 'On Motion to Concur in the Senate Amendment', 'succeeded'), "House agreed to the Senate's changes to the Rescissions Act");
  assert.equal(h('Senate', 'On the Motion to Discharge', 'failed'), 'Senate voted not to take the Rescissions Act out of committee');
  assert.equal(h('House', 'On Overriding the Veto', 'failed'), 'House failed to override the veto of the Rescissions Act');
  assert.equal(h('House', 'On Motion to Suspend the Rules and Pass, as Amended', 'succeeded'), 'House passed the Rescissions Act');
  assert.equal(h('Senate', 'On Passage of the Bill', 'failed'), 'Senate rejected the Rescissions Act');
  // Tabling a motion sets it aside: tabling a discharge motion keeps the bill in committee.
  assert.equal(h('House', 'On Motion to Table the Motion to Discharge Committee', 'succeeded'), 'House set aside a motion to take the Rescissions Act out of committee');
  assert.equal(voteHeadline({ chamber: 'House', question: 'On Motion to Table', outcome: 'succeeded', bill: { id: 'hres537-119', label: 'HRES 537', title: 'Impeaching X' } }), 'House set aside H.Res. 537');
  // A suspension vote with a majority that falls short of two-thirds.
  assert.equal(voteHeadline({ chamber: 'House', question: 'On Motion to Suspend the Rules and Pass', outcome: 'failed', yea: 264, nay: 133, bill }), 'The Rescissions Act fell short of the two-thirds needed in the House');
  // Joint resolutions pass (official wording); descriptive "An …" titles follow the label.
  assert.match(voteHeadline({ chamber: 'Senate', question: 'On the Joint Resolution', outcome: 'succeeded', bill: { id: 'sjres37-119', label: 'SJRES 37', title: 'Providing for congressional disapproval' } }), /^Senate passed S\.J\.Res\. 37/);
  assert.equal(voteHeadline({ chamber: 'Senate', question: 'On the Resolution', outcome: 'succeeded', bill: { id: 'sres377-119', label: 'SRES 377', title: 'An executive resolution authorizing en bloc consideration' } }), 'Senate adopted S.Res. 377: An executive resolution authorizing en bloc consideration');
  // A rule on a joint resolution.
  assert.equal(voteHeadline({ chamber: 'House', question: 'On Agreeing to the Resolution', outcome: 'succeeded', bill: { id: 'hres354-119', label: 'HRES 354', title: 'Providing for consideration of the joint resolution (H.J. Res. 60) providing for disapproval' } }), 'House agreed to the terms of debate for H.J.Res. 60');
  // A concurrent resolution's own vote is final passage, not "concurring".
  assert.equal(voteHeadline({ chamber: 'Senate', question: 'On the Concurrent Resolution', outcome: 'succeeded', bill: { id: 'hconres86-119', label: 'HCONRES 86', title: 'Establishing the budget' } }),
    'Senate adopted H.Con.Res. 86: Establishing the budget');
  const rule = { id: 'hres1247-119', label: 'HRES 1247', title: 'Providing for consideration of the bill (H.R. 2102) to amend' };
  assert.equal(voteHeadline({ chamber: 'House', question: 'On Ordering the Previous Question', outcome: 'succeeded', bill: rule }), 'House voted to end debate on the rule for H.R. 2102');
  assert.equal(voteHeadline({ chamber: 'Senate', question: 'On the Cloture Motion', outcome: 'succeeded', bill: null, document_title: 'Anna St. John, of Louisiana, to be Judge' }),
    'Senate voted to end debate on the nomination of Anna St. John');
  assert.equal(resultWord({ question: 'On the Cloture Motion', outcome: 'succeeded', bill }), 'Agreed to');
  assert.equal(resultWord({ question: 'On Overriding the Veto', outcome: 'failed', bill }), 'Veto sustained');
  assert.equal(resultWord({ question: 'On Passage of the Bill', outcome: 'succeeded', bill }), 'Passed');
});

test('participation: counts, chamber medians without delegates or new members', async () => {
  const { computeParticipation } = await import('../netlify/lib/participation.js');
  const dir = [
    { id: 'A', chamber: 'House', state: 'WA' }, { id: 'B', chamber: 'House', state: 'TX' }, { id: 'C', chamber: 'House', state: 'OH' },
    { id: 'D', chamber: 'House', state: 'AS' },                     // delegate
    { id: 'E', chamber: 'House', state: 'NY' },                     // sworn in last week
    { id: 'S', chamber: 'Senate', state: 'WA' },
  ];
  const rec = (id, votes, not_voting, congress = 119) => ({ id, congress, totals: { votes, not_voting } });
  const p = computeParticipation(dir, [rec('A', 100, 1), rec('B', 100, 3), rec('C', 100, 20), rec('D', 85, 70), rec('E', 5, 0), rec('S', 50, 2), rec('X', 100, 50)], 119);
  assert.deepEqual(p.members.A, [100, 1]);
  assert.deepEqual(p.members.D, [85, 70]);          // shown (as a delegate note), but not in the median
  assert.equal(p.members.X, undefined);             // not a current member
  assert.equal(p.medians.House.missed_share, 0.03); // A, B, C only
  assert.equal(p.medians.House.members, 3);
  assert.equal(p.medians.Senate.missed_share, 0.04);
  assert.equal(computeParticipation(dir, [rec('A', 100, 1, 118)], 119).members.A, undefined);   // another Congress
});

test('missed-vote wording: delegates explained, shares rounded, typical shown', async () => {
  const { missedShort, missedLong } = await import('../public/participation.js');
  const doc = { members: { A: [685, 12], B: [685, 160] }, medians: { House: { missed_share: 0.019 } } };
  assert.match(missedShort({ id: 'A', chamber: 'House', state: 'WA' }, doc), /Missed 12 of 685 votes \(1\.8%\)/);
  assert.match(missedShort({ id: 'B', chamber: 'House', state: 'TX' }, doc), /Missed 160 of 685 votes \(23%\)/);
  assert.match(missedShort({ id: 'D', chamber: 'House', state: 'GU' }, doc), /Delegate/);
  assert.equal(missedShort({ id: 'Z', chamber: 'House', state: 'WA' }, doc), '');
  const long = missedLong({ id: 'A', chamber: 'House', state: 'WA' }, doc, { votes: 685, not_voting: 12 });
  assert.match(long, /Typical House member: 1\.9%/);
  assert.match(long, /doesn't say why/);
});

test('member trends: shown only when the history covers every vote; words match the data', async () => {
  const { memberTrendsHtml } = await import('../public/member-trends.js');
  const monthly = { '2025-01': [20, 2, 15, 18], '2025-02': [10, 0, 9, 10], '2025-04': [30, 9, 25, 28] };
  const rec = { totals: { votes: 60, not_voting: 11 }, monthly };
  const html = memberTrendsHtml(rec);
  assert.match(html, /most votes in April 2025: 9 of 30/);
  assert.match(html, /between 83% and 90%/);                       // 15/18, 9/10, 25/28
  assert.match(html, /Mar ’25/);                                   // gap month kept on the axis...
  assert.doesNotMatch(html, /March 2025: missed/);                  // ...with no bar
  assert.equal(memberTrendsHtml({ totals: { votes: 61, not_voting: 11 }, monthly }), '');   // incomplete history
  assert.equal(memberTrendsHtml({ totals: { votes: 20 }, monthly: { '2025-01': [20, 0, 0, 0] } }), '');   // too short
});

test('topics: Immigration and Defense tags; categories follow the topics; slugs unique and within the query limit', async () => {
  const { TOPICS } = await import('../netlify/lib/topics.js');
  const { categoryFor } = await import('../netlify/lib/bills.js');
  assert.deepEqual(topicTags({ policy_area: 'Immigration', subjects: ['Border security and unlawful immigration'], title: 'Secure the Border Act' }).topics, ['immigration', 'border']);
  assert.ok(!topicTags({ policy_area: 'Commerce', subjects: [], title: 'Borderline Cases Act' }).topics.includes('border'));   // word boundary
  assert.ok(topicTags({ policy_area: 'Armed Forces and National Security', subjects: [], title: 'National Defense Authorization Act for Fiscal Year 2026' }).topics.includes('defense-budget'));
  assert.ok(topicTags({ policy_area: 'Intelligence', subjects: [], title: 'FISA Reauthorization Act' }).topics.includes('intelligence'));
  assert.equal(categoryFor('Immigration'), 'Immigration');
  assert.equal(categoryFor('Armed Forces and National Security'), 'Defense');
  assert.equal(categoryFor('Taxation'), 'Economy');
  assert.equal(categoryFor('Crime and Law Enforcement'), 'Other');
  const slugs = Object.entries(TOPICS).flatMap(([s, t]) => [s, ...Object.keys(t.watchlists)]);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.ok(slugs.length <= 30);   // stats query uses array-contains-any (max 30)
});

test('veto override votes: "Veto Sustained" means the override failed', async () => {
  const { voteOutcome, voteCategory } = await import('../netlify/lib/vote-stats.js');
  const { outcomeOf } = await import('../public/plain.js');
  assert.equal(voteOutcome('Veto Sustained'), 'failed');
  assert.equal(voteOutcome('Veto Overridden'), 'succeeded');
  assert.equal(outcomeOf('Veto Sustained'), 'failed');
  assert.equal(voteOutcome('Point of Order Sustained'), 'succeeded');   // other "sustained" unchanged
  assert.equal(voteCategory('On Overriding the Veto'), 'passage');
});

test('Senate tabling: what was tabled comes from the vote title; quorum calls', async () => {
  const { voteHeadline, resultWord } = await import('../public/plain.js');
  const sres = { id: 'sres377-119', label: 'SRES 377', title: 'An executive resolution authorizing en bloc consideration' };
  const t = (title, outcome = 'succeeded') => voteHeadline({ chamber: 'Senate', question: 'On the Motion to Table', title, outcome, bill: sres });
  assert.equal(t('Motion to Table Schumer Point of Order Re: S. Res. 377'), 'Senate set aside a point of order on S.Res. 377');   // not the resolution
  assert.equal(t('Motion to Table the Motion to Reconsider the Vote'), 'Senate set aside a motion to reconsider the vote on S.Res. 377');
  assert.equal(t('Motion to Table the Appeal that Two Points of Order are Not Well Taken'), "Senate set aside an appeal of the chair's ruling on S.Res. 377");
  assert.equal(t(null), 'Senate set aside a motion on S.Res. 377');   // unknown: never "the resolution"
  assert.equal(resultWord({ question: 'Call of the House', outcome: 'succeeded', bill: null }), 'Quorum call');
});

test('summaryContext: long structured CRS summaries keep the overview and every title', async () => {
  const { summaryContext } = await import('../netlify/lib/bills.js');
  const titles = Array.from({ length: 10 }, (_, i) => `TITLE ${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][i]}--PART ${i} ${'x'.repeat(20000)}`).join(' ');
  const text = `This act reduces taxes and increases the debt limit. ${titles}`;
  const c = summaryContext(text);
  assert.ok(c.length <= 6000);
  assert.match(c, /^This act reduces taxes/);
  assert.equal((c.match(/TITLE [IVX]+--/g) || []).length, 10);
  assert.equal(summaryContext('short text'), 'short text');
  assert.equal(summaryContext('y'.repeat(9000)).length, 6000);   // unstructured: the first 6,000
});

test('nextStep: the rules of the process for the current stage, never a prediction', async () => {
  const { nextStep } = await import('../public/stage.js');
  const { currentCongress } = await import('../public/congress.js');
  const n = currentCongress().congress;
  const bill = (x = {}) => ({ type: 'HR', chamber: 'House', congress: n, stage: 'committee', ...x });
  assert.match(nextStep(bill()).text, /committee decides/);
  assert.match(nextStep(bill()).expires, new RegExp(`January 3, ${1789 + 2 * n}`));
  assert.match(nextStep(bill({ stage: 'passed_one', passed_house: true })).text, /^The Senate doesn't have to take it up/);
  assert.match(nextStep(bill({ stage: 'passed_both', passed_house: true, passed_senate: true })).text, /identical text/);
  assert.match(nextStep(bill({ stage: 'to_president', passed_house: true, passed_senate: true })).text, /10 days/);
  assert.match(nextStep(bill({ stage: 'law' })).text, /now law/);
  assert.equal(nextStep(bill({ stage: 'law' })).expires, null);
  assert.match(nextStep(bill({ stage: 'committee', failed_house: false, vetoed: true, passed_house: true, passed_senate: true })).text, /override/);
  assert.match(nextStep(bill({ stage: 'passed_one', failed_senate: true, passed_house: true })).text, /Senate could vote on it again/);
  assert.match(nextStep(bill({ type: 'HRES', stage: 'passed_one', passed_house: true })).text, /applies to its own chamber/);
  assert.match(nextStep(bill({ type: 'HCONRES', stage: 'passed_both', passed_house: true, passed_senate: true })).text, /doesn't become law/);
  assert.match(nextStep(bill({ type: 'HJRES', title: 'Proposing an amendment to the Constitution', stage: 'passed_both', passed_house: true, passed_senate: true })).text, /three-fourths/);
  assert.match(nextStep(bill({ congress: n - 2 })).text, /expired/);
  assert.match(nextStep(bill({ congress: n - 2, vetoed: true })).text, /veto stands/);
  assert.equal(nextStep({ type: 'HR' }), null);
});

test('voteDivision: close, party lines, broad agreement, mixed', async () => {
  const { voteDivision: d } = await import('../public/plain.js');
  const P = (dy, dn, ry, rn) => ({ D: { yea: dy, nay: dn }, R: { yea: ry, nay: rn } });
  assert.deepEqual(d({ yea: 218, nay: 214, parties: P(0, 212, 218, 2) }), ['close_vote', 'party_line']);
  assert.deepEqual(d({ yea: 49, nay: 27, parties: P(0, 27, 49, 0) }), ['party_line']);
  assert.deepEqual(d({ yea: 392, nay: 18, parties: P(210, 0, 181, 18) }), ['broad_agreement']);
  assert.deepEqual(d({ yea: 295, nay: 128, parties: P(83, 128, 211, 0) }), ['mixed_support']);
  assert.deepEqual(d({ yea: 50, nay: 50, parties: P(25, 25, 25, 25) }), ['close_vote']);       // tied party: no party tag
  assert.deepEqual(d({ yea: 105, nay: 95 }), ['close_vote']);                                    
  assert.deepEqual(d({ yea: 106, nay: 94 }), []);                                                  // no party data: nothing to say
  assert.deepEqual(d({ yea: 0, nay: 0 }), []);                                                     // quorum calls
  assert.deepEqual(d({ yea: 60, nay: 5, parties: P(5, 0, 55, 5) }), []);                           // too few Democrats voted to tag
});

test('weekBrief: sentences only from the counts', async () => {
  const { weekBrief } = await import('../public/plain.js');
  const full = weekBrief({ votes: { House: 9, Senate: 6 }, passed: 4, failed: 1, laws: 2, confirmed: 3, same: 5, opposed: 8,
    closest: { chamber: 'House', question: 'On Passage', outcome: 'succeeded', result: 'Passed', yea: 215, nay: 214, bill: { id: 'hr1-119', label: 'HR 1', title: 'Example Act' } } });
  assert.deepEqual(full, [
    'Congress held 15 recorded votes: 9 in the House and 6 in the Senate.',
    '4 bills or resolutions passed by recorded vote, 1 failed, 2 bills or resolutions became law and the Senate confirmed 3 nominees.',
    'Most Democrats and most Republicans took opposite sides on 8 of the 13 votes where each party had a majority position.',
    'The closest vote: House passed the Example Act, 215–214.',
  ]);
  assert.deepEqual(weekBrief({ votes: { House: 1, Senate: 0 }, laws: 1 }), ['The House held 1 recorded vote; the Senate held none.', '1 bill or resolution became law.']);
  assert.deepEqual(weekBrief({ votes: { House: 0, Senate: 0 }, confirmed: 1 }), ['Neither chamber held a recorded vote.', 'The Senate confirmed 1 nominee.']);
});

test('isCeremonial: naming, medals and coins, marked days; never political statements', async () => {
  const { isCeremonial: c } = await import('../public/stage.js');
  const yes = [
    { type: 'HR', title: 'To designate the facility of the United States Postal Service located at 86 Main Street in Haverstraw, New York, as the "Sgt. X Post Office".' },
    { type: 'HR', title: "To name the Department of Veterans Affairs community-based outpatient clinic in Toms River, New Jersey, the Leonard G. Harbor Clinic." },
    { type: 'S', title: 'A bill to designate the facility of the United States Postal Service located at 50 East 100 North in Moab, Utah.' },
    { type: 'HR', title: 'To designate the community-based outpatient clinic of the Department of Veterans Affairs in Lafayette, Louisiana.' },
    { type: 'HR', title: 'Miracle on Ice Congressional Gold Medal Act' },
    { type: 'HR', title: '25th Anniversary of 9/11 Commemorative Coin Act' },
    { type: 'HR', title: 'To award a medal', short_title: 'Muhammad Ali Congressional Gold Medal Act' },
    { type: 'HRES', title: 'Expressing support for the designation of October 2026 as "National Dyslexia Awareness Month".' },
    { type: 'SRES', title: 'A resolution designating October 2025 as "National Country Music Month".' },
    { type: 'HRES', title: 'Supporting the goals and ideals of "National Veterans Small Business Week".' },
    { type: 'HR', title: 'A Post Office Act', subjects: ['Postal service', 'Congressional tributes'] },
  ];
  const no = [
    { type: 'HR', title: 'To designate Ukraine under section 244 of the Immigration and Nationality Act to provide certain nationals of Ukraine with status.' },
    { type: 'HR', title: 'To require the United States Postal Service to designate ZIP Codes for certain communities.' },
    { type: 'HR', title: 'To designate the area between the intersections of 16th Street Northwest and Fuller Street Northwest.' },
    { type: 'HRES', title: 'Honoring the life and legacy of a human rights activist.' },
    { type: 'HRES', title: 'Recognizing the significance of equal pay and the disparity between wages paid to men and women.' },
    { type: 'HRES', title: 'Expressing support for the designation of a group as a foreign terrorist organization.' },
    { type: 'HRES', title: 'Condemning the attack on Veterans Day.' },
    { type: 'HR', title: 'National STEM Week Act' },
    { type: 'HR', title: 'Postal Service Reform Act', subjects: ['Postal service'] },
  ];
  for (const b of yes) assert.equal(c(b), true, b.title);
  for (const b of no) assert.equal(c(b), false, b.title);
});
