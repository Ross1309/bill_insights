import test from 'node:test';
import assert from 'node:assert/strict';
import { congressStart, findTables, matchRequesters, memberIndex, names, packRows, parseTable, recordLines, runCheck, statedTotals } from '../netlify/lib/earmarks.js';

// Fixed-width rows like the Congressional Record's: columns padded to set widths.
const W = [12, 18, 22, 12, 12, 14, 14, 3];
const line = cells => cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(W[i]))).join('').replace(/\s+$/, '');
const DASH = '-'.repeat(110);
const page = [
  'The agreement includes $3,500,000 for the projects, and in the amounts, specified in the table titled',
  "``Community Project Funding/Congressionally Directed Spending'' in this statement.",
  '',
  '                              EXAMPLE APPROPRIATIONS',
  '               [Community Project Funding/Congressionally Directed Spending]',
  DASH,
  line(['', '', '', '', '', 'Requestor(s)', '', '']),
  line(['Agency', 'Account', 'Project', 'State', 'Amount', 'House', 'Senate', 'Or']),
  DASH,
  line(['DOT', 'Airports', 'Runway work at', 'WA', '1,000,000', 'Larsen', 'Cantwell,', 'H']),
  line(['', '', 'Paine Field', '', '', '', 'Murray', '']),
  DASH,
  // amount wrapped across lines, a name wrapped mid-word, the Record's "P" for a space
  line(['DOT', 'Airports', 'New tower', 'TX', '2,000,00', 'Moran', 'Cornyn,PCru', 'H']),
  line(['', '', '', '', '0', '', 'z', '']),
  DASH,
  line(['DOT', 'Airports', 'Dock repairs', 'GA', '500,000', 'Scott, David', '', 'H']),
  line(['', '', '', '', '', '(GA)', '', '']),
  DASH,
  '[[Page H101]]',
  '',
  '     Prose resumes here after the table and is not a row.',
];

const people = [
  ['L000560', 'Larsen', 'Rick', 'rep', 'WA'], ['C000127', 'Cantwell', 'Maria', 'sen', 'WA'], ['M001111', 'Murray', 'Patty', 'sen', 'WA'],
  ['M001224', 'Moran', 'Nathaniel', 'rep', 'TX'], ['C001056', 'Cornyn', 'John', 'sen', 'TX'], ['C001098', 'Cruz', 'Ted', 'sen', 'TX'],
  ['S001189', 'Scott', 'Austin', 'rep', 'GA'], ['S001157', 'Scott', 'David', 'rep', 'GA'],
  ['X000001', 'Former', 'Gone', 'rep', 'GA', '2023-01-03', '2025-01-03'],
].map(([id, last, first, type, state, start = '2025-01-03', end = '2027-01-03']) => ({ id: { bioguide: id }, name: { last, first, official_full: `${first} ${last}` }, terms: [{ type, state, start, end }] }));

test('findTables / parseTable: rows, wrapped amounts and names, roles', () => {
  const lines = recordLines(page.join('\n'));
  const [t] = findTables(lines);
  assert.equal(t.rows.length, 3, 'the prose after the table is not a row');
  const p = parseTable(t);
  assert.deepEqual(p.unread, []);
  assert.deepEqual(p.rows.map(r => [r.project, r.state, r.amount]), [
    ['Runway work at Paine Field', 'WA', 1000000],
    ['New tower', 'TX', 2000000],
    ['Dock repairs', 'GA', 500000],
  ]);
  assert.deepEqual(p.rows[0].senate, ['Cantwell', 'Murray']);
  assert.deepEqual(p.rows[1].senate, ['Cornyn', 'Cruz']);
  assert.deepEqual(statedTotals(lines.slice(0, t.start).join('\n')), [3500000]);
  assert.equal(runCheck({ kind: 'statement' }, p.rows, { statementText: lines.slice(0, t.start).join('\n') }).ok, true);
});

test('names(): the Record\'s "P" spaces and mid-word wraps', () => {
  assert.deepEqual(names('Markey,PWarr en'), ['Markey', 'Warren']);
  assert.deepEqual(names('BluntPRoches ter'), ['Blunt Rochester']);
  assert.deepEqual(names('P Van Hollen.'), ['Van Hollen']);
  assert.deepEqual(names('..............'), []);
});

test('matchRequesters: state, first names, the Congress window', () => {
  const index = memberIndex(people, '2026-01-22');
  assert.equal(congressStart('2026-01-22'), '2025-01-03');
  const ids = (list, st, ch) => matchRequesters(list, st, ch, index).map(m => m.id);
  assert.deepEqual(ids(['Cantwell', 'Murray'], 'WA', 'senate'), ['C000127', 'M001111']);
  assert.deepEqual(ids(['Scott (GA)'], 'GA', 'house'), [null]);                  // two Scotts: no guess
  assert.deepEqual(ids(['Scott', 'David (GA)'], 'GA', 'house'), ['S001157']);    // the first name decides
  assert.deepEqual(ids(['Cantwell'], 'DC', 'senate'), ['C000127']);             // unique nationwide
  assert.deepEqual(ids(['Former'], 'GA', 'house'), [null]);                     // left before this Congress
});

test('runCheck: law with a known gap, reference with tolerance and filter, parts', () => {
  const rows = [{ amount: 100, agency: 'Corps' }, { amount: 50, agency: 'Energy' }];
  const law = 'of which $120 shall be for the purposes specified in the table titled Community Project Funding/X; and $1 for other things';
  assert.equal(runCheck({ kind: 'law', gap: 30 }, rows, { lawText: law }).ok, true);
  assert.equal(runCheck({ kind: 'law' }, rows, { lawText: law }).ok, false);
  assert.equal(runCheck({ kind: 'reference', where: { agency: /Corps/ }, count: 1, total: 99, tolerance: 1 }, rows).ok, true);
  assert.equal(runCheck({ kind: 'reference', count: 3 }, rows).ok, false);
  assert.equal(runCheck({ kind: 'parts' }, rows, { parts: [{ rows: [rows[0]] }, { rows: [rows[1]] }] }).ok, true);
});

test('packRows: accounts once, requesters as ids or ~names', () => {
  const packed = packRows([
    { agency: 'DOT', account: 'Airports', recipient: 'R', project: 'P', location: '', state: 'WA', amount: 5, houseMatched: [{ id: 'L000560' }], senateMatched: [{ id: null, name: 'Nobody' }], origination: 'H' },
    { agency: 'DOT', account: 'Airports', recipient: 'R2', project: 'P2', location: '', state: 'WA', amount: 6, houseMatched: [], senateMatched: [], origination: 'S' },
  ]);
  assert.deepEqual(packed.accounts, [['DOT', 'Airports']]);
  assert.deepEqual(packed.rows[0], [0, 'R', 'P', '', 'WA', 5, ['L000560'], ['~Nobody'], 'H']);
});
