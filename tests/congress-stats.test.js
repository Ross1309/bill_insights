// "This Congress so far" series: GovInfo parsing, passage dates, House Clerk party totals,
// the "may have passed" filter, and the daily-series builder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCongressDoc, congressStart, dayIndex, houseClerkBreakdown, maybePassed, parseBillStatus, passageDates } from '../netlify/lib/congress-stats.js';

test('congressStart / dayIndex', () => {
  assert.equal(congressStart(119), '2025-01-03');
  assert.equal(congressStart(118), '2023-01-03');
  assert.equal(dayIndex('2025-01-03', '2025-01-03'), 0);
  assert.equal(dayIndex('2025-01-03', '2027-01-03'), 730);
});

test('passageDates: first passage per chamber, failures and later actions ignored', () => {
  const p = passageDates([
    { actionDate: '2024-12-21', text: 'Passed/agreed to in Senate: Passed Senate without amendment.' },
    { actionDate: '2024-11-12', text: 'Passed/agreed to in House: On motion to suspend the rules and pass the bill Agreed to.' },
    { actionDate: '2024-11-10', text: 'Failed of passage/not agreed to in House: On motion to suspend...' },
    { actionDate: '2025-01-05', text: 'Became Public Law No: 118-273.' },
  ]);
  assert.deepEqual(p, { house: '2024-11-12', senate: '2024-12-21', law: '2025-01-05' });
  assert.deepEqual(passageDates([{ actionDate: '2024-01-01', text: 'Referred to the House Committee on X.' }]), { house: null, senate: null, law: null });
});

test('parseBillStatus reads only the bill\'s own actions', () => {
  const xml = `<billStatus>
  <bill>
    <introducedDate>2023-01-09</introducedDate>
    <relatedBills>
      <item>
        <latestAction>
          <actionDate>2023-02-01</actionDate>
          <text>Passed/agreed to in Senate: a related bill</text>
        </latestAction>
      </item>
    </relatedBills>
    <actions>
      <item>
        <actionDate>2023-03-01</actionDate>
        <text>Passed/agreed to in House: On passage Passed by recorded vote.</text>
      </item>
      <item>
        <actionDate>2023-01-09</actionDate>
        <text>Referred to the House Committee on Ways and Means.</text>
      </item>
    </actions>
    <amendments>
      <amendment>
    <actions>
      <item><actionDate>2023-04-01</actionDate><text>Passed/agreed to in Senate: amendment</text></item>
    </actions>
      </amendment>
    </amendments>
  </bill>
</billStatus>`;
  const b = parseBillStatus(xml);
  assert.equal(b.introduced, '2023-01-09');
  assert.equal(b.house, '2023-03-01');
  assert.equal(b.senate, null);      // the related bill's and amendment's actions don't count
  assert.equal(b.actionCount, 2);
});

test('houseClerkBreakdown', () => {
  const xml = `<rollcall-vote><vote-totals>
    <totals-by-party><party>Republican</party><yea-total>220</yea-total><nay-total>0</nay-total></totals-by-party>
    <totals-by-party><party>Democratic</party><yea-total>3</yea-total><nay-total>205</nay-total></totals-by-party>
  </vote-totals></rollcall-vote>`;
  assert.deepEqual(houseClerkBreakdown(xml), { R: { yea: 220, nay: 0 }, D: { yea: 3, nay: 205 } });
  assert.deepEqual(houseClerkBreakdown('<rollcall-vote><totals-by-candidate/></rollcall-vote>'), {});   // Speaker election
});

test('maybePassed: referrals in the bill\'s own chamber are skipped, the other chamber\'s are not', () => {
  const t = (text, originChamber = 'House') => maybePassed({ latestAction: { text }, originChamber });
  assert.equal(t('Referred to the House Committee on Agriculture.'), false);
  assert.equal(t('Referred to the Subcommittee on Health.'), false);
  assert.equal(t('Introduced in House'), false);
  assert.equal(t('Received in the Senate and Read twice and referred to the Committee on Finance.'), true);
  assert.equal(t('Read twice and referred to the Committee on Finance.', 'Senate'), false);
  assert.equal(t('Referred to the House Committee on Agriculture.', 'Senate'), true);   // a Senate bill in the House
  assert.equal(t('Motion to reconsider laid on the table Agreed to without objection.'), true);
  assert.equal(maybePassed({}), false);
});

test('buildCongressDoc: daily counts, first passage per bill, first vote per measure', () => {
  const doc = buildCongressDoc({
    congress: 118, asOf: '2023-01-10',
    introducedDates: ['2023-01-03', '2023-01-03', '2023-01-05', '2022-12-31'],
    bills: [{ house: '2023-01-06', senate: '2023-01-09' }, { house: null, senate: '2023-01-08' }, { house: null, senate: null }],
    lawDates: ['2023-01-10'],
    votes: [
      { date: '2023-01-04', chamber: 'House', split: 'opposed', measure: 'hr1' },
      { date: '2023-01-06', chamber: 'House', split: 'same', measure: 'hr1' },
      { date: '2023-01-06', chamber: 'Senate', split: 'unclear', measure: 'pn5' },
      { date: '2023-01-07', chamber: 'Senate', split: 'opposed', measure: 'sjres2' },
    ],
  });
  assert.equal(doc.days, 8);
  assert.deepEqual(doc.introduced, [2, 0, 1, 0, 0, 0, 0, 0]);   // the 2022 date is before day 0
  assert.equal(doc.totals.passed_one, 2);
  assert.equal(doc.passed_one[3], 1);   // Jan 6: first chamber of the first bill
  assert.equal(doc.passed_both[6], 1);  // Jan 9: its second chamber
  assert.equal(doc.laws[7], 1);
  assert.deepEqual(doc.totals.votes, { House: 2, Senate: 2 });
  assert.deepEqual(doc.totals.split, { House: { same: 1, opposed: 1 }, Senate: { same: 0, opposed: 1 } });
  assert.equal(doc.totals.floor_voted, 2);   // hr1 once, sjres2; a nomination isn't a bill
  assert.equal(doc.floor_voted[1], 1);
});

test('probeNewBills: walks past gaps, stops after a run of misses, stops at a failure', async () => {
  const { probeNewBills } = await import('../netlify/lib/congress-stats.js');
  const exists = new Set([11, 12, 14, 15]);   // 13 is an unused number
  const fake = failAt => async url => {
    const n = Number(/\/(\d+)\?/.exec(url)[1]);
    if (n === failAt) { const e = new Error('boom'); e.status = 500; throw e; }
    if (!exists.has(n)) { const e = new Error('nf'); e.status = 404; throw e; }
    return { bill: { introducedDate: `2026-01-${String(n).padStart(2, '0')}` } };
  };
  const r = await probeNewBills(fake(null), 119, 's', 10, 'k', { misses: 5, concurrency: 3 });
  assert.deepEqual(r.dates.map(([n]) => n), [11, 12, 14, 15]);
  assert.equal(r.max, 15);
  const f = await probeNewBills(fake(14), 119, 's', 10, 'k', { misses: 5, concurrency: 3 });
  assert.equal(f.max, 13);   // stopped before the failed number; retried next run
  assert.deepEqual(f.dates.map(([n]) => n), [11, 12]);
});
