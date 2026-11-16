// Member contact details: what the nightly sync keeps from congress-legislators, and the links.
import test from 'node:test';
import assert from 'node:assert/strict';
import { memberContact } from '../netlify/lib/member-contact.js';
import { contactLinks } from '../public/util.js';

test('memberContact keeps phone, web links and office; drops non-web links', () => {
  assert.deepEqual(memberContact({ phone: '202-224-2621', url: 'https://www.murray.senate.gov', contact_form: 'https://www.murray.senate.gov/write-to-patty/', office: '154 Russell Senate Office Building' }),
    { phone: '202-224-2621', url: 'https://www.murray.senate.gov', form: 'https://www.murray.senate.gov/write-to-patty/', office: '154 Russell Senate Office Building' });
  assert.equal(memberContact({ url: 'javascript:alert(1)' }), null);
  assert.equal(memberContact(undefined), null);
});

test('contactLinks: tap-to-call, contact form, website', () => {
  const html = contactLinks({ phone: '202-225-3106', url: 'https://jayapal.house.gov', form: null });
  assert.match(html, /href="tel:\+12022253106"[^>]*>Call 202-225-3106</);
  assert.match(html, /href="https:\/\/jayapal\.house\.gov" target="_blank" rel="noopener"[^>]*>Website</);
  assert.doesNotMatch(html, /Contact form/);
  assert.equal(contactLinks(null), '');
  assert.equal(contactLinks({ phone: 'n/a', url: 'ftp://x' }), '');
});
