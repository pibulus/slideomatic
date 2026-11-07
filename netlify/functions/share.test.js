import crypto from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from './share.js';
import { handler as assetHandler } from './asset.js';
import { STORE_NAMES } from './utils/common.js';

function createMemoryStores() {
  const stores = new Map();

  function getStore(name) {
    if (!stores.has(name)) {
      const items = new Map();
      stores.set(name, {
        items,
        async get(key, opts = {}) {
          const entry = items.get(key);
          if (!entry) return null;
          if (opts.type === 'json') {
            return typeof entry.value === 'string' ? JSON.parse(entry.value) : entry.value;
          }
          return entry.value;
        },
        async getWithMetadata(key, opts = {}) {
          const entry = items.get(key);
          if (!entry) return null;
          const data = opts.type === 'json' && typeof entry.value === 'string'
            ? JSON.parse(entry.value)
            : entry.value;
          return { data, metadata: entry.metadata || {} };
        },
        async getMetadata(key) {
          const entry = items.get(key);
          if (!entry) return null;
          return { etag: '1', metadata: entry.metadata || {} };
        },
        async set(key, value, opts = {}) {
          items.set(key, {
            value,
            metadata: opts.metadata || {},
          });
        },
        async delete(key) {
          items.delete(key);
        },
        async list() {
          const blobs = [];
          for (const [key, entry] of items.entries()) {
            blobs.push({ key, metadata: entry.metadata || {} });
          }
          return { blobs };
        },
      });
    }
    return stores.get(name);
  }

  return { getStore, stores };
}

function signPassport(claims, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('share handler externalizes inline data URLs, deduplicates identical images, and serves GET', async () => {
  const { getStore, stores } = createMemoryStores();
  const deps = { getStore, connectLambda: () => {} };

  const postRes = await handler(
    {
      httpMethod: 'POST',
      headers: { host: 'slideomatic.app', 'x-forwarded-proto': 'https' },
      body: JSON.stringify({
        slides: [
          {
            type: 'title',
            title: 'Inline Test',
            image: {
              src: `data:image/png;base64,${TINY_PNG_BASE64}`,
              alt: 'First dot',
              originalFilename: 'dot.png',
            },
          },
          {
            type: 'image',
            caption: 'Duplicate dot',
            image: {
              src: `data:image/png;base64,${TINY_PNG_BASE64}`,
              alt: 'Second dot',
              originalFilename: 'dot-copy.png',
            },
          },
        ],
        theme: { accentColor: '#ff3366' },
        meta: { title: 'Inline Test' },
      }),
    },
    deps
  );

  assert.equal(postRes.statusCode, 200);
  const created = JSON.parse(postRes.body);
  assert.ok(created.id);
  assert.equal(created.shareUrl, `https://slideomatic.app/s/${created.id}`);
  assert.equal(created.optimization.deduplicatedCount, 1);

  const assetStore = stores.get(STORE_NAMES.ASSETS);
  assert.equal(assetStore.items.size, 1);

  const getRes = await handler(
    {
      httpMethod: 'GET',
      headers: { host: 'slideomatic.app' },
      queryStringParameters: { id: created.id },
    },
    deps
  );
  assert.equal(getRes.statusCode, 200);
  const fetched = JSON.parse(getRes.body);
  assert.equal(fetched.slides.length, 2);
  assert.equal(fetched.slides[0].image.storage, 'netlify-asset');
  assert.equal(fetched.slides[0].image.assetId, fetched.slides[1].image.assetId);
  assert.ok(fetched.slides[0].image.src.includes('/.netlify/images?url='));
});

test('share handler externalizes relative image paths and leaves 404 relative paths untouched', async () => {
  const { getStore, stores } = createMemoryStores();
  const pngBytes = Buffer.from(TINY_PNG_BASE64, 'base64');

  const mockFetch = async (url) => {
    if (url === 'https://slideomatic.app/images/risograph.webp') {
      return {
        ok: true,
        headers: new Map([['content-type', 'image/webp']]),
        async arrayBuffer() {
          return pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength);
        },
      };
    }
    return { ok: false, status: 404, headers: new Map() };
  };

  const deps = { getStore, fetch: mockFetch, connectLambda: () => {} };

  const postRes = await handler(
    {
      httpMethod: 'POST',
      headers: { host: 'slideomatic.app', 'x-forwarded-proto': 'https' },
      body: JSON.stringify({
        slides: [
          {
            type: 'image',
            caption: 'Riso print',
            image: { src: 'images/risograph.webp', alt: 'Risograph texture' },
          },
          {
            type: 'image',
            caption: 'Missing local image',
            image: { src: 'images/missing.webp', alt: 'Missing' },
          },
        ],
      }),
    },
    deps
  );

  assert.equal(postRes.statusCode, 200);
  const created = JSON.parse(postRes.body);

  const assetStore = stores.get(STORE_NAMES.ASSETS);
  assert.equal(assetStore.items.size, 1);

  const getRes = await handler(
    {
      httpMethod: 'GET',
      queryStringParameters: { id: created.id },
    },
    deps
  );
  const record = JSON.parse(getRes.body);
  assert.equal(record.slides[0].image.storage, 'netlify-asset');
  assert.ok(record.slides[0].image.src.includes('/.netlify/images?url='));
  // The 404 image path stays untouched instead of failing the share or blanking
  assert.equal(record.slides[1].image.src, 'images/missing.webp');
});

test('password-protected share enforces password on GET and never leaks metadata on GET ?meta=1', async () => {
  const { getStore } = createMemoryStores();
  const deps = { getStore, connectLambda: () => {} };

  const postRes = await handler(
    {
      httpMethod: 'POST',
      headers: { host: 'slideomatic.app', 'x-forwarded-proto': 'https' },
      body: JSON.stringify({
        slides: [
          {
            type: 'title',
            title: 'Classified Roadmap',
            subtitle: 'Internal eyes only',
          },
        ],
        meta: { title: 'Classified Roadmap', password: 'correct-horse-battery' },
      }),
    },
    deps
  );

  assert.equal(postRes.statusCode, 200);
  const { id } = JSON.parse(postRes.body);

  // Meta endpoint must NOT leak title or subtitle for locked shares
  const metaRes = await handler(
    {
      httpMethod: 'GET',
      queryStringParameters: { id, meta: '1' },
    },
    deps
  );
  assert.equal(metaRes.statusCode, 200);
  const meta = JSON.parse(metaRes.body);
  assert.equal(meta.passwordProtected, true);
  assert.equal(meta.title, 'Locked Deck');
  assert.ok(!meta.description.includes('Internal'));

  // GET without password -> 401
  const noPassRes = await handler(
    {
      httpMethod: 'GET',
      queryStringParameters: { id },
    },
    deps
  );
  assert.equal(noPassRes.statusCode, 401);

  // GET with wrong password -> 401
  const badPassRes = await handler(
    {
      httpMethod: 'GET',
      queryStringParameters: { id, password: 'wrong' },
    },
    deps
  );
  assert.equal(badPassRes.statusCode, 401);

  // GET with right password via X-Share-Passphrase header -> 200 and strips passwordHash/passwordSalt
  const okRes = await handler(
    {
      httpMethod: 'GET',
      headers: { 'x-share-passphrase': 'correct-horse-battery' },
      queryStringParameters: { id },
    },
    deps
  );
  assert.equal(okRes.statusCode, 200);
  const unlocked = JSON.parse(okRes.body);
  assert.equal(unlocked.slides[0].title, 'Classified Roadmap');
  assert.equal(unlocked.meta.passwordHash, undefined);
  assert.equal(unlocked.meta.passwordSalt, undefined);
});

test('Passport token grants permanent expiry, stamps createdBy, gates customSlug behind Passport, and enforces uniqueness', async () => {
  const { getStore, stores } = createMemoryStores();
  const passportSecret = 'test-secret-passport-key';
  const token = signPassport(
    {
      sub: 'SS-PABL-O999-2026',
      tier: 'supporter',
      stamps: ['slideomatic'],
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    passportSecret
  );
  const otherAppFreeToken = signPassport(
    {
      sub: 'SS-FREE-TALK-2026',
      tier: 'free',
      stamps: ['talktype'],
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    passportSecret
  );
  const deps = { getStore, passportSecret, connectLambda: () => {} };

  // Anonymous customSlug -> 403
  const anonSlugRes = await handler(
    {
      httpMethod: 'POST',
      headers: { host: 'slideomatic.app', 'x-forwarded-proto': 'https' },
      body: JSON.stringify({
        customSlug: 'Manifesto-2026',
        slides: [{ type: 'title', title: 'Anon Attempt' }],
      }),
    },
    deps
  );
  assert.equal(anonSlugRes.statusCode, 403);

  // Free Passport token from another app without 'slideomatic' stamp -> does NOT grant permanent or customSlug
  const otherAppSlugRes = await handler(
    {
      httpMethod: 'POST',
      headers: {
        host: 'slideomatic.app',
        'x-forwarded-proto': 'https',
        authorization: `Bearer ${otherAppFreeToken}`,
      },
      body: JSON.stringify({
        customSlug: 'Manifesto-2026',
        slides: [{ type: 'title', title: 'Other App Free Token' }],
      }),
    },
    deps
  );
  assert.equal(otherAppSlugRes.statusCode, 403);

  const otherAppShareRes = await handler(
    {
      httpMethod: 'POST',
      headers: {
        host: 'slideomatic.app',
        'x-forwarded-proto': 'https',
        authorization: `Bearer ${otherAppFreeToken}`,
      },
      body: JSON.stringify({
        slides: [{ type: 'title', title: 'Other App Standard Share' }],
      }),
    },
    deps
  );
  assert.equal(otherAppShareRes.statusCode, 200);
  assert.equal(JSON.parse(otherAppShareRes.body).permanent, false);

  const postRes = await handler(
    {
      httpMethod: 'POST',
      headers: {
        host: 'slideomatic.app',
        'x-forwarded-proto': 'https',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        customSlug: 'Manifesto-2026',
        slides: [{ type: 'title', title: 'Sovereign Software' }],
      }),
    },
    deps
  );

  assert.equal(postRes.statusCode, 200);
  const body = JSON.parse(postRes.body);
  assert.equal(body.id, 'manifesto-2026');
  assert.equal(body.permanent, true);
  assert.equal(body.shareUrl, 'https://slideomatic.app/s/manifesto-2026');

  const shareStore = stores.get(STORE_NAMES.SHARES);
  const storedEntry = shareStore.items.get('manifesto-2026');
  assert.equal(storedEntry.metadata.permanent, true);
  assert.equal(storedEntry.metadata.expiresAt, null);
  assert.equal(storedEntry.metadata.createdBy, 'SS-PABL-O999-2026');

  // Trying to claim the same customSlug again (with valid Passport) returns 409
  const duplicateRes = await handler(
    {
      httpMethod: 'POST',
      headers: {
        host: 'slideomatic.app',
        'x-forwarded-proto': 'https',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        customSlug: 'manifesto-2026',
        slides: [{ type: 'title', title: 'Another Deck' }],
      }),
    },
    deps
  );
  assert.equal(duplicateRes.statusCode, 409);
});

test('share handler and asset handler reject HTML, SVG, and XHTML data URLs to prevent stored XSS', async () => {
  const { getStore, stores } = createMemoryStores();
  const deps = { getStore, connectLambda: () => {} };

  const postRes = await handler(
    {
      httpMethod: 'POST',
      headers: { host: 'slideomatic.app', 'x-forwarded-proto': 'https' },
      body: JSON.stringify({
        slides: [
          {
            type: 'standard',
            headline: 'XSS Attempt 1',
            image: {
              src: 'data:text/html;base64,PHNjcmlwdD5hbGVydChkb2N1bWVudC5kb21haW4pPC9zY3JpcHQ+',
            },
          },
          {
            type: 'standard',
            headline: 'XSS Attempt 2',
            image: {
              src: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxzY3JpcHQ+YWxlcnQoMSk8L3NjcmlwdD48L3N2Zz4=',
            },
          },
          {
            type: 'standard',
            headline: 'XSS Attempt 3',
            image: {
              src: 'data:application/xhtml+xml;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
            },
          },
        ],
      }),
    },
    deps
  );

  assert.equal(postRes.statusCode, 200);
  const assetStore = stores.get(STORE_NAMES.ASSETS);
  // Zero non-raster payloads may be written into the assets store
  assert.equal(assetStore.items.size, 0);

  // Even if a legacy or poisoned blob existed in the store, asset.js refuses to serve it (415)
  const htmlBytes = Buffer.from('<script>alert(1)</script>', 'utf8');
  await assetStore.set('poisoned-html-blob', htmlBytes, {
    metadata: { mimeType: 'text/html', bytes: htmlBytes.byteLength },
  });

  const assetRes = await assetHandler(
    {
      httpMethod: 'GET',
      queryStringParameters: { id: 'poisoned-html-blob' },
    },
    deps
  );
  assert.equal(assetRes.statusCode, 415);
  assert.equal(assetRes.headers['X-Content-Type-Options'], 'nosniff');
});
