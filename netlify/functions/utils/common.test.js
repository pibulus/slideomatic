// Run: npm test   (node's built-in runner, no framework added)
//
// The origin allowlist now REFUSES rather than merely withholding CORS headers,
// so a mistake here is not a security nit — it is the live app returning 403 to
// its own users. That is what these guard.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowlistCorsHeaders, isAllowedOrigin } from './common.js';

test('the app’s own origins are allowed', () => {
  assert.equal(isAllowedOrigin({ origin: 'https://slideomatic.app' }), true);
  assert.equal(isAllowedOrigin({ origin: 'https://www.slideomatic.app' }), true);
});

test('local dev is allowed on any port, http or https', () => {
  assert.equal(isAllowedOrigin({ origin: 'http://localhost:3000' }), true);
  assert.equal(isAllowedOrigin({ origin: 'http://localhost' }), true);
  assert.equal(isAllowedOrigin({ origin: 'https://127.0.0.1:8888' }), true);
});

test('a capitalised Origin header still works', () => {
  // Netlify lowercases, but nothing in the contract promises it.
  assert.equal(isAllowedOrigin({ Origin: 'https://slideomatic.app' }), true);
});

test('other sites are refused', () => {
  assert.equal(isAllowedOrigin({ origin: 'https://evil.example' }), false);
  assert.equal(isAllowedOrigin({ origin: 'null' }), false);
});

test('a missing Origin is refused — that is the curl case', () => {
  // The hole this whole change closes: a script sends no Origin at all.
  assert.equal(isAllowedOrigin({}), false);
  assert.equal(isAllowedOrigin({ origin: '' }), false);
});

test('lookalike domains do not squeak through', () => {
  // Set membership, not substring matching — worth pinning so nobody
  // "improves" this into a .includes() check later.
  assert.equal(isAllowedOrigin({ origin: 'https://slideomatic.app.evil.com' }), false);
  assert.equal(isAllowedOrigin({ origin: 'https://notslideomatic.app' }), false);
  assert.equal(isAllowedOrigin({ origin: 'http://slideomatic.app' }), false); // http, not https
  assert.equal(isAllowedOrigin({ origin: 'https://localhost.evil.com' }), false);
});

test('CORS headers are still echoed only for allowed origins', () => {
  const good = allowlistCorsHeaders({ origin: 'https://slideomatic.app' });
  assert.equal(good['Access-Control-Allow-Origin'], 'https://slideomatic.app');

  const bad = allowlistCorsHeaders({ origin: 'https://evil.example' });
  assert.equal(bad['Access-Control-Allow-Origin'], undefined);
  assert.equal(bad.Vary, 'Origin');
});
