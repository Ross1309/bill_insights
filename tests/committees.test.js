// Members' committee seats from congress-legislators.
import test from 'node:test';
import assert from 'node:assert/strict';
import { memberCommittees } from '../netlify/lib/committees.js';

const committees = [
  { thomas_id: 'HSJU', name: 'House Committee on the Judiciary', subcommittees: [{ thomas_id: '01', name: 'Immigration Integrity, Security, and Enforcement' }, { thomas_id: '08', name: 'Crime and Federal Government Surveillance' }] },
  { thomas_id: 'HSBU', name: 'House Committee on the Budget', subcommittees: [] },
];
const membership = {
  HSJU: [{ bioguide: 'R000606', title: 'Ranking Member', rank: 1 }, { bioguide: 'J000298', rank: 5 }],
  HSJU01: [{ bioguide: 'J000298', title: 'Ranking Member', rank: 1 }],
  HSBU: [{ bioguide: 'J000298', rank: 3 }],
};

test('lists each member\'s committees, titled seats first, with their subcommittees', () => {
  const m = memberCommittees(committees, membership);
  assert.deepEqual(m.get('J000298'), [
    { id: 'HSBU', name: 'House Committee on the Budget', title: null, subcommittees: [] },
    { id: 'HSJU', name: 'House Committee on the Judiciary', title: null, subcommittees: [{ name: 'Immigration Integrity, Security, and Enforcement', title: 'Ranking Member' }] },
  ]);
  assert.equal(m.get('R000606')[0].title, 'Ranking Member');
  assert.equal(m.get('X000000'), undefined);
});
