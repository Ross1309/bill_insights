import test from 'node:test';
import assert from 'node:assert/strict';
import { isZipOnly, stateAtEnd, stateDistricts, withoutUnit, zipDistricts, zipIn } from '../netlify/lib/zip-districts.js';
import { agrees, label } from '../netlify/lib/geoapify.js';

test('zipIn / isZipOnly', () => {
  assert.equal(zipIn('400 Broad St, Seattle, WA 98109'), '98109');
  assert.equal(zipIn('400 Broad St, Seattle, WA 98109-4607, USA'), '98109');
  assert.equal(zipIn('Seattle, WA'), null);
  assert.equal(zipIn('12345 Main St, Austin TX'), null);   // a house number isn't a ZIP
  assert.ok(isZipOnly(' 98109 '));
  assert.ok(isZipOnly('98109-4607'));
  assert.ok(!isZipOnly('98109 Seattle'));
});

test('zipDistricts: one district, split ZIPs, PO-box ZIPs, territories', () => {
  assert.deepEqual(zipDistricts('98109', 119), { districts: [{ state: 'WA', district: 7, share: 100 }], exact: true });
  const split = zipDistricts('98052', 119);
  assert.ok(split.exact && split.districts.length > 1);
  assert.deepEqual(split.districts.map(d => d.state), split.districts.map(() => 'WA'));
  assert.ok(split.districts[0].share >= split.districts[1].share);
  assert.deepEqual(zipDistricts('82001', 119).districts, [{ state: 'WY', district: 0, share: 100 }]);   // at-large
  // 30301: Atlanta PO boxes, no ZIP area: state only. 20500: the White House, DC's one seat.
  assert.deepEqual(zipDistricts('30301', 119), { state: 'GA', districts: [], exact: false });
  assert.deepEqual(zipDistricts('20500', 119), { districts: [{ state: 'DC', district: 0, share: 100 }], exact: false });
  assert.deepEqual(zipDistricts('00802', 119).districts, [{ state: 'VI', district: 0, share: 100 }]);
  assert.equal(zipDistricts('9810', 119), null);
  assert.equal(zipDistricts('98109', 118), null);   // no table for that Congress
  // The 120th Congress's map (Texas redrew for 2026): the table follows it.
  assert.ok(zipDistricts('78701', 120).districts.length >= 1);
});

test('stateAtEnd / stateDistricts', () => {
  assert.equal(stateAtEnd('Seattle, WA'), 'WA');
  assert.equal(stateAtEnd('Boise Idaho'), 'ID');
  assert.equal(stateAtEnd('San Juan, Puerto Rico'), 'PR');
  assert.equal(stateAtEnd('Portland or'), null);    // codes only in capitals
  assert.equal(stateAtEnd('1 Main Street'), null);
  assert.equal(stateAtEnd('Washington D.C.'), 'DC');
  assert.equal(stateAtEnd('Washington, DC'), 'DC');
  assert.deepEqual(stateDistricts('WY', 119), { districts: [{ state: 'WY', district: 0, share: 100 }] });
  assert.deepEqual(stateDistricts('WA', 119), { state: 'WA', districts: [] });
  assert.deepEqual(stateDistricts('GU', 119), { districts: [{ state: 'GU', district: 0, share: 100 }] });
});

test('withoutUnit drops apartment and suite numbers only', () => {
  assert.equal(withoutUnit('123 Main St Apt 4B, Springfield, IL 62701'), '123 Main St, Springfield, IL 62701');
  assert.equal(withoutUnit('400 Broad St #12, Seattle WA 98109'), '400 Broad St, Seattle WA 98109');
  assert.equal(withoutUnit('500 Pine St Suite 300 Seattle WA'), '500 Pine St Seattle WA');
  assert.equal(withoutUnit('400 Broad St, Seattle, WA'), '400 Broad St, Seattle, WA');
  assert.equal(withoutUnit('12 Floral Ave, Unity, ME'), '12 Floral Ave, Unity, ME');
  assert.equal(withoutUnit('100 Main St, Miami, FL 33101'), '100 Main St, Miami, FL 33101');
  assert.equal(withoutUnit('100 Main St Apt 2, Miami, FL 33101'), '100 Main St, Miami, FL 33101');
  assert.equal(withoutUnit('9 Lotus Ln Unit 33101'), '9 Lotus Ln Unit 33101');
});

test('Geoapify: a location counts only where the visitor said it is', () => {
  const r = { housenumber: '1600', street: 'Pennsylvania Avenue', city: 'McDonough', state: 'Georgia', state_code: 'GA', postcode: '30253' };
  assert.equal(agrees(r, '1600 Pennsylvania'), false);
  assert.equal(agrees(r, '1600 Pennsylvania Ave, McDonough, GA'), true);
  assert.equal(agrees(r, '1600 Pennsylvania Ave, Mcdonough Georgia'), true);
  assert.equal(agrees(r, '1600 Pennsylvania Ave 30253'), true);
  assert.equal(agrees(r, '1600 Pennsylvania Ave, Atlanta, GA'), false);
  assert.equal(agrees({ ...r, city: 'Cupertino', state_code: 'CA', state: 'California', postcode: '94087' }, '1 Apple Park Way, Cupertino, CA 95014'), true);
  assert.equal(label({ ...r, name: 'A building' }), '1600 Pennsylvania Avenue, McDonough, GA 30253');
});
