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
  assert.equal(resultWord({ outcome: 'succeeded', bill: { id: 'hr1-119', title: 'An Act' } }), 'Passed');
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
  assert.equal(h('House', 'On Motion to Concur in the Senate Amendment', 'succeeded'), "House agreed to the Senate's changes to the Rescissions Act");
  assert.equal(h('Senate', 'On the Motion to Discharge', 'failed'), 'Senate voted not to take the Rescissions Act out of committee');
  assert.equal(h('House', 'On Overriding the Veto', 'failed'), 'House failed to override the veto of the Rescissions Act');
  assert.equal(h('House', 'On Motion to Suspend the Rules and Pass, as Amended', 'succeeded'), 'House passed the Rescissions Act');
  assert.equal(h('Senate', 'On Passage of the Bill', 'failed'), 'Senate rejected the Rescissions Act');
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
