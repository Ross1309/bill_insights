// A bill's story from its official actions (texts as Congress.gov writes them).
import test from 'node:test';
import assert from 'node:assert/strict';
import { billStory } from '../public/story.js';

const a = (actionDate, text, source = 'Library of Congress', recordedVotes = []) => ({ actionDate, text, source, recordedVotes });
const rv = (chamber, session, rollNumber) => [{ chamber, congress: 119, session, rollNumber }];

test('H.R. 1: passage, changes, tie-break, law', () => {
  const steps = billStory({ type: 'HR', chamber: 'House', introduced_date: '2025-05-20' }, [
    a('2025-07-04', 'Became Public Law No: 119-21.'),
    a('2025-07-04', 'Signed by President.'),
    a('2025-07-03', 'Presented to President.', 'House floor actions'),
    a('2025-07-03', 'On motion that the House agree to the Senate amendment Agreed to by recorded vote: 218 - 214 (Roll no. 190).', 'House floor actions', rv('House', 1, 190)),
    a('2025-07-03', 'Resolving differences -- House actions: On motion that the House agree to the Senate amendment Agreed to by recorded vote: 218 - 214 (Roll no. 190).', 'Library of Congress', rv('House', 1, 190)),
    a('2025-07-01', 'Passed/agreed to in Senate: Passed Senate with an amendment by Yea-Nay Vote. 51 - 50. Record Vote Number: 372.', 'Library of Congress', rv('Senate', 1, 372)),
    a('2025-06-27', 'Received in the Senate. Read the first time.', 'Senate'),
    a('2025-05-22', 'Passed/agreed to in House: On passage Passed by the Yeas and Nays: 215 - 214, 1 Present (Roll no. 145). (text: CR H2235-2334)', 'Library of Congress', rv('House', 1, 145)),
  ], [{ id: '119-1-senate-vote-372', tallies: { yea: 50, nay: 50 }, tie_breaker: { by: 'Vice President', vote: 'Yea' } }]);
  assert.deepEqual(steps.map(s => [s.date, s.text, s.detail]), [
    ['2025-05-20', 'Introduced in the House', null],
    ['2025-05-22', 'Passed the House', '215–214'],
    ['2025-07-01', 'Passed the Senate with changes', '50–50, the Vice President broke the tie'],
    ['2025-07-03', "The House accepted the Senate's changes", '218–214'],
    ['2025-07-03', 'Sent to the President', null],
    ['2025-07-04', 'Became Public Law 119-21', null],
  ]);
  assert.equal(steps[2].voteId, '119-1-senate-vote-372');
  assert.equal(steps[1].voteId, null);          // the vote isn't among the stored ones given
});

test('settling differences: accepted, compromise, or not yet', () => {
  const text = (bill, ...actions) => billStory(bill, actions).map(s => s.text);
  assert.deepEqual(text({ type: 'HR', chamber: 'House' }, a('2025-07-18', 'House agreed to Senate amendment pursuant to H. Res. 590.', 'House floor actions')), ["The House accepted the Senate's changes"]);
  assert.deepEqual(text({ type: 'S', chamber: 'Senate' }, a('2025-12-17', 'Resolving differences -- Senate actions: Senate agreed to the House amendment to S. 1071 by Yea-Nay Vote. 77 - 20. Record Vote Number: 660.')), ["The Senate accepted the House's changes"]);
  assert.deepEqual(text({ type: 'HR', chamber: 'House' }, a('2026-01-01', 'Resolving differences -- House actions: On agreeing to the conference report Agreed to by the Yeas and Nays: 300 - 100 (Roll no. 5).')), ['The House approved the compromise version']);
  assert.deepEqual(text({ type: 'HR', chamber: 'House' }, a('2026-01-01', 'Resolving differences -- House actions: On motion that the House disagree to the Senate amendment, and request a conference Agreed to by voice vote.')), []);
  // A bill's own chamber amending it on the floor isn't "changes" to anything already passed.
  assert.deepEqual(text({ type: 'S', chamber: 'Senate' }, a('2025-01-20', 'Passed/agreed to in Senate: Passed Senate with an amendment by Yea-Nay Vote. 64 - 35. Record Vote Number: 7.')), ['Passed the Senate']);
});

test('committees in each chamber, voice votes, resolutions, failures and vetoes', () => {
  const steps = billStory({ type: 'HR', chamber: 'House' }, [
    a('2025-03-14', 'Introduced in House'),
    a('2025-03-14', "Referred to the Committee on Armed Services, and in addition to the Committee on Veterans' Affairs, for a period.", 'House floor actions'),
    a('2025-04-04', 'Referred to the Subcommittee on Disability Assistance and Memorial Affairs.', 'House committee actions'),
    a('2025-05-01', 'Ordered to be Reported (Amended) by Voice Vote.', 'House committee actions'),
    a('2026-11-12', 'Passed/agreed to in House: On motion to suspend the rules and pass the bill Agreed to by voice vote.'),
    a('2026-11-12', 'Received in the Senate and Read twice and referred to the Committee on Armed Services.', 'Senate'),
    a('2026-12-01', 'Failed of passage/not agreed to in Senate: Failed by Yea-Nay Vote. 40 - 55.'),
    a('2026-12-02', 'Vetoed by President.'),
    a('2026-12-03', 'Failed of passage/not agreed to in House: On passage, the objections of the President to the contrary notwithstanding Failed by the Yeas and Nays: 200 - 220.'),
  ]);
  assert.deepEqual(steps.map(s => s.text), [
    'Introduced in the House', 'Sent to the House Committee on Armed Services', 'A committee sent it to the full House', 'Passed the House',
    'Sent to the Senate Committee on Armed Services', 'Failed in the Senate', 'Vetoed by the President', 'The House failed to override the veto',
  ]);
  assert.equal(steps[3].detail, 'by voice vote');
  assert.equal(steps[5].detail, '40–55');
  assert.equal(billStory({ type: 'HRES', chamber: 'House' }, [a('2026-11-12', 'Passed/agreed to in House: On agreeing to the resolution Agreed to by the Yeas and Nays: 271 - 135 (Roll no. 322).')])[0].text, 'Agreed to in the House');
  assert.equal(billStory({ type: 'HJRES', chamber: 'House' }, [a('2026-11-12', 'Passed/agreed to in House: On passage Passed by the Yeas and Nays: 211 - 208 (Roll no. 224).')])[0].text, 'Passed the House');
});
