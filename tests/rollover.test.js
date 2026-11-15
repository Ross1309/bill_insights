// Congress rollover (January 3 of odd years): the date rules, the outgoing Congress's
// tail, member records that must not be reset by late votes, and the stats switching
// from the previous Congress to the new one. Uses a small in-memory stand-in for
// Firestore (only what these code paths call).

import test from 'node:test';
import assert from 'node:assert/strict';
import { currentCongress, outgoingCongress, TAIL_DAYS } from '../netlify/lib/congress.js';
import { mergeMemberDoc } from '../netlify/lib/member-votes.js';
import { writeOverviewStats } from '../netlify/lib/overview.js';
import { MIN_VOTES_TO_DISPLAY } from '../netlify/lib/congress.js';

const at = iso => new Date(iso);

test('currentCongress / outgoingCongress around January 3, 2027', () => {
  assert.deepEqual(currentCongress(at('2027-01-02T23:00:00Z')), { congress: 119, session: 2 });
  assert.equal(outgoingCongress(at('2027-01-02T23:00:00Z')), null);
  assert.deepEqual(currentCongress(at('2027-01-03T12:00:00Z')), { congress: 120, session: 1 });
  assert.equal(outgoingCongress(at('2027-01-03T12:00:00Z')), 119);
  assert.equal(outgoingCongress(at('2027-02-10T12:00:00Z')), 119);
  const end = new Date(Date.UTC(2027, 0, 3) + TAIL_DAYS * 86400e3 + 3600e3);
  assert.equal(outgoingCongress(end), null);
  assert.equal(outgoingCongress(at('2027-11-01T00:00:00Z')), null);
  assert.equal(outgoingCongress(at('2028-01-10T00:00:00Z')), null);   // session 2: nothing outgoing
});

test('a late vote of the outgoing Congress never resets a member\'s new record', () => {
  const entry = { id: '119-2-house-vote-400', date: '2027-01-02T20:00:00Z', group: 'yea', party_majority: 'yea' };
  const info = { chamber: 'House', name: 'X', party: 'D', state: 'WA', date: entry.date };
  const newer = { congress: 120, totals: { votes: 3, yea: 3 }, recent: [], applied: ['1h1', '1h2', '1h3'] };
  assert.equal(mergeMemberDoc(newer, 'A000001', 119, { entries: [entry], info }), null);
  // Same Congress: counted. Older doc: the new Congress starts fresh.
  const same = mergeMemberDoc({ congress: 119, totals: { votes: 5 }, recent: [], applied: [] }, 'A000001', 119, { entries: [entry], info });
  assert.equal(same.totals.votes, 6);
  const fresh = mergeMemberDoc({ congress: 119, totals: { votes: 900 }, recent: [], applied: ['2h1'] }, 'A000001', 120,
    { entries: [{ ...entry, id: '120-1-house-vote-1' }], info });
  assert.equal(fresh.totals.votes, 1);
  assert.deepEqual(fresh.applied, ['1h1']);
});

// --- In-memory Firestore stand-in -------------------------------------------------------
function fakeDb(data) {
  const store = new Map(Object.entries(data).map(([c, docs]) => [c, new Map(Object.entries(docs))]));
  const col = name => { if (!store.has(name)) store.set(name, new Map()); return store.get(name); };
  const snap = (name, id) => ({ id, exists: col(name).has(id), data: () => col(name).get(id), ref: docRef(name, id) });
  const docRef = (name, id) => ({
    path: `${name}/${id}`, _snap: () => snap(name, id),
    get: async () => snap(name, id),
    set: async (d, opts) => { col(name).set(id, opts?.merge ? { ...col(name).get(id), ...d } : d); },
  });
  const query = (name, filters = []) => ({
    where: (f, op, v) => query(name, [...filters, [f, op, v]]),
    select: () => query(name, filters),
    orderBy: () => query(name, filters),
    count: () => ({ get: async () => ({ data: () => ({ count: col(name).size }) }) }),
    get: async () => ({
      docs: [...col(name).keys()].map(id => snap(name, id)).filter(s => filters.every(([f, op, v]) =>
        op === '==' ? s.data()[f] === v : op === 'array-contains-any' ? (s.data()[f] || []).some(x => v.includes(x)) : true)),
    }),
    doc: id => docRef(name, id),
  });
  return { store, collection: name => query(name), getAll: async (...refs) => refs.filter(r => r.path).map(r => r._snap()) };
}

const vote = (congress, n, date, chamber = 'House') => ({
  vote_id: `${congress}-1-${chamber.toLowerCase()}-vote-${n}`, congress, session: 1, chamber, date, question: 'On Passage', result: 'Passed',
  tallies: { yea: 300, nay: 100 }, party_breakdown: { D: { yea: 200, nay: 10 }, R: { yea: 100, nay: 90 } }, roll_call_number: n,
});
const admin = { firestore: { FieldValue: { serverTimestamp: () => 'now' } } };

test('stats: previous Congress until the new one has enough votes, then every week of the new one', async t => {
  t.mock.method(Date, 'now', () => Date.parse('2027-02-15T12:00:00Z'));
  process.env.CW_TODAY = '2027-02-15T12:00:00Z';
  const old = Object.fromEntries(Array.from({ length: 40 }, (_, i) => {
    const v = vote(119, i + 1, `2026-12-${String(1 + (i % 18)).padStart(2, '0')}T18:00:00Z`);
    return [v.vote_id, v];
  }));
  const directory = { members: { members: [] } };
  const weeksDoc = { weeks: { congress: 119, weeks: [{ week: '2026-12-14', congress: 119 }] } };

  // 10 votes of the 120th: stats still describe the 119th.
  const few = Object.fromEntries(Array.from({ length: 10 }, (_, i) => { const v = vote(120, i + 1, '2027-01-07T18:00:00Z'); return [v.vote_id, v]; }));
  let db = fakeDb({ votes: { ...old, ...few }, directory, stats: { ...weeksDoc }, bills: {} });
  let r = await writeOverviewStats(db, admin, { congress: 120 });
  assert.equal(r.congress, 119);
  assert.equal(db.store.get('stats').get('overview').congress, 119);

  // Enough votes of the 120th, spread from January 7 (more than 3 weeks before "today"):
  // the stats switch, and the week list is rebuilt for the 120th from its first week.
  const many = Object.fromEntries(Array.from({ length: MIN_VOTES_TO_DISPLAY + 5 }, (_, i) => {
    const day = i < 10 ? '2027-01-07' : '2027-02-10';
    const v = vote(120, i + 1, `${day}T18:00:00Z`);
    return [v.vote_id, v];
  }));
  db = fakeDb({ votes: { ...old, ...many }, directory, stats: { ...weeksDoc }, bills: {} });
  r = await writeOverviewStats(db, admin, { congress: 120 });
  assert.equal(r.congress, 120);
  const list = db.store.get('stats').get('weeks');
  assert.equal(list.congress, 120);
  assert.deepEqual(list.weeks.map(w => w.week), ['2027-01-04', '2027-02-08']);   // January's week kept
  assert.ok(list.weeks.every(w => w.congress === 120));
  delete process.env.CW_TODAY;
});
