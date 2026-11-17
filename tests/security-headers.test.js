// Pages served by functions (share.js) send the same security headers netlify.toml sets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SECURITY_HEADERS } from '../netlify/lib/security-headers.js';

test('netlify.toml and the function headers match', () => {
  const toml = readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8');
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    const m = new RegExp(`^\\s*${name} = "([^"]*)"`, 'm').exec(toml);
    assert.ok(m, `${name} missing from netlify.toml`);
    assert.equal(m[1], value, `${name} differs between netlify.toml and netlify/lib/security-headers.js`);
  }
  assert.match(SECURITY_HEADERS['Content-Security-Policy'], /frame-ancestors 'none'/);
});
