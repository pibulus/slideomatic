// Run: npm test   (node's built-in runner, no framework added)
//
// The origin allowlist now REFUSES rather than merely withholding CORS headers,
// so a mistake here is not a security nit — it is the live app returning 403 to
// its own users. That is what these guard.

import crypto from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowlistCorsHeaders,
  isAllowedOrigin,
  sanitizeCustomSlug,
  isRelativeAssetPath,
  decodeDataUrl,
  resolveSafeHostAndProtocol,
  verifyPassportToken,
  hashSharePassword,
  verifySharePassword,
  summarizeDeckMeta,
} from './common.js';

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

test('sanitizeCustomSlug accepts clean slugs and rejects invalid ones', () => {
  assert.equal(sanitizeCustomSlug('My-Cool-Deck-2026'), 'my-cool-deck-2026');
  assert.equal(sanitizeCustomSlug('  --zines-rock--  '), 'zines-rock');
  assert.equal(sanitizeCustomSlug('ab'), null); // too short (<3)
  assert.equal(sanitizeCustomSlug('a'.repeat(45)), null); // too long (>40)
  assert.equal(sanitizeCustomSlug('---'), null);
});

test('isRelativeAssetPath accepts safe repo image paths and rejects schemes/traversal', () => {
  assert.equal(isRelativeAssetPath('images/risograph.webp'), 'images/risograph.webp');
  assert.equal(isRelativeAssetPath('/images/demo-deck/slide-1.png'), 'images/demo-deck/slide-1.png');
  assert.equal(isRelativeAssetPath('data:image/png;base64,AAAA'), null);
  assert.equal(isRelativeAssetPath('https://example.com/pic.png'), null);
  assert.equal(isRelativeAssetPath('//evil.example/pic.png'), null);
  assert.equal(isRelativeAssetPath('../secret/pic.png'), null);
  assert.equal(isRelativeAssetPath('/.netlify/functions/asset?id=123'), null);
  assert.equal(isRelativeAssetPath('images/not-an-image.json'), null);
});

function signTestPassport(claims, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

test('verifyPassportToken validates HS256 Passport tokens and rejects tampered or expired ones', () => {
  const secret = 'test-passport-secret-key-999';
  const validToken = signTestPassport(
    {
      sub: 'SS-ABCD-EFGH-JKLM',
      tier: 'supporter',
      stamps: ['slideomatic', 'dropper'],
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    secret
  );

  const verified = verifyPassportToken(validToken, secret);
  assert.ok(verified);
  assert.equal(verified.sub, 'SS-ABCD-EFGH-JKLM');
  assert.equal(verified.tier, 'supporter');
  assert.deepEqual(verified.stamps, ['slideomatic', 'dropper']);

  // Wrong secret
  assert.equal(verifyPassportToken(validToken, 'wrong-secret'), null);

  // Tampered payload
  const parts = validToken.split('.');
  const tamperedPayload = Buffer.from(JSON.stringify({ sub: 'SS-HACK-HACK-HACK', tier: 'supporter' })).toString('base64url');
  assert.equal(verifyPassportToken(`${parts[0]}.${tamperedPayload}.${parts[2]}`, secret), null);

  // Expired token
  const expiredToken = signTestPassport(
    {
      sub: 'SS-ABCD-EFGH-JKLM',
      tier: 'supporter',
      exp: Math.floor(Date.now() / 1000) - 60,
    },
    secret
  );
  assert.equal(verifyPassportToken(expiredToken, secret), null);
});

test('hashSharePassword and verifySharePassword round-trip and reject bad hex', async () => {
  const { salt, hash } = await hashSharePassword('velvet-thunder-42');
  assert.equal(await verifySharePassword('velvet-thunder-42', salt, hash), true);
  assert.equal(await verifySharePassword('wrong-password', salt, hash), false);
  assert.equal(await verifySharePassword('velvet-thunder-42', '', hash), false);
  assert.equal(await verifySharePassword('velvet-thunder-42', '00', '00'), false);
});

test('summarizeDeckMeta hides all content for password-protected shares', () => {
  const lockedRecord = {
    slides: [
      {
        type: 'title',
        title: 'Top Secret Launch Plan',
        subtitle: 'Confidential Q4 numbers',
        image: { src: 'https://slideomatic.app/.netlify/functions/asset?id=secret-1' },
      },
    ],
    theme: { accentColor: '#ff3366' },
    meta: {
      title: 'Top Secret Launch Plan',
      passwordProtected: true,
      passwordHash: 'deadbeefdeadbeefdeadbeefdeadbeef',
      passwordSalt: 'cafebabecafebabe',
    },
  };

  const lockedMeta = summarizeDeckMeta('secret-slug', lockedRecord);
  assert.equal(lockedMeta.passwordProtected, true);
  assert.equal(lockedMeta.title, 'Locked Deck');
  assert.equal(lockedMeta.image, null);
  assert.equal(lockedMeta.slideCount, null);
  assert.ok(!lockedMeta.description.includes('Confidential'));

  const publicRecord = {
    slides: [
      {
        type: 'title',
        title: '**Zines** & Machines',
        subtitle: 'Pastel-punk decks for independent makers',
        image: {
          src: 'https://slideomatic.app/.netlify/images?url=asset-1',
          alt: 'Riso print cover',
        },
      },
      { type: 'quote', quote: 'Compression is grace.' },
    ],
    theme: { accentColor: '#ff3366' },
    meta: { title: 'Zines & Machines', passwordProtected: false, createdBy: 'SS-1234' },
  };

  const pubMeta = summarizeDeckMeta('zine-slug', publicRecord);
  assert.equal(pubMeta.passwordProtected, false);
  assert.equal(pubMeta.title, 'Zines & Machines');
  assert.equal(pubMeta.description, 'Pastel-punk decks for independent makers');
  assert.equal(pubMeta.image, 'https://slideomatic.app/.netlify/images?url=asset-1');
  assert.equal(pubMeta.imageAlt, 'Riso print cover');
  assert.equal(pubMeta.slideCount, 2);
  assert.equal(pubMeta.themeAccent, '#ff3366');
  assert.equal(pubMeta.passportStamped, true);
});

test('decodeDataUrl allows valid raster images and rejects HTML, SVG, or spoofed MIME headers', () => {
  const validPng =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const decoded = decodeDataUrl(validPng);
  assert.equal(decoded.mimeType, 'image/png');
  assert.ok(decoded.buffer.byteLength > 0);

  // Rejects text/html, image/svg+xml, application/xhtml+xml
  assert.throws(() => decodeDataUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='));
  assert.throws(() => decodeDataUrl('data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+'));
  assert.throws(() => decodeDataUrl('data:application/xhtml+xml;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='));

  // Rejects HTML/SVG payload masquerading with a declared image/png MIME
  assert.throws(() => decodeDataUrl('data:image/png;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='));
});

test('resolveSafeHostAndProtocol prefers host over x-forwarded-host and blocks loopback outside NETLIFY_DEV', () => {
  const prevDev = process.env.NETLIFY_DEV;
  delete process.env.NETLIFY_DEV;
  try {
    // Host wins over spoofed X-Forwarded-Host
    const res1 = resolveSafeHostAndProtocol({
      headers: {
        host: 'slideomatic.app',
        'x-forwarded-host': '127.0.0.1:9999',
      },
    });
    assert.equal(res1.host, 'slideomatic.app');
    assert.equal(res1.protocol, 'https');

    // Loopback is rejected when NETLIFY_DEV is not 'true'
    const res2 = resolveSafeHostAndProtocol({
      headers: { host: '127.0.0.1:9999' },
    });
    assert.equal(res2.host, null);
  } finally {
    if (prevDev !== undefined) process.env.NETLIFY_DEV = prevDev;
  }
});
