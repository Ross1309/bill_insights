// House weekly floor schedule (docs.house.gov) -> stats/floor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFloorSchedule, floorUrl } from '../netlify/lib/house-floor.js';

const XML = `<floorschedule congress-num="119" week-date="2026-11-16" update-date="2026-11-13T17:02:23.730">
  <category type="Items that may be considered under suspension of the rules" sort-order="1"><floor-items>
    <floor-item id="1" remove-date=""><legis-num>H.R. 7254 </legis-num><floor-text>To amend the National Trails System Act &amp; more, as amended </floor-text></floor-item>
    <floor-item id="2" remove-date="2026-11-14T10:00:00"><legis-num>H.R. 9 </legis-num><floor-text>Pulled Act</floor-text></floor-item>
  </floor-items></category>
  <category type="Items that may be considered pursuant to a rule" sort-order="2"><floor-items>
    <floor-item id="3" remove-date=""><legis-num>H.R. 5267 </legis-num><floor-text>American Franchise Act </floor-text></floor-item>
  </floor-items></category>
  <category type="Items that may be considered" sort-order="3"><floor-items>
    <floor-item id="4" remove-date=""><legis-num>H. Res. ___</legis-num><floor-text>Impeaching someone.</floor-text></floor-item>
    <floor-item id="5" remove-date=""><legis-num>H. Res. 1650</legis-num><floor-text>Providing for consideration of the bill (H.R. 1013)</floor-text></floor-item>
  </floor-items></category>
</floorschedule>`;

test('parses the groups, drops removed items, links bills', () => {
  const f = parseFloorSchedule(XML);
  assert.equal(f.week, '2026-11-16');
  assert.equal(f.congress, 119);
  assert.deepEqual(f.categories.map(c => [c.kind, c.items.length]), [['suspension', 1], ['rule', 1], ['other', 2]]);
  assert.deepEqual(f.categories[0].items[0], { label: 'H.R. 7254', bill_id: 'hr7254-119', text: 'To amend the National Trails System Act & more', amended: true });
  assert.equal(f.categories[2].items[0].bill_id, null);          // not numbered yet
  assert.equal(f.categories[2].items[1].bill_id, 'hres1650-119');
  assert.throws(() => parseFloorSchedule('<html>Not found</html>'));
  assert.equal(floorUrl('2026-11-16'), 'https://docs.house.gov/billsthisweek/20261116/20261116.xml');
});

test('Home shows only the current week (next week on weekends)', async () => {
  const { floorWeek, upcomingHtml } = await import('../public/home.js');
  assert.equal(floorWeek(new Date('2026-11-16T15:00:00Z')), '2026-11-16');   // Monday
  assert.equal(floorWeek(new Date('2026-11-20T23:00:00Z')), '2026-11-16');   // Friday 6 pm ET
  assert.equal(floorWeek(new Date('2026-11-21T15:00:00Z')), '2026-11-23');   // Saturday
  assert.equal(floorWeek(new Date('2026-11-23T03:00:00Z')), '2026-11-23');   // Sunday 10 pm ET
  const f = { ...parseFloorSchedule(XML), status: 'published' };
  assert.match(upcomingHtml(f, null, new Date('2026-11-17T15:00:00Z')), /Coming up in the House[\s\S]*Fast-track bills[\s\S]*H\.R\. 7254/);
  assert.equal(upcomingHtml(f, null, new Date('2026-11-25T15:00:00Z')), '');   // stale week: hidden
  assert.match(upcomingHtml({ week: '2026-11-23', status: 'none', categories: [] }, null, new Date('2026-11-24T15:00:00Z')), /hasn't posted a floor schedule/);
});
